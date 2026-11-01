# E5 — Logging & Metrics

Tài liệu này mô tả **đúng những gì đang được ghi và đo** trên checkout hiện tại, kèm số liệu tái lập được.
Mọi con số lấy từ `docs/qa/run-evidence.json` và `docs/qa/request-log.json`, sinh ra bởi
`tests/ai-acceptance.spec.js`; không có số nào được ước lượng hay điền tay.

Baseline sinh bằng chứng (`evidence.baseline`, do chính harness đọc bằng `git`):

| Trường | Giá trị |
|---|---|
| branch | `p0/ai-flow-v2` |
| commit | `7f7ef3d` — `feat(ai-flow): server-authoritative claim/finish/abort flow and tests` |
| working tree | dirty (các file của gói nghiệm thu chưa commit) |
| provider keys | `GEMINI_API_KEY`, `ANYROUTER_LEARNING_API_KEY`, `ANYROUTER_API_KEY` đều **absent** |

> **Caveat bắt buộc khi đọc gói này.** Khảo sát E0 ban đầu được thực hiện trên `main` @ `3378f22` và ghi nhận
> máy trạng thái 7 bước *chưa tồn tại*. Trong lúc gói E chạy, working tree đã chuyển sang `p0/ai-flow-v2`
> @ `7f7ef3d` — ở đó `api/learning-records/_state.js`, `claim/finish/abort`, `mode=explain|exercise` và migration
> `202610290002_ai_flow_v2.sql` **có tồn tại**. Toàn bộ evidence và số liệu dưới đây thuộc về nhánh đang checkout;
> `docs/qa/ARCHITECTURE_AUDIT.md` giữ nguyên mô tả của thời điểm audit `main` và có phụ lục ghi lại thay đổi này.

---

## 1. Server đang log gì

`api/debate.js` là endpoint AI duy nhất có logging nghiệp vụ.

### 1.1 Các event và field

| Event | Phát ra tại | Field |
|---|---|---|
| `ai_debate_failed` (bị chặn ở cửa sổ IP) | [api/debate.js:324](file:///C:/Users/MSI%2013%20AI/Downloads/UNIHACK2026/api/debate.js#L324) | `requestId, phase:'rate_limit', status:429, code:'RATE_LIMIT', kind:'client', source:'client', durationMs` |
| `ai_debate_completed` (replay idempotent) | [api/debate.js:399](file:///C:/Users/MSI%2013%20AI/Downloads/UNIHACK2026/api/debate.js#L399) | như dưới, đánh dấu đường replay |
| `ai_debate_completed` (thành công) | [api/debate.js:444](file:///C:/Users/MSI%2013%20AI/Downloads/UNIHACK2026/api/debate.js#L444) | `requestId, mode, status:200, provider, attempts, fallbackUsed, durationMs, hasLearningRecord` |
| `ai_debate_failed` (mọi lỗi khác) | [api/debate.js:480](file:///C:/Users/MSI%2013%20AI/Downloads/UNIHACK2026/api/debate.js#L480) | `requestId, phase, mode, status, code, kind, source, errorName(≤80 ký tự), durationMs, hasLearningRecord` |

`kind`/`source` đến từ `classifyAiError` (taxonomy `model` / `schema` / `system` / `client`), vì vậy lỗi mô hình
tách khỏi lỗi hạ tầng và lỗi input ngay trong log.

`phase` là machine-readable tiến trình: `parse_request → validate_input → authenticate → burst_limit →
claim_ai_action → call_ai → finish_ai_action` (khai báo tại `api/debate.js:335-345`). Đây là trường cho biết request
chết ở bước nào, thay vì phải suy ra từ message.

**Không có field nào sau đây xuất hiện trong log:** API key, password, OTP, Authorization token, session secret,
nội dung bài làm thô của học sinh. Body chỉ đi vào pipeline, không bao giờ được `JSON.stringify` vào log.

### 1.2 Trace frontend → backend

- Server sinh UUID cho mỗi request và gắn lên header: `requestId = randomUUID()` tại
  [api/debate.js:320](file:///C:/Users/MSI%2013%20AI/Downloads/UNIHACK2026/api/debate.js#L320), `X-AI-Request-Id` tại
  [api/debate.js:322](file:///C:/Users/MSI%2013%20AI/Downloads/UNIHACK2026/api/debate.js#L322)
- Client giữ lại id để user/báo cáo sự cố trích dẫn được: [debate-ai.js:93](file:///C:/Users/MSI%2013%20AI/Downloads/UNIHACK2026/debate-ai.js#L93)
  (`error.requestId = data.requestId || response.headers.get('x-ai-request-id')`)
- Mỗi request có id riêng; điều kiện nghiệm thu là **body lỗi mang đúng id của chính response đó** (kiểm chứng
  trong F-08), không phải mọi request trùng một id.
- UI dịch mã lỗi sang người dùng theo taxonomy đầy đủ: `debateErrorText` trong `app-actions.js`, bao gồm
  `AI_CONTRACT_BROKEN`, `AI_RESULT_NOT_STORED`, `STATE_CONFLICT`, `RATE_LIMITED`, `MODEL_OUTPUT_INVALID`,
  `EMPTY_RESPONSE`, `LEARNING_RECORD_REQUIRED` (key i18n `debateServerError` cho vi/en/jp).

### 1.3 Hai tầng rate limit (khác với bản `main` chỉ có một)

| Tầng | where | behaviour |
|---|---|---|
| Cửa sổ IP in-memory | `REQUEST_WINDOW_LIMIT = 15`, `REQUEST_WINDOW_MS = 60_000` tại [api/debate.js:25-26](file:///C:/Users/MSI%2013%20AI/Downloads/UNIHACK2026/api/debate.js#L25) | 429 `RATE_LIMIT` ngay ở rìa, **trước** khi gọi DB; mất khi cold start, chỉ bảo vệ một process |
| Hạn mức theo learner trong DB | `record_ai_burst` / `checkAiBurst` (`phase='burst_limit'`), migration `202610310002_ai_flow_phase3_2.sql` | fixed-window dùng chung mọi serverless instance; đã kiểm chứng trong PGlite: `burst: third request in a 2-request window is limited`, `burst: each learner has an independent window`, `burst: authenticated cannot call record_ai_burst, service_role can`, `burst: window table has RLS enabled and no permissive policies` |

F-08 đo cả đường đi của request: 18 request gửi tới handler thì **17 request đi tới bước claim**, request bị
chặn ở cửa sổ IP không tiêu tốn hạn mức DB (đếm bằng `calls.claim`).

### 1.4 Hai giới hạn thật còn tồn tại

1. **Logger chỉ bật ngoài production.** `defaultDiagnosticLogger` trả `console` khi
   `env.VERCEL === '1' || env.NODE_ENV === 'production'`, ngược lại trả `null`
   ([api/debate.js:29-31](file:///C:/Users/MSI%2013%20AI/Downloads/UNIHACK2026/api/debate.js#L29)).
   Chạy local/Playwright → không có log server-side nào được phát ra, nên các event ở §1.1 chỉ được xác minh
   bằng unit test, chưa từng được xác minh trên môi trường thật.
2. **Không có request log bền vững.** Không có bảng/file/store nào ghi lại từng request AI xuyên tiến trình.
   Vì vậy **J-08 = BLOCKED** (trace một request qua nhiều phiên/instance), không phải PASS.

---

## 2. Request log của harness nghiệm thu (`tests/qa/logger.mjs`)

Vì production chưa có request log bền vững, bộ nghiệm thu tự dựng một logger đáp ứng đúng field set bắt buộc
và kiểm tra vệ sinh log ngay trong lúc chạy.

| Field | Cách sinh |
|---|---|
| `requestId` | UUID server trả về, hoặc `null` khi request bị chặn trước handler |
| `timestamp` | ISO-8601 UTC |
| `environment` | `local-test` |
| `endpoint`, `method` | URL và HTTP verb thực gọi |
| `inputHash` | `fnv1a32:<hex>` của `problem + solution` — **chỉ hash, không lưu nội dung thô** |
| `expectedResult` / `actualResult` | mô tả nghiệm thu, cắt 300 ký tự |
| `testCaseId`, `category`, `priority`, `severity`, `status` | khớp catalog E4 |
| `httpStatus`, `latencyMs` | đo từ round-trip thật |
| `provider`, `model` | từ stub/real gateway |
| `attempt`, `retryCount` | đếm retry thật |
| `evaluationStatus`, `score`, `expectedVerdict`, `actualVerdict` | từ evaluator độc lập |
| `errorCode`, `errorCategory` | `business` vs `provider` vs `system` |
| `reviewerStatus`, `skippedReason`, `parentCaseId` | audit trail; variant trỏ về parent |

### 2.1 Cơ chế cưỡng chế vệ sinh log

| Cơ chế | Implement tại |
|---|---|
| Allowlist field — field ngoài danh sách làm throw | `tests/qa/logger.mjs` |
| `FORBIDDEN_LOG_KEYS` chặn `apikey`, `password`, `otp`, `token`, `secret`, `authorization`… (so khớp suffix sau normalize `_`/`-`) | `tests/qa/evaluator.mjs::assertLogSafe` |
| Regex phát hiện secret dạng value (Google API key, JWT, service-role key, RPC URL kèm credential) | `tests/qa/evaluator.mjs::findSecretLeaks` |
| Quét key-path đệ quy trên toàn bộ entries đã export | `assertLogSafe` |
| Payload lưu hash-only; injection sentinel kiểm ở cuối run | `logger.mjs` + `ai-acceptance.spec.js` afterAll |

### 2.2 Kết quả đo được (`metrics.logHygiene`)

```json
{
  "entries": 2,
  "secretLeaks": 0,
  "injectionSentinelsInLogs": 0,
  "payloadStorage": "hash-only (fnv1a32), never the raw problem or solution"
}
```

Hai assertion chặn build nếu vi phạm: `expect(findSecretLeaks(logJson + logCsv)).toEqual([])` và
`expect(sentinelsInLogs).toEqual([])` (kèm message nêu rõ sentinel nào lọt vào log).

**Đọc đúng con số `entries: 2`:** đây là số bản ghi **HTTP-level** (chỉ `F-08` và `A-02` đi qua handler thật với
request/response đầy đủ). Nó **không** có nghĩa hệ thống chỉ tạo 2 log — 120 case đã execute đều có dòng trong
`run-evidence.json`; chỉ các case có round-trip HTTP mới vào `request-log.json/csv`. Vì vậy percentile ở §3.4
tính trên `n = 1`.

### 2.3 Export

| File | Định dạng | Nội dung |
|---|---|---|
| `docs/qa/request-log.json` | JSON | `generatedAt`, `stats`, toàn bộ entries |
| `docs/qa/request-log.csv` | CSV | header phẳng, cùng dữ liệu, mở được bằng spreadsheet |
| `docs/qa/run-evidence.json` | JSON | 171 dòng case + metrics + baseline + providerStatus + grader pairs + kết quả harness SQL |

`stats` đo được: `entries 2, retryRate 0, providerErrorRate 0, businessErrorRate 0.5, averageLatencyMs 7.5`
(`businessErrorRate 0.5` = 1 trong 2 bản ghi HTTP là lỗi nghiệp vụ: `F-08` → 429 `RATE_LIMIT`).

---

## 3. Metrics

### 3.1 Tổng (`metrics.totals`)

| Chỉ số | Giá trị |
|---|---|
| designed (dòng evidence) | 171 |
| executed | 120 |
| PASS | 120 |
| FAIL | 0 |
| BLOCKED | 46 |
| NOT_RUN | 4 (`I-04`, `I-05`, `J-07` cần người thao tác; `E-14` xem §4) |
| NOT_IMPLEMENTED | 0 |
| `PENDING_EXPERT_REVIEW` | 171 |

Catalog E4 (`tests/fixtures/ai-acceptance-tests.json`) có 128 case sản phẩm: 68 PASS / 46 BLOCKED / 14 NOT_RUN /
0 FAIL / 0 NOT_IMPLEMENTED. 171 dòng evidence = 128 case + 46 dòng `*:gold` self-check + các dòng grader nội bộ,
trừ những case chưa từng được ghi.

`pendingExpertReview = 171` nghĩa là **chưa có review độc lập** cho bất kỳ nhãn nào — tuyệt đối không đọc là "đã duyệt".

### 3.2 Độ chính xác verdict

`verdictAccuracy = 1.0` (120/120 case đã execute và có verdict).

Ghi chú bắt buộc đã nhúng trong `metrics.notes`, và là điều kiện để con số này không bị hiểu sai:

1. Đây là tỉ lệ **pipeline + evaluator độc lập** xử lý đúng trên dữ liệu đã cho — *không phải* độ chính xác
   của mô hình. Không có provider key nên chưa từng đo chất lượng câu trả lời của model.
2. Nó chỉ tính trên 120/171 dòng; 46 case cần model thật vẫn BLOCKED và **không** được tính là PASS.
3. FAIL duy nhất từng tồn tại (H-07: store được tạo trước khi kiểm tra quyền → 503 thay vì 401) đã được sửa tận
   gốc trong `api/credentials/index.js` (authorize trước `storeFactory()`), regression test là chính H-07, và
   toàn bộ suite 207/207 vẫn xanh sau sửa.

### 3.3 Theo từng nhóm — accuracy đi kèm coverage

`executedAccuracy` là tỉ lệ PASS trong phần đã chạy; `executedCoverage` là tỉ lệ **đã chạy** trên số case được
thiết kế. Đưa coverage vào là để một nhóm chỉ chạy 1/15 case không thể đọc như một nhóm "đạt 100%".

| Category | total | PASS | FAIL | BLOCKED | NOT_RUN | executed | coverage | accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| C-cpp-review | 10 | 0 | 0 | 10 | 0 | 0 | **0.00** | null |
| A-math-verdict | 15 | 1 | 0 | 14 | 0 | 1 | **0.067** | 1 |
| B-insufficient-and-hard | 13 | 1 | 0 | 12 | 0 | 1 | **0.077** | 1 |
| D-ai-security | 11 | 5 | 0 | 6 | 0 | 5 | 0.455 | 1 |
| I-frontend-ux | 5 | 3 | 0 | 0 | 2 | 3 | 0.60 | 1 |
| J-performance-reliability | 8 | 6 | 0 | 1 | 1 | 6 | 0.75 | 1 |
| K-certificate-verify | 5 | 4 | 0 | 1 | 0 | 4 | 0.80 | 1 |
| G-database-integrity | 8 | 7 | 0 | 1 | 0 | 7 | 0.875 | 1 |
| E-ai-learning-flow | 18 | 16 | 0 | 1 | 1 | 16 | 0.889 | 1 |
| F-api-backend | 8 | 8 | 0 | 0 | 0 | 8 | 1.00 | 1 |
| H-authentication-authorization | 8 | 8 | 0 | 0 | 0 | 8 | 1.00 | 1 |
| V-grader-metamorphic | 8 | 8 | 0 | 0 | 0 | 8 | 1.00 | 1 |
| gold-integrity | 46 | 46 | 0 | 0 | 0 | 46 | 1.00 | 1 |
| grader / grader-internal | 1 / 6 | 1 / 5 | 0 | 0 | 0 | 1 / 5 | 1.00 / 0.833 | 1 |
| L-regression | 1 | 1 | 0 | 0 | 0 | 1 | 1.00 | 1 |

- `weakestCategory` = **A-math-verdict** (accuracy bằng 1 nhưng chỉ chạy 1/15; tie-break theo coverage).
- `leastCoveredCategory` = **C-cpp-review** (0/10 executed, `accuracy = null` vì không có gì để đo).
- Kết luận trung thực: **không nhóm nào có accuracy dưới 1**, nhưng **4/5 nhóm chấm bài bằng model chưa đo được**.
  Con số tổng 120/120 không được dùng để che điều đó.

### 3.4 Latency

| count | average | min | max | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 4 ms | 4 | 4 | 4 | 4 | 4 |

Cảnh báo bắt buộc: **đây không phải kết quả hiệu năng.** `n = 1` và provider là stub
(`gemini/gemini-stub-model`); thời gian mạng và thời gian sinh token của model thật không nằm trong số này.
Percentile nội suy tuyến tính trên một mẫu duy nhất nên mọi giá trị trùng nhau.

### 3.5 Retry và tỉ lệ lỗi

| Chỉ số | Giá trị | Ý nghĩa thật |
|---|---|---|
| `retryRate` | `null` | không request nào đi qua nhánh retry → không đo được |
| `providerErrorRate` | 0 | stub không phát sinh lỗi provider; không chứng minh tỉ lệ lỗi thật |
| `businessErrorRate` | 0.5 | 1/2 bản ghi HTTP là lỗi nghiệp vụ (F-08 → 429) |

### 3.6 Confusion matrix

Ma trận là **nhãn của evaluator độc lập**, không phải đầu ra mô hình (mô tả đã ghi trong file:
*"Ma trận nhãn theo từng nhóm phản hồi của evaluator. Không phải độ chính xác của mô hình."*)

**(a) 46 phản hồi hợp lệ (gold analysis nguyên trạng) — evaluator phải chấp nhận**

| Expected \ Predicted | correct | incorrect | insufficient | support |
|---|---:|---:|---:|---:|
| correct | 18 | 0 | 0 | 18 |
| incorrect | 0 | 24 | 0 | 24 |
| insufficient | 0 | 0 | 4 | 4 |

precision = recall = F1 = 1 cho cả ba nhãn; `accuracy = 1`, `macroF1 = 1`, `unclassifiableCount = 0`.

**(b) 187 phản hồi đã làm hỏng (mutant) — evaluator phải từ chối**

| Expected \ Predicted | correct | incorrect | insufficient | support |
|---|---:|---:|---:|---:|
| correct | 8 | 36 | 0 | 44 |
| incorrect | 24 | 58 | 0 | 82 |
| insufficient | 4 | 4 | 7 | 15 |
| `__unclassifiable` (`none`) | 46 | | | |

`accuracy = 0.518`, `macroF1 = 0.494`, `evaluatedCount = 141`, `unclassifiableCount = 46`.

Cách đọc đúng: hàng = nhãn gold, cột = verdict mà **mutant** tuyên bố. Ô ngoài đường chéo cho biết mutant bị đẩy
sang verdict nào — tức là mutation thực sự đổi hành vi. `0.518` thấp là *tốt*; chỉ số nghiệm thu của evaluator là
`mutantsAccepted = 0` (§3.7), không phải 0.518.

### 3.7 Tự kiểm chứng evaluator (`metrics.grader`)

```json
{ "compliantAccepted": 46, "compliantRejected": 0, "mutantCount": 187, "mutantsAccepted": 0 }
```

46/46 phản hồi hợp lệ được chấp nhận, 187/187 mutant bị từ chối, trên 8 lớp mutation
`V-MUT-01`…`V-MUT-08` (`tests/qa/mutants.mjs`: đảo verdict, xoá bước chẩn đoán, thêm dữ kiện bịa, rút gọn
remediation, đổi vị trí lỗi, bỏ reason code, phá contract, mutant hỗn hợp).
Property check: `V-PROP-02` = 306 lần grading lặp lại (6 mẫu × 51 vòng) cho kết quả giống hệt nhau;
`V-PROP-01` = điểm ∈ [0,1] trên 233 cặp (46 gold + 187 mutant).

### 3.8 Tầng bằng chứng SQL (`evidence.sqlHarness`)

```json
{ "command": "npm run test:sql", "summary": "58/58 checks passed", "exitCode": 0, "total": 58, "failed": [] }
```

`scripts/verify-ai-flow-sql.mjs` chạy toàn bộ migration trên PostgreSQL thật (PGlite/WASM, không Docker) và được
chính acceptance spec gọi lại trong lúc chạy, nên các assert sau là **bằng chứng mức DB**, không phải suy đoán:
lease/claim một action tại một thời điểm, replay theo `request_id` mà không tính phí, `abort` restore submission +
refund, `hint` tối đa 3 mức/phiên, quota và burst counter cross-instance, RLS + grant/service_role trên
`claim_ai_action`/`record_ai_burst`, và parity giữa `allowedActions` (JS) với `ai_allowed_actions` (SQL).

Trong lần chạy này harness có 4 assert đã được sửa **ở phía harness, không phải ở sản phẩm**:
`ai_step_allowed('explain', 4)` cần cast `4::smallint` (PostgreSQL không có implicit cast integer→smallint);
2 assert so sánh `state_version` với một hằng số stale (bất biến thật là *guide mode không bump version* —
giờ so với giá trị đọc từ row ngay trước/sau action); và learner dùng cho burst chưa được insert vào
`auth.users` (FK `ai_burst_windows_learner_id_fkey`). Trước khi sửa, harness chỉ chạy tới 38/39 và **che** 19 check
sau nó — đây là lý do phải sửa rather than ignore.

---

## 4. Những gì KHÔNG đo được ở trạng thái hiện tại

| Hạng mục | Trạng thái | Lý do |
|---|---|---|
| Độ chính xác thật của mô hình trên A/B/C/D (chấm toán, hỏi lại khi thiếu dữ kiện, review C++, chống injection bằng model thật) | **BLOCKED** — 46 case | Không có `GEMINI_API_KEY`/`ANYROUTER_LEARNING_API_KEY`. E8 yêu cầu chỉ chạy real AI evaluation khi provider ổn định; chưa có provider nên không gán PASS. |
| `C-cpp-review` nói riêng | **BLOCKED 10/10, coverage 0** | Toàn bộ cần model; chưa có bằng chứng execution nào cho nhóm này. |
| Latency p95/p99 thật, retry rate, provider error rate | **BLOCKED / không có ý nghĩa** | provider là stub, logger HTTP chỉ 2 bản ghi |
| Event `ai_debate_completed` / `ai_debate_failed` phát ra từ server thật | **chưa xác minh trên môi trường** | `defaultDiagnosticLogger` trả `null` ngoài production (local không log) |
| Request log bền vững, trace đa instance (J-08) | **BLOCKED** | không có store; counter IP in-memory mất khi cold start |
| `E-14` claim lại sau khi lease **10 phút** hết hạn | **NOT_RUN** | refund và chặn action chồng lấn đã chạy trong PGlite (3/3 check); phần takeover theo đồng hồ chưa được exercise vì cần advance clock |
| `I-04`, `I-05`, `J-07` | **NOT_RUN** | cần người thao tác trong trình duyệt; chưa có bằng chứng tự động |
| G-08, K-04 (Staging / Avalanche Fuji) | **BLOCKED** | chỉ nghiệm thu trên Staging với quyền phù hợp; không thao tác Production |

---

## 5. Cách tái lập

```bash
npx playwright test tests/ai-acceptance.spec.js --reporter=line   # viết run-evidence.json + request-log.json/csv
node tests/qa/build-catalog.mjs                                   # dựng lại fixture + TEST_CASE_CATALOG.md từ evidence
npm run test:sql                                                  # 58 check mức PostgreSQL (PGlite)
npx playwright test --reporter=line                               # toàn bộ suite (207 test)
```

`tests/ai-acceptance.spec.js` chạy `npm run test:sql` nội bộ, vì vậy kết quả SQL luôn nằm trong cùng một
evidence bundle với baseline git. Khi có provider key thật, các case `requiresProvider = true` phải được chạy
**riêng** và báo cáo accuracy theo từng nhóm A–L, không gộp vào các con số mock/hạ tầng ở trên.
File cấu hình `mode: 'serial'` vì một file evidence duy nhất được ghi ở `afterAll`; song song sẽ ghi đè nhau.
