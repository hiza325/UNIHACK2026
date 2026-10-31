-- STAGING-SAFE IMMUTABLE CERTIFICATE SNAPSHOT TEST
-- Target project: ekkyygjlshrhibrdmhlx ONLY.
-- DO NOT RUN ON PRODUCTION bwjpnyifsoiwoetxflzf.
--
-- Safety properties:
--   * The whole file is one transaction: BEGIN ... ROLLBACK.
--   * No COMMIT exists.
--   * Fixtures use new UUIDs and are rolled back.
--   * Existing rows are never updated except inside the transaction and then rolled back.
--
-- Supabase SQL Editor instructions:
--   1. Confirm the selected project is ekkyygjlshrhibrdmhlx.
--   2. Paste the ENTIRE file into one SQL Editor query.
--   3. Run it once.
--   4. If any error appears, immediately run: ROLLBACK;
--   5. Do not run statements one by one.
--
-- Expected successful notice:
--   NOTICE: PASS: service_role cannot change snapshot; retry, verify and revoke updates succeed
--
-- Read-only counts to run separately before and after:
--   SELECT count(*) FROM public.learning_credentials;
--   SELECT count(*) FROM public.learning_evaluations;
--   SELECT count(*) FROM public.learning_sessions;
--   SELECT count(*) FROM public.learning_submissions;

BEGIN;

DO $$
DECLARE
  learner uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  submission uuid := gen_random_uuid();
  evaluation uuid := gen_random_uuid();
  credential uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, aud, role)
  VALUES (learner, 'authenticated', 'authenticated');

  INSERT INTO public.learning_sessions(id, learner_id, title, problem_text)
  VALUES (session_id, learner, 'SQL snapshot fixture', 'Test problem');

  INSERT INTO public.learning_submissions(id, session_id, learner_id, attempt_number, submission_type, solution_text)
  VALUES (submission, session_id, learner, 1, 'initial', 'Test solution');

  INSERT INTO public.learning_evaluations(
    id, session_id, submission_id, learner_id, rubric_version, status, comment,
    credential_eligible, credential_id, credential_id_hash, credential_hash
  )
  VALUES (
    evaluation, session_id, submission, learner, 'paradox-rubric-v1', 'pass', 'SQL fixture only', true,
    credential::text,
    '0x' || encode(digest(credential::text, 'sha256'), 'hex'),
    '0x' || repeat('ac', 32)
  );

  INSERT INTO public.learning_credentials(
    id, learner_id, credential_code, credential_id_hash, evidence_hash,
    title, skill, source, created_by,
    recipient_name_snapshot, subject_snapshot, snapshot_version, snapshot_captured_at, evaluation_id
  )
  VALUES (
    credential, learner,
    'PXP-' || upper(credential::text),
    '0x' || encode(digest(credential::text, 'sha256'), 'hex'),
    '0x' || encode(digest(evaluation::text, 'sha256'), 'hex'),
    'SQL fixture only',
    'Critical thinking and reasoning',
    'ai-evaluation', learner,
    'Nguyễn Minh Anh', 'Critical thinking and reasoning', 1, now(), evaluation
  );

  PERFORM set_config('test.snapshot_credential', credential::text, true);
END $$;

SET LOCAL ROLE service_role;

DO $$
DECLARE
  target uuid := current_setting('test.snapshot_credential')::uuid;
  statement text;
BEGIN
  FOREACH statement IN ARRAY ARRAY[
    'recipient_name_snapshot = ''Changed''',
    'subject_snapshot = ''Changed''',
    'snapshot_version = null',
    'snapshot_captured_at = now() + interval ''1 day''',
    'evaluation_id = null',
    'skill = ''Changed''',
    'credential_code = ''PXP-TAMPERED-0001'''
  ] LOOP
    BEGIN
      EXECUTE 'UPDATE public.learning_credentials SET ' || statement || ' WHERE id = $1' USING target;
      RAISE EXCEPTION 'FAIL: protected update accepted: %', statement;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  -- Status changes and the first authoritative issued_at write must succeed.
  UPDATE public.learning_credentials SET blockchain_status = 'pending'
  WHERE id = target;

  UPDATE public.learning_credentials
  SET blockchain_status = 'failed', failure_code = 'TEST'
  WHERE id = target;

  UPDATE public.learning_credentials
  SET blockchain_status = 'confirmed',
      issued_at = '2026-10-29T12:00:00Z',
      onchain_valid = true,
      verification_checked_at = now(),
      failure_code = null
  WHERE id = target;

  UPDATE public.learning_credentials
  SET issued_at = '2026-10-29T12:00:00Z',
      verification_checked_at = now()
  WHERE id = target;

  BEGIN
    UPDATE public.learning_credentials
    SET issued_at = '2026-10-30T12:00:00Z'
    WHERE id = target;
    RAISE EXCEPTION 'FAIL: issued_at changed';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE public.learning_credentials SET blockchain_status = 'revoke_pending'
  WHERE id = target;

  UPDATE public.learning_credentials
  SET blockchain_status = 'revoked',
      revoked_at = now(),
      onchain_valid = false
  WHERE id = target;

  RAISE NOTICE 'PASS: service_role cannot change snapshot; retry, verify and revoke updates succeed';
END $$;

ROLLBACK;