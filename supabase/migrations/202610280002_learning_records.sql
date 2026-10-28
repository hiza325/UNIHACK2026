-- Persistent learning records for PARADOX AI Debate sessions.
-- Additive migration: no existing table or user data is removed or overwritten.

create extension if not exists pgcrypto;

create table if not exists public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  subject text not null default 'General' check (char_length(subject) between 1 and 80),
  problem_text text not null check (char_length(problem_text) between 3 and 12000),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'analysis_unavailable', 'abandoned')),
  latest_analysis_status text
    check (latest_analysis_status is null or latest_analysis_status in ('correct', 'incorrect', 'insufficient')),
  latest_evaluation_status text
    check (latest_evaluation_status is null or latest_evaluation_status in ('pass', 'needs_improvement', 'insufficient')),
  latest_score smallint check (latest_score is null or latest_score between 0 and 100),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  attempt_number smallint not null check (attempt_number between 1 and 100),
  submission_type text not null check (submission_type in ('initial', 'revision')),
  solution_text text not null check (char_length(solution_text) between 1 and 16000),
  analysis_state text not null default 'pending_analysis'
    check (analysis_state in ('pending_analysis', 'analyzed', 'analysis_failed')),
  ai_analysis jsonb,
  analysis_error_code text,
  analysis_model text,
  submitted_at timestamptz not null default now(),
  analysis_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, attempt_number)
);

create table if not exists public.learning_interactions (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  submission_id uuid references public.learning_submissions(id) on delete set null,
  learner_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('analysis', 'discussion', 'hint')),
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 1800),
  hint_level smallint check (hint_level is null or hint_level between 1 and 3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.learning_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  submission_id uuid not null unique references public.learning_submissions(id) on delete cascade,
  learner_id uuid not null references auth.users(id) on delete cascade,
  rubric_version text not null check (char_length(rubric_version) between 1 and 80),
  score smallint check (score is null or score between 0 and 100),
  status text not null check (status in ('pass', 'needs_improvement', 'insufficient')),
  comment text not null check (char_length(comment) between 1 and 1600),
  criteria jsonb not null default '{}'::jsonb,
  corrected_issues jsonb not null default '[]'::jsonb,
  remaining_issues jsonb not null default '[]'::jsonb,
  proof_record jsonb,
  credential_eligible boolean not null default false,
  credential_id text unique,
  credential_id_hash text unique
    check (credential_id_hash is null or credential_id_hash ~ '^0x[0-9a-f]{64}$'),
  credential_hash text
    check (credential_hash is null or credential_hash ~ '^0x[0-9a-f]{64}$'),
  credential_status text not null default 'not_eligible'
    check (credential_status in ('not_eligible', 'eligible', 'issued', 'revoked')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'revoked')),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eligible_evaluation_has_hashes check (
    credential_eligible = false
    or (credential_id is not null and credential_id_hash is not null and credential_hash is not null)
  )
);

create index if not exists learning_sessions_learner_started_idx
  on public.learning_sessions (learner_id, started_at desc);
create index if not exists learning_sessions_learner_status_idx
  on public.learning_sessions (learner_id, status);
create index if not exists learning_submissions_session_attempt_idx
  on public.learning_submissions (session_id, attempt_number);
create index if not exists learning_interactions_session_created_idx
  on public.learning_interactions (session_id, created_at, id);
create index if not exists learning_evaluations_learner_eligible_idx
  on public.learning_evaluations (learner_id, credential_eligible, evaluated_at desc);

create or replace function public.set_learning_record_updated_at()
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

drop trigger if exists learning_sessions_set_updated_at on public.learning_sessions;
create trigger learning_sessions_set_updated_at
before update on public.learning_sessions
for each row execute function public.set_learning_record_updated_at();

drop trigger if exists learning_submissions_set_updated_at on public.learning_submissions;
create trigger learning_submissions_set_updated_at
before update on public.learning_submissions
for each row execute function public.set_learning_record_updated_at();

drop trigger if exists learning_evaluations_set_updated_at on public.learning_evaluations;
create trigger learning_evaluations_set_updated_at
before update on public.learning_evaluations
for each row execute function public.set_learning_record_updated_at();

alter table public.learning_sessions enable row level security;
alter table public.learning_submissions enable row level security;
alter table public.learning_interactions enable row level security;
alter table public.learning_evaluations enable row level security;

-- Defense in depth for direct Supabase access. The server API still uses the
-- service role and applies the learner_id filter on every request.
drop policy if exists learning_sessions_read_own on public.learning_sessions;
create policy learning_sessions_read_own on public.learning_sessions
  for select to authenticated using (auth.uid() = learner_id);
drop policy if exists learning_submissions_read_own on public.learning_submissions;
create policy learning_submissions_read_own on public.learning_submissions
  for select to authenticated using (auth.uid() = learner_id);
drop policy if exists learning_interactions_read_own on public.learning_interactions;
create policy learning_interactions_read_own on public.learning_interactions
  for select to authenticated using (auth.uid() = learner_id);
drop policy if exists learning_evaluations_read_own on public.learning_evaluations;
create policy learning_evaluations_read_own on public.learning_evaluations
  for select to authenticated using (auth.uid() = learner_id);

revoke insert, update, delete on public.learning_sessions from anon, authenticated;
revoke insert, update, delete on public.learning_submissions from anon, authenticated;
revoke insert, update, delete on public.learning_interactions from anon, authenticated;
revoke insert, update, delete on public.learning_evaluations from anon, authenticated;
grant select on public.learning_sessions to authenticated;
grant select on public.learning_submissions to authenticated;
grant select on public.learning_interactions to authenticated;
grant select on public.learning_evaluations to authenticated;
grant all on public.learning_sessions to service_role;
grant all on public.learning_submissions to service_role;
grant all on public.learning_interactions to service_role;
grant all on public.learning_evaluations to service_role;
grant usage, select on sequence public.learning_interactions_id_seq to service_role;

comment on table public.learning_evaluations is
  'Server-derived AI evaluations. Clients cannot insert or update pass/credential eligibility.';
comment on column public.learning_evaluations.credential_hash is
  'Prepared evidence digest only. No blockchain credential or transaction is fabricated by this migration.';
