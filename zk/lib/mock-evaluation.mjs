import { createHash, randomUUID } from 'node:crypto';
import { normalizeEvidenceHash, normalizeEvaluationId, normalizeLearnerId } from './field.mjs';

export const MOCK_EVALUATION_SCHEMA_VERSION = 'paradox-learning-evaluation-v1';

/**
 * Local mock of the evaluation row produced by the existing AI debate flow.
 * Deliberately mirrors only the fields needed by the ZK layer; no production
 * module is imported and no database is touched.
 */
export function createMockEvaluation({
  score = 92,
  learnerId = randomUUID(),
  evaluationId = randomUUID(),
  problem = 'Solve 2x + 3 = 11.',
  previousSolution = 'x = 4',
  solution = '2x = 8, therefore x = 4.',
  credentialId = `PXP-2026-${evaluationId.replace(/-/g, '').slice(0, 8).toUpperCase()}-0001`,
  evidenceHash: suppliedEvidenceHash,
  model = 'mock-ai-evaluator',
  evaluatedAt = new Date(),
} = {}) {
  const numericScore = Number(score);
  if (!Number.isInteger(numericScore) || numericScore < 0 || numericScore > 100) {
    throw new RangeError('Mock score must be an integer between 0 and 100');
  }
  const computedEvidenceHash = createHash('sha256')
    .update(JSON.stringify({ problem, previousSolution, solution }))
    .digest('hex');
  const evidenceHash = suppliedEvidenceHash ?? computedEvidenceHash;

  return {
    schemaVersion: MOCK_EVALUATION_SCHEMA_VERSION,
    evaluationId: normalizeEvaluationId(evaluationId),
    learnerId: normalizeLearnerId(learnerId),
    evidenceHash: normalizeEvidenceHash(evidenceHash),
    credentialId: String(credentialId || ''),
    score: numericScore,
    status: numericScore >= 75 ? 'pass' : 'needs_improvement',
    rubricVersion: 'paradox-rubric-v1',
    model,
    evaluatedAt: new Date(evaluatedAt).toISOString(),
    source: { type: 'mock', authoritative: false },
  };
}

/**
 * Read-only adapter sketch for the existing learning_records evaluation row.
 * This is documentation-grade glue for a future server integration; it is not
 * wired into any production endpoint.
 */
export function evaluationFromLearningRecord(row) {
  if (!row || typeof row !== 'object') throw new TypeError('Learning record row is required');
  const evidenceHash = row.credential_hash
    ? String(row.credential_hash).replace(/^0x/i, '')
    : row.proof_record?.contentHash;
  return {
    schemaVersion: MOCK_EVALUATION_SCHEMA_VERSION,
    evaluationId: normalizeEvaluationId(row.id),
    learnerId: normalizeLearnerId(row.learner_id),
    evidenceHash: normalizeEvidenceHash(evidenceHash),
    credentialId: String(row.credential_id || ''),
    score: Number(row.score),
    status: row.status,
    rubricVersion: row.rubric_version,
    model: row.proof_record?.model || null,
    evaluatedAt: row.evaluated_at,
    source: { type: 'learning_records', authoritative: true },
  };
}
