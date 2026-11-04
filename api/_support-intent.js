import { normalizeText, tokenize } from './_support-retrieval.js';

/*
 * Deterministic query preparation for the FAQ-only support assistant.
 *
 * No model is involved: these rules only decide how a question is split and
 * whether it belongs to the documented website-support scope.
 */

// Vocabulary that anchors a question to the PARADOX website. Anchors are
// intentionally domain terms; generic words such as "bài" or "hệ thống" are
// not enough on their own.
const DOMAIN_ANCHORS = [
  'paradox', 'otp', 'ma otp', 'ma xac minh', 'ma xac thuc', 'email',
  'mat khau', 'quen mat khau', 'doi mat khau', 'dat lai mat khau',
  'dang nhap', 'dang xuat', 'dang ky', 'tai khoan', 'profile', 'ho so',
  'audit', 'bai audit', 'nop bai', 'bai nop', 'cham bai', 'diem', 'bang diem',
  'nhan xet', 'loi giai', 'goi y', 'practice', 'luyen tap', 'phien hoc',
  'lich su', 'history', 'analytics', 'phan tich', 'dashboard', 'bang dieu khien',
  'tien do', 'streak', 'chuoi ngay', 'thanh tuu', 'achievement', 'badge', 'huy hieu',
  'first step', 'error hunter', 'independent learner', 'comeback master',
  'consistency', 'master of reasoning',
  'passport', 'learning passport', 'credential', 'chung chi', 'chung nhan',
  'certificate', 'qr', 'ma qr', 'xac minh', 'verify', 'blockchain', 'on chain',
  'avalanche', 'fuji', 'testnet', 'du lieu', 'hoc tap', 'quyen rieng tu',
  'privacy', 'xoa tai khoan', 'xoa du lieu', 'xuat du lieu', 'download', 'export',
  'giao dien', 'theme', 'che do toi', 'che do sang', 'mau nen', 'dark mode', 'ngon ngu', 'language',
  'tieng viet', 'tieng anh', 'tieng nhat', 'pdf', 'upload', 'tai tep',
  'dinh dang', 'file', 'docx', 'word', 'chatbot', 'tro ly', 'ho tro', 'support',
  'loi', 'error', '503', 'trang trang', 'white screen', 'phim tat', 'shortcut',
  'am thanh', 'thong bao', 'notification', 'api key', 'bao mat', 'security',
  'google', 'sso', 'bai cua toi', 'bai sai',
];

// Requests to solve coursework. They are only out of scope when the question
// has no website-support anchor (for example "cách nộp bài audit" stays valid).
const ACADEMIC_PATTERNS = [
  /\bgiai\b(?!\s*thich\b)/,
  /\bgiai dap\b/,
  /\bdap an\b/,
  /\blam ho\b/,
  /\bviet ho\b/,
  /\bbai tap\b/,
  /\bbai toan\b/,
  /\btoan\b/,
  /\bvat ly\b/,
  /\bhoa hoc\b/,
  /\bngu van\b/,
  /\bbai van\b/,
  /\bvan mau\b/,
  /\blap trinh\b/,
  /\bcode\b/,
  /\bhoc gioi\b/,
  /\bday toi\b/,
  /\bhuong dan giai\b/,
  /\bgiai de\b/,
  /\bde thi\b/,
  /\blam bai\b/,
  /\bviet bai\b/,
  /\bhoc bai\b/,
  /\btom tat\b/,
];

const GREETING = /^(?:xin chao|chao|hello|hi|hey|alo)\b/;
const SPLIT_WORDS = /\s+(?:va|và|voi|với|roi|rồi|sau do|sau đó|con|còn|and|also|plus)\s+/giu;

function paddedNormalized(value) {
  return ` ${normalizeText(value)} `;
}

export function hasDomainAnchor(value) {
  const normalized = paddedNormalized(value);
  if (!normalized.trim()) return false;
  const tokens = new Set(tokenize(value));
  return DOMAIN_ANCHORS.some(anchor => {
    if (anchor.includes(' ')) return normalized.includes(` ${anchor} `);
    return tokens.has(anchor);
  });
}

export function isAcademicRequest(value) {
  const normalized = normalizeText(value);
  return ACADEMIC_PATTERNS.some(pattern => pattern.test(normalized));
}

export function isOutOfScope(value) {
  return isAcademicRequest(value) && !hasDomainAnchor(value);
}

/**
 * Split a multi-part question into at most `maxSegments` clauses. This is a
 * rule-based split; it never rewrites the user's words.
 */
export function segmentSupportQuery(value, maxSegments = 4) {
  const text = String(value || '').trim();
  if (!text) return [];

  const marked = text
    .replace(/[?!;]+/g, '|')
    .replace(/\n+/g, '|')
    .replace(SPLIT_WORDS, '|')
    .replace(/\s*,\s*/g, '|');

  let parts = marked.split('|').map(part => part.trim()).filter(Boolean);
  parts = parts.filter(part => {
    const normalized = normalizeText(part);
    return !(GREETING.test(normalized) && tokenize(part).length <= 2);
  });

  // Merge fragments that carry no meaningful content into a neighbour.
  const merged = [];
  for (const part of parts) {
    const short = tokenize(part).length < 2;
    const anchored = hasDomainAnchor(part);
    if (short && !anchored && merged.length) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`.trim();
    } else if (short && !anchored) {
      continue;
    } else {
      merged.push(part);
    }
  }

  if (!merged.length) return [];
  if (merged.length <= maxSegments) return merged;
  return [...merged.slice(0, maxSegments - 1), merged.slice(maxSegments - 1).join(' ')];
}
