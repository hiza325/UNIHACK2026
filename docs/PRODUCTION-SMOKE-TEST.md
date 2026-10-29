# PARADOX AI — Production Smoke Test

**URL kiểm thử:** https://unihack2026-beryl.vercel.app/
**Commit kiểm thử:** `0f8bcb64e4bdccd647dbf1cf3f4747b30f9b6de1` (`feat(ui): reflect real data and harden Fuji verification`)
**Ngày kiểm thử:** 2026-10-29
**Phạm vi:** read-only smoke test sau giai đoạn “Giao diện phản ánh dữ liệu thật”.

## 0. Giới hạn an toàn đã áp dụng

- Không tạo tài khoản, không submit đăng nhập thật, không gọi API ghi, không gửi blockchain transaction, không thay đổi Smart Contract.
- Browser automation dùng request `GET/HEAD`; Playwright guard chặn mọi request non-GET và ghi nhận `0` request bị chặn.
- UI protected chỉ được mở bằng session Demo trong `localStorage` của trình duyệt kiểm thử. Đây là dữ liệu frontend-only, không phải production authentication và không chứng minh backend Real.
- Lần smoke test này không commit/push/deploy; mọi thay đổi được giữ local cho tới khi có yêu cầu riêng.

## 1. Kết quả tổng quan

| Nhóm | Kết quả | Ghi chú |
|---|---:|---|
| Git/Vercel deployment đối chiếu công khai | PASS | Local `main`, `origin/main`, remote ref và production fingerprint khớp commit `0f8bcb6`. |
| Browser automation production | PASS | Desktop 1280×800 và mobile 390×844. |
| Automated browser checks | **32 PASS / 2 FAIL** | Hai FAIL cùng một gốc lỗi: `pattern` của `#passport-code` không phải regex hợp lệ trong browser. |
| API read-only probes | PASS | Không session: auth/credentials/learning-records `401`; `GET /api/debate` `405 Allow: POST`. |
| Responsive desktop/mobile | PASS | Không horizontal overflow ở landing, Dashboard, Profile, Passport, Verify, About. |
| AI Learning | **BLOCKED / NOT CONFIGURED** | Chưa có API key; chỉ probe `GET /api/debate` read-only, không POST và không dùng phản hồi giả. |
| Production login / Real backend data | **NOT VERIFIED** | Chưa có tài khoản kiểm thử; không tự tạo tài khoản. |
| Vercel dashboard/env trực tiếp | **NOT VERIFIED** | Không có Vercel CLI/dashboard access; chỉ đối chiếu GitHub commit status và response công khai. |

## 2. Bằng chứng Git và deployment

- `git status --short --branch`: `## main...origin/main`.
- `git log -1`: `0f8bcb64e4bdccd647dbf1cf3f4747b30f9b6de1`, `2026-10-29T07:38:25+07:00`.
- `git ls-remote origin refs/heads/main`: cùng commit `0f8bcb64e4bdccd647dbf1cf3f4747b30f9b6de1`.
- GitHub commit status cho `0f8bcb6`: `state=success`; có `Vercel – unihack2026` với `description=Deployment has completed`, `created_at=2026-10-29T00:39:11Z`, target `https://vercel.com/hizas/unihack2026/FHhhzux169yQuRsdczd8F8v7vham`.
- `GET /`: `200 OK`, `Server: Vercel`, `Last-Modified: Thu, 29 Oct 2026 00:39:54 GMT`, `X-Vercel-Cache: HIT`, `X-Vercel-Id: sin1::2wjmg-1793234793439-9d47641f7d2b`.
- Production phục vụ đúng metadata Fuji: `avalanche-config.js` và `deployments/avalanche-fuji.json` có Chain ID `43113`, contract `0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b`, deployment tx `0x45c55865fb43bf28a1972597ce4ecedf9d769876344034a9447cd75a6de2d56f`.

**Kết luận:** PASS cho đối chiếu deployment công khai. Quyền Vercel dashboard/environment là **NOT VERIFIED** vì không có CLI/session hợp lệ (`where.exe vercel` không có, repo không có `.vercel/` metadata).

## 3. API read-only probes

| Request | Kết quả | Trạng thái |
|---|---|---|
| `GET /api/auth/session` không cookie | `401 Unauthorized`; xóa cookie `paradox-access`/`paradox-refresh` | PASS |
| `GET /api/credentials` không cookie | `401 Unauthorized` | PASS |
| `GET /api/learning-records` không cookie | `401 Unauthorized` | PASS |
| `GET /api/debate` | `405 Method Not Allowed`, `Allow: POST` | PASS |
| `POST/PUT/PATCH/DELETE` bất kỳ | Không thực hiện; Playwright guard ghi nhận `0` non-GET | PASS |

Trình duyệt anonymous ghi nhận đúng một console resource error cho `GET /api/auth/session` `401`. Đây là probe unauthenticated mong đợi, không phải uncaught JavaScript error.

## 4. Browser automation — desktop

Môi trường: Chromium, viewport `1280×800`, locale `vi-VN`, read-only guard chặn non-GET.

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Landing production | PASS | Title `PARADOX AI — Academic Audit`; heading `Đừng vội / xem đáp án.`; `paradox-session=null`; overflow `0`. |
| Route guard protected | PASS | Vào `/#/dashboard` khi chưa đăng nhập: landing vẫn hiển thị, không có `.dashboard-page`, auth dialog mở, `pendingView="dashboard"`. |
| Login UI | PASS (UI) / NOT VERIFIED (auth thật) | Form có email/password required, password `minlength=8`, nút quên mật khẩu/tạo tài khoản; không submit credential thật. |
| Dashboard Empty | PASS | Session Demo rỗng: `data-dashboard-state="empty"`, không `.dashboard-stats`, không phiên “tiếp tục” giả. |
| Dashboard Loading | PASS (frontend render path) | Khi mô phỏng cờ loading phía client: `data-dashboard-state="loading"`, không stats. Backend pending thật: **NOT VERIFIED**. |
| Dashboard Error | PASS (frontend render path) | Khi mô phỏng lỗi phía client: `data-dashboard-state="error"`, có `[data-retry-learning-data]`, không stats/ không số `0` giả. Backend error thật: **NOT VERIFIED**. |
| Dashboard Demo | PASS | Có badge `DEMO`, thông báo dữ liệu chỉ nằm trong browser demo, `verifiedClaims=0`, `explorerLinks=0`, không xuất hiện tên fixture cũ `Minh Anh`. |
| Dashboard Real | NOT VERIFIED | Cần tài khoản production và backend session thật. |
| Achievement/Profile Demo | PASS | `data-achievement-page-state="demo"`; trạng thái `earned` + `locked`; `issuedCredentials=0`; `credential-status.verified=0`. |
| Achievement persistence thật | NOT VERIFIED | Cần tài khoản production. |
| Learning Passport Demo | PASS | Notice `DỮ LIỆU MẪU`; 4 skills; 3 credentials mẫu; không `.credential-status.verified`; không explorer link. |
| Verify invalid local | PASS với lưu ý lỗi pattern | Nhập `invalid` bị chặn bởi `minlength`, focus về `#passport-code`, không gọi `/api/credentials`. Xem Issue 1 cho `pattern`. |
| Verify Demo code | PASS | `PXP-2026-ALG-0001` trả `data-verification-state="demo"` với `DEMO — KHÔNG PHẢI CHỨNG NHẬN THẬT`; `explorerButtons=0`; `verified=0`. |
| Verify not-found | PASS | `PXP-2026-NOT-9999` trả `not-found`, text `Không tìm thấy chứng nhận`, không chuyển thành success. |
| Verify Fuji metadata | PASS | Hiển thị `Avalanche Fuji Testnet`, Chain ID `43113`, contract link tới `explorer-test.avax.network/c-chain/address/0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b`. |
| About/Guide | PASS | Có `ACTIVE`, `DEVELOPING`, `DEMO`; `.public-verify-guide li=4`; metadata chứa contract/Chain ID; links tới address và deployment transaction trên Fuji explorer. |
| Navigation buttons | PASS | Sidebar click tới `#/dashboard`, `#/passport`, `#/about`. |
| Console/uncaught errors | FAIL nhẹ | Không uncaught error; có console error lặp lại từ `pattern` không hợp lệ ở `/#/verify` (Issue 1). |

## 5. Browser automation — mobile

Môi trường: Chromium mobile emulation `390×844`, touch enabled.

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Landing mobile | PASS | Không horizontal overflow; `#mobile-menu-toggle` visible và `aria-expanded` chuyển `false → true` sau click. |
| Login dialog mobile | PASS | Auth dialog mở, hiển thị `Chào mừng trở lại`, overflow `0`. |
| Dashboard/Profile/Passport/Verify/About mobile | PASS | Tất cả overflow `0`. |
| Request an toàn | PASS | `0` non-GET request; không uncaught error; không console error ngoài probe `/api/auth/session` `401`. |

## 6. Trạng thái dữ liệu

| State | Production smoke result | Ghi chú |
|---|---|---|
| Loading | PASS (frontend render path) | Đã kiểm tra UI bằng cờ client-side; không dùng dữ liệu giả. Backend pending thật: NOT VERIFIED. |
| Empty | PASS | Tài khoản Demo rỗng hiển thị Empty, không stats giả. |
| Error | PASS (frontend render path) | UI Error có Retry, không chuyển thành zero/empty. Backend error thật: NOT VERIFIED. |
| Real | NOT VERIFIED | Cần tài khoản kiểm thử production và credential/learning record thật. |
| Demo | PASS | Nhãn Demo rõ, tách khỏi production, không verified claim giả. |

## 7. Dữ liệu giả, Fuji Testnet và contract

- PASS: Demo/Passport mock đều có nhãn `DEMO` hoặc `DỮ LIỆU MẪU`; không có `credential-status.verified` trong mock flow.
- PASS: Không có Explorer link hoặc transaction hash giả trong Demo Verify.
- PASS: Fuji config production khớp `avalanche-config.js` và `deployments/avalanche-fuji.json`: network `avalanche-fuji`, Chain ID `43113`, contract `0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b`, deployment tx `0x45c55865fb43bf28a1972597ce4ecedf9d769876344034a9447cd75a6de2d56f`.
- NOT VERIFIED: trạng thái `valid/unissued/revoked` với credential production thật vì chưa có mã credential production và không tạo/giao dịch on-chain.

## 8. AI Learning

- **BLOCKED / NOT CONFIGURED:** chưa có API key cho AI Learning.
- Chỉ kiểm tra read-only `GET /api/debate` → `405 Allow: POST`.
- Không POST `/api/debate`, không mô phỏng AI response như AI thật, không đánh dấu PASS cho chức năng phân tích AI production.

## 9. Lỗi cần sửa

### ISSUE-01 — `pattern` của Verify Certificate không hợp lệ trong browser

- **Mức độ:** Minor production bug; không chặn tra cứu Demo vì JS app-level `isCertificateCode()` vẫn validate, nhưng gây console error và làm native HTML validation không đáng tin cậy.
- **Vị trí:** `views/passport.js`, input `#passport-code` trong `viewPassportVerify()`.
- **Bằng chứng production:** browser console tại `https://unihack2026-beryl.vercel.app/#/verify` báo lặp lại: `Pattern attribute value PXP-[A-Za-z0-9-]{4,76} is not a valid regular expression ... /v: Invalid character class`.
- **Tác động đo được:** `new RegExp(input.pattern, 'v')` throw; với giá trị sai prefix `ABCDEFGH`, `input.checkValidity()` trả `true` ở native layer. Submit vẫn bị JS `isCertificateCode()` chặn, nhưng lỗi console cần loại bỏ và native validation nên khớp JS.
- **Đề xuất sửa:** escape hyphen trong HTML pattern, ví dụ `pattern="PXP-[A-Za-z0-9\-]{4,76}"`, hoặc loại bỏ `pattern` và giữ một nguồn validation duy nhất bằng `isCertificateCode()` với thông báo rõ ràng. Thêm regression test khẳng định `new RegExp(input.pattern, 'v')` không throw và console không có `Pattern attribute value`.

## 10. NOT VERIFIED / BLOCKED cần quyền hoặc dữ liệu bổ sung

| Hạng mục | Trạng thái | Cần để xác minh |
|---|---|---|
| Vercel dashboard/env variables | NOT VERIFIED | Vercel access hoặc CLI session hợp lệ. |
| Login production thật | NOT VERIFIED | Tài khoản kiểm thử được cấp; smoke test này không tự tạo tài khoản. |
| Authenticated API `credentials`/`learning-records` | NOT VERIFIED | Session production hợp lệ. |
| Dashboard/Profile/Passport Real state | NOT VERIFIED | Backend data thật của tài khoản kiểm thử. |
| Achievement persistence | NOT VERIFIED | Tài khoản thật và dữ liệu achievement backend. |
| Credential `valid/unissued/revoked` on-chain thật | NOT VERIFIED | Mã credential production cụ thể; vẫn giữ nguyên tắc không gửi transaction. |
| AI Learning analysis | BLOCKED / NOT CONFIGURED | API key/cấu hình AI; khi có cấu hình vẫn cần test account và quy trình không ghi dữ liệu ngoài phạm vi cho phép. |

## 11. Kết luận

Production đang phục vụ đúng commit `0f8bcb6`; các luồng công khai, route guard, nhãn Demo/Empty, Fuji metadata, Verify an toàn, About/Guide và responsive desktop/mobile đều đạt. Có **1 lỗi nhỏ cần sửa** ở `pattern` của ô mã chứng nhận. Các hạng mục cần authentication thật hoặc quyền Vercel/AI key đã được tách riêng thành **NOT VERIFIED** hoặc **BLOCKED**, không tự báo PASS.

## 12. Bản sửa ISSUE-01 (local)

- **Nguyên nhân gốc:** theo HTML spec, thuộc tính `pattern` được biên dịch thành `^(?:pattern)$` với cờ UnicodeSets `v` trên Chrome/Edge/Safari/Firefox hiện đại. Trong chế độ `v`, `-` bên trong character class là toán tử set, nên `[A-Za-z0-9-]` bị coi là không hợp lệ (`Invalid character class`) thay vì là ký tự literal.
- **Cách sửa:** escape hyphen và dùng chung một hằng số cho cả HTML và JS:
  - `learning-passport-service.js`: export `CERTIFICATE_CODE_HTML_PATTERN = '\s*[Pp][Xx][Pp]-[A-Za-z0-9\-]{4,76}\s*'`; `isCertificateCode()` dựng regex từ chính hằng số này để HTML và JS không lệch quy tắc.
  - `views/passport.js`: input `#passport-code` dùng `pattern="${this.escape(CERTIFICATE_CODE_HTML_PATTERN)}"` thay cho pattern lỗi.
- **Test bổ sung:** `tests/learning-passport.spec.js` thêm case matrix (mã hợp lệ, prefix sai, ký tự không hợp lệ, độ dài sai, input rỗng/khoảng trắng), test compile pattern bằng cờ `v`, và test native validation + console sạch ở desktop `1280×800` và mobile `390×844`.
- **Kết quả local:** `npx playwright test tests/learning-passport.spec.js` → **8/8 passed**; `npm test` → **103/103 passed**; `git diff --check` sạch.
- **Trạng thái production tại thời điểm smoke test:** production phục vụ commit `0f8bcb6` với pattern cũ; bản sửa trên chưa được deploy. Không giao dịch blockchain, không thay đổi Smart Contract trong toàn bộ quá trình.
