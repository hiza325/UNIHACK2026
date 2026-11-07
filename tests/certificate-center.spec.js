import { test, expect } from '@playwright/test';

const HASH = '0x' + '12'.repeat(32);
const CODE = 'PXP-CENTER-2026-001';
async function setup(page, options = {}) {
  await page.goto('/verify.html');
  await page.evaluate(async ({ options, HASH, CODE }) => {
    const { certificateIssuanceMethods } = await import('/certificate-issuance-actions.js');
    const { adminViews } = await import('/views/admin.js');
    const { eventMethods } = await import('/app-events.js');
    sessionStorage.clear();
    window.calls = [];
    const wallet = { address: '0xa906c19de177ccdac0b092560fcda7296165c396', chainId: 43113, authorized: true };
    window.ethereum = { request: async ({ method }) => {
      calls.push(method);
      if (method === 'eth_chainId') return options.wrongChain ? '0x1' : '0xa869';
      if (method === 'eth_accounts') return [wallet.address];
      if (method === 'eth_sendTransaction') {
        if (options.reject) throw Object.assign(new Error('User rejected'), { code: 4001 });
        if (options.unknown) throw new Error('Wallet connection lost');
        return HASH;
      }
    } };
    const ci = { status: 'prepared', learnerId: 'learner', evaluationId: 'evaluation', credentialCode: CODE, title: 'Critical reasoning', prepared: { credential: { code: CODE }, unsignedTransaction: { to: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b', data: '0x1234' } }, busy: false, txHash: null };
    window.app = Object.assign({
      user: { id: 'admin-1', role: options.student ? 'student' : 'admin' }, certificateWallet: { ...wallet, authorized: !options.unauthorized }, certificateIssuance: ci,
      escape: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      t: key => key, showToast(message) { window.toast = message; }, loadLearningPassportSnapshot() {},
      querySelector: selector => document.querySelector(selector),
      render() { document.body.innerHTML = '<main class="admin-shell">' + this.viewCertificateIssuance() + '</main>'; },
    }, certificateIssuanceMethods, adminViews, eventMethods);
    document.addEventListener('click', event => app.onClick(event));
    window.fetch = async (url, init = {}) => {
      if (String(url).startsWith('/api/verify?')) {
        calls.push('onchain-preflight');
        return new Response(JSON.stringify(options.onchainExisting ? { status: 'VALID', onChain: { exists: true } } : { status: 'PENDING', transactionVerification: 'NOT_PROVIDED' }));
      }
      calls.push(init.body ? JSON.parse(init.body).action : 'lookup');
      if (init.body && JSON.parse(init.body).action === 'confirm-issue') {
        if (options.timeout) throw new DOMException('Timed out', 'TimeoutError');
        return new Response(JSON.stringify({ status: options.failed ? 'failed' : 'confirmed', credential: { code: CODE }, error: options.failed ? 'Transaction reverted' : undefined }));
      }
      if (init.body && JSON.parse(init.body).action === 'prepare-issue') return new Response(JSON.stringify({ error: 'Already issued' }), { status: 409 });
      return new Response(JSON.stringify({ credential: { code: CODE, transactionStatus: options.existing ? 'confirmed' : 'pending', issueTransactionHash: options.existing ? HASH : null } }));
    };
    app.render();
  }, { options, HASH, CODE });
}

test('students cannot render or invoke issuance; unauthorized admin cannot prepare or send', async ({ page }) => {
  await setup(page, { student: true });
  await page.evaluate(async () => { await app.confirmCertificateIssuance(); await app.prepareCertificateIssuance(); });
  expect(await page.evaluate(() => calls)).toEqual([]);
  await expect(page.locator('[data-cert-confirm]')).toHaveCount(0);
  await setup(page, { unauthorized: true });
  await expect(page.locator('[data-cert-confirm]')).toBeDisabled();
  await page.evaluate(async () => { await app.confirmCertificateIssuance(); await app.prepareCertificateIssuance(); });
  expect(await page.evaluate(() => calls)).toEqual([]);
});

for (const [name, options, status, sends] of [
  ['confirmed', {}, 'confirmed', 1],
  ['network timeout after broadcast', { timeout: true }, 'pending', 1],
  ['failed receipt', { failed: true }, 'failed', 1],
  ['wallet rejection', { reject: true }, 'prepared', 1],
  ['ambiguous wallet outcome', { unknown: true }, 'recovery-required', 1],
  ['duplicate in backend', { existing: true }, 'pending', 0],
  ['duplicate on-chain', { onchainExisting: true }, 'recovery-required', 0],
  ['wrong network', { wrongChain: true }, 'prepared', 0],
]) test(name, async ({ page }) => {
  await setup(page, options);
  await page.evaluate(() => app.confirmCertificateIssuance());
  expect(await page.evaluate(() => app.certificateIssuance.status)).toBe(status);
  expect(await page.evaluate(() => calls.filter(c => c === 'eth_sendTransaction').length)).toBe(sends);
  if (!options.reject && !options.wrongChain) {
    await page.evaluate(() => app.confirmCertificateIssuance());
    expect(await page.evaluate(() => calls.filter(c => c === 'eth_sendTransaction').length)).toBe(sends);
  }
});

test('double click is locked before asynchronous wallet checks', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => Promise.all([app.confirmCertificateIssuance(), app.confirmCertificateIssuance()]));
  expect(await page.evaluate(() => calls.filter(c => c === 'eth_sendTransaction').length)).toBe(1);
  await expect(page.locator('.certificate-history')).toContainText(CODE);
});

test('admin controls use existing event handlers and fit mobile/desktop', async ({ page }, testInfo) => {
  await setup(page);
  for (const css of ['/styles.css', '/views.css', '/dashboard.css', '/admin-silver.css']) await page.addStyleTag({ url: css });
  await page.addStyleTag({ content: 'body{max-width:none;margin:0;padding:16px}.admin-shell{--dash-text:#202024;--dash-muted:#606069;--dash-card:#f8f7f4;--admin-border:#a18b6266;--admin-control:#f6f4ef}' });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`certificate-center-admin-${width}.png`), fullPage: true });
  }
  await page.locator('[data-cert-confirm]').click();
  await expect.poll(() => page.evaluate(() => app.certificateIssuance.status)).toBe('confirmed');
  await expect(page.locator('[data-cert-confirm]')).toBeDisabled();
  await expect(page.locator('.certificate-history')).toContainText(CODE);
});

test('pending reload recovers existing hash and checks backend without signing', async ({ page }) => {
  await setup(page, { timeout: true });
  await page.evaluate(async () => {
    await app.confirmCertificateIssuance();
    calls.length = 0;
    app.certificateWallet = null;
    app.certificateIssuance = { status: 'idle' };
    app.restoreCertificateIssuance();
  });
  await expect.poll(() => page.evaluate(() => app.certificateIssuance.busy)).toBe(false);
  expect(await page.evaluate(() => app.certificateIssuance.txHash)).toBe(HASH);
  expect(await page.evaluate(() => calls)).toEqual(['lookup', 'onchain-preflight', 'confirm-issue']);
  await expect(page.locator('[data-cert-confirm]')).toBeDisabled();
  await page.evaluate(() => app.resetCertificateIssuance());
  expect(await page.evaluate(() => app.certificateIssuance.txHash)).toBe(HASH);
});

test('cached unsigned transaction is discarded and another account does not restore it', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { app.persistCertificateIssuance(); app.restoreCertificateIssuance(); });
  await expect.poll(() => page.evaluate(() => app.certificateIssuance.busy)).toBe(false);
  expect(await page.evaluate(() => app.certificateIssuance.prepared)).toBeNull();
  expect(await page.evaluate(() => calls)).not.toContain('eth_sendTransaction');
  await page.evaluate(() => { app.user.id = 'other'; app.certificateIssuance = { status: 'idle' }; app.restoreCertificateIssuance(); });
  expect(await page.evaluate(() => app.certificateIssuance)).toEqual({ status: 'idle' });
});

test('backend rejects duplicate prepare and no wallet operation is requested', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { app.certificateIssuance.status = 'idle'; });
  await page.evaluate(() => app.prepareCertificateIssuance());
  expect(await page.evaluate(() => app.certificateIssuance.error)).toBe('Already issued');
  expect(await page.evaluate(() => calls)).toEqual(['prepare-issue']);
});

test('student center counts real history without exposing issuance controls', async ({ page }) => {
  await setup(page, { student: true });
  await page.evaluate(async ({ CODE }) => {
    const { passportViews } = await import('/views/passport.js');
    Object.assign(app, passportViews, { lang: 'en', getLearningPassportSnapshot: () => ({ source: { isReal: true }, credentials: [{ code: CODE, name: 'Critical reasoning', status: 'pending', transactionStatus: 'pending' }] }), statCard: (label, value) => `<div>${label}: ${value}</div>`, passportDate: value => value });
    document.body.innerHTML = app.certificateCenterMarkup();
  }, { CODE });
  await expect(page.getByLabel('Certificate Center')).toContainText('Eligible — Awaiting Issuance');
  await expect(page.getByLabel('Certificate Center')).toContainText('My Certificates: 1');
  await expect(page.locator('a[href="#/admin"]')).toHaveCount(0);
  await expect(page.getByLabel('Certificate Center')).toContainText('Pending confirmation: 1');
});
