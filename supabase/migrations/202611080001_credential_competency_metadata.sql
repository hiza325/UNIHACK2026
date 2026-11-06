-- Additive migration: competency certificate metadata column.
-- Safe to apply on existing databases; existing rows get null metadata.
alter table public.learning_credentials
  add column if not exists metadata jsonb;

-- Index for competency assessment lookup
create index if not exists learning_credentials_evaluation_id_idx
  on public.learning_credentials (evaluation_id)
  where evaluation_id is not null;
