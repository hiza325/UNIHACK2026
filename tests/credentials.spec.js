import { expect, test } from '@playwright/test';
import {
  AVALANCHE_FUJI_CHAIN_ID,
  assertFujiNetwork,
  credentialIdFromCode,
  normalizeEvidenceHash,
} from '../api/credentials/_avalanche.js';
import { createCredentialService, normalizeCredentialIssueInput } from '../api/credentials/_service.js';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ISSUE_TX = `0x${'11'.repeat(32)}`;
const REVOKE_TX = `0x${'22'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'ab'.repeat(32)}`;

function issuePayload(overrides = {}) {
  return {
    credentialCode: 'PXP-TEST-2026-0001',
    learnerId: LEARNER_ID,
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
    async findByCode(code) { return credentials.find(item => item.credential_code === code) || null; },
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
  };
}

function successfulGateway() {
  return {
    contractAddress: '0x1111111111111111111111111111111111111111',
    issuerAddress: '0x2222222222222222222222222222222222222222',
    async issueCredential({ credentialId, evidenceHash, onSubmitted }) {
      await onSubmitted(ISSUE_TX);
      return {
        receipt: { transactionHash: ISSUE_TX, blockNumber: 123, gasUsed: '100000', status: 1 },
        credential: { exists: true, valid: true, revoked: false, credentialId, evidenceHash, issuer: this.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 0 },
      };
    },
    async revokeCredential({ credentialId, onSubmitted }) {
      await onSubmitted(REVOKE_TX);
      return {
        receipt: { transactionHash: REVOKE_TX, blockNumber: 124, gasUsed: '50000', status: 1 },
        credential: { exists: true, valid: false, revoked: true, credentialId, evidenceHash: EVIDENCE_HASH, issuer: this.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 1_800_000_100 },
      };
    },
    async verifyCredential(credentialId) {
      return { exists: true, valid: true, revoked: false, credentialId, evidenceHash: EVIDENCE_HASH, issuer: this.issuerAddress, issuedAt: 1_800_000_000, revokedAt: 0 };
    },
  };
}

test('credential input rejects mock and unlabelled test issuance', () => {
  expect(() => normalizeCredentialIssueInput(issuePayload({ source: 'mock' }), ADMIN)).toThrow(/Mock data cannot be issued/);
  expect(() => normalizeCredentialIssueInput(issuePayload({ isTest: false }), ADMIN)).toThrow(/explicitly labelled/);
  expect(() => normalizeCredentialIssueInput(issuePayload({ credentialCode: 'PXP-2026-REAL-0001' }), ADMIN)).toThrow(/PXP-TEST/);

  const normalized = normalizeCredentialIssueInput(issuePayload({ evidenceHash: 'ab'.repeat(32) }), ADMIN);
  expect(normalized).toMatchObject({ source: 'manual-test', isTest: true, evidenceHash: EVIDENCE_HASH });
  expect(normalized.credentialIdHash).toBe(credentialIdFromCode('PXP-TEST-2026-0001'));
});

test('real issuance requires an eligible AI proof record', () => {
  expect(() => normalizeCredentialIssueInput(issuePayload({ credentialCode: 'PXP-2026-REAL-0001', source: 'ai-evaluation', isTest: false }), ADMIN)).toThrow(/AI proof record/);
  const normalized = normalizeCredentialIssueInput(issuePayload({
    credentialCode: 'PXP-2026-REAL-0001', source: 'ai-evaluation', isTest: false, evidenceHash: undefined,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 88, contentHash: 'cd'.repeat(32) },
  }), ADMIN);
  expect(normalized).toMatchObject({ isTest: false, assessmentScore: 90, evidenceHash: `0x${'cd'.repeat(32)}` });
});

test('credential service persists pending and confirmed Fuji transaction state', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });

  const credential = await service.issue(issuePayload(), ADMIN);
  expect(credential).toMatchObject({ status: 'verified', transactionHash: ISSUE_TX, network: 'avalanche-fuji', chainId: Number(AVALANCHE_FUJI_CHAIN_ID), isTest: true });
  expect(credential.verification).toMatchObject({ checked: true, valid: true, source: 'avalanche' });
  expect(store.credentials[0]).toMatchObject({ blockchain_status: 'confirmed', issue_tx_hash: ISSUE_TX, onchain_valid: true });
  expect(store.transactions[0]).toMatchObject({ operation: 'issue', status: 'confirmed', transaction_hash: ISSUE_TX, block_number: 123 });

  const revoked = await service.revoke(credential.code);
  expect(revoked).toMatchObject({ status: 'revoked', transactionHash: REVOKE_TX, revokeTransactionHash: REVOKE_TX });
  expect(store.transactions[1]).toMatchObject({ operation: 'revoke', status: 'confirmed', transaction_hash: REVOKE_TX });
});

test('duplicate credential and failed transaction are recorded safely', async () => {
  const duplicateStore = createMemoryStore();
  await duplicateStore.insertCredential({ credential_code: 'PXP-TEST-2026-0001' });
  const duplicateService = createCredentialService({ store: duplicateStore, avalancheFactory: async () => successfulGateway() });
  await expect(duplicateService.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'DUPLICATE_CREDENTIAL', status: 409 });

  const failedStore = createMemoryStore();
  const failedGateway = successfulGateway();
  failedGateway.issueCredential = async ({ onSubmitted }) => {
    await onSubmitted(ISSUE_TX);
    throw Object.assign(new Error('Avalanche transaction failed'), { code: 'AVALANCHE_TRANSACTION_FAILED', status: 502 });
  };
  const failedService = createCredentialService({ store: failedStore, avalancheFactory: async () => failedGateway });
  await expect(failedService.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_TRANSACTION_FAILED' });
  expect(failedStore.credentials[0]).toMatchObject({ blockchain_status: 'failed', issue_tx_hash: ISSUE_TX, failure_code: 'AVALANCHE_TRANSACTION_FAILED' });
  expect(failedStore.transactions[0]).toMatchObject({ status: 'failed', transaction_hash: ISSUE_TX, error_code: 'AVALANCHE_TRANSACTION_FAILED' });

  const recoveryService = createCredentialService({ store: failedStore, avalancheFactory: async () => successfulGateway() });
  const reconciled = await recoveryService.issue(issuePayload({ retryFailed: true }), ADMIN);
  expect(reconciled).toMatchObject({ status: 'verified', transactionHash: ISSUE_TX });
  expect(failedStore.credentials[0]).toMatchObject({ blockchain_status: 'confirmed', failure_code: null, onchain_valid: true });
});

test('verification detects evidence mismatch and Fuji chain guard rejects Mainnet', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway });
  await service.issue(issuePayload(), ADMIN);
  gateway.verifyCredential = async credentialId => ({ exists: true, valid: true, revoked: false, credentialId, evidenceHash: `0x${'ff'.repeat(32)}`, issuedAt: 1_800_000_000, revokedAt: 0 });
  const credential = await service.verify('PXP-TEST-2026-0001');
  expect(credential).toMatchObject({ status: 'unverified', transactionStatus: 'failed' });
  expect(store.credentials[0]).toMatchObject({ failure_code: 'EVIDENCE_HASH_MISMATCH', onchain_valid: false });

  await expect(assertFujiNetwork({ getNetwork: async () => ({ chainId: 43114n }) })).rejects.toMatchObject({ code: 'AVALANCHE_WRONG_CHAIN', status: 503 });
  await expect(assertFujiNetwork({ getNetwork: async () => ({ chainId: 43113n }) })).resolves.toMatchObject({ chainId: 43113n });
  expect(normalizeEvidenceHash(`sha256:${'12'.repeat(32)}`)).toBe(`0x${'12'.repeat(32)}`);
});
