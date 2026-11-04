import { expect, test } from '@playwright/test';
import { normalizeCredentialIssueInput } from '../api/credentials/_service.js';
import { toPublicCredential } from '../api/credentials/_service.js';
import { hasActualAvalancheVerification } from '../learning-passport-service.js';
import { buildLearningPassport } from '../api/credentials/_service.js';
import { certificateData } from '../certificate-renderer.js';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' };

test('server-side classification marks PXP-TEST- codes as test (ai-evaluation)', () => {
  const input = normalizeCredentialIssueInput({
    credentialCode: 'PXP-TEST-CPP-004',
    learnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'Test',
    source: 'ai-evaluation',
    evaluationId: '11111111-1111-4111-8111-111111111111',
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: 'a'.repeat(64), score: 90 },
    assessmentScore: 90,
  }, ADMIN);
  expect(input.isTest).toBe(true);
});

test('server-side classification marks non-PXP-TEST codes as non-test', () => {
  const input = normalizeCredentialIssueInput({
    credentialCode: 'PXP-2026-ABCD1234-0001',
    learnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'Real',
    source: 'ai-evaluation',
    evaluationId: '11111111-1111-4111-8111-111111111111',
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: 'a'.repeat(64), score: 90 },
    assessmentScore: 90,
  }, ADMIN);
  expect(input.isTest).toBe(false);
});

test('manual-test source still requires PXP-TEST- code', () => {
  expect(() => normalizeCredentialIssueInput({
    credentialCode: 'PXP-2026-ABCD1234-0001',
    learnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'Test',
    skill: 'Skill',
    source: 'manual-test',
    isTest: true,
  }, ADMIN)).toThrow();
});

test('client cannot bypass: isTest flag ignored, code prefix decides', () => {
  // Client sends isTest=true but code does not start with PXP-TEST- → server sets false
  const input = normalizeCredentialIssueInput({
    credentialCode: 'PXP-2026-ABCD1234-0001',
    learnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'Real',
    source: 'ai-evaluation',
    evaluationId: '11111111-1111-4111-8111-111111111111',
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: 'a'.repeat(64), score: 90 },
    assessmentScore: 90,
    isTest: true, // client tries to force test
  }, ADMIN);
  expect(input.isTest).toBe(false);
});

test('client cannot bypass: isTest=false with PXP-TEST- code → still test', () => {
  const input = normalizeCredentialIssueInput({
    credentialCode: 'PXP-TEST-CPP-004',
    learnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'Test',
    source: 'ai-evaluation',
    evaluationId: '11111111-1111-4111-8111-111111111111',
    proofRecord: { schemaVersion: 'paradox-proof-of-learning-v1', evidenceSufficient: true, status: 'pass', contentHash: 'a'.repeat(64), score: 90 },
    assessmentScore: 90,
    isTest: false, // client tries to force official
  }, ADMIN);
  expect(input.isTest).toBe(true);
});

test('toPublicCredential marks PXP-TEST- code as test even if DB is_test is false', () => {
  const row = {
    id: 'row-1',
    credential_code: 'PXP-TEST-CPP-004',
    is_test: false,
    source: 'avalanche',
    status: 'submitting',
    blockchain_status: 'submitting',
    title: 'Test',
    skill: 'Critical thinking and reasoning',
    evidence_hash: '0x' + 'ab'.repeat(32),
    credential_id_hash: '0x' + '11'.repeat(32),
  };
  expect(toPublicCredential(row).isTest).toBe(true);
});

test('toPublicCredential marks non-test code as non-test', () => {
  const row = {
    id: 'row-2',
    credential_code: 'PXP-2026-ABCD1234-0001',
    is_test: false,
    source: 'avalanche',
    status: 'submitting',
    blockchain_status: 'submitting',
    title: 'Real',
    skill: 'Critical thinking and reasoning',
    evidence_hash: '0x' + 'ab'.repeat(32),
    credential_id_hash: '0x' + '11'.repeat(32),
  };
  expect(toPublicCredential(row).isTest).toBe(false);
});

test('buildLearningPassport excludes test credentials from qualifying skills', () => {
  const user = { id: 'u1', name: 'Test', email: 't@e.com' };
  const rows = [
    { id: 'r1', credential_code: 'PXP-TEST-CPP-004', is_test: false, source: 'avalanche', status: 'verified', transactionStatus: 'confirmed', skill: 'Critical thinking and reasoning', assessment_score: 95, issuedAt: '2026-11-04', network: 'avalanche-fuji', chainId: 43113, contractAddress: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b', transactionHash: '0x' + '33'.repeat(32), issueTransactionHash: '0x' + '33'.repeat(32), verification: { source: 'avalanche', checked: true, valid: true, exists: true }, blockchain_status: 'confirmed', onchain_valid: true, verification_checked_at: '2026-11-04T00:00:00Z', snapshot_version: 1, recipient_name_snapshot: 'Name', subject_snapshot: 'Skill', snapshot_captured_at: '2026-11-03T00:00:00Z', evaluation_id: 'e1', issued_at: '2026-11-04T00:00:00Z', evidence_hash: '0x' + 'ab'.repeat(32) },
  ];
  const passport = buildLearningPassport(user, rows);
  expect(passport.skills).toHaveLength(0);
  expect(passport.assessments).toHaveLength(0);
  expect(passport.summary.completedAssessments).toBe(0);
  // credential still listed
  expect(passport.credentials).toHaveLength(1);
  expect(passport.credentials[0].isTest).toBe(true);
});

test('certificate renderer treats TEST credential as non-official (preview, no QR)', () => {
  const record = {
    id: 'r1', code: 'PXP-TEST-CPP-004', source: 'avalanche', isTest: false, // DB says false
    network: 'avalanche-fuji', chainId: 43113, contractAddress: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
    status: 'verified', transactionStatus: 'confirmed', transactionHash: '0x' + '33'.repeat(32),
    issueTransactionHash: '0x' + '33'.repeat(32),
    verification: { source: 'avalanche', checked: true, valid: true, exists: true },
    skill: 'Critical thinking and reasoning', issuedAt: '2026-11-04',
    snapshot: { version: 1, credentialId: 'r1', certificateCode: 'PXP-TEST-CPP-004', recipientName: 'Test', subject: 'Skill', issuedAt: '2026-11-04T00:00:00Z', capturedAt: '2026-11-03T00:00:00Z', evaluationId: 'e1' },
  };
  // toPublicCredential would set isTest=true; simulate by passing isTest:true
  const data = certificateData({ name: 'Current Profile' }, { ...record, isTest: true });
  expect(data.state).toBe('preview');
  expect(data.verified).toBe(false);
  expect(data.canExport).toBe(true); // preview is exportable (with watermark)
});

test('official credential unaffected by classification change', () => {
  const record = {
    id: 'r2', code: 'PXP-2026-REAL-0001', source: 'avalanche', isTest: false,
    network: 'avalanche-fuji', chainId: 43113, contractAddress: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
    status: 'verified', transactionStatus: 'confirmed', transactionHash: '0x' + '44'.repeat(32),
    issueTransactionHash: '0x' + '44'.repeat(32),
    verification: { source: 'avalanche', checked: true, valid: true, exists: true },
    skill: 'Critical thinking and reasoning', issuedAt: '2026-11-04',
    snapshot: { version: 1, credentialId: 'r2', certificateCode: 'PXP-2026-REAL-0001', recipientName: 'Real', subject: 'Real Subject', issuedAt: '2026-11-04T00:00:00Z', capturedAt: '2026-11-03T00:00:00Z', evaluationId: 'e2' },
  };
  const data = certificateData({ name: 'Real User' }, record);
  expect(data.state).toBe('issued');
  expect(data.verified).toBe(true);
  expect(data.metadataIntegrity).toBe('UNVERIFIED'); // no attestation → UNVERIFIED but still exportable
  expect(data.canExport).toBe(true);
});

test('public verify response includes isTest for test credentials', async () => {
  // This is a unit-level check of toPublicCredential which is used by the handler
  const row = {
    id: 'row-1',
    credential_code: 'PXP-TEST-CPP-004',
    is_test: false,
    source: 'avalanche',
    status: 'confirmed',
    blockchain_status: 'confirmed',
    title: 'Test',
    skill: 'Critical thinking and reasoning',
    evidence_hash: '0x' + 'ab'.repeat(32),
    credential_id_hash: '0x' + '11'.repeat(32),
    recipient_name_snapshot: 'Test Name',
    subject_snapshot: 'Test Subject',
    issued_at: '2026-11-04T00:00:00Z',
    snapshot_version: 1,
    snapshot_captured_at: '2026-11-03T00:00:00Z',
    evaluation_id: 'e1',
    transactionHash: '0x' + '33'.repeat(32),
    issueTransactionHash: '0x' + '33'.repeat(32),
    verification_checked_at: '2026-11-04T00:00:00Z',
    onchain_valid: true,
    network: 'avalanche-fuji',
    chainId: 43113,
    contractAddress: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
  };
  const pub = toPublicCredential(row);
  expect(pub.isTest).toBe(true);
});