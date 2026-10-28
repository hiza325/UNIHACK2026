-- PARADOX AI Proof of Learning persistence.
-- Apply with the Supabase CLI or SQL editor before enabling the credential API.

create extension if not exists pgcrypto;

create table if not exists public.learning_credentials (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  credential_code text not null unique check (credential_code ~ '^[A-Z0-9-]{8,80}$'),
  credential_id_hash text not null unique check (credential_id_hash ~ '^0x[0-9a-f]{64}$'),
  evidence_hash text not null unique check (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  title text not null check (char_length(title) between 1 and 160),
  skill text not null check (char_length(skill) between 1 and 120),
  assessment_score smallint check (assessment_score between 0 and 100),
  source text not null check (source in ('ai-evaluation', 'manual-test')),
  is_test boolean not null default false,
  blockchain_status text not null default 'submitting'
    check (blockchain_status in ('submitting', 'pending', 'confirmed', 'revoke_pending', 'revoked', 'failed')),
  network text not null default 'avalanche-fuji' check (network = 'avalanche-fuji'),
  chain_id integer not null default 43113 check (chain_id = 43113),
  contract_address text check (contract_address is null or contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  issuer_address text check (issuer_address is null or issuer_address ~ '^0x[0-9a-fA-F]{40}$'),
  issue_tx_hash text unique check (issue_tx_hash is null or issue_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  revoke_tx_hash text unique check (revoke_tx_hash is null or revoke_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  issued_at timestamptz,
  revoked_at timestamptz,
  verification_checked_at timestamptz,
  onchain_valid boolean not null default false,
  failure_code text,
  failure_message text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_test_is_always_labelled check (source <> 'manual-test' or is_test = true)
);

create table if not exists public.credential_transactions (
  id bigint generated always as identity primary key,
  credential_id uuid not null references public.learning_credentials(id) on delete cascade,
  operation text not null check (operation in ('issue', 'revoke')),
  status text not null check (status in ('submitting', 'pending', 'confirmed', 'failed')),
  transaction_hash text unique check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  block_number bigint,
  gas_used numeric(78, 0),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_credentials_learner_created_idx
  on public.learning_credentials (learner_id, created_at desc);
create index if not exists learning_credentials_status_idx
  on public.learning_credentials (blockchain_status);
create index if not exists credential_transactions_credential_idx
  on public.credential_transactions (credential_id, created_at desc);

create or replace function public.set_learning_credential_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists learning_credentials_set_updated_at on public.learning_credentials;
create trigger learning_credentials_set_updated_at
before update on public.learning_credentials
for each row execute function public.set_learning_credential_updated_at();

drop trigger if exists credential_transactions_set_updated_at on public.credential_transactions;
create trigger credential_transactions_set_updated_at
before update on public.credential_transactions
for each row execute function public.set_learning_credential_updated_at();

alter table public.learning_credentials enable row level security;
alter table public.credential_transactions enable row level security;

revoke all on table public.learning_credentials from anon, authenticated;
revoke all on table public.credential_transactions from anon, authenticated;
grant all on table public.learning_credentials to service_role;
grant all on table public.credential_transactions to service_role;
grant usage, select on sequence public.credential_transactions_id_seq to service_role;

comment on table public.learning_credentials is
  'Off-chain credential metadata and Avalanche Fuji transaction state. No submitted work is stored on-chain.';
comment on column public.learning_credentials.evidence_hash is
  'SHA-256 digest only; never store the underlying learner submission here.';
