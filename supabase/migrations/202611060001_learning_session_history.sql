-- Learning-session history support.
-- Additive only: existing sessions, interactions, submissions, evaluations,
-- achievements and credentials are preserved. Archiving hides a session from
-- the history list without deleting learning records.

alter table public.learning_sessions
  add column if not exists last_activity_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Backfill from the existing audit timestamp before making the new column
-- required. Existing rows are never deleted or rewritten beyond this timestamp.
update public.learning_sessions
set last_activity_at = coalesce(updated_at, started_at, created_at, now())
where last_activity_at is null;

alter table public.learning_sessions
  alter column last_activity_at set default now();

alter table public.learning_sessions
  alter column last_activity_at set not null;

create index if not exists learning_sessions_learner_activity_idx
  on public.learning_sessions (learner_id, last_activity_at desc)
  where archived_at is null;

create index if not exists learning_sessions_learner_archived_idx
  on public.learning_sessions (learner_id, archived_at, last_activity_at desc);

create or replace function public.touch_learning_session_activity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.last_activity_at = now();
  return new;
end;
$$;

drop trigger if exists learning_sessions_touch_activity on public.learning_sessions;
create trigger learning_sessions_touch_activity
before update on public.learning_sessions
for each row execute function public.touch_learning_session_activity();

comment on column public.learning_sessions.last_activity_at is
  'Last documented or user activity in this learning session.';
comment on column public.learning_sessions.archived_at is
  'When the learner removed the session from their history list. Learning records are retained.';
