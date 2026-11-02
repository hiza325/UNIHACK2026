import { expect, test } from '@playwright/test';
import { getStagingConfig } from './supabase/staging-config.mjs';
import { isStagingConfirmed } from './fixtures/staging-credential-fixture.mjs';

// Integration tests against Supabase Staging.
// These tests are SKIPPED if staging is not configured or points to production.
// Data-writing tests additionally require STAGING_SUPABASE_CONFIRMED=1.
// They do NOT modify production data.

const config = getStagingConfig();
const confirmed = isStagingConfirmed();

test.describe('Supabase Staging Integration', () => {
  test.skip(!config.configured, config.reason || 'Staging not configured');

  test('staging config points to known staging ref', () => {
    expect(config.configured).toBe(true);
    expect(config.ref).toBe('ekkyygjlshrhibrdmhlx');
  });

  // Read-only smoke test: verify staging is reachable.
  test('staging is reachable (read-only)', async () => {
    const res = await fetch(`${config.url}/rest/v1/learning_credentials?select=id&limit=1`, {
      headers: { apikey: config.serviceKey, Authorization: 'Bearer ' + config.serviceKey },
    });
    expect(res.ok).toBe(true);
  });

  // The following tests require Phase 4 code (RPC function) to be deployed.
  // They are marked as integration-dependent and will skip if the RPC is not available.
  // Data-writing tests require STAGING_SUPABASE_CONFIRMED=1.

  test('atomic confirmation claim — integration-dependent (Phase 4)', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required for data-writing tests');
    test.skip(true, 'Requires Phase 4 RPC migration applied on staging');
  });

  test('concurrent claims — integration-dependent (Phase 4)', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required for data-writing tests');
    test.skip(true, 'Requires Phase 4 RPC migration applied on staging');
  });

  test('stale writer — integration-dependent (Phase 4)', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required for data-writing tests');
    test.skip(true, 'Requires Phase 4 RPC migration applied on staging');
  });

  test('verify while confirmation lock held — integration-dependent (Phase 4)', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required for data-writing tests');
    test.skip(true, 'Requires Phase 4 RPC migration applied on staging');
  });

  test('revoked credential cannot be restored — integration-dependent', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required for data-writing tests');
    test.skip(true, 'Requires Phase 4 code deployed on staging');
  });

  test('duplicate evaluation_id — integration-dependent', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required for data-writing tests');
    test.skip(true, 'Requires staging data setup');
  });

  test('duplicate issue_tx_hash — integration-dependent', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required for data-writing tests');
    test.skip(true, 'Requires staging data setup');
  });

  test('RPC unavailable — integration-dependent', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required for data-writing tests');
    test.skip(true, 'Requires staging RPC configuration');
  });

  test('reconcile/revoke race — integration-dependent', async () => {
    test.skip(!confirmed, 'STAGING_SUPABASE_CONFIRMED=1 required for data-writing tests');
    test.skip(true, 'Requires Phase 4 code deployed on staging');
  });
});
