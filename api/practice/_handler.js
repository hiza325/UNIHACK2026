import { currentUser, noStore, parseBody } from '../auth/_supabase.js';
import { localAuthConfig, localSessionForRequest } from '../auth/_local.js';
import { createPracticeService, derivePracticeProgress, localizeChallenge, normalizeLang } from './_service.js';
import { createPracticeStore } from './_store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODES = new Set(['PRACTICE_DATABASE_NOT_CONFIGURED', 'PRACTICE_DATABASE_UNAVAILABLE']);

function queryValue(req, name) {
  const value = req.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function practiceError(message, code, status, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

function sendPracticeError(res, error) {
  const status = Number(error?.status) || 500;
  const message = status < 500 || SAFE_CODES.has(error?.code)
    ? error.message
    : 'Practice service is temporarily unavailable';
  return res.status(status).json({ error: message, ...(error?.code ? { code: error.code } : {}) });
}

export async function resolvePracticeSession(req, res, env = process.env) {
  const supabaseConfigured = Boolean(String(env.SUPABASE_URL || '').trim() && String(env.SUPABASE_ANON_KEY || '').trim());
  const cookieHeader = String(req.headers?.cookie || '');
  const hasSupabaseSession = /(?:^|;\s*)paradox-(?:access|refresh)=/.test(cookieHeader);
  const localConfigured = Boolean(localAuthConfig(env));
  if (supabaseConfigured && hasSupabaseSession) {
    try {
      const session = await currentUser(req, res, env);
      const learnerId = String(session.user?.id || '');
      if (UUID.test(learnerId)) return { user: session.user, learnerId, source: 'supabase' };
    } catch (error) {
      // A stale Supabase cookie must not block a valid Local Auth session, but
      // database/network failures must not be silently downgraded either.
      if (![401, 403].includes(error?.status) && error?.code !== 'SESSION_INVALID') throw error;
    }
  }
  const local = localSessionForRequest(req, env);
  if (local) return { user: local.user, learnerId: local.learnerId, source: 'local' };
  if (localConfigured && !supabaseConfigured) {
    throw practiceError('Session is invalid or has expired', 'SESSION_INVALID', 401);
  }
  const session = await currentUser(req, res, env);
  const learnerId = String(session.user?.id || '');
  if (!UUID.test(learnerId)) throw practiceError('Session is invalid or has expired', 'SESSION_INVALID', 401);
  return { user: session.user, learnerId, source: 'supabase' };
}

export function createPracticeHandler({ storeFactory, sessionResolver } = {}) {
  return async function practiceHandler(req, res) {
    noStore(res);
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      const session = await (sessionResolver || resolvePracticeSession)(req, res);
      const store = storeFactory
        ? storeFactory(session)
        : session.source === 'local'
          ? (await import('./_local-store.js')).createPracticeLocalStore()
          : createPracticeStore();
      if (req.method === 'GET') {
        const lang = normalizeLang(queryValue(req, 'lang'));
        const [challenges, attempts] = await Promise.all([store.listChallenges(), store.listAttempts(session.learnerId)]);
        return res.status(200).json({
          schemaVersion: 'paradox-practice-v1',
          source: { type: 'practice', authoritative: true },
          challenges: challenges.map(challenge => localizeChallenge(challenge, lang)),
          progress: derivePracticeProgress(challenges, attempts),
        });
      }

      const body = parseBody(req);
      if (body.action !== 'submitAttempt') {
        return res.status(400).json({ error: 'Unsupported practice action', code: 'INVALID_PRACTICE_ACTION' });
      }
      const service = createPracticeService({ store });
      const result = await service.submitAttempt({ body, learnerId: session.learnerId, lang: normalizeLang(body.lang) });
      return res.status(result.duplicate ? 200 : 201).json({
        schemaVersion: 'paradox-practice-v1',
        source: { type: 'practice', authoritative: true },
        ...result,
      });
    } catch (error) {
      return sendPracticeError(res, error);
    }
  };
}

export default createPracticeHandler();
