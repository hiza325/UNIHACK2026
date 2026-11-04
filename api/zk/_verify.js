/**
 * Server-side verification of a stored ZK Proof of Learning.
 *
 * This module never creates a proof and never returns score/nonce/witness or
 * private learner/evaluation identifiers. It verifies, in order:
 *   1. stored record status/threshold/circuit/vkey pin;
 *   2. public signals against server-owned evaluation/learner/evidence/credential;
 *   3. Ed25519 evaluator attestation with a trusted public key;
 *   4. Groth16 proof with the pinned verification key;
 *   5. read-only Avalanche Fuji credential state.
 *
 * Any dependency failure fails closed. Tests inject fake Groth16/attestation
 * verifiers and a fake gateway; no real proof or blockchain transaction is made.
 */

import * as snarkjs from 'snarkjs';
import {
  ATTESTATION_SCHEMA_VERSION,
  CIRCUIT_ID,
  CIRCUIT_VERSION,
  verifyAttestationSignature,
} from '../../zk/lib/attestation.mjs';
import {
  credentialIdBinding,
  evaluationIdBinding,
  evidenceBinding,
  learnerBinding,
  toFieldString,
} from '../../zk/lib/field.mjs';
import { assertOnChainCredential, ZK_DEFAULT_THRESHOLD } from './_policy.js';
import { assertNoPrivateFields, toPublicProofRecord, toPublicSignals, ZK_PUBLIC_SIGNAL_NAMES } from './_projection.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ZK_DEFAULT_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 300;

function verificationError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function result(valid, reason, checks, extra = {}) {
  return { valid, reason, checks, ...extra };
}

function checkDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function reasonForCredentialError(code) {
  return {
    ZK_CREDENTIAL_REVOKED: 'CREDENTIAL_REVOKED',
    ZK_CREDENTIAL_NOT_ONCHAIN: 'CREDENTIAL_NOT_ONCHAIN',
    ZK_CREDENTIAL_EVIDENCE_MISMATCH: 'CREDENTIAL_EVIDENCE_MISMATCH',
    ZK_CREDENTIAL_BINDING_MISMATCH: 'CREDENTIAL_BINDING_MISMATCH',
    ZK_ONCHAIN_VERIFICATION_REQUIRED: 'CREDENTIAL_STATUS_UNAVAILABLE',
  }[code] || 'CREDENTIAL_STATUS_UNAVAILABLE';
}

export function createZkVerificationService({
  store,
  keyConfig,
  gateway,
  verifyGroth16 = snarkjs.groth16.verify,
  verifyAttestation = verifyAttestationSignature,
  now = () => new Date(),
  maxAgeSeconds = ZK_DEFAULT_MAX_AGE_SECONDS,
} = {}) {
  if (!store || typeof store.findById !== 'function') throw new TypeError('ZK proof store is required');
  if (!keyConfig?.verificationKey || !keyConfig?.vkeySha256 || !keyConfig?.circuitVersion) {
    throw new TypeError('ZK key configuration is required');
  }
  if (!gateway || typeof gateway.verifyCredential !== 'function') throw new TypeError('Read-only Avalanche gateway is required');
  if (typeof verifyGroth16 !== 'function' || typeof verifyAttestation !== 'function') {
    throw new TypeError('ZK verifiers are required');
  }
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) throw new TypeError('ZK max age is invalid');

  async function verify(proofId) {
    const id = String(proofId ?? '').trim().toLowerCase();
    if (!UUID.test(id)) throw verificationError('Proof ID is invalid', 'ZK_PROOF_ID_INVALID', 400);

    const row = await store.findById(id);
    if (!row) throw verificationError('ZK proof was not found', 'ZK_PROOF_NOT_FOUND', 404);

    const checks = {
      record: false,
      threshold: false,
      circuit: false,
      vkey: false,
      issuer: false,
      publicSignals: false,
      bindings: false,
      commitment: false,
      attestation: false,
      proof: false,
      credential: false,
    };

    if (row.status !== 'active') {
      return result(false, row.status === 'revoked' ? 'ZK_PROOF_REVOKED' : 'ZK_PROOF_SUPERSEDED', checks);
    }
    checks.record = true;

    if (Number(row.threshold) !== ZK_DEFAULT_THRESHOLD) {
      return result(false, 'THRESHOLD_MISMATCH', checks);
    }
    checks.threshold = true;

    if (String(row.circuit_version) !== String(keyConfig.circuitVersion)) {
      return result(false, 'CIRCUIT_VERSION_MISMATCH', checks);
    }
    checks.circuit = true;

    if (String(row.vkey_hash).toLowerCase() !== String(keyConfig.vkeySha256).toLowerCase()) {
      return result(false, 'VKEY_HASH_MISMATCH', checks);
    }
    checks.vkey = true;

    let signals;
    try {
      signals = toPublicSignals(row.public_signals);
    } catch {
      return result(false, 'INVALID_PUBLIC_SIGNALS', checks);
    }
    if (signals.threshold !== String(ZK_DEFAULT_THRESHOLD)) {
      return result(false, 'THRESHOLD_MISMATCH', checks);
    }
    checks.publicSignals = true;

    let expected;
    try {
      expected = {
        threshold: String(ZK_DEFAULT_THRESHOLD),
        commitment: String(row.commitment),
        evaluationIdHash: toFieldString(evaluationIdBinding(row.evaluation_id)),
        learnerBinding: toFieldString(learnerBinding(row.learner_id)),
        evidenceHash: toFieldString(evidenceBinding(row.evidence_hash)),
        credentialIdHash: toFieldString(credentialIdBinding(row.credential_id_hash)),
      };
    } catch {
      return result(false, 'INVALID_PROOF_RECORD', checks);
    }

    const bindingReasons = {
      evaluationIdHash: 'EVALUATION_BINDING_MISMATCH',
      learnerBinding: 'LEARNER_BINDING_MISMATCH',
      evidenceHash: 'EVIDENCE_BINDING_MISMATCH',
      credentialIdHash: 'CREDENTIAL_BINDING_MISMATCH',
    };
    for (const field of Object.keys(bindingReasons)) {
      if (signals[field] !== expected[field]) return result(false, bindingReasons[field], checks);
    }
    if (signals.commitment !== expected.commitment) return result(false, 'COMMITMENT_MISMATCH', checks);
    checks.bindings = true;
    checks.commitment = true;

    const attestation = row.attestation;
    if (!attestation || typeof attestation !== 'object') {
      return result(false, 'ATTESTATION_SCHEMA_MISMATCH', checks);
    }
    if (attestation.schemaVersion !== ATTESTATION_SCHEMA_VERSION
      || attestation.circuit !== CIRCUIT_ID
      || attestation.circuitVersion !== CIRCUIT_VERSION) {
      return result(false, 'ATTESTATION_SCHEMA_MISMATCH', checks);
    }
    if (String(attestation.issuer) !== String(row.issuer_key_id)) {
      return result(false, 'ATTESTATION_MISMATCH', checks);
    }

    let issuerKey;
    try {
      const { resolveIssuerKey } = await import('./_keys.js');
      issuerKey = resolveIssuerKey(keyConfig, row.issuer_key_id);
    } catch {
      return result(false, 'UNTRUSTED_ISSUER', checks);
    }
    checks.issuer = true;

    let attestationValid = false;
    try {
      attestationValid = verifyAttestation(attestation, issuerKey.publicKey);
    } catch {
      attestationValid = false;
    }
    if (!attestationValid) return result(false, 'INVALID_ATTESTATION_SIGNATURE', checks);

    // `threshold` is a public policy input, not an attestation field. It is
    // checked against the row and public signals above, and pinned to 80.
    for (const field of ['commitment', ...Object.keys(bindingReasons)]) {
      if (String(attestation[field] ?? '') !== expected[field]) {
        return result(false, 'ATTESTATION_MISMATCH', checks);
      }
    }

    const rowIssuedAt = checkDate(row.issued_at);
    const attestationIssuedAt = checkDate(attestation.issuedAt);
    if (!rowIssuedAt || !attestationIssuedAt || rowIssuedAt.getTime() !== attestationIssuedAt.getTime()) {
      return result(false, 'ATTESTATION_MISMATCH', checks);
    }

    const clock = new Date(typeof now === 'function' ? now() : now);
    if (Number.isNaN(clock.getTime())) return result(false, 'ATTESTATION_EXPIRED', checks);
    if (attestationIssuedAt.getTime() > clock.getTime() + CLOCK_SKEW_SECONDS * 1000) {
      return result(false, 'ATTESTATION_FUTURE', checks);
    }
    if (clock.getTime() - attestationIssuedAt.getTime() > maxAgeSeconds * 1000) {
      return result(false, 'ATTESTATION_EXPIRED', checks);
    }
    checks.attestation = true;

    const signalArray = ZK_PUBLIC_SIGNAL_NAMES.map(name => signals[name]);
    let proofValid = false;
    try {
      proofValid = await verifyGroth16(keyConfig.verificationKey, signalArray, row.proof);
    } catch {
      proofValid = false;
    } finally {
      // snarkjs caches a multi-threaded curve in globalThis; don't keep workers
      // alive after a serverless request. Injected test verifiers are unaffected.
      try {
        await globalThis.curve_bn128?.terminate?.();
      } catch {
        // Best-effort cleanup only.
      }
    }
    if (!proofValid) return result(false, 'INVALID_PROOF', checks);
    checks.proof = true;

    let onChain;
    try {
      onChain = await gateway.verifyCredential(row.credential_id_hash);
    } catch {
      return result(false, 'CREDENTIAL_STATUS_UNAVAILABLE', checks, { retryable: true });
    }

    try {
      assertOnChainCredential({ credential: row, onChain });
    } catch (error) {
      return result(false, reasonForCredentialError(error?.code), checks);
    }
    checks.credential = true;

    let proof;
    try {
      proof = toPublicProofRecord(row);
    } catch {
      return result(false, 'INVALID_PROOF_RECORD', checks);
    }

    // Defence in depth: the public projection must never contain private fields.
    try {
      assertNoPrivateFields(proof);
    } catch {
      return result(false, 'INVALID_PROOF_RECORD', checks);
    }

    // Classification is a server-side snapshot plus live setup checks:
    //   DEMO: test credential or demo snapshot.
    //   OFFICIAL: non-test snapshot + production setup + trusted issuer.
    //   UNCLASSIFIED: anything else (e.g. official snapshot checked under dev).
    // Never trust a client-supplied demo/official flag.
    const credentialIsTest = row.credential_is_test === true;
    let classification = 'UNCLASSIFIED';
    if (row.proof_mode === 'demo' || credentialIsTest) {
      classification = 'DEMO';
    } else if (
      row.proof_mode === 'official'
      && row.credential_is_test === false
      && keyConfig.setupMode === 'production'
      && keyConfig.productionVerified === true
      && keyConfig.previewDemo !== true
      && keyConfig.manifest?.trustedSetup?.productionReady === true
      && String(keyConfig.manifest?.trustedSetup?.mode || '') !== 'local-single-contributor'
      && keyConfig.activeTrustedIssuers?.get?.(row.issuer_key_id)?.environment === 'production'
    ) {
      classification = 'OFFICIAL';
    }
    proof = Object.freeze({ ...proof, classification });

    return result(true, 'OK', checks, {
      proof,
      classification,
      credentialStatus: 'VALID',
      issuerKeyId: row.issuer_key_id,
      verifiedAt: clock.toISOString(),
    });
  }

  return { verify };
}
