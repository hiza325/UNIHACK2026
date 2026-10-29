import { expect, test } from '@playwright/test';
import { createDebateHandler } from '../api/debate.js';
import { createLearningRecordService, deriveLearningAchievementSummary } from '../api/learning-records/_service.js';
import { createLearningRecordsHandler } from '../api/learning-records/index.js';
import { createLearningRecordStore } from '../api/learning-records/_store.js';
import { credentialIdFromCode } from '../api/credentials/_avalanche.js';

const LEARNER = { id: '11111111-1111-4111-8111-111111111111', name: 'Learner' };
const OTHER_LEARNER = { id: '22222222-2222-4222-8222-222222222222', name: 'Other' };

function createMemoryStore() {
  const sessions = [];
  const submissions = [];
  const interactions = [];
  const evaluations = [];
  let sessionIndex = 0;
  let submissionIndex = 0;
  let evaluationIndex = 0;
  const failures = { evaluation: 0, sessionUpdate: 0 };
  return {
    sessions, submissions, interactions, evaluations, failures,
    async insertSession(record) {
      sessionIndex += 1;
      const id = `${String(sessionIndex).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      const row = { id, started_at: '2026-10-28T10:00:00.000Z', created_at: '2026-10-28T10:00:00.000Z', updated_at: '2026-10-28T10:00:00.000Z', duration_seconds: 0, latest_score: null, ...record };
      sessions.push(row);
      return { ...row };
    },
    async updateSession(id, learnerId, patch) {
      if (failures.sessionUpdate > 0) {
        failures.sessionUpdate -= 1;
        throw Object.assign(new Error('Session update failed'), { code: 'LEARNING_RECORD_DATABASE_ERROR', status: 502 });
      }
      const row = sessions.find(item => item.id === id && item.learner_id === learnerId);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: '2026-10-28T10:05:00.000Z' });
      return { ...row };
    },
    async findSession(id, learnerId) { return sessions.find(item => item.id === id && item.learner_id === learnerId) || null; },
    async listSessions(learnerId) { return sessions.filter(item => item.learner_id === learnerId); },
    async insertSubmission(record) {
      submissionIndex += 1;
      const id = `${String(submissionIndex).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
      const row = { id, submitted_at: '2026-10-28T10:01:00.000Z', created_at: '2026-10-28T10:01:00.000Z', updated_at: '2026-10-28T10:01:00.000Z', ...record };
      submissions.push(row);
      return { ...row };
    },
    async updateSubmission(id, learnerId, patch) {
      const row = submissions.find(item => item.id === id && item.learner_id === learnerId);
      Object.assign(row, patch);
      return { ...row };
    },
    async findSubmission(id, sessionId, learnerId) { return submissions.find(item => item.id === id && item.session_id === sessionId && item.learner_id === learnerId) || null; },
    async listSubmissions(sessionId, learnerId) { return submissions.filter(item => item.session_id === sessionId && item.learner_id === learnerId).sort((a, b) => a.attempt_number - b.attempt_number); },
    async latestSubmission(sessionId, learnerId) { return (await this.listSubmissions(sessionId, learnerId)).at(-1) || null; },
    async insertInteractions(records) {
      const rows = records.map(record => ({ id: interactions.length + 1, created_at: '2026-10-28T10:02:00.000Z', ...record }));
      interactions.push(...rows);
      return rows;
    },
    async listInteractions(sessionId, learnerId) { return interactions.filter(item => item.session_id === sessionId && item.learner_id === learnerId); },
    async insertEvaluation(record) {
      if (failures.evaluation > 0) {
        failures.evaluation -= 1;
        throw Object.assign(new Error('Evaluation write failed'), { code: 'LEARNING_RECORD_DATABASE_ERROR', status: 502 });
      }
      if (evaluations.some(item => item.submission_id === record.submission_id)) throw Object.assign(new Error('Duplicate evaluation'), { code: 'LEARNING_RECORD_CONFLICT', status: 409 });
      evaluationIndex += 1;
      const row = { id: `${String(evaluationIndex).padStart(8, '0')}-cccc-4ccc-8ccc-cccccccccccc`, created_at: '2026-10-28T10:03:00.000Z', ...record };
      evaluations.push(row);
      return { ...row };
    },
    async listEvaluations(sessionId, learnerId) { return evaluations.filter(item => item.session_id === sessionId && item.learner_id === learnerId); },
    async listEligibleEvaluations(learnerId) { return evaluations.filter(item => item.learner_id === learnerId && item.credential_eligible); },
    async listAchievementSessions(learnerId) { return sessions.filter(item => item.learner_id === learnerId && item.status === 'completed'); },
    async listAchievementSubmissions(learnerId) { return submissions.filter(item => item.learner_id === learnerId && item.analysis_state === 'analyzed'); },
    async listAchievementEvaluations(learnerId) { return evaluations.filter(item => item.learner_id === learnerId && item.status === 'pass'); },
  };
}

function passingResult() {
  const criteria = Object.fromEntries(['knowledgeAccuracy', 'reasoningLogic', 'solutionCompleteness', 'errorRemediation'].map(key => [key, { score: 25, evidence: 'Validated server-side evidence.' }]));
  return {
    status: 'correct', summary: 'The revision is correct.', confidence: 0.95, issues: [], strengths: [], nextQuestion: '', reply: '', hint: null,
    comparison: { summary: 'Improved.', improvements: ['Fixed reasoning.'], remainingIssues: [] },
    evaluation: { rubricVersion: 'paradox-rubric-v1', evidenceSufficient: true, score: 100, status: 'pass', comment: 'Meets every criterion.', criteria, correctedIssues: ['Reasoning fixed.'], remainingIssues: [] },
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', rubricVersion: 'paradox-rubric-v1', contentHash: 'ab'.repeat(32), evidenceSufficient: true, status: 'pass', score: 100, model: 'test-model' },
  };
}

function apiResponse() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('learning records persist sessions, revisions, analysis and reloadable history', async () => {
  const store = createMemoryStore();
  const service = createLearningRecordService({ store, now: () => new Date('2026-10-28T10:05:00.000Z') });
  const created = await service.createSession({ problem: 'Solve 2x = 8', initialSolution: 'x = 6', subject: 'Algebra', status: 'completed', latestScore: 100 }, LEARNER);
  expect(created.session).toMatchObject({ status: 'in_progress', problem: 'Solve 2x = 8' });
  expect(created.submission).toMatchObject({ attemptNumber: 1, type: 'initial', analysisState: 'pending_analysis' });

  const initialInput = { mode: 'analyze', problem: 'Solve 2x = 8', solution: 'x = 6', question: '', hintLevel: 0 };
  const initialAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: created.submission.id, userId: LEARNER.id, input: initialInput });
  await service.recordAiResult({ authorized: initialAuthorization, input: initialInput, result: { status: 'incorrect', summary: 'Division is incorrect.', issues: [{ category: 'knowledge' }], strengths: [], reply: '' }, model: 'test-model' });

  const hintInput = { mode: 'hint', problem: 'Solve 2x = 8', solution: 'x = 6', question: 'Give me one hint.', hintLevel: 1 };
  const hintAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: created.submission.id, userId: LEARNER.id, input: hintInput });
  await service.recordAiResult({ authorized: hintAuthorization, input: hintInput, result: { status: 'incorrect', summary: 'Review division.', hint: { level: 1, content: 'Divide both sides by 2.' }, reply: '' }, model: 'test-model' });

  const discussionInput = { mode: 'discuss', problem: 'Solve 2x = 8', solution: 'x = 6', question: 'Why divide by 2?', hintLevel: 0 };
  const discussionAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: created.submission.id, userId: LEARNER.id, input: discussionInput });
  await service.recordAiResult({ authorized: discussionAuthorization, input: discussionInput, result: { status: 'incorrect', summary: 'Use the inverse operation.', reply: 'Division isolates x.' }, model: 'test-model' });

  const revision = await service.createSubmission({ sessionId: created.session.id, solution: 'x = 4', analysis: { status: 'correct' } }, LEARNER);
  expect(revision.attemptNumber).toBe(2);
  const revisionInput = { mode: 'resubmit', problem: 'Solve 2x = 8', solution: 'x = 4', question: '', hintLevel: 0 };
  const revisionAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input: revisionInput });
  await service.recordAiResult({ authorized: revisionAuthorization, input: revisionInput, result: passingResult(), model: 'test-model' });

  const reloadedService = createLearningRecordService({ store, now: () => new Date('2026-10-28T10:05:00.000Z') });
  const reloaded = await reloadedService.getSession(created.session.id, LEARNER);
  expect(reloaded).toMatchObject({ status: 'completed', latestEvaluationStatus: 'pass', latestScore: 100, durationSeconds: 300 });
  expect(reloaded.submissions).toHaveLength(2);
  expect(reloaded.submissions[0]).toMatchObject({ type: 'initial', solution: 'x = 6', analysisState: 'analyzed', analysis: { status: 'incorrect' } });
  expect(reloaded.submissions[1]).toMatchObject({ type: 'revision', solution: 'x = 4', analysisState: 'analyzed', analysis: { evaluation: { status: 'pass' } } });
  expect(reloaded.interactions).toHaveLength(6);
  expect(await service.listSessions(LEARNER)).toHaveLength(1);
  const achievements = await reloadedService.getAchievementSummary(LEARNER);
  expect(achievements.metrics).toMatchObject({ validCompletedSessions: 1, successfulCorrectionSessions: 1 });
  expect(achievements.achievements.filter(item => item.earned).map(item => item.id)).toEqual(['first-session', 'error-hunter']);
  await expect(service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input: revisionInput }))
    .resolves.toMatchObject({ storedAnalysis: { status: 'correct' }, persistenceRequired: false });
});

test('resubmit persistence retry reuses stored AI output without duplicate evaluation or interaction', async () => {
  const store = createMemoryStore();
  const service = createLearningRecordService({ store, now: () => new Date('2026-10-28T10:05:00.000Z') });
  const created = await service.createSession({ problem: 'Solve 2x = 8', initialSolution: 'x = 6' }, LEARNER);
  const initialInput = { mode: 'analyze', problem: 'Solve 2x = 8', solution: 'x = 6', question: '', hintLevel: 0 };
  const initialAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: created.submission.id, userId: LEARNER.id, input: initialInput });
  await service.recordAiResult({ authorized: initialAuthorization, input: initialInput, result: { status: 'incorrect', summary: 'Incorrect.', issues: [{ category: 'knowledge' }] }, model: 'test-model' });
  const revision = await service.createSubmission({ sessionId: created.session.id, solution: 'x = 4' }, LEARNER);
  const revisionInput = { mode: 'resubmit', problem: 'Solve 2x = 8', solution: 'x = 4', question: '', hintLevel: 0 };
  const authorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input: revisionInput });

  store.failures.evaluation = 1;
  await expect(service.recordAiResult({ authorized: authorization, input: revisionInput, result: passingResult(), model: 'test-model' }))
    .rejects.toMatchObject({ code: 'LEARNING_RECORD_DATABASE_ERROR', status: 502 });
  expect(store.submissions.find(item => item.id === revision.id)).toMatchObject({ analysis_state: 'analyzed', ai_analysis: { evaluation: { status: 'pass' } } });
  expect(store.evaluations).toHaveLength(0);

  const retryAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input: revisionInput });
  expect(retryAuthorization).toMatchObject({ storedAnalysis: { evaluation: { status: 'pass' } }, persistenceRequired: true });
  await service.recordAiResult({ authorized: retryAuthorization, input: revisionInput, result: retryAuthorization.storedAnalysis, model: 'test-model' });

  expect(store.submissions.filter(item => item.session_id === created.session.id)).toHaveLength(2);
  expect(store.interactions.filter(item => item.submission_id === revision.id && item.mode === 'analysis')).toHaveLength(1);
  expect(store.evaluations.filter(item => item.submission_id === revision.id)).toHaveLength(1);
  expect(store.sessions[0]).toMatchObject({ status: 'completed', latest_evaluation_status: 'pass' });
});

test('resubmit retry completes the session without duplicating an evaluation already persisted', async () => {
  const store = createMemoryStore();
  const service = createLearningRecordService({ store, now: () => new Date('2026-10-28T10:06:00.000Z') });
  const created = await service.createSession({ problem: 'Solve 2x = 8', initialSolution: 'x = 6' }, LEARNER);
  const revision = await service.createSubmission({ sessionId: created.session.id, solution: 'x = 4' }, LEARNER);
  const input = { mode: 'resubmit', problem: 'Solve 2x = 8', solution: 'x = 4', question: '', hintLevel: 0 };
  const authorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input });

  store.failures.sessionUpdate = 1;
  await expect(service.recordAiResult({ authorized: authorization, input, result: passingResult(), model: 'test-model' }))
    .rejects.toMatchObject({ code: 'LEARNING_RECORD_DATABASE_ERROR', status: 502 });
  expect(store.evaluations.filter(item => item.submission_id === revision.id)).toHaveLength(1);

  const retryAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input });
  await service.recordAiResult({ authorized: retryAuthorization, input, result: retryAuthorization.storedAnalysis, model: 'test-model' });

  expect(store.interactions.filter(item => item.submission_id === revision.id && item.mode === 'analysis')).toHaveLength(1);
  expect(store.evaluations.filter(item => item.submission_id === revision.id)).toHaveLength(1);
  expect(store.sessions[0]).toMatchObject({ status: 'completed', latest_evaluation_status: 'pass' });
});

test('Debate handler classifies database persistence failure after AI success without marking AI failure', async () => {
  let failureCalls = 0;
  const logs = [];
  const handler = createDebateHandler({
    analysisFactory: async () => ({ analysis: passingResult(), meta: { provider: 'gemini', attempts: 1 } }),
    sessionResolver: async () => ({ user: LEARNER }),
    storeFactory: () => ({}),
    recordServiceFactory: () => ({
      async authorizeAiRequest() { return { session: { id: 'session' }, submission: { id: 'submission' }, learnerId: LEARNER.id }; },
      async recordAiResult() { throw Object.assign(new Error('Database write failed'), { code: 'LEARNING_RECORD_DATABASE_ERROR', status: 502 }); },
      async recordAiFailure() { failureCalls += 1; },
    }),
    logger: { error(entry) { logs.push(entry); }, warn(entry) { logs.push(entry); }, log(entry) { logs.push(entry); } },
  });
  const response = apiResponse();
  await handler({
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.210' },
    body: {
      mode: 'resubmit', problem: 'Solve 2x = 8', solution: 'x = 4', previousSolution: 'x = 6',
      learningRecord: { sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    },
  }, response);

  expect(response.statusCode).toBe(502);
  expect(response.payload).toMatchObject({ code: 'LEARNING_RECORD_DATABASE_ERROR', requestId: expect.any(String) });
  expect(failureCalls).toBe(0);
  expect(logs.at(-1)).toMatchObject({ event: 'ai_debate_failed', phase: 'persist_learning_record', status: 502, code: 'LEARNING_RECORD_DATABASE_ERROR' });
});

test('Debate handler recovers stored analysis without another provider request', async () => {
  const storedAnalysis = passingResult();
  let providerCalls = 0;
  let persistenceCalls = 0;
  const handler = createDebateHandler({
    analysisFactory: async () => { providerCalls += 1; throw new Error('Provider must not be called'); },
    sessionResolver: async () => ({ user: LEARNER }),
    storeFactory: () => ({}),
    recordServiceFactory: () => ({
      async authorizeAiRequest() {
        return {
          session: { id: 'session' },
          submission: { id: 'submission', analysis_model: 'gemini/test' },
          learnerId: LEARNER.id,
          storedAnalysis,
          persistenceRequired: true,
        };
      },
      async recordAiResult({ result }) { persistenceCalls += 1; expect(result).toEqual(storedAnalysis); },
      async recordAiFailure() { throw new Error('must not mark stored analysis as failed'); },
    }),
    logger: null,
  });
  const response = apiResponse();
  await handler({
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.211' },
    body: {
      mode: 'resubmit', problem: 'Solve 2x = 8', solution: 'x = 4', previousSolution: 'x = 6',
      learningRecord: { sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    },
  }, response);

  expect(response.statusCode).toBe(200);
  expect(response.payload.analysis).toEqual(storedAnalysis);
  expect(providerCalls).toBe(0);
  expect(persistenceCalls).toBe(1);
});

test('learning record ownership is enforced and input cannot self-assign a passing evaluation or achievement', async () => {
  const store = createMemoryStore();
  const service = createLearningRecordService({ store });
  const created = await service.createSession({ problem: 'Explain a theorem', initialSolution: 'Unfinished proof', subject: 'Logic', latestEvaluationStatus: 'pass', latestScore: 100, status: 'completed', achievement: 'error-hunter' }, LEARNER);
  expect(store.sessions[0]).toMatchObject({ status: 'in_progress', latest_score: null });
  expect((await service.getAchievementSummary(LEARNER)).achievements.every(item => item.earned === false)).toBe(true);
  expect((await service.getAchievementSummary(OTHER_LEARNER)).metrics.validCompletedSessions).toBe(0);
  await expect(service.getSession(created.session.id, OTHER_LEARNER)).rejects.toMatchObject({ code: 'LEARNING_SESSION_NOT_FOUND', status: 404 });
  await expect(service.createSubmission({ sessionId: created.session.id, solution: 'Forged pass', status: 'pass', score: 100 }, OTHER_LEARNER)).rejects.toMatchObject({ code: 'LEARNING_SESSION_NOT_FOUND' });
});

test('learning-record API returns authoritative achievement projection and rejects fake unlock actions', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalAnonKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  const store = createMemoryStore();
  const service = createLearningRecordService({ store });
  try {
    await service.createSession({ problem: 'Explain a theorem', initialSolution: 'Unfinished proof' }, LEARNER);
    const handler = createLearningRecordsHandler({
      storeFactory: () => store,
      sessionResolver: async () => ({ user: { ...LEARNER, email: 'learner@example.com' } }),
    });
    const getResponse = apiResponse();
    await handler({ method: 'GET', query: {}, headers: {} }, getResponse);
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.payload).toMatchObject({
      sessions: [expect.objectContaining({ status: 'in_progress' })],
      achievementSummary: {
        schemaVersion: 'paradox-achievement-summary-v1',
        source: { type: 'learning_records', authoritative: true },
        metrics: { validCompletedSessions: 0, successfulCorrectionSessions: 0 },
      },
    });

    const fakeResponse = apiResponse();
    await handler({ method: 'POST', body: { action: 'unlockAchievement', achievement: 'error-hunter', earned: true }, headers: {} }, fakeResponse);
    expect(fakeResponse).toMatchObject({ statusCode: 400, payload: { code: 'INVALID_LEARNING_RECORD_ACTION' } });
    expect((await service.getAchievementSummary(LEARNER)).achievements.every(item => !item.earned)).toBe(true);
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = originalAnonKey;
  }
});

test('achievement store queries scope every evidence table to the authenticated learner', async () => {
  const urls = [];
  const store = createLearningRecordStore({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' },
    fetcher: async url => {
      urls.push(new URL(url));
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  await Promise.all([
    store.listAchievementSessions(LEARNER.id),
    store.listAchievementSubmissions(LEARNER.id),
    store.listAchievementEvaluations(LEARNER.id),
  ]);

  expect(urls).toHaveLength(3);
  for (const url of urls) expect(url.searchParams.get('learner_id')).toBe(`eq.${LEARNER.id}`);
  expect(urls.find(url => url.pathname.endsWith('/learning_sessions'))?.searchParams.get('status')).toBe('eq.completed');
  expect(urls.find(url => url.pathname.endsWith('/learning_submissions'))?.searchParams.get('analysis_state')).toBe('eq.analyzed');
  expect(urls.find(url => url.pathname.endsWith('/learning_evaluations'))?.searchParams.get('status')).toBe('eq.pass');
  expect(urls.find(url => url.pathname.endsWith('/learning_submissions'))?.searchParams.get('select')).not.toContain('solution_text');
});

test('server-derived evaluation prepares hashes but never fabricates blockchain verification', async () => {
  const store = createMemoryStore();
  const service = createLearningRecordService({ store, now: () => new Date('2026-10-28T10:05:00.000Z') });
  const created = await service.createSession({ problem: 'Solve 2x = 8', initialSolution: 'x = 6', subject: 'Algebra' }, LEARNER);
  const revision = await service.createSubmission({ sessionId: created.session.id, solution: 'x = 4' }, LEARNER);
  const input = { mode: 'resubmit', problem: 'Solve 2x = 8', solution: 'x = 4', question: '', hintLevel: 0 };
  const authorized = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input });
  const { evaluation } = await service.recordAiResult({ authorized, input, result: passingResult(), model: 'test-model' });

  expect(evaluation.credential).toMatchObject({ eligible: true, status: 'eligible', verificationStatus: 'unverified', transactionHash: null });
  expect(evaluation.credential.id).toMatch(/^PXP-2026-[A-F0-9]{8}-\d{4}$/);
  expect(evaluation.credential.idHash).toBe(credentialIdFromCode(evaluation.credential.id));
  expect(evaluation.credential.hash).toBe(`0x${'ab'.repeat(32)}`);
  expect(store.evaluations[0].proof_record).toMatchObject({ schemaVersion: 'paradox-proof-of-learning-v1', status: 'pass', score: 100 });
  expect(await service.listEligibleEvaluations(LEARNER)).toHaveLength(1);

  const discussionInput = { mode: 'discuss', problem: 'Solve 2x = 8', solution: 'x = 4', question: 'Why?', hintLevel: 0 };
  const discussionAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input: discussionInput });
  await service.recordAiFailure({ authorized: discussionAuthorization, input: discussionInput, error: { code: 'NOT_CONFIGURED' } });
  expect(store.sessions[0].status).toBe('completed');
});

test('Debate API without an AI key records analysis failure without creating an evaluation', async () => {
  let failure;
  const fakeRecordService = {
    async authorizeAiRequest(context) { return { session: { id: context.sessionId }, submission: { id: context.submissionId }, learnerId: context.userId }; },
    async recordAiFailure(context) { failure = context; },
    async recordAiResult() { throw new Error('must not persist a result'); },
  };
  const handler = createDebateHandler({
    analysisFactory: async () => { throw Object.assign(new Error('ANYROUTER_API_KEY is not configured'), { status: 503, code: 'NOT_CONFIGURED' }); },
    sessionResolver: async () => ({ user: { id: LEARNER.id } }),
    storeFactory: () => ({}),
    recordServiceFactory: () => fakeRecordService,
  });
  const request = {
    method: 'POST', headers: { 'x-forwarded-for': '203.0.113.199' },
    body: {
      mode: 'analyze', problem: 'Solve 2x = 8', solution: 'x = 6',
      learningRecord: { sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    },
  };
  const response = { statusCode: 200, payload: null, setHeader() { return this; }, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await handler(request, response);
  expect(response).toMatchObject({ statusCode: 503, payload: { code: 'NOT_CONFIGURED' } });
  expect(failure.error).toMatchObject({ code: 'NOT_CONFIGURED' });
  expect(failure.input).toMatchObject({ mode: 'analyze', problem: 'Solve 2x = 8', solution: 'x = 6' });
});

function evidenceSession(index, completedAt, overrides = {}) {
  const id = `${String(index).padStart(8, '0')}-dddd-4ddd-8ddd-dddddddddddd`;
  const completed = new Date(completedAt);
  return {
    id,
    status: 'completed',
    started_at: new Date(completed.getTime() - 60_000).toISOString(),
    completed_at: completed.toISOString(),
    ...overrides,
  };
}

function evidenceSubmission(index, sessionId, attemptNumber, type, status, evaluationStatus = null) {
  return {
    id: `${String(index).padStart(8, '0')}-eeee-4eee-8eee-eeeeeeeeeeee`,
    session_id: sessionId,
    attempt_number: attemptNumber,
    submission_type: type,
    analysis_state: 'analyzed',
    ai_analysis: { status, ...(evaluationStatus ? { evaluation: { status: evaluationStatus } } : {}) },
  };
}

test('an initially correct solution does not count as self-correction', () => {
  const session = evidenceSession(1, '2026-10-20T05:00:00.000Z');
  const initial = evidenceSubmission(1, session.id, 1, 'initial', 'correct');
  const summary = deriveLearningAchievementSummary({ sessions: [session], submissions: [initial], generatedAt: new Date('2026-10-20T06:00:00.000Z') });

  expect(summary.metrics).toMatchObject({ validCompletedSessions: 1, successfulCorrectionSessions: 0 });
  expect(summary.achievements.find(item => item.id === 'first-session')?.earned).toBe(true);
  expect(summary.achievements.find(item => item.id === 'error-hunter')?.earned).toBe(false);
});

test('failed and incomplete resubmissions are excluded from achievements', () => {
  const session = evidenceSession(1, '2026-10-20T05:00:00.000Z', { status: 'in_progress', completed_at: null });
  const initial = evidenceSubmission(1, session.id, 1, 'initial', 'incorrect');
  const revision = evidenceSubmission(2, session.id, 2, 'revision', 'incorrect', 'needs_improvement');
  const summary = deriveLearningAchievementSummary({
    sessions: [session],
    submissions: [initial, revision],
    evaluations: [{ session_id: session.id, submission_id: revision.id, status: 'needs_improvement' }],
  });

  expect(summary.metrics).toMatchObject({ validCompletedSessions: 0, successfulCorrectionSessions: 0, longestStreak: 0 });
  expect(summary.achievements.every(item => item.earned === false)).toBe(true);
});

test('multiple revisions in one session produce one successful-correction achievement unit', () => {
  const session = evidenceSession(1, '2026-10-20T05:00:00.000Z');
  const initial = evidenceSubmission(1, session.id, 1, 'initial', 'incorrect');
  const failed = evidenceSubmission(2, session.id, 2, 'revision', 'incorrect', 'needs_improvement');
  const passed = evidenceSubmission(3, session.id, 3, 'revision', 'correct', 'pass');
  const duplicatePass = evidenceSubmission(4, session.id, 4, 'revision', 'correct', 'pass');
  const summary = deriveLearningAchievementSummary({
    sessions: [session],
    submissions: [initial, failed, passed, duplicatePass],
    evaluations: [passed, duplicatePass].map(row => ({ session_id: session.id, submission_id: row.id, status: 'pass' })),
  });

  expect(summary.metrics.successfulCorrectionSessions).toBe(1);
  expect(summary.achievements.find(item => item.id === 'error-hunter')).toMatchObject({ current: 1, target: 1, earned: true });
});

test('seven distinct consecutive completion days use Asia/Ho_Chi_Minh and ignore same-day duplicates', () => {
  const sessions = Array.from({ length: 7 }, (_, index) => evidenceSession(index + 1, new Date(Date.parse('2026-10-01T17:30:00.000Z') + index * 86_400_000).toISOString()));
  sessions.push(evidenceSession(8, '2026-10-04T18:00:00.000Z'));
  sessions.push(evidenceSession(9, '2026-10-09T05:00:00.000Z', { status: 'analysis_unavailable', completed_at: null }));
  const summary = deriveLearningAchievementSummary({ sessions, generatedAt: new Date('2026-10-08T18:00:00.000Z') });

  expect(summary.timeZone).toBe('Asia/Ho_Chi_Minh');
  expect(summary.metrics).toMatchObject({ validCompletedSessions: 8, distinctActivityDays: 7, longestStreak: 7 });
  expect(summary.achievements.find(item => item.id === 'consistency')).toMatchObject({ current: 7, earned: true });
});

test('backend achievement summary preserves raw counts above target for UI capping', () => {
  const sessions = Array.from({ length: 3 }, (_, index) => evidenceSession(index + 1, new Date(Date.parse('2026-10-01T05:00:00.000Z') + index * 86_400_000).toISOString()));
  const summary = deriveLearningAchievementSummary({ sessions, generatedAt: new Date('2026-10-03T06:00:00.000Z') });
  const firstSession = summary.achievements.find(item => item.id === 'first-session');
  expect(firstSession).toMatchObject({ current: 3, target: 1, earned: true });
  expect(summary.metrics.validCompletedSessions).toBe(3);
});

test('ten unique valid completed sessions unlock Critical Thinker and invalid duplicate rows do not count', () => {
  const sessions = Array.from({ length: 10 }, (_, index) => evidenceSession(index + 1, new Date(Date.parse('2026-09-01T05:00:00.000Z') + index * 2 * 86_400_000).toISOString()));
  sessions.push({ ...sessions[0] });
  sessions.push(evidenceSession(11, '2026-09-30T05:00:00.000Z', { completed_at: null }));
  sessions.push(evidenceSession(12, '2026-09-30T05:00:00.000Z', { started_at: '2026-10-01T05:00:00.000Z' }));
  const summary = deriveLearningAchievementSummary({ sessions });

  expect(summary.metrics.validCompletedSessions).toBe(10);
  expect(summary.achievements.find(item => item.id === 'critical-thinker')).toMatchObject({ current: 10, target: 10, earned: true });
});
