import { credentialIdFromCode } from '../credentials/_avalanche.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANALYSIS_MODES = new Set(['analyze', 'resubmit']);
const ACHIEVEMENT_SCHEMA_VERSION = 'paradox-achievement-summary-v1';
const ACHIEVEMENT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const ACHIEVEMENT_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'first-session', target: 1 }),
  Object.freeze({ id: 'error-hunter', target: 1 }),
  Object.freeze({ id: 'consistency', target: 7 }),
  Object.freeze({ id: 'critical-thinker', target: 10 }),
]);

function recordError(message, code, status, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

function requireUuid(value, field) {
  const result = String(value || '');
  if (!UUID.test(result)) throw recordError(`${field} is invalid`, 'INVALID_LEARNING_RECORD_ID', 400);
  return result;
}

function requiredText(value, field, min, max) {
  const result = String(value || '').trim();
  if (result.length < min || result.length > max) throw recordError(`${field} must contain ${min} to ${max} characters`, 'INVALID_LEARNING_RECORD_INPUT', 400);
  return result;
}

function cleanTitle(value, problem) {
  const fallback = String(problem).split(/\r?\n/)[0].trim();
  return requiredText(value || fallback || 'Learning session', 'Title', 1, 160);
}

function credentialCode(submissionId, evaluatedAt) {
  const compactId = String(submissionId).replace(/-/g, '').toUpperCase();
  const year = new Date(evaluatedAt).getUTCFullYear();
  const serial = String(Number.parseInt(compactId.slice(8, 16), 16) % 10_000).padStart(4, '0');
  return `PXP-${year}-${compactId.slice(0, 8)}-${serial}`;
}

function durationSeconds(session, now = new Date()) {
  const started = new Date(session.started_at).getTime();
  return Number.isFinite(started) ? Math.max(0, Math.round((now.getTime() - started) / 1000)) : 0;
}

function timeZoneDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ACHIEVEMENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateKeyValue(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
}

function calculateStreaks(dateKeys, todayKey) {
  const ordered = [...new Set(dateKeys)].sort();
  let longest = [];
  let running = [];
  for (const key of ordered) {
    const previous = running.at(-1);
    if (previous && dateKeyValue(key) - dateKeyValue(previous) === 86_400_000) running.push(key);
    else running = [key];
    if (running.length > longest.length) longest = [...running];
  }

  const dates = new Set(ordered);
  const today = dateKeyValue(todayKey);
  let current = 0;
  if (Number.isFinite(today)) {
    let cursor = dates.has(todayKey) ? today : today - 86_400_000;
    while (dates.has(new Date(cursor).toISOString().slice(0, 10))) {
      current += 1;
      cursor -= 86_400_000;
    }
  }
  return { current, longest: longest.length, longestDates: longest };
}

function isValidCompletedSession(row) {
  if (!UUID.test(String(row?.id || '')) || row?.status !== 'completed') return false;
  const startedAt = new Date(row.started_at).getTime();
  const completedAt = new Date(row.completed_at).getTime();
  return Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt;
}

/**
 * Builds the read-only achievement projection from server-owned learning rows.
 * No client score, pass flag, achievement flag, demo row, or blockchain state is
 * accepted by this function.
 */
export function deriveLearningAchievementSummary({ sessions = [], submissions = [], evaluations = [], generatedAt = new Date() } = {}) {
  const completedById = new Map();
  for (const row of sessions) {
    if (isValidCompletedSession(row) && !completedById.has(row.id)) completedById.set(row.id, row);
  }
  const completedSessions = [...completedById.values()].sort((left, right) => (
    new Date(left.completed_at).getTime() - new Date(right.completed_at).getTime()
  ));
  const completedIds = new Set(completedById.keys());

  const submissionsBySession = new Map();
  for (const row of submissions) {
    if (!completedIds.has(row?.session_id) || !UUID.test(String(row?.id || ''))) continue;
    const rows = submissionsBySession.get(row.session_id) || [];
    rows.push(row);
    submissionsBySession.set(row.session_id, rows);
  }
  const passingEvaluations = new Set(evaluations
    .filter(row => completedIds.has(row?.session_id) && row?.status === 'pass' && UUID.test(String(row?.submission_id || '')))
    .map(row => `${row.session_id}:${row.submission_id}`));

  const correctedSessionIds = [];
  for (const session of completedSessions) {
    const rows = (submissionsBySession.get(session.id) || []).sort((left, right) => Number(left.attempt_number) - Number(right.attempt_number));
    const initial = rows.find(row => row.submission_type === 'initial' && Number(row.attempt_number) === 1);
    if (initial?.analysis_state !== 'analyzed' || initial.ai_analysis?.status !== 'incorrect') continue;
    const corrected = rows.some(row => row.submission_type === 'revision'
      && Number(row.attempt_number) > 1
      && row.analysis_state === 'analyzed'
      && row.ai_analysis?.status === 'correct'
      && row.ai_analysis?.evaluation?.status === 'pass'
      && passingEvaluations.has(`${session.id}:${row.id}`));
    if (corrected) correctedSessionIds.push(session.id);
  }

  const activityDates = completedSessions.map(row => timeZoneDateKey(row.completed_at)).filter(Boolean);
  const streaks = calculateStreaks(activityDates, timeZoneDateKey(generatedAt));
  const currentById = {
    'first-session': completedSessions.length,
    'error-hunter': correctedSessionIds.length,
    consistency: streaks.longest,
    'critical-thinker': completedSessions.length,
  };
  const evidenceById = {
    'first-session': { sessionIds: completedSessions.slice(0, 1).map(row => row.id) },
    'error-hunter': { sessionIds: correctedSessionIds.slice(0, 1) },
    consistency: { activityDates: streaks.longestDates.slice(0, 7) },
    'critical-thinker': { sessionIds: completedSessions.slice(0, 10).map(row => row.id) },
  };

  return {
    schemaVersion: ACHIEVEMENT_SCHEMA_VERSION,
    source: { type: 'learning_records', authoritative: true },
    timeZone: ACHIEVEMENT_TIME_ZONE,
    generatedAt: (generatedAt instanceof Date ? generatedAt : new Date(generatedAt)).toISOString(),
    metrics: {
      validCompletedSessions: completedSessions.length,
      successfulCorrectionSessions: correctedSessionIds.length,
      distinctActivityDays: new Set(activityDates).size,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
    },
    achievements: ACHIEVEMENT_DEFINITIONS.map(definition => ({
      ...definition,
      current: currentById[definition.id],
      earned: currentById[definition.id] >= definition.target,
      evidence: evidenceById[definition.id],
    })),
  };
}

function publicSubmission(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    attemptNumber: row.attempt_number,
    type: row.submission_type,
    solution: row.solution_text,
    analysisState: row.analysis_state,
    analysis: row.ai_analysis || null,
    analysisErrorCode: row.analysis_error_code || null,
    analysisModel: row.analysis_model || null,
    submittedAt: row.submitted_at,
    analysisCompletedAt: row.analysis_completed_at || null,
  };
}

function publicInteraction(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    submissionId: row.submission_id || null,
    mode: row.mode,
    role: row.role,
    content: row.content,
    hintLevel: row.hint_level || null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

export function publicLearningEvaluation(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    submissionId: row.submission_id,
    rubricVersion: row.rubric_version,
    score: row.score,
    status: row.status,
    comment: row.comment,
    criteria: row.criteria || {},
    correctedIssues: row.corrected_issues || [],
    remainingIssues: row.remaining_issues || [],
    proofRecord: row.proof_record || null,
    credential: {
      eligible: Boolean(row.credential_eligible),
      id: row.credential_id || null,
      idHash: row.credential_id_hash || null,
      hash: row.credential_hash || null,
      status: row.credential_status,
      verificationStatus: row.verification_status,
      transactionHash: null,
    },
    evaluatedAt: row.evaluated_at,
  };
}

export function publicLearningSession(row) {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    problem: row.problem_text,
    status: row.status,
    latestAnalysisStatus: row.latest_analysis_status || null,
    latestEvaluationStatus: row.latest_evaluation_status || null,
    latestScore: row.latest_score,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
    durationSeconds: row.duration_seconds || 0,
    updatedAt: row.updated_at,
  };
}

export function createLearningRecordService({ store, now = () => new Date() } = {}) {
  if (!store) throw new TypeError('Learning record store is required');

  async function ownSession(sessionId, learnerId) {
    const session = await store.findSession(requireUuid(sessionId, 'Session ID'), requireUuid(learnerId, 'Learner ID'));
    if (!session) throw recordError('Learning session was not found', 'LEARNING_SESSION_NOT_FOUND', 404);
    return session;
  }

  async function ownSubmission(submissionId, sessionId, learnerId) {
    const submission = await store.findSubmission(requireUuid(submissionId, 'Submission ID'), sessionId, learnerId);
    if (!submission) throw recordError('Learning submission was not found', 'LEARNING_SUBMISSION_NOT_FOUND', 404);
    return submission;
  }

  async function createSession(body, user) {
    const learnerId = requireUuid(user?.id, 'Learner ID');
    const problem = requiredText(body?.problem, 'Problem', 3, 12000);
    const solution = requiredText(body?.initialSolution, 'Initial solution', 1, 16000);
    const session = await store.insertSession({
      learner_id: learnerId,
      title: cleanTitle(body?.title, problem),
      subject: requiredText(body?.subject || 'General', 'Subject', 1, 80),
      problem_text: problem,
      status: 'in_progress',
    });
    try {
      const submission = await store.insertSubmission({
        session_id: session.id,
        learner_id: learnerId,
        attempt_number: 1,
        submission_type: 'initial',
        solution_text: solution,
        analysis_state: 'pending_analysis',
      });
      return { session: publicLearningSession(session), submission: publicSubmission(submission) };
    } catch (error) {
      await store.updateSession(session.id, learnerId, { status: 'analysis_unavailable' }).catch(() => {});
      throw error;
    }
  }

  async function createSubmission(body, user) {
    const learnerId = requireUuid(user?.id, 'Learner ID');
    const session = await ownSession(body?.sessionId, learnerId);
    if (session.status === 'abandoned') throw recordError('Abandoned sessions cannot accept submissions', 'LEARNING_SESSION_CLOSED', 409);
    const latest = await store.latestSubmission(session.id, learnerId);
    const attemptNumber = Number(latest?.attempt_number || 0) + 1;
    if (attemptNumber > 100) throw recordError('Submission limit reached', 'LEARNING_SUBMISSION_LIMIT', 409);
    const submission = await store.insertSubmission({
      session_id: session.id,
      learner_id: learnerId,
      attempt_number: attemptNumber,
      submission_type: 'revision',
      solution_text: requiredText(body?.solution, 'Solution', 1, 16000),
      analysis_state: 'pending_analysis',
    });
    await store.updateSession(session.id, learnerId, { status: 'in_progress' });
    return publicSubmission(submission);
  }

  async function authorizeAiRequest({ sessionId, submissionId, userId, input }) {
    const learnerId = requireUuid(userId, 'Learner ID');
    const session = await ownSession(sessionId, learnerId);
    if (session.status === 'abandoned') throw recordError('Learning session is closed', 'LEARNING_SESSION_CLOSED', 409);
    if (String(session.problem_text).trim() !== String(input.problem).trim()) throw recordError('Problem does not match the stored session', 'LEARNING_RECORD_MISMATCH', 409);
    const submission = await ownSubmission(submissionId, session.id, learnerId);
    if (String(submission.solution_text).trim() !== String(input.solution).trim()) throw recordError('Solution does not match the stored submission', 'LEARNING_RECORD_MISMATCH', 409);
    if (ANALYSIS_MODES.has(input.mode) && submission.analysis_state === 'analyzed') {
      throw recordError('Learning submission was already analyzed', 'LEARNING_SUBMISSION_ALREADY_ANALYZED', 409);
    }
    return { session, submission, learnerId };
  }

  async function recordAiResult({ authorized, input, result, model }) {
    const { session, submission, learnerId } = authorized;
    const completedAt = now().toISOString();
    if (ANALYSIS_MODES.has(input.mode)) {
      await store.updateSubmission(submission.id, learnerId, {
        analysis_state: 'analyzed',
        ai_analysis: result,
        analysis_error_code: null,
        analysis_model: String(model || result.proofRecord?.model || '').slice(0, 160) || null,
        analysis_completed_at: completedAt,
      });
    }

    const interactions = [];
    if (input.mode === 'discuss') {
      interactions.push(
        { mode: 'discussion', role: 'user', content: input.question },
        { mode: 'discussion', role: 'assistant', content: result.reply || result.summary },
      );
    } else if (input.mode === 'hint') {
      interactions.push(
        { mode: 'hint', role: 'user', content: input.question, hint_level: input.hintLevel },
        { mode: 'hint', role: 'assistant', content: result.hint?.content || result.reply, hint_level: input.hintLevel },
      );
    } else {
      interactions.push({ mode: 'analysis', role: 'assistant', content: result.summary });
    }
    await store.insertInteractions(interactions.filter(item => item.content).map(item => ({
      session_id: session.id,
      submission_id: submission.id,
      learner_id: learnerId,
      metadata: {},
      ...item,
    })));

    let evaluation = null;
    if (input.mode === 'resubmit' && result.evaluation) {
      const proof = result.proofRecord;
      const eligible = result.status === 'correct'
        && result.evaluation.status === 'pass'
        && result.evaluation.evidenceSufficient === true
        && proof?.schemaVersion === 'paradox-proof-of-learning-v1'
        && /^[0-9a-f]{64}$/i.test(String(proof.contentHash || ''));
      const credentialId = eligible ? credentialCode(submission.id, completedAt) : null;
      const evaluationRow = await store.insertEvaluation({
        session_id: session.id,
        submission_id: submission.id,
        learner_id: learnerId,
        rubric_version: result.evaluation.rubricVersion,
        score: result.evaluation.score,
        status: result.evaluation.status,
        comment: result.evaluation.comment,
        criteria: result.evaluation.criteria,
        corrected_issues: result.evaluation.correctedIssues,
        remaining_issues: result.evaluation.remainingIssues,
        proof_record: proof || null,
        credential_eligible: eligible,
        credential_id: credentialId,
        credential_id_hash: credentialId ? credentialIdFromCode(credentialId) : null,
        credential_hash: eligible ? `0x${proof.contentHash.toLowerCase()}` : null,
        credential_status: eligible ? 'eligible' : 'not_eligible',
        verification_status: 'unverified',
        evaluated_at: completedAt,
      });
      evaluation = publicLearningEvaluation(evaluationRow);
    }

    const completed = ANALYSIS_MODES.has(input.mode)
      && result.status === 'correct'
      && (input.mode !== 'resubmit' || result.evaluation?.status === 'pass');
    const updatedSession = await store.updateSession(session.id, learnerId, ANALYSIS_MODES.has(input.mode) ? {
      status: completed ? 'completed' : 'in_progress',
      latest_analysis_status: result.status,
      latest_evaluation_status: result.evaluation?.status || null,
      latest_score: result.evaluation?.score ?? null,
      completed_at: completed ? completedAt : null,
      duration_seconds: durationSeconds(session, now()),
    } : {
      duration_seconds: durationSeconds(session, now()),
    });
    return { session: publicLearningSession(updatedSession), evaluation };
  }

  async function recordAiFailure({ authorized, input, error }) {
    const { session, submission, learnerId } = authorized;
    if (ANALYSIS_MODES.has(input.mode)) {
      await store.updateSubmission(submission.id, learnerId, {
        analysis_state: 'analysis_failed',
        analysis_error_code: String(error?.code || 'AI_ANALYSIS_FAILED').slice(0, 100),
        analysis_completed_at: now().toISOString(),
      });
      await store.updateSession(session.id, learnerId, {
        status: 'analysis_unavailable',
        duration_seconds: durationSeconds(session, now()),
      });
      return;
    }
    await store.updateSession(session.id, learnerId, {
      duration_seconds: durationSeconds(session, now()),
    });
  }

  return {
    createSession,
    createSubmission,
    authorizeAiRequest,
    recordAiResult,
    recordAiFailure,
    async abandonSession(sessionId, user) {
      const learnerId = requireUuid(user?.id, 'Learner ID');
      const session = await ownSession(sessionId, learnerId);
      const completedAt = now().toISOString();
      return publicLearningSession(await store.updateSession(session.id, learnerId, { status: 'abandoned', completed_at: completedAt, duration_seconds: durationSeconds(session, now()) }));
    },
    async listSessions(user, options = {}) {
      const learnerId = requireUuid(user?.id, 'Learner ID');
      return (await store.listSessions(learnerId, options)).map(publicLearningSession);
    },
    async getAchievementSummary(user) {
      const learnerId = requireUuid(user?.id, 'Learner ID');
      const [sessions, submissions, evaluations] = await Promise.all([
        store.listAchievementSessions(learnerId),
        store.listAchievementSubmissions(learnerId),
        store.listAchievementEvaluations(learnerId),
      ]);
      return deriveLearningAchievementSummary({ sessions, submissions, evaluations, generatedAt: now() });
    },
    async getSession(sessionId, user) {
      const learnerId = requireUuid(user?.id, 'Learner ID');
      const session = await ownSession(sessionId, learnerId);
      const [submissions, interactions, evaluations] = await Promise.all([
        store.listSubmissions(session.id, learnerId),
        store.listInteractions(session.id, learnerId),
        store.listEvaluations(session.id, learnerId),
      ]);
      return {
        ...publicLearningSession(session),
        submissions: submissions.map(publicSubmission),
        interactions: interactions.map(publicInteraction),
        evaluations: evaluations.map(publicLearningEvaluation),
      };
    },
    async listEligibleEvaluations(user, options = {}) {
      const learnerId = requireUuid(user?.id, 'Learner ID');
      return (await store.listEligibleEvaluations(learnerId, options)).map(publicLearningEvaluation);
    },
  };
}
