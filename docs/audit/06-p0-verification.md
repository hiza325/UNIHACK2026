# PARADOX AI — P0 verification (backend, xác thực, phân quyền)

**Ngày chạy:** 2026-11-02 (probe lúc `2026-11-02T12:50:13Z`)

**Bản đang phục vụ lúc probe:** staging `https://paradox-ai-staging.vercel.app` = build của commit `37de043` (deploy `2026-11-01T11:24Z`). Commit `f9265c6` **deploy thất bại** trên Vercel — xem mục 4.

**Nguyên tắc:** chỉ gửi request đọc/không hợp lệ từ ngoài; không có tài khoản thật, không dữ liệu nhạy cảm, không gửi giao dịch.

---

## 1. Cách chạy lại

```bash
BASE=https://paradox-ai-staging.vercel.app

curl -s -o /dev/null -w "%{http_code} %{header_json}\n" $BASE/api/admin/users
curl -s -X PATCH -H 'Content-Type: application/json' -d '{}' $BASE/api/admin/users
curl -s "$BASE/api/credentials?code=PXP-2026-ALG-0001"
curl -s -X POST -H 'Content-Type: application/json' -d '{"action":"verify","code":"PXP-2026-ALG-0001"}' $BASE/api/credentials
curl -s $BASE/api/learning-records
curl -s $BASE/api/auth/session
curl -s -X POST -H 'Content-Type: application/json' -d '{}' $BASE/api/debate
curl -s -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","text":"hi"}]}' $BASE/api/support
```

## 2. Kết quả (không gửi cookie/session)

| Endpoint | Method | Quan sát | Kỳ vọng | Kết luận |
|---|---|---|---|---|
| `/api/admin/users` | GET | `401` `SESSION_INVALID` | Chặn trước khi đọc dữ liệu | PASS |
| `/api/admin/users` | PATCH | `401` `SESSION_INVALID` | Chặn ghi | PASS |
| `/api/admin/users` | DELETE | `405` + `Allow` | Từ chối method | PASS |
| `/api/credentials?code=…` | GET | `401` `SESSION_INVALID` | Chặn khi chưa đăng nhập | PASS |
| `/api/credentials` | POST `action:"verify"` | `401` `SESSION_INVALID` | Chặn khi chưa đăng nhập | PASS |
| `/api/credentials` | POST action lạ | `400` `INVALID_CREDENTIAL_ACTION` | Từ chối action không hỗ trợ | PASS |
| `/api/learning-records` | GET | `401` `SESSION_INVALID` | Không lộ bản ghi người khác | PASS |
| `/api/learning-records` | POST | `401` `SESSION_INVALID` | Chặn ghi | PASS |
| `/api/auth/session` | GET | `401` `SESSION_INVALID` | Không trả session rỗng giả | PASS |
| `/api/auth/login` | GET | `405` | Từ chối method | PASS |
| `/api/auth/login` | POST `{}` | `400` `Invalid email address` | Validate input | PASS |
| `/api/auth/otp` | GET | `405` | Từ chối method | PASS |
| `/api/auth/signup` | POST `{}` | `400` `Invalid email address` | Validate input | PASS |
| `/api/support` | GET | `405` `METHOD_NOT_ALLOWED` | Chỉ POST | PASS |
| `/api/support` | POST `Origin: https://evil.example` | `403` `FORBIDDEN_ORIGIN` | Chặn cross-site | PASS |
| `/api/debate` | POST `{}` | `400` `INVALID_INPUT` | Validate input, không gọi AI | PASS |
| `/api/debate?aiStatus=1` | GET | `200`, `Cache-Control: no-store` | Không cache health | PASS |
| `/api/ai/status` | GET | `200`, `order:["gemini"]`, `groqKeyCount:2` | Khớp cấu hình | PASS |

Tất cả endpoint có session đều trả `Cache-Control: private, no-store` — không có response nào bị cache dùng chung.

## 3. Phát hiện và đã sửa trong cùng đợt

| Mã | Phát hiện | Mức | Xử lý |
|---|---|---|---|
| F-01 | HTML/asset chỉ có `Strict-Transport-Security`; thiếu `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`. CSP chỉ tồn tại dưới dạng `<meta>` (không chặn được framing) | P0 | Thêm 5 header trong `vercel.json`; CSP header chỉ chứa `frame-ancestors 'self'` để không xung đột với CSP trong `<meta>` |
| F-02 | `POST /api/debate` và `POST /api/support` trả `Cache-Control: public, max-age=0, must-revalidate` (hai nhánh `aiStatus`/`probe` đã có `no-store` từ `874ba38`, nhánh POST thì chưa) | P1 | Đặt `no-store` ở đầu handler của cả hai endpoint; thêm assert trong `tests/debate-api.spec.js` và `tests/support-api.spec.js` |
| F-03 | Commit `f9265c6` thêm `api/auth/local.js` thành serverless function thứ **13**, vượt giới hạn 12 function của Vercel Hobby ⇒ deploy thất bại (`2026-11-01T14:26Z`), staging kẹt ở `37de043` | P0 | Đổi thành `api/auth/_local.js` (helper, không phải route); `api/auth/session.js` uỷ quyền khi gặp `/api/auth/local`; `vercel.json` rewrite `/api/auth/local` → `/api/auth/session?localAuth=1`; thêm `tests/vercel-deployment.spec.js` chặn tái phát |

Vercel Hobby đã từng bị chạm trần một lần ở commit `77b443b` (gộp `api/ai/status.js` vào `api/debate.js`), nên F-03 là cùng một nguyên nhân gốc.

## 4. Trạng thái deploy (bằng chứng ngoài code)

| Kiểm tra | Kết quả |
|---|---|
| `37de043` | Vercel success `2026-11-01T11:24Z` (cả `paradox-ai-staging` và `unihack2026`) |
| `a1ae9cc` | không có status Vercel |
| `f9265c6` | Vercel **failure** `2026-11-01T14:26Z`; GitHub Actions (`build`, `playwright`, `lighthouse`, `deploy`) vẫn success |
| `GET /api/auth/local` trên staging (probe `12:55Z`) | `404 NOT_FOUND` ⇒ xác nhận staging chưa chạy `f9265c6` |
| `86e5dbb` (bản vá F-03) | Vercel **success** `2026-11-02T13:01:40Z` (`paradox-ai-staging`) và `13:01:54Z` (`unihack2026`) ⇒ giả thuyết 12-function được xác nhận |

## 4b. Kiểm chứng live sau deploy `86e5dbb` (`2026-11-02T13:03Z`)

| Endpoint | Kết quả |
|---|---|
| `GET /` | `200`; có `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `content-security-policy: frame-ancestors 'self'` |
| `GET /api/auth/local` | `200` `{"available":false}`, `Cache-Control: private, no-store` ⇒ rewrite chạy, local sign-in vẫn tắt |
| `POST /api/auth/local` | `403` `LOCAL_AUTH_NOT_CONFIGURED` |
| `GET /api/auth/session` | `401` `SESSION_INVALID` (route session không bị chiếm) |
| `POST /api/debate {}` | `400` `INVALID_INPUT`, `Cache-Control: no-store` |
| `POST /api/support` Origin lạ | `403` `FORBIDDEN_ORIGIN`, `Cache-Control: no-store` |
| `POST /api/support` câu hỏi thật | `200` 27564 ms, `provider: gemini`, `grounded: true`, sources `A17/B061/B070` |
| `GET /api/debate?aiStatus=1&probe=1` | `200`, `ok:true`, `gemini/gemini-3.5-flash`, 6691 ms |
| `GET /api/ai/status` | `200`, `order:["gemini"]`, `groqKeyCount:2` (vẫn chờ sửa biến môi trường) |

## 5. Bằng chứng phụ

| Kiểm tra | Kết quả |
|---|---|
| `npm run contract:test` | **8/8 passing** (issuer, revoke, ownership, duplicate, unauthorized) |
| `npx playwright test` | **274/274 PASS** (sau khi thêm 3 test deployment-shape) |
| Chain read-only `2026-11-01T08:54Z` | `chainId 43113`, bytecode 2322 bytes khớp keccak manifest — xem `docs/CHAIN-01-REPORT.md` mục 7 |

## 6. Local sign-in (`api/auth/_local.js`) — đánh giá an toàn

- Chỉ bật khi **không** phải production: `VERCEL !== '1'` và `NODE_ENV !== 'production'`, đồng thời `LOCAL_AUTH_ENABLED=1`.
- Trên Vercel `VERCEL=1` luôn đúng ⇒ endpoint trả `403 LOCAL_AUTH_NOT_CONFIGURED` dù biến môi trường có bật.
- Token là HMAC-SHA256 (`timingSafeEqual`), cookie `HttpOnly; Secure; SameSite=Strict`, TTL 7 ngày.
- Role luôn `user`, không phải user Supabase ⇒ không chạm dữ liệu của tài khoản thật.
- Sau F-03, đường dẫn công khai `/api/auth/local` vẫn tồn tại nhưng đi qua `api/auth/session.js`.

## 7. Giới hạn của lần kiểm này

- `401` chứng minh **đã chặn khi chưa đăng nhập**, không chứng minh phân quyền đúng giữa các role (student / issuer / admin). Việc đó cần fixture Student A/B/Admin — **chưa có**.
- Dashboard/History/UI trạng thái cần đăng nhập thật, nên chưa chụp được ảnh đối chiếu.
- ADM-04 (audit log admin) vẫn chờ migration `supabase/migrations/202611010001_admin_audit_log.sql` chạy trên Supabase staging.
- Không kiểm quota/rate limit phân tán: bộ đếm nằm trong RAM mỗi serverless instance.
- Không đọc được log build Vercel (không có token); F-03 được suy ra từ số function + lịch sử `77b443b`, và đã được xác nhận gián tiếp: sau khi hạ về 12 function, deploy `86e5dbb` thành công.
- Probe `13:03Z` cho thấy widget trả lời trong 27.5 s (Gemini) — dưới deadline 45 s nhưng sát ngưỡng; Groq chưa được dùng vì `AI_PROVIDER_ORDER` trên Vercel.
