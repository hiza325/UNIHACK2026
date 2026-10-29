import { expect, test } from '@playwright/test';
import { AVALANCHE_FUJI_CONFIG } from '../avalanche-config.js';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Real Data Learner',
  email: 'real-data@example.com',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const ACTIVE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPLETE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUBMISSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TX_HASH = `0x${'ab'.repeat(32)}`;

function configureRemoteData(page) {
  return page.addInitScript(user => {
    localStorage.setItem('paradox-session', JSON.stringify(user));
    window.PARADOX_LEARNING_RECORDS_CONFIG = { enabled: true, apiBaseUrl: '/api' };
    window.PARADOX_LEARNING_PASSPORT_CONFIG = { mode: 'api', apiBaseUrl: '/api' };
  }, USER);
}

function emptyPassport() {
  return {
    schemaVersion: 'paradox-learning-passport-v1',
    passportId: 'PLP-EMPTY-REAL',
    source: { type: 'avalanche', isReal: true, label: 'AVALANCHE FUJI', network: 'avalanche-fuji', chainId: 43113 },
    learner: { id: USER.id, displayName: USER.name, email: USER.email, level: 'Proof of Learning', cohort: 'Avalanche Fuji' },
    summary: { overallScore: null, progress: null, completedAssessments: 0, learningHours: null },
    skills: [], assessments: [], credentials: [],
  };
}

function realCredential() {
  return {
    id: 'credential-real-1', code: 'PXP-2026-REAL-0001', name: 'Issued reasoning credential', skill: 'Logical reasoning',
    issuedAt: '2026-10-28', issuer: '0x2222222222222222222222222222222222222222', assessmentScore: 91,
    status: 'verified', source: 'avalanche', isTest: false, evidenceHash: `sha256:${'cd'.repeat(32)}`,
    transactionHash: TX_HASH, issueTransactionHash: TX_HASH, network: 'avalanche-fuji', chainId: 43113,
    contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress,
    transactionStatus: 'confirmed', verification: { checked: true, valid: true, exists: true, source: 'avalanche', checkedAt: '2026-10-28T00:00:00.000Z' },
  };
}

function livePassport() {
  const credential = realCredential();
  return {
    ...emptyPassport(), passportId: 'PLP-REAL-DATA',
    summary: { overallScore: 91, progress: 100, completedAssessments: 1, learningHours: null },
    skills: [{ id: 'reasoning', name: 'Logical reasoning', description: 'Verified from stored evidence.', score: 91, progress: 100, achieved: true, evidenceCount: 1, lastAssessedAt: '2026-10-28', source: 'avalanche' }],
    assessments: [{ id: 'assessment-1', name: 'Reasoning assessment', skill: 'Logical reasoning', score: 91, completedAt: '2026-10-28', evaluationStatus: 'pass', source: 'avalanche' }],
    credentials: [credential],
  };
}

function realSessions() {
  return [
    {
      id: ACTIVE_ID, title: 'Resume this exact session', subject: 'Algebra', status: 'in_progress',
      latestAnalysisStatus: 'incorrect', latestEvaluationStatus: null, latestScore: null,
      startedAt: '2026-10-29T01:00:00.000Z', completedAt: null, durationSeconds: 120, updatedAt: '2026-10-29T01:02:00.000Z',
    },
    {
      id: COMPLETE_ID, title: 'Completed stored session', subject: 'Logic', status: 'completed',
      latestAnalysisStatus: 'correct', latestEvaluationStatus: 'pass', latestScore: 91,
      startedAt: '2026-10-28T01:00:00.000Z', completedAt: '2026-10-28T01:10:00.000Z', durationSeconds: 600, updatedAt: '2026-10-28T01:10:00.000Z',
    },
  ];
}

async function mockRemoteApis(page, { sessions = [], passport = emptyPassport(), status = 200 } = {}) {
  await page.route('**/api/learning-records*', async route => {
    if (status !== 200) {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'Database unavailable', code: 'LEARNING_RECORD_DATABASE_UNAVAILABLE' }) });
      return;
    }
    const url = new URL(route.request().url());
    if (url.searchParams.get('id')) {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ session: {
          ...sessions.find(item => item.id === url.searchParams.get('id')),
          problem: 'Solve the stored equation 3x = 12',
          submissions: [{ id: SUBMISSION_ID, sessionId: ACTIVE_ID, attemptNumber: 1, type: 'initial', solution: 'x = 5', analysisState: 'analyzed', analysis: { status: 'incorrect', summary: 'Stored analysis' }, submittedAt: '2026-10-29T01:00:00.000Z', analysisCompletedAt: '2026-10-29T01:01:00.000Z' }],
          interactions: [], evaluations: [],
        } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions }) });
  });
  await page.route('**/api/credentials*', route => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(status === 200 ? { passport } : { error: 'Credential database unavailable', code: 'CREDENTIAL_DATABASE_NOT_CONFIGURED' }),
  }));
}

test('Loading state is visible while real Dashboard sources are pending', async ({ page }) => {
  await configureRemoteData(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/learning-records*', async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }) });
  });
  await page.route('**/api/credentials*', async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ passport: emptyPassport() }) });
  });

  await page.goto('/#/dashboard');
  await expect(page.locator('[data-dashboard-state="loading"]')).toBeVisible();
  await expect(page.locator('.dashboard-stats')).toHaveCount(0);
  release();
  await expect(page.locator('[data-dashboard-state="empty"]')).toBeVisible();
});

test('a new account shows Empty and never receives a fabricated continue session', async ({ page }) => {
  await configureRemoteData(page);
  await mockRemoteApis(page);
  await page.goto('/#/dashboard');

  await expect(page.locator('[data-dashboard-state="empty"]')).toBeVisible();
  await expect(page.locator('[data-continue-state="empty"]')).toContainText('Tạo phiên học đầu tiên');
  await expect(page.locator('[data-continue-state="real"]')).toHaveCount(0);
  await expect(page.locator('.dashboard-stats')).toHaveCount(0);

  await page.goto('/#/profile');
  await expect(page.locator('[data-achievement-page-state="empty"]')).toBeVisible();
  await expect(page.locator('.achievement-tile')).toHaveCount(0);
});

test('API failures render Error with retry instead of zeroes or empty conclusions', async ({ page }) => {
  await configureRemoteData(page);
  let failing = true;
  await page.route('**/api/learning-records*', route => route.fulfill({
    status: failing ? 503 : 200, contentType: 'application/json',
    body: JSON.stringify(failing ? { error: 'Unavailable', code: 'LEARNING_RECORD_DATABASE_UNAVAILABLE' } : { sessions: [] }),
  }));
  await page.route('**/api/credentials*', route => route.fulfill({
    status: failing ? 503 : 200, contentType: 'application/json',
    body: JSON.stringify(failing ? { error: 'Unavailable', code: 'CREDENTIAL_DATABASE_NOT_CONFIGURED' } : { passport: emptyPassport() }),
  }));
  await page.goto('/#/dashboard');

  await expect(page.locator('[data-dashboard-state="error"]')).toBeVisible();
  await expect(page.locator('.dashboard-stats')).toHaveCount(0);
  await expect(page.locator('[data-retry-learning-data]')).toBeVisible();

  failing = false;
  await page.locator('[data-retry-learning-data]').click();
  await expect(page.locator('[data-dashboard-state="empty"]')).toBeVisible();
});

test('Real state uses stored metrics, resumes the selected session, and separates issued credentials', async ({ page }) => {
  await configureRemoteData(page);
  const sessions = realSessions();
  await mockRemoteApis(page, { sessions, passport: livePassport() });
  await page.goto('/#/dashboard');

  await expect(page.locator('[data-dashboard-state="real"]')).toBeVisible();
  await expect(page.locator('.data-source-badge.real')).toContainText('DỮ LIỆU THẬT');
  await expect(page.locator('[data-continue-state="real"] h2')).toHaveText('Resume this exact session');
  await expect(page.locator('section[aria-label="Chứng nhận đã phát hành: 1"]')).toBeVisible();
  await expect(page.locator('section[aria-label="Tỷ lệ hoàn thành: 50%"]')).toBeVisible();
  await expect(page.locator('.session-score .score-unavailable').first()).toBeVisible();
  await expect(page.locator('.date-chip')).toHaveAttribute('title', /Asia\/Ho_Chi_Minh/);

  await page.locator('[data-resume-session]').first().click();
  await expect(page).toHaveURL(/#\/audit$/);
  await expect(page.locator('#problem-text')).toHaveValue('Solve the stored equation 3x = 12');
  await expect(page.locator('#work-text')).toHaveValue('x = 5');

  await page.goto('/#/profile');
  await expect(page.locator('[data-achievement-page-state="real"]')).toBeVisible();
  await expect(page.locator('[data-achievement-status="earned"]')).toHaveCount(1);
  await expect(page.locator('[data-achievement-status="unavailable"]')).toHaveCount(1);
  await expect(page.locator('[data-credential-state="issued"]')).toContainText('PXP-2026-REAL-0001');
  await expect(page.locator('[data-credential-state="issued"] .credential-status.verified')).toBeVisible();
});

test('Demo state remains available for tests but is visibly labelled and isolated', async ({ page }) => {
  await page.addInitScript(({ user, sessionsKey }) => {
    localStorage.setItem('paradox-session', JSON.stringify(user));
    localStorage.setItem(sessionsKey, JSON.stringify([{
      id: 'demo-session-1', title: 'Browser-only demo session', skill: 'Demo subject', status: 'completed', recordStatus: 'completed',
      score: 88, selfDetected: true, startedAt: '2026-10-28T01:00:00.000Z', completedAt: '2026-10-28T01:05:00.000Z', isoDate: '2026-10-28', minutes: 5,
    }]));
  }, { user: USER, sessionsKey: `paradox-user:${encodeURIComponent(USER.email)}:audit-sessions` });
  await page.goto('/#/dashboard');

  await expect(page.locator('[data-dashboard-state="demo"]')).toBeVisible();
  await expect(page.locator('.data-source-badge.demo')).toContainText('DEMO');
  await expect(page.locator('.dashboard-page')).toContainText('Browser-only demo session');

  await page.goto('/#/practice');
  await expect(page.locator('[data-practice-state="demo"] .data-source-badge.demo')).toBeVisible();
});
