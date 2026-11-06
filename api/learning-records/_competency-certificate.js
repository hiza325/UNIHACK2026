import { RUBRIC_VERSION, SKILLS, aggregate, eligibility, validateRatings, validEvidence, fail } from './_competency-engine.js';
import { BANK, BANK_VERSION, publicQuestions } from './_competency-bank.js';

// Certificate eligibility: only passed assessments with valid evidence
export function certificateEligibility(snapshot) {
  if (!snapshot) return { eligible: false, reason: 'No competency data' };
  const passed = (snapshot.history || []).find(a => a.status === 'passed' && a.rubric_version === RUBRIC_VERSION && a.bank_version === BANK_VERSION);
  if (!passed) return { eligible: false, reason: 'No passed competency assessment' };
  if (!snapshot.eligibility?.eligible) return { eligible: false, reason: 'Competency requirements not met' };
  if (!passed.independent) return { eligible: false, reason: 'Independent explanation required' };
  if (!Number.isFinite(passed.final_score) || passed.final_score < 60) return { eligible: false, reason: 'Score below 60' };
  if (!Number.isFinite(passed.result?.total) || passed.result.total < 60) return { eligible: false, reason: 'Competency score below 60' };
  return {
    eligible: true,
    assessmentId: passed.id,
    score: passed.final_score,
    competencyScore: passed.result.total,
    evidenceHash: passed.result?.hash || null,
    reason: 'Competency assessment passed',
  };
}

export { RUBRIC_VERSION, SKILLS, aggregate, eligibility, validateRatings, validEvidence, fail, BANK, BANK_VERSION, publicQuestions };
