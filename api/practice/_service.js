import { PRACTICE_CHALLENGE_SUBJECTS } from './_challenges.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGS = new Set(['vi', 'en', 'jp']);

function practiceError(message, code, status, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

export function normalizeLang(value) {
  const lang = String(value || '').trim().toLowerCase();
  return LANGS.has(lang) ? lang : 'vi';
}

export function isUuid(value) {
  return UUID.test(String(value || ''));
}

export function localizeChallenge(row, lang) {
  const content = (row.content && (row.content[lang] || row.content.vi)) || {};
  const options = Array.isArray(content.options) ? content.options : [];
  const subject = PRACTICE_CHALLENGE_SUBJECTS[row.subject_key]?.[lang]
    || PRACTICE_CHALLENGE_SUBJECTS[row.subject_key]?.vi
    || row.subject_key;
  return {
    slug: row.slug,
    subjectKey: row.subject_key,
    subject,
    title: content.title || '',
    question: content.question || '',
    options,
    level: content.level || '',
    source: content.source || '',
    minutes: Number(row.minutes) || 0,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    isActive: row.is_active !== false && row.is_active !== 0,
  };
}

export function publicAttempt(row, challenge, lang) {
  const content = (challenge.content && (challenge.content[lang] || challenge.content.vi)) || {};
  return {
    id: row.id,
    challengeSlug: row.challenge_slug,
    selectedOption: Number(row.selected_option),
    isCorrect: Boolean(row.is_correct),
    correctOption: Number(challenge.correct_option),
    explanation: content.explanation || '',
    attemptedAt: row.attempted_at || new Date().toISOString(),
  };
}

export function derivePracticeProgress(challenges, attempts) {
  const active = challenges.filter(row => row.is_active !== false && row.is_active !== 0);
  const bySlug = new Map(active.map(row => [row.slug, row]));
  const knownAttempts = (attempts || []).filter(row => bySlug.has(row.challenge_slug));
  const solved = new Set(knownAttempts.filter(row => row.is_correct === true || row.is_correct === 1).map(row => row.challenge_slug));
  const subjectTotals = new Map();
  const subjectOrder = [];
  for (const challenge of active) {
    if (!subjectTotals.has(challenge.subject_key)) {
      subjectTotals.set(challenge.subject_key, { subjectKey: challenge.subject_key, total: 0, solved: 0 });
      subjectOrder.push(challenge.subject_key);
    }
    subjectTotals.get(challenge.subject_key).total += 1;
  }
  for (const slug of solved) {
    const challenge = bySlug.get(slug);
    if (challenge) subjectTotals.get(challenge.subject_key).solved += 1;
  }
  const correctAttempts = knownAttempts.filter(row => row.is_correct === true || row.is_correct === 1).length;
  const updatedAt = knownAttempts.map(row => row.attempted_at).filter(Boolean).sort().at(-1) || null;
  return {
    totalChallenges: active.length,
    solvedChallenges: solved.size,
    totalAttempts: knownAttempts.length,
    correctAttempts,
    accuracy: knownAttempts.length ? Math.round((correctAttempts / knownAttempts.length) * 100) : null,
    subjects: subjectOrder.map(key => subjectTotals.get(key)),
    solvedChallengeSlugs: [...solved].sort(),
    updatedAt,
  };
}

export function createPracticeService({ store, now = () => new Date() }) {
  return {
    async submitAttempt({ body, learnerId, lang }) {
      const locale = normalizeLang(lang);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw practiceError('Invalid request body', 'INVALID_PRACTICE_REQUEST', 400);
      }
      if (body.action !== 'submitAttempt') {
        throw practiceError('Unsupported practice action', 'INVALID_PRACTICE_ACTION', 400);
      }
      const challengeSlug = String(body.challengeSlug || '').trim();
      if (!SLUG.test(challengeSlug)) {
        throw practiceError('Challenge is invalid', 'INVALID_PRACTICE_CHALLENGE', 400);
      }
      const selectedOption = body.selectedOption;
      if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption > 7) {
        throw practiceError('Selected option is invalid', 'INVALID_PRACTICE_OPTION', 400);
      }
      const clientAttemptId = String(body.clientAttemptId || '').trim();
      if (!UUID.test(clientAttemptId)) {
        throw practiceError('Attempt id is invalid', 'INVALID_PRACTICE_ATTEMPT_ID', 400);
      }
      const requestLang = body.lang ? normalizeLang(body.lang) : locale;
      const challenge = await store.findChallenge(challengeSlug);
      if (!challenge || challenge.is_active === false || challenge.is_active === 0) {
        throw practiceError('Challenge was not found', 'PRACTICE_CHALLENGE_NOT_FOUND', 404);
      }
      const content = (challenge.content && (challenge.content[requestLang] || challenge.content.vi)) || {};
      const options = Array.isArray(content.options) ? content.options : [];
      if (options.length < 2 || selectedOption >= options.length) {
        throw practiceError('Selected option is invalid', 'INVALID_PRACTICE_OPTION', 400);
      }
      const existing = await store.findAttempt(learnerId, clientAttemptId);
      if (existing) {
        if (existing.challenge_slug !== challengeSlug) {
          throw practiceError('Attempt id already belongs to another challenge', 'PRACTICE_ATTEMPT_CONFLICT', 409);
        }
        const [challenges, attempts] = await Promise.all([store.listChallenges(), store.listAttempts(learnerId)]);
        return {
          duplicate: true,
          attempt: publicAttempt(existing, challenge, requestLang),
          progress: derivePracticeProgress(challenges, attempts),
        };
      }
      const isCorrect = selectedOption === Number(challenge.correct_option);
      const attempt = await store.insertAttempt({
        learner_id: learnerId,
        challenge_slug: challengeSlug,
        client_attempt_id: clientAttemptId,
        selected_option: selectedOption,
        is_correct: isCorrect,
        attempted_at: now().toISOString(),
      });
      const [challenges, attempts] = await Promise.all([store.listChallenges(), store.listAttempts(learnerId)]);
      return {
        duplicate: false,
        attempt: publicAttempt(attempt, challenge, requestLang),
        progress: derivePracticeProgress(challenges, attempts),
      };
    },
  };
}
