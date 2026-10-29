const DEBATE_ENDPOINT = '/api/debate';
const pendingRequests = new Map();
const analysisCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function validateClientAnalysis(value, mode) {
  if (!value || !['correct', 'incorrect', 'insufficient'].includes(value.status) || typeof value.summary !== 'string' || !Array.isArray(value.issues)) {
    const error = new Error('Invalid AI analysis response');
    error.code = 'INVALID_OUTPUT';
    throw error;
  }
  if (mode === 'resubmit') {
    const evaluation = value.evaluation;
    const validStatus = ['pass', 'needs_improvement', 'insufficient'].includes(evaluation?.status);
    const validScore = evaluation?.score === null || (Number.isFinite(evaluation?.score) && evaluation.score >= 0 && evaluation.score <= 100);
    if (!validStatus || !validScore || !evaluation.criteria || !value.comparison) {
      const error = new Error('Invalid AI evaluation response');
      error.code = 'INVALID_OUTPUT';
      throw error;
    }
  }
  return value;
}

async function executeRequest(payload, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(DEBATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'AI analysis failed');
      error.code = data.code || 'REQUEST_FAILED';
      error.status = response.status;
      error.requestId = data.requestId || response.headers.get('x-ai-request-id') || '';
      throw error;
    }
    return validateClientAnalysis(data.analysis, payload.mode || 'analyze');
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('AI analysis timed out');
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function requestDebateAnalysis(payload, options = {}) {
  const key = JSON.stringify(payload);
  const cached = analysisCache.get(key);
  if ((payload.mode || 'analyze') === 'analyze' && cached && cached.expiresAt > Date.now()) return Promise.resolve(clone(cached.value));
  if (cached) analysisCache.delete(key);
  if (pendingRequests.has(key)) return pendingRequests.get(key).then(clone);
  const request = executeRequest(payload, options).then(result => {
    if ((payload.mode || 'analyze') === 'analyze') {
      const now = Date.now();
      for (const [cachedKey, entry] of analysisCache) if (entry.expiresAt <= now) analysisCache.delete(cachedKey);
      while (analysisCache.size >= CACHE_MAX_ENTRIES) analysisCache.delete(analysisCache.keys().next().value);
      analysisCache.set(key, { value: clone(result), expiresAt: now + CACHE_TTL_MS });
    }
    return result;
  }).finally(() => pendingRequests.delete(key));
  pendingRequests.set(key, request);
  return request.then(clone);
}
