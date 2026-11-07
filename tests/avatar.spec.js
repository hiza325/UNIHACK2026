import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import AxeBuilder from '@axe-core/playwright';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createAvatarStore } from '../api/auth/_avatar-store.js';
import { cleanupAvatars } from '../api/auth/_avatar.js';

process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.LOCAL_AUTH_ENABLED = '';
const { createStaticServer } = await import('./static-server.mjs');
test.describe.configure({ mode: 'serial' });
let server, baseURL, directory, originalEnv;
const ownerA = `avatar-a-${randomUUID()}@paradox.test`;
const ownerB = `avatar-b-${randomUUID()}@paradox.test`;
const endpoint = '/api/auth/local?avatar=meta';
let png;

test.beforeAll(async () => {
  originalEnv = Object.fromEntries(['LOCAL_AUTH_ENABLED', 'LOCAL_AUTH_EMAIL', 'LOCAL_PROFILE_DIR', 'LOCAL_AVATAR_DIR'].map(key => [key, process.env[key]]));
  directory = await mkdtemp(join('.data', 'avatar-test-'));
  process.env.LOCAL_AUTH_ENABLED = '1';
  process.env.LOCAL_PROFILE_DIR = join(directory, 'profiles');
  process.env.LOCAL_AVATAR_DIR = join(directory, 'images');
  png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#573491' } }).png().toBuffer();
  server = createStaticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(directory, { recursive: true, force: true });
});
async function signedIn(browser, email) {
  process.env.LOCAL_AUTH_EMAIL = email;
  const context = await browser.newContext({ baseURL });
  expect((await context.request.post('/api/auth/local')).status()).toBe(200);
  return context;
}
const imageBody = (buffer = png, mime = 'image/png') => ({ image: buffer.toString('base64'), mime });

test('authenticated image processing, owner isolation, persistent profile and deletion', async ({ browser }) => {
  const anonymous = await browser.newContext({ baseURL });
  expect((await anonymous.request.post(endpoint, { data: imageBody() })).status()).toBe(401);
  const a = await signedIn(browser, ownerA);
  const b = await signedIn(browser, ownerB);
  const saved = await a.request.post(`${endpoint}&userId=${encodeURIComponent(ownerB)}`, { data: { ...imageBody(), userId: ownerB, filename: '../../outside.webp' } });
  expect(saved.status()).toBe(200);
  const { avatarUrl } = await saved.json();
  expect((await (await b.request.get(endpoint)).json()).avatarUrl).toBeNull();
  const image = await a.request.get(avatarUrl);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/webp');
  expect(image.headers()['x-content-type-options']).toBe('nosniff');
  expect(image.headers()['cache-control']).toContain('no-store');
  const info = await sharp(await image.body()).metadata();
  expect(info).toMatchObject({ format: 'webp', width: 512, height: 512 });
  expect(info.exif).toBeUndefined();
  expect((await b.request.get(avatarUrl)).status()).toBe(404);
  expect((await anonymous.request.get(avatarUrl)).status()).toBe(401);
  expect((await a.request.get('/.data/avatars/test.webp')).status()).toBe(404);
  expect((await a.request.get('/.env')).status()).toBe(404);
  await a.request.patch('/api/auth/local', { data: { name: 'Avatar Owner' } });
  expect((await (await a.request.get(endpoint)).json()).avatarUrl).toBe(avatarUrl);
  await a.request.delete('/api/auth/local');
  process.env.LOCAL_AUTH_EMAIL = ownerA;
  const relogin = await a.request.post('/api/auth/local');
  expect((await relogin.json()).user.name).toBe('Avatar Owner');
  expect((await (await a.request.get(endpoint)).json()).avatarUrl).toBe(avatarUrl);
  const otherDevice = await signedIn(browser, ownerA);
  expect((await (await otherDevice.request.get(endpoint)).json()).avatarUrl).toBe(avatarUrl);
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  server = createStaticServer();
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  expect((await a.request.get(avatarUrl)).status()).toBe(200);
  await b.request.delete(`${endpoint}&userId=${encodeURIComponent(ownerA)}`);
  expect((await a.request.get(avatarUrl)).status()).toBe(200);
  const removed = await a.request.delete(endpoint);
  expect(await removed.json()).toMatchObject({ avatarUrl: null, cleanupPending: false });
  expect((await a.request.get(avatarUrl)).status()).toBe(404);
  const store = createAvatarStore({ source: 'local', id: ownerA });
  expect((await store.state()).key).toBeNull();
  expect(await readdir(join(process.env.LOCAL_AVATAR_DIR, store.owner))).toEqual([]);
  await Promise.all([a.close(), b.close(), anonymous.close(), otherDevice.close()]);
});

test('server rejects spoofed, corrupt, oversized and cross-origin requests; rate limit persists', async ({ browser }) => {
  const context = await signedIn(browser, `validation-${randomUUID()}@paradox.test`);
  const invalid = [
    [imageBody(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'), 415],
    [imageBody(Buffer.from('<script>alert(1)</script>'), 'image/png'), 400],
    [imageBody(png, 'image/jpeg'), 400],
    [imageBody(png.subarray(0, 40)), 400],
    [imageBody(Buffer.alloc(5 * 1024 * 1024 + 1)), 413],
  ];
  for (const [data, expected] of invalid) expect((await context.request.post(endpoint, { data })).status()).toBe(expected);
  expect((await context.request.post(endpoint, { data: imageBody(), headers: { Origin: 'https://attacker.invalid' } })).status()).toBe(403);
  const jpeg = await sharp(png).jpeg().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  expect((await context.request.post(endpoint, { data: imageBody(jpeg, 'image/jpeg') })).status()).toBe(200);
  expect((await context.request.post(endpoint, { data: imageBody(webp, 'image/webp') })).status()).toBe(200);
  for (let index = 0; index < 3; index += 1) expect((await context.request.delete(endpoint)).status()).toBe(200);
  const limited = await context.request.post(endpoint, { data: imageBody() });
  expect(limited.status()).toBe(429);
  expect(limited.headers()['retry-after']).toBe('600');
  await context.close();
});

test('retired-object cleanup is durable and retries without losing the active avatar', async () => {
  const store = createAvatarStore({ source: 'local', id: `cleanup-${randomUUID()}@paradox.test` });
  const old = `${store.owner}/${randomUUID()}.webp`;
  const next = `${store.owner}/${randomUUID()}.webp`;
  const bytes = await sharp(png).webp().toBuffer();
  await store.mutate('enqueue', old); await store.put(old, bytes); await store.mutate('activate', old);
  await store.mutate('enqueue', next); await store.put(next, bytes); await store.mutate('activate', next);
  // Fault injection verifies recovery only, not live remote storage behavior.
  expect(await cleanupAvatars({ ...store, remove: async () => { throw new Error('disk unavailable'); } })).toBe(true);
  expect((await store.state()).retired).toContain(old);
  expect((await store.state()).key).toBe(next);
  expect(await cleanupAvatars(store)).toBe(false);
  expect((await store.state()).retired).toEqual([]);
  expect(await readFile(join(process.env.LOCAL_AVATAR_DIR, next))).toEqual(bytes);
});

test('abandoned uploads expire from their lease and can never be activated', async () => {
  const email = `lease-${randomUUID()}@paradox.test`;
  const store = createAvatarStore({ source: 'local', id: email });
  const abandoned = `${store.owner}/${randomUUID()}.webp`;
  const bytes = await sharp(png).webp().toBuffer();
  await store.mutate('enqueue', abandoned);
  await store.put(abandoned, bytes);
  const file = join(process.env.LOCAL_PROFILE_DIR, `${createHash('sha256').update(email).digest('hex')}.json`);
  const profile = JSON.parse(await readFile(file, 'utf8'));
  profile.avatar.started[abandoned] = Date.now() - 11 * 60 * 1000;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, JSON.stringify(profile));
  await expect(store.mutate('activate', abandoned)).rejects.toMatchObject({ code: 'AVATAR_INVALID_KEY' });
  expect(await cleanupAvatars(store)).toBe(false);
  expect((await store.state()).retired).not.toContain(abandoned);
  await expect(readFile(join(process.env.LOCAL_AVATAR_DIR, abandoned))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('crop preview, save, cancel, reload, sign-in, shared UI and mobile', async ({ browser }) => {
  process.env.LOCAL_AUTH_EMAIL = `ui-${randomUUID()}@paradox.test`;
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  let injectedFailure = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (injectedFailure && message.location().url.includes('avatar=meta') && message.text().includes('503')) return;
    // Baseline: Local preview has no Supabase config, so the existing remote
    // session/logout probes return 503. Do not count these as avatar success.
    if (/\/api\/auth\/(session|logout)$/.test(message.location().url) && message.text().includes('503')) {
      test.info().annotations.push({ type: 'baseline-console', description: `${message.location().url}: ${message.text()}` });
      return;
    }
    errors.push(message.text());
  });
  await page.goto('/');
  await page.click('#landing-login'); await page.click('#auth-local');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.goto('/#/profile');
  await page.locator('[data-avatar-file]').setInputFiles({ name: 'wrong.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.locator('[data-avatar-status]')).toContainText('Ảnh không hợp lệ');
  await page.locator('[data-avatar-file]').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.locator('[data-avatar-status]')).toContainText('5 MB');
  const blue = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#0000ff' } }).png().toBuffer();
  const portrait = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ff0000' } }).composite([{ input: blue, left: 400, top: 0 }]).png().toBuffer();
  await page.locator('[data-avatar-file]').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: portrait });
  await expect(page.locator('.avatar-editor')).toBeVisible();
  await page.locator('[data-crop="zoom"]').fill('1.5');
  await page.locator('[data-crop="x"]').fill('80');
  await page.locator('[data-crop="y"]').fill('20');
  await page.evaluate(() => document.querySelector('edu-app').applyTheme(true));
  await page.screenshot({ path: 'artifacts/homepage/avatar-crop-desktop.png', fullPage: true });
  expect((await new AxeBuilder({ page }).include('.avatar-editor').analyze()).violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
  // UI-only fault injection: no claim that this simulated failure is a backend.
  injectedFailure = true;
  await page.route('**/api/auth/local?avatar=meta', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'AVATAR_STORAGE_UNAVAILABLE' }) });
    else await route.continue();
  });
  await page.locator('[data-avatar-save]').click();
  await expect(page.locator('[data-avatar-editor-status]')).toContainText('Không thể xử lý');
  await page.unroute('**/api/auth/local?avatar=meta');
  injectedFailure = false;
  await page.locator('[data-avatar-save]').click();
  await expect(page.locator('.avatar-editor')).toHaveCount(0);
  await expect(page.locator('[data-user-avatar] img')).toHaveCount(3);
  const urls = await page.locator('[data-user-avatar] img').evaluateAll(images => images.map(image => image.getAttribute('src')));
  expect(new Set(urls).size).toBe(1);
  const cropped = await context.request.get(urls[0]);
  const pixels = await sharp(await cropped.body()).raw().toBuffer({ resolveWithObject: true });
  const at = x => [...pixels.data.subarray((256 * 512 + x) * pixels.info.channels, (256 * 512 + x) * pixels.info.channels + 3)];
  expect(at(50)[0]).toBeGreaterThan(200);
  expect(at(150)[2]).toBeGreaterThan(200); // Pan/zoom changed the crop, not just the preview.
  await expect(page.locator('[data-avatar-status]')).toContainText('Đã lưu');
  await page.reload();
  await expect(page.locator('[data-user-avatar] img')).toHaveCount(3);
  await page.locator('[data-avatar-file]').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.avatar-editor')).toBeVisible();
  await page.locator('[data-avatar-cancel]').click();
  expect(await page.locator('.profile-avatar-lg img').getAttribute('src')).toBe(urls[0]);
  await page.locator('#logout-button').click();
  await page.click('#landing-login'); await page.click('#auth-local');
  await expect(page.locator('.sidebar [data-user-avatar] img')).toBeVisible();
  await page.goto('/#/profile');
  await expect(page.locator('.profile-avatar-lg img')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('[data-avatar-file]').setInputFiles({ name: 'mobile.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.avatar-editor')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/homepage/avatar-crop-mobile.png', fullPage: true });
  await page.evaluate(() => document.querySelector('edu-app').applyTheme(false));
  await page.screenshot({ path: 'artifacts/homepage/avatar-crop-mobile-light.png', fullPage: true });
  expect((await new AxeBuilder({ page }).include('.avatar-editor').analyze()).violations.filter(item => ['serious', 'critical'].includes(item.impact))).toEqual([]);
  await page.locator('[data-avatar-cancel]').click();
  await page.locator('[data-avatar-remove]').click();
  await expect(page.locator('[data-user-avatar] img')).toHaveCount(0);
  await expect(page.locator('[data-avatar-status]')).toContainText('Đã xóa');
  await page.reload();
  await expect(page.locator('[data-avatar-change]')).toBeVisible();
  await expect(page.locator('[data-user-avatar] img')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
