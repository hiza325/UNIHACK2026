# Learning Session History

## Model

The feature reuses the existing learning-record schema instead of creating a
second conversation store:

- `learning_sessions` — one independent learning session per row (`title`,
  `problem_text`, `started_at`, status and timestamps).
- `learning_interactions` — ordered user/assistant messages for analysis,
  discussion and hints; every row has `session_id` and `learner_id`.
- `learning_submissions` — attempts, solutions and AI analysis.
- `learning_evaluations` — rubric results, proof records and credential
  references.

The additive migration `202611060001_learning_session_history.sql` adds:

- `learning_sessions.last_activity_at` (backfilled from `updated_at`/`started_at`).
- `learning_sessions.archived_at` (history visibility only).
- A trigger that refreshes `last_activity_at` when a session is updated.
- Activity/archive indexes. Existing rows, interactions, submissions,
  evaluations, achievements and credentials are not deleted.

### Trigger semantics

The pre-existing `learning_sessions_set_updated_at` trigger is kept enabled but
scoped with a `WHEN` guard. Updates that only touch `updated_at` or
`last_activity_at` are ignored by that trigger, so the historical backfill
cannot rewrite `updated_at`. Business-column updates, and updates that combine
business columns with activity, still advance `updated_at`. The
`learning_sessions_touch_activity` trigger always refreshes `last_activity_at`.

The database tests in `tests/sql/` cover both halves of the contract:

- `learning-session-history-backfill.sql` — applies the migration inside a
  rolled-back transaction on a pre-migration database and proves all historical
  `updated_at` values survive while `last_activity_at` is backfilled exactly.
- `learning-session-history.sql` — proves business-only, activity-only and
  combined updates behave as described.

CI runs both on PostgreSQL 17 via the `database` job in
`.github/workflows/test.yml`, using `tests/sql/supabase-bootstrap.sql` to create
the Supabase auth/roles prerequisites.

Archiving a session removes it from the sidebar/history list. It does **not**
delete submissions, evaluations, achievements, certificates or blockchain
references. The API enforces ownership before rename/archive.

## API

Existing endpoint: `GET/POST /api/learning-records`.

New/changed read options:

- `GET ?limit=&offset=&search=` — scoped to the signed-in learner, excludes
  archived sessions, ordered by `last_activity_at`.
- `GET ?id=` — returns the session plus submissions, interactions and evaluations.

New POST actions:

- `renameSession` `{ sessionId, title }` — title 1–160 characters.
- `archiveSession` `{ sessionId }` — hides the session while retaining records.

The server uses the authenticated learner ID and the service-role store with
explicit `learner_id` filters. Existing RLS select-own policies remain in place;
clients cannot update/delete these tables directly.

## UI

`views/audit.js` renders a left session rail with:

- new session, title search, Today/Yesterday/Previous 7 days/Older groups;
- active session, last activity and status;
- three-dot rename/archive menu with explicit confirmation;
- paginated “load more” when more than 50 sessions exist;
- mobile drawer with backdrop and close control.

The chat area only uses the selected session's interactions. A new session clears
the current problem/solution/result/messages, selected files and previews; no
previous session context is sent to the AI. Refresh restores the saved active
session only after checking it is still present in the user's list.

## Unsaved changes

- A snapshot (`problem`, `solution`, selected file metadata) tracks dirty state.
- Typing or selecting/removing a file marks the session dirty; loading server
  data does not.
- A successful create-session/create-submission response records the snapshot
  and clears dirty state only if no newer edits happened while saving.
- A failed save leaves dirty state enabled.
- `beforeunload` asks the browser to show its native warning when dirty.
- New session, session switch, in-app navigation and browser Back show an
  in-app confirmation modal with “Keep editing” as the default choice.
- Changing sessions while AI is analysing is blocked to prevent late responses
  from being written into another session.
- Modern browsers control the `beforeunload` wording and may suppress it on
  mobile or after a forced browser/process close; the in-app modal remains the
  reliable confirmation for explicit session/page changes.

## Migration order

1. Apply the migration to Staging and verify columns, trigger, indexes and RLS.
2. Deploy the branch to a Staging Preview.
3. Run the session isolation/API/UI tests and a live smoke test.
4. Apply the migration to Production **before** deploying the code.
5. Deploy the code and run the Production smoke test.

The migration should not be applied to Production by the feature branch CI.

## Rollback

- Code rollback: promote the previous Vercel deployment / redeploy the previous
  main commit.
- Database rollback (only if required): restore the original unconditional
  `learning_sessions_set_updated_at` trigger, then drop the activity trigger,
  indexes and the two new columns. Existing learning records are preserved.
  Archiving flags would be lost, so rollback is a last resort after code
  rollback.

## Test commands

```bash
npm ci
npx playwright test tests/learning-records.spec.js tests/learning-sessions.spec.js
npx playwright test tests/app.spec.js
npm run test:all
```

Database tests (disposable PostgreSQL 17 only; never Production/Staging):

```bash
# 1. Create the Supabase auth/role prerequisites once.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/supabase-bootstrap.sql

# 2. Apply every migration before the learning-session history migration.
#    Then run the backfill test; it applies the migration in a rolled-back
#    transaction.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/learning-session-history-backfill.sql

# 3. Apply the learning-session history migration, then test the triggers.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202611060001_learning_session_history.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/learning-session-history.sql
```

Screenshots: `docs/learning-sessions/desktop.png` and
`docs/learning-sessions/mobile.png`.
