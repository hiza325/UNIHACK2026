import { AVALANCHE_FUJI_CHAIN_ID, AVALANCHE_FUJI_NETWORK, createAvalancheGateway, credentialIdFromCode, encodeIssueCredential, normalizeEvidenceHash } from './_avalanche.js';
import { computeMetadataAttestation, metadataFieldsFromRow, verifyMetadataAttestation } from './_metadata-attestation.js';
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
  if (!['ai-evaluation', 'manual-test', 'competency-assessment'].includes(source)) throw credentialError('Credential source is not allowed', 'INVALID_CREDENTIAL_SOURCE', 400);

  // Server-side classification: a credential is TEST if the source is manual-test
  // OR the credential code uses the PXP-TEST- prefix. Client-supplied flags are
  // never trusted; the code prefix is the authoritative marker.
  const isTest = source === 'manual-test' || String(credentialCode).toUpperCase().startsWith('PXP-TEST-');
  if (source === 'manual-test' && !credentialCode.toUpperCase().startsWith('PXP-TEST-')) {
    throw credentialError('Test credentials must use a PXP-TEST code', 'TEST_CREDENTIAL_LABEL_REQUIRED', 400);
  }
  if (!isTest) {
    const proof = body.proofRecord;
    if (proof !== undefined && proof !== null) {
      if (proof?.schemaVersion !== 'paradox-proof-of-learning-v1' || proof.evidenceSufficient !== true || proof.status !== 'pass') {
        throw credentialError('A passing, evidence-sufficient AI proof record is required', 'AI_PROOF_NOT_ELIGIBLE', 400);
      }
    }
  }

  const rawEvidenceHash = body.evidenceHash || body.proofRecord?.contentHash;
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
    evidenceHash: rawEvidenceHash ? normalizeEvidenceHash(rawEvidenceHash) : null,
    proofRecord: body.proofRecord && typeof body.proofRecord === 'object' ? body.proofRecord : null,
    title: text(body.title, 160, 'title'),
    skill: source === 'manual-test' ? text(body.skill, 120, 'skill') : null,
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

function isRpcError(error) {
  const code = String(error?.code || '');
  return code === 'AVALANCHE_RPC_UNAVAILABLE'
    || code === 'AVALANCHE_RPC_INVALID'
    || /timeout|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(String(error?.message || ''));
}

async function markEvaluationIssued(learningRecordStore, row) {
  if (!learningRecordStore || !row?.evaluation_id) return;
  try {
    const existing = await learningRecordStore.findEvaluation(row.evaluation_id, row.learner_id);
    if (!existing) return;
    if (existing.credential_status === 'issued' || existing.credential_status === 'verified') return;
    await learningRecordStore.updateEvaluation(row.evaluation_id, {
      credential_status: 'issued',
      verification_status: 'verified',
      credential_id: row.credential_code,
      credential_id_hash: row.credential_id_hash,
      credential_hash: row.evidence_hash,
      issued_at: row.issued_at || new Date().toISOString(),
      issue_tx_hash: row.issue_tx_hash,
    });
  } catch (_) {
    // Best-effort: issuance already confirmed on-chain; do not fail the request.
  }
}

async function markEvaluationRevoked(learningRecordStore, row) {
  if (!learningRecordStore || !row?.evaluation_id) return;
  try {
    const existing = await learningRecordStore.findEvaluation(row.evaluation_id, row.learner_id);
    if (!existing) return;
    if (existing.credential_status === 'revoked') return;
    await learningRecordStore.updateEvaluation(row.evaluation_id, {
      credential_status: 'revoked',
      verification_status: 'revoked',
    });
  } catch (_) {
    // Best-effort.
  }
}

// Projection for lookups made by credential code, which any signed-in user
// can attempt. It keeps what the verification page renders and drops
// learner-private fields: holder name, assessment score, evaluation and
// evidence identifiers. The issue transaction hash is public on-chain data
// and is required by the client to recognise a genuinely verified credential.
const VERIFICATION_VIEW_FIELDS = [
  'id', 'code', 'name', 'skill', 'issuedAt', 'revokedAt', 'status',
  'network', 'chainId', 'contractAddress', 'transactionHash',
  'issueTransactionHash', 'transactionStatus', 'verification', 'isTest', 'source',
  'metadataIntegrity', 'metadataAttestedAt',
];

export function toVerificationView(credential) {
  return Object.fromEntries(
    VERIFICATION_VIEW_FIELDS.filter(field => field in credential).map(field => [field, credential[field]]),
  );
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
    isTest: Boolean(row.is_test) || String(row.credential_code || '').toUpperCase().startsWith('PXP-TEST-'),
    evidenceHash: row.evidence_hash ? `sha256:${String(row.evidence_hash).replace(/^0x/, '')}` : null,
    transactionHash,
    issueTransactionHash: row.issue_tx_hash || null,
    revokeTransactionHash: row.revoke_tx_hash || null,
    network: AVALANCHE_FUJI_NETWORK,
    chainId: Number(AVALANCHE_FUJI_CHAIN_ID),
    contractAddress: row.contract_address || AVALANCHE_FUJI_CONFIG.contractAddress,
    transactionStatus: row.blockchain_status,
    metadataIntegrity: verifyMetadataAttestation(metadataFieldsFromRow(row), row.metadata_attestation),
    metadataAttestedAt: row.metadata_attested_at || null,
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

export function createCredentialService({ store, avalancheFactory = createAvalancheGateway, learningRecordStore = null, env = process.env, now = () => new Date() } = {}) {
  if (!store) throw new TypeError('Credential store is required');

  // Build the attestation field patch for a confirmed credential. Returns {}
  // when the snapshot/issue date is unavailable or the server secret is not
  // configured, so the credential is reported as UNVERIFIED instead of being
  // signed with incomplete or modified metadata.
  function metadataAttestationPatch(row, issuedAtOverride) {
    const fields = metadataFieldsFromRow(row);
    if (issuedAtOverride !== undefined) fields.issuedAt = issuedAtOverride;
    const attestation = computeMetadataAttestation(fields, env);
    if (!attestation) return {};
    return { metadata_attestation: attestation, metadata_attested_at: now().toISOString() };
  }

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
    if ([evaluation, submission, session, dbProof, input.proofRecord, input].some(record => record && (record.isMock === true || record.isDemo === true || ['mock', 'demo', 'manual-test'].includes(record.source)))) throw credentialError('Mock evidence cannot be issued', 'MOCK_CREDENTIAL_FORBIDDEN', 400);
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

  async function verifyCompetencyEvidence(input, learnerId) {
    if (!learningRecordStore) throw credentialError('Learning record store is not configured', 'LEARNING_RECORD_STORE_NOT_CONFIGURED', 503);
    const assessmentId = String(input.evaluationId || '').trim();
    if (!UUID.test(assessmentId)) throw credentialError('A valid competency assessment ID is required', 'INVALID_COMPETENCY_ASSESSMENT_ID', 400);
    // Fetch competency snapshot to verify the assessment
    const url = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/$/, '') : '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) throw credentialError('Competency store is not configured', 'COMPETENCY_STORE_NOT_CONFIGURED', 503);
    const res = await fetch(`${url}/rest/v1/competency_attempts?id=eq.${assessmentId}&learner_id=eq.${learnerId}&status=eq.passed&select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw credentialError('Competency store is unavailable', 'COMPETENCY_STORE_UNAVAILABLE', 503);
    const rows = await res.json();
    const assessment = Array.isArray(rows) ? rows[0] : null;
    if (!assessment) throw credentialError('Competency assessment was not found or not passed', 'COMPETENCY_ASSESSMENT_NOT_PASSED', 409);
    if (assessment.rubric_version !== 'competency-v1') throw credentialError('Unsupported rubric version', 'COMPETENCY_RUBRIC_UNSUPPORTED', 409);
    if (assessment.bank_version !== 'final-v1') throw credentialError('Unsupported bank version', 'COMPETENCY_BANK_UNSUPPORTED', 409);
    if (!assessment.independent) throw credentialError('Independent explanation is required', 'COMPETENCY_INDEPENDENT_REQUIRED', 409);
    if (!Number.isFinite(assessment.final_score) || assessment.final_score < 60) throw credentialError('Competency score is below 60', 'COMPETENCY_SCORE_TOO_LOW', 409);
    const result = assessment.result;
    if (!result || !Number.isFinite(result.total) || result.total < 60) throw credentialError('Competency total score is below 60', 'COMPETENCY_TOTAL_TOO_LOW', 409);

    const evidenceHash = normalizeEvidenceHash(assessment.id);
    return {
      subject: 'Competency Passport',
      evidenceHash,
      assessmentScore: Math.max(0, Math.min(100, Math.round(assessment.final_score))),
      metadata: {
        competencyAssessmentId: assessment.id,
        competencyType: 'critical-thinking',
        competencyLevel: assessment.final_score >= 90 ? 'Mastery' : assessment.final_score >= 75 ? 'Proficient' : 'Foundation',
        rubricVersion: assessment.rubric_version,
        evidenceHash,
      },
    };
  }

  async function issue(body, actor) {
    const input = normalizeCredentialIssueInput(body, actor);
    let verifiedEvidence;
    if (input.source === 'ai-evaluation') {
      if (body.isDemo === true || body.isMock === true) throw credentialError('Demo evidence cannot be issued', 'MOCK_CREDENTIAL_FORBIDDEN', 400);
      const verified = await verifyAiEvidence(input, input.learnerId);
      verifiedEvidence = verified;
      input.evidenceHash = verified.evidenceHash;
      input.assessmentScore = verified.assessmentScore;
    } else if (input.source === 'competency-assessment') {
      if (body.isDemo === true || body.isMock === true) throw credentialError('Demo evidence cannot be issued', 'MOCK_CREDENTIAL_FORBIDDEN', 400);
      const verified = await verifyCompetencyEvidence(input, input.learnerId);
      verifiedEvidence = verified;
      input.evidenceHash = verified.evidenceHash;
      input.assessmentScore = verified.assessmentScore;
      input.metadata = verified.metadata;
    }
    const existing = await store.findByCode(input.credentialCode);
    const retryRequested = body.retryFailed === true;
    const canRetryFailedRecord = Boolean(existing) && existing.blockchain_status === 'failed' && retryRequested;

    // Prevent issuing the same evaluation twice (different credential code, same evaluation).
    if (input.source === 'ai-evaluation' && input.evaluationId) {
      const existingByEval = typeof store.findByEvaluationId === 'function' ? await store.findByEvaluationId(input.evaluationId).catch(() => null) : null;
      if (existingByEval && existingByEval.blockchain_status === 'confirmed' && (!existing || existing.id !== existingByEval.id)) {
        throw credentialError('Credential already issued for this evaluation', 'DUPLICATE_EVALUATION_ISSUANCE', 409);
      }
    }
    // Prevent issuing the same competency assessment twice.
    if (input.source === 'competency-assessment' && input.evaluationId) {
      const existingByEval = typeof store.findByEvaluationId === 'function' ? await store.findByEvaluationId(input.evaluationId).catch(() => null) : null;
      if (existingByEval && existingByEval.blockchain_status === 'confirmed' && (!existing || existing.id !== existingByEval.id)) {
        throw credentialError('Credential already issued for this competency assessment', 'DUPLICATE_COMPETENCY_ISSUANCE', 409);
      }
    }
    if (existing && !canRetryFailedRecord) {
      throw credentialError('Credential code already exists', 'DUPLICATE_CREDENTIAL', 409);
    }
    if (existing && (
      existing.learner_id !== input.learnerId
      || String(existing.credential_id_hash).toLowerCase() !== input.credentialIdHash.toLowerCase()
      || String(existing.evidence_hash).toLowerCase() !== input.evidenceHash.toLowerCase()
      || existing.source !== input.source
      || (Boolean(existing.is_test) || String(existing.credential_code || '').toUpperCase().startsWith('PXP-TEST-')) !== input.isTest
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
        if (input.source === 'competency-assessment') {
          input.skill = 'Competency Passport';
        } else {
          if (!verifiedEvidence.subject) throw credentialError('Evaluation rubric has no approved certificate subject', 'CREDENTIAL_SUBJECT_UNSUPPORTED', 409);
        }
        if (!store.findLearnerName) throw credentialError('Learner profile reader is unavailable', 'LEARNER_PROFILE_UNAVAILABLE', 503);
        const recipientName = await store.findLearnerName(input.learnerId);
        if (!recipientName) throw credentialError('Learner profile has no recipient name', 'LEARNER_NAME_MISSING', 409);
        const name = text(recipientName, 200, 'recipient name').normalize('NFC');
        if (input.source !== 'competency-assessment') {
          input.skill = verifiedEvidence.subject;
        }
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
            ...metadataAttestationPatch(credential, isoFromUnix(onchain.issuedAt)),
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
          ...metadataAttestationPatch(credential, isoFromUnix(onchain.issuedAt)),
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
            ...metadataAttestationPatch(credential, isoFromUnix(onchain.issuedAt)),
            revoked_at: isoFromUnix(onchain.revokedAt),
            verification_checked_at: new Date().toISOString(),
            onchain_valid: onchain.valid,
            issuer_address: onchain.issuer,
            failure_code: null,
            failure_message: null,
          });
          if (!onchain.revoked) await markEvaluationIssued(learningRecordStore, credential);
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
        ...metadataAttestationPatch(credential, isoFromUnix(result.credential?.issuedAt)),
        verification_checked_at: now,
        onchain_valid: result.credential?.valid === true,
        failure_code: null,
        failure_message: null,
      });
      await store.updateTransaction(transaction.id, { status: 'confirmed', transaction_hash: result.receipt.transactionHash, block_number: result.receipt.blockNumber, gas_used: result.receipt.gasUsed });
      await markEvaluationIssued(learningRecordStore, credential);
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
            ...metadataAttestationPatch(credential),
            verification_checked_at: new Date().toISOString(),
            onchain_valid: true,
            failure_code: null,
            failure_message: null,
          }).catch(() => {});
          await markEvaluationIssued(learningRecordStore, credential).catch(() => {});
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
      if (body?.isDemo === true || body?.isMock === true) throw credentialError('Demo evidence cannot be issued', 'MOCK_CREDENTIAL_FORBIDDEN', 400);
      const verified = await verifyAiEvidence(input, input.learnerId);
      verifiedEvidence = verified;
      input.evidenceHash = verified.evidenceHash;
      input.assessmentScore = verified.assessmentScore;
    }

    const existing = await store.findByCode(input.credentialCode);
    const retryRequested = body?.retryFailed === true;
    const canRetryFailed = Boolean(existing) && existing.blockchain_status === 'failed' && retryRequested;

    // Prevent issuing the same evaluation twice (different credential code, same evaluation).
    if (input.source === 'ai-evaluation' && input.evaluationId) {
      const existingByEval = typeof store.findByEvaluationId === 'function' ? await store.findByEvaluationId(input.evaluationId).catch(() => null) : null;
      if (existingByEval && existingByEval.blockchain_status === 'confirmed' && (!existing || existing.id !== existingByEval.id)) {
        throw credentialError('Credential already issued for this evaluation', 'DUPLICATE_EVALUATION_ISSUANCE', 409);
      }
    }
    // Prevent issuing the same competency assessment twice.
    if (input.source === 'competency-assessment' && input.evaluationId) {
      const existingByEval = typeof store.findByEvaluationId === 'function' ? await store.findByEvaluationId(input.evaluationId).catch(() => null) : null;
      if (existingByEval && existingByEval.blockchain_status === 'confirmed' && (!existing || existing.id !== existingByEval.id)) {
        throw credentialError('Credential already issued for this competency assessment', 'DUPLICATE_COMPETENCY_ISSUANCE', 409);
      }
    }

    if (existing && !canRetryFailed && !['submitting', 'pending'].includes(existing.blockchain_status)) {
      throw credentialError('Credential code already exists', 'DUPLICATE_CREDENTIAL', 409);
    }
    if (existing && (
      existing.learner_id !== input.learnerId
      || String(existing.credential_id_hash).toLowerCase() !== input.credentialIdHash.toLowerCase()
      || String(existing.evidence_hash).toLowerCase() !== input.evidenceHash.toLowerCase()
      || existing.source !== input.source
      || (Boolean(existing.is_test) || String(existing.credential_code || '').toUpperCase().startsWith('PXP-TEST-')) !== input.isTest
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
        const recipientName = await store.findLearnerName(input.learnerId);
        if (!recipientName) throw credentialError('Learner profile has no recipient name', 'LEARNER_NAME_MISSING', 409);
        const name = text(recipientName, 200, 'recipient name').normalize('NFC');
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

    // Prevent issuing the same evaluation twice (different credential code, same evaluation).
    if (row.source === 'ai-evaluation' && row.evaluation_id) {
      const existingByEval = typeof store.findByEvaluationId === 'function' ? await store.findByEvaluationId(row.evaluation_id).catch(() => null) : null;
      if (existingByEval && existingByEval.id !== row.id && existingByEval.blockchain_status === 'confirmed') {
        throw credentialError('Credential already issued for this evaluation', 'DUPLICATE_EVALUATION_ISSUANCE', 409);
      }
    }

    return reconcileCredential(credentialCode, txHash);
  }

  async function revoke(code) {
    const credentialCode = String(code || '').trim().toUpperCase();
    let row = await store.findByCode(credentialCode);
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

    // Atomic claim: only one request can transition confirmed -> revoke_pending.
    if (typeof store.claimRevoke === 'function') {
      const claimed = await store.claimRevoke(row.id);
      if (!claimed) {
        const current = await store.findByCode(credentialCode);
        return toPublicCredential(current);
      }
      row = claimed;
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
      await markEvaluationRevoked(learningRecordStore, current);
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

  async function reconcileCredential(code, txHash) {
    const credentialCode = String(code || '').trim().toUpperCase();
    let row = await store.findByCode(credentialCode);
    if (!row) throw credentialError('Credential was not found', 'CREDENTIAL_NOT_FOUND', 404);

    let hash = txHash ? String(txHash).trim() : (row.issue_tx_hash || null);
    if (hash && !isEvmTransactionHash(hash)) {
      throw credentialError('Transaction hash is invalid', 'INVALID_TRANSACTION_HASH', 400);
    }

    // Already confirmed: idempotent.
    if (row.blockchain_status === 'confirmed') {
      if (hash && row.issue_tx_hash && row.issue_tx_hash.toLowerCase() !== hash.toLowerCase()) {
        throw credentialError('Credential already confirmed with a different transaction', 'DUPLICATE_TRANSACTION', 409);
      }
      await markEvaluationIssued(learningRecordStore, row);
      return { credential: toPublicCredential(row), status: 'confirmed', alreadyConfirmed: true };
    }

    // Revoked: never reconcile back to confirmed.
    if (row.blockchain_status === 'revoked') {
      await markEvaluationRevoked(learningRecordStore, row);
      return { credential: toPublicCredential(row), status: 'revoked' };
    }

    // Failed: do not auto-reconcile; require explicit retry.
    if (row.blockchain_status === 'failed') {
      return { credential: toPublicCredential(row), status: 'failed' };
    }

    // Revoked: never reconcile back to confirmed.
    if (row.blockchain_status === 'revoked') {
      await markEvaluationRevoked(learningRecordStore, row);
      return { credential: toPublicCredential(row), status: 'revoked' };
    }

    // No transaction hash available: try to reconcile purely from on-chain credential state.
    if (!hash) {
      const gateway = await avalancheFactory({ write: false });
      let onchain;
      try { onchain = await gateway.verifyCredential(row.credential_id_hash); }
      catch (error) {
        if (isRpcError(error)) {
          return { credential: toPublicCredential(row), status: row.blockchain_status || 'pending', reason: 'rpc_error' };
        }
        throw error;
      }
      if (onchain.exists) {
        if (!sameHash(onchain.evidenceHash, row.evidence_hash)) {
          const updated = await (store.updateCredentialForReconcile
            ? store.updateCredentialForReconcile(row.id, {
                blockchain_status: 'failed', onchain_valid: false,
                ...safeFailure(credentialError('On-chain evidence hash does not match the database', 'EVIDENCE_HASH_MISMATCH', 409)),
                confirmation_started_at: null,
              }, row.updated_at)
            : store.updateCredential(row.id, {
                blockchain_status: 'failed', onchain_valid: false,
                ...safeFailure(credentialError('On-chain evidence hash does not match the database', 'EVIDENCE_HASH_MISMATCH', 409)),
                confirmation_started_at: null,
              })).catch(() => row);
          throw credentialError('On-chain evidence hash does not match the database', 'EVIDENCE_HASH_MISMATCH', 409);
        }
        const now = new Date().toISOString();
        const patch = {
          blockchain_status: 'confirmed',
          issued_at: isoFromUnix(onchain.issuedAt),
          ...metadataAttestationPatch(row, isoFromUnix(onchain.issuedAt)),
          verification_checked_at: now,
          onchain_valid: onchain.valid === true,
          issuer_address: onchain.issuer || row.issuer_address,
          failure_code: null,
          failure_message: null,
          confirmation_started_at: null,
        };
        const updated = await (store.updateCredentialForReconcile
          ? store.updateCredentialForReconcile(row.id, patch, row.updated_at)
          : store.updateCredential(row.id, patch)) || row;
        await markEvaluationIssued(learningRecordStore, updated);
        return { credential: toPublicCredential(updated), status: 'confirmed' };
      }
      return { credential: toPublicCredential(row), status: row.blockchain_status || 'pending', reason: 'no_transaction_hash' };
    }

    // Atomic claim to prevent concurrent confirms.
    let claimed = row;
    if (typeof store.claimConfirm === 'function') {
      const result = await store.claimConfirm(row.id);
      if (!result) {
        const current = await store.findByCode(credentialCode);
        return { credential: toPublicCredential(current), status: current.blockchain_status, reason: 'confirmation_in_progress' };
      }
      claimed = result;
    }
    row = claimed;

    // Guard confirmation updates with the current claim token.
    async function updateIfStillOwner(patch) {
      if (typeof store.updateCredentialIf !== 'function' || !row.confirmation_started_at) {
        throw credentialError('Conditional update unavailable', 'CONFIRMATION_CAS_UNAVAILABLE', 500);
      }
      return store.updateCredentialIf(row.id, patch, row.confirmation_started_at);
    }

    // Preserve newer confirmation results when a stale request fails.
    async function failIfStillOwner(error) {
      const updated = await updateIfStillOwner({
        blockchain_status: 'failed',
        onchain_valid: false,
        issue_tx_hash: hash,
        confirmation_started_at: null,
        ...safeFailure(error),
      });

      if (!updated) {
        const current = await store.findByCode(credentialCode);
        if (!current) {
          throw credentialError('Credential was not found', 'CREDENTIAL_NOT_FOUND', 404);
        }
        return {
          credential: toPublicCredential(current),
          status: current.blockchain_status,
          reason: 'confirmation_in_progress',
        };
      }

      throw error;
    }

    const gateway = await avalancheFactory({ write: false });
    const contractAddress = gateway.contractAddress;
    const issuerAddress = row.issuer_address;

    // Transaction lookup (RPC errors are transient -> pending, not failed).
    let tx;
    try { tx = await gateway.getTransaction(hash); }
    catch (error) {
      if (isRpcError(error)) {
        const updated = await updateIfStillOwner({ blockchain_status: 'pending', issue_tx_hash: hash, confirmation_started_at: null, failure_code: null, failure_message: null });
        const current = updated || await store.findByCode(credentialCode);
        return { credential: toPublicCredential(current), status: current.blockchain_status, reason: updated ? 'rpc_error' : 'confirmation_in_progress' };
      }
      return failIfStillOwner(error);
    }
    if (!tx) {
      const updated = await updateIfStillOwner({ blockchain_status: 'pending', issue_tx_hash: hash, confirmation_started_at: null, failure_code: null, failure_message: null });
      const current = updated || await store.findByCode(credentialCode);
      return { credential: toPublicCredential(current), status: current.blockchain_status, reason: updated ? 'transaction_not_found' : 'confirmation_in_progress' };
    }

    // Validate transaction fields (fatal mismatches -> failed).
    try {
      if (Number(tx.chainId) !== Number(AVALANCHE_FUJI_CHAIN_ID)) {
        throw credentialError('Transaction is on the wrong chain', 'AVALANCHE_WRONG_CHAIN', 409);
      }
      if (String(tx.to || '').toLowerCase() !== String(contractAddress).toLowerCase()) {
        throw credentialError('Transaction destination is invalid', 'INVALID_TRANSACTION_DESTINATION', 409);
      }
      if (issuerAddress && String(tx.from || '').toLowerCase() !== String(issuerAddress).toLowerCase()) {
        throw credentialError('Transaction sender is not the authorized issuer', 'INVALID_TRANSACTION_SENDER', 409);
      }
      const txValue = typeof tx.value === 'bigint' ? tx.value : BigInt(tx.value || 0);
      if (txValue !== 0n) {
        throw credentialError('Transaction value must be zero', 'INVALID_TRANSACTION_VALUE', 409);
      }
      const expectedData = encodeIssueCredential(row.credential_id_hash, row.evidence_hash);
      if (String(tx.data || '').toLowerCase() !== String(expectedData).toLowerCase()) {
        throw credentialError('Transaction calldata does not match the credential', 'INVALID_TRANSACTION_CALLDATA', 409);
      }
    } catch (error) {
      const updated = await updateIfStillOwner({ blockchain_status: 'failed', onchain_valid: false, issue_tx_hash: hash, confirmation_started_at: null, ...safeFailure(error) });
      if (!updated) {
        const current = await store.findByCode(credentialCode);
        if (!current) throw credentialError('Credential was not found', 'CREDENTIAL_NOT_FOUND', 404);
        return { credential: toPublicCredential(current), status: current.blockchain_status, reason: 'confirmation_in_progress' };
      }
      throw error;
    }

    // Receipt lookup (RPC errors transient).
    let receipt;
    try { receipt = await gateway.getTransactionReceipt(hash); }
    catch (error) {
      if (isRpcError(error)) {
        const updated = await updateIfStillOwner({ blockchain_status: 'pending', issue_tx_hash: hash, confirmation_started_at: null, failure_code: null, failure_message: null });
        const current = updated || await store.findByCode(credentialCode);
        return { credential: toPublicCredential(current), status: current.blockchain_status, reason: updated ? 'rpc_error' : 'confirmation_in_progress' };
      }
      return failIfStillOwner(error);
    }
    if (!receipt) {
      const updated = await updateIfStillOwner({ blockchain_status: 'pending', issue_tx_hash: hash, confirmation_started_at: null, failure_code: null, failure_message: null });
      const current = updated || await store.findByCode(credentialCode);
      return { credential: toPublicCredential(current), status: current.blockchain_status, reason: updated ? 'transaction_pending' : 'confirmation_in_progress' };
    }
    if (Number(receipt.status) !== 1) {
      return failIfStillOwner(credentialError('Avalanche transaction was mined but failed', 'AVALANCHE_TRANSACTION_REVERTED', 502));
    }

    // On-chain verification (RPC errors transient).
    let onchain;
    try { onchain = await gateway.verifyCredential(row.credential_id_hash); }
    catch (error) {
      if (isRpcError(error)) {
        const updated = await updateIfStillOwner({ blockchain_status: 'pending', issue_tx_hash: hash, confirmation_started_at: null, failure_code: null, failure_message: null });
        const current = updated || await store.findByCode(credentialCode);
        return { credential: toPublicCredential(current), status: current.blockchain_status, reason: updated ? 'rpc_error' : 'confirmation_in_progress' };
      }
      return failIfStillOwner(error);
    }
    if (!onchain.exists) {
      return failIfStillOwner(credentialError('Credential does not exist on Avalanche', 'CREDENTIAL_NOT_CONFIRMED', 409));
    }
    if (!sameHash(onchain.evidenceHash, row.evidence_hash)) {
      return failIfStillOwner(credentialError('On-chain evidence hash does not match the database', 'EVIDENCE_HASH_MISMATCH', 409));
    }

    const now = new Date().toISOString();
    const patch = {
      blockchain_status: 'confirmed',
      issue_tx_hash: hash,
      issued_at: isoFromUnix(onchain.issuedAt),
      ...metadataAttestationPatch(row, isoFromUnix(onchain.issuedAt)),
      verification_checked_at: now,
      onchain_valid: onchain.valid === true,
      issuer_address: onchain.issuer || row.issuer_address,
      failure_code: null,
      failure_message: null,
      confirmation_started_at: null,
    };
    const updated = await updateIfStillOwner(patch);
    if (!updated) {
      const current = await store.findByCode(credentialCode);
      return { credential: toPublicCredential(current), status: current.blockchain_status, reason: 'confirmation_in_progress' };
    }
    await markEvaluationIssued(learningRecordStore, updated);
    return { credential: toPublicCredential(updated), status: 'confirmed' };
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
    if (typeof store.updateCredentialForVerify !== 'function') {
      throw credentialError('Conditional verification update unavailable', 'VERIFICATION_CAS_UNAVAILABLE', 500);
    }
    const casUpdated = await store.updateCredentialForVerify(row.id, patch, row.updated_at);
    const updatedRow = casUpdated || await store.findByCode(credentialCode);
    if (!updatedRow) {
      throw credentialError('Credential was not found', 'CREDENTIAL_NOT_FOUND', 404);
    }
    const credential = toPublicCredential(updatedRow);
    if (casUpdated) {
      credential.verification.exists = Boolean(onchain.exists);
      credential.verification.revoked = Boolean(onchain.revoked);
    }
    if (updatedRow.blockchain_status === 'confirmed') {
      await markEvaluationIssued(learningRecordStore, updatedRow);
    }
    return credential;
  }

  return {
    issue,
    prepareIssue,
    confirmIssue,
    reconcileCredential,
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
