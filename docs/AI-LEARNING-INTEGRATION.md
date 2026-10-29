# PARADOX AI — AI Learning Integration (Gemini → AnyRouter)

**Phạm vi:** AI Learning / AI Debate Engine (`#/audit`, `POST /api/debate`)

**Ngày cập nhật:** 2026-10-29

**Trạng thái:** Đã tích hợp Gemini làm provider chính và AnyRouter làm provider dự phòng. Mock test đầy đủ. Kết nối Gemini đã **VERIFIED**. Kết nối AnyRouter **BLOCKED** cho đến khi có `ANYROUTER_LEARNING_API_KEY` riêng cho AI Learning.

**Không thay đổi:** Smart Contract, giao dịch blockchain, dữ liệu production, commit/push/deploy, support widget.

---

## 1. Tóm tắt thay đổi

| Thành phần | Trước | Sau |
|---|---|---|
| Frontend Audit | `#/audit` → `debate-ai.js` → `POST /api/debate` | Giữ nguyên, không đổi contract |
| Backend AI | `api/debate.js` → `api/_ai/gateway.js` → Gemini → DeepSeek/Mistral | `api/debate.js` → `api/_ai/gateway.js` → Gemini → AnyRouter |
| Provider chính | Gemini | Gemini (không đổi) |
| Provider dự phòng | DeepSeek/Mistral | **AnyRouter** |
| Key AI Learning | `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY` | `GEMINI_API_KEY`, `ANYROUTER_LEARNING_API_KEY` |
| Support widget | `ANYROUTER_API_KEY` | Giữ nguyên, không thay đổi |
| Prompt | `debate-prompt.js` (`DEBATE_PROMPT`) | Giữ nguyên, server luôn tự gắn prompt |

### Prompt đang có trong repo

1. `DEBATE_PROMPT` trong `debate-prompt.js` — prompt học thuật chính, phục vụ 4 mode `analyze`, `discuss`, `hint`, `resubmit`.
2. Rubric `resubmit` 4 tiêu chí × 0–25 điểm nằm trong cùng prompt và được **server** tự tính lại tổng/trạng thái (`api/debate.js`).
3. `SUPPORT_PROMPT` trong `support-prompt.js` — prompt của widget hỗ trợ website (không dùng cho AI Learning).

---

## 2. Kiến trúc

```
Browser (#/audit)
   │  POST /api/debate   (không chứa key)
   ▼
api/debate.js
   │  normalize input → system prompt + user content
   │  validate output (schema + rubric)
   ▼
api/_ai/gateway.js          ← timeout, retry, fallback, deadline, redaction
   │
   ├── 1. Google Gemini     GEMINI_API_KEY              (primary)
   └── 2. AnyRouter         ANYROUTER_LEARNING_API_KEY  (fallback)
```

Thư viện server-only:

| File | Vai trò |
|---|---|
| `api/_ai/providers.js` | Catalogue Gemini + AnyRouter: endpoint, request builder, response parser, tên biến môi trường |
| `api/_ai/gateway.js` | Điều phối retry/fallback/timeout, tổng hợp lỗi, redaction, readiness snapshot |
| `api/debate.js` | Nghiệp vụ AI Learning: prompt, schema, rubric, proof record |
| `api/ai/status.js` | Health check `GET /api/ai/status` |

### 2.1. Catalogue provider

| Thứ tự | ID | Vai trò | Endpoint | Model mặc định | Biến key | Biến model |
|---:|---|---|---|---|---|---|
| 1 | `gemini` | `primary` | `generativelanguage.googleapis.com` | `gemini-3.5-flash` | `GEMINI_API_KEY` | `GEMINI_MODEL` |
| 2 | `anyrouter` | `fallback` | `https://anyrouter.dev/api/v1/chat/completions` | `anyrouter/free` | `ANYROUTER_LEARNING_API_KEY` | `ANYROUTER_LEARNING_MODEL` |

AnyRouter là OpenAI-compatible: `Authorization: Bearer sk-ar-v1-…`, `messages`, `max_tokens`, `response_format: { "type": "json_object" }`. Gemini dùng `x-goog-api-key`, `systemInstruction`, `contents`, `generationConfig.responseMimeType`.

### 2.2. AnyRouter đã xác minh từ tài liệu

- Base URL: `https://anyrouter.dev/api/v1`
- Chat endpoint: `POST /api/v1/chat/completions`
- Auth: `Authorization: Bearer sk-ar-v1-…` (LLM API key). Management key `ak_…` không dùng cho inference.
- Model mặc định an toàn cho AI Learning: `anyrouter/free` (free-model tier, 2400 req/phút/key, không daily cap).
- Các model khác có thể đặt qua `ANYROUTER_LEARNING_MODEL` (ví dụ `openai/gpt-4o-mini`), phụ thuộc key restrictions.
- Rate limit: per-key, sliding 60s. Free model: 2400 req/phút/key. 429 trả `Retry-After: 60`.
- Lỗi quan trọng:
  - `401 invalid_api_key`: key sai/revoked.
  - `402 insufficient_balance`: hết credit.
  - `429 rate_limit_exceeded`: vượt per-key limit.
  - `403 upstream_403`: provider chặn.
  - `502 upstream_5xx`: lỗi tạm thời upstream.

---

## 3. Thiết kế nhiều API key (không xoay key để né quota)

- Support widget giữ nguyên `ANYROUTER_API_KEY`; AI Learning dùng `ANYROUTER_LEARNING_API_KEY` riêng để không dùng chung quota/support.
- Gateway chỉ dùng **một key đã cấu hình cho mỗi provider** trong một request chain. Không tự động xoay qua nhiều key để né rate limit/hạn mức.
- `GEMINI_API_KEY` là key được sử dụng trong môi trường hiện tại. `GEMINI_API_KEY_2` chỉ được nhận diện và báo cáo trong `/api/ai/status` (`geminiKeyCount`, `geminiBackupKeyConfigured`), không được tự động dùng để vượt quota.
- Tương tự, `ANYROUTER_LEARNING_API_KEY` là key được sử dụng; `ANYROUTER_LEARNING_API_KEY_2` chỉ được báo cáo (`anyrouterKeyCount`, `anyrouterBackupKeyConfigured`) và không tự động xoay.
- Nếu gặp `402 insufficient_balance` (hết quota cứng), provider đó được coi là không khả dụng cho request hiện tại và **không** thử key khác trong cùng phạm vi quota.
- Nhiều key chỉ nên dùng cho các môi trường/project/account khác nhau (staging/production, team khác nhau) bằng cách chọn key phù hợp trong biến môi trường của deployment. Không triển khai key rotation trong gateway.
- Secret chỉ đọc từ `process.env` ở server; không đưa vào frontend, log hay Git.

---

## 4. Hành vi gateway

### 4.1. Thứ tự provider

1. Mặc định: `gemini` → `anyrouter`.
2. Có thể đổi bằng `AI_PROVIDER_ORDER` (ví dụ `anyrouter,gemini`), chỉ nhận id hợp lệ, tự loại id lạ và id trùng.
3. Provider không có key bị coi là `NOT_CONFIGURED`, bị bỏ qua nhưng vẫn xuất hiện trong chẩn đoán.

### 4.2. Timeout và retry

| Tham số | Mặc định | Giới hạn | Ý nghĩa |
|---|---:|---:|---|
| `AI_PROVIDER_TIMEOUT_MS` | 10000 | 100–60000 | Timeout mỗi lần gọi một provider |
| `AI_TOTAL_TIMEOUT_MS` | 26000 | 100–120000 | Deadline tổng cho toàn bộ chuỗi provider |
| `AI_MAX_RETRIES` | 1 | 0–3 | Số lần retry **trên mỗi provider** (tổng attempt = retries + 1) |
| `AI_RETRY_DELAY_MS` | 300 | 0–5000 | Backoff cơ sở, nhân đôi mỗi lần, chặn trần 1500 ms |

### 4.3. Khi nào retry, khi nào fallback

| Tình huống | Retry cùng provider | Fallback provider kế tiếp |
|---|---|---|
| Timeout / abort | Có | Có |
| Lỗi mạng (`TypeError`) | Có | Có |
| HTTP 408, 425, 429, 5xx | Có | Có |
| HTTP 400, 401, 402, 403, 404, 422 | Không | Có ngay |
| Response rỗng | Có | Có |
| JSON sai / sai schema / sai rubric | Có | Có |
| Hết `AI_MAX_RETRIES` | Dừng | Có |
| Hết deadline tổng | Dừng | Dừng |
| Input không hợp lệ | Không gọi provider | Không fallback |

Khi cả 2 provider thất bại, gateway ném lỗi tổng hợp và `api/debate.js` trả lỗi — **không tạo `analysis` giả**.

### 4.4. Bảo vệ secret

- Key chỉ đọc từ `process.env` trong `api/_ai/*` và không bao giờ nằm trong request body, response, log hay test snapshot.
- Mọi message lỗi đi qua `redact()`: thay giá trị key đã cấu hình bằng `[redacted]`, đồng thời chặn pattern `AIza…`, `sk-ar-…`, `Bearer …`.
- Response lỗi chỉ chứa metadata kỹ thuật và `attempts`, không chứa key.
- Test `Provider schemas stay server-side only and never reach browser bundles` quét toàn bộ JS frontend + `index.html`.

---

## 5. Hợp đồng response

### 5.1. Thành công — `200`

```json
{
  "analysis": {
    "status": "incorrect",
    "summary": "Phép chia ở bước cuối chưa đúng.",
    "confidence": 0.94,
    "issues": [
      {
        "category": "logic",
        "step": "x = 8 - 2",
        "explanation": "Từ 2x = 8 phải chia hai vế cho 2.",
        "suggestion": "Kiểm tra phép biến đổi ngược của phép nhân."
      }
    ],
    "strengths": ["Hai bước đầu chính xác."],
    "nextQuestion": "Phép toán nào đang áp dụng lên x?",
    "reply": "",
    "hint": null,
    "comparison": null,
    "evaluation": null
  },
  "meta": {
    "provider": "gemini",
    "model": "gemini/gemini-3.5-flash",
    "attempts": 1,
    "retryCount": 0,
    "fallbackUsed": false,
    "latencyMs": 1180,
    "trace": [
      { "provider": "gemini", "model": "gemini-3.5-flash", "attempt": 1, "code": "OK", "retryable": false, "durationMs": 1180 }
    ]
  }
}
```

- `analysis` giữ đúng schema cũ, frontend không phải đổi gì.
- `meta` là phần bổ sung chỉ để quan sát/kiểm thử; frontend hiện tại bỏ qua.
- Với `mode = resubmit`, `analysis.proofRecord.model` ghi provider thực tế đã trả lời, ví dụ `anyrouter/anyrouter/free` khi Gemini lỗi.

### 5.2. Lỗi

| HTTP | `code` | Khi nào | UI |
|---:|---|---|---|
| 400 | `INVALID_INPUT` | Thiếu đề/lời giải, sai mode, hint level sai | "Đề bài hoặc lời giải chưa hợp lệ." |
| 429 | `RATE_LIMIT` | Quá 15 request/phút/IP | "Bạn gửi yêu cầu quá nhanh…" |
| 502 | `UPSTREAM_ERROR` | Cả Gemini và AnyRouter đều lỗi | "Chưa thể phân tích bài làm lúc này…" |
| 502 | `INVALID_OUTPUT` | Mọi output đều sai JSON/schema/rubric | "AI trả về kết quả không hợp lệ…" |
| 503 | `NOT_CONFIGURED` | Không có provider nào có key | "AI chưa được cấu hình trên server." |
| 503 | `RATE_LIMITED` | Provider báo hết quota/rate limit (sau retry/fallback) | "Chưa thể phân tích bài làm lúc này…" |
| 504 | `TIMEOUT` | Hết timeout/deadline | "AI phản hồi quá lâu…" |

`NOT_CONFIGURED` trả kèm danh sách biến còn thiếu, ví dụ `["GEMINI_API_KEY", "ANYROUTER_LEARNING_API_KEY"]`.

---

## 6. Giữ nguyên quy trình phản biện nhiều bước

- System prompt luôn được ghép ở server từ `DEBATE_PROMPT`; client không thể gửi `system` để ghi đè.
- 4 mode vẫn giữ nguyên hành vi: `analyze`, `discuss`, `hint`, `resubmit`.
- Server kiểm tra lại schema, hint level, rubric.
- Test `Debate keeps the multi-step Socratic flow for every mode through the gateway` chạy cả 4 mode qua gateway mock.

---

## 7. Biến môi trường

| Biến | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|
| `GEMINI_API_KEY` | Có (để dùng AI thật) | — | Provider chính, key được sử dụng trong môi trường hiện tại |
| `GEMINI_API_KEY_2` | Không | — | Key Gemini thứ hai cho project/môi trường khác; chỉ được lưu làm cấu hình dự phòng, không tự động xoay |
| `GEMINI_MODEL` | Không | `gemini-3.5-flash` | Model Gemini |
| `ANYROUTER_LEARNING_API_KEY` | Khuyến nghị | — | Provider dự phòng; **khác** `ANYROUTER_API_KEY` của support widget |
| `ANYROUTER_LEARNING_API_KEY_2` | Không | — | Key AnyRouter thứ hai cho project/môi trường khác; chỉ lưu làm cấu hình dự phòng, không tự động xoay |
| `ANYROUTER_LEARNING_MODEL` | Không | `anyrouter/free` | Model AnyRouter cho AI Learning |
| `AI_PROVIDER_TIMEOUT_MS` | Không | `10000` | Timeout mỗi attempt |
| `AI_TOTAL_TIMEOUT_MS` | Không | `26000` | Deadline tổng |
| `AI_MAX_RETRIES` | Không | `1` | Tối đa 3 |
| `AI_RETRY_DELAY_MS` | Không | `300` | Backoff cơ sở |
| `AI_PROVIDER_ORDER` | Không | `gemini,anyrouter` | Chỉ dùng khi cần đảo thứ tự/kiểm thử |
| `ANYROUTER_API_KEY` | Support widget | — | Không dùng cho AI Learning |
| `ANYROUTER_MODEL` | Support widget | `anyrouter/free` | Không dùng cho AI Learning |

---

## 8. Cấu hình API key

### 8.1. Local

Mở `C:\Users\admin\OneDrive\Desktop\UNIHACK2026\.env` và điền:

```dotenv
GEMINI_API_KEY=<key-Google-AI-Studio>
ANYROUTER_LEARNING_API_KEY=<key-AnyRouter-LLM-sk-ar-v1>
```

Tùy chọn:

```dotenv
GEMINI_MODEL=gemini-3.5-flash
ANYROUTER_LEARNING_MODEL=anyrouter/free
```

Sau đó restart `npm run serve` và mở `http://127.0.0.1:8173/api/ai/status`.

### 8.2. Vercel

Thêm các biến trong Project → Settings → Environment Variables:
- `GEMINI_API_KEY`
- `ANYROUTER_LEARNING_API_KEY`
- Tùy chọn `GEMINI_MODEL`, `ANYROUTER_LEARNING_MODEL`, `AI_PROVIDER_ORDER`

Sau đó Redeploy.

### 8.3. Lấy key

- Gemini: https://ai.google.dev/gemini-api/docs/api-key
- AnyRouter: https://anyrouter.dev/dashboard/keys (LLM API key `sk-ar-v1-…`)

Không gửi key vào chat, commit, log hay ảnh chụp màn hình. Không đặt key trong biến public (`NEXT_PUBLIC_*`, `VITE_*`).

---

## 9. Kiểm thử

### 9.1. Lệnh

```bash
npx playwright test tests/ai-gateway.spec.js tests/debate-api.spec.js
npm test
git diff --check
```

### 9.2. Kết quả hiện tại (mock-only)

| Bộ test | Kết quả |
|---|---|
| `tests/ai-gateway.spec.js` + `tests/debate-api.spec.js` | **33/33 PASS** |
| `npm test` (toàn bộ repo) | **127/127 PASS** |
| `git diff --check` | sạch |

### 9.3. Đã mock

- Gemini request/response.
- AnyRouter request/response (`Bearer`, `messages`, `response_format`, model mặc định và model tùy biến).
- Fallback Gemini → AnyRouter.
- Retry có giới hạn, timeout, deadline.
- `NOT_CONFIGURED` khi thiếu key, không gọi mạng.
- Redaction key cả 2 provider.
- Readiness snapshot + endpoint `/api/ai/status`.
- Quét frontend để chặn lộ key/endpoint provider.
- 4 mode phản biện.
- Cả 2 provider lỗi → `502`, không có `analysis` giả.

### 9.4. Chưa xác minh

- **AnyRouter thật:** BLOCKED — chưa có `ANYROUTER_LEARNING_API_KEY`.
- **DeepSeek/Mistral thật:** không còn dùng trong AI Learning.
- **Quota/latency thực tế:** NOT VERIFIED.
- **Vercel Environment Variables:** NOT VERIFIED.

---

## 10. Troubleshooting

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `503 NOT_CONFIGURED`, `missingEnv` có `GEMINI_API_KEY` | Chưa điền key hoặc chưa restart/redeploy | Điền `.env` rồi chạy lại `npm run serve`; Vercel thì redeploy |
| `503 NOT_CONFIGURED`, `missingEnv` có `ANYROUTER_LEARNING_API_KEY` | Chưa có key riêng cho AI Learning | Tạo LLM key trên AnyRouter dashboard và điền vào `.env` |
| `meta.provider = anyrouter`, `fallbackUsed: true` | Gemini lỗi/timeout/quota hoặc JSON sai | Xem `meta.trace`; kiểm tra key/quota/model Gemini |
| `502 UPSTREAM_ERROR` | Cả hai provider lỗi | Đọc `details.lastError` (đã redacted), kiểm tra key và model |
| `502 INVALID_OUTPUT` | Model trả JSON sai schema/rubric | Thử lại; cân nhắc đổi `ANYROUTER_LEARNING_MODEL` sang model mạnh hơn |
| `504 TIMEOUT` | Mạng chậm hoặc deadline quá thấp | Tăng `AI_PROVIDER_TIMEOUT_MS` / `AI_TOTAL_TIMEOUT_MS` |
| `503 RATE_LIMITED` | Hết quota/rate limit provider | Chờ quota hoặc dùng provider còn lại |
| `402 insufficient_balance` | AnyRouter hết credit | Nạp credit trên AnyRouter dashboard |
| `401 invalid_api_key` | Key AnyRouter sai/revoked | Tạo key mới, cập nhật `.env`, restart/redeploy |
| `404` model | Model không tồn tại với key restrictions | Đặt `GEMINI_MODEL` / `ANYROUTER_LEARNING_MODEL` hợp lệ |

---

## 11. Bảo mật và giới hạn

- Không có key thật trong repo, test, tài liệu hay `docs/` — chỉ tên biến.
- Không thêm biến public cho frontend; không import `api/_ai/*` từ browser.
- Support widget giữ nguyên `ANYROUTER_API_KEY`, không bị AI Learning dùng chung.
- Gateway không log prompt/lời giải của người học; `details` chỉ chứa metadata kỹ thuật.
- Rate limit 15 request/phút/IP vẫn giữ nguyên ở `api/debate.js`.
- Không thay đổi Smart Contract, không gửi giao dịch, không tạo credential hay dữ liệu production.

---

## 12. Việc cần làm khi có key

1. Điền `GEMINI_API_KEY` và `ANYROUTER_LEARNING_API_KEY` theo mục 8.
2. `GET /api/ai/status` phải trả `ready: true` và `missingEnv: []`.
3. Chạy một lượt `#/audit` thật, xác nhận `meta.provider`.
4. Tạm đặt sai `GEMINI_API_KEY` để xác nhận fallback sang AnyRouter (`meta.provider = "anyrouter"`).
5. Ghi lại kết quả thật vào báo cáo **sau khi** có key; đến lúc đó trạng thái AnyRouter vẫn là **BLOCKED**.
