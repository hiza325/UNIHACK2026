import { expect, test } from '@playwright/test';
import { requestDebateAnalysis } from '../debate-ai.js';

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
