import { createHash } from 'node:crypto';

/**
 * BN254 (BabyJubjub) scalar field used by circom + snarkjs Groth16.
 */
export const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Circuit-level domain separator. Must stay byte-for-byte identical to the
 * DOMAIN constant in circuits/score_threshold.circom.
 */
export const CIRCUIT_DOMAIN = 0x50415241444f585a4bn; // ASCII "PARADOXZK"

export const BINDING_DOMAIN = 'paradox-zk-proof-of-learning-v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX32 = /^(?:0x)?[0-9a-f]{64}$/i;

/**
 * Deterministic hash-to-field with domain separation and rejection of zero.
 * SHA-256 output is reduced modulo the BN254 scalar field.
 */
export function hashToField(label, value) {
  if (!label) throw new TypeError('hashToField label is required');
  for (let counter = 0; counter < 16; counter += 1) {
    const digest = createHash('sha256')
      .update(`${BINDING_DOMAIN}|${label}|${counter}|${String(value)}`)
      .digest();
    const reduced = BigInt(`0x${digest.toString('hex')}`) % FIELD_PRIME;
    if (reduced !== 0n) return reduced;
  }
  throw new Error('Unable to derive a non-zero field element');
}

export function normalizeEvaluationId(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) throw new TypeError('Evaluation ID is required');
  if (normalized.length > 200) throw new TypeError('Evaluation ID is too long');
  return normalized;
}

export function normalizeLearnerId(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) throw new TypeError('Learner ID is required');
  if (!UUID.test(normalized)) throw new TypeError('Learner ID must be a UUID');
  return normalized;
}

export function normalizeEvidenceHash(value) {
  const raw = String(value ?? '').trim().replace(/^sha256:/i, '').replace(/^0x/i, '');
  if (!HEX32.test(raw)) throw new TypeError('Evidence hash must be a 32-byte SHA-256 hex string');
  if (/^0{64}$/i.test(raw)) throw new TypeError('Evidence hash must not be all zeroes');
  return raw.toLowerCase();
}

export function normalizeCredentialId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (normalized.length > 200) throw new TypeError('Credential ID is too long');
  return normalized;
}

/**
 * Public, pseudonymous bindings. In production the learner binding should be
 * produced with a server-held HMAC pepper (see docs) so it cannot be correlated
 * across contexts; this helper accepts an optional salt for that purpose.
 */
export function evaluationIdBinding(evaluationId) {
  return hashToField('evaluation-id', normalizeEvaluationId(evaluationId));
}

export function learnerBinding(learnerId, { salt = '' } = {}) {
  return hashToField('learner', `${String(salt)}|${normalizeLearnerId(learnerId)}`);
}

/**
 * Binds a full 32-byte value to a field element without the trivial additive
 * collision of `uint256(value) % p` (where H and H + p map to the same field
 * element). We hash the domain-separated label and the raw 32 bytes first:
 *
 *   sha256("paradox-zk-proof-of-learning-v1|" || label || "|" || bytes32)
 *       mod FIELD_PRIME
 *
 * This formula is reproducible in Solidity with the SHA-256 precompile:
 *
 *   uint256(sha256(abi.encodePacked(
 *       "paradox-zk-proof-of-learning-v1|", label, "|", value
 *   ))) % FIELD_PRIME
 *
 * The final reduction still maps 2^256 values into a ~2^254 field, but a
 * collision now requires breaking SHA-256 collision/preimage resistance rather
 * than simple integer addition. If information-theoretic injectivity is
 * required, split the value into two 128-bit limbs instead (see docs).
 */
export function bytes32Binding(label, value) {
  if (!label) throw new TypeError('bytes32Binding label is required');
  const normalized = String(value ?? '').trim().replace(/^0x/i, '').toLowerCase();
  if (!HEX32.test(normalized) || /^0{64}$/i.test(normalized)) {
    throw new TypeError('Binding value must be a non-zero 32-byte hex string');
  }
  const digest = createHash('sha256')
    .update(`${BINDING_DOMAIN}|${label}|`, 'utf8')
    .update(Buffer.from(normalized, 'hex'))
    .digest();
  const reduced = BigInt(`0x${digest.toString('hex')}`) % FIELD_PRIME;
  if (reduced === 0n) throw new TypeError('Binding must be non-zero');
  return reduced;
}

/** Evidence hashes already live on-chain as bytes32; bind all 32 bytes. */
export function evidenceBinding(evidenceHash) {
  return bytes32Binding('evidence', normalizeEvidenceHash(evidenceHash));
}

/**
 * Accepts either the existing `credential_id_hash` bytes32 (preferred for
 * Avalanche interoperability) or the human-readable credential code (local
 * fallback). A bytes32 value uses the same SHA-256 binding as evidence.
 */
export function credentialIdBinding(credentialId) {
  const normalized = normalizeCredentialId(credentialId);
  if (!normalized) return 0n;
  if (/^(?:0x)?[0-9a-f]{64}$/i.test(normalized)) {
    return bytes32Binding('credential-id', normalized);
  }
  return hashToField('credential-id', normalized);
}

export function toFieldString(value) {
  if (typeof value === 'bigint') {
    if (value < 0n || value >= FIELD_PRIME) throw new RangeError('Field element is out of range');
    return value.toString(10);
  }
  if (typeof value === 'number') return toFieldString(BigInt(value));
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new TypeError('Field element must be a decimal string');
  return toFieldString(BigInt(text));
}
