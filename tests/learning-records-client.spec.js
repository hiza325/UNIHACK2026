import { expect, test } from '@playwright/test';

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBMISSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('Audit creates a durable learning record context and reloads backend history', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('paradox-session', JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', name: 'Record Learner', email: 'records@example.com' }));
    window.PARADOX_LEARNING_RECORDS_CONFIG = { enabled: true, apiBaseUrl: '/api' };
  });
  let createRequest;
  let debateRequest;
  await page.route('**/api/learning-records*', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      createRequest = request.postDataJSON();
      await route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          session: { id: SESSION_ID, title: 'Solve 2x = 8', subject: 'Thinking', problem: 'Solve 2x = 8', status: 'in_progress', startedAt: '2026-10-28T10:00:00.000Z', durationSeconds: 0 },
          submission: { id: SUBMISSION_ID, sessionId: SESSION_ID, attemptNumber: 1, type: 'initial', solution: 'x = 4', analysisState: 'pending_analysis' },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sessions: [{
        id: SESSION_ID, title: 'Solve 2x = 8', subject: 'Thinking', status: 'completed',
        latestAnalysisStatus: 'correct', latestEvaluationStatus: null, latestScore: null,
        startedAt: '2026-10-28T10:00:00.000Z', completedAt: '2026-10-28T10:01:00.000Z', durationSeconds: 60,
      }] }),
    });
  });
  await page.route('**/api/debate', async route => {
    debateRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ analysis: { status: 'correct', summary: 'Correct solution.', confidence: 0.96, issues: [], strengths: ['Clear reasoning.'], nextQuestion: '', reply: '', hint: null, comparison: null, evaluation: null } }),
    });
  });

  await page.goto('/#/audit');
  await page.fill('#problem-text', 'Solve 2x = 8');
  await page.fill('#work-text', 'x = 4');
  await page.locator('#start-audit').click();
  await expect(page.locator('.debate-result')).toBeVisible();
  expect(createRequest).toMatchObject({ action: 'createSession', problem: 'Solve 2x = 8', initialSolution: 'x = 4' });
  expect(debateRequest.learningRecord).toEqual({ sessionId: SESSION_ID, submissionId: SUBMISSION_ID });

  await page.reload();
  await expect(page.locator('#problem-text')).toHaveValue('Solve 2x = 8');
  await expect(page.locator('#work-text')).toHaveValue('x = 4');
  await page.locator('.sidebar [data-route="history"]').click();
  await expect(page.locator('.session-row')).toContainText('Solve 2x = 8');
});

test('remote Audit does not bypass durable persistence when record creation fails', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('paradox-session', JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', name: 'Record Learner', email: 'records@example.com' }));
    window.PARADOX_LEARNING_RECORDS_CONFIG = { enabled: true, apiBaseUrl: '/api' };
  });
  let debateCalls = 0;
  await page.route('**/api/learning-records*', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Learning record database is unavailable', code: 'LEARNING_RECORD_DATABASE_UNAVAILABLE' }),
  }));
  await page.route('**/api/debate', route => {
    debateCalls += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/#/audit');
  await page.fill('#problem-text', 'Solve 2x = 8');
  await page.fill('#work-text', 'x = 4');
  await page.locator('#start-audit').click();
  await expect(page.locator('#start-audit')).toBeEnabled();
  await expect(page.locator('.message-error')).toBeVisible();
  expect(debateCalls).toBe(0);
});
