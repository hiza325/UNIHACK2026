import { readFile } from 'node:fs/promises';
import * as snarkjs from 'snarkjs';
import { artifactPaths } from './artifacts.mjs';
import {
  ATTESTATION_SCHEMA_VERSION,
  CIRCUIT_ID,
  CIRCUIT_VERSION,
  verifyAttestationSignature,
} from './attestation.mjs';
import {
  credentialIdBinding,
  evaluationIdBinding,
  evidenceBinding,
  learnerBinding,
  toFieldString,
} from './field.mjs';

export const PUBLIC_SIGNAL_NAMES = Object.freeze([
  'threshold',
  'commitment',
  'evaluationIdHash',
  'learnerBinding',
  'evidenceHash',
  'credentialIdHash',
]);

function fingerprint(value) {
  return String(value ?? '').slice(0, 16);
}

function result(valid, reason, checks) {
  return { valid, reason, checks };
}

function expectedBindings(expected) {
  if (!expected || typeof expected !== 'object') {
    throw new TypeError('expected verification values are required');
  }
  const threshold = Number(expected.threshold);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    throw new TypeError('expected.threshold must be an integer between 0 and 100');
  }
  const evaluationIdHash = expected.evaluationIdHash !== undefined
    ? BigInt(expected.evaluationIdHash)
    : evaluationIdBinding(expected.evaluationId);
  const learner = expected.learnerBinding !== undefined
    ? BigInt(expected.learnerBinding)
    : learnerBinding(expected.learnerId, { salt: expected.learnerSalt });
  const evidence = evidenceBinding(expected.evidenceHash);
  const credential = expected.credentialId !== undefined
    ? credentialIdBinding(expected.credentialId)
    : null;
  return {
    threshold: String(threshold),
    evaluationIdHash: toFieldString(evaluationIdHash),
    learnerBinding: toFieldString(learner),
    evidenceHash: toFieldString(evidence),
    credentialIdHash: credential === null ? null : toFieldString(credential),
  };
}

function trustedKeyFor(trustedIssuers, issuerId) {
  if (!trustedIssuers) return null;
  if (trustedIssuers instanceof Map) return trustedIssuers.get(issuerId) || null;
  if (Array.isArray(trustedIssuers)) {
    return trustedIssuers.find(entry => entry?.keyId === issuerId)?.publicKey || null;
  }
  if (typeof trustedIssuers !== 'object') return null;
  // Only own properties count. Without this, issuer IDs such as "__proto__" or
  // "constructor" could resolve inherited values instead of being untrusted.
  return Object.hasOwn(trustedIssuers, issuerId) ? trustedIssuers[issuerId] || null : null;
}

/**
 * Independently verifies a learning proof.
 *
 * The proof alone only says "a committed score meets a threshold". Trust that the
 * AI actually awarded the score comes from the evaluator-signed attestation.
 * Both are required, and all public bindings must match the verifier's expected
 * evaluation, learner, evidence and credential context.
 */
export async function verifyLearningProof({
  proof,
  publicSignals,
  attestation,
  trustedIssuers,
  expected,
  vkey,
  buildDir,
  maxAgeSeconds,
  now = new Date(),
  clockSkewSeconds = 300,
}) {
  const checks = {
    structure: false,
    issuerTrusted: false,
    attestationSignature: false,
    circuitMatch: false,
    freshness: true,
    thresholdPolicy: false,
    evaluationBinding: false,
    learnerBinding: false,
    evidenceBinding: false,
    credentialBinding: true,
    credentialStatus: true,
    proof: false,
  };

  if (!Array.isArray(publicSignals) || publicSignals.length !== PUBLIC_SIGNAL_NAMES.length) {
    return result(false, 'INVALID_PUBLIC_SIGNALS', checks);
  }
  if (!publicSignals.every(value => /^\d+$/.test(String(value)))) {
    return result(false, 'INVALID_PUBLIC_SIGNALS', checks);
  }
  if (!attestation || typeof attestation !== 'object'
    || typeof attestation.signature !== 'string' || !attestation.signature) {
    return result(false, 'INVALID_ATTESTATION', checks);
  }
  checks.structure = true;

  const issuerKey = trustedKeyFor(trustedIssuers, attestation.issuer);
  if (!issuerKey) return result(false, 'UNTRUSTED_ISSUER', checks);
  checks.issuerTrusted = true;

  if (!verifyAttestationSignature(attestation, issuerKey)) {
    return result(false, 'INVALID_ATTESTATION_SIGNATURE', checks);
  }
  checks.attestationSignature = true;

  if (
    attestation.schemaVersion !== ATTESTATION_SCHEMA_VERSION
    || attestation.circuit !== CIRCUIT_ID
    || attestation.circuitVersion !== CIRCUIT_VERSION
  ) {
    return result(false, 'ATTESTATION_SCHEMA_MISMATCH', checks);
  }
  checks.circuitMatch = true;

  let wanted;
  try {
    wanted = expectedBindings(expected);
  } catch (error) {
    return result(false, `INVALID_EXPECTATION:${error.message}`, checks);
  }

  // Revocation is not part of the circuit. The caller must supply the latest
  // registry/DB state; when supplied here, a revoked or invalid credential is
  // rejected before the expensive pairing check.
  if (expected.credentialRevoked === true) {
    checks.credentialStatus = false;
    return result(false, 'CREDENTIAL_REVOKED', checks);
  }
  if (expected.credentialValid === false) {
    checks.credentialStatus = false;
    return result(false, 'CREDENTIAL_INVALID', checks);
  }

  const issuedAt = new Date(attestation.issuedAt);
  if (Number.isNaN(issuedAt.getTime())) return result(false, 'INVALID_ISSUED_AT', checks);
  if (issuedAt.getTime() > new Date(now).getTime() + clockSkewSeconds * 1000) {
    return result(false, 'ATTESTATION_IN_FUTURE', checks);
  }
  if (maxAgeSeconds !== undefined) {
    if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
      return result(false, 'INVALID_MAX_AGE', checks);
    }
    if (new Date(now).getTime() - issuedAt.getTime() > maxAgeSeconds * 1000) {
      return result(false, 'ATTESTATION_EXPIRED', checks);
    }
  }

  const signals = Object.fromEntries(PUBLIC_SIGNAL_NAMES.map((name, index) => [name, String(publicSignals[index])]));

  if (signals.threshold !== wanted.threshold) return result(false, 'THRESHOLD_MISMATCH', checks);
  checks.thresholdPolicy = true;

  if (signals.evaluationIdHash !== wanted.evaluationIdHash
    || attestation.evaluationIdHash !== wanted.evaluationIdHash) {
    return result(false, 'EVALUATION_BINDING_MISMATCH', checks);
  }
  checks.evaluationBinding = true;

  if (signals.learnerBinding !== wanted.learnerBinding
    || attestation.learnerBinding !== wanted.learnerBinding) {
    return result(false, 'LEARNER_BINDING_MISMATCH', checks);
  }
  checks.learnerBinding = true;

  if (signals.evidenceHash !== wanted.evidenceHash
    || attestation.evidenceHash !== wanted.evidenceHash) {
    return result(false, 'EVIDENCE_BINDING_MISMATCH', checks);
  }
  checks.evidenceBinding = true;

  if (wanted.credentialIdHash !== null
    && (signals.credentialIdHash !== wanted.credentialIdHash
      || attestation.credentialIdHash !== wanted.credentialIdHash)) {
    return result(false, 'CREDENTIAL_BINDING_MISMATCH', checks);
  }

  if (signals.commitment !== attestation.commitment) {
    return result(false, 'COMMITMENT_MISMATCH', checks);
  }

  const verificationKey = vkey || JSON.parse(await readFile(artifactPaths(buildDir).vkey, 'utf8'));
  let proofValid = false;
  try {
    proofValid = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
  } catch {
    proofValid = false;
  } finally {
    // snarkjs caches a multi-threaded bn128 curve in globalThis. Terminating it
    // keeps short-lived CLI/test processes from hanging on live workers.
    try {
      await globalThis.curve_bn128?.terminate?.();
    } catch {
      // Best-effort cleanup only.
    }
  }
  if (!proofValid) return result(false, 'INVALID_PROOF', checks);
  checks.proof = true;

  return result(true, 'OK', { ...checks, commitmentFingerprint: fingerprint(signals.commitment) });
}
