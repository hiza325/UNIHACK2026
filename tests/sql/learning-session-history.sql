-- Disposable-database test for the learning-session activity triggers.
--
-- Requires PostgreSQL 17 with 202611060001_learning_session_history.sql
-- applied. All fixtures and updates are rolled back.
--
-- Covers the three update shapes that matter for data integrity:
--   1. business columns only  -> updated_at and last_activity_at advance
--   2. last_activity_at only  -> updated_at is preserved, activity advances
--   3. business + activity    -> both timestamps advance

\set ON_ERROR_STOP on
\pset pager off
\echo '=== learning-session trigger behavior test ==='

begin;

insert into auth.users (id, email)
values ('22222222-2222-4222-8222-222222222222', 'trigger@example.test')
on conflict (id) do nothing;

insert into public.learning_sessions (
  id, learner_id, title, problem_text, status, started_at, created_at, updated_at, last_activity_at
)
values
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   'Trigger fixture 1', 'Fixture problem one', 'in_progress',
   '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', '2025-01-05T10:00:00Z', '2025-01-05T10:00:00Z'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
   'Trigger fixture 2', 'Fixture problem two', 'in_progress',
   '2025-02-01T00:00:00Z', '2025-02-01T00:00:00Z', '2025-02-10T10:00:00Z', '2025-02-10T10:00:00Z'),
  ('bbbbbbbb-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222',
   'Trigger fixture 3', 'Fixture problem three', 'in_progress',
   '2025-03-01T00:00:00Z', '2025-03-01T00:00:00Z', '2025-03-20T10:00:00Z', '2025-03-20T10:00:00Z')
on conflict (id) do nothing;

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'learning_sessions'
    and t.tgname = 'learning_sessions_set_updated_at'
    and t.tgenabled <> 'D'
    and position('WHEN' in pg_get_triggerdef(t.oid)) > 0;
  if v_count <> 1 then
    raise exception 'FAIL: guarded learning_sessions_set_updated_at trigger is missing or disabled';
  end if;

  select count(*) into v_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'learning_sessions'
    and t.tgname = 'learning_sessions_touch_activity'
    and t.tgenabled <> 'D';
  if v_count <> 1 then
    raise exception 'FAIL: learning_sessions_touch_activity trigger is missing or disabled';
  end if;
end $$;

-- 1. Business-column update: both audit timestamps advance.
do $$
declare
  v_updated_before timestamptz;
  v_activity_before timestamptz;
  v_updated_after timestamptz;
  v_activity_after timestamptz;
begin
  select updated_at, last_activity_at
  into v_updated_before, v_activity_before
  from public.learning_sessions
  where id = 'bbbbbbbb-0000-4000-8000-000000000001';

  update public.learning_sessions
  set title = 'Trigger fixture 1 - business update'
  where id = 'bbbbbbbb-0000-4000-8000-000000000001'
  returning updated_at, last_activity_at into v_updated_after, v_activity_after;

  if v_updated_after is null or v_updated_after <= v_updated_before then
    raise exception 'FAIL: business update did not advance updated_at (% -> %)',
      v_updated_before, v_updated_after;
  end if;

  if v_activity_after is null or v_activity_after <= v_activity_before then
    raise exception 'FAIL: business update did not advance last_activity_at (% -> %)',
      v_activity_before, v_activity_after;
  end if;
end $$;

-- 2. last_activity_at-only update: updated_at must be preserved.
do $$
declare
  v_updated_before timestamptz;
  v_activity_before timestamptz;
  v_updated_after timestamptz;
  v_activity_after timestamptz;
  v_other_updated timestamptz;
  v_other_activity timestamptz;
begin
  select updated_at, last_activity_at
  into v_updated_before, v_activity_before
  from public.learning_sessions
  where id = 'bbbbbbbb-0000-4000-8000-000000000002';

  -- Snapshot the other fixtures to prove the activity-only UPDATE is scoped.
  select updated_at, last_activity_at
  into v_other_updated, v_other_activity
  from public.learning_sessions
  where id = 'bbbbbbbb-0000-4000-8000-000000000001';

  update public.learning_sessions
  set last_activity_at = '2020-01-01T00:00:00Z'
  where id = 'bbbbbbbb-0000-4000-8000-000000000002'
  returning updated_at, last_activity_at into v_updated_after, v_activity_after;

  if v_updated_after is distinct from v_updated_before then
    raise exception 'FAIL: activity-only update rewrote updated_at (% -> %)',
      v_updated_before, v_updated_after;
  end if;

  if v_activity_after is null or v_activity_after <= v_activity_before then
    raise exception 'FAIL: activity-only update did not advance last_activity_at (% -> %)',
      v_activity_before, v_activity_after;
  end if;

  if v_activity_after = '2020-01-01T00:00:00Z'::timestamptz then
    raise exception 'FAIL: touch trigger did not refresh last_activity_at';
  end if;

  if (select updated_at from public.learning_sessions
      where id = 'bbbbbbbb-0000-4000-8000-000000000001') is distinct from v_other_updated
     or (select last_activity_at from public.learning_sessions
         where id = 'bbbbbbbb-0000-4000-8000-000000000001') is distinct from v_other_activity then
    raise exception 'FAIL: activity-only update modified an unrelated fixture';
  end if;
end $$;

-- 3. Business + activity update together: both audit timestamps advance.
do $$
declare
  v_updated_before timestamptz;
  v_activity_before timestamptz;
  v_updated_after timestamptz;
  v_activity_after timestamptz;
begin
  select updated_at, last_activity_at
  into v_updated_before, v_activity_before
  from public.learning_sessions
  where id = 'bbbbbbbb-0000-4000-8000-000000000003';

  update public.learning_sessions
  set title = 'Trigger fixture 3 - combined update',
      last_activity_at = '2020-01-01T00:00:00Z'
  where id = 'bbbbbbbb-0000-4000-8000-000000000003'
  returning updated_at, last_activity_at into v_updated_after, v_activity_after;

  if v_updated_after is null or v_updated_after <= v_updated_before then
    raise exception 'FAIL: combined update did not advance updated_at (% -> %)',
      v_updated_before, v_updated_after;
  end if;

  if v_activity_after is null or v_activity_after <= v_activity_before then
    raise exception 'FAIL: combined update did not advance last_activity_at (% -> %)',
      v_activity_before, v_activity_after;
  end if;
end $$;

-- 4. The fixtures still exist; the test never deletes learning records.
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from public.learning_sessions
  where id in (
    'bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000003'
  );
  if v_count <> 3 then
    raise exception 'FAIL: fixture sessions were deleted';
  end if;
end $$;

rollback;

\echo 'PASS: business, activity-only and combined updates behave as designed.'
