/**
 * Read-only ZK Proof of Learning router.
 *
 * Hosted inside api/learning-records/index.js to avoid adding a 13th Vercel
 * serverless function. Only public read/verify actions exist here:
 *   - GET  status
 *   - GET  getProof
 *   - POST verifyProof
 *
 * There is deliberately no create/update/delete action. A client-supplied
 * `zkAction` therefore cannot be used to bypass authentication into proof
 * creation or mutation: unknown actions return 404 and each supported action has
 * its own method allowlist and rate limit.
 */

import { currentUser, publicUser } from '../auth/_supabase.js';
import { createAvalancheGateway } from '../credentials/_avalanche.js';
import { createCredentialStore } from '../credentials/_store.js';
import { createLearningRecordStore } from '../learning-records/_store.js';
import { createZkProofStore } from './_store.js';
import { loadKeyConfig } from './_keys.js';
import { ZK_ALLOWED_THRESHOLDS, resolveThreshold } from './_policy.js';
import { toPublicProofRecord } from './_projection.js';
import { createZkVerificationService } from './_verify.js';
import { createZkProofGenerationService } from './_generate.js';
import { loadDemoEvaluatorSigner } from './_signing.js';

const MAX_BODY_BYTES = 4096;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMITS = Object.freeze({
  status: 60,
  getProof: 60,
  verifyProof: 10,
  generateProof: 5,
});
const RATE_BUCKETS = new Map();

export function resetZkRateLimit() {
  RATE_BUCKETS.clear();
}

function routerError(message, code, status = 400, retryAfter) {
  return Object.assign(new Error(message), { code, status, ...(retryAfter ? { retryAfter } : {}) });
}

function clientIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req?.headers?.['x-real-ip'] || '').trim();
  const socket = String(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '').trim();
  return (forwarded || real || socket || 'unknown').replace(/^::ffff:/i, '').slice(0, 64);
}

function consumeRate(req, scope, clockMs = Date.now()) {
  const limit = RATE_LIMITS[scope];
  const key = `${scope}:${clientIp(req)}`;
  let bucket = RATE_BUCKETS.get(key);
  if (!bucket || clockMs >= bucket.resetAt) {
    bucket = { count: 0, resetAt: clockMs + RATE_WINDOW_MS };
    RATE_BUCKETS.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - clockMs) / 1000));
    throw routerError('Too many requests', 'ZK_RATE_LIMITED', 429, retryAfter);
  }
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(req?.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw routerError('Request body is too large', 'ZK_BODY_TOO_LARGE', 413);
  }
  if (req?.body === undefined || req.body === null || req.body === '') return {};

  let parsed;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > maxBytes) {
      throw routerError('Request body is too large', 'ZK_BODY_TOO_LARGE', 413);
    }
    try {
      parsed = JSON.parse(req.body);
    } catch {
      throw routerError('Invalid JSON body', 'ZK_INVALID_BODY', 400);
    }
  } else {
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > maxBytes) {
      throw routerError('Request body is too large', 'ZK_BODY_TOO_LARGE', 413);
    }
    parsed = req.body;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw routerError('Invalid JSON body', 'ZK_INVALID_BODY', 400);
  }
  return parsed;
}

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function sendError(res, error) {
  const status = Number(error?.status) || 500;
  const code = error?.code || 'ZK_SERVICE_ERROR';
  if (status === 429 && error?.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
  const isClientError = status < 500;
  return sendJson(res, status, {
    error: isClientError ? error.message : 'ZK service is temporarily unavailable',
    code,
  });
}

function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return sendJson(res, 405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
}

export function createZkRouter({
  storeFactory = createZkProofStore,
  recordStoreFactory = createLearningRecordStore,
  credentialStoreFactory = createCredentialStore,
  keyLoader = loadKeyConfig,
  verificationFactory = createZkVerificationService,
  generationFactory = createZkProofGenerationService,
  gatewayFactory = () => createAvalancheGateway({ write: false }),
  issuerSignerFactory = () => loadDemoEvaluatorSigner({ env: process.env }),
  sessionResolver = currentUser,
  now = () => new Date(),
} = {}) {
  return async function zkRouter({ action, req, res, proofId }) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    try {
      if (action === 'status') {
        if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
        consumeRate(req, 'status', new Date(now()).getTime());
        let keyConfig;
        try {
          keyConfig = await keyLoader();
        } catch (error) {
          return sendJson(res, 503, { ready: false, code: error?.code || 'ZK_KEY_CONFIG_UNAVAILABLE' });
        }
        return sendJson(res, 200, {
          ready: true,
          circuitVersion: keyConfig.circuitVersion,
          vkeySha256: keyConfig.vkeySha256,
          trustedIssuerKeyIds: [...keyConfig.activeIssuerKeyIds],
          allowedThresholds: [...ZK_ALLOWED_THRESHOLDS],
          setupMode: keyConfig.setupMode,
        });
      }

      if (action === 'getProof') {
        if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
        consumeRate(req, 'getProof', new Date(now()).getTime());
        const id = String(proofId ?? '').trim();
        if (!id || id.length > 64) return sendJson(res, 400, { error: 'Proof ID is invalid', code: 'ZK_PROOF_ID_INVALID' });

        const store = storeFactory();
        const row = await store.findById(id);
        if (!row) return sendJson(res, 404, { error: 'ZK proof was not found', code: 'ZK_PROOF_NOT_FOUND' });
        return sendJson(res, 200, { proof: toPublicProofRecord(row) });
      }

      if (action === 'generateProof') {
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
        consumeRate(req, 'generateProof', new Date(now()).getTime());

        const body = readJsonBody(req);
        const keys = Object.keys(body);
        const allowedKeys = ['evaluationId', 'threshold'];
        if (keys.length < 1 || keys.length > 2 || !keys.includes('evaluationId')
          || keys.some(key => !allowedKeys.includes(key))
          || typeof body.evaluationId !== 'string' || !body.evaluationId.trim() || body.evaluationId.length > 64) {
          return sendJson(res, 400, { error: 'Body must contain evaluationId and optional threshold', code: 'ZK_INVALID_BODY' });
        }
        if (body.threshold !== undefined
          && (!Number.isInteger(body.threshold) || !ZK_ALLOWED_THRESHOLDS.includes(body.threshold))) {
          return sendJson(res, 400, { error: 'Threshold is not allowed', code: 'ZK_INVALID_THRESHOLD' });
        }

        let session;
        try {
          session = await sessionResolver(req, res);
        } catch {
          return sendJson(res, 401, { error: 'Authentication is required', code: 'ZK_UNAUTHENTICATED' });
        }
        const user = session?.user;
        if (!user?.id) return sendJson(res, 401, { error: 'Authentication is required', code: 'ZK_UNAUTHENTICATED' });
        const learnerId = String(user.id).trim();

        let keyConfig;
        try {
          keyConfig = await keyLoader();
        } catch (error) {
          return sendJson(res, 503, { ready: false, code: error?.code || 'ZK_KEY_CONFIG_UNAVAILABLE' });
        }

        const store = storeFactory();
        const recordStore = recordStoreFactory();
        const credentialStore = credentialStoreFactory();
        let gateway;
        try {
          gateway = await gatewayFactory();
        } catch {
          return sendJson(res, 503, { valid: false, reason: 'CREDENTIAL_STATUS_UNAVAILABLE', retryable: true });
        }
        let issuerSigner;
        try {
          issuerSigner = await issuerSignerFactory();
        } catch (error) {
          return sendJson(res, 503, { error: 'ZK issuer signing is unavailable', code: error?.code || 'ZK_ISSUER_SIGNING_UNAVAILABLE' });
        }

        const dependencies = {
          getEvaluation: async (evaluationId, learnerId) => recordStore.findEvaluation(evaluationId, learnerId),
          getCredential: async (evaluation) => credentialStore.findByEvaluationId(evaluation.id),
          getOnChainCredential: async (credential) => gateway.verifyCredential(credential.credential_id_hash),
        };

        const service = generationFactory({
          store,
          keyConfig,
          issuerSigner,
          dependencies,
          now: () => new Date(now()),
        });

        try {
          const generated = await service.generate({
            learnerId,
            evaluationId: body.evaluationId.trim(),
            threshold: body.threshold,
          });
          return sendJson(res, 200, generated);
        } catch (error) {
          return sendError(res, error);
        }
      }

      if (action === 'verifyProof') {
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
        consumeRate(req, 'verifyProof', new Date(now()).getTime());

        const body = readJsonBody(req);
        const keys = Object.keys(body);
        if (keys.length !== 1 || keys[0] !== 'proofId'
          || typeof body.proofId !== 'string' || !body.proofId.trim() || body.proofId.length > 64) {
          return sendJson(res, 400, { error: 'Body must contain only proofId', code: 'ZK_INVALID_BODY' });
        }

        let keyConfig;
        try {
          keyConfig = await keyLoader();
        } catch (error) {
          throw routerError('ZK key configuration is unavailable', error?.code || 'ZK_SERVICE_UNAVAILABLE', 503);
        }
        const store = storeFactory();
        let gateway;
        try {
          gateway = await gatewayFactory();
        } catch {
          return sendJson(res, 503, {
            valid: false,
            reason: 'CREDENTIAL_STATUS_UNAVAILABLE',
            retryable: true,
          });
        }
        const service = verificationFactory({ store, keyConfig, gateway, now });
        const verified = await service.verify(body.proofId.trim());
        return sendJson(res, 200, verified);
      }

      // Unknown action: do not fall through to learning-records auth/service.
      return sendJson(res, 404, { error: 'ZK action not found', code: 'ZK_ACTION_NOT_FOUND' });
    } catch (error) {
      return sendError(res, error);
    }
  };
}

export default createZkRouter();
