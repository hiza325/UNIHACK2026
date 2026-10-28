import { SUPPORT_FAQ } from './_support-faq.js';

/*
 * Lightweight lexical retrieval for the PARADOX support knowledge base.
 *
 * The corpus is small (150 entries) and static, so an IDF-weighted vector
 * scorer over questions and curated keywords is enough. It avoids embeddings,
 * a vector database and an extra network hop.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'no', 'not',
  'of', 'on', 'or', 'our', 'she', 'should', 'so', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you',
  'your',
  'va', 'la', 'co', 'khong', 'duoc', 'nao', 'thi', 'sao', 'khi', 'de', 'cho',
  'voi', 'trong', 'mot', 'nhung', 'cac', 'nay', 'do', 'ra', 'vao', 'len',
  'xuong', 'di', 'den', 'tu', 'hay', 'muon', 'can', 'giup', 'hoi', 'lam', 'nhu',
  'roi', 'da', 'dang', 'bi', 'se', 'neu', 'ma', 'o', 'e', 'i', 'u', 'y',
  'toi', 'ban', 'cua', 'minh', 'vay', 'nha', 'nhe', 'ak', 'oi', 'phai', 'gi',
  'bao', 'nhieu', 'chua', 'nhi', 'the', 'he', 'thong',
]);

const MAX_QUERY_TOKENS = 24;
const STRONG_SCORE = 15;
const PARTIAL_SCORE = 8;

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenList(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter(token => token.length >= 2 && !STOPWORDS.has(token));
}

export function tokenize(value) {
  return [...new Set(tokenList(value))];
}

const INTENT_PHRASES = ['o dau', 'bao lau', 'khi nao', 'la gi', 'nhu the nao', 'tai sao', 'co the', 'bao nhieu'];

/*
 * Users type keywords or rough paraphrases, not the exact documented question.
 * These aliases map common Vietnamese/English wording onto vocabulary that
 * actually exists in the FAQ questions and curated keywords.
 */
const QUERY_ALIASES = [
  ['keyboard shortcut', 'phim tat'],
  ['reset password', 'dat lai mat khau'],
  ['forgot password', 'quen mat khau'],
  ['change password', 'doi mat khau'],
  ['email verification', 'xac minh email'],
  ['verification code', 'otp'],
  ['ma xac minh', 'otp'],
  ['ma xac thuc', 'otp'],
  ['trang web bi trang', 'trang trang'],
  ['man hinh trang', 'trang trang'],
  ['white screen', 'trang trang'],
  ['delete account', 'xoa tai khoan'],
  ['xoa lich su', 'xoa phien'],
  ['chung chi', 'credential'],
  ['chung nhan', 'credential'],
  ['certificate', 'credential'],
  ['on chain', 'on-chain'],
  ['blockchain', 'on-chain'],
  ['testnet', 'on-chain'],
  ['fuji', 'on-chain'],
  ['mau nen', 'giao dien toi'],
  ['che do toi', 'giao dien toi'],
  ['che do sang', 'giao dien toi'],
  ['tieng nhat', 'doi ngon ngu'],
  ['tieng anh', 'doi ngon ngu'],
  ['tieng viet', 'doi ngon ngu'],
  ['language', 'doi ngon ngu'],
  ['huy hieu', 'thanh tuu'],
  ['badge', 'thanh tuu'],
  ['streak', 'chuoi ngay'],
  ['goal', 'muc tieu'],
  ['hint', 'goi y'],
  ['tep word', 'dinh dang'],
  ['doc file', 'dinh dang'],
  ['docx', 'dinh dang'],
  ['word', 'dinh dang'],
  ['xuat file', 'xuat json'],
  ['download', 'xuat'],
  ['export', 'xuat'],
  ['logout', 'dang xuat'],
  ['log out', 'dang xuat'],
  ['sign out', 'dang xuat'],
  ['login', 'dang nhap'],
  ['log in', 'dang nhap'],
  ['sign in', 'dang nhap'],
  ['sign up', 'dang ky'],
  ['signup', 'dang ky'],
  ['register', 'dang ky'],
  ['shortcut', 'phim tat'],
  ['server error', '503'],
  ['error 503', '503'],
  ['resend otp', 'gui lai otp'],
  ['resend', 'gui lai'],
  ['password', 'mat khau'],
  ['slow', 'cham'],
  ['lag', 'cham'],
  ['performance', 'hieu nang'],
].sort((left, right) => right[0].length - left[0].length);

function replacePhrase(text, phrase, replacement) {
  const padded = ` ${text} `;
  const target = ` ${phrase} `;
  if (!padded.includes(target)) return text;
  return padded.split(target).join(` ${replacement} `).replace(/\s+/g, ' ').trim();
}

export function expandQuery(value) {
  let normalized = normalizeText(value);
  for (const [alias, replacement] of QUERY_ALIASES) {
    normalized = replacePhrase(normalized, alias, replacement);
  }
  return normalized;
}

function bigramsFor(tokens) {
  const bigrams = new Set();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.add(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return bigrams;
}

const documents = SUPPORT_FAQ.map(entry => {
  const questionNorm = normalizeText(entry.question.replace(/^\s*\d+\.\s*/, ''));
  const keywordPhrases = entry.keywords.map(normalizeText).filter(Boolean);
  const questionTokenList = tokenList(questionNorm);
  const keywordTokenLists = keywordPhrases.map(phrase => tokenList(phrase));
  const questionTokens = new Set(questionTokenList);
  const keywordTokens = new Set(keywordTokenLists.flat());
  const searchBigrams = bigramsFor(questionTokenList);
  for (const list of keywordTokenLists) {
    for (const bigram of bigramsFor(list)) searchBigrams.add(bigram);
  }
  return {
    entry,
    questionNorm,
    keywordPhrases,
    questionTokens,
    keywordTokens,
    searchTokens: new Set([...questionTokens, ...keywordTokens]),
    searchBigrams,
  };
});

const documentFrequency = new Map();
for (const document of documents) {
  for (const token of document.searchTokens) {
    documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }
}

const TOTAL_DOCUMENTS = documents.length;

function inverseDocumentFrequency(token) {
  return Math.log(1 + TOTAL_DOCUMENTS / (1 + (documentFrequency.get(token) || 0)));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function vectorFor(tokens) {
  const vector = new Map();
  let squaredNorm = 0;
  for (const token of tokens) {
    const weight = inverseDocumentFrequency(token);
    vector.set(token, weight);
    squaredNorm += weight * weight;
  }
  return { vector, norm: Math.sqrt(squaredNorm) };
}

for (const document of documents) {
  const { vector, norm } = vectorFor(document.searchTokens);
  document.vector = vector;
  document.vectorNorm = norm;
}

function toMatch(item) {
  return {
    id: item.document.entry.id,
    part: item.document.entry.part,
    category: item.document.entry.category,
    question: item.document.entry.question,
    keywords: item.document.entry.keywords,
    answer: item.document.entry.answer,
    source: item.document.entry.source,
    score: Math.round(item.score * 100) / 100,
    coverage: Math.round(item.coverage * 100) / 100,
  };
}

/**
 * Retrieve the support entries that are most relevant to a natural-language query.
 *
 * The returned tier distinguishes a confident match, a partial match and the
 * absence of any confirmed documentation.
 */
export function retrieveSupportFaq(query, options = {}) {
  const limit = clamp(Math.round(Number(options.limit) || 4), 1, 6);
  const queryNorm = expandQuery(query);
  const queryTokenList = tokenList(queryNorm).slice(0, MAX_QUERY_TOKENS);
  const queryTokens = [...new Set(queryTokenList)];
  if (!queryNorm || !queryTokens.length) {
    return { tier: 'none', normalizedQuery: queryNorm, matches: [] };
  }

  const queryVector = vectorFor(queryTokens);
  const queryBigrams = bigramsFor(queryTokenList);

  const scored = documents.map(document => {
    let dotProduct = 0;
    let strongMatches = 0;
    for (const token of queryTokens) {
      if (document.searchTokens.has(token)) {
        dotProduct += (queryVector.vector.get(token) || 0) * (document.vector.get(token) || 0);
        strongMatches += 1;
      }
    }
    const cosine = dotProduct > 0 && queryVector.norm > 0 && document.vectorNorm > 0
      ? dotProduct / (queryVector.norm * document.vectorNorm)
      : 0;

    let phraseBonus = 0;
    for (const phrase of document.keywordPhrases) {
      if (!phrase) continue;
      if (phrase.includes(' ')) {
        if (queryNorm.includes(phrase)) phraseBonus += 8;
      } else if (queryTokens.includes(phrase)) {
        phraseBonus += 3;
      }
    }

    for (const intent of INTENT_PHRASES) {
      if (queryNorm.includes(intent) && document.questionNorm.includes(intent)) {
        phraseBonus += intent === 'o dau' ? 22 : 5;
      }
    }

    let questionBonus = 0;
    if (queryNorm === document.questionNorm) questionBonus += 15;
    else if (document.questionNorm.length >= 10 && queryNorm.includes(document.questionNorm)) questionBonus += 8;
    else if (queryNorm.length >= 10 && document.questionNorm.includes(queryNorm)) questionBonus += 5;

    let bigramBonus = 0;
    for (const bigram of queryBigrams) {
      if (document.searchBigrams.has(bigram)) bigramBonus += 5;
    }

    const coverage = strongMatches / queryTokens.length;
    return {
      document,
      score: cosine * 25 + phraseBonus + questionBonus + bigramBonus,
      cosine,
      coverage,
      strongMatches,
    };
  }).filter(item => item.strongMatches > 0 && item.score > 0)
    .sort((left, right) => right.score - left.score || left.document.entry.id.localeCompare(right.document.entry.id));

  if (!scored.length) return { tier: 'none', normalizedQuery: queryNorm, matches: [] };

  const best = scored[0];
  const tier = best.coverage >= 0.5 && best.score >= STRONG_SCORE
    ? 'strong'
    : best.coverage >= 0.3 && best.score >= PARTIAL_SCORE
      ? 'partial'
      : 'none';

  if (tier === 'none') return { tier, normalizedQuery: queryNorm, matches: [] };

  const minimumScore = Math.max(PARTIAL_SCORE, best.score * 0.5);
  const matches = scored
    .filter(item => item.coverage >= 0.3 && item.score >= minimumScore)
    .slice(0, limit)
    .map(toMatch);

  return { tier, normalizedQuery: queryNorm, matches };
}

export const SUPPORT_RETRIEVAL_META = {
  documentCount: TOTAL_DOCUMENTS,
  maxQueryTokens: MAX_QUERY_TOKENS,
  thresholds: { strong: STRONG_SCORE, partial: PARTIAL_SCORE },
};
