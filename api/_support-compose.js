import { findExactSupportFaq, normalizeText, retrieveSupportFaq, tokenize } from './_support-retrieval.js';
import { hasDomainAnchor, isOutOfScope, segmentSupportQuery } from './_support-intent.js';

/*
 * Deterministic reply composition for the FAQ-only support assistant.
 *
 * Only the `question`, `answer`, `category`, `id` and `source` values stored in
 * SUPPORT_FAQ are shown. The fixed strings below are UI copy, not generated
 * guidance. Answers are never truncated or rephrased.
 */

const MAX_ANSWERS = 4;
// Stand-alone broad terms map to several documented questions. Asking which
// one the user means is safer than choosing a single unrelated entry.
const BROAD_TERMS = new Set([
  'tai khoan', 'mat khau', 'otp', 'credential', 'thanh tuu', 'dang nhap',
  'dashboard', 'audit', 'passport', 'huy hieu', 'chung chi', 'chung nhan',
]);
// Calibrated against tests/support-calibration.spec.js. A second result that is
// nearly as strong but belongs to another topic is ambiguous, so the user is
// asked to choose instead of receiving a potentially wrong answer.
const AMBIGUITY_RATIO = 0.95;

const STARTER_SUGGESTIONS = {
  vi: [
    'Tôi không nhận được mã OTP thì sao?',
    'Quên mật khẩu thì làm gì?',
    'Dữ liệu học tập của tôi được lưu ở đâu?',
    'Làm sao xác minh một credential?',
  ],
  en: [
    'What if I do not receive my OTP code?',
    'What do I do if I forgot my password?',
    'Where is my learning data stored?',
    'How do I verify a credential?',
  ],
  jp: [
    'OTPコードが届かない場合は？',
    'パスワードを忘れた場合は？',
    '学習データはどこに保存されますか？',
    '資格情報を確認するには？',
  ],
};

const COPY = {
  vi: {
    heading: 'Theo tài liệu PARADOX AI:',
    multipleHeading: 'Theo tài liệu PARADOX AI, mình tìm thấy các hướng dẫn sau:',
    unmatched: 'Mình chưa có hướng dẫn cho phần:',
    clarify: 'Mình chưa xác định rõ bạn muốn hỏi mục nào. Bạn chọn một câu hỏi dưới đây nhé:',
    outOfScope: 'Trợ lý này chỉ hướng dẫn sử dụng website PARADOX AI, không giải bài học. Bạn có thể dùng AI Audit hoặc Practice Lab cho bài học.',
    outOfScopeNote: 'Phần sau nằm ngoài phạm vi hướng dẫn sử dụng website:',
    notFound: 'Mình chưa tìm thấy hướng dẫn chính thức cho trường hợp này trong tài liệu PARADOX AI. Bạn mô tả thêm lỗi hoặc thao tác đang gặp phải để mình xác định hướng xử lý phù hợp hơn nhé. Nếu vẫn chưa giải quyết được, bạn nên liên hệ đội hỗ trợ của PARADOX AI.',
    docsViOnly: null,
    limitNote: 'Mình chỉ hiển thị tối đa 4 mục phù hợp nhất; bạn có thể hỏi riêng từng phần để xem đầy đủ.',
  },
  en: {
    heading: 'From the PARADOX AI documentation:',
    multipleHeading: 'I found these documented guides:',
    unmatched: 'I do not have documentation for:',
    clarify: 'I could not tell which topic you mean. Please choose one of these documented questions:',
    outOfScope: 'This assistant only explains how to use the PARADOX AI website and does not solve coursework. Please use AI Audit or Practice Lab for learning questions.',
    outOfScopeNote: 'These parts are outside website-support scope:',
    notFound: 'I could not find official guidance for this case in the PARADOX AI documentation. Tell me a little more about the error or the step you are on, and I will help you narrow it down. If it still is not resolved, please contact PARADOX AI support.',
    docsViOnly: 'The support documentation is currently available in Vietnamese; the answer below is shown in its original wording.',
    limitNote: 'Only the four closest documented items are shown; ask about each part separately for its full answer.',
  },
  jp: {
    heading: 'PARADOX AIの資料より:',
    multipleHeading: '関連する資料が見つかりました:',
    unmatched: '次の内容に関する資料はありません:',
    clarify: 'どの内容か特定できませんでした。以下の資料から選んでください:',
    outOfScope: 'このアシスタントはPARADOX AIサイトの使い方のみを案内し、学習問題には回答しません。学習の質問にはAI AuditまたはPractice Labをご利用ください。',
    outOfScopeNote: '次の内容はサイト案内の対象外です:',
    notFound: 'この件についてPARADOX AIの公式資料に見つけられませんでした。表示されているエラーや操作内容をもう少し教えていただければ、一緒に確認します。解決しない場合はPARADOX AIのサポートまでご連絡ください。',
    docsViOnly: 'サポート資料は現在ベトナム語のみです。以下の回答は原文のまま表示しています。',
    limitNote: '最も近い4件のみ表示しています。各内容を個別に質問すると全文を確認できます。',
  },
};

function stripNumbering(question) {
  return String(question || '').replace(/^\s*\d+\.\s*/, '').trim();
}

// Part A and Part B use different category labels for the same topic
// (for example "Learning Passport & Credential" and "7. Learning Passport &
// Credential"). Compare the label without its numbering.
function topicKey(category) {
  return normalizeText(category).replace(/^\d+\s+/, '').trim();
}

function toAnswer(match) {
  return {
    id: match.id,
    question: stripNumbering(match.question),
    answer: match.answer,
    category: match.category,
    source: match.source,
  };
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter(item => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function starterSuggestions(language) {
  return (STARTER_SUGGESTIONS[language] || STARTER_SUGGESTIONS.vi).slice();
}

function numberedQuestions(candidates) {
  return candidates.map((candidate, index) => `${index + 1}. ${candidate.question}`).join('\n');
}

function exactDocumentedReply(exact, copy, lang) {
  const answer = toAnswer(exact);
  const body = `${copy.heading}\n1. ${answer.question}\n${answer.answer}`;
  return {
    status: 'answered',
    text: copy.docsViOnly ? `${copy.docsViOnly}\n\n${body}` : body,
    answers: [answer],
    unmatched: [],
    outOfScope: [],
    candidates: [],
    notes: [],
    notice: copy.docsViOnly,
    sources: [{ id: answer.id, question: answer.question }],
    grounded: true,
    suggestions: starterSuggestions(lang),
    language: lang,
    normalizedQuery: normalizeText(answer.question),
  };
}

/**
 * Build a reply from stored FAQ entries only.
 *
 * @param {{query: string, language?: string}} input
 * @returns {object} deterministic reply payload
 */
export function composeSupportReply({ query, language = 'vi' }) {
  const lang = COPY[language] ? language : 'vi';
  const copy = COPY[lang];
  const text = String(query || '').trim();
  const segments = segmentSupportQuery(text);

  if (!text) {
    return {
      status: 'not_found',
      text: copy.notFound,
      answers: [],
      unmatched: [],
      outOfScope: [],
      candidates: [],
      notes: [],
      notice: copy.docsViOnly,
      sources: [],
      grounded: false,
      suggestions: starterSuggestions(lang),
      language: lang,
      normalizedQuery: '',
    };
  }

  // A question copied from the knowledge base always answers itself. This also
  // covers documented topics whose vocabulary is not in the anchor list.
  const exact = findExactSupportFaq(text);
  if (exact) return exactDocumentedReply(exact, copy, lang);

  // Check scope before segmentation: short academic questions such as
  // "cho mình đáp án" have no content segment but are still out of scope.
  if (isOutOfScope(text)) {
    return {
      status: 'out_of_scope',
      text: copy.outOfScope,
      answers: [],
      unmatched: [],
      outOfScope: [text],
      candidates: [],
      notes: [],
      notice: copy.docsViOnly,
      sources: [],
      grounded: false,
      suggestions: starterSuggestions(lang),
      language: lang,
      normalizedQuery: normalizeText(text),
    };
  }

  if (!segments.length) {
    return {
      status: 'not_found',
      text: copy.notFound,
      answers: [],
      unmatched: [text],
      outOfScope: [],
      candidates: [],
      notes: [],
      notice: copy.docsViOnly,
      sources: [],
      grounded: false,
      suggestions: starterSuggestions(lang),
      language: lang,
      normalizedQuery: normalizeText(text),
    };
  }

  const answers = [];
  const unmatched = [];
  const outOfScope = [];
  const candidates = [];
  const suggestions = [];
  let overflow = false;

  for (const segment of segments) {
    const exactMatch = findExactSupportFaq(segment);
    if (exactMatch) {
      if (answers.length >= MAX_ANSWERS) {
        overflow = true;
        continue;
      }
      if (!answers.some(answer => answer.id === exactMatch.id)) answers.push(toAnswer(exactMatch));
      continue;
    }

    if (isOutOfScope(segment)) {
      outOfScope.push(segment);
      continue;
    }

    const retrieval = retrieveSupportFaq(segment, { limit: 4 });
    if (!retrieval.matches.length || retrieval.tier === 'none') {
      unmatched.push(segment);
      continue;
    }

    const best = retrieval.matches[0];
    const exact = normalizeText(segment) === normalizeText(stripNumbering(best.question));
    if (!exact && !hasDomainAnchor(segment)) {
      unmatched.push(segment);
      continue;
    }

    const second = retrieval.matches[1];
    const broad = BROAD_TERMS.has(normalizeText(segment)) || tokenize(segment).length <= 1;
    const closeSecond = second && second.score >= best.score * (broad ? 0.75 : AMBIGUITY_RATIO);
    if (!exact && second && closeSecond && (broad || topicKey(second.category) !== topicKey(best.category))) {
      candidates.push(...retrieval.matches.slice(0, 3));
      continue;
    }

    if (answers.length >= MAX_ANSWERS) {
      overflow = true;
      continue;
    }
    if (!answers.some(answer => answer.id === best.id)) answers.push(toAnswer(best));
    for (const match of retrieval.matches.slice(1)) {
      if (match.id !== best.id) suggestions.push({ id: match.id, question: stripNumbering(match.question) });
    }
  }

  const uniqueCandidates = uniqueBy(candidates, candidate => candidate.id)
    .slice(0, 3)
    .map(candidate => ({ id: candidate.id, question: stripNumbering(candidate.question) }));
  const uniqueSuggestions = uniqueBy(suggestions, item => item.id)
    .filter(item => !answers.some(answer => answer.id === item.id))
    .slice(0, 3);

  const notes = [];
  if (unmatched.length) notes.push(`${copy.unmatched} ${unmatched.join('; ')}`);
  if (outOfScope.length) notes.push(`${copy.outOfScopeNote} ${outOfScope.join('; ')}`);
  if (overflow) notes.push(copy.limitNote);
  if (answers.length && uniqueCandidates.length) {
    notes.push(`${copy.clarify} ${uniqueCandidates.map(candidate => candidate.question).join('; ')}`);
  }

  let status;
  if (answers.length) status = notes.length ? 'partial' : 'answered';
  else if (uniqueCandidates.length) status = 'clarify';
  else if (outOfScope.length) status = 'out_of_scope';
  else status = 'not_found';

  let composed;
  if (answers.length) {
    const heading = answers.length > 1 ? copy.multipleHeading : copy.heading;
    const sections = answers
      .map((answer, index) => `${index + 1}. ${answer.question}\n${answer.answer}`)
      .join('\n\n');
    composed = `${heading}\n${sections}`;
  } else if (status === 'clarify') {
    composed = `${copy.clarify}\n${numberedQuestions(uniqueCandidates)}`;
  } else if (status === 'out_of_scope') {
    composed = copy.outOfScope;
  } else {
    composed = copy.notFound;
  }
  if (copy.docsViOnly) composed = `${copy.docsViOnly}\n\n${composed}`;
  if (notes.length) composed = `${composed}\n\n${notes.join('\n')}`;

  return {
    status,
    text: composed,
    answers,
    unmatched,
    outOfScope,
    candidates: uniqueCandidates,
    notes,
    notice: copy.docsViOnly,
    sources: answers.map(answer => ({ id: answer.id, question: answer.question })),
    grounded: answers.length > 0,
    suggestions: uniqueCandidates.length && !answers.length
      ? uniqueCandidates.map(candidate => candidate.question)
      : uniqueSuggestions.length
        ? uniqueSuggestions.map(item => item.question)
        : starterSuggestions(lang),
    language: lang,
    normalizedQuery: normalizeText(text),
  };
}

export const SUPPORT_COMPOSE_LIMITS = Object.freeze({
  maxAnswers: MAX_ANSWERS,
  ambiguityRatio: AMBIGUITY_RATIO,
});
