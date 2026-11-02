-- Additive only. Hardens certificate confirmation and reconciliation.
-- No existing data is removed or overwritten. Safe to re-run.
-- Apply with Supabase CLI or SQL editor before enabling the new reconciliation paths.

begin;

-- Confirmation claim tracking (avoids a new blockchain_status enum value).
alter table public.learning_credentials
  add column if not exists confirmation_started_at timestamptz,
  add column if not exists confirmation_attempts integer not null default 0;

-- Case-insensitive uniqueness for issuance transaction hashes.
-- Preflight: select lower(issue_tx_hash), count(*) from learning_credentials group by 1 having count(*)>1;
create unique index if not exists learning_credentials_issue_tx_hash_ci_unique_idx
  on public.learning_credentials (lower(issue_tx_hash))
  where issue_tx_hash is not null;

-- Helps reconciliation scans for stuck submitting/pending rows.
create index if not exists learning_credentials_pending_reconcile_idx
  on public.learning_credentials (blockchain_status, confirmation_started_at, created_at)
  where blockchain_status in ('submitting', 'pending');

-- Prevent issuing more than one AI credential for the same evaluation.
create unique index if not exists learning_credentials_evaluation_id_ai_unique_idx
  on public.learning_credentials (evaluation_id)
  where evaluation_id is not null and source = 'ai-evaluation';

-- Ensure learning_evaluations can represent the issued lifecycle without a schema change.
-- credential_status already supports 'issued'/'revoked'; verification_status already supports 'verified'.
-- No new columns are required for Phase 1.

commit;

-- Rollback (manual, only if needed):
-- begin;
-- drop index if exists learning_credentials_pending_reconcile_idx;
-- drop index if exists learning_credentials_issue_tx_hash_ci_unique_idx;
-- drop index if exists learning_credentials_evaluation_id_ai_unique_idx;
-- alter table public.learning_credentials
--   drop column if exists confirmation_started_at,
--   drop column if exists confirmation_attempts;
-- commit;