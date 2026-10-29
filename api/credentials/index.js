import { currentUser, parseBody, publicUser, requireAdmin } from '../auth/_supabase.js';
import { createCredentialService } from './_service.js';
import { createCredentialStore } from './_store.js';
import { createLearningRecordStore } from '../learning-records/_store.js';

const SAFE_SERVER_CODES = new Set([
  'AVALANCHE_RPC_NOT_CONFIGURED', 'AVALANCHE_RPC_INVALID', 'AVALANCHE_RPC_UNAVAILABLE',
  'AVALANCHE_CONTRACT_NOT_CONFIGURED', 'AVALANCHE_CONTRACT_MISMATCH', 'AVALANCHE_ISSUER_NOT_CONFIGURED', 'AVALANCHE_WRONG_CHAIN',
  'ISSUER_NOT_AUTHORIZED', 'FUJI_AVAX_REQUIRED', 'CREDENTIAL_DATABASE_NOT_CONFIGURED',
]);

function queryValue(req, name) {
  const value = req.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendCredentialError(res, error) {
  const status = Number(error?.status) || 500;
  const safeMessage = status < 500 || SAFE_SERVER_CODES.has(error?.code)
    ? error.message
    : 'Credential service is temporarily unavailable';
  return res.status(status).json({ error: safeMessage, ...(error?.code ? { code: error.code } : {}) });
}

export function createCredentialsHandler({ storeFactory = createCredentialStore, serviceFactory = createCredentialService, learningRecordStoreFactory = () => { try { return createLearningRecordStore(); } catch { return null; } } } = {}) {
  return async function credentialsHandler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      if (req.method === 'GET') {
        const session = await currentUser(req, res);
        const service = serviceFactory({ store: storeFactory(), learningRecordStore: learningRecordStoreFactory() });
        const code = queryValue(req, 'code');
        if (code) {
          const credential = await service.find(code);
          if (!credential) return res.status(404).json({ error: 'Credential was not found', code: 'CREDENTIAL_NOT_FOUND' });
          return res.status(200).json({ credential });
        }
        return res.status(200).json({ passport: await service.passport(publicUser(session.user)) });
      }

      const body = parseBody(req);
      const action = String(body.action || '');
      const service = serviceFactory({ store: storeFactory(), learningRecordStore: learningRecordStoreFactory() });
      if (action === 'verify') {
        await currentUser(req, res);
        return res.status(200).json({ credential: await service.verify(body.credentialCode) });
      }
      if (action === 'issue') {
        const session = await requireAdmin(req, res);
        return res.status(201).json({ credential: await service.issue(body, publicUser(session.user)) });
      }
      if (action === 'revoke') {
        await requireAdmin(req, res);
        return res.status(200).json({ credential: await service.revoke(body.credentialCode) });
      }
      return res.status(400).json({ error: 'Unsupported credential action', code: 'INVALID_CREDENTIAL_ACTION' });
    } catch (error) {
      return sendCredentialError(res, error);
    }
  };
}

export default createCredentialsHandler();
