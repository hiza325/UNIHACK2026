import { expect, test } from '@playwright/test';
import { createCredentialService } from '../api/credentials/_service.js';

const ISSUE_TX = `0x${'11'.repeat(32)}`;
const EVIDENCE_HASH = `0x${'ab'.repeat(32)}`;
const EVIDENCE_HASH_2 = `0x${'cd'.repeat(32)}`;
const CODE = 'PXP-DUPREG-0001';
const CODE_2 = 'PXP-DUPREG-0002';
const EVAL_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const EVAL_ID_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
  };
}

function makeLearningStore(evalId) {
  return {
    sessions: [{ id: 's1', learner_id: LEARNER_ID, status: 'completed', started_at: '2026-10-28T10:00:00.000Z', completed_at: '2026-10-28T10:05:00.000Z' }],
    submissions: [{ id: 'sub1', session_id: 's1', learner_id: LEARNER_ID, attempt_number: 1, submission_type: 'initial', analysis_state: 'analyzed' }],
    evaluations: [{
      id: evalId, session_id: 's1', submission_id: 'sub1', learner_id: LEARNER_ID, status: 'pass',
      credential_eligible: true, rubric_version: 'paradox-rubric-v1',
      proof_record: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
    }],
    async findSession(id, learnerId) { return this.sessions.find(s => s.id === id && s.learner_id === learnerId) || null; },
    async findSubmission(id, sessionId, learnerId) { return this.submissions.find(s => s.id === id && s.session_id === sessionId && s.learner_id === learnerId) || null; },
    async findEvaluation(id, learnerId) { return this.evaluations.find(e => e.id === id && e.learner_id === learnerId) || null; },
    async findLearnerName() { return 'Test Learner'; },
  };
}

function successfulGateway() {
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
    async credentialIdForEvidence() { return null; },
    async preflight() { return true; },
    async readPreflight() { return { ok: true }; },
    estimateGas: async () => 100000,
  };
}

function issueInput(evalId, code, evidenceHash) {
  return {
    credentialCode: code, learnerId: LEARNER_ID, title: 'T', skill: 'x', assessmentScore: 90,
    source: 'ai-evaluation', isTest: false, evaluationId: evalId,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  };
}

test('different evaluation_ids are both issuable', async () => {
  const store = createMemoryStore();
  const learningStore = makeLearningStore(EVAL_ID);
  // add second evaluation
  learningStore.evaluations.push({
    id: EVAL_ID_2, session_id: 's1', submission_id: 'sub1', learner_id: LEARNER_ID, status: 'pass',
    credential_eligible: true, rubric_version: 'paradox-rubric-v1',
    proof_record: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  });
  const svc1 = createCredentialService({ store, learningRecordStore: learningStore, avalancheFactory: async () => successfulGateway() });
  const first = await svc1.issue(issueInput(EVAL_ID, CODE, EVIDENCE_HASH), ADMIN);
  expect(first.status).toBe('verified');

  const svc2 = createCredentialService({ store, learningRecordStore: learningStore, avalancheFactory: async () => successfulGateway() });
  const second = await svc2.issue(issueInput(EVAL_ID_2, CODE_2, EVIDENCE_HASH_2), ADMIN);
  expect(second.status).toBe('verified');
  expect(store.credentials.length).toBe(2);
});

test('same evaluation_id is rejected with DUPLICATE_EVALUATION_ISSUANCE', async () => {
  const store = createMemoryStore();
  const learningStore = makeLearningStore(EVAL_ID);
  const svc1 = createCredentialService({ store, learningRecordStore: learningStore, avalancheFactory: async () => successfulGateway() });
  const first = await svc1.issue(issueInput(EVAL_ID, CODE, EVIDENCE_HASH), ADMIN);
  expect(first.status).toBe('verified');

  const svc2 = createCredentialService({ store, learningRecordStore: learningStore, avalancheFactory: async () => successfulGateway() });
  await expect(svc2.issue(issueInput(EVAL_ID, CODE_2, EVIDENCE_HASH_2), ADMIN)).rejects.toMatchObject({
    code: 'DUPLICATE_EVALUATION_ISSUANCE', status: 409,
  });
  expect(store.credentials.length).toBe(1);
});

// Note: true concurrent duplicate prevention is enforced by the DB partial unique index
// (learning_credentials_evaluation_id_ai_unique_idx) and is exercised by the staging
// integration test. The mock store cannot reproduce the DB-level race.

test('manual-test source is not affected by evaluation unique rule', async () => {
  // manual-test credentials have evaluation_id null and source !== 'ai-evaluation',
  // so the partial unique index does not apply. Backend should not throw DUPLICATE_EVALUATION.
  const store = createMemoryStore();
  const svc = createCredentialService({ store, avalancheFactory: async () => successfulGateway() });
  // insert two manual-test credentials with same null evaluation_id directly
  await store.insertCredential({ learner_id: LEARNER_ID, credential_code: CODE, credential_id_hash: `0x${'cd'.repeat(32)}`, evidence_hash: EVIDENCE_HASH, title: 'T', skill: 'Reasoning', source: 'manual-test', is_test: true, blockchain_status: 'submitting', network: 'avalanche-fuji', chain_id: 43113, evaluation_id: null });
  await store.insertCredential({ learner_id: LEARNER_ID, credential_code: CODE_2, credential_id_hash: `0x${'ce'.repeat(32)}`, evidence_hash: EVIDENCE_HASH_2, title: 'T2', skill: 'Reasoning', source: 'manual-test', is_test: true, blockchain_status: 'submitting', network: 'avalanche-fuji', chain_id: 43113, evaluation_id: null });
  expect(store.credentials.length).toBe(2);
});
