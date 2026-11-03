# Báo cáo: Chuẩn hóa Environment & Tích hợp AI Providers — PARADOX AI

**Ngày:** 2026-11-01 (cập nhật sau khi rebase lên upstream `ab1ef9b`)
**Phạm vi:** `.env.example`, `api/_ai/*`, `api/support.js`, xác thực cục bộ, tài liệu và test liên quan
**Nguyên tắc:** Không in/ghi giá trị key. Mock không được tính là xác minh provider thật. Chỉ báo PASS/FAIL/BLOCKED/NOT TESTED.

---

## 1. Tóm tắt điều hành

| Hạng mục | Trạng thái |
|---|---|
| Xử lý conflict `.env.example` (cherry-pick) | **PASS** |
| Loại bỏ key lộ khỏi file cấu hình | **PASS** (trong working tree và index) |
| Chuẩn hóa tên biến provider | **PASS** |
| Tách key Support vs AI Learning | **SUPERSEDED** — upstream `ab1ef9b` chuyển Support sang gateway dùng chung (xem mục 7) |
| Groq thật | **BLOCKED** (không có key) |
| Gemini thật | **PASS** (2 key Gemini được người dùng yêu cầu dùng lại, có ghi nhận rủi ro) |
| AnyRouter | **N/A** — đã bị loại khỏi codebase ở `5708551` |
| Fallback / thứ tự provider | **PASS** (stub) |
| Frontend không lộ key | **PASS** |
| Regression Playwright (bộ trọng yếu) | **PASS** 78/78 |
| Vercel Environment | **NOT TESTED** |

Kết luận ngắn: cấu hình đã được chuẩn hóa và an toàn trong repo. AI Learning trên local **đã chạy thật bằng Gemini**. Groq vẫn thiếu key nên chưa xác minh. Support widget giờ dùng chung gateway (theo upstream), không còn key riêng.

---

## 2. Git và xử lý conflict

- Branch: `main`; remote `origin` = `https://github.com/hiza325/UNIHACK2026.git`.
- Cherry-pick `.env.example` trước đó được hợp nhất thủ công, không chọn máy móc một phía, và đã tạo commit `06c1dab`.
- Trong lúc làm việc, remote tiến lên `ab1ef9b` (gồm `5708551` bỏ AnyRouter, `ab1ef9b` đưa Support qua gateway). `git pull --rebase origin main` gặp conflict ở 6 file.
- Cách xử lý: áp dụng kiến trúc mới của upstream cho `.env.example`, `README.md`, `api/_ai/gateway.js`, `docs/AI-LEARNING-INTEGRATION.md`, `tests/ai-gateway.spec.js`, `tests/debate-api.spec.js`; sau đó **chỉ giữ lại thay đổi riêng của nhánh** là model Gemini `gemini-3.5-flash-lite` và chỉnh test tương ứng. `api/_ai/providers.js` được đưa về đúng tên biến của upstream (`GROQ_API_KEY` / `GROQ_MODEL`).
- **Không** abort rebase, **không** `git reset --hard`, **không** `git clean -fd`, **không** xóa `.env`.

Kiểm tra sau khi sửa:

| Kiểm tra | Kết quả |
|---|---|
| Conflict marker còn lại trong 6 file | 0 |
| Giá trị giống key thật trong file track | 0 |
| `.env` bị gitignore | Có |

---

## 3. Bảo mật API key

### 3.1. Giá trị đã lộ

Các giá trị sau từng nằm trong `.env.example` (file được track, đã từng vào commit `81d6e71`):

- `GEMINI_API_KEY`
- `GEMINI_API_KEY_2`
- `GROQ_LEARNING_API_KEY` (tên cũ)

Theo nhiệm vụ ban đầu, các giá trị này **được coi là đã lộ**. Ngày 2026-11-01 người dùng yêu cầu rõ ràng dùng lại hai key Gemini để chạy gấp; hai key này nằm trong `.env` local (gitignored) và đã dùng để xác minh thật. Báo cáo không ghi lại giá trị. Rủi ro vẫn được giữ nguyên: nên rotate sau khi hết nhu cầu.

### 3.2. Hành động đã thực hiện

- Xóa mọi giá trị key khỏi `.env.example`, thay bằng placeholder rỗng.
- Xác nhận `.env` nằm trong `.gitignore`.
- Quét file track và file frontend: không còn giá trị key thật.
- Không đưa key vào `index.html`, `app.js`, `debate-ai.js`, `VITE_*` hay API response.
- Gateway che key trong log bằng regex `^(GROQ_API_KEY|GEMINI_API_KEY)(?:_\d+)?$` và danh sách `SECRET_PATTERNS`.

### 3.3. Việc người dùng phải làm

- **Thu hồi/rotate** các key đã lộ ở trên.
- Key vẫn tồn tại trong lịch sử Git (commit `81d6e71`). Báo cáo này **không** viết lại lịch sử Git.

---

## 4. Chuẩn hóa Environment Variables

Sau khi rebase, toàn bộ hệ thống dùng **một** bộ tên biến duy nhất, không còn tiền tố `_LEARNING`:

| Biến | Vai trò | Trạng thái trong `.env.example` |
|---|---|---|
| `GROQ_API_KEY` | Provider chính (AI Learning + Support) | Placeholder rỗng |
| `GROQ_API_KEY_2/_3` | Dự phòng cấu hình, không tự xoay | Placeholder rỗng |
| `GROQ_MODEL` | Model Groq | `openai/gpt-oss-20b` |
| `GEMINI_API_KEY` | Provider dự phòng | Placeholder rỗng |
| `GEMINI_API_KEY_2/_3` | Dự phòng cấu hình, không tự xoay | Placeholder rỗng |
| `GEMINI_MODEL` | Model Gemini | `gemini-3.5-flash-lite` |

Thay đổi mã nguồn tương ứng:

- `api/_ai/providers.js`: catalogue chỉ còn Groq và Gemini; `GROQ_PRIMARY_API_KEY_ENV = 'GROQ_API_KEY'`, `GROQ_SECONDARY_API_KEY_ENV = 'GROQ_API_KEY_2'`.
- `api/_ai/gateway.js`: redaction/đếm key theo `GROQ_API_KEY` / `GEMINI_API_KEY` (hỗ trợ hậu tố `_2`, `_3`).
- `api/support.js`: gọi `createAiGateway` với `env: process.env`, không còn `ANYROUTER_API_KEY`; `maxRetries: 0` để Support không retry ngoài ý muốn.
- `support-ai-config.js`, `index.html` (CSP): không còn domain `anyrouter`.
- `playwright.config.js`: các biến provider được đặt rỗng khi test để không đọc key từ `.env` local.
- `tests/ai-gateway.spec.js`, `tests/debate-api.spec.js`, `tests/support-api.spec.js`: kỳ vọng theo tên biến mới và model `gemini-3.5-flash-lite`.
- `README.md`, `docs/AI-LEARNING-INTEGRATION.md`: cập nhật kiến trúc dùng chung gateway.

Không đổi tên biến OTP / Supabase / SMTP / Avalanche.

---

## 5. Kiểm tra từng provider

### 5.1. Groq — BLOCKED

- Không có `GROQ_API_KEY` trong môi trường local.
- Key từng xuất hiện trong cấu hình chia sẻ bị coi là đã lộ, không dùng để test.
- Request/response của Groq (headers, body, model, fallback) đã được kiểm tra bằng stub và **không** được tính là xác minh provider thật.

### 5.2. Gemini — PASS (request thật ngày 2026-11-01)

- `/api/ai/status`: `ready: true`, `configured: ["gemini"]`, `geminiKeyCount: 2`.
- Gọi handler trực tiếp: provider `gemini`, 1 attempt, không fallback, `status: correct`, `issues: 0`.
- Gọi qua đúng endpoint web `POST /api/debate`: **HTTP 200**, provider `gemini`, không fallback.
- Không có key nào xuất hiện trong response.
- Sự cố "bài đúng chấm được, bài sai không phân tích được": `gemini-3.5-flash` trả HTTP 503 "high demand" liên tục; gateway không retry và không còn provider dự phòng nên trả 502 `UPSTREAM_ERROR`, UI hiện "Chưa thể phân tích bài làm lúc này". Đây là lỗi hạ tầng provider, không phải logic chấm bài sai.
- Đã chuyển model mặc định sang `gemini-3.5-flash-lite` và xác minh lại bằng request thật: bài đúng 1,3 giây (`correct`), bài sai 1,5 giây (`incorrect`), bài code sai 1,9 giây (`incorrect`), resubmit 2,0 giây (`correct`) — tất cả PASS, 1 attempt, `trace=NOT_CONFIGURED>OK`, không fallback.
- Xác minh trên giao diện thật: bài sai → `.debate-result.incorrect` kèm nhận xét lỗi dấu; bài đúng → `.debate-result.correct`, không có thông báo lỗi.

### 5.3. AnyRouter — N/A

- Provider đã bị xóa khỏi `api/_ai/providers.js` ở commit `5708551`; Support được chuyển sang gateway ở `ab1ef9b`.
- Không còn endpoint, key hay domain `anyrouter` trong code, test hoặc CSP.

---

## 6. Thứ tự provider và fallback

Thứ tự: **Groq → Gemini**.

| Hành vi | Cách kiểm tra | Kết quả |
|---|---|---|
| Groq lỗi/thiếu → Gemini | Stub provider | PASS |
| Timeout / deadline / retry có giới hạn | Stub provider | PASS |
| `AI_PROVIDER_ORDER` ghi đè thứ tự | Stub provider | PASS |
| Cả hai lỗi → lỗi rõ ràng, không tạo analysis giả | Stub provider | PASS |
| Thiếu toàn bộ key → `503 NOT_CONFIGURED`, không gọi mạng | Unit/API test | PASS |

Lưu ý: các kết quả trên là **stub**, không phải xác minh provider thật.

---

## 7. Frontend và Backend (thay đổi kiến trúc của upstream)

- Không file frontend nào (`*.js` gốc, `views/*.js`, `index.html`, CSS) chứa tên biến key, endpoint provider hay `process.env`.
- Test `Provider schemas stay server-side only and never reach browser bundles` PASS.
- Key chỉ được đọc trong `api/_ai/*` và `api/support.js` ở server.
- **Thay đổi so với nhiệm vụ ban đầu:** yêu cầu ban đầu là Support và AI Learning dùng key riêng, không fallback chéo. Upstream `ab1ef9b` đã chủ động đưa Support qua gateway dùng chung (`GROQ_API_KEY` → `GEMINI_API_KEY`), nên hiện chỉ còn **một** hệ key. Vì đây là kiến trúc mới đã nằm trên nhánh chung, nhánh này không revert; ghi nhận rõ để tránh hiểu nhầm là còn key Support riêng.
- Hệ quả cần biết: quota Groq/Gemini bị chia sẻ giữa Support và AI Learning; lỗi hoặc hết quota của một bên ảnh hưởng bên còn lại. Nếu cần tách lại, phải thêm key namespace riêng cho Support và tham số hoá gateway, không chỉ đổi tên biến.

---

## 8. Local và Vercel Environment

| Môi trường | Trạng thái |
|---|---|
| `.env` local (gitignored) | `GEMINI_API_KEY` + `GEMINI_API_KEY_2` CONFIGURED (theo yêu cầu 2026-11-01); `GEMINI_MODEL=gemini-3.5-flash-lite`; `GROQ_API_KEY` MISSING; còn `ANYROUTER_*` cũ nhưng code không đọc |
| `.env.example` | Chỉ placeholder, không có key thật |
| Vercel Environment Variables | **NOT TESTED** — không truy cập dashboard, không deploy |

Để dùng AI thật trên Vercel cần thêm (giá trị mới, không dùng key đã lộ):

- `GEMINI_API_KEY` (và tùy chọn `GEMINI_MODEL=gemini-3.5-flash-lite`)
- `GROQ_API_KEY` (và tùy chọn `GROQ_MODEL`) nếu muốn Groq làm provider chính

Lưu ý vận hành: máy local không có Supabase nên dùng chế độ tài khoản cục bộ; trên localhost panel đăng nhập chỉ hiện nút "Vào cục bộ" (tài khoản local, không gọi `/api/auth`). Thêm `?auth=account` nếu cần thấy form tài khoản đầy đủ, và `?auth=account` cũng được dùng trong Playwright.

---

## 9. Bảng kiểm thử ENV01–ENV16

| Mã | Nội dung | Cách kiểm tra | Kết quả |
|---|---|---|---|
| ENV01 | Không có key → 503 `NOT_CONFIGURED`, `missingEnv` đúng | Unit/API test | PASS |
| ENV02 | Chỉ Groq → nhận diện đúng, không lộ key | Stub status | PASS |
| ENV03 | Chỉ Gemini → nhận diện đúng | Stub status | PASS |
| ENV04 | AnyRouter Learning → nhận diện | — | N/A (provider đã xóa) |
| ENV05 | Nhiều key đánh số → chỉ đếm/không tự xoay | Stub status | PASS |
| ENV06 | Groq thật | Request thật | **BLOCKED** |
| ENV07 | Gemini thật | Request thật | **PASS** |
| ENV08 | Support thật (gateway dùng chung) | Request thật | **NOT TESTED** với key hiện tại; đã PASS trước refactor bằng đường riêng (xem mục 11) |
| ENV09 | AnyRouter Learning thật | — | N/A |
| ENV10 | Fallback Groq → Gemini | Stub | PASS |
| ENV11 | Retry / timeout / deadline | Stub | PASS |
| ENV12 | `AI_PROVIDER_ORDER` | Stub | PASS |
| ENV13 | Không lộ bí mật ở frontend / `index.html` | Quét + test | PASS |
| ENV14 | Tách key Support vs Learning | Kiểm tra mã | **SUPERSEDED** (upstream dùng chung gateway) |
| ENV15 | `.env` bị ignore; không có key trong file track | `git check-ignore` + quét | PASS |
| ENV16 | Contract/flow AI không bị phá | Spec + SQL harness | PASS |

---

## 10. Regression

| Bộ test | Kết quả |
|---|---|
| `tests/app.spec.js` + `tests/password-reset.spec.js` + `tests/ai-gateway.spec.js` + `tests/debate-api.spec.js` + `tests/support-api.spec.js` | **78/78 PASS** (20,9 giây, sau khi rebase và đổi model sang lite) |
| Toàn bộ Playwright trên `main` trước refactor | **251 test**: 249 PASS, 2 timeout canvas/PDF; chạy riêng `certificate-renderer.spec.js` → **9/9 PASS** |
| AI Contract (`tests/ai-contract.spec.js`, worktree QA) | **21/21 PASS** |
| SQL flow harness (`scripts/verify-ai-flow-sql.mjs`, worktree QA) | **58/58 PASS** |
| Acceptance suite (`tests/ai-acceptance.spec.js`, worktree QA) | **21/21 PASS** |

Ghi chú:

- Hai test website support trong `app.spec.js` từng timeout khi chạy song song cùng lúc với bộ test lớn; chạy lại riêng đều PASS → flaky do tải.
- Hai test export PNG/PDF trong `certificate-renderer.spec.js` timeout khi chạy toàn bộ suite; chạy riêng cả file PASS 9/9.
- `ai-contract.spec.js`, SQL harness và acceptance cần `api/_ai/contract.js` + migration Phase 3.2 vốn chỉ tồn tại trong worktree QA.
- Không có test nào dùng mock được đánh dấu là xác minh provider thật.

---

## 11. Rủi ro và việc còn lại

| # | Việc cần làm | Mức độ |
|---|---|---|
| 1 | Rotate 2 key Gemini (đang dùng theo yêu cầu, vẫn là key từng lộ) và 1 key Groq từng lộ (không dùng) | Cao |
| 2 | Thêm `GEMINI_API_KEY` (`gemini-3.5-flash-lite`) và tùy chọn `GROQ_API_KEY` vào Vercel rồi redeploy | Cao |
| 3 | Xác minh ENV08 với gateway mới bằng request thật khi có key trên môi trường triển khai | Trung bình |
| 4 | Quyết định có tách lại key Support hay chấp nhận dùng chung gateway (ảnh hưởng quota) | Trung bình |
| 5 | Cân nhắc xử lý lịch sử Git chứa key cũ | Trung bình |
| 6 | Xác minh Groq thật (ENV06) khi có key mới | Thấp |

**Đã xác minh AI Learning bằng request thật tới Gemini trên môi trường local.** Groq chưa có key nên chưa xác minh. Vercel chưa được cấu hình/kiểm tra.
