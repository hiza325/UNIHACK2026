#!/usr/bin/env node
/**
 * End-to-end mock demonstration:
 *   mock AI evaluation -> signed commitment -> Groth16 proof -> independent verify
 *
 * Writes only public artifacts to build/demo/. The score and blinding nonce are
 * never persisted or printed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactPaths, BUILD_DIR } from '../lib/artifacts.mjs';
import { createEvaluationAttestation, generateIssuerKeyPair } from '../lib/attestation.mjs';
import { createMockEvaluation } from '../lib/mock-evaluation.mjs';
import { generateLearningProof } from '../lib/prover.mjs';
import { verifyLearningProof } from '../lib/verifier.mjs';

const THRESHOLD = 75;
const demoDir = join(BUILD_DIR, 'demo');
const paths = artifactPaths();

const evaluation = createMockEvaluation({
  score: 91,
  problem: 'Chứng minh rằng nếu 2x + 3 = 11 thì x = 4.',
  previousSolution: 'x = 7',
  solution: '2x = 8, do đó x = 4. Thay lại: 2(4) + 3 = 11.',
  model: 'mock-gemini-evaluator',
});

const issuer = generateIssuerKeyPair();
const { attestation, witness } = await createEvaluationAttestation({
  evaluationId: evaluation.evaluationId,
  learnerId: evaluation.learnerId,
  evidenceHash: evaluation.evidenceHash,
  credentialId: evaluation.credentialId,
  score: evaluation.score,
  issuerPrivateKey: issuer.privateKey,
});

const proof = await generateLearningProof({ attestation, witness, threshold: THRESHOLD });
const result = await verifyLearningProof({
  proof: proof.proof,
  publicSignals: proof.publicSignals,
  attestation,
  trustedIssuers: { [attestation.issuer]: issuer.publicKey },
  expected: {
    threshold: THRESHOLD,
    evaluationId: evaluation.evaluationId,
    learnerId: evaluation.learnerId,
    evidenceHash: evaluation.evidenceHash,
    credentialId: evaluation.credentialId,
  },
});

await mkdir(demoDir, { recursive: true });
const publicArtifacts = {
  'attestation.json': attestation,
  'proof.json': proof.proof,
  'public-signals.json': proof.publicSignals,
  'verification.json': result,
  'issuer-public-key.pem': issuer.publicKeyPem,
  'README.txt': [
    'PARADOX ZK Proof of Learning — mock demo artifacts',
    '',
    'The learner score and the commitment nonce are NOT included.',
    `Public threshold: ${THRESHOLD}`,
    `Verification: ${result.valid ? 'VALID' : 'INVALID'} (${result.reason})`,
    `Circuit: ${proof.circuit} ${proof.circuitVersion}`,
    '',
  ].join('\n'),
};
for (const [name, value] of Object.entries(publicArtifacts)) {
  const body = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(join(demoDir, name), body);
}

process.stdout.write([
  'PARADOX ZK Proof of Learning — demo',
  `  evaluation:       ${evaluation.evaluationId}`,
  `  threshold:        ${THRESHOLD}`,
  `  score:            private (${evaluation.score >= THRESHOLD ? 'meets' : 'does not meet'} threshold)`,
  `  commitment:       ${attestation.commitment.slice(0, 24)}…`,
  `  public signals:   ${proof.publicSignals.length}`,
  `  verification:     ${result.valid ? 'VALID' : 'INVALID'} (${result.reason})`,
  `  artifacts:        build/demo/`,
  `  verifier key:     ${paths.vkey}`,
  '',
].join('\n'));
