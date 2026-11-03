// Staging credential fixture — creates isolated test data with a unique runId.
// All data is tagged with the runId for cleanup.
// NEVER uses real user data or production credentials.

import { randomUUID } from 'node:crypto';

export function createRunId() {
  return `staging-run-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function isStagingConfirmed() {
  return process.env.STAGING_SUPABASE_CONFIRMED === '1';
}

export function hasTestLearner() {
  return !!process.env.STAGING_TEST_LEARNER_ID;
}

export function getTestLearnerId() {
  return process.env.STAGING_TEST_LEARNER_ID || null;
}

export function createCredentialFixture(runId, learnerId) {
  const code = `PXP-STAGE-${runId.slice(-12).toUpperCase()}`;
  return {
    runId,
    credentialCode: code,
    credentialIdHash: null,
    learnerId,
    title: `Staging test credential ${runId}`,
    skill: 'Staging test skill',
    assessmentScore: 85,
    evidenceHash: `0x${runId.replace(/[^a-f0-9]/g, '').padEnd(64, '0').slice(0, 64)}`,
    source: 'manual-test',
    isTest: true,
    recordIds: [], // tracks created record IDs for exact cleanup
  };
}

export async function createTestCredential(config, fixture) {
  if (!isStagingConfirmed()) {
    return { ok: false, reason: 'STAGING_SUPABASE_CONFIRMED not set' };
  }
  if (!fixture.learnerId) {
    return { ok: false, reason: 'learnerId required' };
  }
  const headers = { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const body = {
    learner_id: fixture.learnerId,
    created_by: fixture.learnerId,
    credential_code: fixture.credentialCode,
    credential_id_hash: fixture.credentialIdHash,
    evidence_hash: fixture.evidenceHash,
    title: fixture.title,
    skill: fixture.skill,
    assessment_score: fixture.assessmentScore,
    source: fixture.source,
    is_test: fixture.isTest,
    blockchain_status: 'submitting',
    network: 'avalanche-fuji',
    chain_id: 43113,
  };
  try {
    const res = await fetch(`${config.url}/rest/v1/learning_credentials`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: data };
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.id) fixture.recordIds.push(row.id);
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function cleanupFixture(config, fixture) {
  // Only deletes records tracked in fixture.recordIds (exact IDs).
  // Never uses broad prefix matching.
  if (!isStagingConfirmed()) {
    return { status: 0, ok: false, reason: 'STAGING_SUPABASE_CONFIRMED not set — skipping cleanup' };
  }
  const { url, serviceKey } = config;
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
  const results = [];
  for (const id of fixture.recordIds) {
    try {
      // Ownership verification: fetch record and verify it belongs to this test.
      const getRes = await fetch(`${url}/rest/v1/learning_credentials?id=eq.${id}&select=id,credential_code,is_test,learner_id`, {
        headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
      });
      const rows = await getRes.json().catch(() => []);
      if (!Array.isArray(rows) || rows.length === 0) {
        results.push({ id, status: 404, ok: true, reason: 'not found (already deleted)' });
        continue;
      }
      const row = rows[0];
      const codeMatches = row.credential_code === `PXP-STAGE-${fixture.runId.slice(-12).toUpperCase()}`;
      const isTest = row.is_test === true;
      const learnerMatches = row.learner_id === fixture.learnerId;
      if (!codeMatches || !isTest || !learnerMatches) {
        results.push({ id, status: 403, ok: false, reason: 'ownership verification failed' });
        continue;
      }
      const res = await fetch(`${url}/rest/v1/learning_credentials?id=eq.${id}`, {
        method: 'DELETE',
        headers,
      });
      results.push({ id, status: res.status, ok: res.ok });
    } catch (e) {
      results.push({ id, status: 0, ok: false, error: String(e) });
    }
  }
  return { results, allOk: results.every((r) => r.ok) };
}
