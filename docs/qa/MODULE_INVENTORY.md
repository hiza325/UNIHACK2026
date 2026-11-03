# E0 — Module inventory (verified against the `main` checkout)

Legend for **Status** (Phase E rule: *không được công bố tính năng mock là tính năng production*):

- `IMPLEMENTED` — code exists on this checkout **and** is exercised by an automated test that was run.
- `PARTIALLY_IMPLEMENTED` — code exists; at least one required behaviour is untested or conditional on configuration.
- `PRESENT_UNTESTED` — code exists on this checkout, no automated evidence found.
- `BRANCH_ONLY` — capability exists only on `p0/ai-flow-v2` / `stash@{0}`, absent here.
- `DEMO_ONLY` — frontend prototype data, never persisted, never issued as proof.
- `ABSENT` — not found by inspection.

## Backend (`api/`)

| Module | Lines | Responsibility (verified) | Status |
|---|---|---|---|
| `api/debate.js` | 430 | AI analysis endpoint: `normalizeDebatePayload`, output validation, gateway call, `proofRecord` for `resubmit`, `/api/ai/status` | IMPLEMENTED |
| `api/_ai/gateway.js` | 417 | Provider order, timeouts, bounded retries, fallback, secret `redact()`, error taxonomy | IMPLEMENTED |
| `api/_ai/providers.js` | 113 | Gemini + AnyRouter adapters, `AI_PROVIDER_ENV` mapping | IMPLEMENTED |
| `api/_ai/contract.js` | 634 | Phase 3.1 data contract: client envelope, server-only `buildAnalysisInput`, per-mode output validation, `sanitizeAnalysisForStorage`, `assertStorageSafeAnalysis`, version stamping | PARTIALLY_IMPLEMENTED — untracked file, **not imported by `api/debate.js` on this checkout** |
| `api/learning-records/index.js` | 68 | Session/submission REST: `createSession`, `createSubmission`, `abandonSession`, list, `view=evaluations`, achievement summary; auth before store | IMPLEMENTED |
| `api/learning-records/_service.js` | 487 | Session/submission business rules, per-user ownership filters, achievement summary | IMPLEMENTED |
| `api/learning-records/_store.js` | 129 | Supabase REST access with service role | IMPLEMENTED |
| `api/learning-records/_state.js` | — | 7-state machine, `allowedActions`, `transitionFor`, `publicState`, lease | **BRANCH_ONLY** (file absent here) |
| `api/credentials/index.js` | 66 | Credential API: `GET ?code=`, passport, POST `verify/issue/revoke`; admin gate for issue/revoke; `SAFE_SERVER_CODES` masks unknown 5xx | IMPLEMENTED (rate budget + auth-before-store ordering are **BRANCH_ONLY/stashed**) |
| `api/credentials/_service.js` | 352 | Issue/verify/revoke, `MOCK_CREDENTIAL_FORBIDDEN`, eligibility from stored proof, passport builder, tx state transitions | IMPLEMENTED |
| `api/credentials/_store.js` | 72 | `learning_credentials` + `credential_transactions` access, 503 when DB unconfigured | IMPLEMENTED |
| `api/credentials/_avalanche.js` | 171 | On-chain register/revoke, tx receipt, `retryFailed` reconciliation | PARTIALLY_IMPLEMENTED — real chain evidence is Fuji-only (CHAIN-01) |
| `api/admin/users.js` | 29 | Admin user listing + suspension PATCH via service role | IMPLEMENTED (per-IP budget stashed) |
| `api/auth/_supabase.js` | 152 | `authConfig`, cookie sessions, `currentUser`, ban/suspension check, `requireAdmin`, `sendError` masking | IMPLEMENTED; **hardcoded `ADMIN_EMAILS` fallback at line 12 remains** |
| `api/auth/_rate-limit.js` | 124 | In-memory sliding-window buckets for OTP send/verify (email+IP, cooldown), `RATE_LIMIT_DISABLED` | IMPLEMENTED; `guardEndpoint` for credentials/admin is **stashed** |
| `api/auth/otp.js` / `signup.js` / `verify.js` / `login.js` / `resend.js` / `session.js` / `logout.js` | 19–195 | OTP registration, login, session refresh/clear, logout | IMPLEMENTED |
| `api/auth/_mail.js` | 107 | Resend API or SMTP transport | IMPLEMENTED |
| `api/auth/_password-reset.js`, `api/auth/_suspension.js` | 72, 42 | Reset flow, suspension/appeal helpers | IMPLEMENTED |
| `api/support.js` | 361 | Support chat endpoint with its own provider key and per-IP budget | IMPLEMENTED |
| `api/_support-faq.js` | 2126 | Curated FAQ knowledge | IMPLEMENTED |
| `api/_support-retrieval.js` | 304 | Deterministic retrieval/ranking over FAQ | IMPLEMENTED |

## Frontend (root + `views/`)

| Module | Responsibility | Status |
|---|---|---|
| `app.js`, `app-router.js`, `app-views.js`, `app-config.js`, `app-theme.js`, `app-notifications.js`, `app-events.js` | SPA shell, hash routing, theme, toasts | IMPLEMENTED |
| `app-actions.js` (623) | Debate/analysis calls, `debateErrorText` localisation, retry/disable-while-analysing | IMPLEMENTED |
| `learning-records-actions.js` (205), `learning-records-service.js` (52) | Session/submission persistence UI wiring | IMPLEMENTED |
| `learning-passport-service.js` (164), `learning-passport-actions.js` (110) | Passport read + verification UI | IMPLEMENTED |
| `learning-passport-mock.js` (103) | Prototype passport fixture | **DEMO_ONLY** — server refuses to mint it (`MOCK_CREDENTIAL_FORBIDDEN`) |
| `debate-ai.js` (76), `debate-prompt.js` (59) | Client-side debate helper, server-owned system prompt + `DEBATE_PROMPT_VERSION` | IMPLEMENTED |
| `demo.js` (185) | Sitemap/landing prototype content ("Frontend-only prototype data") | **DEMO_ONLY** |
| `learning-data.js` (160) | Static challenge bank | DEMO_ONLY |
| `views/admin.js` (67) | Admin console UI | PARTIALLY_IMPLEMENTED — `if (this.user?.role !== 'admin') return ''` is a **UI guard only**; the server-side `requireAdmin` is the real control |
| `views/passport.js` (103) | Verify screen with `checking / not-found / network-error / valid / unissued / revoked / demo / unavailable` | IMPLEMENTED |
| other `views/*.js` | landing, shell, dashboard, cards, practice, history, profile, settings, analytics, audit, about, sitemap | IMPLEMENTED (presentation) |
| `i18n.js` (913) | vi/en/jp strings | IMPLEMENTED |

## Contracts & data

| Artifact | Responsibility | Status |
|---|---|---|
| `contracts/`, `hardhat.config.ts`, `avalanche-config.js` | Learning-credential registry on Avalanche Fuji (chainId 43113) | IMPLEMENTED |
| `scripts/deploy-learning-credential-registry.mjs`, `verify-learning-credential-registry.mjs` | Preflight, deploy, verify | PARTIALLY_IMPLEMENTED (requires testnet credentials) |
| `supabase/migrations/202610280001_learning_credentials.sql` | `learning_credentials`, `credential_transactions`, RLS, service-role grants | IMPLEMENTED |
| `supabase/migrations/202610280002_learning_records.sql` | sessions/submissions | IMPLEMENTED |
| `supabase/migrations/202610310001_ai_contract_versions.sql`, `202610310002_ai_flow_phase3_2.sql` | contract version registry, burst windows | BRANCH_ONLY (untracked here; not applied by any script present) |
| `202610290002_ai_flow_v2.sql` (`claim_ai_action`, `finish_ai_action`, `abort_ai_action`, `ai_usage_events`, `ai_quotas`, `support_usage`, lease) | server-authoritative AI flow | **BRANCH_ONLY** |

## New Phase E harness (created by this package)

| Artifact | Responsibility |
|---|---|
| `tests/qa/evaluator.mjs` | Independent deterministic grader: classification, error-location/type, insufficient-data, code, injection rules; metrics (accuracy/precision/recall/F1, confusion matrix, latency percentiles, retry and provider-error rates); JSON/CSV export |
| `tests/qa/logger.mjs` | E5 request-log recorder with the mandated field list and a forbidden-field scrubber + leakage assertion |
| `tests/qa/cases/*.mjs` | Gold-labelled datasets (E1 math, E2 insufficient data, E3 code/injection) and platform case definitions |
| `tests/qa/build-catalog.mjs` | Merges all case sources into `tests/fixtures/ai-acceptance-tests.json` + `docs/qa/TEST_CASE_CATALOG.md` |
| `tests/ai-acceptance.spec.js` | Executable acceptance suite; writes `docs/qa/run-evidence.json` |
