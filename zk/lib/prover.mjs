import { readFile } from 'node:fs/promises';
import * as snarkjs from 'snarkjs';
import { artifactPaths, artifactsReady } from './artifacts.mjs';
import { CIRCUIT_ID, CIRCUIT_VERSION } from './attestation.mjs';
import { computeScoreCommitment } from './commitment.mjs';
import { toFieldString } from './field.mjs';

function proofError(message, code) {
  return Object.assign(new Error(message), { code });
}

function parseWitnessField(value, name) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw proofError(`Witness ${name} must be a decimal field element`, 'INVALID_WITNESS');
  return BigInt(text);
}

/**
 * Generates a Groth16 proof that the private `witness.score` meets `threshold`.
 *
 * The prover recomputes the commitment from the private witness and refuses to
 * prove unless it matches the evaluator-signed attestation. A mismatched score
 * therefore cannot be substituted for an attested score.
 */
export async function generateLearningProof({
  attestation,
  witness,
  threshold,
  buildDir,
}) {
  if (!attestation || typeof attestation !== 'object') throw proofError('Attestation is required', 'INVALID_ATTESTATION');
  if (!witness || typeof witness !== 'object') throw proofError('Private witness is required', 'INVALID_WITNESS');
  if (attestation.circuit !== CIRCUIT_ID || attestation.circuitVersion !== CIRCUIT_VERSION) {
    throw proofError('Attestation was produced for a different circuit', 'CIRCUIT_MISMATCH');
  }

  const numericThreshold = Number(threshold);
  if (!Number.isInteger(numericThreshold) || numericThreshold < 0 || numericThreshold > 100) {
    throw proofError('Threshold must be an integer between 0 and 100', 'INVALID_THRESHOLD');
  }
  const numericScore = Number(witness.score);
  if (!Number.isInteger(numericScore) || numericScore < 0 || numericScore > 100) {
    throw proofError('Score must be an integer between 0 and 100', 'INVALID_SCORE');
  }

  const bindings = {
    evaluationIdHash: parseWitnessField(witness.evaluationIdHash, 'evaluationIdHash'),
    learnerBinding: parseWitnessField(witness.learnerBinding, 'learnerBinding'),
    evidenceHash: parseWitnessField(witness.evidenceHash, 'evidenceHash'),
    credentialIdHash: parseWitnessField(witness.credentialIdHash, 'credentialIdHash'),
    nonce: parseWitnessField(witness.nonce, 'nonce'),
  };

  for (const [name, value] of Object.entries(bindings)) {
    if (name === 'nonce') continue;
    if (attestation[name] !== toFieldString(value)) {
      throw proofError(`Witness ${name} does not match the signed attestation`, 'BINDING_MISMATCH');
    }
  }

  const { commitment } = await computeScoreCommitment({ score: numericScore, ...bindings });
  if (attestation.commitment !== toFieldString(commitment)) {
    throw proofError('Private score/nonce do not match the signed commitment', 'COMMITMENT_MISMATCH');
  }

  const paths = artifactPaths(buildDir);
  if (!(await artifactsReady(paths.buildDir))) {
    throw proofError('ZK build artifacts are missing; run `npm run build` in zk/', 'ARTIFACTS_MISSING');
  }

  const [wasm, zkey] = await Promise.all([
    readFile(paths.wasm),
    readFile(paths.zkey),
  ]);

  const input = {
    threshold: String(numericThreshold),
    commitment: attestation.commitment,
    evaluationIdHash: attestation.evaluationIdHash,
    learnerBinding: attestation.learnerBinding,
    evidenceHash: attestation.evidenceHash,
    credentialIdHash: attestation.credentialIdHash,
    score: String(numericScore),
    nonce: bindings.nonce.toString(10),
  };

  // singleThread avoids worker_threads, which would otherwise keep Node alive
  // after the proof has been generated.
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasm,
    zkey,
    undefined,
    undefined,
    { singleThread: true },
  );

  return {
    schemaVersion: 'paradox-zk-proof-of-learning-proof-v1',
    circuit: CIRCUIT_ID,
    circuitVersion: CIRCUIT_VERSION,
    threshold: numericThreshold,
    proof,
    publicSignals,
    /** Score and nonce are intentionally absent. */
    meta: {
      commitment: attestation.commitment,
      constraintSystem: 'groth16-bn254',
    },
  };
}
