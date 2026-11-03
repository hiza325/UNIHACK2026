import { expect, test } from '@playwright/test';
import { getStagingConfig, isStagingConfirmed, hasTestLearner } from './supabase/staging-config.mjs';
import { createRunId, createCredentialFixture, createTestCredential, cleanupFixture, createTestEvaluation, cleanupEvaluationChain } from './fixtures/staging-credential-fixture.mjs';
import { credentialIdFromCode } from '../api/credentials/_avalanche.js';
import { normalizeClaimResponse } from './fixtures/claim-response-normalize.mjs';

// Integration tests against Supabase Staging.
// These tests are SKIPPED if staging is not configured or points to production.
// Data-writing tests additionally require STAGING_SUPABASE_CONFIRMED=1 and a dedicated test learner.
// They do NOT modify production data.
// They do NOT call claim RPC when guards fail.

const config = getStagingConfig();
const confirmed = isStagingConfirmed();
const hasLearner = hasTestLearner();

function stagingHeaders(config) {
  return { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey, 'Content-Type': 'application/json' };
}

function assertStagingGuard(config, confirmed, hasLearner) {
  if (!config.configured) throw new Error('Staging not configured');
  if (config.ref !== 'ekkyygjlshrhibrdmhlx') throw new Error('Not staging ref');
  if (config.ref === 'bwjpnyifsoiwoetxflzf') throw new Error('BLOCKED: Production ref');
  if (!confirmed) throw new Error('STAGING_SUPABASE_CONFIRMED=1 required');
  if (!hasLearner) throw new Error('STAGING_TEST_LEARNER_ID required');
}

// Helper: run cleanup, return result and any cleanup error (does NOT throw).
// Caller is responsible for throwing originalError first, then cleanupError.
async function safeCleanup(config, fixture) {
  let cleanupError = null;
  let cleanupResult = null;
  try {
    cleanupResult = await cleanupFixture(config, fixture);
    if (!cleanupResult.allOk && cleanupResult.results && cleanupResult.results.length > 0) {
      cleanupError = new Error('Cleanup incomplete: ' + JSON.stringify(cleanupResult.results));
    }
    // Verify cleanup
    if (fixture.recordIds.length > 0) {
      for (const id of fixture.recordIds) {
        const verifyRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${id}&select=id`, {
          headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
        });
        const remaining = await verifyRes.json().catch(() => []);
        if (Array.isArray(remaining) && remaining.length > 0) {
          cleanupError = new Error('Cleanup verification failed: record ' + id + ' still exists');
        }
      }
    }
  } catch (e) {
    cleanupError = e;
  }
  return { cleanupResult, cleanupError };
}

test.describe('Supabase Staging Integration', () => {
  test.skip(!config.configured, config.reason || 'Staging not configured');

  test('staging config points to known staging ref', () => {
    expect(config.configured).toBe(true);
    expect(config.ref).toBe('ekkyygjlshrhibrdmhlx');
    expect(config.ref).not.toBe('bwjpnyifsoiwoetxflzf');
  });

  // Read-only smoke test: verify staging is reachable.
  test('staging is reachable (read-only)', async () => {
    const res = await fetch(`${config.url}/rest/v1/learning_credentials?select=id&limit=1`, {
      headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
    });
    expect(res.ok).toBe(true);
  });

  // --- Data-writing tests (require STAGING_SUPABASE_CONFIRMED=1 + dedicated learner) ---

  test('atomic confirmation claim', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    const runId = createRunId();
    const fixture = createCredentialFixture(runId, config.testLearnerId);
    fixture.credentialIdHash = credentialIdFromCode(fixture.credentialCode);

    let originalError = null;
    try {
      const result = await createTestCredential(config, fixture);
      expect(result.ok).toBe(true);
      expect(result.row).toBeTruthy();
      expect(result.row.blockchain_status).toBe('submitting');
      expect(result.row.id).toBeTruthy();
      fixture.recordIds.push(result.row.id);

      // Verify record exists
      const getRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&select=*`, {
        headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
      });
      expect(getRes.ok).toBe(true);
      const rows = await getRes.json();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(result.row.id);
      expect(rows[0].credential_code).toBe(fixture.credentialCode);

      // Claim via RPC
      const claimRes = await fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
        method: 'POST',
        headers: stagingHeaders(config),
        body: JSON.stringify({ p_id: result.row.id }),
      });
      expect(claimRes.ok).toBe(true);
      const claimed = await claimRes.json();
      const claimedRow = Array.isArray(claimed) ? claimed[0] : claimed;
      expect(claimedRow).toBeTruthy();
      expect(claimedRow.confirmation_started_at).toBeTruthy();
      expect(claimedRow.confirmation_attempts).toBe(1);
      expect(claimedRow.blockchain_status).toBe('submitting');
    } catch (e) {
      originalError = e;
    } finally {
      const { cleanupError } = await safeCleanup(config, fixture);
      if (cleanupError) {
        // Surface cleanup error without hiding original
        if (originalError) {
          throw new AggregateError([originalError, cleanupError], 'Test failed and cleanup failed');
        }
        throw cleanupError;
      }
    }
    if (originalError) throw originalError;
  });

  test('concurrent claims — only one succeeds', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    const runId = createRunId();
    const fixture = createCredentialFixture(runId, config.testLearnerId);
    fixture.credentialIdHash = credentialIdFromCode(fixture.credentialCode);

    let originalError = null;
    try {
      const result = await createTestCredential(config, fixture);
      expect(result.ok).toBe(true);
      fixture.recordIds.push(result.row.id);

      const [r1, r2] = await Promise.all([
        fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
          method: 'POST',
          headers: stagingHeaders(config),
          body: JSON.stringify({ p_id: result.row.id }),
        }),
        fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
          method: 'POST',
          headers: stagingHeaders(config),
          body: JSON.stringify({ p_id: result.row.id }),
        }),
      ]);

      // Parse responses, handling all PostgREST response shapes.
      let b1 = null, b2 = null;
      try { b1 = await r1.json(); } catch (_) { b1 = null; }
      try { b2 = await r2.json(); } catch (_) { b2 = null; }
      const normalize = (b) => {
        if (b === null || b === undefined) return null;
        if (Array.isArray(b)) return b.length > 0 && b[0] && b[0].id ? b[0] : null;
        if (typeof b === 'object' && b.id) return b;
        return null;
      };
      const row1 = normalize(b1);
      const row2 = normalize(b2);

      // Log HTTP statuses for diagnosis (no secrets).
      console.log('concurrent claim statuses:', r1.status, r2.status);
      console.log('concurrent claim parsed:', JSON.stringify({ row1: !!row1, row2: !!row2 }));

      // Exactly one should succeed (non-null), the other null
      const successes = [row1, row2].filter((r) => r !== null);
      expect(successes.length).toBe(1);
      expect(successes[0].confirmation_attempts).toBe(1);
      expect(successes[0].confirmation_started_at).toBeTruthy();
    } catch (e) {
      originalError = e;
    } finally {
      const { cleanupError } = await safeCleanup(config, fixture);
      if (cleanupError) {
        // Surface cleanup error without hiding original
        if (originalError) {
          throw new AggregateError([originalError, cleanupError], 'Test failed and cleanup failed');
        }
        throw cleanupError;
      }
    }
    if (originalError) throw originalError;
  });

  test('active confirmation lock blocks immediate re-claim', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    const runId = createRunId();
    const fixture = createCredentialFixture(runId, config.testLearnerId);
    fixture.credentialIdHash = credentialIdFromCode(fixture.credentialCode);

    let originalError = null;
    try {
      const result = await createTestCredential(config, fixture);
      expect(result.ok).toBe(true);
      fixture.recordIds.push(result.row.id);

      const r1 = await fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
        method: 'POST',
        headers: stagingHeaders(config),
        body: JSON.stringify({ p_id: result.row.id }),
      });
      const b1 = await r1.json().catch(() => null);
      const row1 = (b1 && typeof b1 === 'object' && !Array.isArray(b1)) ? (b1.id ? b1 : null) : (Array.isArray(b1) && b1.length > 0 && b1[0] && b1[0].id ? b1[0] : null);
      expect(row1).toBeTruthy();
      expect(row1.confirmation_attempts).toBe(1);

      const r2 = await fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
        method: 'POST',
        headers: stagingHeaders(config),
        body: JSON.stringify({ p_id: result.row.id }),
      });
      const b2 = await r2.json().catch(() => null);
      const row2 = (b2 && typeof b2 === 'object' && !Array.isArray(b2)) ? (b2.id ? b2 : null) : (Array.isArray(b2) && b2.length > 0 && b2[0] && b2[0].id ? b2[0] : null);
      expect(row2).toBeNull();
    } catch (e) {
      originalError = e;
    } finally {
      const { cleanupError } = await safeCleanup(config, fixture);
      if (cleanupError) {
        // Surface cleanup error without hiding original
        if (originalError) {
          throw new AggregateError([originalError, cleanupError], 'Test failed and cleanup failed');
        }
        throw cleanupError;
      }
    }
    if (originalError) throw originalError;
  });

  test('lock expiry allows re-claim', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    const runId = createRunId();
    const fixture = createCredentialFixture(runId, config.testLearnerId);
    fixture.credentialIdHash = credentialIdFromCode(fixture.credentialCode);

    let originalError = null;
    try {
      const result = await createTestCredential(config, fixture);
      expect(result.ok).toBe(true);
      fixture.recordIds.push(result.row.id);

      const r1 = await fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
        method: 'POST',
        headers: stagingHeaders(config),
        body: JSON.stringify({ p_id: result.row.id }),
      });
      const b1 = await r1.json().catch(() => null);
      const row1 = normalizeClaimResponse(b1, result.row.id);
      expect(row1).toBeTruthy();
      expect(row1.id).toBe(result.row.id);
      expect(row1.confirmation_attempts).toBe(1);

      const r1b = await fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
        method: 'POST',
        headers: stagingHeaders(config),
        body: JSON.stringify({ p_id: result.row.id }),
      });
      const b1b = await r1b.json().catch(() => null);
      const row1b = normalizeClaimResponse(b1b, result.row.id);
      expect(row1b).toBeNull();

      const checkRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&select=confirmation_attempts`, {
        headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
      });
      const checkRows = await checkRes.json();
      expect(checkRows[0].confirmation_attempts).toBe(1);

      const expiredTime = new Date(Date.now() - 120000).toISOString();
      const expireRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({ confirmation_started_at: expiredTime }),
      });
      expect(expireRes.ok).toBe(true);

      const r2 = await fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
        method: 'POST',
        headers: stagingHeaders(config),
        body: JSON.stringify({ p_id: result.row.id }),
      });
      const b2 = await r2.json().catch(() => null);
      const row2 = normalizeClaimResponse(b2, result.row.id);
      expect(row2).toBeTruthy();
      expect(row2.id).toBe(result.row.id);
      expect(row2.confirmation_attempts).toBe(2);
      expect(row2.confirmation_started_at).toBeTruthy();
      expect(Number.isNaN(Date.parse(row2.confirmation_started_at))).toBe(false);
      expect(row2.confirmation_started_at).not.toBe(expiredTime);
    } catch (e) {
      originalError = e;
    } finally {
      const { cleanupError } = await safeCleanup(config, fixture);
      if (cleanupError) {
        // Surface cleanup error without hiding original
        if (originalError) {
          throw new AggregateError([originalError, cleanupError], 'Test failed and cleanup failed');
        }
        throw cleanupError;
      }
    }
    if (originalError) throw originalError;
  });

  test('CAS fencing token — stale request cannot write', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    const runId = createRunId();
    const fixture = createCredentialFixture(runId, config.testLearnerId);
    fixture.credentialIdHash = credentialIdFromCode(fixture.credentialCode);

    let originalError = null;
    try {
      const result = await createTestCredential(config, fixture);
      expect(result.ok).toBe(true);
      fixture.recordIds.push(result.row.id);

      const claimRes = await fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
        method: 'POST',
        headers: stagingHeaders(config),
        body: JSON.stringify({ p_id: result.row.id }),
      });
      const claimed = await claimRes.json();
      const claimedRow = Array.isArray(claimed) ? claimed[0] : claimed;
      const fencingToken = claimedRow.confirmation_started_at;

      const expiredTime = new Date(Date.now() - 120000).toISOString();
      await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({ confirmation_started_at: expiredTime }),
      });
      const reClaimRes = await fetch(`${config.url}/rest/v1/rpc/claim_credential_confirmation`, {
        method: 'POST',
        headers: stagingHeaders(config),
        body: JSON.stringify({ p_id: result.row.id }),
      });
      const reClaimed = await reClaimRes.json();
      const reClaimedRow = Array.isArray(reClaimed) ? reClaimed[0] : reClaimed;
      expect(reClaimedRow.confirmation_started_at).not.toBe(fencingToken);

      const staleRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&confirmation_started_at=eq.${encodeURIComponent(fencingToken)}&blockchain_status=in.(submitting,pending)&select=*`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({ blockchain_status: 'confirmed' }),
      });
      const staleData = await staleRes.json().catch(() => null);
      const staleRow = Array.isArray(staleData) ? staleData[0] : staleData;
      expect(staleRow).toBeFalsy();
    } catch (e) {
      originalError = e;
    } finally {
      const { cleanupError } = await safeCleanup(config, fixture);
      if (cleanupError) {
        // Surface cleanup error without hiding original
        if (originalError) {
          throw new AggregateError([originalError, cleanupError], 'Test failed and cleanup failed');
        }
        throw cleanupError;
      }
    }
    if (originalError) throw originalError;
  });

  test('revoked credential cannot be restored', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    const runId = createRunId();
    const fixture = createCredentialFixture(runId, config.testLearnerId);
    fixture.credentialIdHash = credentialIdFromCode(fixture.credentialCode);

    let originalError = null;
    try {
      const result = await createTestCredential(config, fixture);
      expect(result.ok).toBe(true);
      fixture.recordIds.push(result.row.id);

      const confirmRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({
          blockchain_status: 'confirmed',
          onchain_valid: true,
          issued_at: new Date().toISOString(),
          verification_checked_at: new Date().toISOString(),
          issuer_address: '0x2222222222222222222222222222222222222222',
        }),
      });
      expect(confirmRes.ok).toBe(true);

      const getConfirmed = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&select=blockchain_status`, {
        headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
      });
      const confirmedRows = await getConfirmed.json();
      expect(confirmedRows[0].blockchain_status).toBe('confirmed');

      const revokeRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({
          blockchain_status: 'revoked',
          revoked_at: new Date().toISOString(),
          onchain_valid: false,
          verification_checked_at: new Date().toISOString(),
        }),
      });
      expect(revokeRes.ok).toBe(true);

      const getRevoked = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&select=blockchain_status`, {
        headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
      });
      const revokedRows = await getRevoked.json();
      expect(revokedRows[0].blockchain_status).toBe('revoked');

      const casRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&blockchain_status=in.(submitting,pending)&select=*`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({ blockchain_status: 'confirmed' }),
      });
      const casData = await casRes.json().catch(() => null);
      const casRow = Array.isArray(casData) ? casData[0] : casData;
      expect(casRow).toBeFalsy();

      const getFinal = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&select=blockchain_status`, {
        headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
      });
      const finalRows = await getFinal.json();
      expect(finalRows[0].blockchain_status).toBe('revoked');
    } catch (e) {
      originalError = e;
    } finally {
      const { cleanupError } = await safeCleanup(config, fixture);
      if (cleanupError) {
        // Surface cleanup error without hiding original
        if (originalError) {
          throw new AggregateError([originalError, cleanupError], 'Test failed and cleanup failed');
        }
        throw cleanupError;
      }
    }
    if (originalError) throw originalError;
  });

  test('duplicate evaluation_id is rejected', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    const runId = createRunId();
    const chain = { credentialIds: [], evaluationId: null, submissionId: null, sessionId: null };

    const makeHash = (seed, variant = 0) => {
      let h = String(seed).replace(/[^a-f0-9]/g, '').padEnd(64, '0').slice(0, 64);
      if (variant) {
        const flipped = ((parseInt(h.charAt(63), 16) + variant) % 16).toString(16);
        h = h.slice(0, 63) + flipped;
      }
      return '0x' + h;
    };

    let originalError = null;
    try {
      // 1. Create a valid test evaluation chain.
      const evalResult = await createTestEvaluation(config, runId, config.testLearnerId);
      expect(evalResult.ok).toBe(true);
      chain.sessionId = evalResult.session.id;
      chain.submissionId = evalResult.submission.id;
      chain.evaluationId = evalResult.evaluation.id;

      const suffix = runId.slice(-8).toUpperCase().replace(/[^A-Z0-9]/g, '0');
      const codeA = `PXP-STAGE-${suffix}A`;
      const codeB = `PXP-STAGE-${suffix}B`;
      const hashA = makeHash(runId, 0);
      const hashB = makeHash(runId, 1);
      const evHashA = makeHash(runId + 'e1', 0);
      const evHashB = makeHash(runId + 'e1', 1);
      const now = new Date().toISOString();
      const snap = { recipient_name_snapshot: 'Staging Test Learner', subject_snapshot: 'Reasoning', snapshot_version: 1, snapshot_captured_at: now };

      const aiHeaders = { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey, 'Content-Type': 'application/json', Prefer: 'return=representation' };

      // 2. INSERT credential A with evaluation_id = X.
      const bodyA = {
        learner_id: config.testLearnerId,
        created_by: config.testLearnerId,
        credential_code: codeA,
        credential_id_hash: hashA,
        evidence_hash: evHashA,
        title: `Staging test credential A ${runId}`,
        skill: 'Reasoning',
        assessment_score: 90,
        source: 'ai-evaluation',
        is_test: false,
        blockchain_status: 'submitting',
        network: 'avalanche-fuji',
        chain_id: 43113,
        evaluation_id: chain.evaluationId,
        ...snap,
      };
      const resA = await fetch(`${config.url}/rest/v1/learning_credentials`, { method: 'POST', headers: aiHeaders, body: JSON.stringify(bodyA) });
      const dataA = await resA.json().catch(() => null);
      expect(resA.ok).toBe(true);
      const rowA = Array.isArray(dataA) ? dataA[0] : dataA;
      expect(rowA).toBeTruthy();
      chain.credentialIds.push(rowA.id);

      // 3. INSERT credential B with the SAME evaluation_id but different unique fields.
      const bodyB = {
        learner_id: config.testLearnerId,
        created_by: config.testLearnerId,
        credential_code: codeB,
        credential_id_hash: hashB,
        evidence_hash: evHashB,
        title: `Staging test credential B ${runId}`,
        skill: 'Reasoning',
        assessment_score: 90,
        source: 'ai-evaluation',
        is_test: false,
        blockchain_status: 'submitting',
        network: 'avalanche-fuji',
        chain_id: 43113,
        evaluation_id: chain.evaluationId,
        ...snap,
      };
      const resB = await fetch(`${config.url}/rest/v1/learning_credentials`, { method: 'POST', headers: aiHeaders, body: JSON.stringify(bodyB) });
      const dataB = await resB.json().catch(() => null);
      // Database must reject duplicate evaluation_id (partial unique index).
      expect(resB.ok).toBe(false);
      const isDup = resB.status === 409 || dataB?.code === '23505' ||
        (typeof dataB?.message === 'string' && /duplicate|unique/i.test(dataB.message));
      expect(isDup).toBe(true);
      if (resB.ok && dataB && dataB.id) chain.credentialIds.push(dataB.id);

      // 4. SELECT: only one credential for evaluation X.
      const selRes = await fetch(`${config.url}/rest/v1/learning_credentials?evaluation_id=eq.${chain.evaluationId}&select=id`, {
        headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
      });
      const selData = await selRes.json().catch(() => []);
      expect(Array.isArray(selData)).toBe(true);
      expect(selData.length).toBe(1);
      expect(selData[0].id).toBe(rowA.id);
    } catch (e) {
      originalError = e;
    } finally {
      const cleanupResult = await cleanupEvaluationChain(config, chain);
      if (!cleanupResult.allOk) {
        const cleanupError = new Error('Evaluation-chain cleanup failed: ' + JSON.stringify(cleanupResult.results));
        if (originalError) {
          throw new AggregateError([originalError, cleanupError], 'Test failed and cleanup failed');
        }
        throw cleanupError;
      }
    }
    if (originalError) throw originalError;
  });

  test('duplicate issue_tx_hash is rejected', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    const runId = createRunId();
    const fixture1 = createCredentialFixture(runId, config.testLearnerId);
    fixture1.credentialIdHash = credentialIdFromCode(fixture1.credentialCode);
    const txHash = '0x' + '11'.repeat(32);

    let originalError = null;
    let fixture2 = null;
    try {
      const result1 = await createTestCredential(config, fixture1);
      expect(result1.ok).toBe(true);
      fixture1.recordIds.push(result1.row.id);

      const setTxRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result1.row.id}`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({ issue_tx_hash: txHash }),
      });
      expect(setTxRes.ok).toBe(true);

      fixture2 = createCredentialFixture(runId + '-dup', config.testLearnerId);
      fixture2.credentialIdHash = credentialIdFromCode(fixture2.credentialCode);
      const result2 = await createTestCredential(config, fixture2);
      expect(result2.ok).toBe(true);
      fixture2.recordIds.push(result2.row.id);

      const dupRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result2.row.id}`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({ issue_tx_hash: txHash }),
      });
      expect(dupRes.status).toBe(409);

      const getRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result1.row.id}&select=issue_tx_hash`, {
        headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
      });
      const rows = await getRes.json();
      expect(rows[0].issue_tx_hash).toBe(txHash);
    } catch (e) {
      originalError = e;
    } finally {
      await safeCleanup(config, fixture1, originalError);
      if (fixture2) await safeCleanup(config, fixture2, originalError);
    }
    if (originalError) throw originalError;
  });

  test('RPC unavailable returns error', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    // Call a non-existent RPC function to verify error handling.
    const res = await fetch(`${config.url}/rest/v1/rpc/nonexistent_function_xyz`, {
      method: 'POST',
      headers: stagingHeaders(config),
      body: JSON.stringify({}),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('reconcile/revoke race', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required');
    test.skip(!hasLearner, 'STAGING_TEST_LEARNER_ID required');

    assertStagingGuard(config, confirmed, hasLearner);

    const runId = createRunId();
    const fixture = createCredentialFixture(runId, config.testLearnerId);
    fixture.credentialIdHash = credentialIdFromCode(fixture.credentialCode);

    let originalError = null;
    try {
      const result = await createTestCredential(config, fixture);
      expect(result.ok).toBe(true);
      fixture.recordIds.push(result.row.id);

      const confirmRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({
          blockchain_status: 'confirmed',
          onchain_valid: true,
          issued_at: new Date().toISOString(),
          verification_checked_at: new Date().toISOString(),
          issuer_address: '0x2222222222222222222222222222222222222222',
        }),
      });
      expect(confirmRes.ok).toBe(true);

      const revokeRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({
          blockchain_status: 'revoked',
          revoked_at: new Date().toISOString(),
          onchain_valid: false,
          verification_checked_at: new Date().toISOString(),
        }),
      });
      expect(revokeRes.ok).toBe(true);

      const getRevoked = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&select=blockchain_status`, {
        headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
      });
      const revokedRows = await getRevoked.json();
      expect(revokedRows[0].blockchain_status).toBe('revoked');

      const staleReconRes = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&blockchain_status=in.(submitting,pending)&select=*`, {
        method: 'PATCH',
        headers: stagingHeaders(config),
        body: JSON.stringify({ blockchain_status: 'confirmed' }),
      });
      const staleData = await staleReconRes.json().catch(() => null);
      const staleRow = Array.isArray(staleData) ? staleData[0] : staleData;
      expect(staleRow).toBeFalsy();

      const getFinal = await fetch(`${config.url}/rest/v1/learning_credentials?id=eq.${result.row.id}&select=blockchain_status`, {
        headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
      });
      const finalRows = await getFinal.json();
      expect(finalRows[0].blockchain_status).toBe('revoked');
    } catch (e) {
      originalError = e;
    } finally {
      const { cleanupError } = await safeCleanup(config, fixture);
      if (cleanupError) {
        if (originalError) {
          throw new AggregateError([originalError, cleanupError], 'Test failed and cleanup failed');
        }
        throw cleanupError;
      }
    }
    if (originalError) throw originalError;
  });

});
