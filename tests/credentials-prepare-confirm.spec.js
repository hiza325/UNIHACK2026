import { test, expect } from '@playwright/test';
import { createCredentialService } from '../api/credentials/_service.js';
import { credentialIdFromCode, encodeIssueCredential } from '../api/credentials/_avalanche.js';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUBMISSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVALUATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ISSUER_ADDRESS = '0xA906C19dE177CcDAC0B092560FcDa7296165C396';
const CONTRACT_ADDRESS = '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b';
const EVIDENCE_HASH = `0x${'ab'.repeat(32)}`;
const TX_HASH = `0x${'11'.repeat(32)}`;

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
    async insertTransaction(record) { const row = { id: transactions.length + 1, ...record }; transactions.push(row); return { ...row }; },
    async updateTransaction(id, patch) { const row = transactions.find(item => item.id === id); Object.assign(row, patch); return { ...row }; },
  };
}

function createLearningRecordStore() {
  const evaluation = {
    id: EVALUATION_ID, session_id: SESSION_ID, submission_id: SUBMISSION_ID, learner_id: LEARNER_ID,
    rubric_version: 'paradox-rubric-v1', score: 92, status: 'pass', comment: 'Good', criteria: {},
    corrected_issues: [], remaining_issues: [],
    proof_record: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: EVIDENCE_HASH.slice(2), score: 92, rubricVersion: 'paradox-rubric-v1' },
    credential_eligible: true, credential_status: 'eligible',
  };
  const submission = { id: SUBMISSION_ID, session_id: SESSION_ID, learner_id: LEARNER_ID, solution_text: 'solution', analysis_state: 'analyzed', ai_analysis: { status: 'correct', evaluation: { status: 'pass', evidenceSufficient: true, score: 92 } } };
  const session = { id: SESSION_ID, learner_id: LEARNER_ID, status: 'completed', problem_text: 'problem', started_at: new Date().toISOString(), completed_at: new Date().toISOString() };
  return {
    async findEvaluation(id, learnerId) { return id === EVALUATION_ID && learnerId === LEARNER_ID ? { ...evaluation } : null; },
    async findSubmission(id, sessionId, learnerId) { return id === SUBMISSION_ID ? { ...submission } : null; },
    async findSession(id, learnerId) { return id === SESSION_ID ? { ...session } : null; },
  };
}

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
    verifyCredential: async () => ({ exists: true, valid: true, revoked: false, evidenceHash: EVIDENCE_HASH, issuer: ISSUER_ADDRESS, issuedAt: 1700000000 }),
  };
}

test('prepare-issue rejects an ineligible database evaluation even without client proofRecord', async () => {
  const store = createMemoryStore();
  const ineligibleStore = createLearningRecordStore();
  const originalFind = ineligibleStore.findEvaluation.bind(ineligibleStore);
  ineligibleStore.findEvaluation = async (id, learnerId) => {
    const row = await originalFind(id, learnerId);
    return row ? { ...row, credential_eligible: false, proof_record: row.proof_record } : null;
  };
  const service = createCredentialService({ store, avalancheFactory: async () => makeGateway(), learningRecordStore: ineligibleStore });
  const body = { credentialCode: 'PXP-TEST-2026-0010', learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: ISSUER_ADDRESS };
  await expect(service.prepareIssue(body, ADMIN)).rejects.toMatchObject({ code: 'LEARNING_EVALUATION_NOT_ELIGIBLE', status: 409 });
});

test('prepare-issue creates submitting credential without client proofRecord', async () => {
  const store = createMemoryStore();
  const service = createCredentialService({ store, avalancheFactory: async () => makeGateway(), learningRecordStore: createLearningRecordStore() });
  const body = { credentialCode: 'PXP-TEST-2026-0009', learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: ISSUER_ADDRESS };
  const result = await service.prepareIssue(body, ADMIN);
  expect(result.unsignedTransaction.to).toBe(CONTRACT_ADDRESS);
  expect(store.credentials[0].blockchain_status).toBe('submitting');
  expect(result.credential.status).toBe('pending');
});

test('prepare-issue creates submitting credential and unsigned tx', async () => {
  const store = createMemoryStore();
  const service = createCredentialService({ store, avalancheFactory: async () => makeGateway(), learningRecordStore: createLearningRecordStore() });
  const body = { credentialCode: 'PXP-TEST-2026-0001', learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: ISSUER_ADDRESS, proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: EVIDENCE_HASH.slice(2), score: 92, rubricVersion: 'paradox-rubric-v1' } };
  const result = await service.prepareIssue(body, ADMIN);
  expect(result.unsignedTransaction.to).toBe(CONTRACT_ADDRESS);
  expect(result.unsignedTransaction.chainId).toBe(43113);
  expect(result.unsignedTransaction.issuerAddress).toBe(ISSUER_ADDRESS);
  expect(store.credentials[0].blockchain_status).toBe('submitting');
  expect(result.credential.status).toBe('pending');
});

test('prepare-issue rejects unauthorized issuer', async () => {
  const store = createMemoryStore();
  const service = createCredentialService({ store, avalancheFactory: async () => makeGateway(), learningRecordStore: createLearningRecordStore() });
  const body = { credentialCode: 'PXP-TEST-2026-0002', learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: '0x0000000000000000000000000000000000000000', proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: EVIDENCE_HASH.slice(2), score: 92, rubricVersion: 'paradox-rubric-v1' } };
  await expect(service.prepareIssue(body, ADMIN)).rejects.toMatchObject({ code: 'ISSUER_NOT_AUTHORIZED', status: 403 });
});

test('prepare-issue does not create a duplicate row for an existing prepared credential', async () => {
  const store = createMemoryStore();
  const service = createCredentialService({ store, avalancheFactory: async () => makeGateway(), learningRecordStore: createLearningRecordStore() });
  const body = { credentialCode: 'PXP-TEST-2026-0003', learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: ISSUER_ADDRESS, proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: EVIDENCE_HASH.slice(2), score: 92, rubricVersion: 'paradox-rubric-v1' } };
  const first = await service.prepareIssue(body, ADMIN);
  const second = await service.prepareIssue(body, ADMIN);
  expect(store.credentials).toHaveLength(1);
  expect(second.credential.code).toBe(first.credential.code);
});

test('confirm-issue confirms when tx and on-chain match', async () => {
  const code = 'PXP-TEST-2026-0004';
  const expectedData = encodeIssueCredential(credentialIdFromCode(code), EVIDENCE_HASH);
  const store = createMemoryStore();
  const gw = makeGateway({ txData: expectedData });
  const service = createCredentialService({ store, avalancheFactory: async () => gw, learningRecordStore: createLearningRecordStore() });
  const body = { credentialCode: code, learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: ISSUER_ADDRESS, proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: EVIDENCE_HASH.slice(2), score: 92, rubricVersion: 'paradox-rubric-v1' } };
  await service.prepareIssue(body, ADMIN);
  const result = await service.confirmIssue({ credentialCode: code, txHash: TX_HASH }, ADMIN);
  expect(result.status).toBe('confirmed');
  expect(result.credential.transactionHash).toBe(TX_HASH);
  const row = store.credentials.find(c => c.credential_code === code);
  expect(row.blockchain_status).toBe('confirmed');
  expect(row.onchain_valid).toBe(true);
});

test('confirm-issue returns pending when receipt not available', async () => {
  const code = 'PXP-TEST-2026-0005';
  const expectedData = encodeIssueCredential(credentialIdFromCode(code), EVIDENCE_HASH);
  const store = createMemoryStore();
  const gw = makeGateway({ receipt: null, txData: expectedData });
  const service = createCredentialService({ store, avalancheFactory: async () => gw, learningRecordStore: createLearningRecordStore() });
  const body = { credentialCode: code, learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: ISSUER_ADDRESS, proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: EVIDENCE_HASH.slice(2), score: 92, rubricVersion: 'paradox-rubric-v1' } };
  await service.prepareIssue(body, ADMIN);
  const result = await service.confirmIssue({ credentialCode: code, txHash: TX_HASH }, ADMIN);
  expect(result.status).toBe('pending');
  const row = store.credentials.find(c => c.credential_code === code);
  expect(row.blockchain_status).toBe('pending');
});

test('confirm-issue is idempotent for already confirmed credential', async () => {
  const code = 'PXP-TEST-2026-0006';
  const expectedData = encodeIssueCredential(credentialIdFromCode(code), EVIDENCE_HASH);
  const store = createMemoryStore();
  const gw = makeGateway({ txData: expectedData });
  const service = createCredentialService({ store, avalancheFactory: async () => gw, learningRecordStore: createLearningRecordStore() });
  const body = { credentialCode: code, learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: ISSUER_ADDRESS, proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: EVIDENCE_HASH.slice(2), score: 92, rubricVersion: 'paradox-rubric-v1' } };
  await service.prepareIssue(body, ADMIN);
  await service.confirmIssue({ credentialCode: code, txHash: TX_HASH }, ADMIN);
  const second = await service.confirmIssue({ credentialCode: code, txHash: TX_HASH }, ADMIN);
  expect(second.alreadyConfirmed).toBe(true);
});

test('confirm-issue rejects wrong sender', async () => {
  const code = 'PXP-TEST-2026-0007';
  const expectedData = encodeIssueCredential(credentialIdFromCode(code), EVIDENCE_HASH);
  const store = createMemoryStore();
  const gw = makeGateway({ tx: { hash: TX_HASH, chainId: 43113, to: CONTRACT_ADDRESS, from: '0x0000000000000000000000000000000000000000', value: 0n, data: expectedData }, txData: expectedData });
  const service = createCredentialService({ store, avalancheFactory: async () => gw, learningRecordStore: createLearningRecordStore() });
  const body = { credentialCode: code, learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: ISSUER_ADDRESS, proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: EVIDENCE_HASH.slice(2), score: 92, rubricVersion: 'paradox-rubric-v1' } };
  await service.prepareIssue(body, ADMIN);
  await expect(service.confirmIssue({ credentialCode: code, txHash: TX_HASH }, ADMIN)).rejects.toMatchObject({ code: 'INVALID_TRANSACTION_SENDER', status: 409 });
});

test('confirm-issue rejects wrong calldata', async () => {
  const code = 'PXP-TEST-2026-0008';
  const store = createMemoryStore();
  const gw = makeGateway({ txData: '0xdeadbeef' });
  const service = createCredentialService({ store, avalancheFactory: async () => gw, learningRecordStore: createLearningRecordStore() });
  const body = { credentialCode: code, learnerId: LEARNER_ID, evaluationId: EVALUATION_ID, title: 'Test Cert', source: 'ai-evaluation', issuerAddress: ISSUER_ADDRESS, proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: EVIDENCE_HASH.slice(2), score: 92, rubricVersion: 'paradox-rubric-v1' } };
  await service.prepareIssue(body, ADMIN);
  await expect(service.confirmIssue({ credentialCode: code, txHash: TX_HASH }, ADMIN)).rejects.toMatchObject({ code: 'INVALID_TRANSACTION_CALLDATA', status: 409 });
});


