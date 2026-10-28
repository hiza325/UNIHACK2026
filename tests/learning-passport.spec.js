import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
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

  const verified = { ...claimedWithoutProof, verification: { source: 'avalanche', checked: true, valid: true } };
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

  await page.locator('[data-verify-certificate]').click();
  await expect(page).toHaveURL(/#\/verify$/);
  await expect(page.locator('#passport-verification-result')).toBeVisible();
  await expect(page.locator('.credential-status.pending')).toBeVisible();
  const explorer = page.locator('a.explorer-button');
  await expect(explorer).toBeVisible();
  await expect(explorer).toHaveAttribute('href', /subnets-test\.avax\.network\/c-chain\/tx\/0x[a-f0-9]{64}$/);

  await page.fill('#passport-code', 'PXP-2026-REM-0002');
  await page.locator('#passport-verify-form').getByRole('button', { name: 'Tra cứu' }).click();
  await expect(page.locator('.credential-status.unverified')).toBeVisible();
  await expect(page.locator('button.explorer-button')).toBeDisabled();
  await expect(page.locator('.credential-status.verified')).toHaveCount(0);

  await page.fill('#passport-code', 'PXP-2026-NOT-9999');
  await page.locator('#passport-verify-form').getByRole('button', { name: 'Tra cứu' }).click();
  await expect(page.locator('#passport-verify-empty')).toContainText('Không tìm thấy chứng nhận');
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
    verification: { checked: true, valid: true, source: 'avalanche', checkedAt: '2026-10-28T00:00:00.000Z' },
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
  await expect(page.locator('a.explorer-button')).toHaveAttribute('href', new RegExp(validTransactionHash));
  expect(verifyRequest).toEqual({ action: 'verify', credentialCode: 'PXP-TEST-2026-0001' });
});
