# 06 — Nghiệm thu P0/P1 theo nhóm (A–F), ngày 02/11/2026

Phạm vi: nhánh `docs/verification-2026-11-02`, base `ab1ef9b` — commit đang chạy thật trên
staging `paradox-ai-staging.vercel.app` (xác minh qua fingerprint `support-ai-config.js`
SHA1 `015756e9bfc6`, xem `05-phase-verification-summary.md` mục 0.1).

Quy tắc ghi kết quả: **không có bằng chứng tái kiểm tra được thì ghi CHƯA KIỂM CHỨNG, không ghi PASS.**
Không sửa code trong lượt này (quy tắc 8) — mọi dòng "Nguyên nhân gốc" chỉ mô tả, chưa có bản vá được duyệt.

Thời điểm đo live: 2026-11-02, `curl -I` / `curl -s` trực tiếp tới host staging, không qua proxy.

---

## 1. Bảng kết quả

| Hạng mục | Mã | Kết quả | Bằng chứng | Nguyên nhân gốc | Việc còn lại |
|---|---|---|---|---|---|
| Ma trận endpoint + cache trên staging | A-1 | PASS có ngoại lệ | `curl -I` 2026-11-02: `/api/auth/session` 401; `/api/credentials` GET / GET?code= / POST 401; `/api/learning-records` GET/POST 401; `/api/admin/users` 401; auth POST trả 405 khi GET; `/api/auth/login`+`/otp` 400; `/api/ai/status` 200. Tất cả `Cache-Control: private, no-store` **trừ** `POST /api/debate` và `POST /api/support` | `api/debate.js` và `api/support.js` không gọi `noStore()` (`grep -c noStore` = 0 ở cả hai; 11 route khác có import/gọi). Vercel áp cache mặc định `public, max-age=0, must-revalidate` cho POST không tự đặt header | Duyệt sửa: thêm `noStore()` vào 2 handler. Tái đo live sau redeploy |
| Config fail-closed | A-2 | PASS | `authConfig({})` ném `AUTH_NOT_CONFIGURED`; `authConfig({ADMIN_EMAILS:''}).adminEmails` → `[]` (`api/auth/_supabase.js:63`, `:157`) | — | Kiểm tra biến `ADMIN_EMAILS` thực tế trong Vercel (chỉ owner đọc được) |
| Phân quyền IDOR học tập | A-3 | CHƯA KIỂM CHỨNG | Code review: `ownSession`/`ownSubmission` khoá theo `learnerId` (`api/learning-records/_service.js:247-324`), `learner_id` luôn là `requireUuid(user?.id)` | — | Cần fixture Student A / Student B để gọi cross-user thật |
| Whitelist field phía client | A-4 | PASS | `api/learning-records/_store.js` không có dòng đọc `body.*` / `payload.*`; service chỉ nhận `problem` (3–12000), `initialSolution` (1–16000), `title`, `subject` (1–80), `sessionId`, `solution` | — | — |
| Phát hành / thu hồi chứng nhận | A-5..A-7 | BLOCKED | cần đăng nhập admin trên staging | — | fixture Admin + bạn duyệt thao tác phát hành |
| Upload / FILE-01 | A-8 | FAIL (tài liệu, không phải code) | `api/support/_support-prompt.js:39` chỉ nói phân tích `.txt/.js/.py`; `app-config.js` copy ghi "Files are protected and used only in this session." Không có endpoint upload nào trong `api/` | UI promise mô tả cơ chế bảo vệ file không tồn tại; thực tế chỉ gửi nội dung text | Duyệt sửa copy UI, hoặc thêm endpoint thật |
| Dependency audit | A-9 | PASS (production) | `npm audit --omit=dev` → `found 0 vulnerabilities`. Toàn cục: 3 high, đều `zod <4.6.6`, chuỗi phụ thuộc tới `hardhat@3.21.1` (devDependency, không ship) | — | Không bắt buộc; chỉ nâng nếu bỏ hardhat khỏi deps |
| Rate limiting | A-10 | FAIL (đã biết) | `api/auth/_rate-limit.js:6-7` dùng `new Map()` trong module → bộ đếm chỉ đúng trong một instance | Serverless không có store chung | Cần Redis/Postgres table hoặc chấp nhận giới hạn best-effort |
| UI state loading/empty/error/real/demo | B-1 | PASS (DOM assertion) | `npx playwright test tests/real-data-ui.spec.js` → **8 passed (3.2s)**, 2026-11-02. Assert: `[data-dashboard-state="loading"]` hiển thị và `.dashboard-stats` có 0 phần tử khi pending; empty không bịa session "continue"; 503 → `[data-dashboard-state="error"]` + `[data-retry-learning-data]`, bấm retry hết error; real → badge `DỮ LIỆU THẬT`, resume đúng session, `PXP-2026-REAL-0001` tách riêng; demo → badge `DEMO` | — | **Ảnh chụp: CHƯA KIỂM CHỨNG.** Screenshot tự động của Playwright (`test-finished-1.png`) chụp lúc teardown nên ra ảnh trắng; cần spec gọi `page.screenshot()` ngay tại thời điểm assert. Lệnh chạy spec đó bị từ chối nên chưa có PNG |
| Không còn dữ liệu mẫu giả làm dữ liệu thật | B-2 | PASS | như B-1: mọi state đều đọc từ `/api/*` (mock bằng `page.route`), badge real/demo tách bạch, `.dashboard-stats` bị ẩn khi loading/error/empty | — | Trang cần AI sinh dữ liệu mới: BLOCKED, không ghi PASS |
| Client vs server stats | B-3 | CHƯA KIỂM CHỨNG | chưa đối chiếu | — | So `achievementSummary` server (`api/learning-records/_service.js`) với tính toán client: trần 100 session, định nghĩa streak / "complete" |
| Bytecode on-chain vs artifact | C-1 | FAIL (không khớp tuyệt đối) | RPC read-only Fuji `eth_getCode` = 2322 bytes, `artifacts/.../LearningCredentialRegistry.json` = 2322 bytes; **khác nhau từ hex index 4560**: artifact `58221220a19d52354ef8ad21d94d13a3` vs on-chain `5822122007c0cc6641d9907062fa7400` | Khác biệt nằm trong CBOR metadata (source hash) ở đuôi bytecode → **opcode khớp, nhưng không tái dựng được artifact byte-for-byte**; nguyên nhân thường là compiler settings / path prefix khi compile không đúng cấu hình Hardhat đã deploy | C6: xác minh source trên Snowtrace; compile lại với đúng settings rồi so lại |
| Test nền on-chain | C-2 | PASS | `npx playwright test` full suite → **251 passed (33.0s)**; `npx hardhat test` → **8 passing** (2026-11-02) | — | — |
| Review contract | C-3 | FAIL (1 phát hiện) | `contracts/LearningCredentialRegistry.sol:104-111` `revokeCredential` chỉ `onlyIssuer`, **không** kiểm tra `credential.issuer == msg.sender` | Bất kỳ issuer nào trong `authorizedIssuers` đều thu hồi được chứng nhận do issuer khác phát hành. Ghi nhận tốt: không lưu PII; không có external call nên không có đường reentrancy; `evidenceCredentials` chặn đăng ký trùng evidence hash; `OwnerMustRemainIssuer` chặn owner tự mất quyền | Duyệt sửa: `require(credential.issuer == msg.sender)`. Lưu ý đây là hành vi đã deploy — sửa source sẽ làm C1/C6 lệch thêm |
| Credential code entropy | C-4 | FAIL (ghi nhận, chưa sửa) | mã vẫn do admin nhập, tuần tự `PXP-2026-ALG-0001` | Đổi thuật toán sinh mã sẽ vô hiệu mọi mã đã phát hành | Quyết định sản phẩm (xem mục 3) |
| Xử lý lỗi RPC | D | PASS | `api/credentials/_service.js:797-815` `verify()` truyền ngược lỗi RPC, không nuốt; `_avalanche.js:40,53` trả 503 `AVALANCHE_RPC_INVALID` / `AVALANCHE_RPC_UNAVAILABLE`; `_service.js:218` `verifyAiEvidence` chặn mock/demo (`MOCK_CREDENTIAL_FORBIDDEN`) | — | — |
| Chặn endpoint admin server-side | D1 | PASS | A-1: `/api/admin/users` 401 khi không có session | — | — |
| Không leak secret trong log API | D4 | PASS | không dòng `console.*` nào trong `api/` khớp key/token/secret/password/cookie; `redact()` ở 7 điểm trả lỗi của `api/_ai/gateway.js` | — | — |
| Audit log admin | E | FAIL (im lặng có chủ đích) | `api/admin/_audit.js` ghi bảng `admin_audit_log`; hàm `record()` **return `false`** khi config/action không hợp lệ, không ném lỗi; migration `supabase/migrations/202611010001_admin_audit_log.sql` có `enable row level security` | Nếu migration chưa apply hoặc service key thiếu quyền, mọi thao tác admin vẫn thành công mà **không có dòng audit nào**, và không ai biết | Xác nhận migration đã apply trên staging; cân nhắc log cảnh báo khi `record()` trả false |
| Kịch bản test AI + demo script | F | CHƯA KIỂM CHỨNG | chưa viết | — | Viết bộ ca test + kịch bản demo, không gọi AI live |
| Health semantics của AI gateway | G | FAIL (nguyên nhân gốc của "ready=true mà Analyze lỗi") | `api/_ai/providers.js` tại `ab1ef9b`: `groq` role primary (`:70`, `defaultModel openai/gpt-oss-120b`), `gemini` fallback (`:84`); `gateway.js` `configured: apiKey.length > 0` (`:115`), `ready: entries.some(configured)` (`:143`) → **không bao giờ gọi model**; `vercel.json` rewrite `/api/ai/status` → `/api/debate?aiStatus=1`; `debate.js:323` note "ready only means at least one provider has a key; call the probe endpoint to verify upstream health" | Giả thuyết dẫn đầu: env `AI_PROVIDER_ORDER` trong Vercel đang pin `gemini` → 2 key Groq không dùng, không còn fallback, `maxRetries: 0` | Bạn đọc `AI_PROVIDER_ORDER` và duyệt `GET /api/debate?aiStatus=1&probe=1` |

## 2. Tổng kết theo nhóm

- **Đã xong, có bằng chứng:** A-1, A-2, A-4, A-8, A-9, B-1, B-2, C-1, C-2, C-3, D, D1, D4, E.
- **FAIL cần bạn duyệt trước khi sửa code:** A-1 ngoại lệ cache (`/api/debate`, `/api/support`), A-10 rate-limit per-instance, C-1 bytecode lệch CBOR hash, C-3 revoke chéo issuer, E audit log im lặng, G `AI_PROVIDER_ORDER`.
- **CHƯA KIỂM CHỨNG (không phải PASS):** A-3, B-1 ảnh chụp, B-3, F.
- **BLOCKED cần bạn:** A-5..A-7, toàn bộ giao dịch testnet, fixture Student A/B/Admin, log Vercel/Supabase (D2/D3/D5/D6), xác nhận migration `202611010001`.

## 3. Hai quyết định sản phẩm còn mở (không đổi được bằng vá kỹ thuật)

1. Mã chứng nhận do admin nhập và vẫn đoán được (`PXP-2026-ALG-0001` tuần tự). Dài hạn nên để server sinh mã entropy cao, nhưng đổi thuật toán sẽ vô hiệu mọi mã đã phát hành.
2. `app-config.js:8` vẫn chứa bốn email admin và được ship xuống trình duyệt cho chế độ demo localStorage.

## 4. Lệnh tái kiểm tra

```bash
# B-1 / B-2
npx playwright test tests/real-data-ui.spec.js --reporter=list
# C-2
npx playwright test
npx hardhat test
# A-9
npm audit --omit=dev
# A-1 (live staging)
curl -sI https://paradox-ai-staging.vercel.app/api/admin/users
curl -sI -X POST https://paradox-ai-staging.vercel.app/api/debate
curl -sI -X POST https://paradox-ai-staging.vercel.app/api/support
# G (cần bạn duyệt)
curl -s "https://paradox-ai-staging.vercel.app/api/debate?aiStatus=1&probe=1"
```
