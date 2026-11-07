import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.LOCAL_AUTH_ENABLED = '';
const { createStaticServer } = await import('./static-server.mjs');
let server;
let baseURL;
test.beforeAll(async () => {
  process.env.LOCAL_AUTH_ENABLED = '1';
  process.env.LOCAL_AUTH_EMAIL = `profile-${randomUUID()}@paradox.test`;
  server = createStaticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  process.env.LOCAL_AUTH_ENABLED = '';
  delete process.env.LOCAL_AUTH_EMAIL;
});

test('profile saves through authenticated API and survives reload and fresh sign-in', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const anonymous = await context.request.patch('/api/auth/local', { data: { name: 'Forbidden' } });
  expect(anonymous.status()).toBe(401);
  const page = await context.newPage();
  await page.goto('/');
  await page.click('#landing-login');
  await page.click('#auth-local');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.goto('/#/profile');
  await expect(page.locator('#profile-form')).toBeVisible();
  await page.locator('#profile-form input[name="name"]').fill('Profile Learner');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/auth/local') && response.request().method() === 'PATCH');
  await page.locator('#profile-form button[type="submit"]').click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('.profile-hero h2')).toHaveText('Profile Learner');
  await page.reload();
  await expect(page.locator('#profile-form input[name="name"]')).toHaveValue('Profile Learner');
  const invalid = await context.request.patch('/api/auth/local', { data: { name: ' '.repeat(3), role: 'admin' } });
  expect(invalid.status()).toBe(400);
  await context.request.delete('/api/auth/local');
  const signedIn = await context.request.post('/api/auth/local');
  expect((await signedIn.json()).user).toMatchObject({ name: 'Profile Learner', role: 'user' });
  await page.evaluate(() => document.querySelector('edu-app').applyTheme(true));
  await page.screenshot({ path: 'artifacts/homepage/profile-dark-1440.png', fullPage: true });
  for (const width of [1920, 1366, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'artifacts/homepage/profile-dark-375.png', fullPage: true });
  await page.evaluate(() => document.querySelector('edu-app').applyTheme(false));
  await page.screenshot({ path: 'artifacts/homepage/profile-light-375.png', fullPage: true });
  await context.close();
});
