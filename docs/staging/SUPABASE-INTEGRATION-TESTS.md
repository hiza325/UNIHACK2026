# PARADOX AI — Supabase Staging Integration Tests

## Overview
This document describes the Supabase Staging integration test setup for Phase 2.

## Staging Configuration
- **Project ref:** `ekkyygjlshrhibrdmhlx`
- **App URL:** `https://paradox-ai-staging.vercel.app`
- **Production ref:** `bwjpnyifsoiwoetxflzf` (NEVER connect tests to this)

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Staging Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Staging service role key |
| `STAGING_SUPABASE_CONFIRMED` | For data-writing tests | Set to `1` to enable data-writing tests |
| `STAGING_TEST_LEARNER_ID` | For data-writing tests | Dedicated test learner UUID |

## Guard
All integration tests call `getStagingConfig()` from `tests/supabase/staging-config.mjs`.
If staging is not configured or points to production, tests are **skipped** with a clear reason.
Data-writing tests additionally require `STAGING_SUPABASE_CONFIRMED=1` and `STAGING_TEST_LEARNER_ID`.

## Test Scenarios (integration-dependent)
1. Atomic confirmation claim
2. Concurrent claims
3. Stale writer
4. Verify while confirmation lock held
5. Revoked credential cannot be restored
6. Duplicate evaluation_id
7. Duplicate issue_tx_hash
8. RPC unavailable
9. Reconcile/revoke race

## Fixture & Cleanup
- `tests/fixtures/staging-credential-fixture.mjs` provides `createRunId()`, `createCredentialFixture()`, `createTestCredential()`, `cleanupFixture()`.
- Run IDs are collision-resistant: `staging-run-${Date.now()}-${randomUUID().slice(0,8)}`.
- Cleanup targets **exact record IDs** tracked in `fixture.recordIds`, never broad prefix matching.
- Cleanup is guarded by `STAGING_SUPABASE_CONFIRMED=1` and is best-effort.

## Running
```bash
# Without staging config (tests skip):
npx playwright test tests/supabase-integration.spec.js

# With staging config (read-only tests run, data-writing skip):
SUPABASE_URL=https://ekkyygjlshrhibrdmhlx.supabase.co \\
SUPABASE_SERVICE_ROLE_KEY=<key> \\
npx playwright test tests/supabase-integration.spec.js

# With full confirmation (data-writing tests enabled):
SUPABASE_URL=https://ekkyygjlshrhibrdmhlx.supabase.co \\
SUPABASE_SERVICE_ROLE_KEY=<key> \\
STAGING_SUPABASE_CONFIRMED=1 \\
STAGING_TEST_LEARNER_ID=<uuid> \\
npx playwright test tests/supabase-integration.spec.js
```

## Safety Rules
- Never connect to production (`bwjpnyifsoiwoetxflzf`).
- Use dedicated test learners, never real user data.
- Tag all test data with a unique runId for cleanup.
- Cleanup only deletes records tracked by exact ID.
- Do not modify existing credentials or evaluations.
- Do not send blockchain transactions.
- Do not apply migrations from tests.
- Do not print secrets.
