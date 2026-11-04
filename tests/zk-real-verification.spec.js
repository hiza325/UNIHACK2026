import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { artifactsReady, artifactPaths } from '../zk/lib/artifacts.mjs';
import {
  createEvaluationAttestation,
  generateIssuerKeyPair,
} from '../zk/lib/attestation.mjs';
import { credentialIdBinding, evaluationIdBinding, evidenceBinding, learnerBinding, toFieldString } from '../zk/lib/field.mjs';
import { generateLearningProof } from '../zk/lib/prover.mjs';
import { loadKeyConfig } from '../api/zk/_keys.js';
import { createZkVerificationService } from '../api/zk/_verify.js';

const EVALUATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROOF_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CREDENTIAL_HASH = `0x${'11'.repeat(32)}`;
const OTHER_CREDENTIAL_HASH = `0x${'22'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'33'.repeat(32)}`;
const OTHER_EVIDENCE_HASH = `0x${'44'.repeat(32)}`;
const ISSUED_AT = '2026-11-05T00:00:00.000Z';
const NOW = new Date('2026-11-05T01:00:00.000Z');
const MAX_AGE_SECONDS = 24 * 60 * 60;

test.describe.configure({ mode: 'serial' });

let ready = false;
let fixture;

function buildVerificationRow({ keyConfig, proof, attestation }) {
  return {
    id: PROOF_ID,
    evaluation_id: EVALUATION_ID,
    learner_id: LEARNER_ID,
    credential_id_hash: CREDENTIAL_HASH,
    evidence_hash: EVIDENCE_HASH,
    threshold: 80,
    circuit_version: keyConfig.circuitVersion,
    vkey_hash: keyConfig.vkeySha256,
    commitment: attestation.commitment,
    public_signals: proof.publicSignals,
    proof: proof.proof,
    attestation,
    issuer_key_id: attestation.issuer,
    issued_at: attestation.issuedAt,
    status: 'active',
    proof_mode: 'demo',
    credential_is_test: true,
    created_at: attestation.issuedAt,
    updated_at: attestation.issuedAt,
  };
}

function gateway(overrides = {}) {
  return {
    verifyCredential: async () => ({
      exists: true,
      valid: true,
      revoked: false,
      evidenceHash: EVIDENCE_HASH,
      credentialId: CREDENTIAL_HASH,
      ...overrides,
    }),
  };
}

function serviceFor({ row, keyConfig, gatewayClient = gateway() }) {
  const store = {
    findById: async id => (id === PROOF_ID ? row : null),
  };
  return createZkVerificationService({
    store,
    keyConfig,
    gateway: gatewayClient,
    now: () => NOW,
    maxAgeSeconds: MAX_AGE_SECONDS,
  });
}

test.beforeAll(async () => {
  ready = await artifactsReady();
  if (!ready) return;

  const paths = artifactPaths();
  const [vkeyBuffer, manifestBuffer] = await Promise.all([
    readFile(paths.vkey),
    readFile(paths.manifest),
  ]);
  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  const vkeySha256 = createHash('sha256').update(vkeyBuffer).digest('hex');
  const issuer = generateIssuerKeyPair();

  const attestationBundle = await createEvaluationAttestation({
    evaluationId: EVALUATION_ID,
    learnerId: LEARNER_ID,
    evidenceHash: EVIDENCE_HASH,
    credentialId: CREDENTIAL_HASH,
    score: 88,
    issuerPrivateKey: issuer.privateKey,
    issuerKeyId: 'test-issuer',
    issuedAt: new Date(ISSUED_AT),
  });

  const proof = await generateLearningProof({
    attestation: attestationBundle.attestation,
    witness: attestationBundle.witness,
    threshold: 80,
  });

  const keyConfig = await loadKeyConfig({
    env: {
      NODE_ENV: 'test',
      ZK_CIRCUIT_VERSION: manifest.circuit.version,
      ZK_TRUSTED_SETUP_MODE: 'development',
      ZK_ALLOW_DEVELOPMENT_SETUP: '1',
      ZK_VKEY_PATH: paths.vkey,
      ZK_VKEY_SHA256: vkeySha256,
      ZK_TRUSTED_SETUP_MANIFEST: paths.manifest,
      ZK_TRUSTED_ISSUERS_JSON: JSON.stringify([{
        keyId: 'test-issuer',
        publicKeyPem: issuer.publicKeyPem,
        status: 'active',
        environment: 'demo',
      }]),
    },
    now: new Date(ISSUED_AT),
  });

  const row = buildVerificationRow({
    keyConfig,
    proof,
    attestation: attestationBundle.attestation,
  });

  // Synthetic fixture only. No score/witness/nonce is placed on the row.
  fixture = {
    row,
    keyConfig,
    proof,
    attestation: attestationBundle.attestation,
  };
});

test.beforeEach(() => {
  test.skip(!ready, 'ZK development artifacts are not built; run `cd zk && npm run build` for the real E2E test.');
});

test('real Groth16 + Ed25519 verification passes for a synthetic proof', async () => {
  const service = serviceFor(fixture);
  const result = await service.verify(PROOF_ID);
  expect(result.valid).toBe(true, result.reason);
  expect(result.reason).toBe('OK');
  expect(result.classification).toBe('DEMO');
  expect(result.credentialStatus).toBe('VALID');
  expect(result.proof.proofId).toBe(PROOF_ID);
  expect(result.proof.threshold).toBe(80);

  const serialized = JSON.stringify(result);
  for (const forbidden of ['"score"', '"nonce"', '"witness"', '"learner_id"', '"evaluation_id"']) {
    expect(serialized).not.toContain(forbidden);
  }
});

test('real verifier rejects a tampered Groth16 proof', async () => {
  const tampered = structuredClone(fixture.row);
  tampered.proof.pi_a[0] = (BigInt(tampered.proof.pi_a[0]) + 1n).toString();

  const result = await serviceFor({ ...fixture, row: tampered }).verify(PROOF_ID);
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('INVALID_PROOF');
});

test('real verifier rejects a tampered Ed25519 attestation', async () => {
  const tampered = structuredClone(fixture.row);
  tampered.attestation.learnerBinding = '999';

  const result = await serviceFor({ ...fixture, row: tampered }).verify(PROOF_ID);
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('INVALID_ATTESTATION_SIGNATURE');
});

test('real verifier rejects a wrong verification key', async () => {
  const wrongKey = structuredClone(fixture.keyConfig.verificationKey);
  wrongKey.IC[1] = '1';
  const wrongHash = createHash('sha256').update(JSON.stringify(wrongKey)).digest('hex');
  const wrongKeyConfig = {
    ...fixture.keyConfig,
    verificationKey: wrongKey,
    vkeySha256: wrongHash,
  };
  const wrongRow = { ...fixture.row, vkey_hash: wrongHash };

  const result = await serviceFor({ ...fixture, row: wrongRow, keyConfig: wrongKeyConfig }).verify(PROOF_ID);
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('INVALID_PROOF');
});

test('real verifier rejects changed evidence and credential bindings', async () => {
  const otherEvidence = { ...fixture.row, evidence_hash: OTHER_EVIDENCE_HASH };
  expect(await serviceFor({ ...fixture, row: otherEvidence }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'EVIDENCE_BINDING_MISMATCH' });

  const otherCredential = { ...fixture.row, credential_id_hash: OTHER_CREDENTIAL_HASH };
  expect(await serviceFor({ ...fixture, row: otherCredential }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'CREDENTIAL_BINDING_MISMATCH' });
});

test('real verifier fails closed for revoked credential and RPC outage', async () => {
  const revoked = await serviceFor({
    ...fixture,
    gatewayClient: gateway({ revoked: true, valid: false }),
  }).verify(PROOF_ID);
  expect(revoked.valid).toBe(false);
  expect(revoked.reason).toBe('CREDENTIAL_REVOKED');

  const rpcDown = await serviceFor({
    ...fixture,
    gatewayClient: { verifyCredential: async () => { throw new Error('RPC unavailable'); } },
  }).verify(PROOF_ID);
  expect(rpcDown.valid).toBe(false);
  expect(rpcDown.reason).toBe('CREDENTIAL_STATUS_UNAVAILABLE');
  expect(rpcDown.retryable).toBe(true);
});

test('synthetic fixture attestation binds the expected public values', () => {
  const expected = {
    evaluationIdHash: toFieldString(evaluationIdBinding(EVALUATION_ID)),
    learnerBinding: toFieldString(learnerBinding(LEARNER_ID)),
    evidenceHash: toFieldString(evidenceBinding(EVIDENCE_HASH)),
    credentialIdHash: toFieldString(credentialIdBinding(CREDENTIAL_HASH)),
  };
  expect(fixture.attestation).toMatchObject(expected);
  expect(fixture.attestation).not.toHaveProperty('score');
  expect(fixture.row).not.toHaveProperty('score');
  expect(fixture.row).not.toHaveProperty('nonce');
  expect(fixture.row).not.toHaveProperty('witness');
});
