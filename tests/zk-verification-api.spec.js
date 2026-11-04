import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createLearningRecordsHandler } from '../api/learning-records/index.js';
import { createZkRouter, resetZkRateLimit } from '../api/zk/_router.js';
import { createZkVerificationService } from '../api/zk/_verify.js';
import { classifyProofSnapshot } from '../api/zk/_policy.js';
import {
  credentialIdBinding,
  evaluationIdBinding,
  evidenceBinding,
  learnerBinding,
  toFieldString,
} from '../zk/lib/field.mjs';
import { resolveZkRoute } from '../tests/static-server.mjs';

const LEARNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_LEARNER_ID = '22222222-2222-4222-8222-222222222222';
const EVALUATION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_EVALUATION_ID = '55555555-5555-4555-8555-555555555555';
const PROOF_ID = '44444444-4444-4444-8444-444444444444';
const CREDENTIAL_HASH = `0x${'aa'.repeat(32)}`;
const OTHER_CREDENTIAL_HASH = `0x${'dd'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'bb'.repeat(32)}`;
const OTHER_EVIDENCE_HASH = `0x${'ee'.repeat(32)}`;
const VKEY_HASH = 'cc'.repeat(32);
const COMMITMENT = '123456789';
const ISSUED_AT = '2026-11-05T00:00:00.000Z';
const NOW = new Date('2026-11-05T01:00:00.000Z');

function expectedBindings(overrides = {}) {
  return {
    evaluationIdHash: toFieldString(evaluationIdBinding(overrides.evaluationId || EVALUATION_ID)),
    learnerBinding: toFieldString(learnerBinding(overrides.learnerId || LEARNER_ID)),
    evidenceHash: toFieldString(evidenceBinding(overrides.evidenceHash || EVIDENCE_HASH)),
    credentialIdHash: toFieldString(credentialIdBinding(overrides.credentialHash || CREDENTIAL_HASH)),
  };
}

function fixtureRow(overrides = {}) {
  const bindings = expectedBindings(overrides);
  const row = {
    id: PROOF_ID,
    evaluation_id: EVALUATION_ID,
    learner_id: LEARNER_ID,
    credential_id_hash: CREDENTIAL_HASH,
    evidence_hash: EVIDENCE_HASH,
    threshold: 80,
    circuit_version: '1.0.0',
    vkey_hash: VKEY_HASH,
    commitment: COMMITMENT,
    public_signals: ['80', COMMITMENT, bindings.evaluationIdHash, bindings.learnerBinding, bindings.evidenceHash, bindings.credentialIdHash],
    proof: {
      pi_a: ['1', '2'],
      pi_b: [['1', '2'], ['3', '4']],
      pi_c: ['5', '6'],
      protocol: 'groth16',
      curve: 'bn128',
    },
    attestation: {
      schemaVersion: 'paradox-zk-evaluation-attestation-v1',
      circuit: 'score_threshold',
      circuitVersion: '1.0.0',
      issuer: 'kid-1',
      commitment: COMMITMENT,
      evaluationIdHash: bindings.evaluationIdHash,
      learnerBinding: bindings.learnerBinding,
      evidenceHash: bindings.evidenceHash,
      credentialIdHash: bindings.credentialIdHash,
      issuedAt: ISSUED_AT,
      signature: 'test-signature',
    },
    issuer_key_id: 'kid-1',
    issued_at: ISSUED_AT,
    status: 'active',
    proof_mode: 'official',
    credential_is_test: false,
    created_at: ISSUED_AT,
    updated_at: ISSUED_AT,
    score: 99,
    nonce: 'never-public',
    witness: ['never-public'],
    ...overrides,
  };
  // Keep public signals consistent when an override changes the bound values.
  if (overrides.public_signals === undefined) {
    row.public_signals = ['80', row.commitment, bindings.evaluationIdHash, bindings.learnerBinding, bindings.evidenceHash, bindings.credentialIdHash];
  }
  return row;
}

function keyConfig(overrides = {}) {
  const key = {
    keyId: 'kid-1',
    publicKey: { type: 'public', fake: true },
    fingerprint: 'ff'.repeat(32),
    environment: 'production',
    usable: true,
  };
  return {
    verificationKey: { protocol: 'groth16', curve: 'bn128', nPublic: 6, IC: [] },
    vkeySha256: VKEY_HASH,
    circuitVersion: '1.0.0',
    trustedIssuers: new Map([['kid-1', key]]),
    activeTrustedIssuers: new Map([['kid-1', key]]),
    activeIssuerKeyIds: ['kid-1'],
    setupMode: 'production',
    productionVerified: true,
    ...overrides,
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

function makeService({
  row = fixtureRow(),
  keys = keyConfig(),
  gatewayClient = gateway(),
  verifyGroth16 = async () => true,
  verifyAttestation = () => true,
  now = () => NOW,
  maxAgeSeconds = 24 * 60 * 60,
} = {}) {
  const store = {
    findById: async id => (String(id).toLowerCase() === String(row.id).toLowerCase() ? row : null),
  };
  return createZkVerificationService({
    store,
    keyConfig: keys,
    gateway: gatewayClient,
    verifyGroth16,
    verifyAttestation,
    now,
    maxAgeSeconds,
  });
}

function makeRes() {
  const headers = {};
  return {
    statusCode: 200,
    payload: null,
    headers,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function makeReq({ method = 'GET', body, headers = {} } = {}) {
  const rawBody = body === undefined ? undefined : JSON.stringify(body);
  return {
    method,
    headers: {
      'x-forwarded-for': '203.0.113.10',
      ...(rawBody ? { 'content-length': String(Buffer.byteLength(rawBody, 'utf8')) } : {}),
      ...headers,
    },
    body: rawBody,
    socket: { remoteAddress: '203.0.113.10' },
  };
}

// ---------- Verification service ----------

test('server-side classification never promotes PXP-TEST credentials', () => {
  const production = keyConfig({
    manifest: { trustedSetup: { productionReady: true, mode: 'multi-party-ceremony' } },
  });

  expect(classifyProofSnapshot({
    credential: {
      credential_code: 'PXP-TEST-CPP-004',
      is_test: false,
      source: 'ai-evaluation',
    },
    keyConfig: production,
    issuerKeyId: 'kid-1',
  })).toEqual({ proofMode: 'demo', credentialIsTest: true });

  expect(classifyProofSnapshot({
    credential: {
      credential_code: 'PXP-2026-REAL-0001',
      is_test: false,
      source: 'ai-evaluation',
    },
    keyConfig: production,
    issuerKeyId: 'kid-1',
  })).toEqual({ proofMode: 'official', credentialIsTest: false });

  expect(classifyProofSnapshot({
    credential: {
      credential_code: 'PXP-2026-REAL-0001',
      is_test: false,
      source: 'ai-evaluation',
    },
    keyConfig: keyConfig({ setupMode: 'development' }),
    issuerKeyId: 'kid-1',
  })).toEqual({ proofMode: 'demo', credentialIsTest: false });

  expect(classifyProofSnapshot({
    credential: {
      credential_code: 'PXP-2026-REAL-0001',
      is_test: false,
      source: 'ai-evaluation',
    },
    keyConfig: production,
    issuerKeyId: 'missing-issuer',
  })).toEqual({ proofMode: 'demo', credentialIsTest: false });

  const demoKey = keyConfig({
    manifest: { trustedSetup: { productionReady: true, mode: 'multi-party-ceremony' } },
    activeTrustedIssuers: new Map([['kid-1', {
      keyId: 'kid-1',
      environment: 'demo',
      usable: true,
      publicKey: {},
    }]]),
  });
  expect(classifyProofSnapshot({
    credential: {
      credential_code: 'PXP-2026-REAL-0001',
      is_test: false,
      source: 'ai-evaluation',
    },
    keyConfig: demoKey,
    issuerKeyId: 'kid-1',
  })).toEqual({ proofMode: 'demo', credentialIsTest: false });
});

test('verification returns public proof only and never leaks score/nonce/witness', async () => {
  const service = makeService();
  const result = await service.verify(PROOF_ID);
  expect(result.valid).toBe(true);
  expect(result.reason).toBe('OK');
  expect(result.credentialStatus).toBe('VALID');
  expect(result.classification).toBe('UNCLASSIFIED');
  expect(result.proof.proofId).toBe(PROOF_ID);
  expect(result.proof.threshold).toBe(80);

  const serialized = JSON.stringify(result);
  for (const forbidden of ['"score"', '"nonce"', '"witness"', '"learner_id"', '"evaluation_id"', '"assessmentScore"']) {
    expect(serialized).not.toContain(forbidden);
  }
});

test('verification distinguishes DEMO, UNCLASSIFIED and OFFICIAL', async () => {
  const officialKey = keyConfig({
    manifest: { trustedSetup: { productionReady: true, mode: 'multi-party-ceremony' } },
  });
  expect(await makeService({ keys: officialKey }).verify(PROOF_ID)).toMatchObject({
    valid: true,
    classification: 'OFFICIAL',
    proof: { classification: 'OFFICIAL' },
  });

  expect(await makeService({ keys: keyConfig({ setupMode: 'development' }) }).verify(PROOF_ID))
    .toMatchObject({ valid: true, classification: 'UNCLASSIFIED' });

  const demoRow = fixtureRow({ proof_mode: 'demo', credential_is_test: true });
  expect(await makeService({ row: demoRow }).verify(PROOF_ID))
    .toMatchObject({ valid: true, classification: 'DEMO' });
});

test('verification fails closed for invalid Groth16 proof', async () => {
  const service = makeService({ verifyGroth16: async () => false });
  const result = await service.verify(PROOF_ID);
  expect(result).toMatchObject({ valid: false, reason: 'INVALID_PROOF' });
});

test('verification fails closed for invalid or mismatched attestation', async () => {
  const badSignature = makeService({ verifyAttestation: () => false });
  expect(await badSignature.verify(PROOF_ID)).toMatchObject({
    valid: false,
    reason: 'INVALID_ATTESTATION_SIGNATURE',
  });

  const row = fixtureRow();
  row.attestation = { ...row.attestation, learnerBinding: '999' };
  const mismatch = makeService({ row });
  expect(await mismatch.verify(PROOF_ID)).toMatchObject({
    valid: false,
    reason: 'ATTESTATION_MISMATCH',
  });
});

test('verification enforces threshold 80 and pinned circuit/vkey', async () => {
  expect(await makeService({ row: fixtureRow({ threshold: 90 }) }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'THRESHOLD_MISMATCH' });

  const signals = fixtureRow().public_signals;
  signals[0] = '90';
  expect(await makeService({ row: fixtureRow({ public_signals: signals }) }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'THRESHOLD_MISMATCH' });

  expect(await makeService({ row: fixtureRow({ vkey_hash: '00'.repeat(32) }) }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'VKEY_HASH_MISMATCH' });

  expect(await makeService({ row: fixtureRow({ circuit_version: '2.0.0' }) }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'CIRCUIT_VERSION_MISMATCH' });
});

test('verification rejects untrusted issuer and binding changes', async () => {
  const untrusted = makeService({ keys: keyConfig({ activeTrustedIssuers: new Map() }) });
  expect(await untrusted.verify(PROOF_ID)).toMatchObject({ valid: false, reason: 'UNTRUSTED_ISSUER' });

  expect(await makeService({ row: fixtureRow({ evaluation_id: OTHER_EVALUATION_ID }) }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'EVALUATION_BINDING_MISMATCH' });
  expect(await makeService({ row: fixtureRow({ learner_id: OTHER_LEARNER_ID }) }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'LEARNER_BINDING_MISMATCH' });
  expect(await makeService({ row: fixtureRow({ evidence_hash: OTHER_EVIDENCE_HASH }) }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'EVIDENCE_BINDING_MISMATCH' });
  expect(await makeService({ row: fixtureRow({ credential_id_hash: OTHER_CREDENTIAL_HASH }) }).verify(PROOF_ID))
    .toMatchObject({ valid: false, reason: 'CREDENTIAL_BINDING_MISMATCH' });
});

test('verification rejects revoked or superseded proof rows before crypto', async () => {
  const revoked = await makeService({
    row: fixtureRow({ status: 'revoked', revoked_at: ISSUED_AT }),
  }).verify(PROOF_ID);
  expect(revoked).toMatchObject({ valid: false, reason: 'ZK_PROOF_REVOKED' });

  const superseded = await makeService({
    row: fixtureRow({ status: 'superseded' }),
  }).verify(PROOF_ID);
  expect(superseded).toMatchObject({ valid: false, reason: 'ZK_PROOF_SUPERSEDED' });
});

test('verification fails closed on revoked credential and RPC failure', async () => {
  const revoked = makeService({
    gatewayClient: gateway({ revoked: true, valid: false }),
  });
  expect(await revoked.verify(PROOF_ID)).toMatchObject({
    valid: false,
    reason: 'CREDENTIAL_REVOKED',
  });

  const rpcDown = makeService({
    gatewayClient: { verifyCredential: async () => { throw new Error('rpc down'); } },
  });
  expect(await rpcDown.verify(PROOF_ID)).toMatchObject({
    valid: false,
    reason: 'CREDENTIAL_STATUS_UNAVAILABLE',
    retryable: true,
  });
});

test('verification rejects stale attestation and malformed public signals', async () => {
  const stale = makeService({
    now: () => new Date('2026-11-07T00:00:00.000Z'),
    maxAgeSeconds: 24 * 60 * 60,
  });
  expect(await stale.verify(PROOF_ID)).toMatchObject({
    valid: false,
    reason: 'ATTESTATION_EXPIRED',
  });

  const malformed = makeService({
    row: fixtureRow({ public_signals: ['80', COMMITMENT, '1', '2', '3'] }),
  });
  expect(await malformed.verify(PROOF_ID)).toMatchObject({
    valid: false,
    reason: 'INVALID_PUBLIC_SIGNALS',
  });
});

test('verification is replayable as a bearer proof; cross-context replay is blocked', async () => {
  const service = makeService();
  expect((await service.verify(PROOF_ID)).valid).toBe(true);
  expect((await service.verify(PROOF_ID)).valid).toBe(true);

  const otherLearner = makeService({ row: fixtureRow({ learner_id: OTHER_LEARNER_ID }) });
  expect(await otherLearner.verify(PROOF_ID)).toMatchObject({
    valid: false,
    reason: 'LEARNER_BINDING_MISMATCH',
  });
});

test('verification returns not found without exposing internals', async () => {
  const service = makeService();
  await expect(service.verify(randomUUID())).rejects.toMatchObject({
    code: 'ZK_PROOF_NOT_FOUND',
    status: 404,
  });
});

// ---------- Router ----------

function makeRouter(overrides = {}) {
  resetZkRateLimit();
  const row = fixtureRow();
  const store = {
    findById: async id => (id === PROOF_ID ? row : null),
  };
  return createZkRouter({
    storeFactory: () => store,
    keyLoader: async () => keyConfig(),
    gatewayFactory: async () => gateway(),
    verificationFactory: () => ({ verify: async () => ({ valid: true, reason: 'OK', proof: { proofId: PROOF_ID } }) }),
    now: () => NOW,
    ...overrides,
  });
}

test('ZK router enforces method allowlists and rejects unknown actions', async () => {
  const router = makeRouter();

  const status = makeRes();
  await router({ action: 'status', req: makeReq({ method: 'GET' }), res: status });
  expect(status.statusCode).toBe(200);
  expect(status.payload).toMatchObject({ ready: true, allowedThresholds: [80] });

  const statusPost = makeRes();
  await router({ action: 'status', req: makeReq({ method: 'POST', body: {} }), res: statusPost });
  expect(statusPost.statusCode).toBe(405);

  for (const action of ['createProof', 'deleteProof', 'unknown']) {
    const res = makeRes();
    await router({ action, req: makeReq({ method: 'POST', body: {} }), res });
    expect(res.statusCode).toBe(404);
    expect(res.payload.code).toBe('ZK_ACTION_NOT_FOUND');
  }
});

test('ZK router serves public proof and rejects mutation methods', async () => {
  const router = makeRouter();

  const proof = makeRes();
  await router({ action: 'getProof', proofId: PROOF_ID, req: makeReq({ method: 'GET' }), res: proof });
  expect(proof.statusCode).toBe(200);
  expect(proof.payload.proof.proofId).toBe(PROOF_ID);
  expect(JSON.stringify(proof.payload)).not.toContain('"score"');

  const missing = makeRes();
  await router({ action: 'getProof', proofId: randomUUID(), req: makeReq({ method: 'GET' }), res: missing });
  expect(missing.statusCode).toBe(404);

  const mutate = makeRes();
  await router({ action: 'getProof', proofId: PROOF_ID, req: makeReq({ method: 'POST', body: {} }), res: mutate });
  expect(mutate.statusCode).toBe(405);
});

test('ZK verify accepts only proofId and enforces body/rate limits', async () => {
  const router = makeRouter();

  const ok = makeRes();
  await router({
    action: 'verifyProof',
    req: makeReq({ method: 'POST', body: { proofId: PROOF_ID } }),
    res: ok,
  });
  expect(ok.statusCode).toBe(200);
  expect(ok.payload.valid).toBe(true);

  const scoreInjection = makeRes();
  await router({
    action: 'verifyProof',
    req: makeReq({ method: 'POST', body: { proofId: PROOF_ID, score: 100 } }),
    res: scoreInjection,
  });
  expect(scoreInjection.statusCode).toBe(400);
  expect(scoreInjection.payload.code).toBe('ZK_INVALID_BODY');

  const tooLarge = makeRes();
  await router({
    action: 'verifyProof',
    req: makeReq({
      method: 'POST',
      body: { proofId: PROOF_ID },
      headers: { 'content-length': '99999' },
    }),
    res: tooLarge,
  });
  expect(tooLarge.statusCode).toBe(413);

  const wrongMethod = makeRes();
  await router({ action: 'verifyProof', req: makeReq({ method: 'GET' }), res: wrongMethod });
  expect(wrongMethod.statusCode).toBe(405);

  resetZkRateLimit();
  const limitedRouter = makeRouter();
  const sourceIp = { 'x-forwarded-for': '198.51.100.77' };
  let last;
  for (let index = 0; index < 11; index += 1) {
    last = makeRes();
    await limitedRouter({
      action: 'verifyProof',
      req: makeReq({ method: 'POST', body: { proofId: PROOF_ID }, headers: sourceIp }),
      res: last,
    });
  }
  expect(last.statusCode).toBe(429);
  expect(last.headers['Retry-After']).toBeDefined();
});

// ---------- Learning-records host / query routing ----------

test('zkAction routes before auth and cannot create proofs', async () => {
  const calls = [];
  const fakeRouter = async ({ action, proofId, res }) => {
    calls.push({ action, proofId });
    return res.status(200).json({ routed: action });
  };
  let authCalls = 0;
  const handler = createLearningRecordsHandler({
    zkRouter: fakeRouter,
    sessionResolver: async () => { authCalls += 1; throw new Error('auth must not run'); },
    storeFactory: () => { throw new Error('store must not run'); },
    serviceFactory: () => { throw new Error('service must not run'); },
  });

  const response = makeRes();
  await handler({ method: 'GET', query: { zkAction: 'status' }, headers: {} }, response);
  expect(response.statusCode).toBe(200);
  expect(calls).toEqual([{ action: 'status', proofId: undefined }]);
  expect(authCalls).toBe(0);

  const unknown = makeRes();
  const realRouter = makeRouter();
  await realRouter({ action: 'createProof', req: makeReq({ method: 'POST', body: {} }), res: unknown });
  expect(unknown.statusCode).toBe(404);
});

test('Vercel rewrites map only read-only ZK routes and add no function', async () => {
  const config = JSON.parse(await readFile(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
  const routes = Object.fromEntries((config.rewrites || []).map(rule => [rule.source, rule.destination]));
  expect(routes['/api/zk/status']).toBe('/api/learning-records?zkAction=status');
  expect(routes['/api/zk/proofs/:proofId']).toBe('/api/learning-records?zkAction=getProof&proofId=:proofId');
  expect(routes['/api/zk/verify']).toBe('/api/learning-records?zkAction=verifyProof');
  expect(routes['/api/zk/proofs']).toBeUndefined();
});

test('local static server resolves only the three read-only ZK routes', () => {
  expect(resolveZkRoute('/api/zk/status')).toEqual({ zkAction: 'status' });
  expect(resolveZkRoute('/api/zk/verify')).toEqual({ zkAction: 'verifyProof' });
  expect(resolveZkRoute(`/api/zk/proofs/${PROOF_ID}`)).toEqual({ zkAction: 'getProof', proofId: PROOF_ID });
  expect(resolveZkRoute('/api/zk/proofs')).toBeNull();
});

test('local HTTP routing exposes only read-only ZK paths and no create route', async ({ request }) => {
  const status = await request.get('/api/zk/status');
  expect([200, 503]).toContain(status.status());

  const create = await request.post('/api/zk/proofs', { data: {} });
  expect(create.status()).toBe(404);

  const statusPost = await request.post('/api/learning-records?zkAction=status', { data: {} });
  expect(statusPost.status()).toBe(405);

  const queryCreate = await request.post('/api/learning-records?zkAction=createProof', { data: {} });
  expect(queryCreate.status()).toBe(404);
});
