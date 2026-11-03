import { CIRCUIT_DOMAIN, FIELD_PRIME, toFieldString } from './field.mjs';
import { poseidon } from './poseidon.mjs';

export const COMMITMENT_SCHEMA_VERSION = 'paradox-zk-score-commitment-v1';
export const COMMITMENT_INPUT_COUNT = 7;

/**
 * Commitment layout (must match circuits/score_threshold.circom):
 *   Poseidon(DOMAIN, score, evaluationIdHash, learnerBinding, evidenceHash, credentialIdHash, nonce)
 *
 * `nonce` is private and high-entropy, which makes the commitment hiding even
 * though the score space is only 0..100.
 */
export async function computeScoreCommitment({
  score,
  nonce,
  evaluationIdHash,
  learnerBinding,
  evidenceHash,
  credentialIdHash,
}) {
  const numericScore = Number(score);
  if (!Number.isInteger(numericScore) || numericScore < 0 || numericScore > 100) {
    throw new RangeError('Score must be an integer between 0 and 100');
  }
  let nonceValue;
  try {
    nonceValue = BigInt(nonce);
  } catch {
    throw new TypeError('Commitment nonce must be a positive field element');
  }
  if (nonceValue <= 0n || nonceValue >= FIELD_PRIME) {
    throw new TypeError('Commitment nonce must be a positive field element below the BN254 modulus');
  }
  const digest = await poseidon([
    CIRCUIT_DOMAIN,
    BigInt(numericScore),
    evaluationIdHash,
    learnerBinding,
    evidenceHash,
    credentialIdHash,
    nonceValue,
  ]);
  return {
    schemaVersion: COMMITMENT_SCHEMA_VERSION,
    commitment: digest,
    inputs: {
      domain: CIRCUIT_DOMAIN,
      score: BigInt(numericScore),
      evaluationIdHash,
      learnerBinding,
      evidenceHash,
      credentialIdHash,
      nonce: nonceValue,
    },
  };
}

export function commitmentToJson(commitment) {
  return {
    schemaVersion: commitment.schemaVersion,
    commitment: toFieldString(commitment.commitment),
  };
}
