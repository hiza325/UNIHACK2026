# PARADOX AI — Supabase Staging Integration Tests

## Overview
This document describes the Supabase Staging integration test setup for Phase 2.

## Staging Configuration
- **Project ref:** `ekkyygjlshrhibrdmhlx`
- **App URL:** `https://paradox-ai-staging.vercel.app`
- **Production ref:** `bwjpnyifsoiwoetxflzf` (NEVER connect tests to this)

## Guard
All integration tests call `getStagingConfig()` from `tests/supabase/staging-config.mjs`.
If staging is not configured or points to production, tests are **skipped** with a clear reason.

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

## Running
```bash
# Without staging config (tests skip):
npx playwright test tests/supabase-integration.spec.js

# With staging config (set env vars):
SUPABASE_URL=https://ekkyygjlshrhibrdmhlx.supabase.co \\
SUPABASE_SERVICE_ROLE_KEY=<key> \\
npx playwright test tests/supabase-integration.spec.js
```

## Safety Rules
- Never connect to production (`bwjpnyifsoiwoetxflzf`).
- Use dedicated test learners, never real user data.
- Tag all test data with a unique runId for cleanup.
- Do not modify existing credentials or evaluations.
- Do not send blockchain transactions.
- Do not apply migrations from tests.
