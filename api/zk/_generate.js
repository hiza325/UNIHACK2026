/**
 * Server-side ZK Proof of Learning generation.
 *
 * This module is the only place that may construct a private witness. It never
 * trusts a client score, never accepts an evaluator private key from the client,
 * and never persists or returns score, nonce or witness data.
 *
 * Live issuance is additionally gated by loadDemoEvaluatorSigner, which fails
 * closed when no server-side DEMO signing key is configured.
 */

import {
  assertCredentialBinding,
  assertEvaluationEligible,
  assertEvaluationOwnership,
  assertOnChainCredential,
  assertProofEligibility,
  classifyProofSnapshot,
  resolveThreshold,
} from './_policy.js';
import { assertInsertRecord, createZkProofStore } from './_store.js';
import { createZkVerificationService } from './_verify.js';
import { loadDemoEvaluatorSigner } from './_signing.js';
import { generateLearningProof } from '../../zk/lib/prover.mjs';
import { ZK_DEFAULT_MAX_AGE_SECONDS } from './_verify.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generationError(message, code, status = 400, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

function requireUuid(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(normalized)) throw generationError(`${field} is invalid`, 'ZK_INVALID_INPUT', 400);
  return normalized;
}

function safeCredential(credential) {
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
    throw generationError('Credential is invalid', 'ZK_CREDENTIAL_INVALID', 400);
  }
  return credential;
}

export function createZkProofGenerationService({
  store,
  keyConfig,
  issuerSigner,
  dependencies,
  now = () => new Date(),
  maxAgeSeconds = ZK_DEFAULT_MAX_AGE_SECONDS,
  attestFn,
  generateProofFn = generateLearningProof,
  verifyProofFn,
} = {}) {
  if (!store || typeof store.findById !== 'function' || typeof store.insertProof !== 'function' || typeof store.findByEvaluationThreshold !== 'function') {
    throw new TypeError('ZK proof store is required');
  }
  if (!keyConfig?.verificationKey || !keyConfig?.vkeySha256 || !keyConfig?.circuitVersion) {
    throw new TypeError('ZK key configuration is required');
  }
  if (!dependencies || typeof dependencies.getEvaluation !== 'function'
    || typeof dependencies.getCredential !== 'function'
    || typeof dependencies.getOnChainCredential !== 'function') {
    throw new TypeError('ZK proof dependencies are required');
  }
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) throw new TypeError('ZK max age is invalid');

  const attest = attestFn || (async (params) => {
    if (!issuerSigner || typeof issuerSigner.signAttestation !== 'function') {
      throw generationError('DEMO evaluator signing is unavailable', 'ZK_ISSUER_SIGNING_UNAVAILABLE', 503);
    }
    return issuerSigner.signAttestation(params);
  });

  async function generate({ learnerId, evaluationId, threshold } = {}) {
    const learner = requireUuid(learnerId, 'Learner ID');
    const evaluation = requireUuid(evaluationId, 'Evaluation ID');
    const resolvedThreshold = resolveThreshold(threshold);

    const evaluationRecord = await dependencies.getEvaluation(evaluation, learner);
    if (!evaluationRecord) throw generationError('Evaluation was not found', 'ZK_EVALUATION_NOT_FOUND', 404);

    const ownership = assertEvaluationOwnership(evaluationRecord, learner);
    const eligibility = assertEvaluationEligible(evaluationRecord, resolvedThreshold);
    const credential = safeCredential(await dependencies.getCredential(evaluationRecord));
    const binding = assertCredentialBinding({ evaluation: evaluationRecord, credential });

    let onChain;
    try {
      onChain = await dependencies.getOnChainCredential(credential);
    } catch (error) {
      throw generationError('Credential status is unavailable', 'ZK_CREDENTIAL_STATUS_UNAVAILABLE', 503, error);
    }
    assertOnChainCredential({ credential, onChain });

    const proofEligibility = assertProofEligibility({
      evaluation: evaluationRecord,
      credential,
      learnerId: learner,
      threshold: resolvedThreshold,
      onChain,
    });

    const existing = await store.findByEvaluationThreshold({
      evaluationId: ownership.evaluationId,
      threshold: proofEligibility.threshold,
      circuitVersion: keyConfig.circuitVersion,
    });
    if (existing) {
      const classification = classifyProofSnapshot({
        credential,
        keyConfig,
        issuerKeyId: existing.issuer_key_id,
      });
      return Object.freeze({
        proofId: existing.id,
        status: 'existing',
        classification: classification.proofMode,
        credentialStatus: 'VALID',
        issuerKeyId: existing.issuer_key_id,
      });
    }

    if (!issuerSigner || typeof issuerSigner.signAttestation !== 'function') {
      throw generationError('DEMO evaluator signing is unavailable', 'ZK_ISSUER_SIGNING_UNAVAILABLE', 503);
    }

    const issuedAt = new Date(typeof now === 'function' ? now() : now);
    if (Number.isNaN(issuedAt.getTime())) {
      throw generationError('Issued-at time is invalid', 'ZK_INVALID_INPUT', 400);
    }

    const attestationBundle = await attest({
      evaluationId: ownership.evaluationId,
      learnerId: ownership.learnerId,
      evidenceHash: proofEligibility.evidenceHash,
      credentialId: proofEligibility.credentialIdHash,
      score: Number(eligibility ? evaluationRecord.score : evaluationRecord.score),
      issuedAt,
      circuitVersion: keyConfig.circuitVersion,
    });

    if (!attestationBundle?.attestation || !attestationBundle?.witness) {
      throw generationError('Evaluator attestation is unavailable', 'ZK_ATTESTATION_UNAVAILABLE', 503);
    }

    const proof = await generateProofFn({
      attestation: attestationBundle.attestation,
      witness: attestationBundle.witness,
      threshold: proofEligibility.threshold,
    });

    const classification = classifyProofSnapshot({
      credential,
      keyConfig,
      issuerKeyId: attestationBundle.attestation.issuer,
    });

    const row = assertInsertRecord({
      evaluation_id: ownership.evaluationId,
      learner_id: ownership.learnerId,
      credential_id_hash: proofEligibility.credentialIdHash,
      evidence_hash: proofEligibility.evidenceHash,
      threshold: proofEligibility.threshold,
      circuit_version: keyConfig.circuitVersion,
      vkey_hash: keyConfig.vkeySha256,
      commitment: attestationBundle.attestation.commitment,
      public_signals: proof.publicSignals,
      proof: proof.proof,
      attestation: attestationBundle.attestation,
      issuer_key_id: attestationBundle.attestation.issuer,
      issued_at: issuedAt.toISOString(),
      status: 'active',
      proof_mode: classification.proofMode,
      credential_is_test: classification.credentialIsTest,
      revoked_at: null,
    });

    // Verify the generated artifacts before persistence. A mock store is used
    // here so verification does not depend on the generated row's database id.
    const verificationRow = { ...row, id: '00000000-0000-4000-8000-000000000000' };
    let verified;
    if (verifyProofFn) {
      const verificationResult = await verifyProofFn(verificationRow);
      verified = typeof verificationResult === 'boolean'
        ? { valid: verificationResult }
        : (verificationResult || {});
    } else {
      const verifier = createZkVerificationService({
        store: { findById: async () => verificationRow },
        keyConfig,
        gateway: { verifyCredential: async () => onChain },
        now: () => issuedAt,
        maxAgeSeconds,
      });
      verified = await verifier.verify(verificationRow.id);
    }
    if (!verified?.valid) {
      throw generationError('Generated proof failed verification', 'ZK_GENERATED_PROOF_INVALID', 500);
    }

    let inserted;
    try {
      inserted = await store.insertProof(row);
    } catch (error) {
      if (error?.code === 'ZK_PROOF_CONFLICT' || error?.status === 409) {
        const existingAfterConflict = await store.findByEvaluationThreshold({
          evaluationId: ownership.evaluationId,
          threshold: proofEligibility.threshold,
          circuitVersion: keyConfig.circuitVersion,
        });
        if (existingAfterConflict) {
          const existingClassification = classifyProofSnapshot({
            credential,
            keyConfig,
            issuerKeyId: existingAfterConflict.issuer_key_id,
          });
          return Object.freeze({
            proofId: existingAfterConflict.id,
            status: 'existing',
            classification: existingClassification.proofMode,
            credentialStatus: 'VALID',
            issuerKeyId: existingAfterConflict.issuer_key_id,
          });
        }
      }
      throw generationError('ZK proof could not be persisted', 'ZK_PROOF_DATABASE_ERROR', 502, error);
    }

    const finalClassification = classifyProofSnapshot({
      credential,
      keyConfig,
      issuerKeyId: inserted.issuer_key_id,
    });

    return Object.freeze({
      proofId: inserted.id,
      status: 'generated',
      classification: finalClassification.proofMode,
      credentialStatus: 'VALID',
      issuerKeyId: inserted.issuer_key_id,
    });
  }

  return { generate };
}
