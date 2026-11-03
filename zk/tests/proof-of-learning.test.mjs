import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as snarkjs from 'snarkjs';

import { build } from '../scripts/build.mjs';
import { artifactPaths } from '../lib/artifacts.mjs';
import {
  canonicalize,
  createEvaluationAttestation,
  generateIssuerKeyPair,
} from '../lib/attestation.mjs';
import {
  BINDING_DOMAIN,
  CIRCUIT_DOMAIN,
  FIELD_PRIME,
  credentialIdBinding,
  evaluationIdBinding,
  evidenceBinding,
  learnerBinding,
  toFieldString,
} from '../lib/field.mjs';
import { generateLearningProof } from '../lib/prover.mjs';
import { createMockEvaluation } from '../lib/mock-evaluation.mjs';
import { poseidon } from '../lib/poseidon.mjs';
import { verifyLearningProof } from '../lib/verifier.mjs';

const THRESHOLD = 75;
const paths = artifactPaths();

let issuerKeys;
let evaluation;
let attestation;
let witness;
let proof;
let expected;

function bytes32Field(label, value) {
  const hex = String(value).replace(/^0x/i, '');
  const digest = createHash('sha256')
    .update(`${BINDING_DOMAIN}|${label}|`, 'utf8')
    .update(Buffer.from(hex, 'hex'))
    .digest();
  return BigInt(`0x${digest.toString('hex')}`) % FIELD_PRIME;
}

async function issue({ score, evaluationOverrides = {}, nonce, learnerSalt = '', issuedAt } = {}) {
  const record = createMockEvaluation({ score, ...evaluationOverrides });
  const issued = await createEvaluationAttestation({
    evaluationId: record.evaluationId,
    learnerId: record.learnerId,
    evidenceHash: record.evidenceHash,
    credentialId: record.credentialId,
    score: record.score,
    nonce,
    learnerSalt,
    issuedAt,
    issuerPrivateKey: issuerKeys.privateKey,
  });
  return { evaluation: record, ...issued };
}

function trustedIssuersFor(keys = issuerKeys) {
  return { [attestation.issuer]: keys.publicKey };
}

function verify(overrides = {}) {
  return verifyLearningProof({
    proof: proof.proof,
    publicSignals: proof.publicSignals,
    attestation,
    trustedIssuers: trustedIssuersFor(),
    expected,
    ...overrides,
  });
}

/** Witness failures are expected; keep the circuit's console.error noise out of the report. */
async function expectWitnessFailure(run, matcher, message) {
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(run, matcher, message);
  } finally {
    console.error = originalError;
  }
}

async function rawWitnessProof({ score, threshold, sourceAttestation, domain = CIRCUIT_DOMAIN }) {
  const bindings = {
    evaluationIdHash: BigInt(sourceAttestation.evaluationIdHash),
    learnerBinding: BigInt(sourceAttestation.learnerBinding),
    evidenceHash: BigInt(sourceAttestation.evidenceHash),
    credentialIdHash: BigInt(sourceAttestation.credentialIdHash),
  };
  const nonce = 12345678901234567890n;
  const commitment = await poseidon([
    domain,
    score,
    bindings.evaluationIdHash,
    bindings.learnerBinding,
    bindings.evidenceHash,
    bindings.credentialIdHash,
    nonce,
  ]);
  const input = {
    threshold: threshold.toString(),
    commitment: commitment.toString(),
    ...Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, value.toString()])),
    score: score.toString(),
    nonce: nonce.toString(),
  };
  const [wasm, zkey] = await Promise.all([readFile(paths.wasm), readFile(paths.zkey)]);
  return snarkjs.groth16.fullProve(input, wasm, zkey, undefined, undefined, { singleThread: true });
}

before(async () => {
  await build();
  issuerKeys = generateIssuerKeyPair();
  evaluation = createMockEvaluation({ score: 92 });
  ({ attestation, witness } = await createEvaluationAttestation({
    evaluationId: evaluation.evaluationId,
    learnerId: evaluation.learnerId,
    evidenceHash: evaluation.evidenceHash,
    credentialId: evaluation.credentialId,
    score: evaluation.score,
    issuerPrivateKey: issuerKeys.privateKey,
  }));
  proof = await generateLearningProof({ attestation, witness, threshold: THRESHOLD });
  expected = {
    threshold: THRESHOLD,
    evaluationId: evaluation.evaluationId,
    learnerId: evaluation.learnerId,
    evidenceHash: evaluation.evidenceHash,
    credentialId: evaluation.credentialId,
  };
});

test('build produces a Groth16 verification key and documents a non-production setup', async () => {
  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'));
  assert.equal(manifest.circuit.name, 'score_threshold');
  assert.equal(manifest.circuit.nPublicInputs, 6);
  assert.ok(manifest.circuit.nConstraints > 0);
  assert.equal(manifest.trustedSetup.productionReady, false);
  assert.match(manifest.trustedSetup.mode, /single-contributor/);
});

test('accepts a score above the public threshold without revealing the score', async () => {
  const result = await verify();
  assert.equal(result.valid, true);
  assert.equal(result.reason, 'OK');
  assert.equal(proof.publicSignals.length, 6);
  assert.equal(proof.publicSignals[0], String(THRESHOLD));

  // Public signal layout is pinned to the circuit declaration order.
  assert.deepEqual(proof.publicSignals, [
    String(THRESHOLD),
    attestation.commitment,
    toFieldString(evaluationIdBinding(evaluation.evaluationId)),
    toFieldString(learnerBinding(evaluation.learnerId)),
    toFieldString(evidenceBinding(evaluation.evidenceHash)),
    toFieldString(credentialIdBinding(evaluation.credentialId)),
  ]);

  // Neither the attestation nor the proof contains a score field.
  assert.equal('score' in attestation, false);
  assert.equal('score' in proof, false);
  assert.equal(canonicalize(attestation).includes('"score"'), false);
  assert.equal(JSON.stringify(proof).includes('"score"'), false);

  // The witness keeps the score, but no public artifact does.
  assert.equal(witness.score, evaluation.score);
  assert.equal(proof.publicSignals[1], attestation.commitment);
});

test('accepts a score exactly equal to the threshold', async () => {
  const issued = await issue({ score: THRESHOLD });
  const equalProof = await generateLearningProof({
    attestation: issued.attestation,
    witness: issued.witness,
    threshold: THRESHOLD,
  });
  const result = await verifyLearningProof({
    proof: equalProof.proof,
    publicSignals: equalProof.publicSignals,
    attestation: issued.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected: {
      threshold: THRESHOLD,
      evaluationId: issued.evaluation.evaluationId,
      learnerId: issued.evaluation.learnerId,
      evidenceHash: issued.evaluation.evidenceHash,
      credentialId: issued.evaluation.credentialId,
    },
  });
  assert.equal(result.valid, true, result.reason);
  assert.equal(equalProof.publicSignals[0], String(THRESHOLD));
});

test('rejects proof generation when the score is below the threshold', async () => {
  const issued = await issue({ score: THRESHOLD - 1 });
  await expectWitnessFailure(
    () => generateLearningProof({
      attestation: issued.attestation,
      witness: issued.witness,
      threshold: THRESHOLD,
    }),
    /assert|constraint|Error in template/i,
  );
});

test('rejects invalid score ranges in the API and in the circuit', async () => {
  for (const invalid of [101, -1, 128]) {
    assert.throws(() => createMockEvaluation({ score: invalid }), RangeError);
    await assert.rejects(
      () => createEvaluationAttestation({
        evaluationId: evaluation.evaluationId,
        learnerId: evaluation.learnerId,
        evidenceHash: evaluation.evidenceHash,
        credentialId: evaluation.credentialId,
        score: invalid,
        issuerPrivateKey: issuerKeys.privateKey,
      }),
      RangeError,
    );
  }

  // Bypass the JS validation and feed the circuit directly. The commitment is
  // valid for the invalid value, so only the range constraints can reject it.
  for (const invalid of [101n, FIELD_PRIME - 1n, 128n]) {
    await expectWitnessFailure(
      () => rawWitnessProof({ score: invalid, threshold: 75n, sourceAttestation: attestation }),
      /assert|constraint|Error in template/i,
      `score ${invalid} should violate the range constraints`,
    );
  }

  // The public threshold is range-constrained too.
  await expectWitnessFailure(
    () => rawWitnessProof({ score: 100n, threshold: 101n, sourceAttestation: attestation }),
    /assert|constraint|Error in template/i,
  );
});

test('rejects a modified proof', async () => {
  const tampered = structuredClone(proof.proof);
  tampered.pi_a[0] = (BigInt(tampered.pi_a[0]) + 1n).toString();
  const result = await verify({ proof: tampered });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'INVALID_PROOF');
});

test('rejects a witness whose score does not match the signed commitment', async () => {
  await assert.rejects(
    () => generateLearningProof({
      attestation,
      witness: { ...witness, score: evaluation.score + 1 },
      threshold: THRESHOLD,
    }),
    error => error.code === 'COMMITMENT_MISMATCH',
  );

  // Tampering with the public commitment invalidates verification.
  const signals = [...proof.publicSignals];
  signals[1] = '1';
  const result = await verify({ publicSignals: signals });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'COMMITMENT_MISMATCH');

  // Tampering with the signed commitment breaks the attestation signature.
  const forged = {
    ...attestation,
    commitment: (BigInt(attestation.commitment) + 1n).toString(),
  };
  const forgedResult = await verify({ attestation: forged });
  assert.equal(forgedResult.valid, false);
  assert.equal(forgedResult.reason, 'INVALID_ATTESTATION_SIGNATURE');
});

test('rejects proof reuse with a different evaluation ID', async () => {
  const result = await verify({
    expected: { ...expected, evaluationId: randomUUID() },
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'EVALUATION_BINDING_MISMATCH');

  // Direct hash substitution fails exactly the same way.
  const hashed = await verify({
    expected: { ...expected, evaluationIdHash: toFieldString(evaluationIdBinding(randomUUID())) },
  });
  assert.equal(hashed.valid, false);
  assert.equal(hashed.reason, 'EVALUATION_BINDING_MISMATCH');
});

test('rejects proof reuse with a different learner binding', async () => {
  const result = await verify({
    expected: { ...expected, learnerId: randomUUID() },
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'LEARNER_BINDING_MISMATCH');

  const hashed = await verify({
    expected: { ...expected, learnerBinding: toFieldString(learnerBinding(randomUUID())) },
  });
  assert.equal(hashed.valid, false);
  assert.equal(hashed.reason, 'LEARNER_BINDING_MISMATCH');
});

test('rejects proof reuse against different evidence or credential bindings', async () => {
  const evidence = await verify({
    expected: { ...expected, evidenceHash: 'ab'.repeat(32) },
  });
  assert.equal(evidence.valid, false);
  assert.equal(evidence.reason, 'EVIDENCE_BINDING_MISMATCH');

  const credential = await verify({
    expected: { ...expected, credentialId: 'PXP-2026-FFFFFFFF-9999' },
  });
  assert.equal(credential.valid, false);
  assert.equal(credential.reason, 'CREDENTIAL_BINDING_MISMATCH');
});

test('rejects a self-generated commitment without a trusted evaluator signature', async () => {
  const attackerKeys = generateIssuerKeyPair();
  const rogue = await createEvaluationAttestation({
    evaluationId: evaluation.evaluationId,
    learnerId: evaluation.learnerId,
    evidenceHash: evaluation.evidenceHash,
    credentialId: evaluation.credentialId,
    score: 100,
    issuerPrivateKey: attackerKeys.privateKey,
    issuerKeyId: 'rogue-evaluator',
  });
  const rogueProof = await generateLearningProof({
    attestation: rogue.attestation,
    witness: rogue.witness,
    threshold: THRESHOLD,
  });

  const untrusted = await verifyLearningProof({
    proof: rogueProof.proof,
    publicSignals: rogueProof.publicSignals,
    attestation: rogue.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected,
  });
  assert.equal(untrusted.valid, false);
  assert.equal(untrusted.reason, 'UNTRUSTED_ISSUER');

  // Spoofing the trusted issuer key ID is not enough: the signature check fails.
  const spoofed = await createEvaluationAttestation({
    evaluationId: evaluation.evaluationId,
    learnerId: evaluation.learnerId,
    evidenceHash: evaluation.evidenceHash,
    credentialId: evaluation.credentialId,
    score: 100,
    issuerPrivateKey: attackerKeys.privateKey,
    issuerKeyId: 'paradox-ai-evaluator-local',
  });
  const spoofedProof = await generateLearningProof({
    attestation: spoofed.attestation,
    witness: spoofed.witness,
    threshold: THRESHOLD,
  });
  const spoofedResult = await verifyLearningProof({
    proof: spoofedProof.proof,
    publicSignals: spoofedProof.publicSignals,
    attestation: spoofed.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected,
  });
  assert.equal(spoofedResult.valid, false);
  assert.equal(spoofedResult.reason, 'INVALID_ATTESTATION_SIGNATURE');

  const unsigned = await verify({ attestation: { ...attestation, signature: '' } });
  assert.equal(unsigned.valid, false);
  assert.equal(unsigned.reason, 'INVALID_ATTESTATION');
});

test('enforces attestation freshness when a max age is supplied', async () => {
  const old = await issue({ score: 90, issuedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
  const oldExpected = {
    threshold: THRESHOLD,
    evaluationId: old.evaluation.evaluationId,
    learnerId: old.evaluation.learnerId,
    evidenceHash: old.evaluation.evidenceHash,
    credentialId: old.evaluation.credentialId,
  };
  const oldProof = await generateLearningProof({
    attestation: old.attestation,
    witness: old.witness,
    threshold: THRESHOLD,
  });
  const expired = await verifyLearningProof({
    proof: oldProof.proof,
    publicSignals: oldProof.publicSignals,
    attestation: old.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected: oldExpected,
    maxAgeSeconds: 60,
  });
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'ATTESTATION_EXPIRED');

  const fresh = await verifyLearningProof({
    proof: oldProof.proof,
    publicSignals: oldProof.publicSignals,
    attestation: old.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected: oldExpected,
  });
  assert.equal(fresh.valid, true, fresh.reason);

  const future = await issue({ score: 90, issuedAt: new Date(Date.now() + 60 * 60 * 1000) });
  const futureExpected = {
    threshold: THRESHOLD,
    evaluationId: future.evaluation.evaluationId,
    learnerId: future.evaluation.learnerId,
    evidenceHash: future.evaluation.evidenceHash,
    credentialId: future.evaluation.credentialId,
  };
  const futureProof = await generateLearningProof({
    attestation: future.attestation,
    witness: future.witness,
    threshold: THRESHOLD,
  });
  const futureResult = await verifyLearningProof({
    proof: futureProof.proof,
    publicSignals: futureProof.publicSignals,
    attestation: future.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected: futureExpected,
  });
  assert.equal(futureResult.valid, false);
  assert.equal(futureResult.reason, 'ATTESTATION_IN_FUTURE');
});

test('binds the threshold as a public policy value', async () => {
  const wrongThreshold = await verify({
    expected: { ...expected, threshold: THRESHOLD + 1 },
  });
  assert.equal(wrongThreshold.valid, false);
  assert.equal(wrongThreshold.reason, 'THRESHOLD_MISMATCH');

  const tamperedSignals = [...proof.publicSignals];
  tamperedSignals[0] = '0';
  const zeroThreshold = await verify({ publicSignals: tamperedSignals });
  assert.equal(zeroThreshold.valid, false);
  assert.equal(zeroThreshold.reason, 'THRESHOLD_MISMATCH');
});

test('bytes32 evidence and credential hashes use the Solidity-compatible SHA-256 binding', async () => {
  const evidenceHash = 'ab'.repeat(32);
  const credentialHash = `0x${'cd'.repeat(32)}`;
  assert.equal(evidenceBinding(evidenceHash), bytes32Field('evidence', evidenceHash));
  assert.equal(credentialIdBinding(credentialHash), bytes32Field('credential-id', credentialHash));

  const issued = await issue({
    score: 86,
    evaluationOverrides: { credentialId: credentialHash },
  });
  const zkProof = await generateLearningProof({
    attestation: issued.attestation,
    witness: issued.witness,
    threshold: THRESHOLD,
  });
  const result = await verifyLearningProof({
    proof: zkProof.proof,
    publicSignals: zkProof.publicSignals,
    attestation: issued.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected: {
      threshold: THRESHOLD,
      evaluationId: issued.evaluation.evaluationId,
      learnerId: issued.evaluation.learnerId,
      evidenceHash: issued.evaluation.evidenceHash,
      credentialId: credentialHash,
    },
  });
  assert.equal(result.valid, true, result.reason);
  assert.equal(zkProof.publicSignals[5], bytes32Field('credential-id', credentialHash).toString());
});

test('rejects bytes32 bindings that collide only under bare modulo p', async () => {
  // H and H + p are distinct 32-byte values but identical under uint256(H) % p.
  const evidenceHash = `01${'00'.repeat(31)}`;
  const evidenceCollision = (BigInt(`0x${evidenceHash}`) + FIELD_PRIME)
    .toString(16)
    .padStart(64, '0');
  assert.notEqual(
    evidenceBinding(evidenceHash),
    evidenceBinding(evidenceCollision),
    'domain-separated SHA-256 binding must separate H and H + p',
  );

  const issued = await issue({
    score: 86,
    evaluationOverrides: { evidenceHash },
  });
  const zkProof = await generateLearningProof({
    attestation: issued.attestation,
    witness: issued.witness,
    threshold: THRESHOLD,
  });
  const baseExpected = {
    threshold: THRESHOLD,
    evaluationId: issued.evaluation.evaluationId,
    learnerId: issued.evaluation.learnerId,
    evidenceHash,
    credentialId: issued.evaluation.credentialId,
  };
  const accepted = await verifyLearningProof({
    proof: zkProof.proof,
    publicSignals: zkProof.publicSignals,
    attestation: issued.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected: baseExpected,
  });
  assert.equal(accepted.valid, true, accepted.reason);

  const evidenceReplay = await verifyLearningProof({
    proof: zkProof.proof,
    publicSignals: zkProof.publicSignals,
    attestation: issued.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected: { ...baseExpected, evidenceHash: evidenceCollision },
  });
  assert.equal(evidenceReplay.valid, false);
  assert.equal(evidenceReplay.reason, 'EVIDENCE_BINDING_MISMATCH');

  const credentialId = `0x02${'00'.repeat(31)}`;
  const credentialCollision = `0x${(BigInt(credentialId) + FIELD_PRIME)
    .toString(16)
    .padStart(64, '0')}`;
  const credentialIssued = await issue({
    score: 86,
    evaluationOverrides: { credentialId },
  });
  const credentialProof = await generateLearningProof({
    attestation: credentialIssued.attestation,
    witness: credentialIssued.witness,
    threshold: THRESHOLD,
  });
  const credentialExpected = {
    threshold: THRESHOLD,
    evaluationId: credentialIssued.evaluation.evaluationId,
    learnerId: credentialIssued.evaluation.learnerId,
    evidenceHash: credentialIssued.evaluation.evidenceHash,
    credentialId,
  };
  const credentialReplay = await verifyLearningProof({
    proof: credentialProof.proof,
    publicSignals: credentialProof.publicSignals,
    attestation: credentialIssued.attestation,
    trustedIssuers: trustedIssuersFor(),
    expected: { ...credentialExpected, credentialId: credentialCollision },
  });
  assert.equal(credentialReplay.valid, false);
  assert.equal(credentialReplay.reason, 'CREDENTIAL_BINDING_MISMATCH');
});

test('rejects tampering with every public signal', async () => {
  const cases = [
    [0, '0', 'THRESHOLD_MISMATCH'],
    [1, '1', 'COMMITMENT_MISMATCH'],
    [2, '1', 'EVALUATION_BINDING_MISMATCH'],
    [3, '1', 'LEARNER_BINDING_MISMATCH'],
    [4, '1', 'EVIDENCE_BINDING_MISMATCH'],
    [5, '1', 'CREDENTIAL_BINDING_MISMATCH'],
  ];
  for (const [index, value, reason] of cases) {
    const signals = [...proof.publicSignals];
    signals[index] = value;
    const result = await verify({ publicSignals: signals });
    assert.equal(result.valid, false, `signal ${index} should be rejected`);
    assert.equal(result.reason, reason);
  }
});

test('does not resolve issuer IDs through Object.prototype', async () => {
  for (const issuerId of ['__proto__', 'constructor', 'toString']) {
    const result = await verify({
      attestation: { ...attestation, issuer: issuerId },
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'UNTRUSTED_ISSUER', `${issuerId} must not be trusted`);
  }
});

test('rejects revoked or invalid credential status when supplied', async () => {
  const revoked = await verify({
    expected: { ...expected, credentialRevoked: true },
  });
  assert.equal(revoked.valid, false);
  assert.equal(revoked.reason, 'CREDENTIAL_REVOKED');

  const invalid = await verify({
    expected: { ...expected, credentialValid: false },
  });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, 'CREDENTIAL_INVALID');
});

test('presents the same proof idempotently; one-time claims need a nullifier', async () => {
  // Replay across contexts is blocked by the bindings. Replay of the same
  // presentation is intentional for a bearer credential; callers that need
  // one-time use must add a nullifier/consumption registry.
  const first = await verify();
  const second = await verify();
  assert.equal(first.valid, true);
  assert.equal(second.valid, true);
});

test('commitment is hiding: equal scores with different nonces produce different commitments', async () => {
  const first = await issue({ score: 88, nonce: 111111n });
  const second = await issue({ score: 88, nonce: 222222n });
  assert.notEqual(first.attestation.commitment, second.attestation.commitment);
  assert.notEqual(first.attestation.commitment, '88');
  assert.equal(canonicalize(first.attestation).includes('"score"'), false);

  await assert.rejects(() => issue({ score: 88, nonce: 0n }), TypeError);
  await assert.rejects(() => issue({ score: 88, nonce: FIELD_PRIME }), TypeError);
});
