import { expect, test } from '@playwright/test';
import { requestDebateAnalysis } from '../debate-ai.js';
import { actionMethods } from '../app-actions.js';

const validAnalysis = {
  status: 'correct',
  summary: 'Lời giải đúng.',
  confidence: 0.95,
  issues: [],
  strengths: ['Lập luận rõ ràng.'],
  nextQuestion: '',
  reply: '',
};

test('Debate client deduplicates concurrent analysis and reuses its short-lived cache', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ analysis: validAnalysis }), { status: 200 });
  };
  try {
    const payload = { mode: 'analyze', problem: 'Cache test problem 7 + 8', solution: '15', language: 'vi' };
    const [first, second] = await Promise.all([requestDebateAnalysis(payload), requestDebateAnalysis(payload)]);
    first.summary = 'Changed locally';
    const cached = await requestDebateAnalysis(payload);
    expect(calls).toBe(1);
    expect(second.summary).toBe('Lời giải đúng.');
    expect(cached.summary).toBe('Lời giải đúng.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Debate client does not cache contextual discussion requests', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ analysis: { ...validAnalysis, reply: 'Hãy kiểm tra bước cuối.' } }), { status: 200 });
  };
  try {
    const payload = { mode: 'discuss', problem: 'Discussion cache test', solution: 'Một lời giải', question: 'Tiếp theo là gì?' };
    await requestDebateAnalysis(payload);
    await requestDebateAnalysis(payload);
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Debate client preserves HTTP status, server code and safe request id', async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    { status: 400, code: 'INVALID_INPUT' },
    { status: 401, code: 'AUTH_REQUIRED' },
    { status: 403, code: 'FORBIDDEN' },
    { status: 429, code: 'RATE_LIMIT' },
    { status: 500, code: 'INTERNAL_ERROR' },
    { status: 502, code: 'UPSTREAM_ERROR' },
  ];
  try {
    for (const item of cases) {
      globalThis.fetch = async () => new Response(JSON.stringify({
        error: 'Safe public error', code: item.code, requestId: `request-${item.status}`,
      }), { status: item.status, headers: { 'Content-Type': 'application/json' } });
      const error = await requestDebateAnalysis({
        mode: 'analyze', problem: `HTTP status test ${item.status}`, solution: 'Synthetic solution',
      }).catch(caught => caught);
      expect(error).toMatchObject({ status: item.status, code: item.code, requestId: `request-${item.status}` });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Debate client aborts at its deadline and exposes TIMEOUT', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  try {
    const error = await requestDebateAnalysis(
      { mode: 'analyze', problem: 'Client timeout test', solution: 'Synthetic solution' },
      { timeoutMs: 5 },
    ).catch(caught => caught);
    expect(error).toMatchObject({ code: 'TIMEOUT' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Debate UI maps auth, validation, rate-limit, provider and timeout failures safely', () => {
  const context = { t: key => key };
  const map = error => actionMethods.debateErrorText.call(context, error);

  expect(map({ status: 400, code: 'INVALID_INPUT' })).toBe('debateInvalidInput');
  expect(map({ status: 401, code: 'AUTH_REQUIRED' })).toBe('authSessionExpired');
  expect(map({ status: 403, code: 'FORBIDDEN' })).toBe('debateForbidden');
  expect(map({ status: 429, code: 'RATE_LIMIT' })).toBe('debateRateLimit');
  expect(map({ status: 500, code: 'INTERNAL_ERROR' })).toBe('debateApiError');
  expect(map({ status: 502, code: 'UPSTREAM_ERROR' })).toBe('debateApiError');
  expect(map({ status: 502, code: 'INVALID_OUTPUT' })).toBe('debateInvalidOutput');
  expect(map({ code: 'TIMEOUT' })).toBe('debateTimeout');
});
