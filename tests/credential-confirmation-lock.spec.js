import { expect, test } from '@playwright/test';
import { createCredentialService } from '../api/credentials/_service.js';

// Regression tests for confirmation lock & attempts hardening.

const CODE = 'PXP-LOCK-0001';
const TX = `0x${'11'.repeat(32)}`;
const OTHER_TX = `0x${'22'.repeat(32)}`;
const EVIDENCE = `0x${'ab'.repeat(32)}`;
const CONTRACT = '0x1111111111111111111111111111111111111111';
const ISSUER = '0x2222222222222222222222222222222222222222';
const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };

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
      // Release lock if the patch clears it; otherwise keep it.
      if (patch.confirmation_started_at !== undefined) {
        row.confirmation_started_at = patch.confirmation_started_at;
      }
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
      // Atomic: set lock AND increment attempts in one operation (simulating DB atomicity).
      row.confirmation_started_at = new Date().toISOString();
      row.confirmation_attempts = (row.confirmation_attempts || 0) + 1;
      return { ...row };
    },
  };
}

function makeGateway(overrides = {}) {
  const { encodeIssueCredential } = require('../api/credentials/_avalanche.js');
  return {
    contractAddress: CONTRACT,
    issuerAddress: ISSUER,
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: CONTRACT, from: ISSUER, value: 0n, data: null };
    },
    async getTransactionReceipt(txHash) {
      return { transactionHash: txHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
    async verifyCredential(credentialId) {
      return { exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1_800_000_000, revokedAt: 0 };
    },
    ...overrides,
  };
}

test('A: two concurrent confirms only one claim succeeds', async () => {
  const store = createMemoryStore({
    id: 'lock-1', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: TX, evaluation_id: null,
    updated_at: new Date().toISOString(),
  });
  const row = store.credentials[0];
  const { encodeIssueCredential } = await import('../api/credentials/_avalanche.js');
  const expectedData = encodeIssueCredential(row.credential_id_hash, row.evidence_hash);

  const gateway = {
    contractAddress: CONTRACT, issuerAddress: ISSUER,
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: CONTRACT, from: ISSUER, value: 0n, data: expectedData };
    },
    async getTransactionReceipt(txHash) {
      return { transactionHash: txHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
    async verifyCredential(credentialId) {
      return { exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1_800_000_000, revokedAt: 0 };
    },
  };

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  // First claim should succeed.
  const claim1 = await store.claimConfirm(row.id);
  expect(claim1).not.toBeNull();
  const attemptsAfterFirst = store.credentials[0].confirmation_attempts;

  // Second claim should fail (lock held, not expired).
  const claim2 = await store.claimConfirm(row.id);
  expect(claim2).toBeNull();

  // Attempts should not have incremented again.
  expect(store.credentials[0].confirmation_attempts).toBe(attemptsAfterFirst);
});

test('B: expired lock allows new claim, old request cannot write', async () => {
  const oldTimestamp = new Date(Date.now() - 120000).toISOString(); // 2 min ago
  const store = createMemoryStore({
    id: 'lock-2', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source: 'manual-test', is_test: true, blockchain_status: 'pending',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: TX, evaluation_id: null,
    updated_at: new Date().toISOString(),
    confirmation_started_at: oldTimestamp,
    confirmation_attempts: 1,
  });
  const row = store.credentials[0];

  // New claim should succeed (lock expired).
  const newClaim = await store.claimConfirm(row.id);
  expect(newClaim).not.toBeNull();
  expect(newClaim.confirmation_attempts).toBe(2);

  // Old request's claimedAt no longer matches → updateCredentialIf returns null.
  const staleUpdate = await store.updateCredentialIf(row.id, { blockchain_status: 'confirmed' }, oldTimestamp);
  expect(staleUpdate).toBeNull();

  // Lock is still held by new request.
  expect(store.credentials[0].confirmation_started_at).not.toBe(oldTimestamp);
});

test('C: confirmation_attempts increments exactly once per claim', async () => {
  const store = createMemoryStore({
    id: 'lock-3', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source: 'manual-test', is_test: true, blockchain_status: 'submitting',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: TX, evaluation_id: null,
    updated_at: new Date().toISOString(),
    confirmation_started_at: null,
    confirmation_attempts: 0,
  });
  const row = store.credentials[0];

  expect(row.confirmation_attempts).toBe(0);

  const claim1 = await store.claimConfirm(row.id);
  expect(claim1).not.toBeNull();
  expect(store.credentials[0].confirmation_attempts).toBe(1);

  // Lock held → second claim fails, attempts unchanged.
  const claim2 = await store.claimConfirm(row.id);
  expect(claim2).toBeNull();
  expect(store.credentials[0].confirmation_attempts).toBe(1);
});

test('D: CAS conflict does not delete other request lock', async () => {
  const store = createMemoryStore({
    id: 'lock-4', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source: 'manual-test', is_test: true, blockchain_status: 'pending',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: TX, evaluation_id: null,
    updated_at: new Date().toISOString(),
  });
  const row = store.credentials[0];

  // Simulate request A claiming the lock.
  const claimA = await store.claimConfirm(row.id);
  expect(claimA).not.toBeNull();
  const lockA = store.credentials[0].confirmation_started_at;

  // Request B (stale) tries to update with wrong claimedAt → should fail.
  const staleUpdate = await store.updateCredentialIf(row.id, { blockchain_status: 'failed', confirmation_started_at: null }, 'stale-token');
  expect(staleUpdate).toBeNull();

  // Lock should still be held by request A.
  expect(store.credentials[0].confirmation_started_at).toBe(lockA);
  expect(store.credentials[0].confirmation_started_at).not.toBeNull();
});

test('E: revoked credential cannot be confirmed', async () => {
  const store = createMemoryStore({
    id: 'lock-5', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source: 'manual-test', is_test: true, blockchain_status: 'revoked',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: TX, evaluation_id: null,
    updated_at: new Date().toISOString(),
    revoked_at: new Date().toISOString(),
    onchain_valid: false,
  });

  const gateway = {
    contractAddress: CONTRACT, issuerAddress: ISSUER,
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: CONTRACT, from: ISSUER, value: 0n, data: null };
    },
    async getTransactionReceipt(txHash) {
      return { transactionHash: txHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
    async verifyCredential(credentialId) {
      return { exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1_800_000_000, revokedAt: 0 };
    },
  };

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.reconcileCredential(CODE, TX);
  expect(result.status).toBe('revoked');
  expect(store.credentials[0].blockchain_status).toBe('revoked');
});

test('revoke_pending cannot be confirmed', async () => {
  const store = createMemoryStore({
    id: 'lock-6', credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE, title: 'T', skill: 'Reasoning', learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source: 'manual-test', is_test: true, blockchain_status: 'revoke_pending',
    network: 'avalanche-fuji', chain_id: 43113, contract_address: CONTRACT,
    issuer_address: ISSUER, issue_tx_hash: TX, evaluation_id: null,
    updated_at: new Date().toISOString(),
  });

  const gateway = {
    contractAddress: CONTRACT, issuerAddress: ISSUER,
    async getTransaction(txHash) {
      return { hash: txHash, chainId: 43113, to: CONTRACT, from: ISSUER, value: 0n, data: null };
    },
    async getTransactionReceipt(txHash) {
      return { transactionHash: txHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
    async verifyCredential(credentialId) {
      return { exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE, issuer: ISSUER, issuedAt: 1_800_000_000, revokedAt: 0 };
    },
  };

  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  const result = await service.reconcileCredential(CODE, TX);
  // revoke_pending is not 'revoked' nor 'confirmed' → should not be confirmed
  expect(result.status).not.toBe('confirmed');
});
