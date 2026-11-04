-- Disposable-database test for the 202611060001 backfill.
--
-- Requires PostgreSQL 17 with every migration BEFORE
-- 202611060001_learning_session_history.sql already applied. The migration is
-- then applied inside a transaction that is rolled back, so the database is
-- left untouched.
--
-- The test proves that the historical backfill writes last_activity_at without
-- firing the unconditional updated_at trigger.

\set ON_ERROR_STOP on
\pset pager off
\echo '=== learning-session history backfill test ==='

begin;

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'backfill@example.test')
on conflict (id) do nothing;

insert into public.learning_sessions (
  id, learner_id, title, problem_text, status, started_at, created_at, updated_at
)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Backfill fixture 1', 'Fixture problem one', 'completed',
   '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', '2025-01-05T10:00:00Z'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Backfill fixture 2', 'Fixture problem two', 'completed',
   '2025-02-01T00:00:00Z', '2025-02-01T00:00:00Z', '2025-02-10T10:00:00Z'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'Backfill fixture 3', 'Fixture problem three', 'completed',
   '2025-03-01T00:00:00Z', '2025-03-01T00:00:00Z', '2025-03-20T10:00:00Z')
on conflict (id) do nothing;

create temp table history_backfill_before on commit drop as
select id,
       updated_at,
       coalesce(updated_at, started_at, created_at, now()) as expected_last_activity_at
from public.learning_sessions
where id in (
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000002',
  'aaaaaaaa-0000-4000-8000-000000000003'
);

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'learning_sessions'
    and column_name in ('last_activity_at', 'archived_at');
  if v_count <> 0 then
    raise exception 'FAIL: pre-migration database already has the new columns';
  end if;

  select count(*) into v_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'learning_sessions'
    and t.tgname = 'learning_sessions_set_updated_at'
    and t.tgenabled <> 'D'
    and position('WHEN' in pg_get_triggerdef(t.oid)) = 0;
  if v_count <> 1 then
    raise exception 'FAIL: expected the original unconditional learning_sessions_set_updated_at trigger';
  end if;

  select count(*) into v_count from history_backfill_before;
  if v_count <> 3 then
    raise exception 'FAIL: expected 3 fixture sessions, found %', v_count;
  end if;
end $$;

\ir ../../supabase/migrations/202611060001_learning_session_history.sql

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'learning_sessions'
    and column_name in ('last_activity_at', 'archived_at');
  if v_count <> 2 then
    raise exception 'FAIL: migration did not add both columns (found %)', v_count;
  end if;

  select count(*) into v_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'learning_sessions'
    and t.tgname = 'learning_sessions_set_updated_at'
    and t.tgenabled <> 'D'
    and position('WHEN' in pg_get_triggerdef(t.oid)) > 0;
  if v_count <> 1 then
    raise exception 'FAIL: trigger was not replaced with an enabled guarded definition';
  end if;

  select count(*) into v_count
  from history_backfill_before b
  join public.learning_sessions s using (id)
  where b.updated_at is distinct from s.updated_at;
  if v_count <> 0 then
    raise exception 'FAIL: backfill rewrote updated_at for % session(s)', v_count;
  end if;

  select count(*) into v_count
  from history_backfill_before b
  join public.learning_sessions s using (id)
  where s.last_activity_at is distinct from b.expected_last_activity_at;
  if v_count <> 0 then
    raise exception 'FAIL: last_activity_at mismatch for % session(s)', v_count;
  end if;

  select count(distinct updated_at) into v_count
  from public.learning_sessions
  where id in (
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000003'
  );
  if v_count <> 3 then
    raise exception 'FAIL: expected 3 distinct historical updated_at values, found %', v_count;
  end if;
end $$;

rollback;

\echo 'PASS: backfill preserved every historical updated_at and backfilled last_activity_at exactly.'
