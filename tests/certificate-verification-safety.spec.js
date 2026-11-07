import { test, expect } from '@playwright/test';
import { handlePublicVerify } from '../api/credentials/_public-verify.js';
import { AVALANCHE_FUJI_CONFIG } from '../avalanche-config.js';
import { hasActualAvalancheVerification, getCredentialVerificationState } from '../learning-passport-service.js';
import { createCredentialsHandler } from '../api/credentials/index.js';

const code = 'PXP-2026-SAFETY-001';
const hash = `0x${'ab'.repeat(32)}`;
const valid = { exists: true, valid: true, revoked: false, evidenceHash: hash, issuedAt: 1700000000 };
let sequence = 0;
async function verify(row, chain, input = code, dbError = false) {
  let payload, status;
  const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { payload = value; } };
  await handlePublicVerify({ method: 'GET', query: { code: input }, headers: {}, socket: { remoteAddress: `fixture-${++sequence}` } }, res, {
    storeFactory: () => ({ findByCode: async () => { if (dbError) throw new Error('offline'); return row; } }),
    avalancheFactory: async (options) => {
      expect(options).toEqual({ write: false });
      return { verifyCredential: async () => { if (chain instanceof Error) throw chain; return chain; } };
    },
  });
  return { status, payload };
}

test('public verification distinguishes pending, missing, RPC failure and database failure', async () => {
  expect((await verify({ blockchain_status: 'pending' }, { exists: false })).payload.status).toBe('PENDING');
  expect((await verify(null, { exists: false })).status).toBe(404);
  expect((await verify(null, new Error('offline'))).payload.status).toBe('UNAVAILABLE');
  expect((await verify(null, { exists: false }, code, true)).payload.status).toBe('UNAVAILABLE');
  expect((await verify(null, valid, code, true)).payload.status).toBe('VALID');
});

test('demo cannot become valid even with a valid chain fixture', async () => {
  expect((await verify(null, valid, 'DEMO-TEST-001')).payload.status).toBe('DEMO');
  expect((await verify({ source: 'demo' }, valid)).payload.status).toBe('DEMO');
  const credential = { status: 'verified', source: 'avalanche', network: AVALANCHE_FUJI_CONFIG.network, chainId: 43113, contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress, transactionStatus: 'confirmed', issueTransactionHash: hash, transactionHash: hash, verification: { source: 'avalanche', checked: true, valid: true, exists: true } };
  expect(hasActualAvalancheVerification(credential)).toBe(true);
  for (const override of [{ isDemo: true }, { demo: true }, { code: 'DEMO-TEST-001' }, { verification: { ...credential.verification, revoked: true } }]) {
    expect(hasActualAvalancheVerification({ ...credential, ...override })).toBe(false);
  }
  expect(getCredentialVerificationState({ ...credential, status: 'pending', transactionStatus: 'pending', verification: { ...credential.verification, valid: false, exists: false } })).toBe('pending');
});

test('public projection excludes personal data and rejects malformed transaction hashes', async () => {
  const { payload } = await verify({ recipient_name: 'PRIVATE', learner_id: 'PRIVATE', snapshot: { email: 'PRIVATE' }, issue_tx_hash: 'javascript:alert(1)' }, valid);
  expect(JSON.stringify(payload)).not.toContain('PRIVATE');
  expect(payload.transactionHash).toBeNull();
  expect(payload.explorerUrl).toBeNull();
  expect((await verify(null, { ...valid, revoked: true })).payload.status).toBe('REVOKED');
});

for (const status of ['VALID', 'PENDING', 'REVOKED', 'NOT_FOUND', 'UNAVAILABLE', 'DEMO']) {
  test(`public QR destination displays ${status} safely`, async ({ page }) => {
    await page.route('**/api/verify?**', route => route.fulfill({ json: { status, chainId: 43113, contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress, onChain: valid, transactionHash: hash, explorerUrl: 'javascript:alert(1)' } }));
    await page.goto(`/verify.html?code=${code}`);
    await expect(page.locator('.status')).toHaveText(status);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    if (status === 'DEMO') await expect(page.locator('a')).toHaveCount(0);
    else await expect(page.locator('a')).toHaveAttribute('href', `${AVALANCHE_FUJI_CONFIG.explorerBaseUrl}/tx/${hash}`);
  });
}

test('missing chain proof and injected status never render as verified or HTML', async ({ page }) => {
  await page.route('**/api/verify?**', route => route.fulfill({ json: { status: 'VALID', message: 'Verified on Avalanche' } }));
  await page.goto(`/verify.html?code=${code}`);
  await expect(page.locator('.status')).toHaveText('UNAVAILABLE');
  await page.unroute('**/api/verify?**');
  await page.route('**/api/verify?**', route => route.fulfill({ json: { status: '<img src=x onerror=alert(1)>' } }));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('UNAVAILABLE');
  await expect(page.locator('#result img')).toHaveCount(0);
});

test('invalid QR code and network failures are explicit', async ({ page }) => {
  await page.route('**/api/verify?**', route => route.abort());
  await page.goto('/verify.html?code=%3Cinvalid%3E');
  await expect(page.locator('.status')).toHaveText('INVALID_INPUT');
  await page.getByLabel('Certificate ID').fill(code);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('UNAVAILABLE');
});

test('QR API rejects invalid codes before generating an image', async () => {
  let status, payload;
  await createCredentialsHandler()({ method: 'GET', query: { public: 'qr', code: '<invalid>' }, headers: {} }, {
    setHeader() {}, status(value) { status = value; return this; }, json(value) { payload = value; },
  });
  expect(status).toBe(400);
  expect(payload.code).toBe('INVALID_CERTIFICATE_CODE');
  expect(payload.dataUrl).toBeUndefined();
});

test('API fixture reaches public verification UI without exposing personal data', async ({ page }) => {
  const response = await verify({ title: 'Reasoning', recipient_name_snapshot: 'PRIVATE', issue_tx_hash: hash }, valid);
  await page.route('**/api/verify?**', route => route.fulfill({ status: response.status, json: response.payload }));
  await page.goto(`/verify.html?code=${code}`);
  await expect(page.locator('.status')).toHaveText('VALID');
  await expect(page.locator('#result')).not.toContainText('PRIVATE');
  await expect(page.locator('#result')).toContainText(hash);
});

test('malformed JSON and timed out requests fail closed', async ({ page }) => {
  await page.route('**/api/verify?**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Bad gateway</h1>' }));
  await page.goto(`/verify.html?code=${code}`);
  await expect(page.locator('.status')).toHaveText('UNAVAILABLE');
  await page.unroute('**/api/verify?**');
  await page.clock.install();
  await page.route('**/api/verify?**', () => {});
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.clock.fastForward(30001);
  await expect(page.locator('.status')).toHaveText('UNAVAILABLE');
});

test('late response cannot overwrite a newer lookup', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/verify?**', async route => {
    if (route.request().url().includes('FIRST')) await gate;
    await route.fulfill({ json: { status: route.request().url().includes('FIRST') ? 'NOT_FOUND' : 'DEMO' } });
  });
  await page.goto('/verify.html');
  await page.getByLabel('Certificate ID').fill('PXP-FIRST-001');
  const first = page.waitForRequest('**/*FIRST*');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await first;
  await page.getByLabel('Certificate ID').fill('DEMO-TEST-001');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('DEMO');
  const done = page.waitForResponse('**/*FIRST*');
  release();
  await done;
  await expect(page.locator('.status')).toHaveText('DEMO');
});
