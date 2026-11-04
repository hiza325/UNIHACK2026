import { expect, test } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { loadDemoEvaluatorSigner } from '../api/zk/_signing.js';
import { verifyAttestationSignature } from '../zk/lib/attestation.mjs';

const EVALUATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CREDENTIAL_HASH = `0x${'aa'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'bb'.repeat(32)}`;

function privateKeyPem() {
  return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function env(overrides = {}) {
  return {
    ZK_EVALUATOR_PRIVATE_KEY: privateKeyPem(),
    ZK_DEMO_ISSUER_KEY_ID: 'demo-issuer',
    NODE_ENV: 'test',
    ZK_ALLOW_DEVELOPMENT_SETUP: '1',
    ...overrides,
  };
}

test('demo signer signs and verifies an attestation without exposing the private key', async () => {
  const signer = await loadDemoEvaluatorSigner({ env: env() });
  expect(signer.environment).toBe('demo');
  expect(signer.status).toBe('active');
  expect(signer.publicKeyPem).toContain('PUBLIC KEY');
  expect(signer).not.toHaveProperty('privateKeyPem');

  const { attestation } = await signer.signAttestation({
    evaluationId: EVALUATION_ID,
    learnerId: LEARNER_ID,
    evidenceHash: EVIDENCE_HASH,
    credentialId: CREDENTIAL_HASH,
    score: 88,
    issuedAt: new Date('2026-11-05T00:00:00.000Z'),
  });
  expect(verifyAttestationSignature(attestation, signer.publicKey)).toBe(true);
  expect(attestation).not.toHaveProperty('score');
  expect(attestation).not.toHaveProperty('nonce');
  expect(attestation).not.toHaveProperty('witness');
});

test('demo signer is fail-closed for missing, invalid and production contexts', async () => {
  const missing = env();
  delete missing.ZK_EVALUATOR_PRIVATE_KEY;
  await expect(loadDemoEvaluatorSigner({ env: missing })).rejects.toMatchObject({
    code: 'ZK_EVALUATOR_KEY_MISSING',
    status: 503,
  });

  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await expect(loadDemoEvaluatorSigner({ env: env({ ZK_EVALUATOR_PRIVATE_KEY: rsa }) })).rejects.toMatchObject({
    code: 'ZK_EVALUATOR_KEY_INVALID',
    status: 503,
  });

  await expect(loadDemoEvaluatorSigner({ env: env({ NODE_ENV: 'production' }) })).rejects.toMatchObject({
    code: 'ZK_DEMO_SIGNING_FORBIDDEN',
    status: 503,
  });

  await expect(loadDemoEvaluatorSigner({ env: env({ VERCEL: '1', VERCEL_ENV: 'preview', ZK_PREVIEW_DEMO: '1', NODE_ENV: 'production' }) })).resolves.toBeTruthy();

  await expect(loadDemoEvaluatorSigner({ env: env({ VERCEL: '1', VERCEL_ENV: 'preview', NODE_ENV: 'production' }) })).rejects.toMatchObject({
    code: 'ZK_PREVIEW_DEMO_REQUIRED',
    status: 503,
  });

  const localNoAllow = env();
  delete localNoAllow.ZK_ALLOW_DEVELOPMENT_SETUP;
  await expect(loadDemoEvaluatorSigner({ env: localNoAllow })).rejects.toMatchObject({
    code: 'ZK_DEMO_SIGNING_NOT_ALLOWED',
    status: 503,
  });
});
