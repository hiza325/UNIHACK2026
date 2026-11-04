/**
 * Server-only DEMO evaluator signing for ZK Proof of Learning.
 *
 * Signing is deliberately isolated from _keys.js. _keys.js never loads the
 * evaluator private key; this module only exposes the public key and an
 * attestation-signing function. The private key must come from server
 * configuration (or an injected test signer). No persistent key is generated
 * here and no private material is returned.
 */

import { createPrivateKey, createPublicKey } from 'node:crypto';

import { createEvaluationAttestation } from '../../zk/lib/attestation.mjs';

function signingError(message, code, status = 503, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

function deploymentContext(env) {
  return {
    vercel: String(env.VERCEL || '').trim() === '1',
    vercelEnv: String(env.VERCEL_ENV || '').trim().toLowerCase(),
  };
}

function assertDemoSigningAllowed(env) {
  const { vercel, vercelEnv } = deploymentContext(env);
  if (vercelEnv === 'production') {
    throw signingError('DEMO evaluator signing is forbidden in production', 'ZK_DEMO_SIGNING_FORBIDDEN', 503);
  }
  if (vercelEnv === 'preview') {
    if (!vercel || String(env.ZK_PREVIEW_DEMO || '') !== '1') {
      throw signingError('Preview DEMO signing is not explicitly enabled', 'ZK_PREVIEW_DEMO_REQUIRED', 503);
    }
  } else if (vercel) {
    if (vercelEnv !== 'development') {
      throw signingError('Deployment environment is not trusted for DEMO signing', 'ZK_DEPLOYMENT_ENV_UNTRUSTED', 503);
    }
  } else if (vercelEnv) {
    throw signingError('Deployment environment is not trusted for DEMO signing', 'ZK_DEPLOYMENT_ENV_UNTRUSTED', 503);
  }
  if (!vercel && !vercelEnv && String(env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    throw signingError('DEMO evaluator signing is forbidden in production', 'ZK_DEMO_SIGNING_FORBIDDEN', 503);
  }
  if (!vercel && !vercelEnv && String(env.ZK_ALLOW_DEVELOPMENT_SETUP || '') !== '1') {
    throw signingError('DEMO evaluator signing is not allowed', 'ZK_DEMO_SIGNING_NOT_ALLOWED', 503);
  }
}

export async function loadDemoEvaluatorSigner({ env = process.env } = {}) {
  assertDemoSigningAllowed(env);

  const privateKeyPem = String(env.ZK_EVALUATOR_PRIVATE_KEY || '').trim();
  if (!privateKeyPem) {
    throw signingError('DEMO evaluator signing key is not configured', 'ZK_EVALUATOR_KEY_MISSING', 503);
  }

  let privateKey;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch (error) {
    throw signingError('DEMO evaluator signing key is invalid', 'ZK_EVALUATOR_KEY_INVALID', 503, error);
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw signingError('DEMO evaluator signing key must use Ed25519', 'ZK_EVALUATOR_KEY_INVALID', 503);
  }

  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyId = String(env.ZK_DEMO_ISSUER_KEY_ID || 'paradox-zk-demo-issuer').trim();
  if (!keyId || keyId.length > 100) {
    throw signingError('DEMO evaluator key ID is invalid', 'ZK_EVALUATOR_KEY_INVALID', 503);
  }

  return Object.freeze({
    keyId,
    environment: 'demo',
    status: 'active',
    publicKey,
    publicKeyPem,
    async signAttestation({
      evaluationId,
      learnerId,
      evidenceHash,
      credentialId,
      score,
      issuedAt = new Date(),
      circuitVersion,
    }) {
      return createEvaluationAttestation({
        evaluationId,
        learnerId,
        evidenceHash,
        credentialId,
        score,
        issuerPrivateKey: privateKey,
        issuerKeyId: keyId,
        issuedAt,
        circuitVersion,
      });
    },
  });
}
