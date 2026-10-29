import { expect, test } from '@playwright/test';

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBMISSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function achievementSummary({ completed = 1, corrections = 0, streak = 1 } = {}) {
  const values = { 'first-session': completed, 'error-hunter': corrections, consistency: streak, 'critical-thinker': completed };
  const targets = { 'first-session': 1, 'error-hunter': 1, consistency: 7, 'critical-thinker': 10 };
  return {
    schemaVersion: 'paradox-achievement-summary-v1',
    source: { type: 'learning_records', authoritative: true },
    timeZone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-10-29T02:00:00.000Z',
    metrics: { validCompletedSessions: completed, successfulCorrectionSessions: corrections, distinctActivityDays: completed, currentStreak: streak, longestStreak: streak },
    achievements: Object.keys(targets).map(id => ({ id, current: values[id], target: targets[id], earned: values[id] >= targets[id], evidence: {} })),
  };
}

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
       }], achievementSummary: achievementSummary() }),
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

test('successful correction refreshes backend achievements without F5 and survives reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('paradox-session', JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', name: 'Correction Learner', email: 'correction@example.com' }));
    window.PARADOX_LEARNING_RECORDS_CONFIG = { enabled: true, apiBaseUrl: '/api' };
  });
  const revisionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const recordActions = [];
  const recordRequests = [];
  const debateModes = [];
  const debateContexts = [];
  let completed = false;

  await page.route('**/api/learning-records*', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      recordActions.push(body.action);
      recordRequests.push(body);
      if (body.action === 'createSession') {
        await route.fulfill({
          status: 201, contentType: 'application/json', body: JSON.stringify({
            session: { id: SESSION_ID, title: 'Solve 2x = 8', subject: 'Algebra', problem: 'Solve 2x = 8', status: 'in_progress', startedAt: '2026-10-28T10:00:00.000Z' },
            submission: { id: SUBMISSION_ID, sessionId: SESSION_ID, attemptNumber: 1, type: 'initial', solution: 'x = 6', analysisState: 'pending_analysis' },
          }),
        });
      } else {
        await route.fulfill({
          status: 201, contentType: 'application/json', body: JSON.stringify({
            submission: { id: revisionId, sessionId: SESSION_ID, attemptNumber: 2, type: 'revision', solution: 'x = 4', analysisState: 'pending_analysis' },
          }),
        });
      }
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [{
          id: SESSION_ID,
          title: 'Solve 2x = 8',
          subject: 'Algebra',
          status: completed ? 'completed' : 'in_progress',
          latestAnalysisStatus: completed ? 'correct' : 'incorrect',
          latestEvaluationStatus: completed ? 'pass' : null,
          latestScore: completed ? 100 : null,
          startedAt: '2026-10-28T10:00:00.000Z',
          completedAt: completed ? '2026-10-28T10:05:00.000Z' : null,
          durationSeconds: completed ? 300 : 60,
          updatedAt: '2026-10-28T10:05:00.000Z',
        }],
        achievementSummary: achievementSummary({ completed: completed ? 1 : 0, corrections: completed ? 1 : 0, streak: completed ? 1 : 0 }),
      }),
    });
  });
  await page.route('**/api/debate', async route => {
    const body = route.request().postDataJSON();
    debateModes.push(body.mode);
    debateContexts.push(body.learningRecord);
    let analysis;
    if (body.mode === 'analyze') {
      analysis = { status: 'incorrect', summary: 'x = 6 is incorrect.', confidence: 0.98, issues: [{ category: 'knowledge', step: 'division', explanation: 'Divide by 2.', suggestion: 'Try the inverse operation.' }], strengths: [], nextQuestion: 'What is 8 / 2?', reply: '', hint: null };
    } else if (body.mode === 'hint') {
      analysis = { status: 'incorrect', summary: 'Use division.', confidence: 0.98, issues: [], strengths: [], nextQuestion: '', reply: 'Divide both sides.', hint: { level: 1, content: 'Divide both sides by 2.' } };
    } else if (body.mode === 'discuss') {
      analysis = { status: 'incorrect', summary: 'Division isolates x.', confidence: 0.98, issues: [], strengths: [], nextQuestion: '', reply: 'Because 2 is the coefficient of x.', hint: null };
    } else {
      completed = true;
      analysis = {
        status: 'correct', summary: 'The revision is correct.', confidence: 0.99, issues: [], strengths: ['Correct inverse operation.'], nextQuestion: '', reply: '', hint: null,
        comparison: { summary: 'Corrected division.', improvements: ['x is now 4.'], remainingIssues: [] },
        evaluation: { status: 'pass', score: 100, criteria: { knowledgeAccuracy: {}, reasoningLogic: {}, solutionCompleteness: {}, errorRemediation: {} } },
      };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analysis }) });
  });

  await page.goto('/#/audit');
  await page.fill('#problem-text', 'Solve 2x = 8');
  await page.fill('#work-text', 'x = 6');
  await page.locator('#start-audit').click();
  await expect(page.locator('[data-request-hint]')).toBeVisible();
  await page.locator('[data-request-hint]').click();
  await expect(page.locator('.hint-level-tag')).toBeVisible();
  await page.fill('#chat-message', 'Why divide by 2?');
  await page.locator('#chat-message').press('Enter');
  await expect(page.locator('#messages')).toContainText('Because 2 is the coefficient of x.');
  await page.fill('#work-text', 'x = 4');
  await page.locator('[data-resubmit]').click();
  await expect(page.locator('.debate-result')).toContainText('The revision is correct.');

  await page.goto('/#/profile');
  await expect(page.locator('[data-achievement-status="earned"]')).toHaveCount(2);
  await expect(page.locator('.achievement-tile').filter({ hasText: 'Người tự sửa lỗi' })).toHaveAttribute('data-achievement-status', 'earned');
  expect(recordActions).toEqual(['createSession', 'createSubmission']);
  expect(recordRequests[0]).toMatchObject({ initialSolution: 'x = 6' });
  expect(recordRequests[1]).toMatchObject({ sessionId: SESSION_ID, solution: 'x = 4' });
  expect(debateModes).toEqual(['analyze', 'hint', 'discuss', 'resubmit']);
  expect(debateContexts).toEqual([
    { sessionId: SESSION_ID, submissionId: SUBMISSION_ID },
    { sessionId: SESSION_ID, submissionId: SUBMISSION_ID },
    { sessionId: SESSION_ID, submissionId: SUBMISSION_ID },
    { sessionId: SESSION_ID, submissionId: revisionId },
  ]);

  await page.reload();
  await expect(page.locator('[data-achievement-status="earned"]')).toHaveCount(2);
  await expect(page.locator('.achievement-tile').filter({ hasText: 'Người tự sửa lỗi' })).toHaveAttribute('data-achievement-status', 'earned');
});

test('failed Resubmit preserves the revision and retries the same submission safely', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('paradox-session', JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', name: 'Retry Learner', email: 'retry@example.com' }));
    window.PARADOX_LEARNING_RECORDS_CONFIG = { enabled: true, apiBaseUrl: '/api' };
  });
  const revisionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  let revisionCreates = 0;
  let resubmitCalls = 0;
  const resubmitContexts = [];
  const resubmitAttempts = [];

  await page.route('**/api/learning-records*', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.action === 'createSession') {
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
          session: { id: SESSION_ID, title: 'Solve 2x = 8', subject: 'Algebra', problem: 'Solve 2x = 8', status: 'in_progress', startedAt: '2026-10-28T10:00:00.000Z' },
          submission: { id: SUBMISSION_ID, sessionId: SESSION_ID, attemptNumber: 1, type: 'initial', solution: 'x = 6', analysisState: 'pending_analysis' },
        }) });
      } else {
        revisionCreates += 1;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
          submission: { id: revisionId, sessionId: SESSION_ID, attemptNumber: 2, type: 'revision', solution: 'x = 4', analysisState: 'pending_analysis' },
        }) });
      }
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      sessions: [{ id: SESSION_ID, title: 'Solve 2x = 8', subject: 'Algebra', status: 'in_progress', latestAnalysisStatus: 'incorrect', startedAt: '2026-10-28T10:00:00.000Z', durationSeconds: 60 }],
      achievementSummary: achievementSummary({ completed: 0, corrections: 0, streak: 0 }),
    }) });
  });
  await page.route('**/api/debate', async route => {
    const body = route.request().postDataJSON();
    if (body.mode === 'analyze') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analysis: {
        status: 'incorrect', summary: 'x = 6 is incorrect.', confidence: 0.98, issues: [{ category: 'knowledge' }], strengths: [], nextQuestion: '', reply: '', hint: null,
      } }) });
      return;
    }
    resubmitCalls += 1;
    resubmitContexts.push(body.learningRecord);
    resubmitAttempts.push(body.attemptNumber);
    if (resubmitCalls === 1) {
      await route.fulfill({ status: 502, contentType: 'application/json', headers: { 'X-AI-Request-Id': 'persist-request-1' }, body: JSON.stringify({
        error: 'AI analysis is temporarily unavailable', code: 'LEARNING_RECORD_DATABASE_ERROR', requestId: 'persist-request-1',
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analysis: {
      status: 'correct', summary: 'The revision is correct.', confidence: 0.99, issues: [], strengths: [], nextQuestion: '', reply: '', hint: null,
      comparison: { summary: 'Corrected.', improvements: ['Fixed division.'], remainingIssues: [] },
      evaluation: { status: 'pass', score: 100, criteria: { knowledgeAccuracy: {}, reasoningLogic: {}, solutionCompleteness: {}, errorRemediation: {} } },
    } }) });
  });

  await page.goto('/#/audit');
  await page.fill('#problem-text', 'Solve 2x = 8');
  await page.fill('#work-text', 'x = 6');
  await page.locator('#start-audit').click();
  await expect(page.locator('[data-resubmit]')).toBeVisible();
  await page.fill('#work-text', 'x = 4');
  await page.locator('[data-resubmit]').click();
  await expect(page.locator('.message-error')).toBeVisible();
  await expect(page.locator('#work-text')).toHaveValue('x = 4');

  await page.reload();
  await expect(page.locator('#work-text')).toHaveValue('x = 4');
  await expect(page.locator('[data-resubmit]')).toBeVisible();
  await page.locator('[data-resubmit]').click();
  await expect(page.locator('.debate-result')).toContainText('The revision is correct.');
  expect(revisionCreates).toBe(1);
  expect(resubmitContexts).toEqual([
    { sessionId: SESSION_ID, submissionId: revisionId },
    { sessionId: SESSION_ID, submissionId: revisionId },
  ]);
  expect(resubmitAttempts).toEqual([2, 2]);
});
