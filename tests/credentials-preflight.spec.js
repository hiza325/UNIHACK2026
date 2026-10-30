import { expect, test } from '@playwright/test';
import { createCredentialService } from '../api/credentials/_service.js';
import { credentialIdFromCode } from '../api/credentials/_avalanche.js';
import { createCredentialStore } from '../api/credentials/_store.js';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };
const ISSUE_TX = `0x${'11'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'ab'.repeat(32)}`;

function issuePayload(overrides = {}) {
  return {
    credentialCode: 'PXP-TEST-2026-0001',
    learnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'MOCK TEST Credential — not real learning evidence',
    skill: 'TEST ONLY',
    assessmentScore: 90,
    evidenceHash: EVIDENCE_HASH,
    source: 'manual-test',
    isTest: true,
    ...overrides,
  };
}

function createMemoryStore() {
  const credentials = [];
  const transactions = [];
  return {
    credentials,
    transactions,
    async findLearnerName() { return 'Nguyễn Minh Anh'; },
    async findByCode(code) {
      const row = credentials.find(item => item.credential_code === code);
      return row ? { ...row } : null;
    },
    async listByLearner(id) { return credentials.filter(item => item.learner_id === id); },
    async insertCredential(record) {
      const row = { id: `credential-${credentials.length + 1}`, created_at: new Date().toISOString(), onchain_valid: false, verification_checked_at: null, ...record };
      credentials.push(row);
      return { ...row };
    },
    async updateCredential(id, patch) {
      const row = credentials.find(item => item.id === id);
      Object.assign(row, patch);
      return { ...row };
    },
    async insertTransaction(record) {
      const row = { id: transactions.length + 1, ...record };
      transactions.push(row);
      return { ...row };
    },
    async updateTransaction(id, patch) {
      const row = transactions.find(item => item.id === id);
      Object.assign(row, patch);
      return { ...row };
    },
    async claimRetry(id) {
      const row = credentials.find(item => item.id === id && item.blockchain_status === 'failed');
      if (!row) return null;
      Object.assign(row, { blockchain_status: 'submitting', failure_code: null, failure_message: null });
      return { ...row };
    },
  };
}

function successfulGateway() {
  return {
    contractAddress: '0x1111111111111111111111111111111111111111',
    issuerAddress: '0x2222222222222222222222222222222222222222',
    async preflight() {
      return { chainId: 43113, contractAddress: this.contractAddress, issuerAddress: this.issuerAddress, authorized: true };
    },
    async issueCredential({ credentialId, evidenceHash, onSubmitted }) {
      await onSubmitted(ISSUE_TX);
      return {
        receipt: { transactionHash: ISSUE_TX, blockNumber: 123, gasUsed: '100000', status: 1 },
        credential: { exists: true, valid: true, revoked: false, credentialId, evidenceHash, issuer: this.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 0 },
      };
    },
    async revokeCredential({ credentialId, onSubmitted }) {
      await onSubmitted(`0x${'22'.repeat(32)}`);
      return {
        receipt: { transactionHash: `0x${'22'.repeat(32)}`, blockNumber: 124, gasUsed: '50000', status: 1 },
        credential: { exists: true, valid: false, revoked: true, credentialId, evidenceHash: EVIDENCE_HASH, issuer: this.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 1_800_000_100 },
      };
    },
    async verifyCredential(credentialId) {
      return { exists: false, valid: false, revoked: false, credentialId, evidenceHash: EVIDENCE_HASH, issuer: this.issuerAddress, issuedAt: 0, revokedAt: 0 };
    },
    async credentialIdForEvidence() { return null; },
    async getTransactionReceipt(transactionHash) {
      return { transactionHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
  };
}

test('preflight failure from missing signer creates no credential or transaction', async () => {
  const store = createMemoryStore();
  const service = createCredentialService({
    store,
    avalancheFactory: async () => {
      throw Object.assign(new Error('Avalanche issuer wallet is not configured'), { code: 'AVALANCHE_ISSUER_NOT_CONFIGURED', status: 503 });
    },
  });
  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_ISSUER_NOT_CONFIGURED', status: 503 });
  expect(store.credentials).toHaveLength(0);
  expect(store.transactions).toHaveLength(0);
});

test('preflight failure from unauthorized signer creates no records', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  gateway.preflight = async () => { throw Object.assign(new Error('Issuer wallet is not authorized'), { code: 'ISSUER_NOT_AUTHORIZED', status: 403 }); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'ISSUER_NOT_AUTHORIZED', status: 403 });
  expect(store.credentials).toHaveLength(0);
  expect(store.transactions).toHaveLength(0);
});

test('preflight failure from wrong chain creates no records', async () => {
  const store = createMemoryStore();
  const service = createCredentialService({
    store,
    avalancheFactory: async () => {
      throw Object.assign(new Error('Refusing chain'), { code: 'AVALANCHE_WRONG_CHAIN', status: 503 });
    },
  });
  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_WRONG_CHAIN', status: 503 });
  expect(store.credentials).toHaveLength(0);
  expect(store.transactions).toHaveLength(0);
});

test('preflight failure from registry mismatch creates no records', async () => {
  const store = createMemoryStore();
  const service = createCredentialService({
    store,
    avalancheFactory: async () => {
      throw Object.assign(new Error('Registry mismatch'), { code: 'AVALANCHE_CONTRACT_MISMATCH', status: 503 });
    },
  });
  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_CONTRACT_MISMATCH', status: 503 });
  expect(store.credentials).toHaveLength(0);
  expect(store.transactions).toHaveLength(0);
});

test('preflight failure from missing registry bytecode creates no records', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  gateway.preflight = async () => { throw Object.assign(new Error('Registry missing'), { code: 'AVALANCHE_REGISTRY_NOT_DEPLOYED', status: 503 }); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_REGISTRY_NOT_DEPLOYED', status: 503 });
  expect(store.credentials).toHaveLength(0);
  expect(store.transactions).toHaveLength(0);
});

test('preflight is invoked before credential persistence', async () => {
  const store = createMemoryStore();
  const order = [];
  const originalInsert = store.insertCredential.bind(store);
  store.insertCredential = async (record) => {
    order.push('insert');
    return originalInsert(record);
  };
  const gateway = successfulGateway();
  gateway.preflight = async () => {
    order.push('preflight');
    return { chainId: 43113, contractAddress: gateway.contractAddress, issuerAddress: gateway.issuerAddress, authorized: true };
  };
  const service = createCredentialService({
    store,
    avalancheFactory: async () => {
      order.push('factory');
      return gateway;
    },
  });
  await service.issue(issuePayload(), ADMIN);
  expect(order).toEqual(['factory', 'preflight', 'insert']);
});

test('duplicate credential is rejected without chain contact', async () => {
  const store = createMemoryStore();
  await store.insertCredential({ credential_code: 'PXP-TEST-2026-0001', blockchain_status: 'confirmed' });
  const factoryCalls = [];
  const service = createCredentialService({
    store,
    avalancheFactory: async () => {
      factoryCalls.push(1);
      return successfulGateway();
    },
  });
  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'DUPLICATE_CREDENTIAL', status: 409 });
  expect(factoryCalls).toHaveLength(0);
  expect(store.credentials).toHaveLength(1);
});

test('retry is rejected for non-failed statuses', async () => {
  for (const status of ['pending', 'confirmed', 'verified', 'revoked']) {
    const store = createMemoryStore();
    await store.insertCredential({ credential_code: 'PXP-TEST-2026-0001', blockchain_status: status });
    const factoryCalls = [];
    const service = createCredentialService({
      store,
      avalancheFactory: async () => {
        factoryCalls.push(1);
        return successfulGateway();
      },
    });
    await expect(service.issue(issuePayload({ retryFailed: true }), ADMIN)).rejects.toMatchObject({ code: 'DUPLICATE_CREDENTIAL', status: 409 });
    expect(factoryCalls).toHaveLength(0);
  }
});

test('failed retry reconciles an already-mined credential without sending', async () => {
  const store = createMemoryStore();
  await store.insertCredential({
    id: 'credential-1',
    credential_code: 'PXP-TEST-2026-0001',
    credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0001'),
    evidence_hash: EVIDENCE_HASH,
    source: 'manual-test',
    is_test: true,
    learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    blockchain_status: 'failed',
  });
  const gateway = successfulGateway();
  gateway.verifyCredential = async () => ({ exists: true, valid: true, revoked: false, credentialId: credentialIdFromCode('PXP-TEST-2026-0001'), evidenceHash: EVIDENCE_HASH, issuer: gateway.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 0 });
  const issueCalls = [];
  gateway.issueCredential = async () => { issueCalls.push(1); throw new Error('must not send'); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.issue(issuePayload({ retryFailed: true, credentialIdHash: undefined }), ADMIN);
  // credentialIdHash is derived by service; ensure no send happened.
  expect(issueCalls).toHaveLength(0);
  expect(store.credentials[0].blockchain_status).toBe('confirmed');
  expect(result.status).toBe('verified');
});

test('failed retry sends only when on-chain credential is absent', async () => {
  const store = createMemoryStore();
  await store.insertCredential({
    id: 'credential-1',
    credential_code: 'PXP-TEST-2026-0001',
    credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0001'),
    evidence_hash: EVIDENCE_HASH,
    source: 'manual-test',
    is_test: true,
    learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    blockchain_status: 'failed',
  });
  const gateway = successfulGateway();
  gateway.verifyCredential = async () => ({ exists: false, valid: false, revoked: false, credentialId: credentialIdFromCode('PXP-TEST-2026-0001'), evidenceHash: EVIDENCE_HASH, issuer: gateway.issuerAddress, issuedAt: 0, revokedAt: 0 });
  const issueCalls = [];
  const originalIssue = gateway.issueCredential.bind(gateway);
  gateway.issueCredential = async (args) => {
    issueCalls.push(1);
    return originalIssue(args);
  };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.issue(issuePayload({ retryFailed: true }), ADMIN);
  expect(issueCalls).toHaveLength(1);
  expect(result.status).toBe('verified');
  expect(store.transactions.some(t => t.status === 'confirmed')).toBe(true);
});

test('transaction failure before broadcast marks credential and transaction failed', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  gateway.issueCredential = async () => {
    throw Object.assign(new Error('Avalanche transaction failed'), { code: 'AVALANCHE_TRANSACTION_FAILED', status: 502 });
  };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_TRANSACTION_FAILED', status: 502 });
  expect(store.credentials[0]).toMatchObject({ blockchain_status: 'failed', failure_code: 'AVALANCHE_TRANSACTION_FAILED' });
  expect(store.credentials[0].issue_tx_hash).toBeUndefined();
  expect(store.transactions[0]).toMatchObject({ status: 'failed' });
});

test('broadcast failure without gateway metadata keeps issuance pending', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  gateway.issueCredential = async ({ onSubmitted }) => {
    await onSubmitted(ISSUE_TX);
    throw Object.assign(new Error('Avalanche transaction failed'), { code: 'AVALANCHE_TRANSACTION_FAILED', status: 502 });
  };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_TRANSACTION_FAILED', status: 502 });
  expect(store.credentials[0]).toMatchObject({
    blockchain_status: 'pending',
    issue_tx_hash: ISSUE_TX,
    failure_code: 'AVALANCHE_TRANSACTION_STATUS_UNKNOWN',
  });
  expect(store.transactions[0]).toMatchObject({ status: 'pending', transaction_hash: ISSUE_TX });
});

test('revoke with missing signer creates no transaction record', async () => {
  const store = createMemoryStore();
  await store.insertCredential({ id: 'credential-1', credential_code: 'PXP-TEST-2026-0001', blockchain_status: 'confirmed', source: 'manual-test' });
  const service = createCredentialService({
    store,
    avalancheFactory: async () => {
      throw Object.assign(new Error('Avalanche issuer wallet is not configured'), { code: 'AVALANCHE_ISSUER_NOT_CONFIGURED', status: 503 });
    },
  });
  await expect(service.revoke('PXP-TEST-2026-0001')).rejects.toMatchObject({ code: 'AVALANCHE_ISSUER_NOT_CONFIGURED', status: 503 });
  expect(store.transactions).toHaveLength(0);
});
test('credential store claimRetry uses an atomic status filter', async () => {
  const calls = [];
  const store = createCredentialStore({
    env: { SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only' },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => [{ id: 'credential-1', blockchain_status: 'submitting' }] };
    },
  });
  const row = await store.claimRetry('credential-1');
  expect(row).toMatchObject({ id: 'credential-1', blockchain_status: 'submitting' });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain('/rest/v1/learning_credentials');
  expect(calls[0].url).toContain('id=eq.credential-1');
  expect(calls[0].url).toContain('blockchain_status=eq.failed');
  expect(calls[0].options.method).toBe('PATCH');
  expect(JSON.parse(calls[0].options.body)).toMatchObject({ blockchain_status: 'submitting' });
});

test('broadcast timeout keeps issuance pending and blocks a duplicate retry', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  let issueCalls = 0;
  gateway.issueCredential = async ({ onSubmitted }) => {
    issueCalls += 1;
    await onSubmitted(ISSUE_TX);
    throw Object.assign(new Error('Avalanche transaction failed'), {
      code: 'AVALANCHE_TRANSACTION_FAILED',
      status: 502,
      transactionHash: ISSUE_TX,
      broadcast: true,
      ambiguous: true,
    });
  };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_TRANSACTION_FAILED', status: 502 });
  expect(store.credentials[0]).toMatchObject({
    blockchain_status: 'pending',
    issue_tx_hash: ISSUE_TX,
    failure_code: 'AVALANCHE_TRANSACTION_STATUS_UNKNOWN',
  });
  expect(store.transactions[0]).toMatchObject({ status: 'pending', transaction_hash: ISSUE_TX });

  await expect(service.issue(issuePayload({ retryFailed: true }), ADMIN)).rejects.toMatchObject({ code: 'DUPLICATE_CREDENTIAL', status: 409 });
  expect(issueCalls).toBe(1);
});

test('failed retry reconciles a successful previous transaction by hash without sending', async () => {
  const store = createMemoryStore();
  await store.insertCredential({
    id: 'credential-1',
    credential_code: 'PXP-TEST-2026-0001',
    credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0001'),
    evidence_hash: EVIDENCE_HASH,
    source: 'manual-test',
    is_test: true,
    learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    blockchain_status: 'failed',
    issue_tx_hash: ISSUE_TX,
  });
  const gateway = successfulGateway();
  gateway.getTransactionReceipt = async transactionHash => ({ transactionHash, blockNumber: 123, gasUsed: '100000', status: 1 });
  gateway.verifyCredential = async credentialId => ({ exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE_HASH, issuer: gateway.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 0 });
  let issueCalls = 0;
  gateway.issueCredential = async () => { issueCalls += 1; throw new Error('must not send'); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  const result = await service.issue(issuePayload({ retryFailed: true }), ADMIN);
  expect(result.status).toBe('verified');
  expect(issueCalls).toBe(0);
  expect(store.credentials[0]).toMatchObject({ blockchain_status: 'confirmed', issue_tx_hash: ISSUE_TX });
});

test('failed retry with an unknown previous transaction is blocked without sending', async () => {
  const store = createMemoryStore();
  await store.insertCredential({
    id: 'credential-1',
    credential_code: 'PXP-TEST-2026-0001',
    credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0001'),
    evidence_hash: EVIDENCE_HASH,
    source: 'manual-test',
    is_test: true,
    learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    blockchain_status: 'failed',
    issue_tx_hash: ISSUE_TX,
  });
  const gateway = successfulGateway();
  gateway.getTransactionReceipt = async () => null;
  gateway.verifyCredential = async credentialId => ({ exists: false, valid: false, revoked: false, credentialId, evidenceHash: EVIDENCE_HASH, issuer: gateway.issuerAddress, issuedAt: 0, revokedAt: 0 });
  let issueCalls = 0;
  gateway.issueCredential = async () => { issueCalls += 1; throw new Error('must not send'); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  await expect(service.issue(issuePayload({ retryFailed: true }), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_TRANSACTION_STATUS_UNKNOWN', status: 409 });
  expect(issueCalls).toBe(0);
  expect(store.credentials[0].blockchain_status).toBe('failed');
});

test('concurrent failed retries allow only one transaction sender', async () => {
  const store = createMemoryStore();
  await store.insertCredential({
    id: 'credential-1',
    credential_code: 'PXP-TEST-2026-0001',
    credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0001'),
    evidence_hash: EVIDENCE_HASH,
    source: 'manual-test',
    is_test: true,
    learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    blockchain_status: 'failed',
  });
  const gateway = successfulGateway();
  gateway.preflight = async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return { chainId: 43113, contractAddress: gateway.contractAddress, issuerAddress: gateway.issuerAddress, authorized: true };
  };
  let issueCalls = 0;
  gateway.issueCredential = async ({ credentialId, evidenceHash, onSubmitted }) => {
    issueCalls += 1;
    await onSubmitted(ISSUE_TX);
    return {
      receipt: { transactionHash: ISSUE_TX, blockNumber: 123, gasUsed: '100000', status: 1 },
      credential: { exists: true, valid: true, revoked: false, credentialId, evidenceHash, issuer: gateway.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 0 },
    };
  };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  const results = await Promise.allSettled([
    service.issue(issuePayload({ retryFailed: true }), ADMIN),
    service.issue(issuePayload({ retryFailed: true }), ADMIN),
  ]);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].reason).toMatchObject({ code: 'CREDENTIAL_RETRY_IN_PROGRESS', status: 409 });
  expect(issueCalls).toBe(1);
});

test('evidence hash already owned by another credential is rejected before writes', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  gateway.credentialIdForEvidence = async () => `0x${'12'.repeat(32)}`;
  let issueCalls = 0;
  gateway.issueCredential = async () => { issueCalls += 1; throw new Error('must not send'); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'DUPLICATE_EVIDENCE', status: 409 });
  expect(issueCalls).toBe(0);
  expect(store.credentials).toHaveLength(0);
  expect(store.transactions).toHaveLength(0);
});

test('confirmed on-chain issuance is not downgraded to failed when the database update fails', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  const originalUpdate = store.updateCredential.bind(store);
  let failedOnce = false;
  store.updateCredential = async (id, patch) => {
    if (!failedOnce && patch.blockchain_status === 'confirmed') {
      failedOnce = true;
      throw Object.assign(new Error('database update failed'), { code: 'CREDENTIAL_DATABASE_ERROR', status: 502 });
    }
    return originalUpdate(id, patch);
  };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'CREDENTIAL_DATABASE_ERROR', status: 502 });
  expect(store.credentials[0]).toMatchObject({ blockchain_status: 'confirmed', issue_tx_hash: ISSUE_TX });
  expect(store.credentials[0].blockchain_status).not.toBe('failed');
  expect(store.transactions[0]).toMatchObject({ status: 'confirmed', transaction_hash: ISSUE_TX });
});

test('generic database insert failure is not misclassified as a duplicate credential', async () => {
  const store = createMemoryStore();
  store.insertCredential = async () => {
    throw Object.assign(new Error('database unavailable'), { code: 'CREDENTIAL_DATABASE_ERROR', status: 502 });
  };
  const gateway = successfulGateway();
  let issueCalls = 0;
  gateway.issueCredential = async () => { issueCalls += 1; throw new Error('must not send'); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  await expect(service.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'CREDENTIAL_DATABASE_ERROR', status: 502 });
  expect(issueCalls).toBe(0);
});

test('revoke reconciles an already-revoked on-chain credential without sending', async () => {
  const store = createMemoryStore();
  await store.insertCredential({
    id: 'credential-1',
    credential_code: 'PXP-TEST-2026-0001',
    credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0001'),
    evidence_hash: EVIDENCE_HASH,
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'confirmed',
  });
  const gateway = successfulGateway();
  gateway.verifyCredential = async credentialId => ({ exists: true, valid: false, revoked: true, credentialId, evidenceHash: EVIDENCE_HASH, issuer: gateway.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 1_800_000_100 });
  let revokeCalls = 0;
  gateway.revokeCredential = async () => { revokeCalls += 1; throw new Error('must not send'); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  const result = await service.revoke('PXP-TEST-2026-0001');
  expect(result.status).toBe('revoked');
  expect(revokeCalls).toBe(0);
  expect(store.credentials[0]).toMatchObject({ blockchain_status: 'revoked', revoked_at: new Date(1_800_000_100 * 1000).toISOString() });
  expect(store.transactions).toHaveLength(0);
});

test('revoke_pending reconciles an on-chain revocation without sending a duplicate', async () => {
  const store = createMemoryStore();
  await store.insertCredential({
    id: 'credential-1',
    credential_code: 'PXP-TEST-2026-0001',
    credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0001'),
    evidence_hash: EVIDENCE_HASH,
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'revoke_pending',
    revoke_tx_hash: `0x${'22'.repeat(32)}`,
  });
  const gateway = successfulGateway();
  gateway.verifyCredential = async credentialId => ({ exists: true, valid: false, revoked: true, credentialId, evidenceHash: EVIDENCE_HASH, issuer: gateway.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 1_800_000_100 });
  let revokeCalls = 0;
  gateway.revokeCredential = async () => { revokeCalls += 1; throw new Error('must not send'); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  const result = await service.revoke('PXP-TEST-2026-0001');
  expect(result.status).toBe('revoked');
  expect(revokeCalls).toBe(0);
  expect(store.credentials[0]).toMatchObject({
    blockchain_status: 'revoked',
    revoke_tx_hash: `0x${'22'.repeat(32)}`,
    revoked_at: new Date(1_800_000_100 * 1000).toISOString(),
  });
  expect(store.transactions).toHaveLength(0);
});

test('revoke is blocked while issuance is not confirmed', async () => {
  const store = createMemoryStore();
  await store.insertCredential({
    id: 'credential-1',
    credential_code: 'PXP-TEST-2026-0001',
    evidence_hash: EVIDENCE_HASH,
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'pending',
  });
  const gateway = successfulGateway();
  let revokeCalls = 0;
  gateway.revokeCredential = async () => { revokeCalls += 1; throw new Error('must not send'); };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  await expect(service.revoke('PXP-TEST-2026-0001')).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_CONFIRMED', status: 409 });
  expect(revokeCalls).toBe(0);
  expect(store.transactions).toHaveLength(0);
});

test('broadcast revocation timeout keeps revoke_pending and blocks a second revoke', async () => {
  const store = createMemoryStore();
  await store.insertCredential({
    id: 'credential-1',
    credential_code: 'PXP-TEST-2026-0001',
    credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0001'),
    evidence_hash: EVIDENCE_HASH,
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'confirmed',
  });
  const gateway = successfulGateway();
  gateway.verifyCredential = async credentialId => ({ exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE_HASH, issuer: gateway.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 0 });
  let revokeCalls = 0;
  gateway.revokeCredential = async ({ onSubmitted }) => {
    revokeCalls += 1;
    await onSubmitted(`0x${'22'.repeat(32)}`);
    throw Object.assign(new Error('Avalanche transaction failed'), {
      code: 'AVALANCHE_TRANSACTION_FAILED',
      status: 502,
      transactionHash: `0x${'22'.repeat(32)}`,
      broadcast: true,
      ambiguous: true,
    });
  };
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  await expect(service.revoke('PXP-TEST-2026-0001')).rejects.toMatchObject({ code: 'AVALANCHE_TRANSACTION_FAILED', status: 502 });
  expect(store.credentials[0]).toMatchObject({
    blockchain_status: 'revoke_pending',
    revoke_tx_hash: `0x${'22'.repeat(32)}`,
    failure_code: 'AVALANCHE_TRANSACTION_STATUS_UNKNOWN',
  });
  expect(store.transactions[0]).toMatchObject({ status: 'pending', transaction_hash: `0x${'22'.repeat(32)}` });

  await expect(service.revoke('PXP-TEST-2026-0001')).rejects.toMatchObject({ code: 'CREDENTIAL_REVOKE_PENDING', status: 409 });
  expect(revokeCalls).toBe(1);
});
