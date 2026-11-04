/**
 * ZK Proof of Learning policy.
 *
 * Server-owned decisions only:
 *   - the client never supplies a score;
 *   - the score is read from learning_evaluations;
 *   - ownership and eligibility are checked here;
 *   - DB blockchain_status is NOT sufficient proof of on-chain validity;
 *     callers must also pass a fresh read-only Avalanche registry result.
 *
 * This module is deliberately pure: no database, network, filesystem or secrets.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BYTES32 = /^(?:0x)?[0-9a-f]{64}$/i;

export const ZK_DEFAULT_THRESHOLD = 80;
export const ZK_ALLOWED_THRESHOLDS = Object.freeze([80]);
export const ZK_MIN_THRESHOLD = 1;
export const ZK_MAX_THRESHOLD = 100;

function policyError(message, code, status = 409, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

function requireUuid(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(normalized)) throw policyError(`${field} is invalid`, 'ZK_INVALID_INPUT', 400);
  return normalized;
}

function normalizeBytes32(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!BYTES32.test(normalized)) throw policyError(`${field} is invalid`, 'ZK_INVALID_INPUT', 400);
  return normalized.startsWith('0x') ? normalized : `0x${normalized}`;
}

function requireEvaluation(evaluation) {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    throw policyError('Evaluation is invalid', 'ZK_EVALUATION_INVALID', 400);
  }
  return evaluation;
}

export function resolveThreshold(value) {
  if (value === undefined || value === null || value === '') return ZK_DEFAULT_THRESHOLD;
  const threshold = Number(value);
  if (!Number.isInteger(threshold) || !ZK_ALLOWED_THRESHOLDS.includes(threshold)) {
    throw policyError('Threshold is not allowed', 'ZK_INVALID_THRESHOLD', 400);
  }
  return threshold;
}

export function assertEvaluationOwnership(evaluation, learnerId) {
  const record = requireEvaluation(evaluation);
  const evaluationId = requireUuid(record.id, 'Evaluation ID');
  const learner = requireUuid(learnerId, 'Learner ID');
  if (String(record.learner_id ?? '').trim().toLowerCase() !== learner) {
    throw policyError('Evaluation does not belong to this learner', 'ZK_EVALUATION_NOT_OWNED', 403);
  }
  return { evaluationId, learnerId: learner };
}

export function assertEvaluationEligible(evaluation, threshold = ZK_DEFAULT_THRESHOLD) {
  const record = requireEvaluation(evaluation);
  const resolvedThreshold = resolveThreshold(threshold);

  if (record.status !== 'pass') {
    throw policyError('Evaluation is not eligible for a proof', 'ZK_EVALUATION_NOT_ELIGIBLE', 409);
  }
  if (record.credential_eligible !== true) {
    throw policyError('Evaluation is not eligible for a proof', 'ZK_EVALUATION_NOT_ELIGIBLE', 409);
  }

  if (record.score === null || record.score === undefined || record.score === '') {
    throw policyError('Evaluation is invalid', 'ZK_EVALUATION_INVALID', 409);
  }
  const score = Number(record.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw policyError('Evaluation is invalid', 'ZK_EVALUATION_INVALID', 409);
  }
  // Do not include the score in the error message. The learner already knows
  // their own score; the API must never echo it, and public callers never see it.
  if (score < resolvedThreshold) {
    throw policyError('Evaluation does not meet the requested threshold', 'ZK_THRESHOLD_NOT_MET', 409);
  }

  const credentialIdHash = normalizeBytes32(record.credential_id_hash, 'Credential ID hash');
  const evidenceHash = normalizeBytes32(record.credential_hash, 'Evidence hash');
  return { threshold: resolvedThreshold, credentialIdHash, evidenceHash };
}

export function assertCredentialBinding({ evaluation, credential }) {
  const record = requireEvaluation(evaluation);
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
    throw policyError('Credential is invalid', 'ZK_CREDENTIAL_INVALID', 400);
  }

  const evaluationId = requireUuid(record.id, 'Evaluation ID');
  const learnerId = requireUuid(record.learner_id, 'Learner ID');
  if (String(credential.evaluation_id ?? '').trim().toLowerCase() !== evaluationId) {
    throw policyError('Credential is not bound to this evaluation', 'ZK_CREDENTIAL_BINDING_MISMATCH', 409);
  }
  if (String(credential.learner_id ?? '').trim().toLowerCase() !== learnerId) {
    throw policyError('Credential is not bound to this learner', 'ZK_CREDENTIAL_BINDING_MISMATCH', 409);
  }

  const evaluationCredentialIdHash = normalizeBytes32(record.credential_id_hash, 'Credential ID hash');
  const evaluationEvidenceHash = normalizeBytes32(record.credential_hash, 'Evidence hash');
  const credentialIdHash = normalizeBytes32(credential.credential_id_hash, 'Credential ID hash');
  const evidenceHash = normalizeBytes32(credential.evidence_hash, 'Evidence hash');

  if (credentialIdHash !== evaluationCredentialIdHash) {
    throw policyError('Credential ID hash does not match the evaluation', 'ZK_CREDENTIAL_BINDING_MISMATCH', 409);
  }
  if (evidenceHash !== evaluationEvidenceHash) {
    throw policyError('Evidence hash does not match the evaluation', 'ZK_CREDENTIAL_BINDING_MISMATCH', 409);
  }

  // This is only the database projection. It is never sufficient on its own:
  // the caller must also obtain a fresh read-only registry result.
  if (credential.blockchain_status !== 'confirmed' || credential.onchain_valid !== true) {
    throw policyError('Credential is not confirmed', 'ZK_CREDENTIAL_NOT_CONFIRMED', 409);
  }

  return {
    credentialIdHash,
    evidenceHash,
    dbConfirmed: true,
    onChainVerificationRequired: true,
  };
}

export function assertOnChainCredential({ credential, onChain }) {
  if (!credential || typeof credential !== 'object') {
    throw policyError('Credential is invalid', 'ZK_CREDENTIAL_INVALID', 400);
  }
  if (!onChain || typeof onChain !== 'object') {
    throw policyError('On-chain verification is required', 'ZK_ONCHAIN_VERIFICATION_REQUIRED', 503);
  }
  if (onChain.exists !== true) {
    throw policyError('Credential does not exist on-chain', 'ZK_CREDENTIAL_NOT_ONCHAIN', 409);
  }
  if (onChain.revoked === true) {
    throw policyError('Credential has been revoked', 'ZK_CREDENTIAL_REVOKED', 409);
  }
  if (onChain.valid !== true) {
    throw policyError('Credential is not valid on-chain', 'ZK_CREDENTIAL_NOT_ONCHAIN', 409);
  }

  const expectedCredentialId = normalizeBytes32(credential.credential_id_hash, 'Credential ID hash');
  if (onChain.credentialId !== undefined) {
    const onChainCredentialId = normalizeBytes32(onChain.credentialId, 'On-chain credential ID');
    if (onChainCredentialId !== expectedCredentialId) {
      throw policyError('On-chain credential ID does not match', 'ZK_CREDENTIAL_BINDING_MISMATCH', 409);
    }
  }

  const expectedEvidence = normalizeBytes32(credential.evidence_hash, 'Evidence hash');
  const onChainEvidence = normalizeBytes32(onChain.evidenceHash, 'On-chain evidence hash');
  if (onChainEvidence !== expectedEvidence) {
    throw policyError('On-chain evidence hash does not match', 'ZK_CREDENTIAL_EVIDENCE_MISMATCH', 409);
  }

  return { verified: true, evidenceHash: expectedEvidence };
}

/**
 * Full gate used before any future proof creation.
 *
 * `onChain` is mandatory. A database `blockchain_status` value alone can never
 * satisfy this function, which prevents stale DB state from being accepted as
 * proof of current on-chain validity.
 */
export function assertProofEligibility({
  evaluation,
  credential,
  learnerId,
  threshold = ZK_DEFAULT_THRESHOLD,
  onChain,
}) {
  const ownership = assertEvaluationOwnership(evaluation, learnerId);
  const eligibility = assertEvaluationEligible(evaluation, threshold);
  const binding = assertCredentialBinding({ evaluation, credential });

  if (onChain === undefined || onChain === null) {
    throw policyError('On-chain verification is required', 'ZK_ONCHAIN_VERIFICATION_REQUIRED', 503);
  }
  assertOnChainCredential({ credential, onChain });

  // Deliberately no score in the returned object.
  return Object.freeze({
    threshold: eligibility.threshold,
    evaluationId: ownership.evaluationId,
    learnerId: ownership.learnerId,
    credentialIdHash: binding.credentialIdHash,
    evidenceHash: binding.evidenceHash,
  });
}

/**
 * Server-side TEST classification aligned with OP1:
 *   - learning_credentials.is_test OR the PXP-TEST- code prefix;
 *   - client-supplied flags are never consulted.
 */
export function isTestCredential(credential) {
  const code = String(credential?.credential_code ?? credential?.code ?? '').trim().toUpperCase();
  return credential?.is_test === true || !code || code.startsWith('PXP-TEST-');
}

/**
 * Creates the immutable classification snapshot for a new proof. This is the
 * only place a future create-proof endpoint may obtain proof_mode.
 *
 * OFFICIAL requires all of:
 *   - non-test credential (DB flag and code prefix);
 *   - source = ai-evaluation;
 *   - production trusted setup manifest;
 *   - an active trusted issuer key.
 *
 * Everything else is DEMO. A client cannot override this.
 */
export function classifyProofSnapshot({ credential, keyConfig, issuerKeyId } = {}) {
  if (!credential || typeof credential !== 'object') {
    throw policyError('Credential is invalid', 'ZK_CREDENTIAL_INVALID', 400);
  }
  const credentialIsTest = isTestCredential(credential);
  const issuer = keyConfig?.activeTrustedIssuers?.get?.(issuerKeyId);
  const trustedIssuer = issuer?.environment === 'production';
  const productionSetup = keyConfig?.setupMode === 'production'
    && keyConfig?.manifest?.trustedSetup?.productionReady === true
    && String(keyConfig?.manifest?.trustedSetup?.mode || '') !== 'local-single-contributor';
  const official = !credentialIsTest
    && credential.source === 'ai-evaluation'
    && productionSetup
    && trustedIssuer;

  return Object.freeze({
    proofMode: official ? 'official' : 'demo',
    credentialIsTest,
  });
}

export function publicPolicy() {
  return Object.freeze({
    defaultThreshold: ZK_DEFAULT_THRESHOLD,
    allowedThresholds: [...ZK_ALLOWED_THRESHOLDS],
    minThreshold: ZK_MIN_THRESHOLD,
    maxThreshold: ZK_MAX_THRESHOLD,
  });
}
