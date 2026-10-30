import { expect, test } from '@playwright/test';
import {
  AVALANCHE_FUJI_CHAIN_ID,
  assertFujiNetwork,
  credentialIdFromCode,
  normalizeEvidenceHash,
} from '../api/credentials/_avalanche.js';
import { createCredentialService, normalizeCredentialIssueInput } from '../api/credentials/_service.js';
import { createCredentialStore } from '../api/credentials/_store.js';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };
const LEARNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_LEARNER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUBMISSION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVALUATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
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

function createLearningMemoryStore(evaluationOverrides = {}) {
  const sessions = [{ id: SESSION_ID, learner_id: LEARNER_ID, status: 'completed', started_at: '2026-10-28T10:00:00.000Z', completed_at: '2026-10-28T10:05:00.000Z' }];
  const submissions = [{ id: SUBMISSION_ID, session_id: SESSION_ID, learner_id: LEARNER_ID, attempt_number: 2, submission_type: 'revision', analysis_state: 'analyzed' }];
  const evaluations = [{
    id: EVALUATION_ID,
    session_id: SESSION_ID,
    submission_id: SUBMISSION_ID,
    learner_id: LEARNER_ID,
    status: 'pass',
    credential_eligible: true,
    rubric_version: 'paradox-rubric-v1',
    proof_record: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
    ...evaluationOverrides,
  }];
  return {
    sessions, submissions, evaluations,
    async findSession(id, learnerId) { return sessions.find(s => s.id === id && s.learner_id === learnerId) || null; },
    async findSubmission(id, sessionId, learnerId) { return submissions.find(s => s.id === id && s.session_id === sessionId && s.learner_id === learnerId) || null; },
    async findEvaluation(id, learnerId) { return evaluations.find(e => e.id === id && e.learner_id === learnerId) || null; },
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
    async credentialIdForEvidence() { return null; },
    async getTransactionReceipt(transactionHash) {
      return { transactionHash, blockNumber: 123, gasUsed: '100000', status: 1 };
    },
  };
}

function realPayload(overrides = {}) {
  return issuePayload({ source: 'ai-evaluation', isTest: false, credentialCode: 'PXP-SNAPSHOT-0001',
    evaluationId: EVALUATION_ID, evidenceHash: undefined,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) }, ...overrides });
}

test('official snapshot uses server profile and rubric, persists before gateway, and ignores frontend metadata', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  const service = createCredentialService({ store, learningRecordStore: createLearningMemoryStore(), avalancheFactory: async () => {
    expect(store.credentials).toHaveLength(0);
    return gateway;
  } });
  const result = await service.issue(realPayload({ recipientName: 'FORGED', subject: 'FORGED', skill: 'FORGED', snapshot: { recipientName: 'FORGED' }, issuedAt: '2000-01-01', status: 'verified' }), ADMIN);
  expect(result.snapshot).toMatchObject({ recipientName: 'Nguyễn Minh Anh', subject: 'Critical thinking and reasoning', credentialId: result.id, certificateCode: result.code, issuedAt: new Date(1_800_000_000 * 1000).toISOString() });
  expect(result.snapshot.capturedAt).not.toBe(result.snapshot.issuedAt);
  await expect(service.issue(realPayload(), ADMIN)).rejects.toMatchObject({ code: 'DUPLICATE_CREDENTIAL' });
  expect(store.credentials).toHaveLength(1);
});

test('failed official retry reuses captured metadata after profile changes; verification and revocation preserve it', async () => {
  const store = createMemoryStore(); const learning = createLearningMemoryStore();
  const gateway = successfulGateway();
  const service = createCredentialService({ store, learningRecordStore: learning, avalancheFactory: async () => gateway });
  const issue = gateway.issueCredential;
  gateway.issueCredential = async () => { throw new Error('Mock transport failure'); };
  await expect(service.issue(realPayload(), ADMIN)).rejects.toThrow('Mock transport failure');
  const saved = { ...store.credentials[0] };
  store.findLearnerName = async () => { throw new Error('Retry must not read current Profile'); };
  learning.evaluations[0].rubric_version = 'future-rubric';
  gateway.verifyCredential = async () => ({ exists: false });
  gateway.issueCredential = issue;
  const retried = await service.issue(realPayload({ retryFailed: true, recipientName: 'Changed', skill: 'Changed' }), ADMIN);
  expect(retried.snapshot).toMatchObject({ recipientName: saved.recipient_name_snapshot, subject: saved.subject_snapshot, capturedAt: saved.snapshot_captured_at });
  gateway.verifyCredential = async () => ({ exists: true, valid: true, evidenceHash: `0x${'cd'.repeat(32)}`, issuedAt: 1_800_000_000, issuer: gateway.issuerAddress });
  expect((await service.verify(retried.code)).snapshot).toEqual(retried.snapshot);
  expect((await service.revoke(retried.code)).snapshot).toEqual(retried.snapshot);
  expect(store.credentials).toHaveLength(1);
});

test('legacy official credentials remain readable without guessed snapshot but cannot retry issuance', async () => {
  const store = createMemoryStore();
  await store.insertCredential({ credential_code: 'PXP-SNAPSHOT-0001', credential_id_hash: credentialIdFromCode('PXP-SNAPSHOT-0001'), learner_id: LEARNER_ID, evidence_hash: `0x${'cd'.repeat(32)}`, source: 'ai-evaluation', is_test: false, blockchain_status: 'failed' });
  const service = createCredentialService({ store, learningRecordStore: createLearningMemoryStore(), avalancheFactory: async () => { throw new Error('Must not contact chain'); } });
  expect((await service.find('PXP-SNAPSHOT-0001')).snapshot).toBeNull();
  await expect(service.issue(realPayload({ retryFailed: true }), ADMIN)).rejects.toMatchObject({ code: 'CREDENTIAL_SNAPSHOT_MISSING' });
  expect(store.credentials[0].recipient_name_snapshot).toBeUndefined();
});

test('unsupported rubric, missing name, cross-user and demo evidence fail before persistence or chain', async () => {
  for (const variant of ['rubric', 'name', 'cross-user', 'demo']) {
    const store = createMemoryStore(); const learning = createLearningMemoryStore();
    if (variant === 'rubric') learning.evaluations[0].rubric_version = 'unknown';
    if (variant === 'name') store.findLearnerName = async () => null;
    if (variant === 'demo') learning.evaluations[0].proof_record.source = 'demo';
    const service = createCredentialService({ store, learningRecordStore: learning, avalancheFactory: async () => { throw new Error('Must not contact chain'); } });
    const code = { rubric: 'CREDENTIAL_SUBJECT_UNSUPPORTED', name: 'INVALID_RECIPIENT_NAME', 'cross-user': 'LEARNING_EVALUATION_NOT_FOUND', demo: 'MOCK_CREDENTIAL_FORBIDDEN' }[variant];
    await expect(service.issue(realPayload(variant === 'cross-user' ? { learnerId: OTHER_LEARNER_ID } : {}), ADMIN)).rejects.toMatchObject({ code });
    expect(store.credentials).toHaveLength(0);
  }
});

test('credential store reads authoritative target learner and rejects protected PATCH fields before HTTP', async () => {
  const calls = [];
  const store = createCredentialStore({ env: { SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only' }, fetcher: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => url.includes('/auth/') ? { id: LEARNER_ID, user_metadata: { full_name: 'Tên thật' } } : [{}] };
  } });
  expect(await store.findLearnerName(LEARNER_ID)).toBe('Tên thật');
  expect(calls[0].url).toContain(`/auth/v1/admin/users/${LEARNER_ID}`);
  for (const field of ['recipient_name_snapshot', 'subject_snapshot', 'snapshot_version', 'snapshot_captured_at', 'evaluation_id', 'learner_id', 'skill', 'credential_code']) {
    await expect(store.updateCredential('id', { [field]: 'tampered' })).rejects.toMatchObject({ code: 'CREDENTIAL_IMMUTABLE_FIELD' });
  }
  expect(calls).toHaveLength(1);
  await store.updateCredential('id', { blockchain_status: 'confirmed', issued_at: '2026-10-29T00:00:00Z', verification_checked_at: '2026-10-29T00:00:01Z', onchain_valid: true });
  await store.updateCredential('id', { blockchain_status: 'revoked', revoked_at: '2026-10-30T00:00:00Z' });
  expect(calls).toHaveLength(3);
});

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
  failedGateway.issueCredential = async () => {
    throw Object.assign(new Error('Avalanche transaction failed'), { code: 'AVALANCHE_TRANSACTION_FAILED', status: 502 });
  };
  const failedService = createCredentialService({ store: failedStore, avalancheFactory: async () => failedGateway });
  await expect(failedService.issue(issuePayload(), ADMIN)).rejects.toMatchObject({ code: 'AVALANCHE_TRANSACTION_FAILED' });
  expect(failedStore.credentials[0]).toMatchObject({ blockchain_status: 'failed', failure_code: 'AVALANCHE_TRANSACTION_FAILED' });
  expect(failedStore.credentials[0].issue_tx_hash).toBeUndefined();
  expect(failedStore.transactions[0]).toMatchObject({ status: 'failed', error_code: 'AVALANCHE_TRANSACTION_FAILED' });

  const recoveryGateway = successfulGateway();
  recoveryGateway.verifyCredential = async credentialId => ({ exists: false, valid: false, revoked: false, credentialId, evidenceHash: EVIDENCE_HASH, issuer: recoveryGateway.issuerAddress, issuedAt: 0, revokedAt: 0 });
  const recoveryService = createCredentialService({ store: failedStore, avalancheFactory: async () => recoveryGateway });
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

test('ai-evaluation issuance verifies ownership against learning records', async () => {
  const store = createMemoryStore();
  const learningStore = createLearningMemoryStore();
  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway, learningRecordStore: learningStore });

  const credential = await service.issue({
    credentialCode: 'PXP-2026-REAL-0001',
    learnerId: LEARNER_ID,
    title: 'Verified reasoning credential',
    skill: 'Logical reasoning',
    assessmentScore: 90,
    source: 'ai-evaluation',
    isTest: false,
    isMock: false,
    evaluationId: EVALUATION_ID,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  }, ADMIN);

  expect(credential).toMatchObject({ status: 'verified', isTest: false });
  expect(store.credentials[0].learner_id).toBe(LEARNER_ID);
});

test('ai-evaluation issuance rejects evidence from another learner', async () => {
  const store = createMemoryStore();
  const learningStore = createLearningMemoryStore(); // evaluation belongs to LEARNER_ID
  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway, learningRecordStore: learningStore });

  await expect(service.issue({
    credentialCode: 'PXP-2026-REAL-0001',
    learnerId: OTHER_LEARNER_ID, // mismatched
    title: 'Forged credential',
    skill: 'Logical reasoning',
    assessmentScore: 90,
    source: 'ai-evaluation',
    isTest: false,
    evaluationId: EVALUATION_ID,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  }, ADMIN)).rejects.toMatchObject({ code: 'LEARNING_EVALUATION_NOT_FOUND', status: 404 });
});

test('ai-evaluation issuance rejects missing evaluation', async () => {
  const store = createMemoryStore();
  const learningStore = createLearningMemoryStore();
  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway, learningRecordStore: learningStore });

  await expect(service.issue({
    credentialCode: 'PXP-2026-REAL-0001',
    learnerId: LEARNER_ID,
    title: 'Missing eval',
    skill: 'Logical reasoning',
    assessmentScore: 90,
    source: 'ai-evaluation',
    isTest: false,
    evaluationId: '11111111-1111-4111-8111-111111111111',
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  }, ADMIN)).rejects.toMatchObject({ code: 'LEARNING_EVALUATION_NOT_FOUND', status: 404 });
});

test('ai-evaluation issuance rejects forged proofRecord contentHash', async () => {
  const store = createMemoryStore();
  const learningStore = createLearningMemoryStore();
  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway, learningRecordStore: learningStore });

  await expect(service.issue({
    credentialCode: 'PXP-2026-REAL-0001',
    learnerId: LEARNER_ID,
    title: 'Forged proof',
    skill: 'Logical reasoning',
    assessmentScore: 90,
    source: 'ai-evaluation',
    isTest: false,
    evaluationId: EVALUATION_ID,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'ff'.repeat(32) },
  }, ADMIN)).rejects.toMatchObject({ code: 'LEARNING_EVALUATION_PROOF_MISMATCH', status: 409 });
});

test('ai-evaluation issuance rejects mock evaluation evidence', async () => {
  const store = createMemoryStore();
  const learningStore = createLearningMemoryStore({ proof_record: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32), isMock: true } });
  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway, learningRecordStore: learningStore });

  await expect(service.issue({
    credentialCode: 'PXP-2026-REAL-0001',
    learnerId: LEARNER_ID,
    title: 'Mock evidence',
    skill: 'Logical reasoning',
    assessmentScore: 90,
    source: 'ai-evaluation',
    isTest: false,
    evaluationId: EVALUATION_ID,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  }, ADMIN)).rejects.toMatchObject({ code: 'MOCK_CREDENTIAL_FORBIDDEN', status: 400 });
});

test('ai-evaluation issuance requires learning record store', async () => {
  const store = createMemoryStore();
  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway }); // no learningRecordStore

  await expect(service.issue({
    credentialCode: 'PXP-2026-REAL-0001',
    learnerId: LEARNER_ID,
    title: 'No store',
    skill: 'Logical reasoning',
    assessmentScore: 90,
    source: 'ai-evaluation',
    isTest: false,
    evaluationId: EVALUATION_ID,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  }, ADMIN)).rejects.toMatchObject({ code: 'LEARNING_RECORD_STORE_NOT_CONFIGURED', status: 503 });
});

test('ai-evaluation issuance rejects non-passing evaluation', async () => {
  const store = createMemoryStore();
  const learningStore = createLearningMemoryStore({ status: 'needs_improvement', credential_eligible: false });
  const gateway = successfulGateway();
  const service = createCredentialService({ store, avalancheFactory: async () => gateway, learningRecordStore: learningStore });

  await expect(service.issue({
    credentialCode: 'PXP-2026-REAL-0001',
    learnerId: LEARNER_ID,
    title: 'Not passing',
    skill: 'Logical reasoning',
    assessmentScore: 90,
    source: 'ai-evaluation',
    isTest: false,
    evaluationId: EVALUATION_ID,
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', score: 90, contentHash: 'cd'.repeat(32) },
  }, ADMIN)).rejects.toMatchObject({ code: 'LEARNING_EVALUATION_NOT_PASSING', status: 409 });
});
