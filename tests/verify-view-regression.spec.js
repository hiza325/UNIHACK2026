import { expect, test } from '@playwright/test';
import { createCredentialService, toPublicCredential, toVerificationView } from '../api/credentials/_service.js';
import { createCredentialsHandler } from '../api/credentials/index.js';
import { hasActualAvalancheVerification, getCredentialVerificationState } from '../learning-passport-service.js';

// Regression coverage for the Certificate Verify page: the API used to drop
// the issue transaction hash from its verification projection, so a genuinely
// confirmed credential rendered as "unavailable" in the client.

const ISSUE_TX = `0x${'11'.repeat(32)}`;
const REVOKE_TX = `0x${'22'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'ab'.repeat(32)}`;
const CODE = 'PXP-2026-REGRESSION-0001';

const BASE_ENV = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key' };

function baseRow(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    credential_code: CODE,
    title: 'Regression credential',
    skill: 'Reasoning',
    issued_at: '2026-10-30T00:00:00.000Z',
    blockchain_status: 'confirmed',
    onchain_valid: true,
    verification_checked_at: '2026-10-30T00:00:00.000Z',
    issue_tx_hash: ISSUE_TX,
    evidence_hash: EVIDENCE_HASH,
    is_test: false,
    ...overrides,
  };
}

function memoryStore(row) {
  let current = row ? { ...row } : null;
  return {
    async findByCode() { return current ? { ...current } : null; },
    async updateCredential(id, patch) {
      if (!current) return null;
      current = { ...current, ...patch };
      return { ...current };
    },
  };
}

function onchainValid(overrides = {}) {
  return {
    exists: true,
    valid: true,
    revoked: false,
    evidenceHash: EVIDENCE_HASH,
    issuer: '0x2222222222222222222222222222222222222222',
    issuedAt: 1_800_000_000,
    revokedAt: 0,
    ...overrides,
  };
}

async function verifyWith(row, onchain = onchainValid()) {
  const service = createCredentialService({
    store: memoryStore(row),
    avalancheFactory: async () => ({ verifyCredential: async () => onchain }),
  });
  const credential = toVerificationView(await service.verify(CODE));
  return credential;
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('a confirmed on-chain credential is verified and carries its issue hash', async () => {
  const view = await verifyWith(baseRow());

  expect(view.status).toBe('verified');
  expect(view.issueTransactionHash).toBe(ISSUE_TX);
  expect(view.transactionHash).toBe(ISSUE_TX);
  expect(hasActualAvalancheVerification(view)).toBe(true);
  expect(getCredentialVerificationState(view)).toBe('valid');
  // Learner-private data still never reaches the verification view.
  for (const field of ['snapshot', 'assessmentScore', 'evidenceHash', 'issuer', 'revokeTransactionHash']) {
    expect(view[field]).toBeUndefined();
  }
});

test('a pending credential stays unverified even when an issue hash exists', async () => {
  const view = toVerificationView(toPublicCredential(baseRow({
    blockchain_status: 'pending',
    onchain_valid: false,
    verification_checked_at: null,
  })));

  expect(view.status).toBe('pending');
  expect(view.issueTransactionHash).toBe(ISSUE_TX);
  expect(hasActualAvalancheVerification(view)).toBe(false);
  expect(getCredentialVerificationState(view)).not.toBe('valid');
});

test('a revoked credential stays unverified', async () => {
  const view = await verifyWith(
    baseRow({ blockchain_status: 'revoked', onchain_valid: false, revoke_tx_hash: REVOKE_TX }),
    onchainValid({ valid: false, revoked: true, revokedAt: 1_800_000_100 }),
  );

  expect(view.status).toBe('revoked');
  expect(view.issueTransactionHash).toBe(ISSUE_TX);
  expect(view.transactionHash).toBe(REVOKE_TX);
  expect(hasActualAvalancheVerification(view)).toBe(false);
  expect(getCredentialVerificationState(view)).toBe('revoked');
});

test('a missing credential is not verified', async () => {
  const service = createCredentialService({
    store: memoryStore(null),
    avalancheFactory: async () => ({ verifyCredential: async () => onchainValid() }),
  });

  await expect(service.verify(CODE)).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND', status: 404 });
  expect(getCredentialVerificationState(null)).toBe('not-found');
});

test('a verified status without the mandatory issue hash is not treated as verified', () => {
  const view = toVerificationView(toPublicCredential(baseRow({ issue_tx_hash: null })));

  expect(view.status).toBe('verified');
  expect(view.issueTransactionHash).toBeNull();
  expect(hasActualAvalancheVerification(view)).toBe(false);
  expect(getCredentialVerificationState(view)).toBe('unavailable');
});

test('the verify API response exposes the issue hash and nothing learner-private', async () => {
  const originalFetch = global.fetch;
  const previousEnv = { ...process.env };
  Object.assign(process.env, BASE_ENV, { SUPABASE_SERVICE_ROLE_KEY: 'service-key', ADMIN_EMAILS: '' });
  const stranger = { id: '55555555-5555-4555-8555-555555555555', email: 'stranger@example.com', app_metadata: {} };
  global.fetch = async () => new Response(JSON.stringify({ ...stranger, banned_until: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const handler = createCredentialsHandler({
    storeFactory: () => ({}),
    serviceFactory: () => ({ verify: async () => toPublicCredential(baseRow()) }),
    learningRecordStoreFactory: () => null,
  });

  try {
    const res = responseRecorder();
    await handler({
      method: 'POST',
      headers: { cookie: 'paradox-access=session-token', 'x-forwarded-for': '203.0.113.77' },
      body: { action: 'verify', credentialCode: CODE },
      query: {},
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.credential.issueTransactionHash).toBe(ISSUE_TX);
    expect(getCredentialVerificationState(res.payload.credential)).toBe('valid');
    expect(JSON.stringify(res.payload)).not.toMatch(/recipientName|assessmentScore|evaluationId|evidenceHash/i);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
});
