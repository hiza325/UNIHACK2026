import { currentUser, noStore, parseBody, publicUser, requireAdmin } from '../auth/_supabase.js';
import { guardCredentialLookup } from '../auth/_rate-limit.js';
import { createCredentialService, toVerificationView } from './_service.js';
import { createCredentialStore } from './_store.js';
import { handlePublicVerify } from './_public-verify.js';
import { generateQRDataUrl } from './_qr.js';
import { createLearningRecordStore } from '../learning-records/_store.js';
import { publicLearningEvaluation } from '../learning-records/_service.js';
import { createAdminAuditLog } from '../admin/_audit.js';

const QR_RATE = new Map();
function qrRateLimit(ip) {
  const now = Date.now();
  let b = QR_RATE.get(ip);
  if (!b || now > b.resetAt) { b = { count: 0, resetAt: now + 60000 }; QR_RATE.set(ip, b); }
  b.count += 1;
  return b.count <= 30;
}

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
  if (status === 429) res.setHeader('Retry-After', String(Number(error?.retryAfter) || 60));
  const safeMessage = status < 500 || SAFE_SERVER_CODES.has(error?.code)
    ? error.message
    : 'Credential service is temporarily unavailable';
  return res.status(status).json({ error: safeMessage, ...(error?.code ? { code: error.code } : {}) });
}

async function handlePublicQR(req, res) {
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  const code = String(req.query?.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{8,80}$/.test(code)) {
    return res.status(400).json({ status: 'INVALID_INPUT', error: 'Invalid certificate code.', code: 'INVALID_CERTIFICATE_CODE' });
  }
  let base = String(process.env.PUBLIC_VERIFY_BASE_URL || '').replace(/\/$/, '');
  if (!base && process.env.VERCEL_URL) {
    base = `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  }
  if (!base) {
    const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
    const proto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
    if (host && /^[a-z0-9.-]+(?::\\d+)?$/i.test(host) && (proto === 'https' || /^localhost(?::\\d+)?$/i.test(host))) {
      base = `${proto}://${host}`;
    }
  }
  if (!base) {
    return res.status(503).json({ status: 'UNAVAILABLE', error: 'Verify domain not configured.', code: 'QR_DOMAIN_NOT_CONFIGURED' });
  }
  let parsedBase;
  try { parsedBase = new URL(base); } catch { return res.status(503).json({ status: 'UNAVAILABLE', error: 'Verify domain not configured.', code: 'QR_DOMAIN_NOT_CONFIGURED' }); }
  if (parsedBase.protocol !== 'https:') {
    return res.status(503).json({ status: 'UNAVAILABLE', error: 'Verify domain must use HTTPS.', code: 'QR_DOMAIN_NOT_CONFIGURED' });
  }
  if (parsedBase.username || parsedBase.password) {
    return res.status(503).json({ status: 'UNAVAILABLE', error: 'Verify domain not configured.', code: 'QR_DOMAIN_NOT_CONFIGURED' });
  }
  if (!qrRateLimit(ip)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ status: 'UNAVAILABLE', error: 'Too many requests.', code: 'RATE_LIMITED' }); }
  const url = `${parsedBase.origin}/verify?code=${encodeURIComponent(code)}`;
  try {
    const dataUrl = await generateQRDataUrl(url);
    return res.status(200).json({ dataUrl, url });
  } catch (e) {
    return res.status(503).json({ status: 'UNAVAILABLE', error: 'QR generation failed.', code: 'QR_GENERATION_FAILED' });
  }
}

export function createCredentialsHandler({ storeFactory = createCredentialStore, serviceFactory = createCredentialService, learningRecordStoreFactory = () => { try { return createLearningRecordStore(); } catch { return null; } }, auditFactory = createAdminAuditLog } = {}) {
  async function audit(entry) {
    try {
      await auditFactory().record(entry);
    } catch {
      // The audit trail is best-effort and must never block a credential action.
    }
  }

  return async function credentialsHandler(req, res) {
    noStore(res);
    if (queryValue(req, 'public') === '1') {
      return handlePublicVerify(req, res);
    }
    if (queryValue(req, 'public') === 'qr') {
      return handlePublicQR(req, res);
    }
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
          guardCredentialLookup(req, session.user?.id);
          const credential = await service.find(code);
          if (!credential) return res.status(404).json({ error: 'Credential was not found', code: 'CREDENTIAL_NOT_FOUND' });
          return res.status(200).json({ credential: toVerificationView(credential) });
        }
        return res.status(200).json({ passport: await service.passport(publicUser(session.user)) });
      }

      const body = parseBody(req);
      const action = String(body.action || '');
      const service = serviceFactory({ store: storeFactory(), learningRecordStore: learningRecordStoreFactory() });
      if (action === 'verify') {
        const session = await currentUser(req, res);
        guardCredentialLookup(req, session.user?.id);
        return res.status(200).json({ credential: toVerificationView(await service.verify(body.credentialCode)) });
      }
      if (action === 'issue') {
        const session = await requireAdmin(req, res);
        const credential = await service.issue(body, publicUser(session.user));
        await audit({
          action: 'credential.issue',
          actorId: session.user.id,
          actorEmail: session.user.email || null,
          targetType: 'credential',
          targetId: credential?.credentialCode || body.credentialCode || null,
          metadata: { learnerId: body.learnerId || null, isTest: body.isTest === true },
        });
        return res.status(201).json({ credential });
      }
      if (action === 'prepare-issue') {
        const session = await requireAdmin(req, res);
        const result = await service.prepareIssue(body, publicUser(session.user));
        await audit({
          action: 'credential.prepare-issue',
          actorId: session.user.id,
          actorEmail: session.user.email || null,
          targetType: 'credential',
          targetId: result?.credential?.credentialCode || body.credentialCode || null,
          metadata: { learnerId: body.learnerId || null },
        });
        return res.status(200).json(result);
      }
      if (action === 'confirm-issue') {
        const session = await requireAdmin(req, res);
        const result = await service.confirmIssue(body, publicUser(session.user));
        await audit({
          action: 'credential.confirm-issue',
          actorId: session.user.id,
          actorEmail: session.user.email || null,
          targetType: 'credential',
          targetId: result?.credential?.credentialCode || body.credentialCode || null,
          metadata: { learnerId: body.learnerId || null },
        });
        return res.status(200).json(result);
      }
      if (action === 'reconcile-credential') {
        const session = await requireAdmin(req, res);
        guardCredentialLookup(req, session.user?.id);
        const result = await service.reconcileCredential(body.credentialCode, body.txHash);
        return res.status(200).json(result);
      }
      if (action === 'list-eligible-evaluations') {
        await requireAdmin(req, res);
        const learnerId = String(body?.learnerId || '').trim();
        const lrStore = learningRecordStoreFactory();
        if (!lrStore) return res.status(503).json({ error: 'Learning record store is not configured', code: 'LEARNING_RECORD_STORE_NOT_CONFIGURED' });
        const evaluations = await lrStore.listEligibleEvaluations(learnerId);
        return res.status(200).json({ evaluations: (evaluations || []).map(publicLearningEvaluation) });
      }
      if (action === 'revoke') {
        const session = await requireAdmin(req, res);
        const credential = await service.revoke(body.credentialCode);
        await audit({
          action: 'credential.revoke',
          actorId: session.user.id,
          actorEmail: session.user.email || null,
          targetType: 'credential',
          targetId: credential?.credentialCode || body.credentialCode || null,
          metadata: {},
        });
        return res.status(200).json({ credential });
      }
      return res.status(400).json({ error: 'Unsupported credential action', code: 'INVALID_CREDENTIAL_ACTION' });
    } catch (error) {
      return sendCredentialError(res, error);
    }
  };
}

export default createCredentialsHandler();