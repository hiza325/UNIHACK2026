import { expect, test } from '@playwright/test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ZK_DEFAULT_THRESHOLD,
  assertCredentialBinding,
  assertEvaluationEligible,
  assertEvaluationOwnership,
  assertOnChainCredential,
  assertProofEligibility,
  publicPolicy,
  resolveThreshold,
} from '../api/zk/_policy.js';
import {
  assertNoPrivateFields,
  toPublicProofRecord,
  toPublicProofSummary,
  toPublicSignals,
} from '../api/zk/_projection.js';
import {
  ZK_PROOF_SELECT,
  createZkProofStore,
  zkStoreConfig,
} from '../api/zk/_store.js';
import {
  loadKeyConfig,
  loadTrustedIssuers,
  resolveIssuerKey,
} from '../api/zk/_keys.js';

const LEARNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_LEARNER_ID = '22222222-2222-4222-8222-222222222222';
const EVALUATION_ID = '33333333-3333-4333-8333-333333333333';
const PROOF_ID = '44444444-4444-4444-8444-444444444444';
const CREDENTIAL_HASH = `0x${'aa'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'bb'.repeat(32)}`;
const VKEY_HASH = 'cc'.repeat(32);

function evaluation(overrides = {}) {
  return {
    id: EVALUATION_ID,
    learner_id: LEARNER_ID,
    score: 88,
    status: 'pass',
    credential_eligible: true,
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
    ...overrides,
  };
}

function onChain(overrides = {}) {
  return {
    exists: true,
    valid: true,
    revoked: false,
    evidenceHash: EVIDENCE_HASH,
    ...overrides,
  };
}

function proofRow(overrides = {}) {
  return {
    id: PROOF_ID,
    evaluation_id: EVALUATION_ID,
    learner_id: LEARNER_ID,
    credential_id_hash: CREDENTIAL_HASH,
    evidence_hash: EVIDENCE_HASH,
    threshold: 80,
    circuit_version: '1.0.0',
    vkey_hash: VKEY_HASH,
    commitment: '123456789',
    public_signals: ['80', '123456789', '111', '222', '333', '444'],
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
      commitment: '123456789',
      evaluationIdHash: '111',
      learnerBinding: '222',
      evidenceHash: '333',
      credentialIdHash: '444',
      issuedAt: '2026-11-05T00:00:00.000Z',
      signature: 'signature',
      score: 99,
    },
    issuer_key_id: 'kid-1',
    issued_at: '2026-11-05T00:00:00.000Z',
    status: 'active',
    created_at: '2026-11-05T00:00:00.000Z',
    score: 99,
    nonce: 'secret-nonce',
    witness: ['private'],
    assessmentScore: 99,
    ...overrides,
  };
}

function publicAttestation() {
  const { score: _score, ...rest } = proofRow().attestation;
  return rest;
}

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const TEST_DB_ENV = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

// ---------- Policy ----------

test('threshold defaults to 80 and phase 2.1 rejects 90', () => {
  expect(resolveThreshold()).toBe(80);
  expect(resolveThreshold('80')).toBe(80);
  expect(publicPolicy()).toMatchObject({ defaultThreshold: 80, allowedThresholds: [80] });
  for (const value of [90, 75, 0, 101, '90', 'abc']) {
    expect(() => resolveThreshold(value)).toThrow(expect.objectContaining({ code: 'ZK_INVALID_THRESHOLD' }));
  }
});

test('evaluation ownership is enforced', () => {
  expect(assertEvaluationOwnership(evaluation(), LEARNER_ID)).toEqual({
    evaluationId: EVALUATION_ID,
    learnerId: LEARNER_ID,
  });
  expect(() => assertEvaluationOwnership(evaluation(), OTHER_LEARNER_ID))
    .toThrow(expect.objectContaining({ code: 'ZK_EVALUATION_NOT_OWNED', status: 403 }));
});

test('evaluation eligibility never returns or echoes the score', () => {
  expect(assertEvaluationEligible(evaluation(), 80)).toEqual({
    threshold: 80,
    credentialIdHash: CREDENTIAL_HASH,
    evidenceHash: EVIDENCE_HASH,
  });

  for (const invalid of [
    evaluation({ status: 'needs_improvement' }),
    evaluation({ credential_eligible: false }),
    evaluation({ score: null }),
    evaluation({ score: 42 }),
  ]) {
    let thrown;
    try {
      assertEvaluationEligible(invalid, 80);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(['ZK_EVALUATION_NOT_ELIGIBLE', 'ZK_EVALUATION_INVALID', 'ZK_THRESHOLD_NOT_MET'])
      .toContain(thrown.code);
    expect(thrown.message).not.toContain('42');
    expect(thrown.message).not.toContain('88');
  }
});

test('credential binding requires DB consistency but still requires on-chain verification', () => {
  const bound = assertCredentialBinding({ evaluation: evaluation(), credential: credential() });
  expect(bound).toMatchObject({
    credentialIdHash: CREDENTIAL_HASH,
    evidenceHash: EVIDENCE_HASH,
    dbConfirmed: true,
    onChainVerificationRequired: true,
  });

  const cases = [
    [credential({ evaluation_id: OTHER_LEARNER_ID }), 'ZK_CREDENTIAL_BINDING_MISMATCH'],
    [credential({ learner_id: OTHER_LEARNER_ID }), 'ZK_CREDENTIAL_BINDING_MISMATCH'],
    [credential({ credential_id_hash: `0x${'dd'.repeat(32)}` }), 'ZK_CREDENTIAL_BINDING_MISMATCH'],
    [credential({ evidence_hash: `0x${'ee'.repeat(32)}` }), 'ZK_CREDENTIAL_BINDING_MISMATCH'],
    [credential({ blockchain_status: 'pending' }), 'ZK_CREDENTIAL_NOT_CONFIRMED'],
    [credential({ onchain_valid: false }), 'ZK_CREDENTIAL_NOT_CONFIRMED'],
  ];
  for (const [row, code] of cases) {
    expect(() => assertCredentialBinding({ evaluation: evaluation(), credential: row }))
      .toThrow(expect.objectContaining({ code }));
  }
});

test('DB blockchain_status alone cannot satisfy full eligibility', () => {
  expect(() => assertProofEligibility({
    evaluation: evaluation(),
    credential: credential(),
    learnerId: LEARNER_ID,
    threshold: 80,
  })).toThrow(expect.objectContaining({ code: 'ZK_ONCHAIN_VERIFICATION_REQUIRED' }));

  for (const bad of [
    onChain({ exists: false }),
    onChain({ valid: false }),
    onChain({ revoked: true }),
    onChain({ evidenceHash: `0x${'ff'.repeat(32)}` }),
    onChain({ credentialId: `0x${'12'.repeat(32)}` }),
  ]) {
    expect(() => assertProofEligibility({
      evaluation: evaluation(),
      credential: credential(),
      learnerId: LEARNER_ID,
      threshold: 80,
      onChain: bad,
    })).toThrow(expect.objectContaining({
      code: expect.stringMatching(/^ZK_CREDENTIAL_(NOT_ONCHAIN|REVOKED|EVIDENCE_MISMATCH|BINDING_MISMATCH)$/),
    }));
  }

  const result = assertProofEligibility({
    evaluation: evaluation(),
    credential: credential(),
    learnerId: LEARNER_ID,
    threshold: 80,
    onChain: onChain(),
  });
  expect(result).not.toHaveProperty('score');
  expect(result).toMatchObject({ threshold: 80, evaluationId: EVALUATION_ID, learnerId: LEARNER_ID });
  expect(Object.isFrozen(result)).toBe(true);
});

test('on-chain credential checks existence, validity, revocation and evidence', () => {
  expect(assertOnChainCredential({ credential: credential(), onChain: onChain() }))
    .toMatchObject({ verified: true, evidenceHash: EVIDENCE_HASH });
  expect(() => assertOnChainCredential({ credential: credential(), onChain: onChain({ revoked: true }) }))
    .toThrow(expect.objectContaining({ code: 'ZK_CREDENTIAL_REVOKED' }));
  expect(() => assertOnChainCredential({ credential: credential(), onChain: onChain({ exists: false }) }))
    .toThrow(expect.objectContaining({ code: 'ZK_CREDENTIAL_NOT_ONCHAIN' }));
  expect(() => assertOnChainCredential({ credential: credential(), onChain: onChain({ valid: false }) }))
    .toThrow(expect.objectContaining({ code: 'ZK_CREDENTIAL_NOT_ONCHAIN' }));
  expect(() => assertOnChainCredential({
    credential: credential(),
    onChain: onChain({ evidenceHash: `0x${'12'.repeat(32)}` }),
  })).toThrow(expect.objectContaining({ code: 'ZK_CREDENTIAL_EVIDENCE_MISMATCH' }));
  expect(() => assertOnChainCredential({ credential: credential(), onChain: null }))
    .toThrow(expect.objectContaining({ code: 'ZK_ONCHAIN_VERIFICATION_REQUIRED' }));
});

// ---------- Public projection ----------

test('public projection contains no score, nonce, witness or private IDs', () => {
  const projected = toPublicProofRecord(proofRow());
  expect(projected).toMatchObject({
    proofId: PROOF_ID,
    threshold: 80,
    issuerKeyId: 'kid-1',
    status: 'active',
  });
  expect(projected.publicSignals).toEqual({
    threshold: '80',
    commitment: '123456789',
    evaluationIdHash: '111',
    learnerBinding: '222',
    evidenceHash: '333',
    credentialIdHash: '444',
  });
  expect(projected.credential.idHash).toBe(CREDENTIAL_HASH);
  expect(projected.classification).toBe('DEMO');
  expect(projected.attestation).not.toHaveProperty('score');

  const serialized = JSON.stringify(projected);
  for (const forbidden of ['"score"', '"nonce"', '"witness"', '"learner_id"', '"evaluation_id"', '"assessmentScore"']) {
    expect(serialized).not.toContain(forbidden);
  }
  assertNoPrivateFields(projected);
});

test('public summary is even narrower than the full projection', () => {
  const summary = toPublicProofSummary(proofRow());
  expect(summary).toMatchObject({ proofId: PROOF_ID, threshold: 80 });
  expect(summary).not.toHaveProperty('proof');
  expect(summary).not.toHaveProperty('attestation');
  expect(summary).not.toHaveProperty('publicSignals');
  expect(JSON.stringify(summary)).not.toContain('signature');
});

test('public projection rejects malformed or inconsistent artifacts', () => {
  expect(() => toPublicProofRecord(proofRow({ public_signals: ['80', '1', '2', '3', '4'] })))
    .toThrow(/public signal count/i);
  expect(() => toPublicProofRecord(proofRow({ threshold: 90 })))
    .toThrow(/threshold does not match/i);
  expect(() => toPublicProofRecord(proofRow({ public_signals: ['80', 'x', '2', '3', '4', '5'] })))
    .toThrow(/public signal commitment/i);
  expect(() => toPublicProofRecord(proofRow({ commitment: '12x' })))
    .toThrow(/commitment/i);
  expect(() => toPublicProofRecord(proofRow({ commitment: '999' })))
    .toThrow(/commitment does not match/i);
  expect(() => toPublicProofRecord(proofRow({ status: 'deleted' })))
    .toThrow(/status/i);
  expect(() => toPublicSignals({ ...toPublicSignals(proofRow().public_signals), extra: '1' }))
    .toThrow(/unknown fields/i);
  expect(() => assertNoPrivateFields({ nested: { nonce: 'x' } }))
    .toThrow(/private field/i);
});

// ---------- Store ----------

test('store requires service-role config and never selects *', async () => {
  expect(() => zkStoreConfig({})).toThrow(expect.objectContaining({ code: 'ZK_DATABASE_NOT_CONFIGURED' }));

  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return fakeResponse(201, [proofRow()]);
  };
  const store = createZkProofStore({ env: TEST_DB_ENV, fetcher });
  const inserted = await store.insertProof({
    evaluation_id: EVALUATION_ID,
    learner_id: LEARNER_ID,
    credential_id_hash: CREDENTIAL_HASH,
    evidence_hash: EVIDENCE_HASH,
    threshold: 80,
    circuit_version: '1.0.0',
    vkey_hash: VKEY_HASH,
    commitment: '123456789',
    public_signals: ['80', '123456789', '111', '222', '333', '444'],
    proof: proofRow().proof,
    attestation: publicAttestation(),
    issuer_key_id: 'kid-1',
    issued_at: '2026-11-05T00:00:00.000Z',
  });

  expect(inserted.id).toBe(PROOF_ID);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain('/rest/v1/zk_proofs?');
  expect(calls[0].url).toContain(`select=${encodeURIComponent(ZK_PROOF_SELECT)}`);
  expect(calls[0].url).not.toContain('select=*');
  expect(calls[0].init.method).toBe('POST');
  expect(calls[0].init.headers.Authorization).toBe('Bearer test-service-role-key');
  const body = JSON.parse(calls[0].init.body);
  expect(body).not.toHaveProperty('score');
  expect(body).not.toHaveProperty('nonce');
  expect(body).not.toHaveProperty('witness');
});

test('store rejects private fields at the boundary', async () => {
  const store = createZkProofStore({
    env: TEST_DB_ENV,
    fetcher: async () => fakeResponse(201, [proofRow()]),
  });
  const base = {
    evaluation_id: EVALUATION_ID,
    learner_id: LEARNER_ID,
    credential_id_hash: CREDENTIAL_HASH,
    evidence_hash: EVIDENCE_HASH,
    threshold: 80,
    circuit_version: '1.0.0',
    vkey_hash: VKEY_HASH,
    commitment: '123456789',
    public_signals: ['80', '123456789', '111', '222', '333', '444'],
    proof: proofRow().proof,
    attestation: publicAttestation(),
    issuer_key_id: 'kid-1',
    issued_at: '2026-11-05T00:00:00.000Z',
  };

  await expect(store.insertProof({ ...base, score: 90 }))
    .rejects.toMatchObject({ code: 'ZK_PROOF_PRIVATE_FIELD' });
  await expect(store.insertProof({ ...base, proof: { ...base.proof, nonce: 'x' } }))
    .rejects.toMatchObject({ code: 'ZK_PROOF_PRIVATE_FIELD' });
  await expect(store.insertProof({
    ...base,
    proof_mode: 'official',
    credential_is_test: true,
  })).rejects.toMatchObject({ code: 'ZK_OFFICIAL_TEST_FORBIDDEN' });
});

test('store maps conflicts and failures without leaking SQL details', async () => {
  const conflictStore = createZkProofStore({
    env: TEST_DB_ENV,
    fetcher: async () => fakeResponse(409, { code: '23505', message: 'duplicate key' }),
  });
  await expect(conflictStore.findById(PROOF_ID))
    .rejects.toMatchObject({ code: 'ZK_PROOF_CONFLICT', status: 409 });

  const offlineStore = createZkProofStore({
    env: TEST_DB_ENV,
    fetcher: async () => { throw new Error('network down'); },
  });
  await expect(offlineStore.findById(PROOF_ID))
    .rejects.toMatchObject({ code: 'ZK_DATABASE_UNAVAILABLE', status: 503 });

  const store = createZkProofStore({
    env: TEST_DB_ENV,
    fetcher: async () => fakeResponse(200, []),
  });
  await expect(store.updateStatus(PROOF_ID, 'deleted'))
    .rejects.toMatchObject({ code: 'ZK_INVALID_TRANSITION' });
  await expect(store.findById('not-a-uuid'))
    .rejects.toMatchObject({ code: 'ZK_INVALID_INPUT' });
});

test('store reads use an explicit allowlist and learner scoping', async () => {
  const urls = [];
  const store = createZkProofStore({
    env: TEST_DB_ENV,
    fetcher: async (url, init = {}) => {
      urls.push(url);
      if (init.method === 'PATCH') return fakeResponse(200, [proofRow({ status: 'revoked', revoked_at: '2026-11-05T00:00:00Z' })]);
      return fakeResponse(200, []);
    },
  });
  await store.findById(PROOF_ID);
  await store.listByLearner(LEARNER_ID, { limit: 10, offset: 0 });
  await store.findByEvaluationThreshold({ evaluationId: EVALUATION_ID, threshold: 80, circuitVersion: '1.0.0' });
  await store.updateStatus(PROOF_ID, 'revoked');

  expect(urls[0]).toContain('id=eq.');
  expect(urls[0]).toContain('limit=1');
  expect(urls[1]).toContain(`learner_id=eq.${LEARNER_ID}`);
  expect(urls[1]).toContain('limit=10');
  expect(urls[2]).toContain('status=eq.active');
  expect(urls[3]).toContain('status=eq.active');
});

function transitionStore(initialStatus = 'active') {
  const state = { status: initialStatus, revoked_at: null };
  const calls = [];
  const store = createZkProofStore({
    env: TEST_DB_ENV,
    now: () => new Date('2026-11-05T00:00:00Z'),
    fetcher: async (url, init = {}) => {
      calls.push({ url, init });
      if (init.method !== 'PATCH') return fakeResponse(200, []);
      if (!url.includes('status=eq.active') || state.status !== 'active') return fakeResponse(200, []);
      const body = JSON.parse(init.body);
      state.status = body.status;
      state.revoked_at = body.revoked_at;
      return fakeResponse(200, [proofRow({ ...state })]);
    },
  });
  return { store, state, calls };
}

test('store enforces one-way active -> revoked/superseded transitions', async () => {
  const first = transitionStore('active');
  await expect(first.store.updateStatus(PROOF_ID, 'active'))
    .rejects.toMatchObject({ code: 'ZK_INVALID_TRANSITION', status: 409 });
  expect(first.calls).toHaveLength(0);

  const revoked = await first.store.updateStatus(PROOF_ID, 'revoked');
  expect(revoked.status).toBe('revoked');
  expect(revoked.revoked_at).toBe('2026-11-05T00:00:00.000Z');
  await expect(first.store.updateStatus(PROOF_ID, 'superseded'))
    .rejects.toMatchObject({ code: 'ZK_PROOF_TRANSITION_CONFLICT', status: 409 });
  await expect(first.store.updateStatus(PROOF_ID, 'revoked'))
    .rejects.toMatchObject({ code: 'ZK_PROOF_TRANSITION_CONFLICT', status: 409 });
  expect(first.state.status).toBe('revoked');

  const second = transitionStore('active');
  const superseded = await second.store.updateStatus(PROOF_ID, 'superseded');
  expect(superseded.status).toBe('superseded');
  expect(superseded.revoked_at).toBeNull();
  await expect(second.store.updateStatus(PROOF_ID, 'active'))
    .rejects.toMatchObject({ code: 'ZK_INVALID_TRANSITION', status: 409 });
  await expect(second.store.updateStatus(PROOF_ID, 'revoked'))
    .rejects.toMatchObject({ code: 'ZK_PROOF_TRANSITION_CONFLICT', status: 409 });
  expect(second.state.status).toBe('superseded');
});

test('store checks remain active under concurrent transition attempts', async () => {
  const { store, state } = transitionStore('active');
  const results = await Promise.allSettled([
    store.updateStatus(PROOF_ID, 'revoked'),
    store.updateStatus(PROOF_ID, 'superseded'),
  ]);
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
  expect(['revoked', 'superseded']).toContain(state.status);
});

// ---------- Key configuration ----------

async function writeKeyFixture({ productionReady = true, mode = 'multi-party-ceremony', nPublic = 6 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'paradox-zk-keys-'));
  const vkey = { protocol: 'groth16', curve: 'bn128', nPublic, IC: Array.from({ length: 7 }, (_, i) => String(i)) };
  const vkeyText = JSON.stringify(vkey);
  const vkeyPath = join(dir, 'verification_key.json');
  await writeFile(vkeyPath, vkeyText);
  const manifestPath = join(dir, 'manifest.json');
  const manifestText = JSON.stringify({
    circuit: { name: 'score_threshold', version: '1.0.0' },
    trustedSetup: { productionReady, mode },
  });
  await writeFile(manifestPath, manifestText);
  return {
    dir,
    vkeyPath,
    manifestPath,
    vkeyHash: createHash('sha256').update(vkeyText).digest('hex'),
    manifestHash: createHash('sha256').update(manifestText).digest('hex'),
  };
}

function keyEnv(fixture, { publicKeyPem, overrides = {} } = {}) {
  return {
    NODE_ENV: 'test',
    ZK_CIRCUIT_VERSION: '1.0.0',
    ZK_TRUSTED_SETUP_MODE: 'production',
    ZK_VKEY_PATH: fixture.vkeyPath,
    ZK_VKEY_SHA256: fixture.vkeyHash,
    ZK_PRODUCTION_VKEY_SHA256: fixture.vkeyHash,
    ZK_TRUSTED_SETUP_MANIFEST: fixture.manifestPath,
    ZK_MANIFEST_SHA256: fixture.manifestHash,
    ZK_TRUSTED_ISSUERS_JSON: JSON.stringify([{ keyId: 'kid-1', publicKeyPem, status: 'active' }]),
    ...overrides,
  };
}

test('valid production key configuration loads and fingerprints Ed25519 keys', async () => {
  const fixture = await writeKeyFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const config = await loadKeyConfig({ env: keyEnv(fixture, { publicKeyPem }), now: new Date('2026-11-05T00:00:00Z') });
    expect(config.setupMode).toBe('production');
    expect(config.productionVerified).toBe(true);
    expect(config.circuitVersion).toBe('1.0.0');
    expect(config.vkeySha256).toBe(fixture.vkeyHash);
    expect(config.manifestHash).toBe(fixture.manifestHash);
    expect(config.activeIssuerKeyIds).toEqual(['kid-1']);
    expect(config.verificationKey.nPublic).toBe(6);
    const key = resolveIssuerKey(config, 'kid-1');
    expect(key.publicKey.asymmetricKeyType).toBe('ed25519');
    expect(key.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(() => resolveIssuerKey(config, 'unknown')).toThrow(expect.objectContaining({ code: 'ZK_UNTRUSTED_ISSUER' }));
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('key configuration fails closed on missing/mismatched vkey hash and dev setup', async () => {
  const fixture = await writeKeyFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const noHash = keyEnv(fixture, { publicKeyPem });
    delete noHash.ZK_VKEY_SHA256;
    await expect(loadKeyConfig({ env: noHash })).rejects.toMatchObject({ code: 'ZK_VKEY_HASH_REQUIRED' });

    await expect(loadKeyConfig({
      env: keyEnv(fixture, { publicKeyPem, overrides: { ZK_VKEY_SHA256: '00'.repeat(32) } }),
    })).rejects.toMatchObject({ code: 'ZK_VKEY_HASH_MISMATCH' });

    const devFixture = await writeKeyFixture({
      productionReady: false,
      mode: 'local-single-contributor',
    });
    await expect(loadKeyConfig({
      env: keyEnv(devFixture, { publicKeyPem }),
    })).rejects.toMatchObject({ code: 'ZK_DEVELOPMENT_SETUP_FORBIDDEN' });

    const localMarkedReady = await writeKeyFixture({
      productionReady: true,
      mode: 'local-single-contributor',
    });
    await expect(loadKeyConfig({
      env: keyEnv(localMarkedReady, { publicKeyPem }),
    })).rejects.toMatchObject({ code: 'ZK_DEVELOPMENT_SETUP_FORBIDDEN' });
    await rm(localMarkedReady.dir, { recursive: true, force: true });

    await expect(loadKeyConfig({
      env: keyEnv(devFixture, {
        publicKeyPem,
        overrides: { ZK_TRUSTED_SETUP_MODE: 'development' },
      }),
    })).rejects.toMatchObject({ code: 'ZK_DEVELOPMENT_SETUP_NOT_ALLOWED' });

    await expect(loadKeyConfig({
      env: keyEnv(devFixture, {
        publicKeyPem,
        overrides: {
          ZK_TRUSTED_SETUP_MODE: 'development',
          ZK_ALLOW_DEVELOPMENT_SETUP: '1',
          NODE_ENV: 'production',
        },
      }),
    })).rejects.toMatchObject({ code: 'ZK_DEVELOPMENT_SETUP_FORBIDDEN' });

    const allowedDev = await loadKeyConfig({
      env: keyEnv(devFixture, {
        publicKeyPem,
        overrides: { ZK_TRUSTED_SETUP_MODE: 'development', ZK_ALLOW_DEVELOPMENT_SETUP: '1' },
      }),
    });
    expect(allowedDev.setupMode).toBe('development');
    expect(allowedDev.productionVerified).toBe(false);

    await rm(devFixture.dir, { recursive: true, force: true });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('trusted issuer config rejects private keys, expiry, missing config and wrong vkey shape', async () => {
  const fixture = await writeKeyFixture();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  try {
    await expect(loadKeyConfig({
      env: keyEnv(fixture, { publicKeyPem, overrides: { ZK_TRUSTED_ISSUERS_JSON: '' , ZK_TRUSTED_ISSUERS_FILE: '' } }),
    })).rejects.toMatchObject({ code: 'ZK_KEY_CONFIG_MISSING' });

    await expect(loadKeyConfig({
      env: keyEnv(fixture, {
        publicKeyPem,
        overrides: { ZK_TRUSTED_ISSUERS_JSON: JSON.stringify([{ keyId: 'kid-1', publicKeyPem: privateKeyPem }]) },
      }),
    })).rejects.toMatchObject({ code: 'ZK_KEY_CONFIG_INVALID' });

    const expired = await loadTrustedIssuers({
      env: keyEnv(fixture, {
        publicKeyPem,
        overrides: {
          ZK_TRUSTED_ISSUERS_JSON: JSON.stringify([{
            keyId: 'kid-old',
            publicKeyPem,
            status: 'active',
            notAfter: '2020-01-01T00:00:00.000Z',
          }]),
        },
      }),
      now: new Date('2026-11-05T00:00:00Z'),
    });
    expect(expired.active.size).toBe(0);
    await expect(loadKeyConfig({
      env: keyEnv(fixture, {
        publicKeyPem,
        overrides: {
          ZK_TRUSTED_ISSUERS_JSON: JSON.stringify([{
            keyId: 'kid-old',
            publicKeyPem,
            status: 'active',
            notAfter: '2020-01-01T00:00:00.000Z',
          }]),
        },
      }),
      now: new Date('2026-11-05T00:00:00Z'),
    })).rejects.toMatchObject({ code: 'ZK_TRUSTED_ISSUERS_EMPTY' });

    const wrongFixture = await writeKeyFixture({ nPublic: 5 });
    await expect(loadKeyConfig({
      env: keyEnv(wrongFixture, { publicKeyPem }),
    })).rejects.toMatchObject({ code: 'ZK_VKEY_INVALID' });
    await rm(wrongFixture.dir, { recursive: true, force: true });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

// ---------- Migration / RLS assumptions ----------

test('production artifact pins fail closed for missing, wrong and tampered artifacts', async () => {
  const fixture = await writeKeyFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const missingVkeyPin = keyEnv(fixture, { publicKeyPem });
    delete missingVkeyPin.ZK_PRODUCTION_VKEY_SHA256;
    await expect(loadKeyConfig({ env: missingVkeyPin })).rejects.toMatchObject({
      code: 'ZK_PRODUCTION_VKEY_PIN_REQUIRED',
    });

    await expect(loadKeyConfig({
      env: keyEnv(fixture, { publicKeyPem, overrides: { ZK_PRODUCTION_VKEY_SHA256: '00'.repeat(32) } }),
    })).rejects.toMatchObject({ code: 'ZK_PRODUCTION_VKEY_PIN_MISMATCH' });

    const missingManifestPin = keyEnv(fixture, { publicKeyPem });
    delete missingManifestPin.ZK_MANIFEST_SHA256;
    await expect(loadKeyConfig({ env: missingManifestPin })).rejects.toMatchObject({
      code: 'ZK_MANIFEST_PIN_REQUIRED',
    });

    await expect(loadKeyConfig({
      env: keyEnv(fixture, { publicKeyPem, overrides: { ZK_MANIFEST_SHA256: '00'.repeat(32) } }),
    })).rejects.toMatchObject({ code: 'ZK_MANIFEST_PIN_MISMATCH' });

    await expect(loadKeyConfig({
      env: keyEnv(fixture, {
        publicKeyPem,
        overrides: { ZK_TRUSTED_SETUP_MANIFEST: join(fixture.dir, 'missing-manifest.json') },
      }),
    })).rejects.toMatchObject({ code: 'ZK_TRUSTED_SETUP_MANIFEST_REQUIRED' });

    const missingVkey = keyEnv(fixture, {
      publicKeyPem,
      overrides: { ZK_VKEY_PATH: join(fixture.dir, 'missing-vkey.json') },
    });
    await expect(loadKeyConfig({ env: missingVkey })).rejects.toMatchObject({ code: 'ZK_VKEY_UNAVAILABLE' });

    // Keep the old pin, but replace the artifact on disk.
    await writeFile(fixture.vkeyPath, JSON.stringify({
      protocol: 'groth16', curve: 'bn128', nPublic: 6, IC: ['0', '2', '3', '4', '5', '6', '7'],
    }));
    await expect(loadKeyConfig({ env: keyEnv(fixture, { publicKeyPem }) })).rejects.toMatchObject({
      code: 'ZK_VKEY_HASH_MISMATCH',
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('migration is additive, RLS-locked and contains no score/nonce/witness columns', async () => {
  const path = fileURLToPath(new URL('../supabase/migrations/202611050001_zk_proof_of_learning.sql', import.meta.url));
  const sql = await readFile(path, 'utf8');

  const start = sql.indexOf('create table if not exists public.zk_proofs');
  const end = sql.indexOf('\n);', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const tableBlock = sql.slice(start, end).replace(/--.*$/gm, '');

  for (const column of [
    'evaluation_id',
    'learner_id',
    'credential_id_hash',
    'evidence_hash',
    'threshold',
    'circuit_version',
    'vkey_hash',
    'commitment',
    'public_signals',
    'proof',
    'attestation',
    'issuer_key_id',
    'issued_at',
    'status',
    'proof_mode',
    'credential_is_test',
    'revoked_at',
    'created_at',
    'updated_at',
  ]) {
    expect(tableBlock).toContain(column);
  }
  expect(tableBlock).not.toMatch(/\bscore\b/i);
  expect(tableBlock).not.toMatch(/\bnonce\b/i);
  expect(tableBlock).not.toMatch(/\bwitness\b/i);

  expect(sql).toMatch(/evaluation_id uuid not null references public\.learning_evaluations\(id\) on delete cascade/i);
  expect(sql).toMatch(/create unique index if not exists zk_proofs_active_eval_threshold_circuit_idx[\s\S]*?where status = 'active'/i);
  expect(tableBlock).not.toMatch(/unique \(evaluation_id, threshold, circuit_version\)/i);
  expect(sql).toMatch(/constraint zk_proofs_official_not_test[\s\S]*?proof_mode <> 'official' or credential_is_test = false/i);
  expect(sql).toMatch(/constraint zk_proofs_revoked_at_consistent[\s\S]*?status = 'revoked'/i);
  expect(sql).toMatch(/create or replace function public\.set_zk_proof_updated_at/i);
  expect(sql).toMatch(/create trigger zk_proofs_set_updated_at/i);
  expect(sql).toMatch(/enable row level security/i);
  expect(sql).toMatch(/force row level security/i);
  expect(sql).toMatch(/revoke all on table public\.zk_proofs from public, anon, authenticated/i);
  expect(sql).toMatch(/grant select, insert, update, delete on table public\.zk_proofs to service_role/i);
  expect(sql).toMatch(/create policy zk_proofs_service_role_all[\s\S]*?to service_role/i);
  expect(sql).not.toMatch(/grant[^;]*\b(anon|authenticated)\b/i);
  expect(sql).not.toMatch(/create policy[^;]*to (anon|authenticated)/i);
});
