# PARADOX AI — Môi trường và bảo mật Giai đoạn 0

**Ngày:** 2026-10-28  
**Nguyên tắc:** chỉ ghi tên biến/trạng thái tồn tại, không ghi giá trị secret hoặc dữ liệu cá nhân.

## 1. Runtime, package manager và scripts

| Hạng mục | Kết quả |
|---|---|
| Runtime local | Node.js `v24.18.0` |
| Engine khai báo | Node.js `>=22.12` |
| CI runtime | Node.js 22 |
| Package manager local | npm `11.16.0` |
| Lockfile | `package-lock.json` tồn tại |
| Frontend build | Không có bundle/build script; chạy ES modules trực tiếp |
| Local serve | `npm run serve` -> `tests/static-server.mjs` |
| Contract build | `npm run contract:build` |
| Contract test | `npm run contract:test` |
| App/API test | `npm test` |
| Lint/type-check | Không có script lint hoặc type-check |

Dependencies trực tiếp: `ethers`, `nodemailer`; dev dependencies: Playwright, axe-core, Hardhat.

## 2. Cấu hình môi trường

### 2.1 Biến được mô tả trong `.env.example`

- AI: `ANYROUTER_API_KEY`, `ANYROUTER_MODEL`.
- Auth/database: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`.
- OTP: `OTP_SECRET`, Resend, SMTP, Gmail và rate-limit variables.
- Avalanche: `AVALANCHE_FUJI_RPC_URL`, `AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS`, `AVALANCHE_ISSUER_PRIVATE_KEY`.

### 2.2 Tình trạng local (chỉ tên biến)

Có: Supabase URL/anon/service role, admin allowlist, OTP secret, Gmail sender/app password.  
Thiếu: AnyRouter key/model, Avalanche RPC/address/private key, SMTP chung và Resend.

`.env` bị ignore; `git ls-files` chỉ thấy `.env.example`. Không phát hiện secret thực trong file tracked bằng pattern scan. Test fixtures có credential giả rõ ràng.

### 2.3 Development, staging, production

- **Development:** một `.env` local; có fallback auth/localStorage và OTP code khi mail không cấu hình.
- **Test:** Playwright ép các biến email/Supabase thành rỗng và dùng port riêng, nhờ đó test mặc định không ghi Supabase/gửi mail.
- **Production:** Vercel URL hoạt động, nhưng repository không có `vercel.json`; không thể liệt kê Vercel Environment Variables từ quyền hiện tại.
- **Staging:** không có project/config/domain/branch convention riêng trong repository.
- GitHub Pages workflow vẫn deploy static site, trong khi API chỉ chạy đầy đủ trên Vercel; điều này tạo hai deployment có năng lực khác nhau và canonical URL vẫn trỏ GitHub Pages.

**Cập nhật sau audit:** Vercel `paradox-ai-staging` và Supabase staging đã được tạo, xác minh khác production và dùng bộ biến riêng. Avalanche staging vẫn chưa cấu hình/deploy.

### 2.4 Phương án tách môi trường an toàn

1. Tạo Supabase project staging riêng, không dùng dữ liệu production.
2. Tạo Vercel Preview/Staging project hoặc environment scope riêng; map biến staging chỉ tới Supabase staging.
3. Dùng AnyRouter key staging có quota thấp và dedicated Fuji wallet staging.
4. Chỉ Production scope chứa production Supabase service role/Gmail credential.
5. Tắt local fallback trong staging để lỗi cấu hình fail-fast.
6. Dùng migrations qua CI dry-run/diff rồi approval trước `db push`.
7. Chọn một public production origin; không quảng bá GitHub Pages như bản đầy đủ nếu API không hoạt động.

## 3. Database migrations

- Có hai migration additive trong `supabase/migrations/`.
- Kiểm tra `HEAD` read-only xác nhận 6 bảng đều tồn tại trên project local đang trỏ tới.
- Ban đầu audit chỉ kiểm tra read-only. Sau approval, đúng hai migration đã được chạy trên Supabase staging; không chạy migration hoặc sửa schema production.
- Repository không có Supabase CLI config/version pin hoặc migration CI job; trạng thái schema hiện được xác minh thủ công.

## 4. Dependency và build/test

| Kiểm tra | Kết quả |
|---|---|
| `npm ls --depth=0` | PASS; dependencies trực tiếp resolve |
| `npm outdated --json` | Không báo package outdated |
| `npm audit --json` | FAIL; 3 High, 0 Critical |
| `npm run contract:build` | PASS; không có contract cần compile lại do cache |
| `npm run contract:test` | PASS; 8 Solidity tests |
| `npm test` | PASS; 65 Playwright/API tests |
| lint/type-check | NOT_TESTED; không có script |

`npm audit` báo advisory High ở `zod` kéo qua `@nomicfoundation/hardhat-zod-utils`/Hardhat. Fix tự động được npm đề xuất là thay đổi major/downgrade Hardhat, nên cần đánh giá tương thích thay vì áp dụng tự động.

## 5. Rà soát bảo mật

### 5.1 Secret và key

- Không thấy AI key/private key/service role thực trong tracked source.
- `.env` không được Git theo dõi.
- AI key và Avalanche private key chỉ được đọc server-side.
- Frontend không import `process.env` hoặc private key.
- Có danh sách email admin cụ thể hardcode trong frontend và fallback backend. Báo cáo không liệt kê các địa chỉ này; đây là PII/config authorization không nên nằm trong source.

### 5.2 Authentication/authorization

Điểm tốt:

- HttpOnly/Secure/SameSite Strict cookies.
- Admin authorization ở server.
- Session ban được kiểm tra authoritative.
- Learning-record ownership được filter theo learner và có test chéo user.
- Password reset không phân biệt tài khoản tồn tại ở bước request.

Rủi ro:

- Email allowlist hardcode có thể cấp admin ngoài lifecycle `app_metadata`; dễ drift giữa frontend/backend/environment.
- Không có staging fixtures Student A/B để nghiệm thu role và isolation end-to-end.
- CSRF dựa chủ yếu vào SameSite Strict; không có CSRF token/Origin validation riêng cho state-changing APIs.

### 5.3 Input, upload và AI

- AI input/output có length/schema validation.
- Auth/email/password/OTP và credential hashes có validation.
- Import JSON có giới hạn số session lưu nhưng đọc toàn file vào memory và không có file-size cap.
- “Upload” bài làm chỉ là client metadata; extension/size check client-side không phải biện pháp bảo vệ upload server.
- `/api/support` public và không rate limit.
- `/api/debate` public khi không có learning-record context; rate limit chỉ in-memory theo instance. Hai endpoint có thể bị dùng để tiêu tốn AI quota.

### 5.4 CORS, headers và error handling

- API không đặt CORS allow-origin; preflight tới admin trả 405/Allow, nên browser cross-origin không được hỗ trợ chủ động.
- Static Vercel trả wildcard CORS và HSTS.
- CSP chỉ đặt bằng meta trong HTML; `style-src` cho phép inline style. Không thấy header CSP, X-Content-Type-Options, X-Frame-Options/frame-ancestors hoặc Permissions-Policy trong kiểm tra HEAD.
- Lỗi 5xx chủ yếu được chuẩn hóa, tránh gửi chi tiết nội bộ.

### 5.5 Database operations

- Service role có quyền rộng nhưng store thêm learner filters ở Learning Records.
- Credential `updateCredential(id, patch)` không thêm learner filter; endpoint issue/revoke đã yêu cầu admin. Đây là boundary cần giữ bằng test.
- Không thấy route xóa hàng loạt/reset DB.
- Migration dùng cascade từ `auth.users`; xóa user sẽ xóa learning data/credential liên quan. Cần retention/backup policy trước production.

### 5.6 Blockchain key management

- Private key chỉ ở environment và có format validation.
- Không có secret hardcode hoặc browser signing.
- Chưa có KMS/secret rotation/multisig/operational runbook.
- Deployment script dùng một EOA làm owner+issuer; phù hợp prototype Fuji nhưng chưa đủ production governance.

## 6. Danh sách vấn đề theo mức độ

### Critical

1. **Avalanche chưa deploy:** không address, manifest, bytecode hoặc transaction thật; không đáp ứng tiêu chí tích hợp chain thực tế.

### High

1. **Migration governance còn thủ công:** schema staging đã áp dụng và kiểm chứng, nhưng repository chưa có drift check/version pin/approval automation.
2. **AI endpoints có thể bị lạm dụng:** Support public không limiter; Debate cho request không session và limiter in-memory.
3. **Dependency advisory:** 3 High trong chuỗi Hardhat/Zod.
4. **Admin allowlist hardcode:** authorization config và địa chỉ cụ thể nằm trong source, có nguy cơ drift/escalation ngoài quy trình role quản trị.

### Medium

1. Rate limit OTP/Debate không dùng shared store, có thể reset khi cold start hoặc phân tán instance.
2. Không có CSRF token/Origin validation riêng; hiện dựa vào SameSite Strict.
3. File upload chưa triển khai nhưng UI có ngôn ngữ “file được bảo vệ”; không có server validation/scan/storage.
4. Hai kênh deploy GitHub Pages/Vercel không đồng chức năng; metadata/canonical trỏ static origin.
5. Không có lint/type-check và không có migration drift check trong CI.
6. Chưa có KMS/rotation/governance cho Fuji issuer key.

### Low

1. Security headers chưa đầy đủ; CSP là meta và cho inline style.
2. Profile/settings/practice chưa đồng bộ đa thiết bị.
3. Public credential lookup hiện vẫn yêu cầu đăng nhập, hạn chế use case xác minh bên ngoài.

## 7. Kiểm thử nghiệm thu

| Tiêu chí | Kết quả | Bằng chứng | Giới hạn |
|---|---|---|---|
| SETUP-01 | PASS | GitHub Actions run `40687693284` của đúng commit `e6d126c` thành công trên runner Ubuntu sạch: checkout, Node 22, `npm ci`, contract tests, Playwright; Playwright tự khởi động static server theo config | Workflow không kiểm thử production secrets hoặc live external services |
| ENV-01 | PASS | Vercel `paradox-ai-staging` deploy commit `e6d126c` ở domain riêng; ba biến Supabase staging được cấu hình; project Supabase khác local/production; `.env.staging` bị Git ignore | Avalanche vẫn chưa có staging deployment nhưng không có nguy cơ ghi nhầm production chain vì chain env để trống |
| AUTH-01 | PASS | Student A, Student B và Admin đăng nhập qua Vercel staging thành công; session role đúng; Student A/B bị admin API từ chối `403`, Admin nhận `200`; Student B đọc/sửa session A nhận `404`; RLS cho A thấy 1 hàng và B thấy 0 | Session nghiệm thu staging được chuyển sang `abandoned`; không dùng dữ liệu production |
| CHAIN-01 | FAIL | Code/ABI/chain guard/8 tests tồn tại | Không contract address/manifest; không thể `eth_getCode`, ABI-on-chain hoặc tx verify |

## 8. Tài khoản staging

Project production/local trước đó có 7 user và 4 admin theo `app_metadata`/allowlist; không có fixture Student A/B. Sau khi Supabase staging riêng được cung cấp và xác minh khác project local, ba fixture Student A, Student B và Admin đã được provision chỉ trên staging. Login, email confirmation và role đều đạt. Không ghi email, password, token hoặc user ID vào báo cáo.

Đúng hai migration từ commit `e6d126c` đã được đối chiếu SHA-256 với file local rồi chạy thành công bằng SQL Editor trên đúng project staging. Sáu bảng trả `200`; API ownership và RLS isolation đều đạt. Không chạy SQL trên production.
