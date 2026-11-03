-- Certificate metadata integrity attestation (HMAC-SHA256, server-side secret).
-- Additive migration: existing rows keep NULL attestation and are reported as
-- UNVERIFIED by public verification. Nothing is signed or rewritten here.

alter table public.learning_credentials
  add column if not exists metadata_attestation text
    check (metadata_attestation is null or metadata_attestation ~ '^v1\.[0-9a-f]{64}$');

alter table public.learning_credentials
  add column if not exists metadata_attested_at timestamptz;

comment on column public.learning_credentials.metadata_attestation is
  'HMAC-SHA256 (v1.<hex>) over credentialCode|recipientName|subject|issuedAt. Detects DB tampering; does not anchor metadata on-chain.';

comment on column public.learning_credentials.metadata_attested_at is
  'When the metadata attestation was generated (issuance confirmation).';
