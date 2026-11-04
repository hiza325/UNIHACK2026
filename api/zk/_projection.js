/**
 * Public projections for ZK Proof of Learning.
 *
 * Everything returned by a public API must pass through this allowlist. The
 * score, nonce, witness, learner_id and evaluation_id are never included.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL = /^[0-9]+$/;
const HASH32 = /^0x[0-9a-f]{64}$/i;
const VKEY_HASH = /^[0-9a-f]{64}$/i;

export const ZK_PUBLIC_SIGNAL_NAMES = Object.freeze([
  'threshold',
  'commitment',
  'evaluationIdHash',
  'learnerBinding',
  'evidenceHash',
  'credentialIdHash',
]);

const ATTESTATION_FIELDS = Object.freeze([
  'schemaVersion',
  'circuit',
  'circuitVersion',
  'issuer',
  'commitment',
  'evaluationIdHash',
  'learnerBinding',
  'evidenceHash',
  'credentialIdHash',
  'issuedAt',
  'signature',
]);

const PROOF_FIELDS = Object.freeze(['pi_a', 'pi_b', 'pi_c', 'protocol', 'curve']);

const FORBIDDEN_KEYS = new Set([
  'score',
  'assessment_score',
  'assessmentscore',
  'nonce',
  'witness',
  'private_key',
  'privatekey',
  'evaluator_private_key',
  'learner_id',
  'evaluation_id',
  'email',
]);

export function assertNoPrivateFields(value, path = 'projection') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      throw new TypeError(`ZK public projection contains a private field: ${path}.${key}`);
    }
    assertNoPrivateFields(nested, `${path}.${key}`);
  }
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}

function requireString(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is invalid`);
  return text;
}

export function toPublicSignals(value) {
  let signals;
  if (Array.isArray(value)) {
    if (value.length !== ZK_PUBLIC_SIGNAL_NAMES.length) {
      throw new TypeError('ZK public signal count is invalid');
    }
    signals = value.map((item, index) => [ZK_PUBLIC_SIGNAL_NAMES[index], String(item ?? '').trim()]);
  } else {
    const record = requireObject(value, 'ZK public signals');
    signals = ZK_PUBLIC_SIGNAL_NAMES.map(name => [name, String(record[name] ?? '').trim()]);
    const extra = Object.keys(record).filter(key => !ZK_PUBLIC_SIGNAL_NAMES.includes(key));
    if (extra.length) throw new TypeError('ZK public signals contain unknown fields');
  }

  const projected = {};
  for (const [name, signal] of signals) {
    if (!DECIMAL.test(signal)) throw new TypeError(`ZK public signal ${name} is invalid`);
    projected[name] = signal;
  }
  return Object.freeze(projected);
}

export function toPublicAttestation(value) {
  const attestation = requireObject(value, 'ZK attestation');
  const projected = {};
  for (const field of ATTESTATION_FIELDS) {
    projected[field] = requireString(attestation[field], `ZK attestation ${field}`);
  }
  return Object.freeze(projected);
}

export function toPublicProof(value) {
  const proof = requireObject(value, 'ZK proof');
  const projected = {};
  for (const field of PROOF_FIELDS) {
    if (proof[field] !== undefined) projected[field] = proof[field];
  }
  // snarkjs uses 2 affine coordinates plus a final "1" for G1 points, and may
  // include a third "1/0" row for G2. Accept both the snarkjs shape and the
  // compact 2-coordinate fixture shape.
  const isG1 = value => Array.isArray(value) && (value.length === 2 || value.length === 3);
  const isG2 = value => Array.isArray(value) && (value.length === 2 || value.length === 3)
    && value.every(row => Array.isArray(row) && row.length === 2);
  if (!isG1(projected.pi_a)) throw new TypeError('ZK proof pi_a is invalid');
  if (!isG2(projected.pi_b)) throw new TypeError('ZK proof pi_b is invalid');
  if (!isG1(projected.pi_c)) throw new TypeError('ZK proof pi_c is invalid');
  return Object.freeze(projected);
}

/**
 * Public proof object. The allowlist is intentionally narrow:
 *   - no score, nonce, witness;
 *   - no learner_id, evaluation_id, email or assessment score;
 *   - credential IDs/evidence hashes are already public on Avalanche.
 */
export function toPublicProofRecord(row) {
  const record = requireObject(row, 'ZK proof record');
  const proofId = requireString(record.id, 'Proof ID');
  if (!UUID.test(proofId)) throw new TypeError('Proof ID is invalid');

  const threshold = Number(record.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    throw new TypeError('Threshold is invalid');
  }
  const circuitVersion = requireString(record.circuit_version, 'Circuit version');
  const vkeyHash = requireString(record.vkey_hash, 'Verification key hash');
  if (!VKEY_HASH.test(vkeyHash)) throw new TypeError('Verification key hash is invalid');

  const credentialIdHash = requireString(record.credential_id_hash, 'Credential ID hash');
  const evidenceHash = requireString(record.evidence_hash, 'Evidence hash');
  if (!HASH32.test(credentialIdHash) || !HASH32.test(evidenceHash)) {
    throw new TypeError('Credential binding is invalid');
  }

  const status = requireString(record.status || 'active', 'Status');
  if (!['active', 'revoked', 'superseded'].includes(status)) {
    throw new TypeError('Status is invalid');
  }

  const commitment = requireString(record.commitment, 'Commitment');
  if (!DECIMAL.test(commitment)) throw new TypeError('Commitment is invalid');
  const issuedAt = requireString(record.issued_at, 'Issued at');
  if (Number.isNaN(new Date(issuedAt).getTime())) throw new TypeError('Issued at is invalid');

  const publicSignals = toPublicSignals(record.public_signals);
  if (publicSignals.threshold !== String(threshold)) {
    throw new TypeError('Public threshold does not match the proof record');
  }
  if (publicSignals.commitment !== commitment) {
    throw new TypeError('Public commitment does not match the proof record');
  }

  // Snapshot classification is safe to expose, but this projection never
  // upgrades a proof to OFFICIAL. Only the verification service may do that
  // after checking production setup, the active issuer key and on-chain state.
  const proofMode = record.proof_mode === 'official' ? 'official' : 'demo';
  const credentialIsTest = record.credential_is_test === true;
  const classification = proofMode === 'demo' || credentialIsTest ? 'DEMO' : 'UNCLASSIFIED';

  const projected = {
    proofId,
    threshold,
    circuit: {
      name: 'score_threshold',
      version: circuitVersion,
      vkeySha256: vkeyHash,
    },
    commitment,
    publicSignals,
    attestation: toPublicAttestation(record.attestation),
    proof: toPublicProof(record.proof),
    credential: {
      idHash: credentialIdHash.toLowerCase(),
      evidenceHash: evidenceHash.toLowerCase(),
    },
    issuerKeyId: requireString(record.issuer_key_id, 'Issuer key ID'),
    issuedAt,
    status,
    classification,
  };

  assertNoPrivateFields(projected);
  return Object.freeze(projected);
}

/** Lightweight UI summary; still no score or private identifiers. */
export function toPublicProofSummary(row) {
  const proof = toPublicProofRecord(row);
  return Object.freeze({
    proofId: proof.proofId,
    threshold: proof.threshold,
    circuit: proof.circuit,
    credential: proof.credential,
    issuerKeyId: proof.issuerKeyId,
    issuedAt: proof.issuedAt,
    status: proof.status,
    classification: proof.classification,
  });
}
