import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { AVALANCHE_FUJI_CONFIG } from '../avalanche-config.js';
import {
  createCredentialDraftFromAiEvaluation,
  getAvalancheExplorerUrl,
  getCredentialDisplayStatus,
  isAvalancheTransactionHash,
} from '../learning-passport-service.js';

const SESSION = { id: 'learner-passport-test', name: 'Passport Learner', email: 'passport@example.com' };
const validTransactionHash = `0x${'ab'.repeat(32)}`;

function seedSession(page) {
  return page.addInitScript(user => localStorage.setItem('paradox-session', JSON.stringify(user)), SESSION);
}

async function highImpactViolations(page) {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.filter(item => ['critical', 'serious'].includes(item.impact));
}

test('Learning Passport guards verified status and maps AI proof records without blockchain writes', () => {
  const claimedWithoutProof = { status: 'verified', transactionHash: validTransactionHash, network: 'avalanche-fuji', verification: { source: 'mock', checked: false, valid: false } };
  expect(getCredentialDisplayStatus(claimedWithoutProof)).toBe('unverified');

  const verified = {
    ...claimedWithoutProof,
    source: 'avalanche',
    chainId: AVALANCHE_FUJI_CONFIG.chainId,
    contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress,
    issueTransactionHash: validTransactionHash,
    transactionStatus: 'confirmed',
    verification: { source: 'avalanche', checked: true, valid: true, exists: true },
  };
  expect(getCredentialDisplayStatus(verified)).toBe('verified');
  expect(isAvalancheTransactionHash(validTransactionHash)).toBe(true);
  expect(getAvalancheExplorerUrl(verified)).toContain(validTransactionHash);
  expect(getAvalancheExplorerUrl({ ...verified, transactionHash: 'invalid' })).toBeNull();

  const draft = createCredentialDraftFromAiEvaluation({ learnerId: 'learner-1', sessionId: 'session-1', proofRecord: { contentHash: 'a'.repeat(64), score: 88, rubricVersion: 'paradox-rubric-v1', model: 'test-model' } });
  expect(draft).toMatchObject({ status: 'unverified', assessmentScore: 88, transactionHash: null, network: null });
});

test('Learning Passport presents labelled mock data, credential details, and safe verification states', async ({ page }) => {
  await seedSession(page);
  await page.goto('/#/passport');

  await expect(page.locator('.passport-data-notice')).toContainText('DỮ LIỆU MẪU');
  await expect(page.locator('.passport-identity h2')).toHaveText(SESSION.name);
  await expect(page.locator('.passport-skill')).toHaveCount(4);
  await expect(page.locator('.credential-row')).toHaveCount(3);
  await expect(page.locator('.credential-status.verified')).toHaveCount(0);

  await page.locator('[data-certificate-details]').first().click();
  await expect(page.locator('#passport-detail-modal')).toBeVisible();
  await expect(page.locator('.passport-detail-panel')).toContainText('PXP-2026-ALG-0001');
  await expect(page.locator('.passport-detail-panel .credential-status.pending')).toBeVisible();
  expect(await highImpactViolations(page)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.locator('#passport-detail-modal')).toBeHidden();
  await expect(page.locator('[data-certificate-details]').first()).toBeFocused();
  await page.locator('[data-certificate-details]').first().click();
  await page.locator('[data-verify-certificate]').click();
  await expect(page).toHaveURL(/#\/verify$/);
  await expect(page.locator('#passport-verification-result')).toBeVisible();
  await expect(page.locator('[data-verification-state="demo"]')).toContainText('DEMO');
  await expect(page.locator('.explorer-button')).toHaveCount(0);

  await page.fill('#passport-code', 'PXP-2026-REM-0002');
  await page.locator('#passport-verify-form').getByRole('button', { name: 'Tra cứu' }).click();
  await expect(page.locator('[data-verification-state="demo"]')).toBeVisible();
  await expect(page.locator('.explorer-button')).toHaveCount(0);
  await expect(page.locator('.credential-status.verified')).toHaveCount(0);

  await page.fill('#passport-code', 'PXP-2026-NOT-9999');
  await page.locator('#passport-verify-form').getByRole('button', { name: 'Tra cứu' }).click();
  await expect(page.locator('[data-verification-state="not-found"]')).toContainText('Không tìm thấy chứng nhận');
});

test('Learning Passport and verification views are responsive and accessible on mobile', async ({ page }) => {
  await seedSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['passport', 'verify']) {
    await page.goto(`/#/${route}`);
    await expect(page.locator('.page')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    expect(await highImpactViolations(page), `axe violations on mobile ${route}`).toEqual([]);
  }
});

test('Learning Passport loads persisted Fuji status and verifies through the credential API', async ({ page }) => {
  await seedSession(page);
  await page.addInitScript(() => {
    window.PARADOX_LEARNING_PASSPORT_CONFIG = { mode: 'api', apiBaseUrl: '/api' };
  });
  const credential = {
    id: 'credential-live-1', code: 'PXP-TEST-2026-0001', name: 'Clearly labelled test credential', skill: 'TEST ONLY',
    issuedAt: '2026-10-28', issuer: '0x2222222222222222222222222222222222222222', assessmentScore: 90,
    status: 'verified', source: 'avalanche', isTest: true, evidenceHash: `sha256:${'ab'.repeat(32)}`,
    transactionHash: validTransactionHash, issueTransactionHash: validTransactionHash, network: 'avalanche-fuji', chainId: 43113,
    contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress, transactionStatus: 'confirmed',
    verification: { checked: true, valid: true, exists: true, source: 'avalanche', checkedAt: '2026-10-28T00:00:00.000Z' },
  };
  const passport = {
    schemaVersion: 'paradox-learning-passport-v1', passportId: 'PLP-LIVE-TEST',
    source: { type: 'avalanche', isReal: true, label: 'AVALANCHE FUJI', network: 'avalanche-fuji', chainId: 43113 },
    learner: { id: SESSION.id, displayName: SESSION.name, email: SESSION.email, level: 'Proof of Learning', cohort: 'Avalanche Fuji' },
    summary: { overallScore: 0, progress: 0, completedAssessments: 0, learningHours: null },
    skills: [], assessments: [], credentials: [credential],
  };
  let verifyRequest;
  await page.route('**/api/credentials*', async route => {
    if (route.request().method() === 'POST') verifyRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().method() === 'POST' ? { credential } : { passport }),
    });
  });

  await page.goto('/#/passport');
  await expect(page.locator('.passport-data-notice.live')).toContainText('FUJI TESTNET');
  await expect(page.locator('.credential-row')).toContainText('CHỨNG NHẬN KIỂM THỬ');
  await expect(page.locator('.credential-status.verified')).toBeVisible();

  await page.locator('[data-certificate-details]').click();
  await page.locator('[data-verify-certificate]').click();
  await expect(page.locator('#passport-verification-result')).toBeVisible();
  await expect(page.locator('.passport-data-notice.live')).toBeVisible();
  await expect(page.locator('[data-verification-state="valid"]')).toContainText('VERIFIED ON AVALANCHE');
  await expect(page.locator('a.explorer-button')).toHaveAttribute('href', new RegExp(`explorer-test\\.avax\\.network/c-chain/tx/${validTransactionHash}`));
  expect(verifyRequest).toEqual({ action: 'verify', credentialCode: 'PXP-TEST-2026-0001' });
});

test('Verify distinguishes checking, not found, unissued, and network error with keyboard-safe retry', async ({ page }) => {
  await seedSession(page);
  await page.addInitScript(() => {
    window.PARADOX_LEARNING_PASSPORT_CONFIG = { mode: 'api', apiBaseUrl: '/api' };
  });
  let requestCount = 0;
  let networkAttempts = 0;
  const unissuedCredential = code => ({
    id: `credential-${code}`, code, name: 'Stored but not issued', skill: 'Reasoning', issuedAt: null,
    issuer: null, assessmentScore: null, status: 'unverified', source: 'avalanche', isTest: false,
    evidenceHash: `sha256:${'cd'.repeat(32)}`, transactionHash: null, issueTransactionHash: null,
    network: AVALANCHE_FUJI_CONFIG.network, chainId: AVALANCHE_FUJI_CONFIG.chainId,
    contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress, transactionStatus: 'failed',
    verification: { checked: true, valid: false, exists: false, revoked: false, source: 'avalanche', checkedAt: '2026-10-29T00:00:00.000Z' },
  });
  await page.route('**/api/credentials*', async route => {
    requestCount += 1;
    const body = route.request().postDataJSON();
    expect(body.action).toBe('verify');
    if (body.credentialCode === 'PXP-2026-MISSING-0001') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Credential was not found', code: 'CREDENTIAL_NOT_FOUND' }) });
      return;
    }
    if (body.credentialCode === 'PXP-2026-NETWORK-0001' && networkAttempts++ === 0) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Unable to connect to Avalanche Fuji', code: 'AVALANCHE_RPC_UNAVAILABLE' }) });
      return;
    }
    if (body.credentialCode === 'PXP-2026-CHECK-0001') await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ credential: unissuedCredential(body.credentialCode) }) });
  });

  await page.goto('/#/verify');
  const input = page.locator('#passport-code');
  await input.fill('invalid');
  await page.locator('#passport-verify-form button[type="submit"]').click();
  await expect(input).toBeFocused();
  expect(await input.evaluate(element => element.checkValidity())).toBe(false);
  expect(requestCount).toBe(0);

  await input.fill('PXP-2026-CHECK-0001');
  await input.press('Enter');
  await expect(page.locator('[data-verification-state="checking"]')).toBeVisible();
  await expect(page.locator('[data-verification-state="unissued"]')).toContainText('CHƯA PHÁT HÀNH');
  await expect(page.locator('.explorer-button')).toHaveCount(0);

  await input.fill('PXP-2026-MISSING-0001');
  await input.press('Enter');
  await expect(page.locator('[data-verification-state="not-found"]')).toBeFocused();

  await input.fill('PXP-2026-NETWORK-0001');
  await input.press('Enter');
  const error = page.locator('[data-verification-state="network-error"]');
  await expect(error).toBeVisible();
  await error.locator('[data-retry-verification]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-verification-state="unissued"]')).toBeVisible();
  expect(networkAttempts).toBe(2);
});

test('About guide publishes Fuji metadata, feature boundaries, and responsive verification instructions', async ({ page }) => {
  await seedSession(page);
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ user: SESSION }),
  }));
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/#/about');

  await expect(page.locator('.about-intro')).toContainText('AI hỗ trợ người học tự phát hiện và sửa lỗi');
  await expect(page.locator('.feature-status.active')).toContainText('ACTIVE');
  await expect(page.locator('.feature-status.developing')).toContainText('DEVELOPING');
  await expect(page.locator('.feature-status.demo')).toContainText('DEMO');
  await expect(page.locator('.avalanche-guide')).toContainText(AVALANCHE_FUJI_CONFIG.contractAddress);
  await expect(page.locator('.avalanche-guide')).toContainText(String(AVALANCHE_FUJI_CONFIG.chainId));
  await expect(page.locator('.avalanche-metadata a').first()).toHaveAttribute('href', new RegExp('explorer-test\\.avax\\.network'));
  await expect(page.locator('.public-verify-guide li')).toHaveCount(4);
  expect(await highImpactViolations(page)).toEqual([]);

  const verifyButton = page.locator('.about-intro [data-route="verify"]');
  await verifyButton.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/verify$/);
  await expect(page.locator('#passport-code')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/about');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(await highImpactViolations(page)).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
