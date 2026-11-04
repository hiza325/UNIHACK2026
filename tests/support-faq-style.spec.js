import { test, expect } from '@playwright/test';
import { SUPPORT_FAQ } from '../api/_support-faq.js';
import { retrieveSupportFaq } from '../api/_support-retrieval.js';

test('all FAQ answers keep a friendly, plain-text style', () => {
  expect(SUPPORT_FAQ).toHaveLength(150);
  const ids = new Set();
  for (const entry of SUPPORT_FAQ) {
    expect(ids.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
    ids.add(entry.id);
    expect(entry.answer.length, entry.id).toBeGreaterThan(15);
    expect(entry.answer.length, entry.id).toBeLessThanOrEqual(400);
    expect(entry.answer, entry.id).not.toMatch(/\*\*|__|`|<[a-z/]|>/i);
    expect(entry.answer.trim(), entry.id).toMatch(/[.!?…”"]$/);
    expect(entry.answer, entry.id).not.toMatch(/cung cấp (mật khẩu|mã otp)|gửi (mật khẩu|mã otp) (cho|qua chat)/i);
    // The support knowledge base must not describe the retired AI-provider flow.
    expect(entry.answer, entry.id).not.toMatch(/GROQ_API_KEY|GEMINI_API_KEY|provider AI/i);
  }
});

test('common support topics retrieve the rewritten documented answer', () => {
  const topics = [
    ['Tôi không nhận được mã OTP thì sao?', /thư rác/i],
    ['Quên mật khẩu thì làm gì?', /Quên mật khẩu/i],
    ['Dữ liệu của tôi được lưu ở đâu?', /trình duyệt|Supabase/i],
    ['Làm sao mở khoá First Step?', /phiên học đầu tiên/i],
    ['Chatbot không trả lời thì kiểm tra gì?', /tra cứu trực tiếp|không gọi dịch vụ AI/i],
    ['Xoá dữ liệu trình duyệt có mất tiến độ không?', /chế độ khách|máy chủ/i],
    ['Làm sao mở khoá Consistency?', /7 ngày/i],
    ['Tôi xem tiến độ thành tựu ở đâu?', /Profile/i],
  ];

  for (const [query, expected] of topics) {
    const result = retrieveSupportFaq(query);
    expect(result.tier, query).not.toBe('none');
    expect(result.matches[0].answer, query).toMatch(expected);
  }
});
