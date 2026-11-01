# PARADOX AI — Nghiệm thu theo giai đoạn (Internal Staging Work Plan 31/10/2026)

**Ngày lập:** 2026-11-01, cập nhật phiên bản mới ngày 2026-11-02
**Nhánh làm việc:** toàn bộ đã được merge vào `main`; bản đang chạy trên Staging là `ab1ef9b`

## 0. Đọc trước khi dùng tài liệu này

### 0.1 Đã thay đổi so với lần nghiệm thu đầu — cập nhật 2026-11-02

Ba điều ghi ở phiên bản đầu của tài liệu này **không còn đúng**, và một trong ba là lỗi đo đạc của chính người viết:

1. **Sai host.** Phiên bản đầu lấy URL từ `docs/PRODUCTION-SMOKE-TEST.md` (`unihack2026-beryl.vercel.app`). Host staging thật là `paradox-ai-staging.vercel.app`. Đo lại trên cả hai: chúng trả cùng `Etag` cho `/`, tức **một deployment phục vụ cả hai tên**. Kết luận "phục vụ `main`" vì thế vẫn đúng, nhưng câu dẫn chứng thì không.
2. **Đã redeploy.** Fingerprint động xác định được bản chạy:

   | File | Staging phục vụ | `ab1ef9b` | `51fa2af` | `89052c4` | `5217924` |
   |---|---|---|---|---|---|
   | `support-ai-config.js` | `015756e9bfc6` | **`015756e9bfc6`** | `7d700a035c7a` | `7d700a035c7a` | `7d700a035c7a` |
   | `app.js` | `4288737d9347` | `4288737d9347` | `4288737d9347` | `4288737d9347` | `4288737d9347` |

   `app.js` không đủ để phân biệt (đều giống nhau), nên phải dùng `support-ai-config.js` — file chỉ đổi trong các commit mới. **Staging đang chạy `ab1ef9b`, tức `main` mới nhất, không phải `89052c4` như kế hoạch ghi.**
3. **Hai bản vá bảo mật giờ đã live.** Bằng chứng HTTP đọc trực tiếp trên staging ngày 2026-11-02:

   | Endpoint | Trước (bản `main` cũ) | Bây giờ |
   |---|---|---|
   | `GET /api/admin/users` | `Cache-Control: public, max-age=0, must-revalidate` | **`private, no-store`**, `401` khi không đăng nhập |
   | `GET /api/credentials?code=…` | — | `401` khi không đăng nhập |
   | `POST /api/credentials {action:"verify"}` | — | `401` khi không đăng nhập |

   `401` chỉ chứng minh đường đó đã có auth gate; **chưa chứng minh được projection** vì cần session của tài khoản test — vẫn là việc mở.

### 0.2 Phát hiện mới trên bản deployed: Groq có key nhưng không được dùng

`GET /api/ai/status` trên staging trả:

```
order: ["gemini"]        primary: { id: gemini, role: "fallback" }        fallback: null
groqKeys: { configuredCount: 2, backupConfigured: true }
gateway: { timeoutMs: 25000, totalTimeoutMs: 55000, maxRetries: 0 }
```

Trong khi catalogue của `ab1ef9b` là `groq` (role `primary`) rồi `gemini` (role `fallback`) — `api/_ai/providers.js:70,84`. `resolveAiProviders` chọn thứ tự theo `AI_PROVIDER_ORDER` trước, chỉ fallback về catalogue khi biến đó trống (`api/_ai/gateway.js:91-110`).

**Nguyên nhân gốc khả dĩ nhất, và là giả thuyết duy nhất chưa kiểm được:** biến môi trường `AI_PROVIDER_ORDER` trên Vercel đang bị ghim giá trị chỉ có `gemini`, nên Groq không bao giờ được gọi và **không còn đường fallback**. Đọc giá trị biến này là thao tác trên dashboard Vercel, mình không có quyền. Nếu đúng, đây là lý do Analyze vẫn lỗi sau khi đã thay key.

Hai điểm phụ: `maxRetries: 0` nghĩa là mỗi provider chỉ một attempt; và `primary.role` hiển thị `"fallback"` là lỗi cách `describeEntry` (`api/_ai/gateway.js:119`) dán nhãn "provider đầu tiên" thành primary thay vì lấy theo catalogue — chỉ gây khó đọc, không ảnh hưởng routing.

### 0.3 Những gì phiên bản đầu vẫn đúng

Mục 1.1 của `04-staging-verification.md` (bằng chứng SHA1) mô tả trạng thái **trước 2026-11-02** và vẫn là mô tả đúng cho lần nghiệm thu đầu; coi nó là snapshot, không phải trạng thái hiện tại.

Quy tắc đã tuân thủ throughout: chỉ kiểm thử trên Staging, không sửa Production, không dùng dữ liệu thật nhạy cảm, không tạo evaluation/proof giả, không ký/gửi giao dịch.

## 1. Tổng trạng thái

| Nhóm | Đạt | BLOCKED | Ghi chú |
|---|---|---|---|
| Gói A — lập bản đồ & phân quyền | A1, A2, A8, SEC-01, SEC-02, SEC-03, FILE-01 | A3–A7 | A3–A7 chỉ còn cần fixture — Staging đã chạy bản mới |
| Gói B — UI dùng dữ liệu thật | 0 | B1–B7 | fixture + nhóm trang cần AI còn chặn ở `AI_PROVIDER_ORDER` |
| Gói C — Avalanche | C1–C5, C8, CHAIN-01 | C6, C7 | C6 cần nộp source verification; C7 cần tài khoản test |
| Gói D — vận hành | D1, D4 | D2, D3, D5, D6 | cần log Vercel/Supabase staging |
| Gói E — phát hành thật | 0 | SC-03/04/05, VERIFY-02/03 | cần evaluation thật từ AI |

**Test nền:** `npm test` 251/251 PASS · `npm run contract:test` 8/8 PASS (chạy trên `ab1ef9b`, 2026-11-02).

### 1.1 Chạy lại toàn bộ trên `ab1ef9b` (2026-11-02)

| Kiểm tra | Kết quả chạy lại |
|---|---|
| `npm test` | **251 passed (33.0s)** — tăng từ 241 do các commit mới thêm test |
| `npm run contract:test` | **8 passing** |
| SEC-03 | `ADMIN_EMAILS` unset → `[]`; khai báo `" Admin@X.com , admin2@x.com "` → `["admin@x.com","admin2@x.com"]` |
| SEC-01 | guard + projection có mặt ở cả hai nhánh: `api/credentials/index.js` (GET và POST verify) |
| SEC-02 | `requireAdmin` ở `api/admin/users.js` + các nhánh `api/credentials/index.js` |
| D4 | 0 dòng `console.*` trong `api/` khớp key/token/secret/password/cookie |
| Gói C | `chainId 0xa869` · code 2322 bytes · `owner() 0x35d1dc81…` · `authorizedIssuers(0xA906…C396) = true` · nonce ví phát hành `0` tại block 60319522 |
| Premise Staging | **đã đổi** — staging giờ chạy `ab1ef9b` (mục 0.1), không còn `main` cũ; `certificate-renderer.js` trả **200** thay vì 404 |
| Admin audit | `api/admin/_audit.js` ghi vào bảng `admin_audit_log`, migration `supabase/migrations/202611010001_admin_audit_log.sql` có RLS — **chưa kiểm chứng migration đã apply lên DB staging** |

Bảng trạng thái dưới đây là kết quả của lần chạy lại này. File `.doc` cùng thư mục sinh ra từ `node tools/build-phase-report.mjs`, nội dung lấy thẳng từ tài liệu này.

## 2. Gói A — lập bản đồ hệ thống và phân quyền

| Mã | Kết quả | Bằng chứng kiểm tra lại được |
|---|---|---|
| A1 | PASS | 13 route, 6 bảng, RLS bật trên cả 6, không policy nào cho `anon`/`authenticated` ghi |
| A2 | PASS | `api/learning-records` re-scope mọi query theo `user.id` session; passport dùng `publicUser(session.user)` |
| SEC-01 | PASS — **đã live từ 2026-11-02**, riêng projection cần session test để xác nhận | `toVerificationView()` áp tại ranh giới HTTP cho cả `GET ?code=` và `POST action:"verify"`; test hồi quy nằm trong suite 251; trên staging hai endpoint đều `401` khi không đăng nhập |
| SEC-02 | PASS | `requireAdmin` server-side ở `api/admin/users.js` và các nhánh của `api/credentials/index.js` |
| SEC-03 | PASS — **đã live**, `Cache-Control` của `/api/admin/users` đổi từ `public` sang `private, no-store` | `ADMIN_EMAILS` rỗng → `[]` thay vì fallback 4 email cá nhân; `.env.example` bỏ email thật |
| FILE-01 | PASS (code) — cần session test để xác nhận trên site | cùng đường vá với SEC-01; payload verify không còn `recipientName`/`assessmentScore`/`evaluationId`/`evidenceHash` |
| A8 | PASS | Rate limit tra cứu mã theo IP + user, 429 kèm `Retry-After` |
| A3–A7 | **BLOCKED** | chỉ còn thiếu fixture Student A/B/Admin — điều kiện "Staging chạy đúng bản" đã đạt |

Lưu ý kỹ thuật: bộ đếm rate limit nằm trong RAM serverless instance, cold start sẽ đặt lại. Đủ chặn một client quét từ instance ấm, không phải lá chắn phân tán.

## 3. Gói B — UI phải dùng dữ liệu thật

Không mục nào PASS. Điều kiện "Staging chạy đúng bản" **đã đạt** ngày 2026-11-02 (mục 0.1), nên gói B giờ chỉ còn bị chặn bởi fixture và bởi AI.

| Mã | Trạng thái | Cần gì |
|---|---|---|
| B1–B7 | BLOCKED | fixture Student A/B/Admin + ảnh trước/sau theo commit; nhóm trang cần AI còn bị chặn ở mục 0.2 |

Theo tiêu chí nghiệm thu của kế hoạch, trang nào cần AI để sinh dữ liệu mới thì bắt buộc ghi BLOCKED, không ghi PASS.

## 4. Gói C — Avalanche Fuji

Mọi kiểm tra là RPC read-only trên endpoint công khai, tái lập bằng curl trong `04-staging-verification.md` mục 2.

| Mã | Kết quả | Chi tiết |
|---|---|---|
| C1 | PASS | `eth_chainId` = `0xa869` (43113); `owner()` = `0x35d1dc81…` khớp `deployments/avalanche-fuji.json` |
| C2 | PASS | bytecode dispatch có đúng 12 selector = 9 hàm external + 3 getter; 12 selector tính từ signature khớp hết |
| C3 | PASS | 8/8 unit test: issuer hợp lệ, người lạ revert, cấp trùng bị chặn |
| C4 | PASS ở unit test | thu hồi / lập lại / chuyển owner; **phần on-chain BLOCKED** vì chưa có issuance |
| C5 | PASS | chỉ 2 tx ghi vào contract (deploy + `setIssuer`); không có tên/email/bài làm on-chain |
| C6 | **KHÔNG ĐẠT** | explorer báo "Contract not verified" — cần duyệt trước vì là thao tác công khai |
| C7 | BLOCKED | UI Verify cần Staging |
| C8 | PASS | không ký/gửi giao dịch nào |
| CHAIN-01 | PASS (đọc lại 2026-11-01) | issuer `0xA906…C396` được owner cấp quyền qua `setIssuer` tại block 60268861; state tại block 60312809: `pendingOwner = 0x0`, `authorizedIssuers(owner) = true`, `authorizedIssuers(service) = true` |

`setIssuer` từng trông như thao tác lạ; đã giải mã tx đầy đủ và đối chiếu với `certificate-issuance-actions.js:130`, `tests/credentials-prepare-confirm.spec.js:10`, `tools/issuer-admin.html:79` — đó là bước cấp issuer cho service, cố ý.

Ví phát hành vẫn nonce `0` → SC-03/04/05 và VERIFY-02/03 BLOCKED vì thiếu proof thật, **không phải** thiếu quyền.

## 5. Gói D — vận hành

| Mã | Kết quả | Chi tiết |
|---|---|---|
| D1 | PASS | endpoint admin chặn server-side; trên staging `GET /api/admin/users` trả `401` và `Cache-Control: private, no-store` |
| D4 | PASS | không dòng `console.*` nào trong `api/` khớp key/token/secret/password/cookie; `redact()` áp ở các điểm trả lỗi của `api/_ai/gateway.js` |
| D5 (audit admin) | **CHƯA KIỂM CHỨNG** | `api/admin/_audit.js` ghi `who/what/target/when` vào bảng `admin_audit_log`, migration `supabase/migrations/202611010001_admin_audit_log.sql` có RLS. Audit là best-effort: bảng chưa apply thì `record()` trả `false` **lặng lẽ**, không lỗi. Cần một admin action thật để xác nhận có dòng log |
| D2, D3, D5, D6 | BLOCKED | cần quyền đọc log Vercel/Supabase staging |

## 6. Xung đột tài liệu cần sửa

`docs/audit/03-phase-0-report.md` dòng 152 kết luận **CHAIN-01 FAIL** và "chưa đủ điều kiện chuyển sang Giai đoạn 1", trong khi dòng 143 cùng file và `docs/CHAIN-01-REPORT.md` nói PASS. Bằng chứng mới (mục 2.1 của `04`) ủng hộ PASS. Bảng tổng kết Giai đoạn 0 của file 03 là snapshot trước khi re-verify, đừng dùng làm trạng thái hiện tại.

## 7. Việc chặn phần còn lại — cập nhật 2026-11-02

Redeploy **đã xong**, nên danh sách chặn ngắn lại và đổi thứ tự ưu tiên:

| Việc | Chặn gì | Ai làm |
|---|---|---|
| **Đọc `AI_PROVIDER_ORDER` trên Vercel** | Mọi thứ liên quan AI: Analyze, Gói E, SC-03/04/05, VERIFY-02/03. Nếu nó đang ghim `gemini` thì Groq có 2 key vẫn không được gọi và không còn fallback | user (dashboard Vercel) |
| `GET /api/debate?aiStatus=1&probe=1` | Xác định nguyên nhân lỗi Gemini/Groq thật sự (401 key sai / 429 quota / timeout). Một lệnh, có tốn quota | user duyệt, mình chạy |
| Fixture Student A / Student B / Admin | A3–A7, B1–B7, xác nhận projection SEC-01/FILE-01 trên site thật, và một admin action để kiểm `admin_audit_log` | user |
| Phê duyệt giao dịch testnet | C4 on-chain, Gói E, SC/VERIFY | user |
| Nộp source verification explorer | C6 | user duyệt |

## 8. Hai quyết định sản phẩm còn mở

1. Mã chứng nhận vẫn do admin nhập và vẫn đoán được (`PXP-2026-ALG-0001` tuần tự). Dài hạn nên để server sinh mã entropy cao, nhưng đổi mã sẽ vô hiệu mọi mã đã phát hành.
2. **Vẫn còn live trên `ab1ef9b`:** `app-config.js:8` chứa bốn email admin và được ship xuống trình duyệt. Bằng chứng đọc trực tiếp từ staging ngày 2026-11-02:

   ```
   https://paradox-ai-staging.vercel.app/app-config.js
   ADMIN_EMAILS = ['***@paradox.ai', '***@gmail.com', '***@gmail.com', '***@gmail.com']
   ```

   Ba trong bốn là email cá nhân thật, công khai cho mọi khách truy cập. Đây là dữ liệu định danh, không phải secret ký tên — nhưng không có lý do gì nằm trong bundle production.
