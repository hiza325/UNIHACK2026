import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import supportHandler, { createSupportReply, generateSupportReply } from '../api/support.js';

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function payload(text, language = 'vi') {
  return { language, messages: [{ role: 'user', text }] };
}

test('Support answers the documented OTP question without any provider call', async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Support must not call a network provider');
  };
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const reply = await generateSupportReply(payload('Tôi không nhận được mã OTP thì sao?'));
    expect(reply.status).toBe('answered');
    expect(reply.answers.map(answer => answer.id)).toEqual(['A03']);
    expect(reply.answers[0].answer).toBe('Đừng lo, bạn thử kiểm tra thư rác trước nhé. Nếu vẫn chưa thấy, hãy bấm gửi lại (hệ thống có giới hạn tần suất) hoặc thử một địa chỉ email khác.');
    expect(reply.text).toContain(reply.answers[0].answer);
    expect(reply.sources).toEqual([{ id: 'A03', question: 'Tôi không nhận được mã OTP thì sao?' }]);
    expect(fetchCalls).toBe(0);
    expect(process.env.GROQ_API_KEY).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Support handles Vietnamese without diacritics and returns the same entry', async () => {
  const accented = await generateSupportReply(payload('Tôi không nhận được mã OTP thì sao?'));
  const plain = await generateSupportReply(payload('toi khong nhan duoc ma otp'));
  expect(plain.status).toBe('answered');
  expect(plain.answers.map(answer => answer.id)).toEqual(['A03']);
  expect(plain.answers[0].id).toBe(accented.answers[0].id);
  expect(plain.answers[0].answer).toBe(accented.answers[0].answer);
});

test('Support combines multiple intents, capped at four documented answers', async () => {
  const reply = await generateSupportReply(payload(
    'Tôi không nhận được OTP, quên mật khẩu, làm sao mở khoá Error Hunter, và xác minh credential',
  ));
  expect(reply.status).toBe('answered');
  expect(reply.answers.map(answer => answer.id)).toEqual(['A03', 'A04', 'B064', 'A46']);
  expect(reply.answers).toHaveLength(4);
  expect(reply.text).toContain('1. Tôi không nhận được mã OTP thì sao?');
  expect(reply.text).toContain('4. Làm sao xác minh một credential?');
});

test('Support reports the part that has no documentation instead of inventing it', async () => {
  const reply = await generateSupportReply(payload('Tôi không nhận được OTP và cách nấu phở'));
  expect(reply.status).toBe('partial');
  expect(reply.answers.map(answer => answer.id)).toEqual(['A03']);
  expect(reply.unmatched.join(' ')).toContain('cách nấu phở');
  expect(reply.notes.join(' ')).toContain('cách nấu phở');
  expect(reply.text).toContain('cách nấu phở');
});

test('Support asks the user to choose when the topic is ambiguous', async () => {
  const reply = await generateSupportReply(payload('tài khoản'));
  expect(reply.status).toBe('clarify');
  expect(reply.answers).toEqual([]);
  expect(reply.candidates.length).toBeGreaterThanOrEqual(2);
  expect(reply.candidates.map(candidate => candidate.id)).toContain('A01');
  expect(reply.suggestions).toEqual(reply.candidates.map(candidate => candidate.question));
  expect(reply.text).toContain('Bạn chọn một câu hỏi');
});

test('Support refuses academic requests and unrelated topics', async () => {
  for (const query of ['giải giúp em bài toán này', 'đáp án bài tập', 'viết code python', 'học giỏi toán', 'tóm tắt bài giảng']) {
    const reply = await generateSupportReply(payload(query));
    expect(reply.status, query).toBe('out_of_scope');
    expect(reply.answers, query).toEqual([]);
    expect(reply.text, query).toContain('không giải bài học');
  }
  for (const query of ['thời tiết hôm nay', 'học phí bao nhiêu', 'giá bao nhiêu', 'bạn là AI gì', 'làm sao nấu phở']) {
    const reply = await generateSupportReply(payload(query));
    expect(reply.status, query).toBe('not_found');
    expect(reply.answers, query).toEqual([]);
    expect(reply.suggestions.length, query).toBeGreaterThan(0);
  }
});

test('Support uses a localized documentation notice for English and Japanese while keeping the stored answer', async () => {
  for (const [language, expected] of [
    ['en', 'currently available in Vietnamese'],
    ['jp', 'ベトナム語のみ'],
  ]) {
    const reply = await generateSupportReply(payload('Tôi không nhận được mã OTP thì sao?', language));
    expect(reply.language).toBe(language);
    expect(reply.notice).toContain(expected);
    expect(reply.text.startsWith(reply.notice)).toBe(true);
    expect(reply.answers[0].id).toBe('A03');
    expect(reply.answers[0].answer).toContain('thư rác');
  }
});

test('Support keeps long documented answers intact', async () => {
  const reply = await generateSupportReply(payload('Làm sao xác minh một credential?'));
  const answer = reply.answers[0].answer;
  expect(reply.text).toContain(answer);
  expect(reply.text.length).toBeGreaterThan(answer.length);
  expect(reply.text.endsWith('…')).toBe(false);
});

test('Support validates input, origin and method', async () => {
  const methodResponse = createResponseRecorder();
  await supportHandler({ method: 'GET', headers: {} }, methodResponse);
  expect(methodResponse.statusCode).toBe(405);
  expect(methodResponse.headers.Allow).toBe('POST');

  const originResponse = createResponseRecorder();
  await supportHandler({
    method: 'POST',
    headers: { origin: 'https://evil.example', host: 'paradox.local' },
    body: payload('Xem lịch sử ở đâu?'),
  }, originResponse);
  expect(originResponse.statusCode).toBe(403);
  expect(originResponse.body.code).toBe('FORBIDDEN_ORIGIN');

  const malformedResponse = createResponseRecorder();
  await supportHandler({
    method: 'POST',
    headers: { origin: 'http://paradox.local', host: 'paradox.local' },
    body: '{not json',
  }, malformedResponse);
  expect(malformedResponse.statusCode).toBe(400);
  expect(malformedResponse.body.code).toBe('INVALID_INPUT');

  const emptyResponse = createResponseRecorder();
  await supportHandler({
    method: 'POST',
    headers: { origin: 'http://paradox.local', host: 'paradox.local' },
    body: { messages: [{ role: 'assistant', text: 'hello' }] },
  }, emptyResponse);
  expect(emptyResponse.statusCode).toBe(400);
  expect(emptyResponse.body.code).toBe('INVALID_INPUT');
});

test('Support rejects messages over the input limit without truncating them silently', async () => {
  const response = createResponseRecorder();
  await supportHandler({
    method: 'POST',
    headers: { origin: 'http://localhost:8173', host: 'localhost:8173', 'x-forwarded-for': '198.51.100.20' },
    body: { language: 'vi', messages: [{ role: 'user', text: 'x'.repeat(1201) }] },
  }, response);
  expect(response.statusCode).toBe(400);
  expect(response.body.code).toBe('INVALID_INPUT');
  expect(response.body.error).toContain('1200');
});

test('Support handler returns documented replies and rate-limits abusive clients', async () => {
  const response = createResponseRecorder();
  await supportHandler({
    method: 'POST',
    headers: { origin: 'http://localhost:8173', host: 'localhost:8173', 'x-forwarded-for': '198.51.100.7' },
    body: payload('Xem lịch sử ở đâu?'),
  }, response);
  expect(response.statusCode).toBe(200);
  expect(response.headers['Cache-Control']).toBe('no-store');
  expect(response.body.status).toBe('answered');
  expect(response.body.answers[0].id).toBe('A17');
  expect(response.body.sources[0].id).toBe('A17');
  expect(response.body.provider).toBeUndefined();

  let lastResponse;
  for (let attempt = 0; attempt < 13; attempt += 1) {
    lastResponse = createResponseRecorder();
    await supportHandler({
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.55' },
      body: { language: 'vi', messages: [{ role: 'user', text: 'Xem lịch sử ở đâu?' }] },
    }, lastResponse);
  }
  expect(lastResponse.statusCode).toBe(429);
  expect(lastResponse.body.code).toBe('RATE_LIMITED');
});

test('support source has no AI gateway, prompt, token or provider references', async () => {
  const files = ['../api/support.js', '../api/_support-compose.js', '../api/_support-intent.js'];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    expect(source, file).not.toMatch(/createAiGateway|SUPPORT_PROMPT|maxOutputTokens|thinkingLevel|_support-providers/);
    expect(source, file).not.toMatch(/GROQ_API_KEY|GEMINI_API_KEY/);
  }
  const faq = await readFile(new URL('../api/_support-faq.js', import.meta.url), 'utf8');
  expect(faq).not.toMatch(/GROQ_API_KEY|GEMINI_API_KEY/);
});

test('createSupportReply stays a string wrapper around the deterministic reply', async () => {
  const text = await createSupportReply(payload('Quên mật khẩu thì làm gì?'));
  expect(typeof text).toBe('string');
  expect(text).toContain('Quên mật khẩu');
  expect(text).toContain('mật khẩu mới');
});
