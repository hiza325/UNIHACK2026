# PARADOX AI — Kiểm chứng Staging khi chờ AI

**Ngày:** 2026-10-31, cập nhật 2026-11-01
**Commit kiểm tra:** `89052c4` (nhánh `feat/certificate-snapshot`) — **nhưng Staging không chạy bản này**; xem mục 1.1.
**Phạm vi:** chỉ các hạng mục không phụ thuộc AI. Không gửi giao dịch, không ghi dữ liệu, không đụng Production.

## 1. Kết luận nhanh

| Hạng mục | Trạng thái |
|---|---|
| Test nền | `npm run contract:test` 8/8 PASS · `npm test` 241/241 PASS |
| Phiên bản đang chạy trên Staging | **KHÔNG ĐẠT** — Staging phục vụ `main`, không phải `feat/certificate-snapshot` |
| SEC-03 (admin fallback) | Đã sửa fail-closed, có test chống hồi quy |
| SEC-01 / FILE-01 (lộ dữ liệu chứng nhận) | Đã sửa ở ranh giới HTTP cho cả hai đường tra mã, thêm rate limit, có test chống hồi quy |
| C6 (contract verified trên explorer) | KHÔNG ĐẠT — explorer báo "Contract not verified" |
| CHAIN-01 (state on-chain) | Đã đọc lại ngày 2026-11-01 — PASS, issuer `0xA906…C396` hợp lệ (mục 2.1) |
| SC-03/04/05, VERIFY-02/03 | BLOCKED — chưa có bất kỳ issuance nào trên chain |
| A3–A7, B1–B7, D2/D3/D5/D6 | BLOCKED — cần URL Staging và fixture Student A/B/Admin |

Môi trường kiểm tra đã cài Node.js `v26.13.0` / npm `11.20.0` (project khai báo `>=22.12`).

**Ý nghĩa với kế hoạch:** giả định "Staging đang chạy `feat/certificate-snapshot` @ `89052c4`" là sai. Toàn bộ kết quả nghiệm thu A/B/D đo trên Staging hiện tại sẽ mô tả một bản code khác với bản đang phát triển. Phải redeploy trước khi nghiệm thu.

### 1.1 Bằng chứng Staging chạy `main`

URL lấy từ `docs/PRODUCTION-SMOKE-TEST.md`: `https://unihack2026-beryl.vercel.app`.

So SHA1 của file phục vụ thực tế với SHA1 trong git:

| File | `main` | `feat/certificate-snapshot` | Staging phục vụ |
|---|---|---|---|
| `app.js` | `4f34809e3354…` | `4288737d9347…` | **`4f34809e3354…`** |
| `views/passport.js` | `d7e04c792bc9…` | `7b2fa17f5a82…` | **`d7e04c792bc9…`** |

Ba dấu hiệu phụ, cùng chiều:
- `certificate-renderer.js` và `certificate-issuance-actions.js` (chỉ tồn tại trên nhánh) trả **404**.
- `/api/admin/users` trả `Cache-Control: public, max-age=0, must-revalidate`, tức bản `main` chưa gọi `noStore()`.
- Không có phản hồi nào khớp chữ ký của `89052c4`.

Hệ quả trực tiếp: **lỗ hổng SEC-01 vẫn đang hoạt động trên site công khai** (trừ `recipientName`, cột chỉ có trên nhánh), và **SEC-03 cũng vậy** nếu môi trường Vercel không khai báo `ADMIN_EMAILS`. Hai bản vá ở `35bd93e` chưa có tác dụng cho tới khi redeploy.

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
| C2 | Số selector trong bytecode dispatch | 12, đúng bằng 9 hàm external + 3 getter trong source — PASS |
| C2 | 12 selector tính từ signature khớp dispatch trong bytecode | `0x4a0c3459 0xca6eec78 0xc974d9ed 0xd1be4883 0xa46c2b3e 0x6dc158eb 0x495289be 0xf2fde38b 0x79ba5097 0x8da5cb5b 0xe30c3978 0xf731fa0f` — PASS |
| C3 | `npm run contract:test` | 8/8 PASS — issuer hợp lệ, người lạ bị revert, cấp trùng bị chặn |
| C4 | Thu hồi / lập lại / chuyển owner | PASS ở mức unit test (`test_AuthorizedIssuerCanRevokeCredential`, `test_InvalidHashesMissingCredentialAndSecondRevocationFail`, `test_OwnershipTransferRequiresPendingOwnerAndKeepsOwnerAuthorized`) |
| C5 | Số giao dịch ghi vào contract | 2 (deploy + `setIssuer`) — không có tên thật/email/bài làm on-chain — PASS |
| C6 | Source verified trên explorer | Explorer hiển thị "Contract not verified" — KHÔNG ĐẠT |
| C8 | Không phát hành giao dịch | Không tx nào được ký hay gửi — PASS |
| SC-03/04/05, VERIFY-02/03 | Bằng chứng issuance on-chain | Ví phát hành nonce `0`, không có tx `issueCredential` — BLOCKED. Quyền issuer **đã sẵn sàng**, chỉ thiếu proof từ AI. |

### 2.1 Giao dịch sau snapshot CHAIN-01 — đã xác minh lại

| Tx | Selector | Block | Thời điểm |
|---|---|---|---|
| `0x45c55865...6de2d56f` | Contract Created | 60163894 | 2026-10-29 02:10:21 GMT+7 |
| `0xd674427a97319c9f3fe837cf6ece58969208ddd85a3bb44b9b1bb0f616e234ef` | `0x495289be` | 60268861 | 2026-10-31 02:15:26 GMT+7 |

Bản giải mã đầy đủ của tx thứ hai, đọc trực tiếp từ block:

```
from     0x35d1dc8183326f3cbc631ed04094765052b365cd   (chính ví owner)
selector 0x495289be = setIssuer(address,bool)         (contracts/LearningCredentialRegistry.sol:62, onlyOwner)
args     issuer = 0xA906C19dE177CcDAC0B092560FcDa7296165C396, authorized = true
status   0x1 (thành công)   gasUsed 0xbcd2
log      IssuerAuthorizationUpdated(address,bool,address)
         topic0 0xafba4afdad495bbca1abb3bb89a7ef0f09006e613f0a5ca62d9d2c87ac18a116
         issuer 0xa906c19d…, updatedBy 0x35d1dc81…, data = true
```

`0xA906…C396` khớp địa chỉ ví phát hành mà app dùng ở `certificate-issuance-actions.js:130`, `tests/credentials-prepare-confirm.spec.js:10` và `tools/issuer-admin.html:79`. Đây không phải thao tác lạ — đó là bước cấp issuer cho service, cố ý.

Trạng thái chain tại block 60312809 (đọc ngày 2026-11-01), tái lập bằng `eth_call`:

| selector | hàm | kết quả |
|---|---|---|
| `0x8da5cb5b` | `owner()` | `0x35d1dc81…` — khớp manifest |
| `0xe30c3978` | `pendingOwner()` | `0x0` — không có chuyển owner đang treo |
| `0xf731fa0f` | `authorizedIssuers(0x35d1dc81…)` | `true` |
| `0xf731fa0f` | `authorizedIssuers(0xA906…C396)` | `true` |

Lệnh tái lập — `DATA` là selector `0xf731fa0f` ghép với địa chỉ issuer đã pad 32 byte; muốn kiểm địa chỉ khác thì thay 40 ký tự cuối:

```bash
RPC=https://api.avax-test.network/ext/bc/C/rpc
ADDR=0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b
DATA=0xf731fa0f000000000000000000000000a906c19de177ccdac0b092560fcda7296165c396

curl -s -X POST $RPC -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$ADDR\",\"data\":\"$DATA\"},\"latest\"]}"

curl -s -X POST $RPC -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionCount\",\"params\":[\"0xa906c19de177ccdac0b092560fcda7296165c396\",\"latest\"]}"
```

**Kết luận CHAIN-01:** bằng chứng snapshot 2026-10-29 đã được thay bằng bằng chứng mới, vẫn ĐẠT, và issuer dự định dùng cho việc phát hành đã hợp lệ sẵn trên chain.

**Ví phát hành vẫn chưa ký giao dịch nào:** nonce của `0xA906…C396` là `0` tại block 60312809, trong khi owner có nonce `4` (deploy, setIssuer và hai giao dịch ngoài contract). SC-03/04/05 và VERIFY-02/03 vẫn BLOCKED vì chưa có issuance thật, không phải vì thiếu quyền.

## 3. Gói A — hai lỗi phân quyền đã sửa

### 3.1 SEC-03 — `ADMIN_EMAILS` để trống từng **cấp** admin

`authConfig()` trong `api/auth/_supabase.js` dùng `env.ADMIN_EMAILS || '<bốn email cá nhân>'`. Vì chuỗi rỗng là falsy, để trống biến môi trường **mở** quyền admin cho bốn địa chỉ đó thay vì tắt allowlist. `playwright.config.js:42` đặt `ADMIN_EMAILS: ''` với ý định vô hiệu hóa, nên toàn bộ test chạy trên nhánh fallback chưa từng được chủ đích kiểm chứng.

Bằng chứng trước/sau, chạy trực tiếp với `ADMIN_EMAILS` để trống:

```
TRUOC (ma cu):  ["<email admin demo>","<4 email cá nhân của dev>"]   -> 4 địa chỉ được cấp admin
SAU  (ma moi):  []                                                    -> không địa chỉ nào
```

Đã đổi sang chỉ parse `ADMIN_EMAILS` đã khai báo. `.env.example` bỏ email thật, thay bằng hướng dẫn để trống.

**Hệ quả vận hành:** môi trường nào không khai báo `ADMIN_EMAILS` mà trông cậy fallback sẽ mất admin. Cần khai báo tường minh hoặc provision qua `app_metadata.role = 'admin'` — con đường này vẫn được hỗ trợ và có test.

**Chưa sửa:** `app-config.js:8` vẫn giữ bốn email và được ship xuống trình duyệt, phục vụ chế độ demo localStorage. Đây là quyết định sản phẩm nên để mở.

### 3.2 SEC-01 / FILE-01 — tra mã chứng nhận lộ dữ liệu học sinh khác

Chuỗi lỗi: `api/credentials/index.js` `GET ?code=` và `POST action:"verify"` chỉ yêu cầu `currentUser()` (xác thực, không xác nhận sở hữu), còn `findByCode` tại `api/credentials/_store.js:57-59` lọc theo `credential_code` mà không có `learner_id`. Kết quả trả về qua `toPublicCredential()` gồm `snapshot.recipientName`, `assessmentScore`, `evaluationId`, `evidenceHash`.

Mức nghiêm trọng cộng dồn: mã do admin nhập tự do (regex `^PXP-[A-Z0-9-]{4,76}$`), mẫu gợi ý trong `learning-passport-mock.js:85` là `PXP-2026-ALG-0001`/`-REM-0002`/`-PYT-0003` tuần tự, và endpoint trước đó không có rate limit — xem mục 3.3.

**Cách sửa:** giữ nguyên `toPublicCredential` cho passport của chính chủ và các luồng admin, thêm `toVerificationView()` lọc còn đúng những field trang verify hiển thị (`code`, `name`, `skill`, `issuedAt`, `status`, `network`, `chainId`, `contractAddress`, `transactionHash`, `verification`, `isTest`, `source`), và áp nó tại **ranh giới HTTP** cho hai đường tra theo mã.

Bản vá đầu tiên chỉ phủ `GET ?code=`. Khi nối rate limit mới phát hiện `POST action:"verify"` vẫn trả payload đầy đủ, tức vẫn lộ qua đường thứ hai. Cả hai nhánh giờ đều đi qua `toVerificationView`, và mỗi nhánh có test riêng.

Đã xác minh UI không cần các field bị cắt: trang verify (`views/passport.js:100`) và luồng thật (`learning-passport-actions.js:104` → `verifyCredential`) không đọc `recipientName`, `assessmentScore`, `evidenceHash` hay `evaluationId`. Panel chi tiết trong passport dùng dữ liệu từ `GET /api/credentials` (owner-scoped), không dùng `?code=`.

### 3.3 Rate limit cho tra cứu mã

`guardCredentialLookup()` trong `api/auth/_rate-limit.js` dùng lại cửa sổ trượt sẵn có, áp cho cả hai đường tra và chặn theo **IP** lẫn **user id**:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CREDENTIAL_LOOKUP_WINDOW_MINUTES` | 15 | độ dài cửa sổ |
| `CREDENTIAL_LOOKUP_IP_LIMIT` | 60 | lượt tra mỗi IP trong cửa sổ |
| `CREDENTIAL_LOOKUP_USER_LIMIT` | 60 | lượt tra mỗi user trong cửa sổ |
| `RATE_LIMIT_DISABLED` | tắt | bỏ qua toàn bộ guard |

Ngưỡng đặt cố ý rộng: người verify thủ công không bao giờ chạm tới, script quét không gian mã thì chạm. Vượt ngưỡng trả `429` kèm `Retry-After`, cùng cơ chế đã dùng cho OTP.

**Lưu ý triển khai:** bộ đếm nằm trong RAM của serverless instance nên cold start sẽ đặt lại. Hạn chế này tồn tại từ trước với rate limit OTP; đủ để chặn một client quét từ một instance ấm, không phải lá chắn phân tán.

### 3.4 Test chống hồi quy

`tests/authorization-regression.spec.js` — 10 test, đều PASS trên mã mới:

| Test | Nội dung |
|---|---|
| SEC-03 ×4 | `ADMIN_EMAILS` unset/rỗng → `[]`; allowlist khai báo vẫn hoạt động và được normalize; bốn email cũ chỉ là `user`; `app_metadata.role` vẫn cấp admin |
| SEC-01 ×3 | `toPublicCredential` vẫn giữ field riêng (chứng minh phép thử có ý nghĩa); `toVerificationView` cắt đúng; handler HTTP trả payload không chứa tên/điểm/evaluationId |
| SEC-01 verify ×1 | `POST action:"verify"` cũng chỉ trả view — nhánh từng bị bỏ sót |
| SEC-01 budget ×1 | GET và verify dùng chung một bộ đếm: `200, 200, 429` |
| SEC-01 sweep ×1 | Bốn lượt tra liên tiếp → `200, 200, 200, 429`, kèm `code: RATE_LIMITED`, header `Retry-After` và không còn tên học sinh trong body |

Toàn bộ suite: `npm test` **241/241 PASS** (39.4s) · `npm run contract:test` **8/8 PASS**.

## 4. Các mục đạt khác

| Mã | Nội dung | Bằng chứng |
|---|---|---|
| A1 | Danh sách API/bảng/RLS/role | 13 route, 6 bảng, RLS bật trên cả 6, không có policy nào cho `anon`/`authenticated` ghi |
| A2 | User ID lấy từ session, không từ request | `learning-records` re-scope mọi query theo `user.id`; `passport` dùng `publicUser(session.user)` |
| SEC-02 / D1 | Endpoint admin chặn server-side | `api/admin/users.js:9` và `api/credentials/index.js:57,61,66,71,79` đều `requireAdmin` |
| D4 | Log không lộ key/token | Không dòng `console.*` nào trong `api/` khớp key/token/secret/password/cookie; `redact()` áp ở 7 điểm trả lỗi trong `api/_ai/gateway.js` |

## 5. Việc còn mở

| Mã | Cần gì để làm |
|---|---|
| **Redeploy** | Chặn mọi mục khác: Staging đang chạy `main`; bản vá SEC-01/SEC-03 ở `35bd93e` chưa có hiệu lực trên site |
| **Gói E (Analyze)** | Chặn SC-03/04/05, VERIFY-02/03 và C4 on-chain. Không có evaluation thật thì không có proof, không có proof thì không có gì để ký — dù quyền issuer đã sẵn sàng trên chain |
| A3, A4, A5, A6, A7 | URL Staging + fixture Student A/B/Admin để gọi thật và thấy mã từ chối |
| B1–B7 | URL Staging + fixture, kèm ảnh trước/sau và commit tương ứng |
| C4 on-chain, C7 | Phê duyệt riêng cho giao dịch testnet; UI Verify cần Staging |
| C6 | Nộp source verification trên explorer — thao tác công khai, cần duyệt |
| D2, D3, D5, D6 | Log Vercel/Supabase staging hoặc quyền vận hành |
| SEC-01 (gốc) | Mã vẫn do admin nhập và vẫn đoán được; về dài hạn nên để server sinh mã entropy cao. Đổi mã sẽ vô hiệu mọi mã đã phát hành nên cần quyết định sản phẩm |
| `app-config.js` | Bỏ email admin khỏi bundle trình duyệt nếu không còn cần demo mode |

CHAIN-01 không còn là mục mở: `setIssuer` ngày 31/10 là bước cấp issuer cho ví phát hành của app, đã đối chiếu khớp mã nguồn và đã đọc lại state trực tiếp trên chain (mục 2.1).
