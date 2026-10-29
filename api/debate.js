import { DEBATE_PROMPT } from '../debate-prompt.js';
import { createHash } from 'node:crypto';
import { createAiGateway } from './_ai/gateway.js';
import { currentUser } from './auth/_supabase.js';
import { createLearningRecordService } from './learning-records/_service.js';
import { createLearningRecordStore } from './learning-records/_store.js';

const LANGUAGES = new Set(['vi', 'en', 'jp']);
const STATUSES = new Set(['correct', 'incorrect', 'insufficient']);
const CATEGORIES = new Set(['knowledge', 'logic', 'method']);
const MODES = new Set(['analyze', 'discuss', 'hint', 'resubmit']);
const RUBRIC_KEYS = ['knowledgeAccuracy', 'reasoningLogic', 'solutionCompleteness', 'errorRemediation'];
const RUBRIC_VERSION = 'paradox-rubric-v1';
const requestWindows = new Map();
const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 60 * 1000;

function allowRequest(req, now = Date.now()) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'local';
  const recent = (requestWindows.get(key) || []).filter(timestamp => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) { requestWindows.set(key, recent); return false; }
  recent.push(now);
  requestWindows.set(key, recent);
  if (requestWindows.size > 1000) {
    for (const [client, timestamps] of requestWindows) if (!timestamps.some(timestamp => now - timestamp < RATE_WINDOW_MS)) requestWindows.delete(client);
  }
  return true;
}

function inputError(message) {
  return Object.assign(new Error(message), { status: 400, code: 'INVALID_INPUT' });
}

function requiredText(value, field, min, max) {
  const text = String(value || '').trim();
  if (text.length < min) throw inputError(`${field} is required`);
  if (text.length > max) throw inputError(`${field} is too long`);
  return text;
}

function optionalText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function safeOutputText(value, field, max, required = true) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw Object.assign(new Error(`AI output is missing ${field}`), { status: 502, code: 'INVALID_OUTPUT' });
  return text.slice(0, max);
}

function parseJsonContent(content) {
  const cleaned = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); }
  catch { throw Object.assign(new Error('AI output is not valid JSON'), { status: 502, code: 'INVALID_OUTPUT' }); }
}

function normalizedComparableText(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function validateEvaluation(raw, context, analysisStatus, confidence) {
  if (context.mode !== 'resubmit') return null;
  if (!raw || typeof raw !== 'object' || !raw.criteria || typeof raw.criteria !== 'object') throw Object.assign(new Error('AI output is missing the resubmission evaluation'), { status: 502, code: 'INVALID_OUTPUT' });
  const criteria = {};
  for (const key of RUBRIC_KEYS) {
    const criterion = raw.criteria[key];
    if (!criterion || typeof criterion.score !== 'number' || !Number.isFinite(criterion.score)) throw Object.assign(new Error(`AI output is missing evaluation.${key}`), { status: 502, code: 'INVALID_OUTPUT' });
    criteria[key] = {
      score: Math.max(0, Math.min(25, Math.round(Number(criterion.score)))),
      evidence: safeOutputText(criterion.evidence, `evaluation.${key}.evidence`, 800),
    };
  }
  const calculatedScore = RUBRIC_KEYS.reduce((sum, key) => sum + criteria[key].score, 0);
  const evidenceSufficient = raw.evidenceSufficient === true && analysisStatus !== 'insufficient' && confidence >= 0.6;
  const correctedIssues = Array.isArray(raw.correctedIssues) ? raw.correctedIssues.slice(0, 8).map(value => safeOutputText(value, 'evaluation.correctedIssue', 500)).filter(Boolean) : [];
  const remainingIssues = Array.isArray(raw.remainingIssues) ? raw.remainingIssues.slice(0, 8).map(value => safeOutputText(value, 'evaluation.remainingIssue', 500)).filter(Boolean) : [];
  const status = !evidenceSufficient ? 'insufficient' : calculatedScore >= 75 && analysisStatus === 'correct' && !remainingIssues.length ? 'pass' : 'needs_improvement';
  return {
    rubricVersion: RUBRIC_VERSION,
    evidenceSufficient,
    score: evidenceSufficient ? calculatedScore : null,
    status,
    comment: safeOutputText(raw.comment, 'evaluation.comment', 1600),
    criteria,
    correctedIssues,
    remainingIssues,
  };
}

export function validateDebateAnalysis(raw, context = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('AI output must be an object'), { status: 502, code: 'INVALID_OUTPUT' });
  if (!STATUSES.has(raw.status)) throw Object.assign(new Error('AI output has an invalid status'), { status: 502, code: 'INVALID_OUTPUT' });
  const issues = raw.status === 'incorrect' && Array.isArray(raw.issues) ? raw.issues.slice(0, 8).map(issue => {
    if (!issue || !CATEGORIES.has(issue.category)) throw Object.assign(new Error('AI output has an invalid issue category'), { status: 502, code: 'INVALID_OUTPUT' });
    return {
      category: issue.category,
      step: safeOutputText(issue.step, 'issue.step', 500),
      explanation: safeOutputText(issue.explanation, 'issue.explanation', 1200),
      suggestion: safeOutputText(issue.suggestion, 'issue.suggestion', 800),
    };
  }) : [];
  if (raw.status === 'incorrect' && !issues.length) throw Object.assign(new Error('Incorrect analysis must identify an issue'), { status: 502, code: 'INVALID_OUTPUT' });
  let hint = null;
  if (context.mode === 'hint') {
    const level = Number(raw.hint?.level);
    const content = safeOutputText(raw.hint?.content, 'hint.content', 1400);
    if (level !== context.hintLevel) throw Object.assign(new Error('AI output changed the requested hint level'), { status: 502, code: 'INVALID_OUTPUT' });
    if ((context.previousHints || []).some(previous => normalizedComparableText(previous) === normalizedComparableText(content))) {
      throw Object.assign(new Error('AI output repeated a previous hint'), { status: 502, code: 'INVALID_OUTPUT' });
    }
    hint = { level, content };
  }
  let comparison = null;
  if (context.mode === 'resubmit') {
    comparison = {
      summary: safeOutputText(raw.comparison?.summary, 'comparison.summary', 1400),
      improvements: Array.isArray(raw.comparison?.improvements) ? raw.comparison.improvements.slice(0, 6).map(value => safeOutputText(value, 'comparison.improvement', 500)).filter(Boolean) : [],
      remainingIssues: Array.isArray(raw.comparison?.remainingIssues) ? raw.comparison.remainingIssues.slice(0, 6).map(value => safeOutputText(value, 'comparison.remainingIssue', 500)).filter(Boolean) : [],
    };
  }
  const confidence = Math.max(0, Math.min(1, Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.5));
  const evaluation = validateEvaluation(raw.evaluation, context, raw.status, confidence);
  return {
    status: raw.status,
    summary: safeOutputText(raw.summary, 'summary', 1600),
    confidence,
    issues,
    strengths: Array.isArray(raw.strengths) ? raw.strengths.slice(0, 5).map(value => safeOutputText(value, 'strength', 500)).filter(Boolean) : [],
    nextQuestion: safeOutputText(raw.nextQuestion, 'nextQuestion', 800, false),
    reply: safeOutputText(raw.reply, 'reply', 1800, ['discuss', 'hint'].includes(context.mode)),
    hint,
    comparison,
    evaluation,
  };
}

export function normalizeDebatePayload(payload) {
  const problem = requiredText(payload?.problem, 'Problem', 3, 12000);
  const solution = requiredText(payload?.solution, 'Solution', 1, 16000);
  if (problem.length + solution.length > 24000) throw inputError('Combined input is too long');
  const mode = MODES.has(payload?.mode) ? payload.mode : 'analyze';
  const hintLevel = Number(payload?.hintLevel);
  if (mode === 'hint' && ![1, 2, 3].includes(hintLevel)) throw inputError('Hint level must be 1, 2, or 3');
  const conversation = Array.isArray(payload?.conversation) ? payload.conversation.slice(-16).map(item => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    text: optionalText(item?.text, 1200),
  })).filter(item => item.text) : [];
  const previousHints = Array.isArray(payload?.previousHints) ? payload.previousHints.slice(0, 3).map(value => optionalText(typeof value === 'string' ? value : value?.content, 1400)).filter(Boolean) : [];
  const previousSolution = optionalText(payload?.previousSolution, 16000);
  const question = optionalText(payload?.question, 1200);
  if (mode === 'resubmit' && !previousSolution) throw inputError('Previous solution is required for resubmission');
  if (['discuss', 'hint'].includes(mode) && !question) throw inputError('A follow-up question is required');
  return {
    problem,
    solution,
    mode,
    hintLevel: mode === 'hint' ? hintLevel : 0,
    language: LANGUAGES.has(payload?.language) ? payload.language : 'vi',
    question,
    previousAnalysis: payload?.previousAnalysis && typeof payload.previousAnalysis === 'object'
      ? JSON.stringify(payload.previousAnalysis).slice(0, 6000)
      : '',
    conversation,
    previousHints,
    previousSolution,
    attemptNumber: Math.max(1, Math.min(1000, Math.round(Number(payload?.attemptNumber) || 1))),
  };
}

function debateUserContent(input) {
  return `<mode>${input.mode}</mode>\n<problem>\n${input.problem}\n</problem>\n<learner_solution>\n${input.solution}\n</learner_solution>${input.previousSolution ? `\n<previous_solution>${input.previousSolution}</previous_solution>` : ''}${input.previousAnalysis ? `\n<previous_analysis>${input.previousAnalysis}</previous_analysis>` : ''}${input.conversation.length ? `\n<conversation_history>${JSON.stringify(input.conversation)}</conversation_history>` : ''}${input.previousHints.length ? `\n<prior_hints>${JSON.stringify(input.previousHints)}</prior_hints>` : ''}${input.hintLevel ? `\n<requested_hint_level>${input.hintLevel}</requested_hint_level>` : ''}${input.question ? `\n<follow_up_question>${input.question}</follow_up_question>` : ''}`;
}

function debateSystemPrompt(language) {
  return `${DEBATE_PROMPT}\nRequested interface language: ${language}.`;
}

/**
 * Runs the multi-step PARADOX debate through the shared AI gateway.
 * Gemini answers first; AnyRouter is the fallback. They are only used when the
 * previous provider is missing, fails, times out, or returns output that fails
 * schema validation. The Socratic rules in DEBATE_PROMPT are always sent from
 * the server and are never client-supplied.
 */
export async function createDebateAnalysisWithMeta(payload, options = {}) {
  const input = normalizeDebatePayload(payload);
  const gateway = options.gateway || createAiGateway({
    fetcher: options.fetcher,
    env: options.env,
    providers: options.providers,
    providerOrder: options.providerOrder,
    timeoutMs: options.timeoutMs,
    totalTimeoutMs: options.totalTimeoutMs,
    maxRetries: options.maxRetries,
    retryDelayMs: options.retryDelayMs,
  });
  const context = { mode: input.mode, hintLevel: input.hintLevel, previousHints: input.previousHints };
  const result = await gateway.complete({
    systemPrompt: debateSystemPrompt(input.language),
    userPrompt: debateUserContent(input),
    temperature: 0.1,
    maxOutputTokens: 2200,
    json: true,
    validate: text => validateDebateAnalysis(parseJsonContent(text), context),
  });
  const analysis = result.value;
  if (input.mode === 'resubmit' && analysis.evaluation) {
    const contentHash = createHash('sha256').update(JSON.stringify({ problem: input.problem, previousSolution: input.previousSolution, solution: input.solution })).digest('hex');
    analysis.proofRecord = {
      schemaVersion: 'paradox-proof-of-learning-v1',
      rubricVersion: RUBRIC_VERSION,
      contentHash,
      attemptNumber: input.attemptNumber,
      evaluatedAt: new Date().toISOString(),
      model: options.model || result.providerModel,
      analysisStatus: analysis.status,
      confidence: analysis.confidence,
      evidenceSufficient: analysis.evaluation.evidenceSufficient,
      status: analysis.evaluation.status,
      score: analysis.evaluation.score,
      criteria: analysis.evaluation.criteria,
      correctedIssues: analysis.evaluation.correctedIssues,
      remainingIssues: analysis.evaluation.remainingIssues,
    };
  }
  return {
    analysis,
    meta: {
      provider: result.provider,
      model: result.providerModel,
      attempts: result.attempts,
      retryCount: result.retryCount,
      fallbackUsed: result.fallbackUsed,
      latencyMs: result.latencyMs,
      trace: result.trace,
    },
  };
}

export async function createDebateAnalysis(payload, options = {}) {
  return (await createDebateAnalysisWithMeta(payload, options)).analysis;
}

export function createDebateHandler({
  analysisFactory = createDebateAnalysisWithMeta,
  sessionResolver = currentUser,
  storeFactory = createLearningRecordStore,
  recordServiceFactory = createLearningRecordService,
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }); }
    if (!allowRequest(req)) return res.status(429).json({ error: 'Too many AI analysis requests. Please wait a moment.', code: 'RATE_LIMIT' });
    let recordService;
    let authorizedRecord;
    let normalizedInput;
    try {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      normalizedInput = normalizeDebatePayload(payload);
      const recordContext = payload?.learningRecord;
      if (recordContext?.sessionId || recordContext?.submissionId) {
        if (!recordContext.sessionId || !recordContext.submissionId) throw inputError('Complete learning record context is required');
        const session = await sessionResolver(req, res);
        recordService = recordServiceFactory({ store: storeFactory() });
        authorizedRecord = await recordService.authorizeAiRequest({
          sessionId: recordContext.sessionId,
          submissionId: recordContext.submissionId,
          userId: session.user.id,
          input: normalizedInput,
        });
      }
      const produced = await analysisFactory(payload);
      const analysis = produced?.analysis || produced;
      const meta = produced?.meta || null;
      if (authorizedRecord) {
        await recordService.recordAiResult({
          authorized: authorizedRecord,
          input: normalizedInput,
          result: analysis,
          model: analysis.proofRecord?.model || meta?.model || 'ai-gateway',
        });
      }
      return res.status(200).json({ analysis, ...(meta ? { meta } : {}) });
    } catch (error) {
      if (authorizedRecord && recordService && normalizedInput) {
        await recordService.recordAiFailure({ authorized: authorizedRecord, input: normalizedInput, error }).catch(() => {});
      }
      const status = error instanceof SyntaxError ? 400 : Number(error.status) || 500;
      const code = error.code || (status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_INPUT');
      const message = status < 500
        ? error.message
        : code === 'NOT_CONFIGURED'
          ? 'AI analysis is not configured'
          : status === 504
            ? 'AI analysis timed out'
            : 'AI analysis is temporarily unavailable';
      const details = error?.details && typeof error.details === 'object' ? { details: error.details } : {};
      return res.status(status).json({ error: message, code, ...details });
    }
  };
}

export default createDebateHandler();
