/*
 * Phần 3 — server-side "enter locally" sign-in.
 *
 * Deterministic server-contract tests; no AI provider is involved, so nothing
 * here is mocked for PASS purposes. The server under test is the same
 * tests/static-server.mjs used by the Playwright webServer, started in-process
 * with explicit LOCAL_AUTH_ENABLED toggles per scenario.
 */
import { expect, test } from '@playwright/test';

// Deterministic worker environment. The .env loader in static-server.mjs only
// fills variables that are not already set, so pre-setting these values pins
// the starting state of this spec.
process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.LOCAL_AUTH_ENABLED = '';
const { createStaticServer } = await import('./static-server.mjs');

test.describe.configure({ mode: 'serial' });

let server;
let baseURL;

test.beforeAll(async () => {
  server = createStaticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

function setLocalAuth(enabled, production = false) {
  process.env.LOCAL_AUTH_ENABLED = enabled ? '1' : '';
  process.env.VERCEL = production ? '1' : '';
}

async function localContext(browser) {
  return browser.newContext({ baseURL });
}

test('unconfigured: GET reports unavailable and POST refuses without issuing a session', async ({ browser }) => {
  setLocalAuth(false);
  const context = await localContext(browser);
  const status = await context.request.get('/api/auth/local');
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({ available: false });
  const attempt = await context.request.post('/api/auth/local');
  expect(attempt.status()).toBe(403);
  expect(await attempt.json()).toMatchObject({ code: 'LOCAL_AUTH_NOT_CONFIGURED' });
  expect(attempt.headers()['set-cookie']).toBeUndefined();
  await context.close();
});

test('configured: POST issues an HttpOnly session cookie and a user that is never admin', async ({ browser }) => {
  setLocalAuth(true);
  const context = await localContext(browser);
  const response = await context.request.post('/api/auth/local');
  expect(response.status()).toBe(200);
  const { user } = await response.json();
  expect(user.email).toBe('local@paradox.test');
  expect(user.role).toBe('user');
  const cookie = response.headers()['set-cookie'];
  expect(cookie).toContain('paradox-local=');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  const session = await context.request.get('/api/auth/local');
  expect(await session.json()).toMatchObject({ available: true, user });
  await context.close();
});

test('configured: a tampered token is rejected', async ({ browser }) => {
  setLocalAuth(true);
  const context = await localContext(browser);
  await context.addCookies([{ name: 'paradox-local', value: 'tampered.payload.signature', url: baseURL }]);
  const session = await context.request.get('/api/auth/local');
  expect(await session.json()).toEqual({ available: true });
  await context.close();
});

test('configured: DELETE clears the session', async ({ browser }) => {
  setLocalAuth(true);
  const context = await localContext(browser);
  await context.request.post('/api/auth/local');
  const before = await (await context.request.get('/api/auth/local')).json();
  expect(before.user).toBeTruthy();
  const logout = await context.request.delete('/api/auth/local');
  expect(logout.status()).toBe(200);
  const after = await (await context.request.get('/api/auth/local')).json();
  expect(after).toEqual({ available: true });
  await context.close();
});

test('production refuses even when the flag is set: direct API calls fail', async ({ browser }) => {
  setLocalAuth(true, true);
  const context = await localContext(browser);
  try {
    const status = await context.request.get('/api/auth/local');
    expect(await status.json()).toEqual({ available: false });
    const attempt = await context.request.post('/api/auth/local');
    expect(attempt.status()).toBe(403);
    expect(await attempt.json()).toMatchObject({ code: 'LOCAL_AUTH_NOT_CONFIGURED' });
  } finally {
    setLocalAuth(false);
  }
  await context.close();
});

test('a local session cannot reach remote-only learning data', async ({ browser }) => {
  setLocalAuth(true);
  const context = await localContext(browser);
  await context.request.post('/api/auth/local');
  const response = await context.request.get('/api/learning-records');
  expect(response.status()).toBeGreaterThanOrEqual(400);
  await context.close();
});

test('configured UI: button signs in, survives reload, admin route is blocked, logout is clean', async ({ browser }) => {
  setLocalAuth(true);
  const context = await localContext(browser);
  const page = await context.newPage();
  await page.goto('/');
  await page.click('#landing-login');
  await expect(page.locator('#auth-local')).toBeVisible();
  await page.click('#auth-local');
  await expect(page.locator('.sidebar')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('paradox-session'))?.email)).toBe('local@paradox.test');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('paradox-session'))?.role)).toBe('user');
  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.goto('/#/admin');
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.click('#logout-button');
  await expect(page.locator('#landing-login')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('paradox-session'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('paradox-local-server'))).toBeNull();
  const session = await context.request.get('/api/auth/local');
  expect(await session.json()).toEqual({ available: true });
  await context.close();
});

test('unconfigured UI: button shows a clear message and never grants access', async ({ browser }) => {
  setLocalAuth(false);
  const context = await localContext(browser);
  const page = await context.newPage();
  await page.goto('/');
  await page.click('#landing-login');
  await expect(page.locator('#auth-local')).toBeVisible();
  await page.click('#auth-local');
  await expect(page.locator('#auth-error')).toContainText('LOCAL_AUTH_ENABLED=1');
  expect(await page.evaluate(() => localStorage.getItem('paradox-session'))).toBeNull();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await context.close();
});
