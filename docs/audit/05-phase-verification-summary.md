# PARADOX AI — Nghiệm thu theo giai đoạn (Internal Staging Work Plan 31/10/2026)

**Ngày lập:** 2026-11-01
**Nhánh làm việc:** `feat/certificate-snapshot`
**Chủ thể thực hiện:** agent trong phiên Qoder. Tám commit `84ed163…` mang tác giả `nguyenhominhtu100808-pixel <348087843+nguyenhominhtu100808-pixel@users.noreply.github.com>`; credential dùng để push thuộc tài khoản `hiza325`, nên author và người đẩy lên là hai chủ thể khác nhau.

## 0. Đọc trước khi dùng tài liệu này

Hai điều kiện của kế hoạch không còn đúng, nên mọi ô "PASS đo trên Staging" phải kiểm lại:

1. **Staging không chạy bản của kế hoạch.** `https://unihack2026-beryl.vercel.app` phục vụ `main`, không phải `feat/certificate-snapshot` @ `89052c4`. Bằng chứng SHA1 trong `docs/audit/04-staging-verification.md` mục 1.1.
2. **Vì vậy hai bản vá bảo mật chưa có hiệu lực trên site công khai** cho tới khi redeploy.

Quy tắc đã tuân thủ throughout: chỉ kiểm thử trên Staging, không sửa Production, không dùng dữ liệu thật nhạy cảm, không tạo evaluation/proof giả, không ký/gửi giao dịch.

## 1. Tổng trạng thái

| Nhóm | Đạt | BLOCKED | Ghi chú |
|---|---|---|---|
| Gói A — lập bản đồ & phân quyền | A1, A2, A8, SEC-01, SEC-02, SEC-03, FILE-01 | A3–A7 | A3–A7 cần Staging chạy đúng bản + fixture |
| Gói B — UI dùng dữ liệu thật | 0 | B1–B7 | Block 100% ở redeploy + fixture |
| Gói C — Avalanche | C1–C5, C8, CHAIN-01 | C6, C7 | C6 cần nộp source verification; C7 cần Staging |
| Gói D — vận hành | D1, D4 | D2, D3, D5, D6 | cần log Vercel/Supabase staging |
| Gói E — phát hành thật | 0 | SC-03/04/05, VERIFY-02/03 | cần evaluation thật từ AI |

**Test nền:** `npm test` 241/241 PASS · `npm run contract:test` 8/8 PASS.

## 2. Gói A — lập bản đồ hệ thống và phân quyền

| Mã | Kết quả | Bằng chứng kiểm tra lại được |
|---|---|---|
| A1 | PASS | 13 route, 6 bảng, RLS bật trên cả 6, không policy nào cho `anon`/`authenticated` ghi |
| A2 | PASS | `api/learning-records` re-scope mọi query theo `user.id` session; passport dùng `publicUser(session.user)` |
| SEC-01 | PASS (code) — **chưa live** | `toVerificationView()` áp tại ranh giới HTTP cho cả `GET ?code=` và `POST action:"verify"`; 6 test hồi quy |
| SEC-02 | PASS | `requireAdmin` server-side ở `api/admin/users.js:9` và 5 nhánh của `api/credentials/index.js` |
| SEC-03 | PASS (code) — **chưa live** | `ADMIN_EMAILS` rỗng → `[]` thay vì fallback 4 email cá nhân; `.env.example` bỏ email thật |
| FILE-01 | PASS (code) — **chưa live** | cùng đường vá với SEC-01; payload verify không còn `recipientName`/`assessmentScore`/`evaluationId`/`evidenceHash` |
| A8 | PASS | Rate limit tra cứu mã theo IP + user, 429 kèm `Retry-After` |
| A3–A7 | **BLOCKED** | cần URL Staging chạy đúng nhánh và fixture Student A/B/Admin |

Lưu ý kỹ thuật: bộ đếm rate limit nằm trong RAM serverless instance, cold start sẽ đặt lại. Đủ chặn một client quét từ instance ấm, không phải lá chắn phân tán.

## 3. Gói B — UI phải dùng dữ liệu thật

Không mục nào PASS. Lý do không phải code mà là môi trường: Staging đang phục vụ `main`, và fixture Student A/B/Admin chưa được restore.

| Mã | Trạng thái | Cần gì |
|---|---|---|
| B1–B7 | BLOCKED | redeploy `feat/certificate-snapshot` + fixture + ảnh trước/sau theo commit |

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
| D1 | PASS | endpoint admin chặn server-side |
| D4 | PASS | không dòng `console.*` nào trong `api/` khớp key/token/secret/password/cookie; `redact()` ở 7 điểm trả lỗi của `api/_ai/gateway.js` |
| D2, D3, D5, D6 | BLOCKED | cần quyền đọc log Vercel/Supabase staging |

## 6. Xung đột tài liệu cần sửa

`docs/audit/03-phase-0-report.md` dòng 152 kết luận **CHAIN-01 FAIL** và "chưa đủ điều kiện chuyển sang Giai đoạn 1", trong khi dòng 143 cùng file và `docs/CHAIN-01-REPORT.md` nói PASS. Bằng chứng mới (mục 2.1 của `04`) ủng hộ PASS. Bảng tổng kết Giai đoạn 0 của file 03 là snapshot trước khi re-verify, đừng dùng làm trạng thái hiện tại.

## 7. Ba việc chặn phần còn lại

| Việc | Chặn gì | Ai làm |
|---|---|---|
| Redeploy `feat/certificate-snapshot` lên Staging | A3–A7, B1–B7, C7, và hiệu lực thật của SEC-01/03/FILE-01 | user / owner Vercel |
| Restore fixture Student A / Student B / Admin | A3–A7, B1–B7 | user (fixture từng tồn tại, xem `01-system-inventory.md:280`) |
| Evaluation thật từ AI + phê duyệt giao dịch testnet | C4 on-chain, C6, Gói E, SC-03/04/05, VERIFY-02/03 | user phê duyệt |

## 8. Hai quyết định sản phẩm còn mở

1. Mã chứng nhận vẫn do admin nhập và vẫn đoán được (`PXP-2026-ALG-0001` tuần tự). Dài hạn nên để server sinh mã entropy cao, nhưng đổi mã sẽ vô hiệu mọi mã đã phát hành.
2. `app-config.js:8` vẫn chứa bốn email admin và được ship xuống trình duyệt cho chế độ demo localStorage.
