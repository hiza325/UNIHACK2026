-- Phase 4: Atomic claim for credential confirmation.
-- Apply AFTER 202611020001_certificate_confirmation_hardening.sql (Phase 2).
-- Depends on: confirmation_started_at, confirmation_attempts columns.

-- Atomic claim: sets confirmation_started_at and increments confirmation_attempts
-- in a single UPDATE statement. PostgreSQL row-level lock ensures only one
-- concurrent caller succeeds. Returns the claimed row or NULL if the lock is held.
CREATE OR REPLACE FUNCTION public.claim_credential_confirmation(
  p_id uuid
)
RETURNS public.learning_credentials
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.learning_credentials;
  v_cutoff timestamptz;
BEGIN
  v_cutoff := now() - interval '60 seconds';

  UPDATE public.learning_credentials
  SET confirmation_started_at = now(),
      confirmation_attempts = COALESCE(confirmation_attempts, 0) + 1
  WHERE id = p_id
    AND blockchain_status IN ('submitting', 'pending')
    AND (confirmation_started_at IS NULL OR confirmation_started_at < v_cutoff)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Security: only service_role can execute.
REVOKE ALL ON FUNCTION public.claim_credential_confirmation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_credential_confirmation(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_credential_confirmation(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_credential_confirmation(uuid) TO service_role;

COMMENT ON FUNCTION public.claim_credential_confirmation(uuid) IS
  'Atomically claims a confirmation lock and increments the attempt counter. Returns the claimed row or NULL if the lock is held. Used by credential confirmation flow.';

-- Rollback:
-- DROP FUNCTION IF EXISTS public.claim_credential_confirmation(uuid);