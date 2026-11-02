// Staging credential fixture — creates isolated test data with a unique runId.
// All data is tagged with the runId for cleanup.
// NEVER uses real user data or production credentials.

import { randomUUID } from 'node:crypto';

export function createRunId() {
  return `staging-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createCredentialFixture(runId) {
  const code = `PXP-STAGE-${runId.slice(-8).toUpperCase()}`;
  return {
    runId,
    credentialCode: code,
    credentialIdHash: null, // computed by test
    learnerId: null, // must be set by test (use a dedicated test learner)
    title: `Staging test credential ${runId}`,
    skill: 'Staging test skill',
    assessmentScore: 85,
    evidenceHash: `0x${'ab'.repeat(32)}`,
    source: 'manual-test',
    isTest: true,
  };
}

export function isStagingConfirmed() {
  return process.env.STAGING_SUPABASE_CONFIRMED === '1';
}

export async function cleanupFixture(config, runId) {
  // Best-effort cleanup. Only deletes the specific runId's credential.
  // Does NOT use broad prefix matching.
  if (!isStagingConfirmed()) {
    return { status: 0, ok: false, reason: 'STAGING_SUPABASE_CONFIRMED not set — skipping cleanup' };
  }
  const { url, serviceKey } = config;
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
  try {
    const code = `PXP-STAGE-${runId.slice(-8).toUpperCase()}`;
    const req = await fetch(`${url}/rest/v1/learning_credentials?credential_code=eq.${code}`, {
      method: 'DELETE',
      headers,
    });
    return { status: req.status, ok: req.ok };
  } catch (e) {
    return { status: 0, ok: false, error: String(e) };
  }
}
