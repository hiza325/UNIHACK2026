import { expect, test } from '@playwright/test';

import { createZkRouter, resetZkRateLimit } from '../api/zk/_router.js';
import { createZkProofGenerationService } from '../api/zk/_generate.js';
import { classifyProofSnapshot } from '../api/zk/_policy.js';

const PROOF_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const EXISTING_PROOF_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVALUATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LEARNER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_LEARNER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CREDENTIAL_HASH = `0x${'aa'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'bb'.repeat(32)}`;
const VKEY_HASH = 'cc'.repeat(32);
const COMMITMENT = '123456789';
const ISSUED_AT = '2026-11-05T00:00:00.000Z';
const NOW = new Date('2026-11-05T01:00:00.000Z');

function keyConfig(overrides = {}) {
  return {
    verificationKey: { protocol: 'groth16', curve: 'bn128', nPublic: 6, IC: [] },
    vkeySha256: VKEY_HASH,
    circuitVersion: '1.0.0',
    trustedIssuers: new Map(),
    activeTrustedIssuers: new Map(),
    activeIssuerKeyIds: [],
    setupMode: 'development',
    productionVerified: false,
    manifest: { trustedSetup: { productionReady: false, mode: 'local-single-contributor' } },
    ...overrides,
  };
}

function evaluation(overrides = {}) {
  return {
    id: EVALUATION_ID,
    learner_id: LEARNER_ID,
    status: 'pass',
    credential_eligible: true,
    score: 88,
    credential_id_hash: CREDENTIAL_HASH,
    credential_hash: EVIDENCE_HASH,
    ...overrides,
  };
}

function credential(overrides = {}) {
  return {
    evaluation_id: EVALUATION_ID,
    learner_id: LEARNER_ID,
    credential_id_hash: CREDENTIAL_HASH,
    evidence_hash: EVIDENCE_HASH,
    blockchain_status: 'confirmed',
    onchain_valid: true,
    source: 'ai-evaluation',
    is_test: false,
    credential_code: 'PXP-2026-REAL-0001',
    ...overrides,
  };
}

function onChain(overrides = {}) {
  return {
    exists: true,
    valid: true,
    revoked: false,
    evidenceHash: EVIDENCE_HASH,
    credentialId: CREDENTIAL_HASH,
    ...overrides,
  };
}

function attestationBundle() {
  return {
    attestation: {
      schemaVersion: 'paradox-zk-evaluation-attestation-v1',
      circuit: 'score_threshold',
      circuitVersion: '1.0.0',
      issuer: 'issuer-1',
      commitment: COMMITMENT,
      evaluationIdHash: '1',
      learnerBinding: '2',
      evidenceHash: '3',
      credentialIdHash: '4',
      issuedAt: ISSUED_AT,
      signature: 'signature',
    },
    witness: {
      score: 88,
      nonce: '5',
      evaluationIdHash: '1',
      learnerBinding: '2',
      evidenceHash: '3',
      credentialIdHash: '4',
    },
  };
}

function proofFixture() {
  return {
    proof: { pi_a: ['1', '2'], pi_b: [['1', '2'], ['3', '4']], pi_c: ['5', '6'], protocol: 'groth16', curve: 'bn128' },
    publicSignals: ['80', COMMITMENT, '1', '2', '3', '4'],
  };
}

function issuerSigner(overrides = {}) {
  const bundle = attestationBundle();
  return {
    keyId: 'issuer-1',
    environment: 'demo',
    status: 'active',
    publicKey: { type: 'public', fake: true },
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...\n-----END PUBLIC KEY-----\n',
    signAttestation: async () => bundle,
    ...overrides,
  };
}

function makeStore(overrides = {}) {
  let inserted = null;
  const store = {
    findByEvaluationThreshold: async () => null,
    insertProof: async record => {
      inserted = { id: PROOF_ID, ...record };
      return inserted;
    },
    findById: async id => (id === PROOF_ID ? inserted : null),
    ...overrides,
  };
  return { store, getInserted: () => inserted };
}

function makeService({ store, signer = issuerSigner(), generateProof = async () => proofFixture(), verifyProof = async () => ({ valid: true }), dependencies = {} } = {}) {
  const baseStore = store || makeStore().store;
  return createZkProofGenerationService({
    store: baseStore,
    keyConfig: keyConfig(),
    issuerSigner: signer,
    dependencies: {
      getEvaluation: async () => evaluation(),
      getCredential: async () => credential(),
      getOnChainCredential: async () => onChain(),
      ...dependencies,
    },
    now: () => new Date(NOW),
    attestFn: async params => signer.signAttestation(params),
    generateProofFn: generateProof,
    verifyProofFn: async () => verifyProof(),
  });
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(() => resetZkRateLimit());

test('generateProof rejects unauthenticated requests', async () => {
  const router = createZkRouter({
    storeFactory: () => makeStore().store,
    keyLoader: async () => keyConfig(),
    sessionResolver: async () => { throw Object.assign(new Error('unauthorized'), { code: 'UNAUTHORIZED', status: 401 }); },
    recordStoreFactory: () => ({ findEvaluation: async () => evaluation() }),
    credentialStoreFactory: () => ({ findByEvaluationId: async () => credential() }),
  });
  const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ evaluationId: EVALUATION_ID }) };
  const res = response();
  await router({ action: 'generateProof', req, res, proofId: undefined });
  expect(res.statusCode).toBe(401);
  expect(res.body.code).toBe('ZK_UNAUTHENTICATED');
});

test('generateProof validates body and threshold', async () => {
  const router = createZkRouter({
    storeFactory: () => makeStore().store,
    keyLoader: async () => keyConfig(),
    sessionResolver: async () => ({ user: { id: LEARNER_ID } }),
    recordStoreFactory: () => ({ findEvaluation: async () => evaluation() }),
    credentialStoreFactory: () => ({ findByEvaluationId: async () => credential() }),
    gatewayFactory: async () => ({ verifyCredential: async () => onChain() }),
    issuerSignerFactory: () => issuerSigner(),
  });
  for (const body of [
    JSON.stringify({ evaluationId: EVALUATION_ID, extra: true }),
    JSON.stringify({ threshold: 80 }),
    JSON.stringify({ evaluationId: 'not-a-uuid' }),
    JSON.stringify({ evaluationId: EVALUATION_ID, threshold: 90 }),
  ]) {
    resetZkRateLimit();
    const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body };
    const res = response();
    await router({ action: 'generateProof', req, res, proofId: undefined });
    expect(res.statusCode).toBe(400);
  }
});

test('generateProof generates and persists a DEMO proof', async () => {
  resetZkRateLimit();
  const { store, getInserted } = makeStore();
  const service = makeService({ store });
  const result = await service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID });
  expect(result).toMatchObject({
    status: 'generated',
    classification: 'demo',
    credentialStatus: 'VALID',
    issuerKeyId: 'issuer-1',
  });
  expect(result.proofId).toBe(PROOF_ID);
  const inserted = getInserted();
  expect(inserted).toBeTruthy();
  expect(inserted.proof_mode).toBe('demo');
  expect(inserted.credential_is_test).toBe(false);
  const serialized = JSON.stringify(result);
  for (const forbidden of ['"score"', '"nonce"', '"witness"', '"learner_id"', '"evaluation_id"']) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(inserted).not.toHaveProperty('score');
  expect(inserted).not.toHaveProperty('nonce');
  expect(inserted).not.toHaveProperty('witness');
});

test('generateProof returns an existing proof instead of duplicating', async () => {
  resetZkRateLimit();
  const existing = { id: EXISTING_PROOF_ID, issuer_key_id: 'issuer-1', proof_mode: 'demo', credential_is_test: false };
  const store = {
    findByEvaluationThreshold: async () => existing,
    insertProof: async () => { throw new Error('insert must not be called'); },
    findById: async () => existing,
  };
  const service = makeService({ store });
  const result = await service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID });
  expect(result).toMatchObject({
    proofId: EXISTING_PROOF_ID,
    status: 'existing',
    classification: 'demo',
  });
});

test('generateProof handles concurrent insert conflicts', async () => {
  resetZkRateLimit();
  const existing = { id: EXISTING_PROOF_ID, issuer_key_id: 'issuer-1', proof_mode: 'demo', credential_is_test: false };
  let inserted = false;
  const store = {
    findByEvaluationThreshold: async () => (inserted ? existing : null),
    insertProof: async () => {
      inserted = true;
      const error = new Error('duplicate');
      error.code = 'ZK_PROOF_CONFLICT';
      error.status = 409;
      throw error;
    },
    findById: async () => existing,
  };
  const service = makeService({ store });
  const result = await service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID });
  expect(result).toMatchObject({ proofId: EXISTING_PROOF_ID, status: 'existing' });
});

test('generateProof rejects ownership, eligibility and binding failures', async () => {
  resetZkRateLimit();
  let service = makeService({ dependencies: { getEvaluation: async () => evaluation({ learner_id: OTHER_LEARNER_ID }) } });
  await expect(service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID }))
    .rejects.toMatchObject({ code: 'ZK_EVALUATION_NOT_OWNED', status: 403 });

  service = makeService({ dependencies: { getEvaluation: async () => evaluation({ status: 'needs_improvement' }) } });
  await expect(service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID }))
    .rejects.toMatchObject({ code: 'ZK_EVALUATION_NOT_ELIGIBLE', status: 409 });

  service = makeService({ dependencies: { getCredential: async () => credential({ evidence_hash: `0x${'cc'.repeat(32)}` }) } });
  await expect(service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID }))
    .rejects.toMatchObject({ code: 'ZK_CREDENTIAL_BINDING_MISMATCH', status: 409 });
});

test('generateProof rejects invalid or unavailable on-chain credentials', async () => {
  resetZkRateLimit();
  let service = makeService({ dependencies: { getOnChainCredential: async () => ({ exists: false, valid: true, revoked: false, evidenceHash: EVIDENCE_HASH, credentialId: CREDENTIAL_HASH }) } });
  await expect(service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID }))
    .rejects.toMatchObject({ code: 'ZK_CREDENTIAL_NOT_ONCHAIN', status: 409 });

  service = makeService({ dependencies: { getOnChainCredential: async () => ({ exists: true, valid: true, revoked: true, evidenceHash: EVIDENCE_HASH, credentialId: CREDENTIAL_HASH }) } });
  await expect(service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID }))
    .rejects.toMatchObject({ code: 'ZK_CREDENTIAL_REVOKED', status: 409 });

  service = makeService({ dependencies: { getOnChainCredential: async () => { throw new Error('rpc down'); } } });
  await expect(service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID }))
    .rejects.toMatchObject({ code: 'ZK_CREDENTIAL_STATUS_UNAVAILABLE', status: 503 });
});

test('generateProof fails closed without issuer signing or valid generated proof', async () => {
  resetZkRateLimit();
  let service = makeService({ signer: null });
  await expect(service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID }))
    .rejects.toMatchObject({ code: 'ZK_ISSUER_SIGNING_UNAVAILABLE', status: 503 });

  service = makeService({ verifyProof: async () => ({ valid: false, reason: 'INVALID_PROOF' }) });
  await expect(service.generate({ learnerId: LEARNER_ID, evaluationId: EVALUATION_ID }))
    .rejects.toMatchObject({ code: 'ZK_GENERATED_PROOF_INVALID', status: 500 });
});

test('generateProof is rate limited', async () => {
  resetZkRateLimit();
  const router = createZkRouter({
    storeFactory: () => makeStore().store,
    keyLoader: async () => keyConfig(),
    sessionResolver: async () => ({ user: { id: LEARNER_ID } }),
    recordStoreFactory: () => ({ findEvaluation: async () => evaluation() }),
    credentialStoreFactory: () => ({ findByEvaluationId: async () => credential() }),
    generationFactory: () => makeService(),
    gatewayFactory: async () => ({ verifyCredential: async () => onChain() }),
    issuerSignerFactory: () => issuerSigner(),
  });
  for (let i = 0; i < 5; i += 1) {
    const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ evaluationId: EVALUATION_ID }) };
    const res = response();
    await router({ action: 'generateProof', req, res, proofId: undefined });
    expect(res.statusCode).toBe(200);
  }
  const req = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ evaluationId: EVALUATION_ID }) };
  const res = response();
  await router({ action: 'generateProof', req, res, proofId: undefined });
  expect(res.statusCode).toBe(429);
  expect(res.body.code).toBe('ZK_RATE_LIMITED');
});

test('client cannot override classification or proof mode through generateProof', async () => {
  resetZkRateLimit();
  let generationCalled = false;
  const router = createZkRouter({
    storeFactory: () => makeStore().store,
    keyLoader: async () => keyConfig(),
    sessionResolver: async () => ({ user: { id: LEARNER_ID } }),
    recordStoreFactory: () => ({ findEvaluation: async () => evaluation() }),
    credentialStoreFactory: () => ({ findByEvaluationId: async () => credential() }),
    generationFactory: () => {
      generationCalled = true;
      return makeService();
    },
  });
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ evaluationId: EVALUATION_ID, classification: 'official', proofMode: 'official' }),
  };
  const res = response();
  await router({ action: 'generateProof', req, res, proofId: undefined });
  expect(res.statusCode).toBe(400);
  expect(res.body.code).toBe('ZK_INVALID_BODY');
  expect(generationCalled).toBe(false);
});
