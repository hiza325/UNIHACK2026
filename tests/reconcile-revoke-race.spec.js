import { expect, test } from '@playwright/test';
import { createCredentialService } from '../api/credentials/_service.js';

// Offline service-level tests: stale reconciliation must not overwrite revoked state.

const CODE = 'PXP-RACE-REVOKE-0001';
const ISSUE_TX = `0x${'11'.repeat(32)}`;
const REVOKE_TX = `0x${'22'.repeat(32)}`;
const EVIDENCE = `0x${'ab'.repeat(32)}`;
const CONTRACT = '0x1111111111111111111111111111111111111111';
const ISSUER = '0x2222222222222222222222222222222222222222';
const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createMemoryStore(seed) {
  const credentials = [];
  const transactions = [];
  if (seed) credentials.push({ updated_at: new Date().toISOString(), confirmation_started_at: null, confirmation_attempts: 0, ...seed });
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
      const now = new Date().toISOString();
      const row = { id: `credential-${credentials.length + 1}`, created_at: now, updated_at: now, onchain_valid: false, verification_checked_at: null, confirmation_started_at: null, confirmation_attempts: 0, ...record };
      credentials.push(row);
      return { ...row };
    },
    async updateCredential(id, patch) {
      const row = credentials.find(item => item.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      row.updated_at = new Date().toISOString();
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
      if (patch.confirmation_started_at !== undefined) {
        row.confirmation_started_at = patch.confirmation_started_at;
      }
      return { ...row };
    },
    async updateCredentialForReconcile(id, patch, expectedUpdatedAt) {
      const row = credentials.find(item => item.id === id);
      if (!row) return null;
      if (!expectedUpdatedAt || row.updated_at !== expectedUpdatedAt) return null;
      if (!['submitting', 'pending'].includes(row.blockchain_status)) return null;
      Object.assign(row, patch);
      row.updated_at = new Date().toISOString();
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
    async claimRevoke(id) {
      const row = credentials.find(item => item.id === id);
      if (!row) return null;
      if (row.blockchain_status !== 'confirmed') return null;
      if (row.revoke_tx_hash) return null;
      row.blockchain_status = 'revoke_pending';
      row.confirmation_started_at = null;
      row.updated_at = new Date().toISOString();
      return { ...row };
    },
    async findByEvaluationId(evaluationId) {
      const row = credentials.find(item => item.evaluation_id === evaluationId);
      return row ? { ...row } : null;
    },
  };
}

test('stale reconciliation must not overwrite revoked state', async () => {
  const row = {
    id: 'race-revoke-credential',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE,
    title: 'Race revoke test',
    skill: 'Reasoning',
    learner_id: LEARNER_ID,
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'submitting',
    network: 'avalanche-fuji',
    chain_id: 43113,
    contract_address: CONTRACT,
    issuer_address: ISSUER,
    issue_tx_hash: ISSUE_TX,
    onchain_valid: false,
    confirmation_started_at: null,
    confirmation_attempts: 0,
    evaluation_id: null,
    updated_at: new Date().toISOString(),
  };

  const store = createMemoryStore(row);

  // Deferred promise for reconcile's on-chain check
  let resolveReconcile;
  const reconcileDeferred = new Promise((resolve) => { resolveReconcile = resolve; });

  // Fake gateway: reconcile's verifyCredential will hang until released
  const gateway = {
    contractAddress: CONTRACT,
    issuerAddress: ISSUER,
    async verifyCredential(credentialId) {
      await reconcileDeferred;
      return { exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1_800_000_000, revokedAt: 0 };
    },
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: CONTRACT, from: ISSUER, value: 0n, data: null };
    },
    async getTransactionReceipt(txHash) {
      return { transactionHash: txHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
    async revokeCredential({ credentialId, onSubmitted }) {
      const txHash = REVOKE_TX;
      await onSubmitted(txHash);
      return { receipt: { transactionHash: txHash, blockNumber: 124, gasUsed: '50000', status: 1 }, credential: { exists: true, valid: false, revoked: true, credentialId, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1_800_000_000, revokedAt: 1_800_000_100 } };
    },
    async preflight() { return { chainId: 43113, contractAddress: CONTRACT, issuerAddress: ISSUER, authorized: true }; },
  };

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  // Start reconcile (will hang at verifyCredential)
  const reconcilePromise = service.reconcileCredential(CODE, ISSUE_TX);

  // While reconcile is waiting, simulate revocation claiming ownership
  // Directly transition the store row to 'revoked' (simulating external revoke)
  store.credentials[0].blockchain_status = 'revoked';
  store.credentials[0].onchain_valid = false;
  store.credentials[0].revoked_at = new Date().toISOString();
  store.credentials[0].updated_at = new Date().toISOString();

  // Release reconcile's deferred check
  resolveReconcile();

  // Reconcile should NOT overwrite revoked state
  const result = await reconcilePromise;
  // The DB must remain revoked (CAS prevents overwrite)
  expect(store.credentials[0].blockchain_status).toBe('revoked');
  // No revoke transaction was sent by reconcile
});

test('stale writer cannot overwrite newer confirmed result', async () => {
  const row = {
    id: 'race-stale-credential',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE,
    title: 'Stale writer test',
    skill: 'Reasoning',
    learner_id: LEARNER_ID,
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'submitting',
    network: 'avalanche-fuji',
    chain_id: 43113,
    contract_address: CONTRACT,
    issuer_address: ISSUER,
    issue_tx_hash: ISSUE_TX,
    onchain_valid: false,
    confirmation_started_at: null,
    confirmation_attempts: 0,
    evaluation_id: null,
    updated_at: new Date().toISOString(),
  };

  const store = createMemoryStore(row);

  // Simulate: request A claims lock
  const claimA = await store.claimConfirm(row.id);
  expect(claimA).not.toBeNull();
  const tokenA = claimA.confirmation_started_at;

  // Simulate request B claiming the lock (deterministic, no timing dependency)
  const tokenB = 'fencing-token-b-' + Date.now();
  store.credentials[0].confirmation_started_at = tokenB;
  store.credentials[0].confirmation_attempts = (store.credentials[0].confirmation_attempts || 0) + 1;

  // Request B can write with its token
  // (verified below after stale write check)

  // Request A tries to write with stale token -> should fail (CAS rejects)
  const staleWrite = await store.updateCredentialIf(row.id, { blockchain_status: 'confirmed' }, tokenA);
  expect(store.credentials[0].blockchain_status).not.toBe('confirmed');

  // Request B's lock is intact
  expect(store.credentials[0].confirmation_started_at).toBe(tokenB);

  // Request B can write with its token
  const validWrite = await store.updateCredentialIf(row.id, { blockchain_status: 'confirmed', confirmation_started_at: null }, tokenB);
  expect(validWrite).not.toBeNull();
  expect(store.credentials[0].blockchain_status).toBe('confirmed');
});

test('insertTransaction failure before broadcast does not overwrite', async () => {
  const row = {
    id: 'race-insert-fail',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE,
    title: 'Insert fail test',
    skill: 'Reasoning',
    learner_id: LEARNER_ID,
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'confirmed',
    network: 'avalanche-fuji',
    chain_id: 43113,
    contract_address: CONTRACT,
    issuer_address: ISSUER,
    issue_tx_hash: ISSUE_TX,
    onchain_valid: true,
    confirmation_started_at: null,
    confirmation_attempts: 0,
    evaluation_id: null,
    updated_at: new Date().toISOString(),
  };

  const store = createMemoryStore(row);
  // Simulate insertTransaction failure by making it throw
  let insertCalled = false;
  store.insertTransaction = async (record) => {
    insertCalled = true;
    throw new Error('DB insert failed');
  };

  const gateway = {
    contractAddress: CONTRACT,
    issuerAddress: ISSUER,
    async revokeCredential({ credentialId, onSubmitted }) {
      // Should not be called because insertTransaction fails first
      throw new Error('Should not reach here');
    },
    async verifyCredential(credentialId) {
      return { exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1_800_000_000, revokedAt: 0 };
    },
    async getTransactionReceipt() { return null; },
    async getTransaction() { return null; },
    async preflight() { return { chainId: 43113, contractAddress: CONTRACT, issuerAddress: ISSUER, authorized: true }; },
  };

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  // revoke should fail (insertTransaction throws)
  await expect(service.revoke(CODE)).rejects.toThrow('DB insert failed');
  expect(insertCalled).toBe(true);

  // Credential should be revoke_pending (claimRevoke already transitioned; insert failed before broadcast)
  expect(store.credentials[0].blockchain_status).toBe('revoke_pending');
});

test('RPC timeout without hash keeps ambiguous state', async () => {
  const row = {
    id: 'race-timeout',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE,
    title: 'Timeout test',
    skill: 'Reasoning',
    learner_id: LEARNER_ID,
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'submitting',
    network: 'avalanche-fuji',
    chain_id: 43113,
    contract_address: CONTRACT,
    issuer_address: ISSUER,
    issue_tx_hash: null,
    onchain_valid: false,
    confirmation_started_at: null,
    confirmation_attempts: 0,
    evaluation_id: null,
    updated_at: new Date().toISOString(),
  };

  const store = createMemoryStore(row);

  const gateway = {
    contractAddress: CONTRACT,
    issuerAddress: ISSUER,
    async verifyCredential(credentialId) {
      const err = new Error('RPC timeout');
      err.code = 'AVALANCHE_RPC_UNAVAILABLE';
      throw err;
    },
  };

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.reconcileCredential(CODE, null);
  expect(result.reason).toBe('rpc_error');
  expect(store.credentials[0].blockchain_status).toBe('submitting');
});

test('second request does not auto-retry transaction', async () => {
  const row = {
    id: 'race-no-retry',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE,
    title: 'No retry test',
    skill: 'Reasoning',
    learner_id: LEARNER_ID,
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'submitting',
    network: 'avalanche-fuji',
    chain_id: 43113,
    contract_address: CONTRACT,
    issuer_address: ISSUER,
    issue_tx_hash: ISSUE_TX,
    onchain_valid: false,
    confirmation_started_at: null,
    confirmation_attempts: 0,
    evaluation_id: null,
    updated_at: new Date().toISOString(),
  };

  const store = createMemoryStore(row);

  const gateway = {
    contractAddress: CONTRACT,
    issuerAddress: ISSUER,
    async getTransaction(txHash) {
      const { encodeIssueCredential } = await import('../api/credentials/_avalanche.js');
      const expectedData = encodeIssueCredential(row.credential_id_hash, row.evidence_hash);
      return { hash: txHash, chainId: 43113, to: CONTRACT, from: ISSUER, value: 0n, data: expectedData };
    },
    async getTransactionReceipt(txHash) {
      return null;
    },
    async verifyCredential(credentialId) {
      return { exists: false, valid: false, revoked: false, credentialId };
    },
    async revokeCredential() {
      throw new Error('Should not be called');
    },
    async preflight() { return { chainId: 43113, contractAddress: CONTRACT, issuerAddress: ISSUER, authorized: true }; },
  };

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.reconcileCredential(CODE, ISSUE_TX);
  expect(result.status).toBe('pending');
  expect(result.reason).toBe('transaction_pending');
});
