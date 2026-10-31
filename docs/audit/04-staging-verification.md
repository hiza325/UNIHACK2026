# PARADOX AI — Kiểm chứng Staging khi chờ AI

**Ngày:** 2026-10-31, cập nhật 2026-11-01
**Commit kiểm tra:** `89052c4` (nhánh `feat/certificate-snapshot`, bản đang chạy trên Vercel `paradox-ai-staging`)
**Phạm vi:** chỉ các hạng mục không phụ thuộc AI. Không gửi giao dịch, không ghi dữ liệu, không đụng Production.

## 1. Kết luận nhanh

| Hạng mục | Trạng thái |
|---|---|
| Test nền | `npm run contract:test` 8/8 PASS · `npm test` 238/238 PASS |
| SEC-03 (admin fallback) | Đã sửa fail-closed, có test chống hồi quy |
| SEC-01 / FILE-01 (lộ dữ liệu chứng nhận) | Đã sửa ở ranh giới HTTP, có test chống hồi quy |
| C6 (contract verified trên explorer) | KHÔNG ĐẠT — explorer báo "Contract not verified" |
| SC-03/04/05, VERIFY-02/03 | BLOCKED — chưa có bất kỳ issuance nào trên chain |
| A3–A7, B1–B7, D2/D3/D5/D6 | BLOCKED — cần URL Staging và fixture Student A/B/Admin |

Môi trường kiểm tra đã cài Node.js `v26.13.0` / npm `11.20.0` (project khai báo `>=22.12`).

## 2. Gói C — bằng chứng on-chain tái lập được

Mọi lệnh là RPC read-only trên endpoint công khai:

```bash
RPC=https://api.avax-test.network/ext/bc/C/rpc
ADDR=0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b

curl -s -X POST $RPC -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

curl -s -X POST $RPC -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$ADDR\",\"latest\"]}"

curl -s -X POST $RPC -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$ADDR\",\"data\":\"0x8da5cb5b\"},\"latest\"]}"
```

| Mã | Kiểm tra | Kết quả |
|---|---|---|
| C1 | `eth_chainId` | `0xa869` = 43113 — PASS |
| CHAIN-01 | `eth_getCode` độ dài | 2322 bytes, khớp `docs/CHAIN-01-REPORT.md` — PASS |
| C1 | `owner()` (`0x8da5cb5b`) | `0x35d1dc8183326f3cbc631ed04094765052b365cd`, khớp `deployments/avalanche-fuji.json` — PASS |
| C2 | Selector trong bytecode dispatch | 12, đúng bằng 9 hàm external + 3 getter trong source — PASS |
| C3 | `npm run contract:test` | 8/8 PASS — issuer hợp lệ, người lạ bị revert, cấp trùng bị chặn |
| C4 | Thu hồi / lập lại / chuyển owner | PASS ở mức unit test (`test_AuthorizedIssuerCanRevokeCredential`, `test_InvalidHashesMissingCredentialAndSecondRevocationFail`, `test_OwnershipTransferRequiresPendingOwnerAndKeepsOwnerAuthorized`) |
| C5 | Số giao dịch ghi vào contract | 2 — không có tên thật/email/bài làm on-chain — PASS |
| C6 | Source verified trên explorer | Explorer hiển thị "Contract not verified" — KHÔNG ĐẠT |
| C8 | Không phát hành giao dịch | Không tx nào được ký hay gửi — PASS |
| SC-03/04/05, VERIFY-02/03 | Bằng chứng issuance on-chain | Không có tx `issueCredential` (`0x4a0c3459`) hay `revokeCredential` — BLOCKED |

### 2.1 Giao dịch sau snapshot CHAIN-01

| Tx | Selector | Block | Thời điểm |
|---|---|---|---|
| `0x45c55865...6de2d56f` | Contract Created | 60163894 | 2026-10-29 02:10:21 GMT+7 |
| `0xd674427a...16e234ef` | `0x495289be` | 60268861 | 2026-10-31 02:15:26 GMT+7 |

`0x495289be` giải mã từ bytecode sang khối nhập tại `0x023f`: mở đầu bằng kiểm tra `onlyOwner`, emit topic `IssuerAuthorizationUpdated`, hai tham số `(address, bool)` theo decoder `0x084a`. Đây là `setIssuer(address,bool)`, gọi từ chính ví owner.

Hệ quả: các giá trị issuer trong báo cáo CHAIN-01 lập ngày 2026-10-29 **không còn chắc chắn** cho ngày 31/10. Cần đọc lại `authorizedIssuers(...)` trước khi dùng làm bằng chứng.

## 3. Gói A — hai lỗi phân quyền đã sửa

### 3.1 SEC-03 — `ADMIN_EMAILS` để trống từng **cấp** admin

`authConfig()` trong `api/auth/_supabase.js` dùng `env.ADMIN_EMAILS || '<bốn email cá nhân>'`. Vì chuỗi rỗng là falsy, để trống biến môi trường **mở** quyền admin cho bốn địa chỉ đó thay vì tắt allowlist. `playwright.config.js:42` đặt `ADMIN_EMAILS: ''` với ý định vô hiệu hóa, nên toàn bộ test chạy trên nhánh fallback chưa từng được chủ đích kiểm chứng.

Bằng chứng trước/sau, chạy trực tiếp:

```
TRUOC (ma cu):  ["admin@paradox.ai","huyclasswiz@gmail.com","huyriuuu@gmail.com","lamnguyen080306@gmail.com"]
SAU  (ma moi):  []
```

Đã đổi sang chỉ parse `ADMIN_EMAILS` đã khai báo. `.env.example` bỏ email thật, thay bằng hướng dẫn để trống.

**Hệ quả vận hành:** môi trường nào không khai báo `ADMIN_EMAILS` mà trông cậy fallback sẽ mất admin. Cần khai báo tường minh hoặc provision qua `app_metadata.role = 'admin'` — con đường này vẫn được hỗ trợ và có test.

**Chưa sửa:** `app-config.js:8` vẫn giữ bốn email và được ship xuống trình duyệt, phục vụ chế độ demo localStorage. Đây là quyết định sản phẩm nên để mở.

### 3.2 SEC-01 / FILE-01 — tra mã chứng nhận lộ dữ liệu học sinh khác

Chuỗi lỗi: `api/credentials/index.js` `GET ?code=` và `POST action:"verify"` chỉ yêu cầu `currentUser()` (xác thực, không xác nhận sở hữu), còn `findByCode` tại `api/credentials/_store.js:57-59` lọc theo `credential_code` mà không có `learner_id`. Kết quả trả về qua `toPublicCredential()` gồm `snapshot.recipientName`, `assessmentScore`, `evaluationId`, `evidenceHash`.

Mức nghiêm trọng cộng dồn: mã do admin nhập tự do (regex `^PXP-[A-Z0-9-]{4,76}$`), mẫu gợi ý trong `learning-passport-mock.js:85` là `PXP-2026-ALG-0001`/`-REM-0002`/`-PYT-0003` tuần tự, và endpoint không có rate limit.

**Cách sửa:** giữ nguyên `toPublicCredential` cho passport của chính chủ và các luồng admin, thêm `toVerificationView()` lọc còn đúng những field trang verify hiển thị (`code`, `name`, `skill`, `issuedAt`, `status`, `network`, `chainId`, `contractAddress`, `transactionHash`, `verification`, `isTest`, `source`), và áp nó tại **ranh giới HTTP** cho hai đường tra theo mã.

Đã xác minh UI không cần các field bị cắt: trang verify (`views/passport.js:100`) và luồng thật (`learning-passport-actions.js:104` → `verifyCredential`) không đọc `recipientName`, `assessmentScore`, `evidenceHash` hay `evaluationId`. Panel chi tiết trong passport dùng dữ liệu từ `GET /api/credentials` (owner-scoped), không dùng `?code=`.

**Chưa làm, còn mở:**
- Mã vẫn do admin nhập và vẫn đoán được. Về dài hạn nên để server sinh mã entropy cao.
- Endpoint tra theo mã vẫn **không có rate limit**, nên quét hàng loạt vẫn rẻ — chỉ tốn công sức hơn vì không còn lấy được tên và điểm.

### 3.3 Test chống hồi quy

`tests/authorization-regression.spec.js` — 7 test, đều PASS trên mã mới:

| Test | Nội dung |
|---|---|
| SEC-03 ×4 | `ADMIN_EMAILS` unset/rỗng → `[]`; allowlist khai báo vẫn hoạt động và được normalize; bốn email cũ chỉ là `user`; `app_metadata.role` vẫn cấp admin |
| SEC-01 ×3 | `toPublicCredential` vẫn giữ field riêng (chứng minh phép thử có ý nghĩa); `toVerificationView` cắt đúng; handler HTTP trả payload không chứa tên/điểm/evaluationId |

## 4. Các mục đạt khác

| Mã | Nội dung | Bằng chứng |
|---|---|---|
| A1 | Danh sách API/bảng/RLS/role | 13 route, 6 bảng, RLS bật trên cả 6, không có policy nào cho `anon`/`authenticated` ghi |
| A2 | User ID lấy từ session, không từ request | `learning-records` re-scope mọi query theo `user.id`; `passport` dùng `publicUser(session.user)` |
| SEC-02 / D1 | Endpoint admin chặn server-side | `api/admin/users.js:9` và `api/credentials/index.js:54,58,63,68,76` đều `requireAdmin` |
| D4 | Log không lộ key/token | Không dòng `console.*` nào trong `api/` khớp key/token/secret/password/cookie; `redact()` áp ở 7 điểm trả lỗi trong `api/_ai/gateway.js` |

## 5. Việc còn mở

| Mã | Cần gì để làm |
|---|---|
| A3, A4, A5, A6, A7 | URL Staging + fixture Student A/B/Admin để gọi thật và thấy mã từ chối |
| B1–B7 | URL Staging + fixture, kèm ảnh trước/sau và commit tương ứng |
| C4 on-chain, C7 | Phê duyệt riêng cho giao dịch testnet; UI Verify cần Staging |
| C6 | Nộp source verification trên explorer — thao tác công khai, cần duyệt |
| D2, D3, D5, D6 | Log Vercel/Supabase staging hoặc quyền vận hành |
| SEC-01 (gốc) | Chuyển sang mã do server sinh entropy cao, và thêm rate limit cho tra cứu |
| `app-config.js` | Bỏ email admin khỏi bundle trình duyệt nếu không còn cần demo mode |
