import { expect, test } from '@playwright/test';
import { createCredentialService, toPublicCredential } from '../api/credentials/_service.js';

// Hardening regression coverage for certificate confirmation & reconciliation.

const ISSUE_TX = `0x${'11'.repeat(32)}`;
const OTHER_TX = `0x${'22'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'ab'.repeat(32)}`;
const CODE = 'PXP-HARDEN-0001';
const EVAL_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };

function createMemoryStore(seed = null) {
  const credentials = [];
  const transactions = [];
  if (seed) credentials.push({ ...seed });
  return {
    credentials,
    transactions,
    async findLearnerName() { return 'Test Learner'; },
    async findByCode(code) {
      const row = credentials.find(item => item.credential_code === code);
      return row ? { ...row } : null;
    },
    async findByEvaluationId(evaluationId) {
      const row = credentials.find(item => item.evaluation_id === evaluationId);
      return row ? { ...row } : null;
    },
    async listByLearner(id) { return credentials.filter(item => item.learner_id === id); },
    async insertCredential(record) {
      const row = { id: `credential-${credentials.length + 1}`, created_at: new Date().toISOString(), onchain_valid: false, verification_checked_at: null, confirmation_started_at: null, confirmation_attempts: 0, ...record };
      credentials.push(row);
      return { ...row };
    },
    async updateCredential(id, patch) {
      const row = credentials.find(item => item.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async updateCredentialForVerify(id, patch, expectedUpdatedAt) {
      const row = credentials.find(item => item.id === id);
      if (!row) return null;
      if (!expectedUpdatedAt || row.updated_at !== expectedUpdatedAt) return null;
      if (row.blockchain_status === 'revoked') return null;
      if (row.confirmation_started_at != null) return null;
      Object.assign(row, patch);
      row.updated_at = new Date().toISOString();
      return { ...row };
    },
    async updateCredentialIf(id, patch, claimedAt) {
      const row = credentials.find(item => item.id === id);
      if (!row) return null;
      if (!['submitting', 'pending'].includes(row.blockchain_status)) return null;
      if (!claimedAt || row.confirmation_started_at !== claimedAt) return null;
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
      if (row) Object.assign(row, patch);
      return row ? { ...row } : null;
    },
    async claimRetry(id) {
      const row = credentials.find(item => item.id === id && item.blockchain_status === 'failed');
      if (!row) return null;
      Object.assign(row, { blockchain_status: 'submitting', failure_code: null, failure_message: null });
      return { ...row };
    },
    async claimConfirm(id) {
      const row = credentials.find(item => item.id === id);
      if (!row) return null;
      if (!['submitting', 'pending'].includes(row.blockchain_status)) return null;
      if (row.confirmation_started_at) {
        const cutoff = Date.now() - 60000;
        if (new Date(row.confirmation_started_at).getTime() > cutoff) return null;
      }
      row.confirmation_started_at = new Date().toISOString();
      row.confirmation_attempts = (row.confirmation_attempts || 0) + 1;
      return { ...row };
    },
  };
}

function successfulGateway(overrides = {}) {
  return {
    contractAddress: '0x1111111111111111111111111111111111111111',
    issuerAddress: '0x2222222222222222222222222222222222222222',
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: '0x1111111111111111111111111111111111111111', from: '0x2222222222222222222222222222222222222222', value: 0n, data: null };
    },
    async getTransactionReceipt(txHash) {
      return { transactionHash: txHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
    async issueCredential({ credentialId, evidenceHash, onSubmitted }) {
      await onSubmitted(ISSUE_TX);
      return { receipt: { transactionHash: ISSUE_TX, blockNumber: 123, gasUsed: '100000', status: 1 }, credential: { exists: true, valid: true, revoked: false, credentialId, evidenceHash, issuer: '0x2222222222222222222222222222222222222222', issuedAt: 1_800_000_000, revokedAt: 0 } };
    },
    async verifyCredential(credentialId) {
      return { exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE_HASH, issuer: '0x2222222222222222222222222222222222222222', issuedAt: 1_800_000_000, revokedAt: 0 };
    },
    ...overrides,
  };
}

function encodeData() {
  // The service recomputes expectedData; gateway.getTransaction must return matching data.
  // We'll override getTransaction in tests to return the expected calldata.
  return null;
}

test('receipt arrives late: first pending, second confirmed', async () => {
  const store = createMemoryStore({
    id: 'cred-1', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', evaluation_id: null,
  });
  const row = store.credentials[0];
  const expectedData = (await import('../api/credentials/_avalanche.js')).encodeIssueCredential(row.credential_id_hash, row.evidence_hash);

  let receiptAvailable = false;
  const gateway = successfulGateway({
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: '0x1111111111111111111111111111111111111111', from: '0x2222222222222222222222222222222222222222', value: 0n, data: expectedData };
    },
    async getTransactionReceipt(txHash) {
      if (!receiptAvailable) return null;
      return { transactionHash: txHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
  });

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const first = await service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN);
  expect(first.status).toBe('pending');
  expect(first.reason).toBe('transaction_pending');

  receiptAvailable = true;
  const second = await service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN);
  expect(second.status).toBe('confirmed');
  expect(store.credentials[0].blockchain_status).toBe('confirmed');
  expect(store.credentials[0].issue_tx_hash).toBe(ISSUE_TX);
});

test('RPC timeout is treated as pending, not failed', async () => {
  const store = createMemoryStore({
    id: 'cred-2', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', evaluation_id: null,
  });
  const row = store.credentials[0];
  const { encodeIssueCredential } = await import('../api/credentials/_avalanche.js');
  const expectedData = encodeIssueCredential(row.credential_id_hash, row.evidence_hash);

  const gateway = successfulGateway({
    async getTransaction() {
      const err = new Error('RPC unavailable');
      err.code = 'AVALANCHE_RPC_UNAVAILABLE';
      err.status = 503;
      throw err;
    },
  });
  // override getTransaction to throw before using expectedData
  gateway.getTransaction = async () => { const err = new Error('RPC unavailable'); err.code = 'AVALANCHE_RPC_UNAVAILABLE'; err.status = 503; throw err; };

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN);
  expect(result.status).toBe('pending');
  expect(result.reason).toBe('rpc_error');
  expect(store.credentials[0].blockchain_status).toBe('pending');
});

test('transaction reverted marks credential failed', async () => {
  const store = createMemoryStore({
    id: 'cred-3', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', evaluation_id: null,
  });
  const row = store.credentials[0];
  const { encodeIssueCredential } = await import('../api/credentials/_avalanche.js');
  const expectedData = encodeIssueCredential(row.credential_id_hash, row.evidence_hash);

  const gateway = successfulGateway({
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: '0x1111111111111111111111111111111111111111', from: '0x2222222222222222222222222222222222222222', value: 0n, data: expectedData };
    },
    async getTransactionReceipt(txHash) {
      return { transactionHash: txHash, blockNumber: 123, gasUsed: '100000', status: 0 };
    },
  });

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await expect(service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN)).rejects.toMatchObject({
    code: 'AVALANCHE_TRANSACTION_REVERTED', status: 502,
  });
  expect(store.credentials[0].blockchain_status).toBe('failed');
});

test('already confirmed is idempotent', async () => {
  const store = createMemoryStore({
    id: 'cred-4', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'confirmed',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', issue_tx_hash: ISSUE_TX,
    evaluation_id: null, onchain_valid: true, verification_checked_at: new Date().toISOString(),
  });

  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN);
  expect(result.alreadyConfirmed).toBe(true);
  expect(result.status).toBe('confirmed');
});

test('reconciliation via verify converts pending to confirmed', async () => {
  const store = createMemoryStore({
    id: 'cred-5', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'pending',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', issue_tx_hash: ISSUE_TX,
    evaluation_id: null, onchain_valid: false,
    updated_at: '2026-11-02T10:00:00.000Z',
  });

  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.verify(CODE);
  expect(result.status).toBe('verified');
  expect(store.credentials[0].blockchain_status).toBe('confirmed');
});

test('duplicate issuance from same evaluation is rejected', async () => {
  const store = createMemoryStore();
  const learningStore = {
    sessions: [{ id: 's1', learner_id: LEARNER_ID, status: 'completed', started_at: '2026-10-28T10:00:00.000Z', completed_at: '2026-10-28T10:05:00.000Z' }],
    submissions: [{ id: 'sub1', session_id: 's1', learner_id: LEARNER_ID, attempt_number: 1, submission_type: 'initial', analysis_state: 'analyzed' }],
    evaluations: [{
      id: EVAL_ID, session_id: 's1', submission_id: 'sub1', learner_id: LEARNER_ID, status: 'pass',
      credential_eligible: true, rubric_version: 'paradox-rubric-v1',
      proof_record: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
    }],
    async findSession(id, learnerId) { return this.sessions.find(s => s.id === id && s.learner_id === learnerId) || null; },
    async findSubmission(id, sessionId, learnerId) { return this.submissions.find(s => s.id === id && s.session_id === sessionId && s.learner_id === learnerId) || null; },
    async findEvaluation(id, learnerId) { return this.evaluations.find(e => e.id === id && e.learner_id === learnerId) || null; },
    async findLearnerName() { return 'Test Learner'; },
  };

  // First issuance succeeds.
  const gateway1 = successfulGateway();
  const service1 = createCredentialService({ store, learningRecordStore: learningStore, avalancheFactory: async () => gateway1 });
  const first = await service1.issue({
    credentialCode: CODE, learnerId: LEARNER_ID, title: 'First', skill: 'x', assessmentScore: 90,
    source: 'ai-evaluation', isTest: false, evaluationId: EVAL_ID,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  }, ADMIN);
  expect(first.status).toBe('verified');

  // Second issuance with a different code but same evaluation must be rejected.
  const gateway2 = successfulGateway();
  const service2 = createCredentialService({ store, learningRecordStore: learningStore, avalancheFactory: async () => gateway2 });
  await expect(service2.issue({
    credentialCode: 'PXP-HARDEN-0002', learnerId: LEARNER_ID, title: 'Second', skill: 'x', assessmentScore: 90,
    source: 'ai-evaluation', isTest: false, evaluationId: EVAL_ID,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  }, ADMIN)).rejects.toMatchObject({ code: 'DUPLICATE_EVALUATION_ISSUANCE', status: 409 });
});

test('wrong sender marks credential failed', async () => {
  const store = createMemoryStore({
    id: 'cred-6', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', evaluation_id: null,
  });
  const row = store.credentials[0];
  const { encodeIssueCredential } = await import('../api/credentials/_avalanche.js');
  const expectedData = encodeIssueCredential(row.credential_id_hash, row.evidence_hash);

  const gateway = successfulGateway({
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: '0x1111111111111111111111111111111111111111', from: '0x9999999999999999999999999999999999999999', value: 0n, data: expectedData };
    },
  });

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await expect(service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN)).rejects.toMatchObject({
    code: 'INVALID_TRANSACTION_SENDER', status: 409,
  });
  expect(store.credentials[0].blockchain_status).toBe('failed');
});

test('wrong calldata marks credential failed', async () => {
  const store = createMemoryStore({
    id: 'cred-7', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', evaluation_id: null,
  });

  const gateway = successfulGateway({
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: '0x1111111111111111111111111111111111111111', from: '0x2222222222222222222222222222222222222222', value: 0n, data: '0xdeadbeef' };
    },
  });

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await expect(service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN)).rejects.toMatchObject({
    code: 'INVALID_TRANSACTION_CALLDATA', status: 409,
  });
  expect(store.credentials[0].blockchain_status).toBe('failed');
});test('two concurrent confirm requests do not double-process', async () => {
  const store = createMemoryStore({
    id: 'cred-c', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', evaluation_id: null,
  });
  const row = store.credentials[0];
  const { encodeIssueCredential } = await import('../api/credentials/_avalanche.js');
  const expectedData = encodeIssueCredential(row.credential_id_hash, row.evidence_hash);

  const gateway = successfulGateway({
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: '0x1111111111111111111111111111111111111111', from: '0x2222222222222222222222222222222222222222', value: 0n, data: expectedData };
    },
  });

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const [a, b] = await Promise.allSettled([
    service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN),
    service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN),
  ]);
  const statuses = [a, b].map(r => r.status === 'fulfilled' ? r.value.status : 'rejected');
  expect(statuses).toContain('confirmed');
  expect(store.credentials[0].blockchain_status).toBe('confirmed');
});

test('transaction hash mismatch is rejected', async () => {
  const store = createMemoryStore({
    id: 'cred-h', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'confirmed',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', issue_tx_hash: ISSUE_TX,
    evaluation_id: null, onchain_valid: true, verification_checked_at: new Date().toISOString(),
  });

  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await expect(service.confirmIssue({ credentialCode: CODE, txHash: OTHER_TX }, ADMIN)).rejects.toMatchObject({
    code: 'DUPLICATE_TRANSACTION', status: 409,
  });
});

test('evidence hash mismatch marks credential failed', async () => {
  const store = createMemoryStore({
    id: 'cred-e', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', evaluation_id: null,
  });
  const row = store.credentials[0];
  const { encodeIssueCredential } = await import('../api/credentials/_avalanche.js');
  const expectedData = encodeIssueCredential(row.credential_id_hash, row.evidence_hash);

  const gateway = successfulGateway({
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: '0x1111111111111111111111111111111111111111', from: '0x2222222222222222222222222222222222222222', value: 0n, data: expectedData };
    },
    async getTransactionReceipt(txHash) {
      return { transactionHash: txHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
    async verifyCredential(credentialId) {
      return { exists: true, valid: false, revoked: false, credentialId, evidenceHash: `0x${'ff'.repeat(32)}`, issuer: '0x2222222222222222222222222222222222222222', issuedAt: 1_800_000_000, revokedAt: 0 };
    },
  });

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await expect(service.confirmIssue({ credentialCode: CODE, txHash: ISSUE_TX }, ADMIN)).rejects.toMatchObject({
    code: 'EVIDENCE_HASH_MISMATCH', status: 409,
  });
  expect(store.credentials[0].blockchain_status).toBe('failed');
});

test('revoked credential is not treated as verified', async () => {
  const store = createMemoryStore({
    id: 'cred-r', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'revoked',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: '0x1111111111111111111111111111111111111111',
    issuer_address: '0x2222222222222222222222222222222222222222', issue_tx_hash: ISSUE_TX,
    revoke_tx_hash: OTHER_TX, evaluation_id: null, onchain_valid: false,
    revoked_at: new Date().toISOString(), verification_checked_at: new Date().toISOString(),
  });

  const gateway = successfulGateway({
    async verifyCredential(credentialId) {
      return { exists: true, valid: false, revoked: true, credentialId, evidenceHash: EVIDENCE_HASH, issuer: '0x2222222222222222222222222222222222222222', issuedAt: 1_800_000_000, revokedAt: 1_800_000_100 };
    },
  });
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.verify(CODE);
  expect(result.status).toBe('revoked');
  expect(store.credentials[0].blockchain_status).toBe('revoked');
});

test('stale verify response must not restore a revoked credential', async () => {
  const store = createMemoryStore({
    id: 'verify-race-1',
    updated_at: '2026-11-02T10:00:00.000Z',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH,
    blockchain_status: 'confirmed',
    onchain_valid: true,
    confirmation_started_at: null,
  });

  let releaseRpc;
  let notifyRpc;
  const rpcStarted = new Promise(resolve => { notifyRpc = resolve; });
  const rpcReleased = new Promise(resolve => { releaseRpc = resolve; });

  const gateway = successfulGateway({
    async verifyCredential() {
      notifyRpc();
      await rpcReleased;
      return {
        exists: true,
        valid: true,
        revoked: false,
        evidenceHash: EVIDENCE_HASH,
        issuer: '0x2222222222222222222222222222222222222222',
        issuedAt: 1800000000,
        revokedAt: 0,
      };
    },
  });

  const service = createCredentialService({
    store,
    avalancheFactory: async () => gateway,
  });

  const requestA = service.verify(CODE);
  await rpcStarted;

  // Another request revokes the credential while verify() is waiting.
  await store.updateCredential('verify-race-1', {
    blockchain_status: 'revoked',
    onchain_valid: false,
    updated_at: '2026-11-02T10:01:00.000Z',
    revoked_at: new Date().toISOString(),
  });

  releaseRpc();
  const resultA = await requestA;

  expect(store.credentials[0].blockchain_status).toBe('revoked');
  expect(store.credentials[0].onchain_valid).toBe(false);
  expect(resultA.transactionStatus).toBe('revoked');
});

test('verify must not overwrite a credential locked by confirmation', async () => {
  const store = createMemoryStore({
    id: 'verify-lock-1',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE_HASH,
    blockchain_status: 'pending',
    onchain_valid: false,
    confirmation_started_at: null,
    updated_at: '2026-11-02T10:00:00.000Z',
  });

  let releaseRpc;
  let notifyRpc;

  const rpcStarted = new Promise(resolve => { notifyRpc = resolve; });
  const rpcReleased = new Promise(resolve => { releaseRpc = resolve; });

  const gateway = successfulGateway({
    async verifyCredential() {
      notifyRpc();
      await rpcReleased;
      return {
        exists: true,
        valid: true,
        revoked: false,
        evidenceHash: EVIDENCE_HASH,
        issuer: '0x2222222222222222222222222222222222222222',
        issuedAt: 1800000000,
        revokedAt: 0,
      };
    },
  });

  const service = createCredentialService({
    store,
    avalancheFactory: async () => gateway,
  });

  const requestA = service.verify(CODE);
  await rpcStarted;

  const claimed = await store.claimConfirm('verify-lock-1');
  expect(claimed).not.toBeNull();

  releaseRpc();

  const resultA = await requestA;

  expect(store.credentials[0].blockchain_status).toBe('pending');
  expect(store.credentials[0].onchain_valid).toBe(false);
  expect(store.credentials[0].confirmation_started_at).not.toBeNull();
  expect(resultA.transactionStatus).toBe('pending');
});
