import { AVALANCHE_FUJI_CHAIN_ID, AVALANCHE_FUJI_NETWORK, createAvalancheGateway, credentialIdFromCode, normalizeEvidenceHash } from './_avalanche.js';
import { AVALANCHE_FUJI_CONFIG } from '../../avalanche-config.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL_CODE = /^PXP-[A-Z0-9-]{4,76}$/;

function credentialError(message, code, status, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

function text(value, max, field) {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw credentialError(`${field} is required`, `INVALID_${field.toUpperCase().replace(/\s+/g, '_')}`, 400);
  return result;
}

export function normalizeCredentialIssueInput(body = {}, actor = {}) {
  if (body.isMock === true || body.source === 'mock' || body.proofRecord?.isMock === true) {
    throw credentialError('Mock data cannot be issued as an on-chain credential', 'MOCK_CREDENTIAL_FORBIDDEN', 400);
  }
  const credentialCode = String(body.credentialCode || '').trim().toUpperCase();
  if (!CREDENTIAL_CODE.test(credentialCode)) throw credentialError('Invalid credential code', 'INVALID_CREDENTIAL_CODE', 400);
  const learnerId = String(body.learnerId || '').trim();
  if (!UUID.test(learnerId)) throw credentialError('A valid learner ID is required', 'INVALID_LEARNER_ID', 400);
  const evaluationId = String(body.evaluationId || '').trim();
  const source = String(body.source || '');
  if (!['ai-evaluation', 'manual-test'].includes(source)) throw credentialError('Credential source is not allowed', 'INVALID_CREDENTIAL_SOURCE', 400);

  const isTest = source === 'manual-test';
  if (isTest && (body.isTest !== true || !credentialCode.startsWith('PXP-TEST-'))) {
    throw credentialError('Test credentials must be explicitly labelled and use a PXP-TEST code', 'TEST_CREDENTIAL_LABEL_REQUIRED', 400);
  }
  if (!isTest) {
    const proof = body.proofRecord;
    if (proof?.schemaVersion !== 'paradox-proof-of-learning-v1' || proof.evidenceSufficient !== true || proof.status !== 'pass') {
      throw credentialError('A passing, evidence-sufficient AI proof record is required', 'AI_PROOF_NOT_ELIGIBLE', 400);
    }
  }

  const score = body.assessmentScore ?? body.proofRecord?.score ?? null;
  if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) {
    throw credentialError('Assessment score must be an integer from 0 to 100', 'INVALID_ASSESSMENT_SCORE', 400);
  }
  if (!UUID.test(String(actor.id || ''))) throw credentialError('Authenticated administrator ID is invalid', 'INVALID_ACTOR_ID', 400);

  return {
    learnerId,
    evaluationId: evaluationId || null,
    credentialCode,
    credentialIdHash: credentialIdFromCode(credentialCode),
    evidenceHash: normalizeEvidenceHash(body.evidenceHash || body.proofRecord?.contentHash),
    proofRecord: body.proofRecord && typeof body.proofRecord === 'object' ? body.proofRecord : null,
    title: text(body.title, 160, 'title'),
    skill: text(body.skill, 120, 'skill'),
    assessmentScore: score,
    source,
    isTest,
    createdBy: actor.id,
  };
}

function isoFromUnix(value) {
  return value ? new Date(Number(value) * 1000).toISOString() : null;
}

function safeFailure(error) {
  return {
    failure_code: String(error?.code || 'CREDENTIAL_OPERATION_FAILED').slice(0, 100),
    failure_message: String(error?.message || 'Credential operation failed').slice(0, 300),
  };
}

export function toPublicCredential(row) {
  const revoked = row.blockchain_status === 'revoked';
  const pending = ['submitting', 'pending', 'revoke_pending'].includes(row.blockchain_status);
  const verified = row.blockchain_status === 'confirmed' && row.onchain_valid === true && Boolean(row.verification_checked_at);
  const status = revoked ? 'revoked' : pending ? 'pending' : verified ? 'verified' : 'unverified';
  const transactionHash = row.revoke_tx_hash || row.issue_tx_hash || null;
  return {
    id: row.id,
    code: row.credential_code,
    name: row.title,
    skill: row.skill,
    issuedAt: row.issued_at ? String(row.issued_at).slice(0, 10) : null,
    revokedAt: row.revoked_at || null,
    issuer: row.issuer_address || null,
    assessmentScore: row.assessment_score,
    status,
    source: 'avalanche',
    isTest: Boolean(row.is_test),
    evidenceHash: row.evidence_hash ? `sha256:${String(row.evidence_hash).replace(/^0x/, '')}` : null,
    transactionHash,
    issueTransactionHash: row.issue_tx_hash || null,
    revokeTransactionHash: row.revoke_tx_hash || null,
    network: AVALANCHE_FUJI_NETWORK,
    chainId: Number(AVALANCHE_FUJI_CHAIN_ID),
    contractAddress: row.contract_address || AVALANCHE_FUJI_CONFIG.contractAddress,
    transactionStatus: row.blockchain_status,
    verification: {
      checked: Boolean(row.verification_checked_at),
      valid: verified,
      exists: verified || revoked ? true : null,
      source: row.verification_checked_at ? 'avalanche' : null,
      checkedAt: row.verification_checked_at || null,
    },
  };
}

export function buildLearningPassport(user, rows) {
  const credentials = rows.map(toPublicCredential);
  const qualifying = credentials.filter(item => !item.isTest && item.status === 'verified');
  const skillMap = new Map();
  for (const credential of qualifying) {
    const values = skillMap.get(credential.skill) || [];
    if (Number.isFinite(credential.assessmentScore)) values.push(credential.assessmentScore);
    skillMap.set(credential.skill, values);
  }
  const skills = [...skillMap].map(([name, scores], index) => ({
    id: `avalanche-skill-${index + 1}`,
    name,
    description: 'Verified from an issued Proof of Learning credential.',
    score: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
    progress: 100,
    achieved: true,
    evidenceCount: scores.length || 1,
    lastAssessedAt: qualifying.find(item => item.skill === name)?.issuedAt || null,
    source: 'avalanche',
  }));
  const scored = qualifying.map(item => item.assessmentScore).filter(Number.isFinite);
  return {
    schemaVersion: 'paradox-learning-passport-v1',
    passportId: `PLP-${String(user.id).replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    source: { type: 'avalanche', isReal: true, label: 'AVALANCHE FUJI TESTNET', network: AVALANCHE_FUJI_NETWORK, chainId: Number(AVALANCHE_FUJI_CHAIN_ID), contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress },
    learner: { id: user.id, displayName: user.name, email: user.email, level: 'Proof of Learning', cohort: 'Avalanche Fuji' },
    summary: {
      overallScore: scored.length ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length) : null,
      progress: qualifying.length ? 100 : null,
      completedAssessments: qualifying.length,
      learningHours: null,
    },
    skills,
    assessments: qualifying.map(item => ({ id: item.id, name: item.name, skill: item.skill, score: item.assessmentScore, completedAt: item.issuedAt, evaluationStatus: 'pass', source: 'avalanche' })),
    credentials,
  };
}

export function createCredentialService({ store, avalancheFactory = createAvalancheGateway, learningRecordStore = null } = {}) {
  if (!store) throw new TypeError('Credential store is required');

  async function verifyAiEvidence(input, learnerId) {
    if (!learningRecordStore) throw credentialError('Learning record store is not configured', 'LEARNING_RECORD_STORE_NOT_CONFIGURED', 503);
    const evaluationId = String(input.evaluationId || '').trim();
    if (!UUID.test(evaluationId)) throw credentialError('A valid learning evaluation ID is required', 'INVALID_LEARNING_EVALUATION_ID', 400);
    const evaluation = await learningRecordStore.findEvaluation(evaluationId, learnerId);
    if (!evaluation) throw credentialError('Learning evaluation was not found', 'LEARNING_EVALUATION_NOT_FOUND', 404);
    if (evaluation.status !== 'pass') throw credentialError('Learning evaluation did not pass', 'LEARNING_EVALUATION_NOT_PASSING', 409);
    if (evaluation.credential_eligible !== true) throw credentialError('Learning evaluation is not credential eligible', 'LEARNING_EVALUATION_NOT_ELIGIBLE', 409);

    const submission = await learningRecordStore.findSubmission(evaluation.submission_id, evaluation.session_id, learnerId);
    if (!submission) throw credentialError('Learning submission was not found', 'LEARNING_SUBMISSION_NOT_FOUND', 404);
    const session = await learningRecordStore.findSession(evaluation.session_id, learnerId);
    if (!session || String(session.learner_id).toLowerCase() !== String(learnerId).toLowerCase()) {
      throw credentialError('Learning session does not belong to this learner', 'LEARNING_SESSION_OWNERSHIP_MISMATCH', 403);
    }

    const dbProof = evaluation.proof_record;
    if (!dbProof || typeof dbProof !== 'object') throw credentialError('Learning evaluation has no proof record', 'LEARNING_EVALUATION_PROOF_MISSING', 409);
    if (dbProof.isMock === true || dbProof.source === 'mock') throw credentialError('Mock evidence cannot be issued', 'MOCK_CREDENTIAL_FORBIDDEN', 400);
    if (dbProof.schemaVersion !== 'paradox-proof-of-learning-v1' || dbProof.evidenceSufficient !== true || dbProof.status !== 'pass') {
      throw credentialError('Learning evaluation proof is not eligible', 'LEARNING_EVALUATION_PROOF_INELIGIBLE', 409);
    }
    const requestProof = input.proofRecord;
    if (requestProof && typeof requestProof === 'object') {
      if (requestProof.contentHash && String(requestProof.contentHash).toLowerCase() !== String(dbProof.contentHash).toLowerCase()) {
        throw credentialError('Proof record does not match the stored evaluation', 'LEARNING_EVALUATION_PROOF_MISMATCH', 409);
      }
      if (requestProof.score !== undefined && Number(requestProof.score) !== Number(dbProof.score)) {
        throw credentialError('Proof record does not match the stored evaluation', 'LEARNING_EVALUATION_PROOF_MISMATCH', 409);
      }
    }

    return {
      evidenceHash: normalizeEvidenceHash(dbProof.contentHash),
      assessmentScore: Number.isFinite(dbProof.score) ? Math.max(0, Math.min(100, Math.round(dbProof.score))) : input.assessmentScore,
    };
  }

  async function issue(body, actor) {
    const input = normalizeCredentialIssueInput(body, actor);
    if (input.source === 'ai-evaluation') {
      const verified = await verifyAiEvidence(input, input.learnerId);
      input.evidenceHash = verified.evidenceHash;
      input.assessmentScore = verified.assessmentScore;
    }
    const existing = await store.findByCode(input.credentialCode);
    if (existing && (body.retryFailed !== true || existing.blockchain_status !== 'failed')) {
      throw credentialError('Credential code already exists', 'DUPLICATE_CREDENTIAL', 409);
    }
    if (existing && (
      existing.learner_id !== input.learnerId
      || String(existing.credential_id_hash).toLowerCase() !== input.credentialIdHash.toLowerCase()
      || String(existing.evidence_hash).toLowerCase() !== input.evidenceHash.toLowerCase()
      || existing.source !== input.source
      || Boolean(existing.is_test) !== input.isTest
    )) {
      throw credentialError('Failed credential retry does not match the original record', 'CREDENTIAL_RETRY_MISMATCH', 409);
    }

    let credential = existing;
    let transaction;
    try {
      if (!credential) {
        credential = await store.insertCredential({
          learner_id: input.learnerId,
          credential_code: input.credentialCode,
          credential_id_hash: input.credentialIdHash,
          evidence_hash: input.evidenceHash,
          title: input.title,
          skill: input.skill,
          assessment_score: input.assessmentScore,
          source: input.source,
          is_test: input.isTest,
          blockchain_status: 'submitting',
          network: AVALANCHE_FUJI_NETWORK,
          chain_id: Number(AVALANCHE_FUJI_CHAIN_ID),
          created_by: input.createdBy,
        });
        transaction = await store.insertTransaction({ credential_id: credential.id, operation: 'issue', status: 'submitting' });
      }
      const gateway = await avalancheFactory({ write: true });
      credential = await store.updateCredential(credential.id, {
        contract_address: gateway.contractAddress,
        issuer_address: gateway.issuerAddress,
      });
      if (existing) {
        const onchain = await gateway.verifyCredential(input.credentialIdHash);
        if (onchain.exists && String(onchain.evidenceHash).toLowerCase() !== input.evidenceHash.toLowerCase()) {
          throw credentialError('On-chain evidence hash does not match the failed record', 'EVIDENCE_HASH_MISMATCH', 409);
        }
        if (onchain.exists) {
          credential = await store.updateCredential(credential.id, {
            blockchain_status: onchain.revoked ? 'revoked' : 'confirmed',
            issued_at: isoFromUnix(onchain.issuedAt),
            revoked_at: isoFromUnix(onchain.revokedAt),
            verification_checked_at: new Date().toISOString(),
            onchain_valid: onchain.valid,
            issuer_address: onchain.issuer,
            failure_code: null,
            failure_message: null,
          });
          return toPublicCredential(credential);
        }
      }
      if (!transaction) transaction = await store.insertTransaction({ credential_id: credential.id, operation: 'issue', status: 'submitting' });
      const result = await gateway.issueCredential({
        credentialId: input.credentialIdHash,
        evidenceHash: input.evidenceHash,
        onSubmitted: async transactionHash => {
          credential = await store.updateCredential(credential.id, { blockchain_status: 'pending', issue_tx_hash: transactionHash, failure_code: null, failure_message: null });
          transaction = await store.updateTransaction(transaction.id, { status: 'pending', transaction_hash: transactionHash });
        },
      });
      const now = new Date().toISOString();
      credential = await store.updateCredential(credential.id, {
        blockchain_status: 'confirmed',
        issue_tx_hash: result.receipt.transactionHash,
        issued_at: isoFromUnix(result.credential.issuedAt),
        verification_checked_at: now,
        onchain_valid: result.credential.valid,
        failure_code: null,
        failure_message: null,
      });
      await store.updateTransaction(transaction.id, { status: 'confirmed', transaction_hash: result.receipt.transactionHash, block_number: result.receipt.blockNumber, gas_used: result.receipt.gasUsed });
      return toPublicCredential(credential);
    } catch (error) {
      if (credential?.id) await store.updateCredential(credential.id, { blockchain_status: 'failed', onchain_valid: false, ...safeFailure(error) }).catch(() => {});
      if (transaction?.id) await store.updateTransaction(transaction.id, { status: 'failed', error_code: safeFailure(error).failure_code, error_message: safeFailure(error).failure_message }).catch(() => {});
      throw error;
    }
  }

  async function revoke(code) {
    const credentialCode = String(code || '').trim().toUpperCase();
    const row = await store.findByCode(credentialCode);
    if (!row) throw credentialError('Credential was not found', 'CREDENTIAL_NOT_FOUND', 404);
    if (row.blockchain_status === 'revoked') throw credentialError('Credential has already been revoked', 'CREDENTIAL_ALREADY_REVOKED', 409);
    if (row.source === 'mock') throw credentialError('Mock credentials cannot be revoked on-chain', 'MOCK_CREDENTIAL_FORBIDDEN', 400);

    let transaction = await store.insertTransaction({ credential_id: row.id, operation: 'revoke', status: 'submitting' });
    let current = row;
    try {
      const gateway = await avalancheFactory({ write: true });
      const result = await gateway.revokeCredential({
        credentialId: row.credential_id_hash,
        onSubmitted: async transactionHash => {
          current = await store.updateCredential(row.id, { blockchain_status: 'revoke_pending', revoke_tx_hash: transactionHash, failure_code: null, failure_message: null });
          transaction = await store.updateTransaction(transaction.id, { status: 'pending', transaction_hash: transactionHash });
        },
      });
      const now = new Date().toISOString();
      current = await store.updateCredential(row.id, {
        blockchain_status: 'revoked',
        revoke_tx_hash: result.receipt.transactionHash,
        revoked_at: isoFromUnix(result.credential.revokedAt),
        verification_checked_at: now,
        onchain_valid: false,
        failure_code: null,
        failure_message: null,
      });
      await store.updateTransaction(transaction.id, { status: 'confirmed', transaction_hash: result.receipt.transactionHash, block_number: result.receipt.blockNumber, gas_used: result.receipt.gasUsed });
      return toPublicCredential(current);
    } catch (error) {
      await store.updateCredential(row.id, { blockchain_status: row.blockchain_status, ...safeFailure(error) }).catch(() => {});
      await store.updateTransaction(transaction.id, { status: 'failed', error_code: safeFailure(error).failure_code, error_message: safeFailure(error).failure_message }).catch(() => {});
      throw error;
    }
  }

  async function verify(code) {
    const credentialCode = String(code || '').trim().toUpperCase();
    const row = await store.findByCode(credentialCode);
    if (!row) throw credentialError('Credential was not found', 'CREDENTIAL_NOT_FOUND', 404);
    const gateway = await avalancheFactory({ write: false });
    const onchain = await gateway.verifyCredential(row.credential_id_hash);
    const now = new Date().toISOString();
    let patch = { verification_checked_at: now, onchain_valid: false };
    if (onchain.exists && String(onchain.evidenceHash).toLowerCase() !== String(row.evidence_hash).toLowerCase()) {
      patch = { ...patch, blockchain_status: 'failed', ...safeFailure(credentialError('On-chain evidence hash does not match the database', 'EVIDENCE_HASH_MISMATCH', 409)) };
    } else if (onchain.revoked) {
      patch = { ...patch, blockchain_status: 'revoked', revoked_at: isoFromUnix(onchain.revokedAt) };
    } else if (onchain.valid) {
      patch = { ...patch, blockchain_status: 'confirmed', onchain_valid: true, issued_at: isoFromUnix(onchain.issuedAt), issuer_address: onchain.issuer, failure_code: null, failure_message: null };
    }
    const credential = toPublicCredential(await store.updateCredential(row.id, patch));
    credential.verification.exists = Boolean(onchain.exists);
    credential.verification.revoked = Boolean(onchain.revoked);
    return credential;
  }

  return {
    issue,
    revoke,
    verify,
    async find(code) {
      const row = await store.findByCode(String(code || '').trim().toUpperCase());
      return row ? toPublicCredential(row) : null;
    },
    async passport(user) {
      return buildLearningPassport(user, await store.listByLearner(user.id));
    },
  };
}
