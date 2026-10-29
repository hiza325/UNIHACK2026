import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_GATEWAY_DEFAULTS,
  createAiGateway,
  describeAiProviderStatus,
  resolveAiGatewaySettings,
} from '../api/_ai/gateway.js';
import { AI_PROVIDERS } from '../api/_ai/providers.js';
import { DEBATE_PROMPT } from '../debate-prompt.js';
import { createDebateAnalysisWithMeta } from '../api/debate.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GEMINI_KEY = 'gemini-mock-key-value';
const ANYROUTER_KEY = 'anyrouter-mock-key-value';
const ALL_ENV = Object.freeze({
  GEMINI_API_KEY: GEMINI_KEY,
  ANYROUTER_LEARNING_API_KEY: ANYROUTER_KEY,
});

function geminiOk(text) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function openAiOk(text) {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function httpError(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function providerOf(url) {
  if (url.includes('generativelanguage')) return 'gemini';
  if (url.includes('anyrouter.dev')) return 'anyrouter';
  return 'unknown';
}

function createRecorder(handler) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    return handler({ url, options, body, index: calls.length - 1 });
  };
  return { calls, fetcher };
}

test('Gemini is the primary provider and receives a server-built request', async () => {
  const recorder = createRecorder(() => geminiOk('{"ok":true}'));
  const gateway = createAiGateway({ env: { GEMINI_API_KEY: GEMINI_KEY }, fetcher: recorder.fetcher });

  const result = await gateway.complete({ systemPrompt: 'SYSTEM RULES', userPrompt: 'LEARNER INPUT', validate: text => JSON.parse(text) });

  expect(result.provider).toBe('gemini');
  expect(result.model).toBe('gemini-3.5-flash');
  expect(result.providerModel).toBe('gemini/gemini-3.5-flash');
  expect(result.value).toEqual({ ok: true });
  expect(result.attempts).toBe(1);
  expect(result.fallbackUsed).toBe(false);
  const [request] = recorder.calls;
  expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
  expect(request.options.headers['x-goog-api-key']).toBe(GEMINI_KEY);
  expect(request.body.systemInstruction.parts[0].text).toBe('SYSTEM RULES');
  expect(request.body.contents[0].parts[0].text).toBe('LEARNER INPUT');
  expect(JSON.stringify(result)).not.toContain(GEMINI_KEY);
});

test('Gemini retries once on a 5xx failure and then falls back to AnyRouter with a valid request', async () => {
  const recorder = createRecorder(({ url }) => (providerOf(url) === 'gemini' ? httpError(500, 'gemini exploded') : openAiOk('{"ok":true}')));
  const gateway = createAiGateway({ env: ALL_ENV, fetcher: recorder.fetcher, retryDelayMs: 0 });

  const result = await gateway.complete({ systemPrompt: 'SYS', userPrompt: 'USER', validate: text => JSON.parse(text) });

  expect(result.provider).toBe('anyrouter');
  expect(result.model).toBe('anyrouter/free');
  expect(result.providerModel).toBe('anyrouter/anyrouter/free');
  expect(result.fallbackUsed).toBe(true);
  expect(result.attempts).toBe(3);
  expect(result.trace.map(item => `${item.provider}:${item.code}`)).toEqual([
    'gemini:UPSTREAM_ERROR',
    'gemini:UPSTREAM_ERROR',
    'anyrouter:OK',
  ]);
  const anyrouterRequest = recorder.calls[2];
  expect(anyrouterRequest.url).toBe('https://anyrouter.dev/api/v1/chat/completions');
  expect(anyrouterRequest.options.headers.Authorization).toBe(`Bearer ${ANYROUTER_KEY}`);
  expect(anyrouterRequest.body.model).toBe('anyrouter/free');
  expect(anyrouterRequest.body.messages).toEqual([
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'USER' },
  ]);
  expect(anyrouterRequest.body.response_format).toEqual({ type: 'json_object' });
  expect(JSON.stringify(result)).not.toContain(ANYROUTER_KEY);
});

test('Custom model env values are respected for both providers', async () => {
  const recorder = createRecorder(({ url }) => (providerOf(url) === 'gemini' ? httpError(500, 'down') : openAiOk('{}')));
  const gateway = createAiGateway({
    env: {
      GEMINI_API_KEY: GEMINI_KEY,
      GEMINI_MODEL: 'gemini-custom',
      ANYROUTER_LEARNING_API_KEY: ANYROUTER_KEY,
      ANYROUTER_LEARNING_MODEL: 'openai/gpt-4o-mini',
    },
    fetcher: recorder.fetcher,
    maxRetries: 0,
    retryDelayMs: 0,
  });

  const result = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U', validate: text => JSON.parse(text) });

  expect(recorder.calls[0].url).toContain('/models/gemini-custom:generateContent');
  expect(recorder.calls[1].body.model).toBe('openai/gpt-4o-mini');
  expect(result.providerModel).toBe('anyrouter/openai/gpt-4o-mini');
});

test('Non-retryable provider errors fall back immediately', async () => {
  const recorder = createRecorder(({ url }) => (providerOf(url) === 'gemini' ? httpError(401, 'invalid API key') : openAiOk('{"ok":true}')));
  const gateway = createAiGateway({ env: ALL_ENV, fetcher: recorder.fetcher, retryDelayMs: 0 });

  const result = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U', validate: text => JSON.parse(text) });

  expect(result.provider).toBe('anyrouter');
  expect(recorder.calls.map(call => providerOf(call.url))).toEqual(['gemini', 'anyrouter']);
  expect(result.trace[0]).toMatchObject({ provider: 'gemini', attempt: 1, code: 'UPSTREAM_ERROR', retryable: false });
});

test('Retries are bounded even when a caller asks for more', async () => {
  const recorder = createRecorder(() => httpError(429, 'quota exceeded'));
  const gateway = createAiGateway({ env: { GEMINI_API_KEY: GEMINI_KEY }, fetcher: recorder.fetcher, maxRetries: 99, retryDelayMs: 0 });

  await expect(gateway.complete({ systemPrompt: 'S', userPrompt: 'U' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });

  expect(gateway.config.maxRetries).toBe(AI_GATEWAY_DEFAULTS.maxRetryLimit);
  expect(recorder.calls).toHaveLength(AI_GATEWAY_DEFAULTS.maxRetryLimit + 1);
});

test('An unconfigured gateway fails fast without any network request', async () => {
  let networkCalls = 0;
  const gateway = createAiGateway({ env: {}, fetcher: async () => { networkCalls += 1; return geminiOk('{}'); } });

  const error = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U' }).catch(caught => caught);

  expect(error).toMatchObject({ code: 'NOT_CONFIGURED', status: 503 });
  expect(error.details.ready).toBe(false);
  expect(error.details.missingEnv).toEqual(['GEMINI_API_KEY', 'ANYROUTER_LEARNING_API_KEY']);
  expect(error.details.primary).toMatchObject({ id: 'gemini', configured: false, requiredEnv: 'GEMINI_API_KEY' });
  expect(error.details.fallback).toMatchObject({ id: 'anyrouter', configured: false, requiredEnv: 'ANYROUTER_LEARNING_API_KEY' });
  expect(networkCalls).toBe(0);
});

test('AnyRouter-only configuration works when Gemini is not configured', async () => {
  const recorder = createRecorder(() => openAiOk('{"ok":true}'));
  const gateway = createAiGateway({ env: { ANYROUTER_LEARNING_API_KEY: ANYROUTER_KEY }, fetcher: recorder.fetcher });

  const result = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U', validate: text => JSON.parse(text) });

  expect(result.provider).toBe('anyrouter');
  expect(result.providerModel).toBe('anyrouter/anyrouter/free');
  expect(recorder.calls).toHaveLength(1);
  expect(recorder.calls[0].url).toBe('https://anyrouter.dev/api/v1/chat/completions');
});

test('Provider timeouts abort the request and surface as TIMEOUT', async () => {
  const fetcher = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const gateway = createAiGateway({
    env: ALL_ENV,
    fetcher,
    timeoutMs: 5,
    totalTimeoutMs: 20,
    maxRetries: 0,
    retryDelayMs: 0,
  });

  const startedAt = Date.now();
  const error = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U' }).catch(caught => caught);

  expect(error).toMatchObject({ code: 'TIMEOUT', status: 504 });
  expect(error.details.attempts.map(item => item.code)).toEqual(['TIMEOUT', 'TIMEOUT']);
  expect(Date.now() - startedAt).toBeLessThan(2000);
});

test('Invalid JSON from the primary provider triggers a fallback instead of a broken response', async () => {
  const recorder = createRecorder(({ url }) => (providerOf(url) === 'gemini' ? geminiOk('not-json-at-all') : openAiOk('{"ok":true}')));
  const gateway = createAiGateway({ env: ALL_ENV, fetcher: recorder.fetcher, maxRetries: 0, retryDelayMs: 0 });

  const result = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U', validate: text => JSON.parse(text) });

  expect(result.provider).toBe('anyrouter');
  expect(result.value).toEqual({ ok: true });
  expect(result.trace.map(item => `${item.provider}:${item.code}`)).toEqual(['gemini:INVALID_OUTPUT', 'anyrouter:OK']);
});

test('Empty provider output is treated as a retryable failure', async () => {
  const recorder = createRecorder(({ url }) => (providerOf(url) === 'gemini' ? geminiOk('   ') : openAiOk('{"ok":true}')));
  const gateway = createAiGateway({ env: ALL_ENV, fetcher: recorder.fetcher, maxRetries: 0, retryDelayMs: 0 });

  const result = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U', validate: text => JSON.parse(text) });

  expect(result.provider).toBe('anyrouter');
  expect(result.trace[0].code).toBe('EMPTY_RESPONSE');
});

test('Aggregated errors never leak any provider API key', async () => {
  const recorder = createRecorder(() => httpError(500, `upstream rejected ${GEMINI_KEY} and ${ANYROUTER_KEY}`));
  const gateway = createAiGateway({ env: ALL_ENV, fetcher: recorder.fetcher, retryDelayMs: 0 });

  const error = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U' }).catch(caught => caught);
  const serialised = JSON.stringify({ message: error.message, details: error.details });

  expect(error).toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
  expect(error.value).toBeUndefined();
  expect(serialised).not.toContain(GEMINI_KEY);
  expect(serialised).not.toContain(ANYROUTER_KEY);
  expect(serialised).toContain('[redacted]');
});

test('Readiness diagnostics expose only provider names and booleans', () => {
  const unconfigured = describeAiProviderStatus({ env: {} });
  expect(unconfigured).toMatchObject({
    ready: false,
    order: ['gemini', 'anyrouter'],
    configured: [],
    missingEnv: ['GEMINI_API_KEY', 'ANYROUTER_LEARNING_API_KEY'],
  });
  expect(unconfigured.primary).toMatchObject({ id: 'gemini', role: 'primary', configured: false, model: 'gemini-3.5-flash' });
  expect(unconfigured.fallback).toMatchObject({ id: 'anyrouter', role: 'fallback', configured: false, model: 'anyrouter/free' });
  expect(unconfigured.providers.map(provider => provider.id)).toEqual(['gemini', 'anyrouter']);
  expect(unconfigured.geminiKeyCount).toBe(0);
  expect(unconfigured.geminiBackupKeyConfigured).toBe(false);
  expect(unconfigured.anyrouterKeyCount).toBe(0);
  expect(unconfigured.anyrouterBackupKeyConfigured).toBe(false);

  const oneKey = describeAiProviderStatus({ env: { GEMINI_API_KEY: GEMINI_KEY } });
  expect(oneKey.geminiKeyCount).toBe(1);
  expect(oneKey.geminiBackupKeyConfigured).toBe(false);

  const twoKeys = describeAiProviderStatus({ env: { GEMINI_API_KEY: GEMINI_KEY, GEMINI_API_KEY_2: 'second-gemini-key-value' } });
  expect(twoKeys.geminiKeyCount).toBe(2);
  expect(twoKeys.geminiBackupKeyConfigured).toBe(true);

  const oneAnyRouterKey = describeAiProviderStatus({ env: { ANYROUTER_LEARNING_API_KEY: ANYROUTER_KEY } });
  expect(oneAnyRouterKey.anyrouterKeyCount).toBe(1);
  expect(oneAnyRouterKey.anyrouterBackupKeyConfigured).toBe(false);

  const twoAnyRouterKeys = describeAiProviderStatus({ env: { ANYROUTER_LEARNING_API_KEY: ANYROUTER_KEY, ANYROUTER_LEARNING_API_KEY_2: 'second-anyrouter-key-value' } });
  expect(twoAnyRouterKeys.anyrouterKeyCount).toBe(2);
  expect(twoAnyRouterKeys.anyrouterBackupKeyConfigured).toBe(true);

  const configured = describeAiProviderStatus({ env: { ANYROUTER_LEARNING_API_KEY: ANYROUTER_KEY } });
  expect(configured).toMatchObject({ ready: true, configured: ['anyrouter'], missingEnv: ['GEMINI_API_KEY'] });
  expect(configured.fallback).toMatchObject({ id: 'anyrouter', configured: true });
  expect(JSON.stringify(configured)).not.toContain(ANYROUTER_KEY);

  const reordered = describeAiProviderStatus({ env: { AI_PROVIDER_ORDER: 'anyrouter,gemini', GEMINI_API_KEY: GEMINI_KEY } });
  expect(reordered.order).toEqual(['anyrouter', 'gemini']);
  expect(reordered.primary).toMatchObject({ id: 'anyrouter', configured: false });
  expect(reordered.fallback).toMatchObject({ id: 'gemini', configured: true });
});

test('Gateway settings are clamped to safe operational bounds', () => {
  const settings = resolveAiGatewaySettings({ env: { AI_MAX_RETRIES: '99', AI_PROVIDER_TIMEOUT_MS: '1', AI_TOTAL_TIMEOUT_MS: '999999', AI_RETRY_DELAY_MS: '-5' } });
  expect(settings).toEqual({ timeoutMs: 100, totalTimeoutMs: 120000, maxRetries: 3, retryDelayMs: 0 });
});

test('Debate keeps the multi-step Socratic flow for every mode through the gateway', async () => {
  const json = JSON.stringify({
    status: 'incorrect',
    summary: 'Cần xem lại bước 2.',
    confidence: 0.8,
    issues: [{ category: 'logic', step: 'Bước 2', explanation: 'Sai dấu.', suggestion: 'Kiểm tra lại.' }],
    strengths: [],
    nextQuestion: 'Bước tiếp theo là gì?',
    reply: 'Hãy tự kiểm tra bước 2.',
    hint: { level: 1, content: 'Xem lại quy tắc dấu.' },
    comparison: { summary: 'Đã tốt hơn.', improvements: ['Sửa dấu.'], remainingIssues: ['Thiếu điều kiện.'] },
    evaluation: {
      evidenceSufficient: true,
      comment: 'Ổn.',
      criteria: {
        knowledgeAccuracy: { score: 20, evidence: 'Đúng.' },
        reasoningLogic: { score: 20, evidence: 'Hợp lý.' },
        solutionCompleteness: { score: 20, evidence: 'Đủ bước.' },
        errorRemediation: { score: 20, evidence: 'Đã sửa.' },
      },
      correctedIssues: ['Sửa dấu.'],
      remainingIssues: ['Thiếu điều kiện.'],
    },
  });
  const recorder = createRecorder(() => geminiOk(json));
  const gateway = createAiGateway({ env: { GEMINI_API_KEY: GEMINI_KEY }, fetcher: recorder.fetcher });

  const cases = [
    { mode: 'analyze', payload: { mode: 'analyze', problem: 'Đề bài phân tích', solution: 'Lời giải' } },
    { mode: 'discuss', payload: { mode: 'discuss', problem: 'Đề bài thảo luận', solution: 'Lời giải', question: 'Vì sao?', previousAnalysis: { status: 'incorrect' } } },
    { mode: 'hint', payload: { mode: 'hint', problem: 'Đề bài gợi ý', solution: 'Lời giải', question: 'Gợi ý giúp mình', hintLevel: 1, previousHints: ['Gợi ý cũ'] } },
    { mode: 'resubmit', payload: { mode: 'resubmit', problem: 'Đề bài sửa lại', solution: 'Lời giải mới', previousSolution: 'Lời giải cũ', attemptNumber: 2 } },
  ];

  for (const item of cases) {
    recorder.calls.length = 0;
    await createDebateAnalysisWithMeta(item.payload, { gateway });
    expect(recorder.calls, `${item.mode} must be sent to Gemini`).toHaveLength(1);
    const systemPrompt = recorder.calls[0].body.systemInstruction.parts[0].text;
    const userPrompt = recorder.calls[0].body.contents[0].parts[0].text;
    expect(systemPrompt).toContain(DEBATE_PROMPT.slice(0, 120));
    expect(systemPrompt).toContain('Do not invent an error');
    expect(systemPrompt).toContain('discuss');
    expect(systemPrompt).toContain('hint');
    expect(systemPrompt).toContain('resubmit');
    expect(systemPrompt).not.toContain('Reveal the complete answer');
    expect(userPrompt).toContain(`<mode>${item.mode}</mode>`);
    expect(userPrompt).toContain('<problem>');
    expect(userPrompt).toContain('<learner_solution>');
    if (item.mode === 'hint') expect(userPrompt).toContain('<requested_hint_level>1</requested_hint_level>');
    if (item.mode === 'resubmit') expect(userPrompt).toContain('<previous_solution>');
    if (item.mode === 'discuss') expect(userPrompt).toContain('<follow_up_question>');
  }
});

test('Provider schemas stay server-side only and never reach browser bundles', () => {
  const serverOnlyMarkers = [
    'GEMINI_API_KEY',
    'GEMINI_API_KEY_2',
    'GEMINI_API_KEY_3',
    'ANYROUTER_LEARNING_API_KEY',
    'ANYROUTER_LEARNING_API_KEY_2',
    'ANYROUTER_LEARNING_API_KEY_3',
    'GEMINI_MODEL',
    'ANYROUTER_LEARNING_MODEL',
    'generativelanguage.googleapis.com',
    'anyrouter.dev',
    'x-goog-api-key',
  ];
  const skip = new Set(['playwright.config.js']);
  const frontendFiles = [
    ...readdirSync(ROOT, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.js') && !skip.has(entry.name))
      .map(entry => entry.name),
    ...readdirSync(join(ROOT, 'views'), { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
      .map(entry => join('views', entry.name)),
  ];

  for (const file of frontendFiles) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    for (const marker of serverOnlyMarkers) {
      expect(source, `${file} must not reference ${marker}`).not.toContain(marker);
    }
    expect(source, `${file} must not read process.env`).not.toContain('process.env');
  }

  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const marker of serverOnlyMarkers) expect(html).not.toContain(marker);
  expect(html).not.toContain('process.env');
});

test('Provider catalogue defines Gemini and AnyRouter in fallback order', () => {
  expect(AI_PROVIDERS.map(provider => provider.id)).toEqual(['gemini', 'anyrouter']);
  expect(AI_PROVIDERS[0]).toMatchObject({ role: 'primary', apiKeyEnv: 'GEMINI_API_KEY', defaultModel: 'gemini-3.5-flash' });
  expect(AI_PROVIDERS[1]).toMatchObject({ role: 'fallback', apiKeyEnv: 'ANYROUTER_LEARNING_API_KEY', defaultModel: 'anyrouter/free' });
});

test('AI status endpoint reports both providers without exposing secrets', async ({ request }) => {
  const response = await request.get('/api/ai/status');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  const body = await response.json();
  expect(body.ai).toMatchObject({ order: ['gemini', 'anyrouter'] });
  expect(body.ai.primary).toMatchObject({ id: 'gemini', configured: false, requiredEnv: 'GEMINI_API_KEY' });
  expect(body.ai.fallback).toMatchObject({ id: 'anyrouter', configured: false, requiredEnv: 'ANYROUTER_LEARNING_API_KEY' });
  expect(body.ai.providers.map(provider => provider.id)).toEqual(['gemini', 'anyrouter']);
  expect(body.ai.geminiKeyCount).toBe(0);
  expect(body.ai.geminiBackupKeyConfigured).toBe(false);
  expect(body.ai.anyrouterKeyCount).toBe(0);
  expect(body.ai.anyrouterBackupKeyConfigured).toBe(false);
  expect(body.gateway).toMatchObject({ maxRetries: 1, fallback: 'gemini -> anyrouter' });
  expect(JSON.stringify(body)).not.toMatch(/AIza[0-9A-Za-z\-_]{20,}|sk-ar-[A-Za-z0-9\-_]{10,}/);

  const methodNotAllowed = await request.post('/api/ai/status');
  expect(methodNotAllowed.status()).toBe(405);
});

test('AI_PROVIDER_ORDER overrides the real call order', async () => {
  const recorder = createRecorder(({ url }) => (providerOf(url) === 'gemini' ? geminiOk('{"ok":true}') : httpError(503, 'down')));
  const gateway = createAiGateway({
    env: { ...ALL_ENV, AI_PROVIDER_ORDER: 'anyrouter,gemini' },
    fetcher: recorder.fetcher,
    maxRetries: 0,
    retryDelayMs: 0,
  });

  const result = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U', validate: text => JSON.parse(text) });

  expect(result.provider).toBe('gemini');
  expect(recorder.calls.map(call => providerOf(call.url))).toEqual(['anyrouter', 'gemini']);
});

test('All providers failing returns a clear error and no fabricated analysis', async () => {
  const recorder = createRecorder(() => httpError(503, 'provider down'));
  const gateway = createAiGateway({ env: ALL_ENV, fetcher: recorder.fetcher, maxRetries: 0, retryDelayMs: 0 });

  const error = await gateway.complete({ systemPrompt: 'S', userPrompt: 'U' }).catch(caught => caught);

  expect(error).toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
  expect(error.value).toBeUndefined();
  expect(error.details.attempts.map(item => item.provider)).toEqual(['gemini', 'anyrouter']);
  const serialised = JSON.stringify(error.details);
  expect(serialised).not.toContain(GEMINI_KEY);
  expect(serialised).not.toContain(ANYROUTER_KEY);
});
