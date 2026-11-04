# PR #14: deterministic session grouping tests

## Failure evidence

GitHub Actions run `41933298915`, job `126935361106`, at
`2026-11-04T23:24Z`: `tests/learning-sessions.spec.js:139` expected 3
`.ls-group` elements, received 2 (including retry); 438 passed, 12 skipped.

The old fixture used Node's current date and local `setDate`/`setHours`.
The application deliberately uses `Asia/Ho_Chi_Minh` via `localDateKey`,
regardless of the host or browser timezone. At that instant UTC was Nov 4,
but Vietnam was Nov 5. On the UTC runner, s1 therefore belonged to yesterday;
s2 and s3 belonged to the same last-seven-days group. Windows in Vietnam
generated the intended today/yesterday/last-seven-days fixtures.

This is a deterministic test-timezone bug, not evidence of a rendering flake.
The application's calendar-day grouping is consistent with its display zone.

## Reproduction and fix

- Exported the pre-fix tracked tree into a disposable Linux Node 22 Bookworm
  container with `TZ=UTC`, `CI=1`, and Chromium installed by Playwright 1.64.1.
- In that export only, anchored the old fixture's `new Date()` and browser
  clock to `2026-11-04T23:24:00Z`, preserving its local date arithmetic.
- Ran the sidebar test without retries: **Expected 3 / Received 2**.
- Fixed the browser date with Playwright `clock.setFixedTime`; fixture dates
  now explicitly use `+07:00` and UTC arithmetic for day offsets. Mock create
  and archive responses use the same fixed instant rather than the host clock.
- Retained the original count assertion and verified each group's session ID.
  Added UTC/Vietnam browser cases for Vietnam midnight and the 7/8-day boundary.

## Pre-push verification

- Linux UTC targeted suite: **16 passed**, retries disabled.
- Linux UTC complete Playwright suite: **441 passed, 12 existing skips**.
- Solidity: **8 passed**.
- PostgreSQL 17 disposable fresh database: historical backfill, migration
  idempotency, forward guard applied twice, and trigger behavior **PASS**.
- Lighthouse CLI 0.15.1: **all assertions PASS**, 4 URLs x 3 runs, unchanged
  median performance threshold 0.75. Used the clean tracked application tree;
  this change only affects test fixtures and this document.

CI results after push are recorded separately on the PR for the resulting SHA.
