# E0 — Architecture audit (Phase E pre-implementation survey)

Audited checkout: `C:\Users\MSI 13 AI\Downloads\UNIHACK2026`
Commit under test: `3378f22895815dd02c774f4b1a480b76ccd3b285` — `fix(security): verify credential evidence ownership` (2026-10-29)
Branch: `main` (identical to `origin/main`, 0 ahead / 0 behind)
Audit date: 2026-11-01
Method: read-only inspection of tracked files + `git status` / `git log` / `git diff --stat`, environment variable **presence** only (values never printed), no data written.

---

## 1. Git state — material finding

`git status --short` at the start of Phase E:

```
?? .vscode/settings.json
?? api/_ai/contract.js
?? docs/AI-CONTRACT.md
?? docs/STAGING-BACKUP-RUNBOOK.md
?? docs/audit/04-package-d-ops-report.md
?? supabase/.temp/
?? supabase/migrations/202610310001_ai_contract_versions.sql
?? supabase/migrations/202610310002_ai_flow_phase3_2.sql
?? tests/ai-contract.spec.js
```

Other refs present:

```
* main
  p0/ai-flow-v2
  stash@{0}: On p0/ai-flow-v2: "Luu cong viec dang lam"
```

`git diff --stat main p0/ai-flow-v2` reports 17 files / +2518 −343, including
`supabase/migrations/202610290002_ai_flow_v2.sql` (+983), `api/learning-records/_state.js` (+80),
`scripts/verify-ai-flow-sql.mjs` (+312) and `docs/AI-FLOW-V2-SPEC.md` (+180).

Consequences that constrain every later Phase E activity:

1. **The server-authoritative 7-state AI flow machine does not exist on this checkout.**
   `api/learning-records/_state.js` is absent (`cat` returns *No such file or directory*), and
   `grep -rn "claimAiAction|current_step|allowedActions" api/learning-records/*.js` returns no match.
   The machine lives on branch `p0/ai-flow-v2`.
2. **The Package D remediation is not in this checkout either.** It was uncommitted work on
   `p0/ai-flow-v2` and is now inside `stash@{0}` (`git stash show --stat` lists
   `api/auth/_rate-limit.js +28`, `api/credentials/index.js +28`, `api/credentials/_service.js +20`,
   `api/admin/users.js +2`, `tests/credentials.spec.js +197`, `tests/auth-api.spec.js +66`).
   Verified on the working tree: `grep -rn "guardEndpoint" api/` → **no match**,
   `grep -rn "redactFailureText" api/` → **no match**, `grep -c "stubAuthServer" tests/credentials.spec.js` → **0**.
3. **Four untracked files belong to the other branch's work** (`api/_ai/contract.js`,
   `tests/ai-contract.spec.js`, two `20261031xxxx` migrations). `api/debate.js` on this checkout does
   **not** import `api/_ai/contract.js` (`grep -n "contract" api/debate.js` → no match), so the contract
   module is present but **not wired into the served endpoint**. It is still importable and testable on its own.
4. `package.json` on this checkout has no `test:sql` script; the PGlite SQL harness is branch-only.

**Decision recorded:** Phase E is executed against this checkout (`main`). Anything that can only be
evidenced by the `p0/ai-flow-v2` / `stash@{0}` code is catalogued as `NOT_IMPLEMENTED` or `BLOCKED`
with the pointer to where it does exist — it is never reported as passing here.
`docs/audit/04-package-d-ops-report.md` describes the stashed remediation, not this checkout.

---

## 2. Runtime topology (verified)

| Layer | Implementation | Evidence |
|---|---|---|
| Frontend | Static ES modules, no bundler, hash routing | `index.html`, `app.js`, `app-router.js`, `app-views.js`, `views/` |
| API | Vercel Node serverless functions under `api/` | `vercel.json`, `api/debate.js`, `api/credentials/index.js`, `api/learning-records/index.js`, `api/admin/users.js`, `api/auth/*`, `api/support.js` |
| AI gateway | Gemini first, AnyRouter fallback, bounded retry/timeout, output contract validation | `api/_ai/gateway.js` (417 lines), `api/_ai/providers.js` (113 lines) |
| Data/auth | Supabase Auth (cookie sessions) + Postgres REST with RLS | `api/auth/_supabase.js`, `supabase/migrations/*.sql` |
| Credential chain | Avalanche Fuji testnet registry, ethers v6 | `avalanche-config.js`, `contracts/`, `scripts/deploy-learning-credential-registry.mjs` |
| Tests | Playwright (`npm test`), Hardhat (`npm run contract:test`) | `playwright.config.js`, `package.json` |
| Local harness | `tests/static-server.mjs` mounts all handlers on `127.0.0.1:8175` and blanks every secret | `tests/static-server.mjs:53-62` |

Mounted routes: `/api/auth/signup`, `/verify`, `/otp`, `/login`, `/resend`, `/session`, `/logout`,
`/api/admin/users`, `/api/debate`, `/api/ai/status`, `/api/support`, `/api/credentials`, `/api/learning-records`.

## 3. AI request flow (verified on this checkout)

`api/debate.js:161` `normalizeDebatePayload()` accepts `problem`, `solution`, `mode`
(`analyze|resubmit|hint|discuss|explain|exercise` per `MODES`), `hintLevel` (1..3 only for `hint`),
`language`, `question`, `previousSolution` (required for `resubmit`), `previousAnalysis`,
`conversation` (last 16), `previousHints` (max 3), `attemptNumber` (clamped 1..1000).
`debateUserContent()` (`api/debate.js:195`) serialises those into tagged blocks; `debateSystemPrompt()`
appends only the interface language — the Socratic rules come from `debate-prompt.js`, always server-side.
`createDebateAnalysisWithMeta()` sends `systemPrompt` + `userPrompt` through the gateway with
`temperature 0.1`, `maxOutputTokens 2200`, `json: true` and a `validate` hook
(`validateDebateAnalysis(parseJsonContent(text), context)`), then returns `{analysis, meta:{provider,
model, attempts, retryCount, fallbackUsed, latencyMs, trace}}`. For `resubmit` it mints a
`proofRecord` with a sha256 `contentHash` over problem+previous+current solution.

**Trust boundary observation (risk, see RISK_REGISTER):** on this checkout the analysis context
(`previousSolution`, `previousAnalysis`, `conversation`, `previousHints`, `attemptNumber`) is taken from
the client body. The `p0/ai-flow-v2`/Phase 3.1 design replaces this with `buildAnalysisInput()` in
`api/_ai/contract.js:245`, which builds the same fields only from server rows. On `main` that hardening
is not in force.

## 4. Learning flow: 7 business steps vs available states

`api/_ai/contract.js:32` declares `modes = analyze, resubmit, hint, discuss, explain, exercise`;
`BUSINESS_STEPS`/`STEP`/`allowedActions`/`transitionFor` are **branch-only** (section 1.1). The
documented 7-step flow (intake → classify → critical question → progressive hint → self-correction →
explain & sources → similar practice) therefore cannot be executed end-to-end on this checkout; the
modes exist but the server-owned step machine, lease, quota accounting and replay do not.

## 5. Persistence (verified)

Migrations on this checkout: `202610280001_learning_credentials.sql` (`learning_credentials`,
`credential_transactions`, RLS on, `revoke ... from anon, authenticated`, `grant ... to service_role`),
`202610280002_learning_records.sql` (sessions/submissions). Untracked and belonging to branch work:
`202610310001_ai_contract_versions.sql`, `202610310002_ai_flow_phase3_2.sql`.
`ai_flow_v2` (202610290002: `claim_ai_action`, `finish_ai_action`, `abort_ai_action`, `ai_usage_events`,
`ai_quotas`, `support_usage`) exists only inside the `p0/ai-flow-v2` diff.

## 6. Provider configuration (presence only, never values)

| Variable | Present at audit time | Effect |
|---|---|---|
| `GEMINI_API_KEY` | ABSENT | primary provider for the learning path unavailable |
| `ANYROUTER_LEARNING_API_KEY` | ABSENT | fallback provider for the learning path unavailable |
| `ANYROUTER_LEARNING_MODEL` | ABSENT | — |
| `ANYROUTER_API_KEY` / `ANYROUTER_MODEL` | SET | only the support widget path could reach a provider |
| `SUPABASE_URL` | SET | — |
| `AVALANCHE_FUJI_RPC_URL` / `REGISTRY_ADDRESS` / `ISSUER_PRIVATE_KEY` | SET | chain calls would target Fuji testnet |

`playwright.config.js` passes `GEMINI_API_KEY=''`, `ANYROUTER_LEARNING_API_KEY=''`, `ANYROUTER_API_KEY=''`
and the Supabase/SMTP variables as empty strings to the test webServer, so **no Playwright run can reach a
real provider by design**. Real-model accuracy claims are therefore impossible to evidence and are
catalogued `BLOCKED` (E8/E9 rule: *chỉ đánh giá trên bộ test có nhãn chuẩn và đã thực sự chạy với provider
được chỉ định*).

## 7. Test surface inventory (this checkout)

19 spec files, 155 `test(` sites by static count; the suite was executed in E8 and the exact numbers,
pass/fail and duration are recorded in `docs/qa/AI_EVALUATION_RUN.md` and
`docs/qa/run-evidence.json` rather than restated here.

## 8. What was **not** assumed

The following are documented elsewhere or on another branch and were **not** treated as implemented
on this checkout: the 7-state server machine and its lease/quota/replay SQL, `guardEndpoint` rate
budgets for `/api/credentials` and `/api/admin/users`, `redactFailureText` for stored failure messages,
`credential_requests` approval table, `admin_action_logs`, a stuck-task sweeper, and CSRF/Origin checks.
None of these were found by `grep` in the working tree.
