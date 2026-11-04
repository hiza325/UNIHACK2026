import { test, expect } from '@playwright/test';
import { createCredentialService } from '../api/credentials/_service.js';
import { credentialIdFromCode } from '../api/credentials/_avalanche.js';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVALUATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ISSUER_ADDRESS = '0xA906C19dE177CcDAC0B092560FcDa7296165C396';
const CONTRACT_ADDRESS = '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b';
const EVIDENCE_HASH = `0x${'ab'.repeat(32)}`;
const TX_HASH = `0x${'11'.repeat(32)}`;

function makeGateway(overrides = {}) {
  return {
    chainId: 43113, network: 'avalanche-fuji', contractAddress: CONTRACT_ADDRESS, issuerAddress: ISSUER_ADDRESS,
    readPreflight: async (issuer) => {
      if (issuer !== ISSUER_ADDRESS) throw Object.assign(new Error('not authorized'), { code: 'ISSUER_NOT_AUTHORIZED', status: 403 });
      return { chainId: 43113, contractAddress: CONTRACT_ADDRESS, issuerAddress: issuer, authorized: true };
    },
    isAuthorizedIssuer: async (issuer) => issuer === ISSUER_ADDRESS,
    credentialIdForEvidence: async () => null,
    estimateGas: async () => '21000',
    getTransaction: async () => overrides.tx || { hash: TX_HASH, chainId: 43113, to: CONTRACT_ADDRESS, from: ISSUER_ADDRESS, value: 0n, data: overrides.txData },
    getTransactionReceipt: async () => (overrides.receipt === undefined ? { transactionHash: TX_HASH, blockNumber: 10, gasUsed: '21000', status: 1 } : overrides.receipt),
    verifyCredential: async () => ({ exists: false, valid: false, revoked: false, credentialId: null, evidenceHash: null, issuer: null, issuedAt: 0, revokedAt: 0 }),
  };
}

function createMemoryStore(extra = {}) {
  const credentials = extra.credentials ? [...extra.credentials] : [];
  const transactions = [];
  return {
    credentials,
    transactions,
    async findLearnerName() { return 'Nguyễn Minh Anh'; },
    async findByCode(code) {
      const row = credentials.find(item => item.credential_code === code);
      return row ? { ...row } : null;
    },
    async findByEvaluationId(id) { return null; },
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
    async claimConfirm(id) { return null; },
  };
}

test('prepare-issue resumes legacy is_test=false row with PXP-TEST- code', async () => {
  // Simulate a credential prepared BEFORE the classification fix: DB is_test=false
  // but code starts with PXP-TEST-. Re-prepare must succeed (not throw CREDENTIAL_RETRY_MISMATCH).
  const store = createMemoryStore({
    credentials: [{
      id: 'cred-1',
      credential_code: 'PXP-TEST-2026-0001',
      learner_id: LEARNER_ID,
      credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0001'),
      evidence_hash: EVIDENCE_HASH,
      source: 'ai-evaluation',
      is_test: false, // legacy DB value (pre-fix)
      blockchain_status: 'submitting',
      snapshot_version: 1,
      recipient_name_snapshot: 'Nguyễn Minh Anh',
      subject_snapshot: 'Critical thinking and reasoning',
      snapshot_captured_at: '2026-10-28T10:00:00.000Z',
      evaluation_id: EVALUATION_ID,
      title: 'MOCK TEST Credential',
      skill: 'Critical thinking and reasoning',
      assessment_score: 90,
      network: 'avalanche-fuji',
      chain_id: 43113,
      contract_address: CONTRACT_ADDRESS,
      issuer_address: ISSUER_ADDRESS,
      updated_at: '2026-10-28T10:00:00.000Z',
    }],
  });
  const learningStore = {
    async findEvaluation() {
      return { id: EVALUATION_ID, status: 'pass', credential_eligible: true, proof_record: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: 'ab'.repeat(32), score: 90 }, submission_id: 'sub-1', session_id: 'ses-1' };
    },
    async findSubmission() { return { id: 'sub-1', session_id: 'ses-1' }; },
    async findSession() { return { id: 'ses-1', learner_id: LEARNER_ID }; },
  };
  const service = createCredentialService({ store, avalancheFactory: async () => makeGateway(), learningRecordStore: learningStore });
  const result = await service.prepareIssue({
    credentialCode: 'PXP-TEST-2026-0001',
    learnerId: LEARNER_ID,
    title: 'MOCK TEST Credential',
    source: 'ai-evaluation',
    evaluationId: EVALUATION_ID,
    issuerAddress: ISSUER_ADDRESS,
    assessmentScore: 90,
    evidenceHash: EVIDENCE_HASH,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: 'ab'.repeat(32), score: 90 },
  }, ADMIN);
  expect(result).toBeTruthy();
  expect(result.unsignedTransaction.to).toBe(CONTRACT_ADDRESS);
  expect(result.unsignedTransaction.chainId).toBe(43113);
  expect(result.unsignedTransaction.data).toContain('0x4a0c3459');
  // isTest should be true (derived from code prefix)
  expect(result.credential.isTest).toBe(true);
});

test('prepare-issue rejects when identity fields genuinely mismatch', async () => {
  const store = createMemoryStore({
    credentials: [{
      id: 'cred-2',
      credential_code: 'PXP-TEST-2026-0002',
      learner_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', // different learner
      credential_id_hash: credentialIdFromCode('PXP-TEST-2026-0002'),
      evidence_hash: EVIDENCE_HASH,
      source: 'ai-evaluation',
      is_test: false,
      blockchain_status: 'submitting',
      snapshot_version: 1,
      recipient_name_snapshot: 'Name',
      subject_snapshot: 'Skill',
      snapshot_captured_at: '2026-10-28T10:00:00.000Z',
      evaluation_id: EVALUATION_ID,
      title: 'Test',
      skill: 'Skill',
      assessment_score: 90,
      network: 'avalanche-fuji',
      chain_id: 43113,
      contract_address: CONTRACT_ADDRESS,
      issuer_address: ISSUER_ADDRESS,
      updated_at: '2026-10-28T10:00:00.000Z',
    }],
  });
  const learningStore = {
    async findEvaluation() { return { id: EVALUATION_ID, status: 'pass', credential_eligible: true, proof_record: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: 'ab'.repeat(32), score: 90 }, submission_id: 'sub-1', session_id: 'ses-1' }; },
    async findSubmission() { return { id: 'sub-1', session_id: 'ses-1' }; },
    async findSession() { return { id: 'ses-1', learner_id: LEARNER_ID }; },
  };
  const service = createCredentialService({ store, avalancheFactory: async () => makeGateway(), learningRecordStore: learningStore });
  await expect(service.prepareIssue({
    credentialCode: 'PXP-TEST-2026-0002',
    learnerId: LEARNER_ID, // different learner → mismatch
    title: 'Test',
    source: 'ai-evaluation',
    evaluationId: EVALUATION_ID,
    issuerAddress: ISSUER_ADDRESS,
    assessmentScore: 90,
    evidenceHash: EVIDENCE_HASH,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: 'ab'.repeat(32), score: 90 },
  }, ADMIN)).rejects.toMatchObject({ code: 'CREDENTIAL_RETRY_MISMATCH' });
});