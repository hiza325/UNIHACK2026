# E0 — Risk register (open at the start of Phase E)

Severity: `Critical` blocks acceptance · `High` must be fixed or explicitly accepted · `Medium` / `Low` tracked.
Every entry is a fact observed in the `main` checkout (see `ARCHITECTURE_AUDIT.md`); nothing is inferred from
another branch's documentation.

| ID | Severity | Risk / finding | Evidence on this checkout | Mitigation present | Residual action |
|---|---|---|---|---|---|
| R-01 | Critical | The 7-step AI learning flow cannot be accepted here: the server state machine, lease, quota accounting and replay are absent from `main` | `api/learning-records/_state.js` does not exist; `grep -rn "claimAiAction\|current_step\|allowedActions" api/learning-records/*.js` → none; `202610290002_ai_flow_v2.sql` only in `git diff --stat main p0/ai-flow-v2` | none on `main` | Merge or QA `p0/ai-flow-v2`; category-E cases recorded `BLOCKED` here |
| R-02 | Critical | AI answer quality cannot be measured: no learning-path provider key is configured and the Playwright webServer blanks all keys | env presence table in `ARCHITECTURE_AUDIT.md` §6; `playwright.config.js` webServer env | gateway returns 503 `NOT_CONFIGURED` (fail-closed) | Run real evaluation only after `GEMINI_API_KEY`/`ANYROUTER_LEARNING_API_KEY` are provisioned in Staging; no 90 % claim may be made |
| R-03 | High | Package D remediation (per-IP budgets on `/api/credentials` and `/api/admin/users`, auth-before-store ordering, `redactFailureText` for stored failure messages, negative authz tests) is **not** in this checkout | `grep -rn "guardEndpoint\|redactFailureText" api/` → no match; `git stash show --stat stash@{0}` lists the files | original code still authenticates before issuing/revoking (`api/credentials/index.js:48-56`) | Restore or re-land the stash on the right branch; until then credential/admin endpoints have no per-IP write budget |
| R-04 | High | `api/_ai/contract.js` — the server-only analysis-input builder — is untracked and not imported by `api/debate.js`, so client-supplied history is still trusted on this checkout | `grep -n "contract" api/debate.js` → no match; `normalizeDebatePayload` reads `previousSolution/previousAnalysis/conversation/previousHints/attemptNumber` from the body (`api/debate.js:161-191`) | length/count clamps, mode-gated validation, server-owned system prompt | Land Phase 3.1 wiring or document that learner-history integrity is not yet enforced |
| R-05 | High | Hardcoded admin allowlist in source | `api/auth/_supabase.js:12` fallback `ADMIN_EMAILS` | `app_metadata.role` check also honoured | Remove the fallback or move it to configuration |
| R-06 | High | No CSRF/Origin validation on cookie-authenticated POSTs (`/api/credentials`, `/api/admin/users`, `/api/learning-records`) | no `Origin`/CSRF token check found in `api/`; cookies are `SameSite=Strict` which reduces but does not remove exposure | `SameSite=Strict` + `HttpOnly` + `Secure` | Add double-submit token or strict Origin allowlist |
| R-07 | Medium | Rate limits live in per-instance memory, so a cold start or a second instance resets the counter | `api/auth/_rate-limit.js` module-level `buckets`/`cooldowns`; documented in README | DB-backed daily quotas for learning path (branch only) | Move counters to Postgres/Upstash |
| R-08 | Medium | Credential operations can remain `submitting`/`pending` with no automatic sweeper | `api/credentials/_service.js` writes tx status; `retryFailed` only runs when explicitly invoked | manual `retryFailed` reconciliation | Scheduled reconciliation job + alert |
| R-09 | Medium | No approval workflow table (`credential_requests`) and no admin action audit log | `202610280001_learning_credentials.sql` has `created_by` only; no request/approval table found | `created_by` column | Migration for requests + `admin_action_logs` (Package D decision) |
| R-10 | Medium | Frontend admin gate is cosmetic | `views/admin.js` `if (this.user?.role !== 'admin') return ''` | server-side `requireAdmin` on `/api/admin/users` | Keep server check; add negative API tests (stashed) |
| R-11 | Low | Two `20261031xxxx` migrations are untracked, so a fresh deploy of `main` produces a schema that does not match `api/_ai/contract.js` version expectations | `git status --short` untracked list | `withContractVersions` defaults to `unknown` for `modelVersion` | Commit the migrations with the code that requires them |
| R-12 | Low | `.vscode/settings.json` and `supabase/.temp/` are untracked noise in the acceptance tree | `git status --short` | — | Ignore or remove before release tag |
| R-13 | Info | Chain evidence is Fuji testnet only (CHAIN-01 previously FAIL, see `docs/CHAIN-01-REPORT.md`) | `avalanche-config.js` chainId 43113 | mock issuance is refused server-side | Do not present on-chain credentials as mainnet-verifiable |
| R-14 | Info | `demo.js` and `learning-passport-mock.js` render prototype data in the UI | file headers, `DEMO_ONLY` rows in `MODULE_INVENTORY.md` | server refuses mock evidence (`MOCK_CREDENTIAL_FORBIDDEN`) | Demo script must state which screens are prototype content |

## Acceptance impact summary

- R-01 and R-02 force category E (7-step flow) and all *real-model* accuracy rows to `BLOCKED` /
  `NOT_RUN`; the 90 % target cannot be evaluated on this checkout at all.
- R-03 and R-04 mean the security/contract evidence produced by Phase E tests the **current** code, so a
  PASS there must not be read as proof that the stashed remediation works.
- Everything else is testable and is executed in `tests/ai-acceptance.spec.js`.
