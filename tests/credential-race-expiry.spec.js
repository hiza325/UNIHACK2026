import { expect, test } from '@playwright/test';
import { createCredentialService } from '../api/credentials/_service.js';

const CODE = 'PXP-RACE-0001';
const TX = `0x${'11'.repeat(32)}`;
const EVIDENCE = `0x${'ab'.repeat(32)}`;
const CONTRACT = '0x1111111111111111111111111111111111111111';
const ISSUER = '0x2222222222222222222222222222222222222222';
const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };

test('expired confirmation must not overwrite a newer confirmed result', async () => {
  const row = {
    id: 'race-credential',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE,
    title: 'Race condition test',
    skill: 'Reasoning',
    learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'submitting',
    network: 'avalanche-fuji',
    chain_id: 43113,
    contract_address: CONTRACT,
    issuer_address: ISSUER,
    issue_tx_hash: TX,
    onchain_valid: false,
    confirmation_started_at: null,
    confirmation_attempts: 0,
    evaluation_id: null,
  };

  let releaseA;
  let notifyA;
  const aStarted = new Promise(resolve => { notifyA = resolve; });
  const aReleased = new Promise(resolve => { releaseA = resolve; });
  let calls = 0;

  const store = {
    async findByCode(code) {
      return code === CODE ? { ...row } : null;
    },
    async claimConfirm(id) {
      if (id !== row.id) return null;
      if (!['submitting', 'pending'].includes(row.blockchain_status)) return null;
      if (row.confirmation_started_at &&
          Date.now() - Date.parse(row.confirmation_started_at) < 60000) return null;
      row.confirmation_started_at = new Date().toISOString();
      return { ...row };
    },
    async updateCredential(id, patch) {
      if (id !== row.id) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async updateCredentialIf(id, patch, claimedAt) {
      if (id !== row.id || !['submitting', 'pending'].includes(row.blockchain_status) || !claimedAt || row.confirmation_started_at !== claimedAt) return null;
      Object.assign(row, patch);
      return { ...row };
    },
  };

  const gateway = {
    contractAddress: CONTRACT,
    issuerAddress: ISSUER,
    async getTransaction() {
      calls++;
      if (calls === 1) {
        notifyA();
        await aReleased;
        throw Object.assign(new Error('RPC timeout'), { code: 'NETWORK_ERROR' });
      }
      return {
        hash: TX, chainId: 43113, to: CONTRACT, from: ISSUER,
        value: 0n,
        data: (await import('../api/credentials/_avalanche.js'))
          .encodeIssueCredential(row.credential_id_hash, row.evidence_hash),
      };
    },
    async getTransactionReceipt() {
      return { transactionHash: TX, status: 1, blockNumber: 123 };
    },
    async verifyCredential() {
      return {
        exists: true, valid: true, revoked: false,
        evidenceHash: EVIDENCE, issuer: ISSUER,
        issuedAt: 1800000000, revokedAt: 0,
      };
    },
  };

  const service = createCredentialService({
    store,
    avalancheFactory: async () => gateway,
  });

  const requestA = service.confirmIssue(
    { credentialCode: CODE, txHash: TX }, ADMIN
  );

  await aStarted;

  // Simulate expiration of A's confirmation lock.
  row.confirmation_started_at = new Date(Date.now() - 61000).toISOString();

  const resultB = await service.confirmIssue(
    { credentialCode: CODE, txHash: TX }, ADMIN
  );

  expect(resultB.status).toBe('confirmed');

  // A resumes after B has already confirmed the credential.
  releaseA();
  const resultA = await requestA;
  expect(resultA.status).toBe('confirmed');

  // Expected invariant: stale A must not overwrite B.
  expect(row.blockchain_status).toBe('confirmed');
});

test('stale transaction validation error must not override confirmed', async () => {
  const row = {
    id: 'race-credential',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE,
    title: 'Race condition test',
    skill: 'Reasoning',
    learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'submitting',
    network: 'avalanche-fuji',
    chain_id: 43113,
    contract_address: CONTRACT,
    issuer_address: ISSUER,
    issue_tx_hash: TX,
    onchain_valid: false,
    confirmation_started_at: null,
    confirmation_attempts: 0,
    evaluation_id: null,
  };

  let releaseA;
  let notifyA;
  const aStarted = new Promise(resolve => { notifyA = resolve; });
  const aReleased = new Promise(resolve => { releaseA = resolve; });
  let calls = 0;

  const store = {
    async findByCode(code) {
      return code === CODE ? { ...row } : null;
    },
    async claimConfirm(id) {
      if (id !== row.id) return null;
      if (!['submitting', 'pending'].includes(row.blockchain_status)) return null;
      if (row.confirmation_started_at &&
          Date.now() - Date.parse(row.confirmation_started_at) < 60000) return null;
      row.confirmation_started_at = new Date().toISOString();
      return { ...row };
    },
    async updateCredential(id, patch) {
      if (id !== row.id) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async updateCredentialIf(id, patch, claimedAt) {
      if (id !== row.id || !['submitting', 'pending'].includes(row.blockchain_status) || !claimedAt || row.confirmation_started_at !== claimedAt) return null;
      Object.assign(row, patch);
      return { ...row };
    },
  };

  const gateway = {
    contractAddress: CONTRACT,
    issuerAddress: ISSUER,
    async getTransaction() {
      calls++;
      if (calls === 1) {
        notifyA();
        await aReleased;
        return {
          hash: TX, chainId: 1, to: CONTRACT, from: ISSUER,
          value: 0n,
          data: (await import('../api/credentials/_avalanche.js'))
            .encodeIssueCredential(row.credential_id_hash, row.evidence_hash),
        };
      }
      return {
        hash: TX, chainId: 43113, to: CONTRACT, from: ISSUER,
        value: 0n,
        data: (await import('../api/credentials/_avalanche.js'))
          .encodeIssueCredential(row.credential_id_hash, row.evidence_hash),
      };
    },
    async getTransactionReceipt() {
      return { transactionHash: TX, status: 1, blockNumber: 123 };
    },
    async verifyCredential() {
      return {
        exists: true, valid: true, revoked: false,
        evidenceHash: EVIDENCE, issuer: ISSUER,
        issuedAt: 1800000000, revokedAt: 0,
      };
    },
  };

  const service = createCredentialService({
    store,
    avalancheFactory: async () => gateway,
  });

  const requestA = service.confirmIssue(
    { credentialCode: CODE, txHash: TX }, ADMIN
  );

  await aStarted;

  // Simulate expiration of A's confirmation lock.
  row.confirmation_started_at = new Date(Date.now() - 61000).toISOString();

  const resultB = await service.confirmIssue(
    { credentialCode: CODE, txHash: TX }, ADMIN
  );

  expect(resultB.status).toBe('confirmed');

  // A resumes after B has already confirmed the credential.
  releaseA();
  const resultA = await requestA;
  expect(resultA.status).toBe('confirmed');

  // Expected invariant: stale A must not overwrite B.
  expect(row.blockchain_status).toBe('confirmed');
});

test('stale reverted receipt must not override confirmed', async () => {
  const row = {
    id: 'race-credential',
    credential_code: CODE,
    credential_id_hash: `0x${'cd'.repeat(32)}`,
    evidence_hash: EVIDENCE,
    title: 'Race condition test',
    skill: 'Reasoning',
    learner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    source: 'manual-test',
    is_test: true,
    blockchain_status: 'submitting',
    network: 'avalanche-fuji',
    chain_id: 43113,
    contract_address: CONTRACT,
    issuer_address: ISSUER,
    issue_tx_hash: TX,
    onchain_valid: false,
    confirmation_started_at: null,
    confirmation_attempts: 0,
    evaluation_id: null,
  };

  let releaseA;
  let notifyA;
  const aStarted = new Promise(resolve => { notifyA = resolve; });
  const aReleased = new Promise(resolve => { releaseA = resolve; });
  let calls = 0;
  let receiptCalls = 0;

  const store = {
    async findByCode(code) {
      return code === CODE ? { ...row } : null;
    },
    async claimConfirm(id) {
      if (id !== row.id) return null;
      if (!['submitting', 'pending'].includes(row.blockchain_status)) return null;
      if (row.confirmation_started_at &&
          Date.now() - Date.parse(row.confirmation_started_at) < 60000) return null;
      row.confirmation_started_at = new Date().toISOString();
      return { ...row };
    },
    async updateCredential(id, patch) {
      if (id !== row.id) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async updateCredentialIf(id, patch, claimedAt) {
      if (id !== row.id || !['submitting', 'pending'].includes(row.blockchain_status) || !claimedAt || row.confirmation_started_at !== claimedAt) return null;
      Object.assign(row, patch);
      return { ...row };
    },
  };

  const gateway = {
    contractAddress: CONTRACT,
    issuerAddress: ISSUER,
    async getTransaction() {
      calls++;
      if (calls === 1) {
        notifyA();
        await aReleased;
        return {
          hash: TX, chainId: 43113, to: CONTRACT, from: ISSUER,
          value: 0n,
          data: (await import('../api/credentials/_avalanche.js'))
            .encodeIssueCredential(row.credential_id_hash, row.evidence_hash),
        };
      }
      return {
        hash: TX, chainId: 43113, to: CONTRACT, from: ISSUER,
        value: 0n,
        data: (await import('../api/credentials/_avalanche.js'))
          .encodeIssueCredential(row.credential_id_hash, row.evidence_hash),
      };
    },
    async getTransactionReceipt() {
      receiptCalls++;
      return { transactionHash: TX, status: receiptCalls === 1 ? 1 : 0, blockNumber: 123 };
    },
    async verifyCredential() {
      return {
        exists: true, valid: true, revoked: false,
        evidenceHash: EVIDENCE, issuer: ISSUER,
        issuedAt: 1800000000, revokedAt: 0,
      };
    },
  };

  const service = createCredentialService({
    store,
    avalancheFactory: async () => gateway,
  });

  const requestA = service.confirmIssue(
    { credentialCode: CODE, txHash: TX }, ADMIN
  );

  await aStarted;

  // Simulate expiration of A's confirmation lock.
  row.confirmation_started_at = new Date(Date.now() - 61000).toISOString();

  const resultB = await service.confirmIssue(
    { credentialCode: CODE, txHash: TX }, ADMIN
  );

  expect(resultB.status).toBe('confirmed');

  // A resumes after B has already confirmed the credential.
  releaseA();
  const resultA = await requestA;
  expect(resultA.status).toBe('confirmed');

  // Expected invariant: stale A must not overwrite B.
  expect(row.blockchain_status).toBe('confirmed');
});
