-- ZK Proof of Learning foundation (Phase 2.1).
--
-- Additive only. This migration does not modify learning_evaluations,
-- learning_credentials, OP1 metadata attestation, or Avalanche registry data.
-- It stores PUBLIC proof artifacts only. No score, nonce, witness, or private
-- evaluator key is stored here.
--
-- Apply only after staging review and explicit approval. This file was not
-- applied to Supabase as part of Phase 2.1.

begin;

create extension if not exists pgcrypto;

create table if not exists public.zk_proofs (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.learning_evaluations(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  credential_id_hash text not null
    check (credential_id_hash ~ '^0x[0-9a-f]{64}$'),
  evidence_hash text not null
    check (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  threshold smallint not null
    check (threshold between 1 and 100),
  circuit_version text not null
    check (char_length(circuit_version) between 1 and 64),
  vkey_hash text not null
    check (vkey_hash ~ '^[0-9a-f]{64}$'),
  commitment text not null
    check (commitment ~ '^[0-9]+$'),
  public_signals jsonb not null
    check (jsonb_typeof(public_signals) = 'array' and jsonb_array_length(public_signals) = 6),
  proof jsonb not null
    check (jsonb_typeof(proof) = 'object'),
  attestation jsonb not null
    check (jsonb_typeof(attestation) = 'object'),
  issuer_key_id text not null
    check (char_length(issuer_key_id) between 1 and 100),
  issued_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'superseded')),
  -- Server-side classification snapshot. Never supplied by a client.
  proof_mode text not null default 'demo'
    check (proof_mode in ('demo', 'official')),
  credential_is_test boolean not null default true,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zk_proofs_official_not_test
    check (proof_mode <> 'official' or credential_is_test = false),
  constraint zk_proofs_revoked_at_consistent
    check (
      (status = 'revoked' and revoked_at is not null)
      or (status <> 'revoked' and revoked_at is null)
    )
);

-- Only one ACTIVE proof per evaluation/threshold/circuit version. Historical
-- revoked/superseded rows remain available for audit and key rotation.
create unique index if not exists zk_proofs_active_eval_threshold_circuit_idx
  on public.zk_proofs (evaluation_id, threshold, circuit_version)
  where status = 'active';

create index if not exists zk_proofs_learner_created_idx
  on public.zk_proofs (learner_id, created_at desc);

create index if not exists zk_proofs_credential_id_hash_idx
  on public.zk_proofs (credential_id_hash);

create index if not exists zk_proofs_status_idx
  on public.zk_proofs (status);

create index if not exists zk_proofs_proof_mode_idx
  on public.zk_proofs (proof_mode);

create or replace function public.set_zk_proof_updated_at()
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

drop trigger if exists zk_proofs_set_updated_at on public.zk_proofs;
create trigger zk_proofs_set_updated_at
before update on public.zk_proofs
for each row execute function public.set_zk_proof_updated_at();

comment on table public.zk_proofs is
  'Public ZK Proof of Learning artifacts. The score, nonce, witness and evaluator private key are never stored.';

comment on column public.zk_proofs.evaluation_id is
  'Internal reference to the server-owned AI evaluation. Never returned by the public API projection.';

comment on column public.zk_proofs.learner_id is
  'Internal owner reference. The public API uses learnerBinding, not this column.';

comment on column public.zk_proofs.public_signals is
  'Groth16 public signals in circuit order: threshold, commitment, evaluationIdHash, learnerBinding, evidenceHash, credentialIdHash.';

comment on column public.zk_proofs.proof is
  'Groth16 proof JSON only. No witness, score or nonce.';

comment on column public.zk_proofs.attestation is
  'Ed25519 evaluator attestation JSON. Contains no score, nonce or private key.';

comment on column public.zk_proofs.proof_mode is
  'Server-derived snapshot only: demo or official. Official also requires production setup and a non-test credential at verification time.';

comment on column public.zk_proofs.credential_is_test is
  'Server-derived snapshot from learning_credentials.is_test or the PXP-TEST- prefix. Never supplied by a client.';

comment on column public.zk_proofs.revoked_at is
  'Set with status=revoked; on-chain revocation is still checked live during verification.';

-- Direct client access is denied. The backend uses the service role and
-- returns only the allowlisted projection from api/zk/_projection.js.
alter table public.zk_proofs enable row level security;
alter table public.zk_proofs force row level security;

revoke all on table public.zk_proofs from public, anon, authenticated;

grant select, insert, update, delete on table public.zk_proofs to service_role;

drop policy if exists zk_proofs_service_role_all on public.zk_proofs;
create policy zk_proofs_service_role_all
  on public.zk_proofs
  for all
  to service_role
  using (true)
  with check (true);

commit;

-- Rollback (manual, only after approval):
-- begin;
-- drop policy if exists zk_proofs_service_role_all on public.zk_proofs;
-- drop table if exists public.zk_proofs;
-- commit;
