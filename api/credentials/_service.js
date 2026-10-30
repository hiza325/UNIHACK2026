import { AVALANCHE_FUJI_CHAIN_ID, AVALANCHE_FUJI_NETWORK, createAvalancheGateway, credentialIdFromCode, encodeIssueCredential, normalizeEvidenceHash } from './_avalanche.js';
import { AVALANCHE_FUJI_CONFIG, isEvmAddress, isEvmTransactionHash } from '../../avalanche-config.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL_CODE = /^PXP-[A-Z0-9-]{4,76}$/;
// Versioned server policy: the rubric assesses reasoning, not a client-selected course.
const SUBJECT_BY_RUBRIC = Object.freeze({ 'paradox-rubric-v1': 'Critical thinking and reasoning' });

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
    skill: isTest ? text(body.skill, 120, 'skill') : null,
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

function sameHash(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function isDuplicateDatabaseError(error) {
  return error?.code === 'DUPLICATE_CREDENTIAL_DATABASE'
    || (error?.status === 409 && /already exists/i.test(String(error?.message || '')));
}

function isConfirmedChainError(error) {
  return error?.onchainConfirmed === true || Number(error?.receipt?.status) === 1;
}

function isAmbiguousChainError(error) {
  return !isConfirmedChainError(error)
    && !error?.receipt
    && (error?.ambiguous === true || error?.broadcast === true);
}

export function toPublicCredential(row) {
  const revoked = row.blockchain_status === 'revoked';
  const pending = ['submitting', 'pending', 'revoke_pending'].includes(row.blockchain_status);
  const verified = row.blockchain_status === 'confirmed' && row.onchain_valid === true && Boolean(row.verification_checked_at);
  const status = revoked ? 'revoked' : pending ? 'pending' : verified ? 'verified' : 'unverified';
  const transactionHash = row.revoke_tx_hash || row.issue_tx_hash || null;
  return {
    id: row.id,
    snapshot: row.snapshot_version === 1 ? {
      version: row.snapshot_version,
      credentialId: row.id,
      certificateCode: row.credential_code,
      recipientName: row.recipient_name_snapshot,
      subject: row.subject_snapshot,
      capturedAt: row.snapshot_captured_at,
      issuedAt: row.issued_at || null,
      evaluationId: row.evaluation_id,
    } : null,
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
    if ([evaluation, submission, session, dbProof, input.proofRecord, input].some(record => record && (record.isMock === true || record.isDemo === true || record.isTest === true || ['mock', 'demo', 'manual-test'].includes(record.source)))) throw credentialError('Mock evidence cannot be issued', 'MOCK_CREDENTIAL_FORBIDDEN', 400);
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
      subject: SUBJECT_BY_RUBRIC[evaluation.rubric_version] || null,
      evidenceHash: normalizeEvidenceHash(dbProof.contentHash),
      assessmentScore: Number.isFinite(dbProof.score) ? Math.max(0, Math.min(100, Math.round(dbProof.score))) : input.assessmentScore,
    };
  }

  async function issue(body, actor) {
    const input = normalizeCredentialIssueInput(body, actor);
    let verifiedEvidence;
    if (input.source === 'ai-evaluation') {
      if (body.isDemo === true || body.isTest === true) throw credentialError('Demo evidence cannot be issued', 'MOCK_CREDENTIAL_FORBIDDEN', 400);
      const verified = await verifyAiEvidence(input, input.learnerId);
      verifiedEvidence = verified;
      input.evidenceHash = verified.evidenceHash;
      input.assessmentScore = verified.assessmentScore;
    }
    const existing = await store.findByCode(input.credentialCode);
    const retryRequested = body.retryFailed === true;
    const canRetryFailedRecord = Boolean(existing) && existing.blockchain_status === 'failed' && retryRequested;
    if (existing && !canRetryFailedRecord) {
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
    let snapshot = {};
    if (input.source === 'ai-evaluation') {
      if (existing) {
        if (existing.snapshot_version !== 1 || !existing.recipient_name_snapshot || !existing.subject_snapshot || !existing.snapshot_captured_at) {
          throw credentialError('Legacy credential has no immutable snapshot; issuance retry is blocked', 'CREDENTIAL_SNAPSHOT_MISSING', 409);
        }
        if (existing.evaluation_id !== input.evaluationId) throw credentialError('Retry evaluation differs from snapshot', 'CREDENTIAL_RETRY_MISMATCH', 409);
        input.skill = existing.subject_snapshot;
      } else {
        if (!verifiedEvidence.subject) throw credentialError('Evaluation rubric has no approved certificate subject', 'CREDENTIAL_SUBJECT_UNSUPPORTED', 409);
        if (!store.findLearnerName) throw credentialError('Learner profile reader is unavailable', 'LEARNER_PROFILE_UNAVAILABLE', 503);
        const name = text(await store.findLearnerName(input.learnerId), 200, 'recipient name').normalize('NFC');
        input.skill = verifiedEvidence.subject;
        snapshot = { recipient_name_snapshot: name, subject_snapshot: input.skill, snapshot_version: 1,
          snapshot_captured_at: new Date().toISOString(), evaluation_id: input.evaluationId };
      }
    }

    // Preflight must happen before any issuance DB write. A missing signer, wrong chain,
    // missing registry or unauthorized issuer therefore cannot create credential rows.
    const gateway = await avalancheFactory({ write: true });
    const preflight = typeof gateway?.preflight === 'function'
      ? gateway.preflight.bind(gateway)
      : (typeof gateway?.requireAuthorizedWallet === 'function' ? gateway.requireAuthorizedWallet.bind(gateway) : null);
    if (preflight) await preflight();

    if (typeof gateway?.credentialIdForEvidence === 'function') {
      const evidenceOwner = await gateway.credentialIdForEvidence(input.evidenceHash);
      if (evidenceOwner && !sameHash(evidenceOwner, input.credentialIdHash)) {
        throw credentialError('Evidence hash is already registered to another credential', 'DUPLICATE_EVIDENCE', 409);
      }
    }

    let previousTransactionUnknown = false;
    if (canRetryFailedRecord && existing.issue_tx_hash) {
      const previousReceipt = typeof gateway?.getTransactionReceipt === 'function'
        ? await gateway.getTransactionReceipt(existing.issue_tx_hash)
        : null;
      if (previousReceipt && Number(previousReceipt.status) === 1) {
        const onchain = await gateway.verifyCredential(input.credentialIdHash);
        if (onchain.exists && !sameHash(onchain.evidenceHash, input.evidenceHash)) {
          throw credentialError('On-chain evidence hash does not match the failed record', 'EVIDENCE_HASH_MISMATCH', 409);
        }
        if (onchain.exists) {
          credential = await store.updateCredential(existing.id, {
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
        previousTransactionUnknown = true;
      } else if (!previousReceipt) {
        previousTransactionUnknown = true;
      }
    }

    if (previousTransactionUnknown) {
      const onchain = await gateway.verifyCredential(input.credentialIdHash);
      if (onchain.exists) {
        if (!sameHash(onchain.evidenceHash, input.evidenceHash)) {
          throw credentialError('On-chain evidence hash does not match the failed record', 'EVIDENCE_HASH_MISMATCH', 409);
        }
        credential = await store.updateCredential(existing.id, {
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
      throw credentialError('Previous Avalanche transaction is still unconfirmed; retry is blocked', 'AVALANCHE_TRANSACTION_STATUS_UNKNOWN', 409);
    }

    if (canRetryFailedRecord) {
      if (typeof store.claimRetry === 'function') {
        const claimed = await store.claimRetry(existing.id);
        if (!claimed) throw credentialError('Credential retry is already in progress', 'CREDENTIAL_RETRY_IN_PROGRESS', 409);
        credential = claimed;
      } else {
        credential = await store.updateCredential(existing.id, { blockchain_status: 'submitting', failure_code: null, failure_message: null });
      }
    }

    let transaction;
    let broadcastTransactionHash = null;
    let lastTransactionHash = credential?.issue_tx_hash || null;
    let chainConfirmed = false;
    try {
      if (!credential) {
        try {
          credential = await store.insertCredential({
            ...snapshot,
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
        } catch (error) {
          if (!isDuplicateDatabaseError(error)) throw error;
          const refetched = await store.findByCode(input.credentialCode).catch(() => null);
          if (!refetched) throw error;
          const refetchRetryable = refetched.blockchain_status === 'failed' && retryRequested;
          if (!refetchRetryable) throw credentialError('Credential code already exists', 'DUPLICATE_CREDENTIAL', 409);
          // A concurrent creator won the insert race. Do not bypass the atomic retry
          // claim by adopting that row in this request.
          throw credentialError('Credential changed during issuance; retry again', 'CREDENTIAL_RETRY_IN_PROGRESS', 409);
        }
      }
      if (credential?.id && gateway?.contractAddress) {
        credential = await store.updateCredential(credential.id, {
          contract_address: gateway.contractAddress,
          issuer_address: gateway.issuerAddress,
        });
      }
      if (canRetryFailedRecord || (credential && credential.id && !transaction)) {
        const onchain = await gateway.verifyCredential(input.credentialIdHash);
        if (onchain.exists && !sameHash(onchain.evidenceHash, input.evidenceHash)) {
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
          broadcastTransactionHash = transactionHash;
          lastTransactionHash = transactionHash;
          credential = await store.updateCredential(credential.id, { blockchain_status: 'pending', issue_tx_hash: transactionHash, failure_code: null, failure_message: null });
          transaction = await store.updateTransaction(transaction.id, { status: 'pending', transaction_hash: transactionHash });
        },
      });
      chainConfirmed = true;
      lastTransactionHash = result.receipt.transactionHash;
      const now = new Date().toISOString();
      credential = await store.updateCredential(credential.id, {
        blockchain_status: 'confirmed',
        issue_tx_hash: result.receipt.transactionHash,
        issued_at: isoFromUnix(result.credential?.issuedAt),
        verification_checked_at: now,
        onchain_valid: result.credential?.valid === true,
        failure_code: null,
        failure_message: null,
      });
      await store.updateTransaction(transaction.id, { status: 'confirmed', transaction_hash: result.receipt.transactionHash, block_number: result.receipt.blockNumber, gas_used: result.receipt.gasUsed });
      return toPublicCredential(credential);
    } catch (error) {
      const confirmed = chainConfirmed || isConfirmedChainError(error);
      const ambiguous = !confirmed && !error?.receipt
        && (isAmbiguousChainError(error) || Boolean(broadcastTransactionHash));
      const transactionHash = error?.transactionHash || broadcastTransactionHash || lastTransactionHash || null;
      if (credential?.id) {
        if (confirmed) {
          await store.updateCredential(credential.id, {
            blockchain_status: 'confirmed',
            ...(transactionHash ? { issue_tx_hash: transactionHash } : {}),
            verification_checked_at: new Date().toISOString(),
            onchain_valid: true,
            failure_code: null,
            failure_message: null,
          }).catch(() => {});
        } else if (ambiguous) {
          await store.updateCredential(credential.id, {
            blockchain_status: 'pending',
            ...(transactionHash ? { issue_tx_hash: transactionHash } : {}),
            failure_code: 'AVALANCHE_TRANSACTION_STATUS_UNKNOWN',
            failure_message: 'Transaction was broadcast; confirmation is pending',
          }).catch(() => {});
        } else {
          await store.updateCredential(credential.id, { blockchain_status: 'failed', onchain_valid: false, ...safeFailure(error) }).catch(() => {});
        }
      }
      if (transaction?.id) {
        if (confirmed) {
          await store.updateTransaction(transaction.id, { status: 'confirmed', ...(transactionHash ? { transaction_hash: transactionHash } : {}) }).catch(() => {});
        } else if (ambiguous) {
          await store.updateTransaction(transaction.id, { status: 'pending', ...(transactionHash ? { transaction_hash: transactionHash } : {}) }).catch(() => {});
        } else {
          await store.updateTransaction(transaction.id, { status: 'failed', error_code: safeFailure(error).failure_code, error_message: safeFailure(error).failure_message }).catch(() => {});
        }
      }
      throw error;
    }
  }

  async function prepareIssue(body, actor) {
    const input = normalizeCredentialIssueInput(body, actor);
    const issuerAddress = String(body?.issuerAddress || '').trim();
    if (!isEvmAddress(issuerAddress)) throw credentialError('Issuer address is invalid', 'INVALID_ISSUER_ADDRESS', 400);

    let verifiedEvidence;
    if (input.source === 'ai-evaluation') {
      if (body?.isDemo === true || body?.isTest === true) throw credentialError('Demo evidence cannot be issued', 'MOCK_CREDENTIAL_FORBIDDEN', 400);
      const verified = await verifyAiEvidence(input, input.learnerId);
      verifiedEvidence = verified;
      input.evidenceHash = verified.evidenceHash;
      input.assessmentScore = verified.assessmentScore;
    }

    const existing = await store.findByCode(input.credentialCode);
    const retryRequested = body?.retryFailed === true;
    const canRetryFailed = Boolean(existing) && existing.blockchain_status === 'failed' && retryRequested;

    if (existing && !canRetryFailed && !['submitting', 'pending'].includes(existing.blockchain_status)) {
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
    let snapshot = {};
    if (input.source === 'ai-evaluation') {
      if (existing) {
        if (existing.snapshot_version !== 1 || !existing.recipient_name_snapshot || !existing.subject_snapshot || !existing.snapshot_captured_at) {
          throw credentialError('Legacy credential has no immutable snapshot; issuance retry is blocked', 'CREDENTIAL_SNAPSHOT_MISSING', 409);
        }
        if (existing.evaluation_id !== input.evaluationId) throw credentialError('Retry evaluation differs from snapshot', 'CREDENTIAL_RETRY_MISMATCH', 409);
        input.skill = existing.subject_snapshot;
      } else {
        if (!verifiedEvidence?.subject) throw credentialError('Evaluation rubric has no approved certificate subject', 'CREDENTIAL_SUBJECT_UNSUPPORTED', 409);
        if (!store.findLearnerName) throw credentialError('Learner profile reader is unavailable', 'LEARNER_PROFILE_UNAVAILABLE', 503);
        const name = text(await store.findLearnerName(input.learnerId), 200, 'recipient name').normalize('NFC');
        input.skill = verifiedEvidence.subject;
        snapshot = { recipient_name_snapshot: name, subject_snapshot: input.skill, snapshot_version: 1, snapshot_captured_at: new Date().toISOString(), evaluation_id: input.evaluationId };
      }
    }

    // Read-only preflight: RPC, chainId, contract bytecode, authorized issuer.
    const gateway = await avalancheFactory({ write: false });
    let preflight;
    try { preflight = await gateway.readPreflight(issuerAddress); }
    catch (error) { throw error; }

    // Evidence duplicate check (read-only).
    if (typeof gateway.credentialIdForEvidence === 'function') {
      const evidenceOwner = await gateway.credentialIdForEvidence(input.evidenceHash);
      if (evidenceOwner && !sameHash(evidenceOwner, input.credentialIdHash)) {
        throw credentialError('Evidence hash is already registered to another credential', 'DUPLICATE_EVIDENCE', 409);
      }
    }

    const unsignedData = encodeIssueCredential(input.credentialIdHash, input.evidenceHash);

    let gasEstimate = null;
    try { gasEstimate = await gateway.estimateGas({ to: gateway.contractAddress, from: issuerAddress, data: unsignedData }); }
    catch (_) { gasEstimate = null; }

    if (!credential) {
      try {
        credential = await store.insertCredential({
          ...snapshot,
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
          contract_address: gateway.contractAddress,
          issuer_address: issuerAddress,
          created_by: input.createdBy,
        });
      } catch (error) {
        if (!isDuplicateDatabaseError(error)) throw error;
        const refetched = await store.findByCode(input.credentialCode).catch(() => null);
        if (!refetched) throw error;
        credential = refetched;
      }
    } else {
      credential = await store.updateCredential(credential.id, {
        blockchain_status: 'submitting',
        contract_address: gateway.contractAddress,
        issuer_address: issuerAddress,
        failure_code: null,
        failure_message: null,
      });
    }

    return {
      credential: toPublicCredential(credential),
      unsignedTransaction: {
        to: gateway.contractAddress,
        data: unsignedData,
        value: '0',
        chainId: Number(AVALANCHE_FUJI_CHAIN_ID),
        gasEstimate,
        issuerAddress,
      },
      preflight,
    };
  }

  async function confirmIssue(body, actor) {
    const credentialCode = String(body?.credentialCode || '').trim().toUpperCase();
    const txHash = String(body?.txHash || '').trim();
    if (!credentialCode) throw credentialError('Credential code is required', 'INVALID_CREDENTIAL_CODE', 400);
    if (!isEvmTransactionHash(txHash)) throw credentialError('Transaction hash is invalid', 'INVALID_TRANSACTION_HASH', 400);

    const row = await store.findByCode(credentialCode);
    if (!row) throw credentialError('Credential was not found', 'CREDENTIAL_NOT_FOUND', 404);

    // Idempotency: already confirmed with same tx hash.
    if (row.blockchain_status === 'confirmed' && row.issue_tx_hash && row.issue_tx_hash.toLowerCase() === txHash.toLowerCase()) {
      return { credential: toPublicCredential(row), alreadyConfirmed: true };
    }
    if (row.blockchain_status === 'confirmed' && row.issue_tx_hash && row.issue_tx_hash.toLowerCase() !== txHash.toLowerCase()) {
      throw credentialError('Credential already confirmed with a different transaction', 'DUPLICATE_TRANSACTION', 409);
    }

    const gateway = await avalancheFactory({ write: false });
    const contractAddress = gateway.contractAddress;
    const issuerAddress = row.issuer_address;

    let tx;
    try { tx = await gateway.getTransaction(txHash); }
    catch (error) { throw error; }
    if (!tx) {
      // Not mined/broadcast yet or unknown; keep pending, no DB change.
      const updated = row.blockchain_status === 'submitting'
        ? await store.updateCredential(row.id, { blockchain_status: 'pending', issue_tx_hash: txHash })
        : row;
      return { credential: toPublicCredential(updated), status: 'pending', reason: 'transaction_not_found' };
    }

    // Verify chain, destination, sender, value, calldata.
    if (Number(tx.chainId) !== Number(AVALANCHE_FUJI_CHAIN_ID)) throw credentialError('Transaction is on the wrong chain', 'AVALANCHE_WRONG_CHAIN', 409);
    if (String(tx.to || '').toLowerCase() !== String(contractAddress).toLowerCase()) throw credentialError('Transaction destination is invalid', 'INVALID_TRANSACTION_DESTINATION', 409);
    if (issuerAddress && String(tx.from || '').toLowerCase() !== String(issuerAddress).toLowerCase()) throw credentialError('Transaction sender is not the authorized issuer', 'INVALID_TRANSACTION_SENDER', 409);
    const txValue = typeof tx.value === 'bigint' ? tx.value : BigInt(tx.value || 0);
    if (txValue !== 0n) throw credentialError('Transaction value must be zero', 'INVALID_TRANSACTION_VALUE', 409);
    const expectedData = encodeIssueCredential(row.credential_id_hash, row.evidence_hash);
    if (String(tx.data || '').toLowerCase() !== String(expectedData).toLowerCase()) throw credentialError('Transaction calldata does not match the credential', 'INVALID_TRANSACTION_CALLDATA', 409);

    const receipt = await gateway.getTransactionReceipt(txHash);
    if (!receipt) {
      const updated = await store.updateCredential(row.id, { blockchain_status: 'pending', issue_tx_hash: txHash, failure_code: null, failure_message: null });
      return { credential: toPublicCredential(updated), status: 'pending', reason: 'transaction_pending' };
    }
    if (Number(receipt.status) !== 1) {
      const updated = await store.updateCredential(row.id, { blockchain_status: 'failed', onchain_valid: false, ...safeFailure(credentialError('Avalanche transaction was mined but failed', 'AVALANCHE_TRANSACTION_REVERTED', 502)) });
      throw credentialError('Avalanche transaction was mined but failed', 'AVALANCHE_TRANSACTION_REVERTED', 502);
    }

    const onchain = await gateway.verifyCredential(row.credential_id_hash);
    if (!onchain.exists) throw credentialError('Credential does not exist on Avalanche', 'CREDENTIAL_NOT_CONFIRMED', 409);
    if (!sameHash(onchain.evidenceHash, row.evidence_hash)) throw credentialError('On-chain evidence hash does not match the database', 'EVIDENCE_HASH_MISMATCH', 409);

    const now = new Date().toISOString();
    const updated = await store.updateCredential(row.id, {
      blockchain_status: 'confirmed',
      issue_tx_hash: txHash,
      issued_at: isoFromUnix(onchain.issuedAt),
      verification_checked_at: now,
      onchain_valid: onchain.valid === true,
      issuer_address: onchain.issuer,
      failure_code: null,
      failure_message: null,
    });
    return { credential: toPublicCredential(updated), status: 'confirmed' };
  }

  async function revoke(code) {
    const credentialCode = String(code || '').trim().toUpperCase();
    const row = await store.findByCode(credentialCode);
    if (!row) throw credentialError('Credential was not found', 'CREDENTIAL_NOT_FOUND', 404);
    if (row.blockchain_status === 'revoked') throw credentialError('Credential has already been revoked', 'CREDENTIAL_ALREADY_REVOKED', 409);
    const revokePending = row.blockchain_status === 'revoke_pending';
    if (row.blockchain_status !== 'confirmed' && !revokePending) throw credentialError('Credential issuance is not confirmed', 'CREDENTIAL_NOT_CONFIRMED', 409);
    if (row.source === 'mock') throw credentialError('Mock credentials cannot be revoked on-chain', 'MOCK_CREDENTIAL_FORBIDDEN', 400);

    const gateway = await avalancheFactory({ write: true });
    const preflight = typeof gateway?.preflight === 'function'
      ? gateway.preflight.bind(gateway)
      : (typeof gateway?.requireAuthorizedWallet === 'function' ? gateway.requireAuthorizedWallet.bind(gateway) : null);
    if (preflight) await preflight();

    let previousRevokeUnknown = false;
    if (row.revoke_tx_hash) {
      if (typeof gateway?.getTransactionReceipt !== 'function') {
        previousRevokeUnknown = true;
      } else {
        const previousReceipt = await gateway.getTransactionReceipt(row.revoke_tx_hash);
        if (!previousReceipt) {
          previousRevokeUnknown = true;
        } else if (Number(previousReceipt.status) === 1) {
          previousRevokeUnknown = true;
        }
      }
    }

    const onchain = await gateway.verifyCredential(row.credential_id_hash);
    if (!onchain.exists) throw credentialError('Credential does not exist on Avalanche', 'CREDENTIAL_NOT_CONFIRMED', 409);
    if (!sameHash(onchain.evidenceHash, row.evidence_hash)) {
      throw credentialError('On-chain evidence hash does not match the database', 'EVIDENCE_HASH_MISMATCH', 409);
    }
    if (onchain.revoked) {
      const reconciled = await store.updateCredential(row.id, {
        blockchain_status: 'revoked',
        revoked_at: isoFromUnix(onchain.revokedAt),
        verification_checked_at: new Date().toISOString(),
        onchain_valid: false,
        issuer_address: onchain.issuer,
        failure_code: null,
        failure_message: null,
      });
      return toPublicCredential(reconciled);
    }
    if (revokePending) {
      throw credentialError('Credential revocation is still pending', 'CREDENTIAL_REVOKE_PENDING', 409);
    }
    if (previousRevokeUnknown) {
      throw credentialError('Previous Avalanche revocation is still unconfirmed', 'AVALANCHE_TRANSACTION_STATUS_UNKNOWN', 409);
    }

    let transaction = await store.insertTransaction({ credential_id: row.id, operation: 'revoke', status: 'submitting' });
    let current = row;
    let broadcastTransactionHash = null;
    let lastTransactionHash = row.revoke_tx_hash || null;
    let lastRevokedAt = null;
    let chainConfirmed = false;
    try {
      const result = await gateway.revokeCredential({
        credentialId: row.credential_id_hash,
        onSubmitted: async transactionHash => {
          broadcastTransactionHash = transactionHash;
          lastTransactionHash = transactionHash;
          current = await store.updateCredential(row.id, { blockchain_status: 'revoke_pending', revoke_tx_hash: transactionHash, failure_code: null, failure_message: null });
          transaction = await store.updateTransaction(transaction.id, { status: 'pending', transaction_hash: transactionHash });
        },
      });
      chainConfirmed = true;
      lastTransactionHash = result.receipt.transactionHash;
      lastRevokedAt = result.credential?.revokedAt;
      const now = new Date().toISOString();
      current = await store.updateCredential(row.id, {
        blockchain_status: 'revoked',
        revoke_tx_hash: result.receipt.transactionHash,
        revoked_at: isoFromUnix(lastRevokedAt),
        verification_checked_at: now,
        onchain_valid: false,
        failure_code: null,
        failure_message: null,
      });
      await store.updateTransaction(transaction.id, { status: 'confirmed', transaction_hash: result.receipt.transactionHash, block_number: result.receipt.blockNumber, gas_used: result.receipt.gasUsed });
      return toPublicCredential(current);
    } catch (error) {
      const confirmed = chainConfirmed || isConfirmedChainError(error);
      const ambiguous = !confirmed && !error?.receipt
        && (isAmbiguousChainError(error) || Boolean(broadcastTransactionHash));
      const transactionHash = error?.transactionHash || broadcastTransactionHash || lastTransactionHash || null;
      if (confirmed) {
        await store.updateCredential(row.id, {
          blockchain_status: 'revoked',
          ...(transactionHash ? { revoke_tx_hash: transactionHash } : {}),
          ...(lastRevokedAt ? { revoked_at: isoFromUnix(lastRevokedAt) } : {}),
          verification_checked_at: new Date().toISOString(),
          onchain_valid: false,
          failure_code: null,
          failure_message: null,
        }).catch(() => {});
      } else if (ambiguous) {
        await store.updateCredential(row.id, {
          blockchain_status: 'revoke_pending',
          ...(transactionHash ? { revoke_tx_hash: transactionHash } : {}),
          failure_code: 'AVALANCHE_TRANSACTION_STATUS_UNKNOWN',
          failure_message: 'Revocation was broadcast; confirmation is pending',
        }).catch(() => {});
      } else {
        await store.updateCredential(row.id, { blockchain_status: row.blockchain_status, ...safeFailure(error) }).catch(() => {});
      }
      if (transaction?.id) {
        if (confirmed) {
          await store.updateTransaction(transaction.id, { status: 'confirmed', ...(transactionHash ? { transaction_hash: transactionHash } : {}) }).catch(() => {});
        } else if (ambiguous) {
          await store.updateTransaction(transaction.id, { status: 'pending', ...(transactionHash ? { transaction_hash: transactionHash } : {}) }).catch(() => {});
        } else {
          await store.updateTransaction(transaction.id, { status: 'failed', error_code: safeFailure(error).failure_code, error_message: safeFailure(error).failure_message }).catch(() => {});
        }
      }
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
    prepareIssue,
    confirmIssue,
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
