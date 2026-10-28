import { currentUser, parseBody, publicUser } from '../auth/_supabase.js';
import { createLearningRecordService } from './_service.js';
import { createLearningRecordStore } from './_store.js';

const SAFE_SERVER_CODES = new Set([
  'LEARNING_RECORD_DATABASE_NOT_CONFIGURED',
  'LEARNING_RECORD_DATABASE_UNAVAILABLE',
]);

function queryValue(req, name) {
  const value = req.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function sendRecordError(res, error) {
  const status = Number(error?.status) || 500;
  const message = status < 500 || SAFE_SERVER_CODES.has(error?.code)
    ? error.message
    : 'Learning record service is temporarily unavailable';
  return res.status(status).json({ error: message, ...(error?.code ? { code: error.code } : {}) });
}

export function createLearningRecordsHandler({ storeFactory = createLearningRecordStore, serviceFactory = createLearningRecordService, sessionResolver = currentUser } = {}) {
  return async function learningRecordsHandler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      const session = await sessionResolver(req, res);
      const user = publicUser(session.user);
      const service = serviceFactory({ store: storeFactory() });
      if (req.method === 'GET') {
        const id = queryValue(req, 'id');
        if (id) return res.status(200).json({ session: await service.getSession(id, user) });
        const options = {
          limit: boundedInteger(queryValue(req, 'limit'), 50, 1, 100),
          offset: boundedInteger(queryValue(req, 'offset'), 0, 0, 10_000),
        };
        if (queryValue(req, 'view') === 'evaluations') {
          return res.status(200).json({ evaluations: await service.listEligibleEvaluations(user, options) });
        }
        return res.status(200).json({ sessions: await service.listSessions(user, { ...options, activeOnly: queryValue(req, 'status') === 'active' }) });
      }

      const body = parseBody(req);
      if (body.action === 'createSession') return res.status(201).json(await service.createSession(body, user));
      if (body.action === 'createSubmission') return res.status(201).json({ submission: await service.createSubmission(body, user) });
      if (body.action === 'abandonSession') return res.status(200).json({ session: await service.abandonSession(body.sessionId, user) });
      return res.status(400).json({ error: 'Unsupported learning record action', code: 'INVALID_LEARNING_RECORD_ACTION' });
    } catch (error) {
      return sendRecordError(res, error);
    }
  };
}

export default createLearningRecordsHandler();
