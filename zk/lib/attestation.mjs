import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { computeScoreCommitment } from './commitment.mjs';
import {
  credentialIdBinding,
  evaluationIdBinding,
  evidenceBinding,
  learnerBinding,
  FIELD_PRIME,
  toFieldString,
} from './field.mjs';

export const ATTESTATION_SCHEMA_VERSION = 'paradox-zk-evaluation-attestation-v1';
export const CIRCUIT_ID = 'score_threshold';
export const CIRCUIT_VERSION = '1.0.0';

const ATTESTATION_KEYS = new Set([
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

/** Recursively sorted JSON so signer and verifier hash identical bytes. */
export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function generateIssuerKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicKey,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function loadPrivateKey(value) {
  if (value && typeof value === 'object' && value.type === 'private') return value;
  return createPrivateKey(value);
}

export function loadPublicKey(value) {
  if (value && typeof value === 'object' && value.type === 'public') return value;
  return value?.privateKey ? createPublicKey(value.privateKey) : createPublicKey(value);
}

/** Cryptographically strong, non-zero field element suitable as hiding nonce. */
export function randomFieldNonce() {
  for (;;) {
    const candidate = BigInt(`0x${randomBytes(32).toString('hex')}`) % FIELD_PRIME;
    if (candidate !== 0n) return candidate;
  }
}

function signStatement(statement, privateKey) {
  return sign(null, Buffer.from(canonicalize(statement), 'utf8'), loadPrivateKey(privateKey)).toString('base64');
}

/**
 * Builds the signed attestation that binds a private score to an authenticated
 * AI evaluation. The score and nonce never appear in the returned attestation.
 *
 * This is the trust boundary: only the holder of the evaluator key can create
 * an attestation. A learner-generated commitment alone is not accepted.
 */
export async function createEvaluationAttestation({
  evaluationId,
  learnerId,
  evidenceHash,
  credentialId = '',
  score,
  nonce = randomFieldNonce(),
  learnerSalt = '',
  issuerPrivateKey,
  issuerKeyId = 'paradox-ai-evaluator-local',
  issuedAt = new Date(),
  circuit = CIRCUIT_ID,
  circuitVersion = CIRCUIT_VERSION,
}) {
  if (!issuerPrivateKey) throw new TypeError('Issuer private key is required');
  if (!issuerKeyId) throw new TypeError('Issuer key ID is required');

  const numericScore = Number(score);
  if (!Number.isInteger(numericScore) || numericScore < 0 || numericScore > 100) {
    throw new RangeError('Score must be an integer between 0 and 100');
  }

  const bindings = {
    evaluationIdHash: evaluationIdBinding(evaluationId),
    learnerBinding: learnerBinding(learnerId, { salt: learnerSalt }),
    evidenceHash: evidenceBinding(evidenceHash),
    credentialIdHash: credentialIdBinding(credentialId),
  };

  const { commitment } = await computeScoreCommitment({
    score: numericScore,
    nonce,
    ...bindings,
  });

  const statement = {
    schemaVersion: ATTESTATION_SCHEMA_VERSION,
    circuit,
    circuitVersion,
    issuer: String(issuerKeyId),
    commitment: toFieldString(commitment),
    evaluationIdHash: toFieldString(bindings.evaluationIdHash),
    learnerBinding: toFieldString(bindings.learnerBinding),
    evidenceHash: toFieldString(bindings.evidenceHash),
    credentialIdHash: toFieldString(bindings.credentialIdHash),
    issuedAt: new Date(issuedAt).toISOString(),
  };

  const attestation = {
    ...statement,
    signature: signStatement(statement, issuerPrivateKey),
  };

  return {
    attestation,
    /** Must stay private: score + blinding nonce. Never publish this object. */
    witness: {
      score: numericScore,
      nonce: toFieldString(nonce),
      evaluationIdHash: statement.evaluationIdHash,
      learnerBinding: statement.learnerBinding,
      evidenceHash: statement.evidenceHash,
      credentialIdHash: statement.credentialIdHash,
    },
  };
}

export function verifyAttestationSignature(attestation, publicKey) {
  if (!attestation || typeof attestation !== 'object') return false;
  for (const key of Object.keys(attestation)) {
    if (!ATTESTATION_KEYS.has(key)) return false;
  }
  if (attestation.schemaVersion !== ATTESTATION_SCHEMA_VERSION) return false;
  if (typeof attestation.signature !== 'string' || !attestation.signature) return false;
  const { signature, ...statement } = attestation;
  try {
    return verify(
      null,
      Buffer.from(canonicalize(statement), 'utf8'),
      loadPublicKey(publicKey),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}
