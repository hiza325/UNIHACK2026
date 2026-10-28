import { expect, test } from '@playwright/test';
import { normalizeText, retrieveSupportFaq, SUPPORT_RETRIEVAL_META } from '../api/_support-retrieval.js';

const documented = [
  ['Tôi không nhận được mã OTP thì phải làm sao?', 'A03'],
  ['Làm thế nào để đặt lại mật khẩu?', 'A04'],
  ['Dữ liệu học tập của tôi được lưu ở đâu?', 'A38'],
  ['Làm sao mở khóa thành tựu Error Hunter?', 'B064'],
  ['Xem lịch sử ở đâu?', 'A17'],
  ['API key của AI nằm ở đâu?', 'B085'],
  ['Làm sao để đổi mật khẩu khi quên', 'A36'],
];

test('retrieval finds the documented entry for common support questions', () => {
  for (const [query, expectedId] of documented) {
    const result = retrieveSupportFaq(query);
    expect(result.tier, query).toBe('strong');
    expect(result.matches[0]?.id, query).toBe(expectedId);
  }
});

test('keyword-only and paraphrased queries reach documented entries', () => {
  const keywordCases = [
    ['otp', ['A03', 'A32', 'B020']],
    ['lịch sử', ['A17']],
    ['thành tựu', ['A48', 'B080', 'B070']],
    ['pdf', ['A09', 'B029']],
    ['upload', ['B028']],
    ['màu nền', ['B091']],
    ['đổi sang tiếng nhật', ['B089', 'B090']],
    ['blockchain', ['A45', 'B078']],
    ['trang web bị trắng', ['B096']],
    ['download dữ liệu', ['B060']],
    ['logout', ['B004']],
  ];
  for (const [query, expectedIds] of keywordCases) {
    const result = retrieveSupportFaq(query);
    expect(result.tier, query).not.toBe('none');
    expect(result.matches.some(match => expectedIds.includes(match.id)), query).toBe(true);
  }
});

test('retrieval normalizes Vietnamese diacritics and casing', () => {
  expect(normalizeText('Đặt Lại MẬT KHẨU')).toBe('dat lai mat khau');

  const accented = retrieveSupportFaq('Tôi không nhận được mã OTP');
  const plain = retrieveSupportFaq('toi khong nhan duoc ma otp');
  expect(plain.matches[0]?.id).toBe('A03');
  expect(plain.matches[0]?.id).toBe(accented.matches[0]?.id);
});

test('retrieval refuses to invent an answer for undocumented topics', () => {
  for (const query of ['thời tiết hôm nay thế nào', 'học phí bao nhiêu', 'avatar', 'thông báo', '']) {
    const result = retrieveSupportFaq(query);
    expect(result.tier, query).toBe('none');
    expect(result.matches, query).toEqual([]);
  }
});

test('retrieval returns bounded, unique matches with traceable sources', () => {
  const result = retrieveSupportFaq('thành tựu và Learning Passport', { limit: 2 });
  expect(result.matches.length).toBeGreaterThan(0);
  expect(result.matches.length).toBeLessThanOrEqual(2);
  const ids = result.matches.map(match => match.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const match of result.matches) {
    expect(match.answer.length).toBeGreaterThan(0);
    expect(match.source.paragraph).toBeGreaterThan(0);
  }
  expect(SUPPORT_RETRIEVAL_META.documentCount).toBe(150);
});
