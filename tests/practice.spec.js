/*
 * Practice Lab backend contract.
 *
 * These tests exercise the real handler and the real local SQLite store
 * (node:sqlite). No browser storage and no client-side answer key are involved:
 * the only source of truth is the server-side challenge definition.
 *
 * The Supabase/Postgres path is covered by the same handler/store interfaces
 * but cannot be executed here because this workspace has no Supabase
 * credentials. It is therefore reported as NOT VERIFIED, never as passing.
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createPracticeHandler } from '../api/practice/_handler.js';
import { createPracticeLocalStore } from '../api/practice/_local-store.js';

process.env.NODE_ENV = 'test';
process.env.VERCEL = '';
process.env.LOCAL_AUTH_ENABLED = '';
const { createStaticServer } = await import('./static-server.mjs');

const LEARNER_A = '11111111-1111-4111-8111-111111111111';
const LEARNER_B = '22222222-2222-4222-8222-222222222222';
const correctOptionFor = slug => (slug === 'chain-rule' ? 1 : 0);

function response() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function makeHandler(learnerId, dbPath) {
  return createPracticeHandler({
    sessionResolver: async () => ({ user: { id: learnerId }, learnerId, source: 'local' }),
    storeFactory: () => createPracticeLocalStore({ path: dbPath }),
  });
}

async function call(handler, { method = 'GET', lang = 'vi', body } = {}) {
  const req = { method, query: { lang }, headers: {}, body };
  const res = response();
  await handler(req, res);
  return res;
}

function submitBody(slug, selectedOption, clientAttemptId = randomUUID()) {
  return { action: 'submitAttempt', challengeSlug: slug, selectedOption, clientAttemptId, lang: 'vi' };
}

test.describe('practice api (real sqlite store)', () => {
  test('GET returns localized challenges without answers and zero progress', async () => {
    const handler = makeHandler(LEARNER_A, join('.data', `practice-api-${randomUUID()}.sqlite`));
    const res = await call(handler, { lang: 'en' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.payload.source).toMatchObject({ type: 'practice', authoritative: true });
    expect(res.payload.challenges).toHaveLength(6);
    expect(res.payload.challenges.map(item => item.slug)).toEqual([
      'chain-rule', 'simplify-expression', 'python-reverse-list', 'necessary-sufficient', 'basic-probability', 'average-speed',
    ]);
    expect(res.payload.challenges[0]).toMatchObject({ subjectKey: 'calculus', subject: 'Calculus', title: 'Chain rule', minutes: 3 });
    for (const challenge of res.payload.challenges) {
      expect(challenge.options.length).toBeGreaterThan(1);
      expect(challenge).not.toHaveProperty('correctOption');
      expect(challenge).not.toHaveProperty('explanation');
      expect(challenge).not.toHaveProperty('answer');
    }
    expect(res.payload.progress).toMatchObject({
      totalChallenges: 6, solvedChallenges: 0, totalAttempts: 0, correctAttempts: 0, accuracy: null,
    });
  });

  test('POST scores on the server, reveals the explanation only after submit, and dedupes retries', async () => {
    const handler = makeHandler(LEARNER_A, join('.data', `practice-api-${randomUUID()}.sqlite`));
    const clientAttemptId = randomUUID();

    const first = await call(handler, { method: 'POST', body: submitBody('chain-rule', 1, clientAttemptId) });
    expect(first.statusCode).toBe(201);
    expect(first.payload.attempt).toMatchObject({
      challengeSlug: 'chain-rule', selectedOption: 1, isCorrect: true, correctOption: 1,
    });
    expect(first.payload.attempt.explanation).toContain('24x');
    expect(first.payload.progress).toMatchObject({ solvedChallenges: 1, totalAttempts: 1, correctAttempts: 1, accuracy: 100 });

    const retry = await call(handler, { method: 'POST', body: submitBody('chain-rule', 1, clientAttemptId) });
    expect(retry.statusCode).toBe(200);
    expect(retry.payload.duplicate).toBe(true);
    expect(retry.payload.progress.totalAttempts).toBe(1);

    // Reusing an attempt id for a different challenge must not disclose that
    // challenge's answer key.
    const replay = await call(handler, { method: 'POST', body: submitBody('simplify-expression', 0, clientAttemptId) });
    expect(replay.statusCode).toBe(409);
    expect(replay.payload.code).toBe('PRACTICE_ATTEMPT_CONFLICT');
    expect(replay.payload).not.toHaveProperty('attempt');

    const wrong = await call(handler, { method: 'POST', body: submitBody('simplify-expression', 3) });
    expect(wrong.statusCode).toBe(201);
    expect(wrong.payload.attempt).toMatchObject({ isCorrect: false, correctOption: 0 });
    expect(wrong.payload.progress).toMatchObject({ solvedChallenges: 1, totalAttempts: 2, correctAttempts: 1, accuracy: 50 });

    const overview = await call(handler, { lang: 'vi' });
    expect(overview.payload.progress).toMatchObject({ solvedChallenges: 1, totalAttempts: 2 });
    expect(overview.payload.progress.solvedChallengeSlugs).toEqual(['chain-rule']);
    expect(overview.payload.challenges.every(item => !('correctOption' in item))).toBe(true);
  });

  test('POST rejects invalid input without recording an attempt', async () => {
    const handler = makeHandler(LEARNER_A, join('.data', `practice-api-${randomUUID()}.sqlite`));

    const cases = [
      [{ ...submitBody('chain-rule', 1), action: 'deleteEverything' }, 400, 'INVALID_PRACTICE_ACTION'],
      [submitBody('chain-rule', 8), 400, 'INVALID_PRACTICE_OPTION'],
      [submitBody('chain-rule', -1), 400, 'INVALID_PRACTICE_OPTION'],
      [submitBody('chain-rule', 1.5), 400, 'INVALID_PRACTICE_OPTION'],
      [submitBody('chain-rule', 4), 400, 'INVALID_PRACTICE_OPTION'],
      [submitBody('chain-rule', 1, 'not-a-uuid'), 400, 'INVALID_PRACTICE_ATTEMPT_ID'],
      [submitBody('unknown-challenge', 0), 404, 'PRACTICE_CHALLENGE_NOT_FOUND'],
      [submitBody('CHAIN-RULE', 0), 400, 'INVALID_PRACTICE_CHALLENGE'],
    ];
    for (const [body, status, code] of cases) {
      const res = await call(handler, { method: 'POST', body });
      expect(res.statusCode, JSON.stringify(body)).toBe(status);
      expect(res.payload.code).toBe(code);
    }

    const overview = await call(handler);
    expect(overview.payload.progress.totalAttempts).toBe(0);
  });

  test('attempts are isolated per learner, including identical client attempt ids', async () => {
    const dbPath = join('.data', `practice-api-${randomUUID()}.sqlite`);
    const handlerA = makeHandler(LEARNER_A, dbPath);
    const handlerB = makeHandler(LEARNER_B, dbPath);
    const sharedAttemptId = randomUUID();

    const resultA = await call(handlerA, { method: 'POST', body: submitBody('chain-rule', 1, sharedAttemptId) });
    expect(resultA.statusCode).toBe(201);
    expect(resultA.payload.progress.solvedChallenges).toBe(1);

    const overviewB = await call(handlerB, { lang: 'en' });
    expect(overviewB.payload.progress).toMatchObject({ solvedChallenges: 0, totalAttempts: 0 });

    const resultB = await call(handlerB, { method: 'POST', body: submitBody('chain-rule', 0, sharedAttemptId) });
    expect(resultB.statusCode).toBe(201);
    expect(resultB.payload.duplicate).toBe(false);
    expect(resultB.payload.attempt.isCorrect).toBe(false);

    const overviewA = await call(handlerA);
    expect(overviewA.payload.progress).toMatchObject({ solvedChallenges: 1, totalAttempts: 1 });
  });

  test('unknown actions and methods are rejected with safe codes', async () => {
    const handler = makeHandler(LEARNER_A, join('.data', `practice-api-${randomUUID()}.sqlite`));
    const put = await call(handler, { method: 'PUT' });
    expect(put.statusCode).toBe(405);
    expect(put.headers.Allow).toBe('GET, POST');

    const missing = await call(handler, { method: 'POST' });
    expect(missing.statusCode).toBe(400);
    expect(missing.payload.code).toBe('INVALID_PRACTICE_ACTION');
  });
});

test.describe('practice api with local auth', () => {
  test.describe.configure({ mode: 'serial' });

  let server;
  let baseURL;

  test.beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.VERCEL = '';
    process.env.LOCAL_AUTH_ENABLED = '1';
    process.env.LOCAL_AUTH_SECRET = 'practice-e2e-secret';
    process.env.LOCAL_AUTH_EMAIL = `practice-${randomUUID().slice(0, 8)}@paradox.test`;
    process.env.PRACTICE_LOCAL_DB_PATH = join('.data', `practice-e2e-${randomUUID()}.sqlite`);
    server = createStaticServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(async () => {
    process.env.LOCAL_AUTH_ENABLED = '';
    process.env.LOCAL_AUTH_SECRET = '';
    process.env.LOCAL_AUTH_EMAIL = '';
    process.env.PRACTICE_LOCAL_DB_PATH = '';
    await new Promise(resolve => server.close(resolve));
  });

  test('progress follows the stable local learner across a fresh sign-in', async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    const signIn = await context.request.post('/api/auth/local');
    expect(signIn.status()).toBe(200);

    const anonymous = await browser.newContext({ baseURL });
    const denied = await anonymous.request.get('/api/practice');
    expect(denied.status()).toBe(401);
    expect((await denied.json()).code).toBe('SESSION_INVALID');
    await anonymous.close();

    const overview = await context.request.get('/api/practice?lang=en');
    expect(overview.status()).toBe(200);
    const data = await overview.json();
    expect(data.challenges[0]).toMatchObject({ slug: 'chain-rule', subject: 'Calculus' });

    const attemptId = randomUUID();
    const submitted = await context.request.post('/api/practice', {
      data: { action: 'submitAttempt', challengeSlug: 'chain-rule', selectedOption: 1, clientAttemptId: attemptId, lang: 'en' },
    });
    expect(submitted.status()).toBe(201);
    expect((await submitted.json()).attempt.isCorrect).toBe(true);

    await context.request.delete('/api/auth/local');
    const relogin = await context.request.post('/api/auth/local');
    expect(relogin.status()).toBe(200);
    const afterRelogin = await context.request.get('/api/practice?lang=en');
    const afterData = await afterRelogin.json();
    expect(afterData.progress).toMatchObject({ solvedChallenges: 1, totalAttempts: 1, correctAttempts: 1 });
    expect(afterData.progress.solvedChallengeSlugs).toEqual(['chain-rule']);
    await context.close();
  });

  test('the Practice page reads and writes the real backend, and reload keeps progress', async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto('/');
    await page.click('#landing-login');
    await expect(page.locator('#auth-local')).toBeVisible();
    await page.click('#auth-local');
    await expect(page.locator('.sidebar')).toBeVisible();

    await page.goto('/#/practice');
    const practicePage = page.locator('.practice-page[data-practice-state="ready"]');
    await expect(practicePage).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.challenge-card')).toHaveCount(6);
    await expect(page.locator('.practice-daily .eyebrow')).toContainText('Thử thách hôm nay');
    await expect(page.locator('.practice-page')).not.toContainText('dữ liệu minh họa');

    const card = page.locator('.challenge-card').filter({ hasText: 'Rút gọn biểu thức' });
    await expect(card).not.toHaveClass(/solved/);
    await card.locator('button[data-challenge="simplify-expression"]').click();
    await expect(page.locator('#practice-modal')).toBeVisible();
    await page.locator('#practice-modal [data-option="0"]').click();
    await expect(page.locator('#practice-modal .practice-result.ok')).toBeVisible({ timeout: 10000 });
    await expect(card).toHaveClass(/solved/);
    await expect(page.locator('.practice-count')).toContainText('2 / 6');
    await page.locator('[data-close-practice]').last().click();

    await page.reload();
    await expect(page.locator('.practice-page[data-practice-state="ready"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.challenge-card').filter({ hasText: 'Rút gọn biểu thức' })).toHaveClass(/solved/);
    await expect(page.locator('.practice-count')).toContainText('2 / 6');
    await context.close();
  });

  test('the Practice page shows an error with retry, and an explicit empty state', async ({ browser }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto('/');
    await page.click('#landing-login');
    await expect(page.locator('#auth-local')).toBeVisible();
    await page.click('#auth-local');
    await expect(page.locator('.sidebar')).toBeVisible();

    let fail = true;
    await page.route('**/api/practice*', async route => {
      if (fail) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Practice database is unavailable', code: 'PRACTICE_DATABASE_UNAVAILABLE' }) });
        return;
      }
      await route.continue();
    });

    await page.goto('/#/practice');
    await expect(page.locator('.practice-page[data-practice-state="error"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.data-state-panel.error')).toContainText('Practice database is unavailable');
    fail = false;
    await page.locator('[data-retry-practice-load]').click();
    await expect(page.locator('.practice-page[data-practice-state="ready"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.challenge-card')).toHaveCount(6);

    await page.unroute('**/api/practice*');
    await page.route('**/api/practice*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ schemaVersion: 'paradox-practice-v1', challenges: [], progress: null }),
      });
    });
    await page.reload();
    await expect(page.locator('.practice-page[data-practice-state="empty"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.data-state-panel.empty')).toContainText('Chưa có thử thách');
    await context.close();
  });
});
