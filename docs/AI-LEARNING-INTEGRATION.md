# PARADOX AI — AI Learning Integration (Groq → Gemini)

**Phạm vi:** AI Learning / AI Debate Engine (`#/audit`, `POST /api/debate`)

**Ngày cập nhật:** 2026-11-01

**Trạng thái:** Groq Cloud là provider chính, Gemini là provider dự phòng duy nhất. Mock test đầy đủ. Kết nối Groq cần `GROQ_API_KEY`; Gemini đã **VERIFIED**.

**Không thay đổi:** Smart Contract, giao dịch blockchain, dữ liệu production, commit/push/deploy, support widget.

---

## 1. Tóm tắt thay đổi

| Thành phần | Trước | Sau |
|---|---|---|
| Frontend Audit | `#/audit` → `debate-ai.js` → `POST /api/debate` | Giữ nguyên, không đổi contract |
| Backend AI | `api/debate.js` → `api/_ai/gateway.js` → Gemini → DeepSeek/Mistral | `api/debate.js` → `api/_ai/gateway.js` → Groq → Gemini |
| Provider chính | Gemini | **Groq Cloud** |
| Provider dự phòng | DeepSeek/Mistral | **Gemini** |
| Key AI Learning | `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY` | `GROQ_API_KEY`, `GEMINI_API_KEY` |
| Support widget | `ANYROUTER_API_KEY` | Dùng chung gateway: `GROQ_API_KEY` → `GEMINI_API_KEY`; không còn AnyRouter trong code |
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
   ├── 1. Groq Cloud        GROQ_API_KEY                 (primary)
   └── 2. Google Gemini     GEMINI_API_KEY               (fallback)
```

Thư viện server-only:

| File | Vai trò |
|---|---|
| `api/_ai/providers.js` | Catalogue Groq + Gemini: endpoint, request builder, response parser, tên biến môi trường |
| `api/_ai/gateway.js` | Điều phối retry/fallback/timeout, tổng hợp lỗi, redaction, readiness snapshot |
| `api/debate.js` | Nghiệp vụ AI Learning: prompt, schema, rubric, proof record, và health check `GET /api/ai/status` |

### 2.1. Catalogue provider

| Thứ tự | ID | Vai trò | Endpoint | Model mặc định | Biến key | Biến model |
|---:|---|---|---|---|---|---|
| 1 | `groq` | `primary` | `https://api.groq.com/openai/v1/chat/completions` | `openai/gpt-oss-120b` | `GROQ_API_KEY` | `GROQ_MODEL` |
| 2 | `gemini` | `fallback` | `generativelanguage.googleapis.com` | `gemini-3.5-flash` | `GEMINI_API_KEY` | `GEMINI_MODEL` |

Groq là OpenAI-compatible: `Authorization: Bearer …`, `messages`, `max_tokens`, `response_format: { "type": "json_object" }`. Gemini dùng `x-goog-api-key`, `systemInstruction`, `contents`, `generationConfig.responseMimeType`.

### 2.2. Ghi chú

AI Learning chỉ dùng hai provider ở trên. Widget hỗ trợ website (`api/support.js`) là một tích hợp riêng, không thuộc catalogue này.

---

## 3. Thiết kế nhiều API key (không xoay key để né quota)

- Gateway chỉ dùng **một key đã cấu hình cho mỗi provider** trong một request chain. Không tự động xoay qua nhiều key để né rate limit/hạn mức.
- `GEMINI_API_KEY` là key được sử dụng trong môi trường hiện tại. `GEMINI_API_KEY_2` chỉ được nhận diện và báo cáo trong `/api/ai/status` (`geminiKeyCount`, `geminiBackupKeyConfigured`), không được tự động dùng để vượt quota.
- `GROQ_API_KEY` là key Groq được sử dụng; `GROQ_API_KEY_2` chỉ được báo cáo (`groqKeyCount`, `groqBackupKeyConfigured`) và không tự động xoay.
- Nếu gặp `402 insufficient_balance` (hết quota cứng), provider đó được coi là không khả dụng cho request hiện tại và **không** thử key khác trong cùng phạm vi quota.
- Nhiều key chỉ nên dùng cho các môi trường/project/account khác nhau (staging/production, team khác nhau) bằng cách chọn key phù hợp trong biến môi trường của deployment. Không triển khai key rotation trong gateway.
- Secret chỉ đọc từ `process.env` ở server; không đưa vào frontend, log hay Git.

---

## 4. Hành vi gateway

### 4.1. Thứ tự provider

1. Mặc định: `groq` → `gemini`.
2. Có thể đổi bằng `AI_PROVIDER_ORDER` (ví dụ `gemini,groq`), chỉ nhận id hợp lệ, tự loại id lạ và id trùng.
3. Provider không có key bị coi là `NOT_CONFIGURED`, bị bỏ qua nhưng vẫn xuất hiện trong chẩn đoán.

### 4.2. Timeout và retry

| Tham số | Mặc định | Giới hạn | Ý nghĩa |
|---|---:|---:|---|
| `AI_PROVIDER_TIMEOUT_MS` | 25000 | 100–60000 | Timeout mỗi lần gọi một provider |
| `AI_TOTAL_TIMEOUT_MS` | 55000 | 100–120000 | Deadline tổng cho toàn bộ chuỗi provider |
| `AI_MAX_RETRIES` | 0 | 0–3 | Số lần retry **trên mỗi provider** (mặc định 0: fallback nhanh hơn retry) |
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

Khi cả 3 provider thất bại, gateway ném lỗi tổng hợp và `api/debate.js` trả lỗi — **không tạo `analysis` giả**.

### 4.4. Bảo vệ secret

- Key chỉ đọc từ `process.env` trong `api/_ai/*` và không bao giờ nằm trong request body, response, log hay test snapshot.
- Mọi message lỗi đi qua `redact()`: thay giá trị key đã cấu hình bằng `[redacted]`, đồng thời chặn pattern `AIza…`, `gsk_…`, `sk-ar-…`, `Bearer …`.
- Response lỗi chỉ chứa metadata kỹ thuật và `attempts`, không chứa key.
- Test `Provider schemas stay server-side only and never reach browser bundles` quét toàn bộ JS frontend + `index.html`.

### 4.5. Health check thật (probe)

`GET /api/ai/status` chỉ cho biết **có key hay không** (`ready` = ít nhất một provider đã cấu hình), **không** chứng minh upstream còn sống. Response vì vậy luôn kèm:

```json
"probe": { "available": true, "checked": false, "endpoint": "/api/debate?aiStatus=1&probe=1" }
```

Muốn kiểm tra thật, gọi endpoint probe (tốn 1 request model rất nhỏ, `maxOutputTokens: 128`, timeout 25s, không retry):

```bash
curl -s "https://<host>/api/debate?aiStatus=1&probe=1"
```

- Provider trả lời: `{"probe":{"checked":true,"ok":true,"provider":"groq","model":"groq/openai/gpt-oss-120b","latencyMs":128,"requestId":"…"}}`
- Provider lỗi: `{"probe":{"checked":true,"ok":false,"code":"UPSTREAM_ERROR","status":502,"latencyMs":25600,"attempts":[{"provider":"gemini","attempt":1,"code":"TIMEOUT","durationMs":25000}],"lastError":"Google Gemini timed out","requestId":"…"}}`

Probe dùng chung rate limit 15 request/phút/IP với Analyze và **không** tạo evaluation hay ghi dữ liệu học tập.

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
- Với `mode = resubmit`, `analysis.proofRecord.model` ghi provider thực tế đã trả lời, ví dụ `gemini/gemini-3.5-flash` khi Groq lỗi.

### 5.2. Lỗi

| HTTP | `code` | Khi nào | UI |
|---:|---|---|---|
| 400 | `INVALID_INPUT` | Thiếu đề/lời giải, sai mode, hint level sai | "Đề bài hoặc lời giải chưa hợp lệ." |
| 429 | `RATE_LIMIT` | Quá 15 request/phút/IP | "Bạn gửi yêu cầu quá nhanh…" |
| 502 | `UPSTREAM_ERROR` | Cả Groq và Gemini đều lỗi | "Chưa thể phân tích bài làm lúc này…" |
| 502 | `INVALID_OUTPUT` | Mọi output đều sai JSON/schema/rubric | "AI trả về kết quả không hợp lệ…" |
| 503 | `NOT_CONFIGURED` | Không có provider nào có key | "AI chưa được cấu hình trên server." |
| 503 | `RATE_LIMITED` | Provider báo hết quota/rate limit (sau retry/fallback) | "Chưa thể phân tích bài làm lúc này…" |
| 504 | `TIMEOUT` | Hết timeout/deadline | "AI phản hồi quá lâu…" |

`NOT_CONFIGURED` trả kèm danh sách biến còn thiếu, ví dụ `["GROQ_API_KEY", "GEMINI_API_KEY"]`.

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
| `GROQ_API_KEY` | Có (để dùng AI thật) | — | Provider chính (Groq Cloud), key bắt đầu bằng `gsk_` |
| `GROQ_API_KEY_2` | Không | — | Key Groq thứ hai cho project/môi trường khác; chỉ được lưu làm cấu hình dự phòng, không tự động xoay |
| `GROQ_MODEL` | Không | `openai/gpt-oss-120b` | Model Groq cho AI Learning |
| `GEMINI_API_KEY` | Khuyến nghị | — | Provider dự phòng thứ nhất |
| `GEMINI_API_KEY_2` | Không | — | Key Gemini thứ hai cho project/môi trường khác; chỉ được lưu làm cấu hình dự phòng, không tự động xoay |
| `GEMINI_MODEL` | Không | `gemini-3.5-flash` | Model Gemini |
| `AI_PROVIDER_TIMEOUT_MS` | Không | `25000` | Timeout mỗi attempt |
| `AI_TOTAL_TIMEOUT_MS` | Không | `55000` | Deadline tổng |
| `AI_MAX_RETRIES` | Không | `0` | Tối đa 3 |
| `AI_RETRY_DELAY_MS` | Không | `300` | Backoff cơ sở |
| `AI_PROVIDER_ORDER` | Không | `groq,gemini` | Chỉ dùng khi cần đảo thứ tự/kiểm thử |
| `SUPPORT_ALLOWED_ORIGINS` | Không | — | Danh sách origin được gọi `/api/support`, cách nhau bằng dấu phẩy |

---

## 8. Cấu hình API key

### 8.1. Local

Mở `C:\Users\admin\OneDrive\Desktop\UNIHACK2026\.env` và điền:

```dotenv
GROQ_API_KEY=<key-Groq-gsk_...>
GEMINI_API_KEY=<key-Google-AI-Studio>
```

Tùy chọn:

```dotenv
GROQ_MODEL=openai/gpt-oss-120b
GEMINI_MODEL=gemini-3.5-flash
```

Sau đó restart `npm run serve` và mở `http://127.0.0.1:8173/api/ai/status`.

### 8.2. Vercel

Thêm các biến trong Project → Settings → Environment Variables:
- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- Tùy chọn `GROQ_MODEL`, `GEMINI_MODEL`, `AI_PROVIDER_ORDER`

Sau đó Redeploy.

### 8.3. Lấy key

- Groq Cloud: https://console.groq.com/keys (key `gsk_…`)
- Gemini: https://ai.google.dev/gemini-api/docs/api-key

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
| `tests/ai-gateway.spec.js` + `tests/debate-api.spec.js` | **40/40 PASS** |
| `npm test` (toàn bộ repo) | **250/250 PASS** |
| `git diff --check` | sạch |

### 9.3. Đã mock

- Groq request/response (`Bearer`, `messages`, `response_format`, model mặc định và model tùy biến).
- Gemini request/response.
- Fallback Groq → Gemini.
- Retry có giới hạn, timeout, deadline.
- `NOT_CONFIGURED` khi thiếu key, không gọi mạng.
- Redaction key của cả hai provider.
- Readiness snapshot + endpoint `/api/ai/status`.
- Quét frontend để chặn lộ key/endpoint provider.
- 4 mode phản biện.
- Cả hai provider lỗi → `502`, không có `analysis` giả.

### 9.4. Chưa xác minh

- **Groq thật:** NOT VERIFIED — cần `GROQ_API_KEY` trên Vercel/`.env`.
- **DeepSeek/Mistral thật:** không còn dùng trong AI Learning.
- **Quota/latency thực tế:** NOT VERIFIED.
- **Vercel Environment Variables:** NOT VERIFIED.

---

## 10. Troubleshooting

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `503 NOT_CONFIGURED`, `missingEnv` có `GROQ_API_KEY` | Chưa điền key hoặc chưa restart/redeploy | Điền `.env` rồi chạy lại `npm run serve`; Vercel thì redeploy |
| `503 NOT_CONFIGURED`, `missingEnv` có `GEMINI_API_KEY` | Chưa điền key hoặc chưa restart/redeploy | Điền `.env` rồi chạy lại `npm run serve`; Vercel thì redeploy |
| `meta.provider = gemini`, `fallbackUsed: true` | Groq lỗi/timeout/quota hoặc JSON sai | Xem `meta.trace`; kiểm tra `GROQ_API_KEY`/`GROQ_MODEL` |
| `502 UPSTREAM_ERROR` | Cả hai provider lỗi | Đọc `details.lastError` (đã redacted), kiểm tra key và model |
| `502 INVALID_OUTPUT` | Model trả JSON sai schema/rubric | Thử lại; cân nhắc đổi `GROQ_MODEL` sang model mạnh hơn |
| `504 TIMEOUT` | Mạng chậm hoặc deadline quá thấp | Tăng `AI_PROVIDER_TIMEOUT_MS` / `AI_TOTAL_TIMEOUT_MS` |
| `503 RATE_LIMITED` | Hết quota/rate limit provider | Chờ quota hoặc dùng provider còn lại |
| `401 invalid_api_key` | Key Groq/Gemini sai hoặc đã bị revoke | Tạo key mới, cập nhật `.env`, restart/redeploy |
| `404` model | Model không tồn tại với key restrictions | Đặt `GROQ_MODEL` / `GEMINI_MODEL` hợp lệ |

---

## 11. Bảo mật và giới hạn

- Không có key thật trong repo, test, tài liệu hay `docs/` — chỉ tên biến.
- Không thêm biến public cho frontend; không import `api/_ai/*` từ browser.
- Support widget dùng chung gateway/provider như AI Learning (`GROQ_API_KEY` → `GEMINI_API_KEY`); không còn provider riêng.
- Gateway không log prompt/lời giải của người học; `details` chỉ chứa metadata kỹ thuật.
- Rate limit 15 request/phút/IP vẫn giữ nguyên ở `api/debate.js`.
- Không thay đổi Smart Contract, không gửi giao dịch, không tạo credential hay dữ liệu production.

---

## 12. Việc cần làm khi có key

1. Điền `GROQ_API_KEY`, `GEMINI_API_KEY` theo mục 8.
2. `GET /api/ai/status` phải trả `ready: true` và `missingEnv: []`.
3. Chạy một lượt `#/audit` thật, xác nhận `meta.provider = "groq"`.
4. Tạm đặt sai `GROQ_API_KEY` để xác nhận fallback sang Gemini (`meta.provider = "gemini"`).
5. Ghi lại kết quả thật vào báo cáo **sau khi** có key; đến lúc đó trạng thái Groq là **NOT VERIFIED**.
