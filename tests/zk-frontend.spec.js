import { expect, test } from '@playwright/test';

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const PROOF_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const REVOKED_PROOF_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVALUATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test.describe.configure({ mode: 'serial' });

let serverProcess;
let baseURL;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  for (let index = 0; index < 50; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('ZK frontend test server did not start');
}

test.beforeAll(async () => {
  const port = await freePort();
  serverProcess = spawn(process.execPath, ['tests/static-server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      VERCEL: '',
      LOCAL_AUTH_ENABLED: '1',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    },
    stdio: 'ignore',
  });
  baseURL = `http://127.0.0.1:${port}`;
  await waitForServer(baseURL);
});

test.afterAll(async () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

function proof(overrides = {}) {
  return {
    proofId: PROOF_ID,
    threshold: 80,
    circuit: { name: 'score_threshold', version: '1.0.0', vkeySha256: 'cc'.repeat(32) },
    credential: { idHash: `0x${'aa'.repeat(32)}`, evidenceHash: `0x${'bb'.repeat(32)}` },
    issuerKeyId: 'demo-issuer',
    issuedAt: '2026-11-05T00:00:00.000Z',
    status: 'active',
    classification: 'DEMO',
    ...overrides,
  };
}

async function mockApi(page, { statusFailFirst = false, generated = true } = {}) {
  let statusCalls = 0;
  await page.route('**/api/zk/status', async route => {
    statusCalls += 1;
    if (statusFailFirst && statusCalls === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ready: false, code: 'ZK_KEY_CONFIG_MISSING' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready: true, setupMode: 'development', circuitVersion: '1.0.0', allowedThresholds: [80] }) });
  });
  await page.route(/\/api\/zk\/proofs(\?.*)?$/, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proofs: [proof(), proof({ proofId: REVOKED_PROOF_ID, status: 'revoked', classification: 'DEMO' })] }) });
  });
  await page.route('**/api/zk/verify', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true, reason: 'OK', classification: 'DEMO', credentialStatus: 'VALID', checks: { proof: true } }) });
  });
  await page.route('**/api/zk/generate', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proofId: PROOF_ID, status: generated ? 'generated' : 'existing', classification: 'DEMO', credentialStatus: 'VALID', issuerKeyId: 'demo-issuer' }) });
  });
  await page.route(/\/api\/learning-records\?view=evaluations.*/, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ evaluations: [{ id: EVALUATION_ID, score: 88, status: 'pass', rubricVersion: '1.0.0' }] }) });
  });
}

async function openZk(browser) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.addInitScript(() => { globalThis.PARADOX_LEARNING_RECORDS_CONFIG = { enabled: true, apiBaseUrl: '/api' }; });
  await page.goto('/');
  await page.click('#landing-login');
  await expect(page.locator('#auth-local')).toBeVisible();
  await page.click('#auth-local');
  await expect(page.locator('.sidebar')).toBeVisible();
  return { context, page };
}

test('ZK view shows eligibility, proofs, DEMO badge, verify and generate results', async ({ browser }) => {
  const { context, page } = await openZk(browser);
  await mockApi(page);
  await page.goto('/#/zk');
  await expect(page.getByRole('heading', { name: 'ZK status' })).toBeVisible();
  await expect(page.getByText('DEMO').first()).toBeVisible();
  await expect(page.getByText(EVALUATION_ID)).toBeVisible();
  await expect(page.getByText(PROOF_ID)).toBeVisible();
  await expect(page.getByText('revoked')).toBeVisible();

  const proofList = page.locator('.zk-card', { hasText: 'My proofs' }).locator('.credential-list');
  await expect(proofList).not.toContainText('witness');
  await expect(proofList).not.toContainText('nonce');
  await expect(proofList).not.toContainText('"score"');

  await page.locator(`[data-zk-verify="${PROOF_ID}"]`).click();
  await expect(page.getByText('"valid":true')).toBeVisible();
  await expect(page.getByText('"classification":"DEMO"')).toBeVisible();

  await page.locator(`[data-zk-generate="${EVALUATION_ID}"]`).click();
  await expect(page.getByText('"status":"generated"')).toBeVisible();
  await context.close();
});

test('ZK view shows error and retries status', async ({ browser }) => {
  const { context, page } = await openZk(browser);
  await mockApi(page, { statusFailFirst: true });
  await page.goto('/#/zk');
  await expect(page.getByText('ZK_KEY_CONFIG_MISSING')).toBeVisible();
  await page.locator('[data-zk-status]').click();
  await expect(page.getByText('"ready":true')).toBeVisible();
  await context.close();
});

test('ZK view marks non-owner public verification as DEMO without score fields', async ({ browser }) => {
  const { context, page } = await openZk(browser);
  await mockApi(page);
  await page.goto('/#/zk');
  await page.locator(`[data-zk-verify="${PROOF_ID}"]`).click();
  await expect(page.getByText('"valid":true')).toBeVisible();
  const resultCard = page.locator('.zk-card', { hasText: 'Verify proof' });
  await expect(resultCard).not.toContainText('score');
  await expect(resultCard).not.toContainText('nonce');
  await expect(resultCard).not.toContainText('witness');
  await context.close();
});
