import { expect, test } from '@playwright/test';
import { createDebateHandler } from '../api/debate.js';
import { createLearningRecordService } from '../api/learning-records/_service.js';
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
  return {
    sessions, submissions, interactions, evaluations,
    async insertSession(record) {
      sessionIndex += 1;
      const id = `${String(sessionIndex).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      const row = { id, started_at: '2026-10-28T10:00:00.000Z', created_at: '2026-10-28T10:00:00.000Z', updated_at: '2026-10-28T10:00:00.000Z', duration_seconds: 0, latest_score: null, ...record };
      sessions.push(row);
      return { ...row };
    },
    async updateSession(id, learnerId, patch) {
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
      if (evaluations.some(item => item.submission_id === record.submission_id)) throw Object.assign(new Error('Duplicate evaluation'), { code: 'LEARNING_RECORD_CONFLICT', status: 409 });
      evaluationIndex += 1;
      const row = { id: `${String(evaluationIndex).padStart(8, '0')}-cccc-4ccc-8ccc-cccccccccccc`, created_at: '2026-10-28T10:03:00.000Z', ...record };
      evaluations.push(row);
      return { ...row };
    },
    async listEvaluations(sessionId, learnerId) { return evaluations.filter(item => item.session_id === sessionId && item.learner_id === learnerId); },
    async listEligibleEvaluations(learnerId) { return evaluations.filter(item => item.learner_id === learnerId && item.credential_eligible); },
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

test('learning records persist sessions, revisions, analysis and reloadable history', async () => {
  const store = createMemoryStore();
  const service = createLearningRecordService({ store, now: () => new Date('2026-10-28T10:05:00.000Z') });
  const created = await service.createSession({ problem: 'Solve 2x = 8', initialSolution: 'x = 6', subject: 'Algebra', status: 'completed', latestScore: 100 }, LEARNER);
  expect(created.session).toMatchObject({ status: 'in_progress', problem: 'Solve 2x = 8' });
  expect(created.submission).toMatchObject({ attemptNumber: 1, type: 'initial', analysisState: 'pending_analysis' });

  const initialInput = { mode: 'analyze', problem: 'Solve 2x = 8', solution: 'x = 6', question: '', hintLevel: 0 };
  const initialAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: created.submission.id, userId: LEARNER.id, input: initialInput });
  await service.recordAiResult({ authorized: initialAuthorization, input: initialInput, result: { status: 'incorrect', summary: 'Division is incorrect.', issues: [{ category: 'knowledge' }], strengths: [], reply: '' }, model: 'test-model' });

  const revision = await service.createSubmission({ sessionId: created.session.id, solution: 'x = 4', analysis: { status: 'correct' } }, LEARNER);
  expect(revision.attemptNumber).toBe(2);
  const revisionInput = { mode: 'resubmit', problem: 'Solve 2x = 8', solution: 'x = 4', question: '', hintLevel: 0 };
  const revisionAuthorization = await service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input: revisionInput });
  await service.recordAiResult({ authorized: revisionAuthorization, input: revisionInput, result: passingResult(), model: 'test-model' });

  const reloaded = await service.getSession(created.session.id, LEARNER);
  expect(reloaded).toMatchObject({ status: 'completed', latestEvaluationStatus: 'pass', latestScore: 100, durationSeconds: 300 });
  expect(reloaded.submissions).toHaveLength(2);
  expect(reloaded.submissions[0]).toMatchObject({ analysisState: 'analyzed', analysis: { status: 'incorrect' } });
  expect(reloaded.submissions[1]).toMatchObject({ analysisState: 'analyzed', analysis: { evaluation: { status: 'pass' } } });
  expect(reloaded.interactions).toHaveLength(2);
  expect(await service.listSessions(LEARNER)).toHaveLength(1);
  await expect(service.authorizeAiRequest({ sessionId: created.session.id, submissionId: revision.id, userId: LEARNER.id, input: revisionInput }))
    .rejects.toMatchObject({ code: 'LEARNING_SUBMISSION_ALREADY_ANALYZED', status: 409 });
});

test('learning record ownership is enforced and input cannot self-assign a passing evaluation', async () => {
  const store = createMemoryStore();
  const service = createLearningRecordService({ store });
  const created = await service.createSession({ problem: 'Explain a theorem', initialSolution: 'Unfinished proof', subject: 'Logic', latestEvaluationStatus: 'pass', latestScore: 100 }, LEARNER);
  expect(store.sessions[0]).toMatchObject({ status: 'in_progress', latest_score: null });
  await expect(service.getSession(created.session.id, OTHER_LEARNER)).rejects.toMatchObject({ code: 'LEARNING_SESSION_NOT_FOUND', status: 404 });
  await expect(service.createSubmission({ sessionId: created.session.id, solution: 'Forged pass', status: 'pass', score: 100 }, OTHER_LEARNER)).rejects.toMatchObject({ code: 'LEARNING_SESSION_NOT_FOUND' });
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
