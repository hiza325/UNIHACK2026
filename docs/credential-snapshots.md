# Immutable credential snapshots — backend phase

Migration: `supabase/migrations/202610290001_credential_snapshots.sql`.
Apply only after both previous migrations. No migration has been applied by this change.

Official issuance reads the target learner through Supabase Auth Admin GET user,
using the backend service role. It captures explicit `full_name` or `name` metadata;
there is no email fallback. This is the stored Profile name, not identity/KYC verification.
Recipient names sent by clients are ignored.

Subject policy v1 maps the verified evaluation's `paradox-rubric-v1` to
`Critical thinking and reasoning`. Both request skill and session subject are
untrusted labels (session subject originates in client input). Unknown rubrics
block new issuance until a server policy is added. This does not alter achievements
or AI evaluation rules. Manual-test records keep their existing path and no snapshot.

Snapshot metadata is inserted before gateway creation. Failed official retries
reuse the stored name, subject, capture timestamp and evaluation ID; they do not
read the current Profile. Legacy records return `snapshot: null`. Legacy official
issuance retries are blocked; read, verify and revoke remain available. No backfill
is performed. API output adds `snapshot` without removing existing fields.

The store only accepts operational update fields. The DB trigger additionally
rejects snapshot changes (including attempts to fill legacy snapshots), and locks
identity/content fields for versioned snapshots. `issued_at` can transition from
null to a chain-derived timestamp; subsequent identical writes are allowed.
Different timestamps are rejected. Capture time and chain issue time are separate.
Unique credential/evidence constraints remain responsible for concurrent duplicate
INSERT rejection before chain submission. Concurrent retries are not serialized.

## Staging migration validation

1. Use a disposable Supabase test project/database, not Production. Confirm the
   first two migrations are present; record existing credential counts and metadata.
2. Apply the new SQL migration using the approved database workflow. Coordinate
   backend rollout: older official issuance code cannot insert snapshot-less rows
   after this migration. New code requires the migration before use.
3. Run `psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/credential-snapshots.sql`.
   This transaction creates test fixtures, tests protection as `service_role`, then
   rolls back. It requires a connection allowed to insert auth fixtures and SET ROLE.
   On an error psql exits; disconnect rolls back the open transaction.
4. Confirm legacy rows still have NULL snapshot fields, original counts/values are
   intact, and ordinary reads return `snapshot: null`. Test a legacy row's operational
   updates and rejected snapshot backfill inside a rollback-only transaction.
5. Run backend tests using mock Avalanche gateways; do not invoke live issuance.
   Verify capture-before-send, changed Profile on retry, fake client metadata,
   cross-user rejection, verify/revoke and duplicate behavior.

## Remaining boundaries

- Renderer phase 2 now consumes API snapshots for historical official records;
  legacy records cannot export official certificates. Migration/staging validation
  remains required before end-to-end certificate readiness.
- The existing chain hash binds learning evidence, not these display snapshots.
- Existing auth.users ON DELETE CASCADE is unchanged. The new evaluation FK uses
  RESTRICT: deleting referenced evidence is blocked, and deletion of accounts with
  cascading records may also be blocked depending on cascade ordering. Validate
  this in disposable staging and decide retention policy before production rollout.
- RLS/service-role separation does not constrain a database owner who disables
  triggers; these controls protect normal API/store operations.
- Actual PostgreSQL trigger behavior needs the SQL test above; JavaScript mocks
  alone do not establish DB immutability.
