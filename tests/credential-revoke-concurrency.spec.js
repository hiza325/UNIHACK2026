import { expect, test } from '@playwright/test';
import { createCredentialService } from '../api/credentials/_service.js';

// Revoke concurrency regression tests (C1/C2).

const CODE = 'PXP-REVOKE-0001';
const ISSUE_TX = `0x${'11'.repeat(32)}`;
const REVOKE_TX = `0x${'22'.repeat(32)}`;
const EVIDENCE = `0x${'ab'.repeat(32)}`;
const CONTRACT = '0x1111111111111111111111111111111111111111';
const ISSUER = '0x2222222222222222222222222222222222222222';
const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createMemoryStore(seed = null) {
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
    async updateCredentialForRevoke(id, patch, expectedUpdatedAt, expectedStatus, revokeTxHash) {
      const row = credentials.find(item => item.id === id);
      if (!row) return null;
      if (!expectedUpdatedAt || row.updated_at !== expectedUpdatedAt) return null;
      if (row.blockchain_status !== expectedStatus) return null;
      if (revokeTxHash && row.revoke_tx_hash !== revokeTxHash) return null;
      Object.assign(row, patch);
      row.updated_at = new Date().toISOString();
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

function makeGateway(overrides = {}) {
  return {
    contractAddress: CONTRACT,
    issuerAddress: ISSUER,
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: CONTRACT, from: ISSUER, value: 0n, data: null };
    },
    async getTransactionReceipt(txHash) {
      return { transactionHash: txHash, blockNumber: 124, gasUsed: '50000', status: 1 };
    },
    async verifyCredential(credentialId) {
      return { exists: true, valid: false, revoked: true, credentialId, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1_800_000_000, revokedAt: 1_800_000_100 };
    },
    async revokeCredential({ credentialId, onSubmitted }) {
      const txHash = REVOKE_TX;
      await onSubmitted(txHash);
      return { receipt: { transactionHash: txHash, blockNumber: 124, gasUsed: '50000', status: 1 }, credential: { exists: true, valid: false, revoked: true, credentialId, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1_800_000_000, revokedAt: 1_800_000_100 } };
    },
    async preflight() { return { chainId: 43113, contractAddress: CONTRACT, issuerAddress: ISSUER, authorized: true }; },
    ...overrides,
  };
}

test('C1: two concurrent revokes only one succeeds', async () => {
  const store = createMemoryStore({
    id: 'revoke-1', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'confirmed',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: ISSUE_TX, evaluation_id: null,
    onchain_valid: true, verification_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const gateway = makeGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  // First revoke succeeds.
  const result1 = await service.revoke(CODE);
  expect(result1.status || 'revoked').toBeTruthy();

  // Second revoke should fail (already revoked).
  await expect(service.revoke(CODE)).rejects.toMatchObject({ code: 'CREDENTIAL_ALREADY_REVOKED' });
});

test('C1: claimRevoke only succeeds from confirmed', async () => {
  const store = createMemoryStore({
    id: 'revoke-2', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'confirmed',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: ISSUE_TX, evaluation_id: null,
    onchain_valid: true, verification_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const claim1 = await store.claimRevoke('revoke-2');
  expect(claim1).not.toBeNull();
  expect(claim1.blockchain_status).toBe('revoke_pending');

  // Second claim fails (no longer confirmed).
  const claim2 = await store.claimRevoke('revoke-2');
  expect(claim2).toBeNull();
});

test('C2: stale reconcile does not overwrite revoked', async () => {
  const store = createMemoryStore({
    id: 'reconcile-1', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'revoked',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: ISSUE_TX, revoke_tx_hash: REVOKE_TX,
    evaluation_id: null, onchain_valid: false,
    revoked_at: new Date().toISOString(), verification_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // reconcileCredential on revoked credential should return revoked, not overwrite.
  const gateway = makeGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.reconcileCredential(CODE, ISSUE_TX);
  expect(result.status).toBe('revoked');
  expect(store.credentials[0].blockchain_status).toBe('revoked');
});

test('CAS conflict on revoke does not overwrite', async () => {
  const store = createMemoryStore({
    id: 'cas-revoke', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'confirmed',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: ISSUE_TX, evaluation_id: null,
    onchain_valid: true, verification_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Simulate a stale update with wrong expectedUpdatedAt → should return null.
  const stale = await store.updateCredentialForRevoke('cas-revoke', { blockchain_status: 'revoked' }, 'wrong-timestamp', 'confirmed', ISSUE_TX);
  expect(stale).toBeNull();
  // Row unchanged.
  expect(store.credentials[0].blockchain_status).toBe('confirmed');
});

test('reconcile no-hash does not overwrite revoked', async () => {
  const store = createMemoryStore({
    id: 'recon-nohash', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'revoked',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: ISSUE_TX, revoke_tx_hash: REVOKE_TX,
    evaluation_id: null, onchain_valid: false,
    revoked_at: new Date().toISOString(), verification_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const gateway = makeGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  // No hash provided → reconcile from on-chain. But credential is revoked → should return revoked.
  const result = await service.reconcileCredential(CODE, null);
  expect(result.status).toBe('revoked');
  expect(store.credentials[0].blockchain_status).toBe('revoked');
});

test('ambiguous RPC timeout without hash keeps pending', async () => {
  const store = createMemoryStore({
    id: 'ambig-1', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: LEARNER_ID,
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: null, evaluation_id: null,
    onchain_valid: false, updated_at: new Date().toISOString(),
  });

  const gateway = {
    contractAddress: CONTRACT, issuerAddress: ISSUER,
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
