-- Run ONLY in a disposable migrated staging/test database using psql -v ON_ERROR_STOP=1.
-- All fixtures and updates are rolled back. Never contacts Avalanche.
begin;
do $$
declare
  learner uuid := gen_random_uuid(); session_id uuid := gen_random_uuid();
  submission uuid := gen_random_uuid(); evaluation uuid := gen_random_uuid(); credential uuid := gen_random_uuid();
begin
  insert into auth.users(id) values (learner);
  insert into public.learning_sessions(id, learner_id, title, problem_text)
    values(session_id, learner, 'SQL snapshot fixture', 'Test problem');
  insert into public.learning_submissions(id, session_id, learner_id, attempt_number, submission_type, solution_text)
    values(submission, session_id, learner, 1, 'initial', 'Test solution');
  insert into public.learning_evaluations(id, session_id, submission_id, learner_id, rubric_version, status, comment,
    credential_eligible, credential_id, credential_id_hash, credential_hash)
    values(evaluation, session_id, submission, learner, 'paradox-rubric-v1', 'pass', 'SQL fixture only', true,
      credential::text, '0x' || encode(digest(credential::text, 'sha256'), 'hex'), '0x' || repeat('ac',32));
  insert into public.learning_credentials(id, learner_id, credential_code, credential_id_hash, evidence_hash,
    title, skill, source, created_by, recipient_name_snapshot, subject_snapshot, snapshot_version, snapshot_captured_at, evaluation_id)
    values(credential, learner, 'PXP-' || upper(credential::text), '0x' || encode(digest(credential::text, 'sha256'), 'hex'),
      '0x' || encode(digest(evaluation::text, 'sha256'), 'hex'), 'SQL fixture only', 'Critical thinking and reasoning',
      'ai-evaluation', learner, 'Nguyễn Minh Anh', 'Critical thinking and reasoning', 1, now(), evaluation);
  perform set_config('test.snapshot_credential', credential::text, true);
end $$;

set local role service_role;
do $$
declare
  target uuid := current_setting('test.snapshot_credential')::uuid;
  statement text;
begin
  foreach statement in array array[
    'recipient_name_snapshot = ''Changed''',
    'subject_snapshot = ''Changed''',
    'snapshot_version = null',
    'snapshot_captured_at = now() + interval ''1 day''',
    'evaluation_id = null',
    'skill = ''Changed''',
    'credential_code = ''PXP-TAMPERED-0001'''
  ] loop
    begin
      execute 'update public.learning_credentials set ' || statement || ' where id = $1' using target;
      raise exception 'FAIL: protected update accepted: %', statement;
    exception when check_violation then null;
    end;
  end loop;
  -- Status changes and the first authoritative issued_at write must succeed.
  update public.learning_credentials set blockchain_status = 'pending' where id = target;
  update public.learning_credentials set blockchain_status = 'failed', failure_code = 'TEST' where id = target;
  update public.learning_credentials set blockchain_status = 'confirmed', issued_at = '2026-10-29T12:00:00Z',
    onchain_valid = true, verification_checked_at = now(), failure_code = null where id = target;
  update public.learning_credentials set issued_at = '2026-10-29T12:00:00Z', verification_checked_at = now() where id = target;
  begin
    update public.learning_credentials set issued_at = '2026-10-30T12:00:00Z' where id = target;
    raise exception 'FAIL: issued_at changed';
  exception when check_violation then null;
  end;
  update public.learning_credentials set blockchain_status = 'revoke_pending' where id = target;
  update public.learning_credentials set blockchain_status = 'revoked', revoked_at = now(), onchain_valid = false where id = target;
  raise notice 'PASS: service_role cannot change snapshot; retry, verify and revoke updates succeed';
end $$;
rollback;
