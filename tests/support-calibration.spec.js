import { expect, test } from '@playwright/test';
import { composeSupportReply } from '../api/_support-compose.js';
import { SUPPORT_FAQ } from '../api/_support-faq.js';

/*
 * Representative acceptance set used to calibrate the lexical retrieval and
 * ambiguity thresholds. Every case is checked end to end through the composer,
 * so this suite measures the answer a user would actually receive.
 *
 * The set covers OTP, passwords, login/signup, achievements, credentials, QR,
 * multi-intent questions, no-diacritic Vietnamese, out-of-scope requests,
 * unknown topics and deliberately broad ambiguous prompts.
 */
const CASES = [
  // OTP
  ['Tôi không nhận được mã OTP thì sao?', 'ANSWER', ['A03']],
  ['không thấy email OTP', 'ANSWER', ['A03', 'B018']],
  ['mã OTP có hiệu lực bao lâu', 'ANSWER', ['A33']],
  ['OTP gồm mấy chữ số', 'ANSWER', ['B016']],
  ['gửi lại mã OTP', 'ANSWER', ['A03', 'B020']],
  ['mã xác minh không tới email', 'ANSWER', ['A03']],

  // Password / account
  ['quên mật khẩu thì làm gì', 'ANSWER', ['A04']],
  ['đặt lại mật khẩu ở đâu', 'ANSWER', ['A04', 'A36']],
  ['đổi mật khẩu ở đâu', 'ANSWER', ['A36']],
  ['mật khẩu phải dài bao nhiêu ký tự', 'ANSWER', ['B009']],
  ['đăng xuất có mất dữ liệu không', 'ANSWER', ['B005']],
  ['tôi quên mật khẩu đăng nhập', 'ANSWER', ['A04']],

  // Login / signup
  ['tôi đăng nhập bằng gì', 'ANSWER', ['B001']],
  ['đăng ký tài khoản gồm những bước nào', 'ANSWER', ['A02']],
  ['có đăng nhập bằng Google không', 'ANSWER', ['B003']],
  ['quên email đã đăng ký thì sao', 'ANSWER', ['B008']],
  ['đăng nhập nhiều thiết bị được không', 'ANSWER', ['B006']],

  // Achievements
  ['làm sao mở khoá Error Hunter', 'ANSWER', ['B064']],
  ['làm sao mở khoá First Step', 'ANSWER', ['B063']],
  ['làm sao mở khoá Consistency', 'ANSWER', ['B068']],
  ['xem tiến độ thành tựu ở đâu', 'ANSWER', ['B070']],
  ['có bao nhiêu thành tựu', 'ANSWER', ['A48']],
  ['thành tựu có mất không', 'ANSWER', ['A50']],
  ['mở khóa huy hiệu Error Hunter', 'ANSWER', ['B064']],
  ['First Step', 'ANSWER', ['B063']],
  ['Error Hunter', 'ANSWER', ['B064']],

  // Credential / certificate / QR
  ['làm sao xác minh credential', 'ANSWER', ['A46']],
  ['verified credential là gì', 'ANSWER', ['A44']],
  ['khi nào được cấp credential', 'ANSWER', ['B072']],
  ['credential có thật sự on-chain không', 'ANSWER', ['A45', 'B078']],
  ['mã credential dùng để làm gì', 'ANSWER', ['B073']],
  ['quét mã QR để xác minh credential ở đâu', 'ANSWER', ['A46', 'B074']],
  ['xác minh QR ở đâu', 'ANSWER', ['B074', 'A46']],
  ['mã QR nằm ở đâu trên chứng nhận', 'ANSWER', ['A46', 'B074']],

  // Multi-intent
  ['Tôi không nhận được OTP, quên mật khẩu, làm sao mở khoá Error Hunter, và xác minh credential', 'ANSWER', ['A03', 'A04', 'B064', 'A46']],
  ['đổi mật khẩu và xoá tài khoản', 'ANSWER', ['A36', 'B013']],
  ['đăng nhập bằng gì và xem thành tựu ở đâu', 'ANSWER', ['B001', 'B070']],
  ['OTP hết hạn và quên mật khẩu', 'ANSWER', ['A33', 'B020', 'A04']],
  ['PDF và ảnh có tải lên được không', 'ANSWER', ['A09', 'B028']],
  ['quên mật khẩu và không nhận được mã xác minh', 'ANSWER', ['A04', 'A03']],

  // No diacritics
  ['toi khong nhan duoc ma otp', 'ANSWER', ['A03']],
  ['lam sao mo khoa error hunter', 'ANSWER', ['B064']],
  ['xac minh credential o dau', 'ANSWER', ['A46', 'B074']],
  ['doi mat khau o dau', 'ANSWER', ['A36']],
  ['dang ky tai khoan gom nhung buoc nao', 'ANSWER', ['A02']],

  // Other documented topics
  ['đổi màu nền ở đâu', 'ANSWER', ['B091']],
  ['đổi ngôn ngữ sang tiếng Anh', 'ANSWER', ['B090']],
  ['xuất dữ liệu học tập', 'ANSWER', ['B060']],
  ['xóa tài khoản', 'ANSWER', ['B013']],
  ['dữ liệu lưu trên máy chủ ở đâu', 'ANSWER', ['A38', 'B082']],
  ['Chatbot không trả lời thì kiểm tra gì?', 'ANSWER', ['B097']],

  // Out of scope
  ['giải bài toán này', 'OUT', []],
  ['đáp án bài tập', 'OUT', []],
  ['viết code python', 'OUT', []],
  ['học giỏi toán', 'OUT', []],
  ['tóm tắt bài giảng', 'OUT', []],
  ['hướng dẫn làm bài văn', 'OUT', []],
  ['cho mình đáp án', 'OUT', []],

  // Not documented
  ['thời tiết hôm nay', 'NONE', []],
  ['học phí bao nhiêu', 'NONE', []],
  ['giá bao nhiêu', 'NONE', []],
  ['bạn là AI gì', 'NONE', []],
  ['làm sao nấu phở', 'NONE', []],
  ['mã', 'NONE', []],

  // Broad prompts must ask for a choice, not guess
  ['tài khoản', 'CLARIFY', []],
  ['thành tựu', 'CLARIFY', []],
  ['otp', 'CLARIFY', []],
  ['đăng nhập', 'CLARIFY', []],
  ['dashboard', 'CLARIFY', []],
  ['mật khẩu', 'CLARIFY', []],
  ['credential', 'CLARIFY', []],
  ['tạo tài khoản cần gì', 'CLARIFY', []],
];

test('calibration set: every case returns the documented answer or a safe fallback', () => {
  const failures = [];
  for (const [query, expectedStatus, expectedIds] of CASES) {
    const reply = composeSupportReply({ query, language: 'vi' });
    let ok = false;
    if (expectedStatus === 'ANSWER') {
      ok = (reply.status === 'answered' || reply.status === 'partial')
        && expectedIds.some(id => reply.answers.some(answer => answer.id === id));
    } else if (expectedStatus === 'OUT') {
      ok = reply.status === 'out_of_scope';
    } else if (expectedStatus === 'NONE') {
      ok = reply.status === 'not_found';
    } else {
      ok = reply.status === 'clarify';
    }
    if (!ok) {
      failures.push({
        query,
        expectedStatus,
        expectedIds,
        receivedStatus: reply.status,
        receivedIds: reply.answers.map(answer => answer.id),
        candidates: reply.candidates.map(candidate => candidate.id),
      });
    }
  }
  expect(failures).toEqual([]);
  expect(CASES.length).toBeGreaterThanOrEqual(60);
});

test('broad ambiguous prompts offer documented choices and never invent an answer', () => {
  for (const query of ['tài khoản', 'thành tựu', 'otp', 'đăng nhập', 'dashboard', 'mật khẩu', 'credential']) {
    const reply = composeSupportReply({ query, language: 'vi' });
    expect(reply.status, query).toBe('clarify');
    expect(reply.answers, query).toEqual([]);
    expect(reply.candidates.length, query).toBeGreaterThanOrEqual(2);
    expect(reply.candidates.length, query).toBeLessThanOrEqual(3);
    for (const candidate of reply.candidates) {
      expect(candidate.question.length, query).toBeGreaterThan(0);
      expect(candidate.id, query).toMatch(/^[AB]\d{2,3}$/);
    }
  }
});

test('every canonical FAQ question returns its own stored answer verbatim', () => {
  const failures = [];
  for (const entry of SUPPORT_FAQ) {
    const reply = composeSupportReply({ query: entry.question, language: 'vi' });
    const answer = reply.answers.find(item => item.id === entry.id);
    if (!answer || answer.answer !== entry.answer) {
      failures.push({ id: entry.id, status: reply.status, received: reply.answers.map(item => item.id) });
    }
  }
  expect(failures).toEqual([]);
});

test('the ambiguous signup prompt lists the signup entry as a choice', () => {
  const reply = composeSupportReply({ query: 'tạo tài khoản cần gì', language: 'vi' });
  expect(reply.status).toBe('clarify');
  expect(reply.candidates.map(candidate => candidate.id)).toContain('A02');
});
