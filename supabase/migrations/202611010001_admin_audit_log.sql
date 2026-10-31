-- Admin audit trail (ADM-04).
--
-- Records every privileged action: who (actor), what (action), on which target,
-- and when. Written by api/admin/_audit.js through the service role only, so
-- RLS stays closed for anon/authenticated. Audit writes are best-effort in code:
-- a missing table must not block an admin action.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_id uuid not null references auth.users(id),
  actor_email text,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_id, created_at desc);

alter table public.admin_audit_log enable row level security;

revoke all on public.admin_audit_log from anon, authenticated;
