# PARADOX AI — Báo cáo Giao diện phản ánh dữ liệu thật

**Phạm vi:** Prompt 1 + Prompt 2

**Ngày hoàn tất kiểm tra:** 2026-10-29

**Trạng thái:** Hoàn thành phạm vi UI; chưa commit, push hoặc deploy production

## 1. Hạng mục đã hoàn thành

### 1.1. Năm trạng thái dữ liệu

- Chuẩn hóa `Loading`, `Empty`, `Error`, `Real`, `Demo` cho Dashboard, History, Analytics, Profile/Achievement và Learning Passport.
- API lỗi không còn bị chuyển thành số `0`, danh sách rỗng hoặc kết luận “không có dữ liệu”.
- `Error` có Retry; `Demo` có nhãn rõ; số liệu thiếu hiển thị `—`.
- Tài khoản mới không nhận phiên học, điểm, quota, plan hoặc Achievement giả.

### 1.2. Dashboard, phiên học và Achievement

- Dashboard dùng learning records và credential data theo đúng nguồn đang hoạt động.
- “Tiếp tục học” chỉ xuất hiện với phiên `in_progress` hoặc `analysis_unavailable`, mở đúng problem/submission đã lưu.
- Loại bỏ điểm mặc định `50/85`, tiến độ `4/7`, quota `10/10`, plan `FREE`, thứ hạng và insight suy diễn.
- Ngày/biểu đồ dùng dữ liệu động với múi giờ `Asia/Ho_Chi_Minh`.
- Achievement phân biệt `earned`, `locked`, `unavailable`; tiêu chí backend chưa lưu không được tự suy diễn.
- Chứng nhận “đã phát hành” chỉ được tính khi metadata khớp Fuji, đúng registry và có transaction hash phát hành hợp lệ.

### 1.3. Avalanche Fuji dùng cấu hình chung

Nguồn dùng chung: `avalanche-config.js`.

| Thuộc tính | Giá trị |
|---|---|
| Contract | `LearningCredentialRegistry` |
| Network | Avalanche Fuji Testnet |
| Chain ID | `43113` |
| Address | `0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b` |
| Deployment transaction | `0x45c55865fb43bf28a1972597ce4ecedf9d769876344034a9447cd75a6de2d56f` |
| Explorer | `https://explorer-test.avax.network/c-chain` |

- Frontend, API, deploy/verify tooling và Core provider guard cùng đọc cấu hình này.
- API từ chối chain khác `43113` và registry address khác deployment PARADOX.
- Manifest công khai nằm tại `deployments/avalanche-fuji.json`; không chứa private key.
- `docs/CHAIN-01-REPORT.md` đã được cập nhật từ snapshot `BLOCKED` thành bằng chứng read-only `PASS`.

### 1.4. Verify Certificate

Verify có mô hình trạng thái riêng:

| Trạng thái | Hành vi |
|---|---|
| `checking` | Hiển thị đang đối chiếu, khóa submit tạm thời |
| `valid` | Chỉ hiển thị **Verified on Avalanche** khi đúng chain, contract, credential tồn tại, evidence hợp lệ và transaction phát hành hợp lệ |
| `not-found` | Mã không có bản ghi; không báo thành công |
| `unissued` | Có bản ghi nhưng chưa có credential tương ứng on-chain |
| `revoked` | Credential on-chain đã bị thu hồi |
| `network-error` | Lỗi API/RPC, có Retry; không chuyển thành “không tồn tại” |
| `demo` | Mã minh họa, không có Explorer link và không được xem là credential thật |
| `unavailable` | Chưa đủ bằng chứng để kết luận |

Các guard bổ sung:

- Validate mã `PXP-…` trước khi gọi API.
- Kết quả được focus sau tra cứu; Retry hoạt động bằng bàn phím.
- Transaction link chỉ xuất hiện khi hash 32-byte hợp lệ và metadata khớp Fuji deployment.
- Mock fixture không còn transaction hash/network giả.
- Verify chỉ đọc API/Avalanche; không issue, ký ví hoặc gửi transaction.
- Deployment transaction không được dùng làm issuance evidence cho credential.

### 1.5. About / Guide

- Giới thiệu PARADOX AI là nền tảng hỗ trợ người học tự phát hiện và sửa lỗi.
- Mô tả quy trình AI learning 7 bước.
- Phân biệt Achievement và Certificate.
- Giải thích Avalanche Fuji, contract, Chain ID, address và deployment transaction.
- Phân loại tính năng `ACTIVE`, `DEVELOPING`, `DEMO`.
- Có hướng dẫn kiểm tra mã, diễn giải kết quả và mở Explorer mà không kết nối ví.
- Nội dung dài đã được kiểm tra desktop/mobile, dark mode và accessibility.

## 2. Danh sách file thay đổi

### Cấu hình và deployment metadata

- `.env.example`
- `avalanche-config.js` — mới
- `deployments/avalanche-fuji.json` — mới
- `README.md`

### Frontend/data state

- `app-actions.js`
- `app-data.js`
- `app-events.js`
- `app-router.js`
- `app.js`
- `i18n.js`
- `learning-data.js` — mới
- `learning-passport-actions.js`
- `learning-passport-mock.js`
- `learning-passport-service.js`
- `learning-records-actions.js`
- `views.css`
- `views/about.js`
- `views/analytics.js`
- `views/cards.js`
- `views/dashboard.js`
- `views/history.js`
- `views/passport.js`
- `views/practice.js`
- `views/profile.js`
- `views/shell.js`

### Backend/tooling

- `api/credentials/_avalanche.js`
- `api/credentials/_service.js`
- `api/credentials/index.js`
- `internal/core-browser-deployer/app.js`
- `internal/core-browser-deployer/provider-guard.js`
- `scripts/deploy-learning-credential-registry.mjs`
- `scripts/serve-core-browser-deployer.mjs`
- `scripts/verify-learning-credential-registry.mjs`

### Tests và tài liệu

- `tests/app.spec.js`
- `tests/learning-passport.spec.js`
- `tests/real-data-ui.spec.js` — mới
- `docs/CHAIN-01-DEPLOYMENT-GUIDE.md`
- `docs/CHAIN-01-REPORT.md`
- `docs/audit/01-system-inventory.md`
- `docs/audit/02-environment-security.md`
- `docs/audit/03-phase-0-report.md`
- `docs/PHASE-1-UI-REAL-DATA-REPORT.md` — mới

Không thay đổi `contracts/*.sol` hoặc `hardhat.config.ts`.

## 3. Kết quả test thực tế

### Hồi quy đầy đủ

```text
npm run test:all
Solidity: 8 passing
Playwright: 101 passed
```

Phạm vi Playwright có đăng nhập, Dashboard, AI Learning/Debate, History, Achievement/Profile, Passport, Verify, API, accessibility và responsive.

### Fuji read-only verification

```text
npm run contract:verify:fuji
status: PASS
chainId: 43113
bytecodePresent: true
runtimeBytecodeBytes: 2322
runtimeBytecodeMatchesArtifact: true
receipt status: 1
receipt addressMatches: true
ownerAuthorized: true
```

### Build và kiểm tra tĩnh

| Kiểm tra | Kết quả |
|---|---|
| `npm run contract:build` | PASS — `No contracts to compile` |
| `node --check` trên module thay đổi | PASS |
| `git diff --check` | PASS; chỉ có cảnh báo line-ending LF/CRLF của Git trên Windows |
| Lint | Không có script lint trong `package.json` |
| Typecheck | Không có script typecheck trong `package.json` |
| Frontend bundle build | Không có bundler; frontend dùng static ES modules |

### UI/UX được kiểm tra

- Desktop và mobile `390 × 844`.
- Không horizontal overflow ở Passport, Verify và About.
- Axe không có violation `serious`/`critical` trong các view được kiểm tra.
- Keyboard: Enter submit/điều hướng, focus kết quả, focus Retry, Escape đóng modal.
- Native/custom form validation chặn mã Verify sai trước khi gọi API.
- Loading/Empty/Error/Real/Demo và Retry đều có test.
- Test About/Verify với auth/API hợp lệ không ghi nhận browser console error.

## 4. Chức năng chưa thể xác minh

1. **Credential production end-to-end:** không issue/revoke credential thật trong nhiệm vụ này; không có transaction blockchain mới được gửi.
2. **Một mã Certificate production cụ thể:** chưa có credential non-test được cung cấp để chứng minh đầy đủ luồng database → issue transaction → on-chain verify → UI.
3. **Achievement persistence:** chưa có bảng/API lưu `earned_at` và lịch sử unlock độc lập.
4. **Self-detection evidence:** backend chưa lưu tiêu chí `selfDetected` có thể kiểm chứng.
5. **Workflow step persistence:** backend chưa lưu chính xác bước trong quy trình 7 bước.
6. **Plan/quota:** chưa có API xác thực gói và hạn mức.
7. **Unauthenticated public verifier:** Verify hiện nằm trong app đã đăng nhập; hướng dẫn và việc kiểm tra không cần ví, nhưng API public không-auth chưa được triển khai.

## 5. Lỗi/giới hạn còn tồn tại

- Các API thật vẫn cần Supabase/database và environment server hợp lệ; khi thiếu, UI hiển thị Error/Retry thay vì fallback giả.
- Khả dụng của Verify phụ thuộc Fuji RPC và credentials database; lỗi mạng được giữ riêng, không thể kết luận credential không tồn tại.
- Practice Lab và local Passport vẫn là Demo theo chủ đích, đã gắn nhãn.
- Chưa có lint/typecheck/frontend build pipeline để bổ sung bằng chứng ở các lớp đó.

Không phát hiện regression hoặc lỗi nghiêm trọng trong bộ test hiện tại.

## 6. Checklist PASS/FAIL

| Hạng mục | Kết quả |
|---|---|
| Không làm mất logic Prompt 1 | PASS |
| Loading / Empty / Error / Real / Demo nhất quán | PASS |
| Fuji Testnet `43113`, không nhầm Mainnet | PASS |
| Address/tx/Explorer dùng cấu hình chung | PASS |
| Deployment read-only verification | PASS |
| Verified chỉ khi đủ bằng chứng credential | PASS |
| Không coi contract deployment là credential issuance | PASS |
| Not found / Unissued / Checking / Network error UI | PASS |
| Retry, validation và focus | PASS |
| Transaction link guard | PASS |
| Demo code không được trình bày như credential thật | PASS |
| About/Guide: AI, Achievement, Certificate, Avalanche | PASS |
| Active / Developing / Demo | PASS |
| Desktop/mobile/responsive | PASS |
| Accessibility serious/critical | PASS |
| Browser console trong luồng được kiểm tra | PASS |
| Full Playwright regression | PASS — `101/101` |
| Solidity regression | PASS — `8/8` |
| Achievement persistence API | FAIL — chưa có backend |
| Plan/quota API | FAIL — chưa có backend |
| Credential production E2E | FAIL — không được phép gửi giao dịch trong phạm vi này |
| Public no-auth verification endpoint | FAIL — chưa triển khai |
| Không commit/push/deploy production | PASS |

## 7. Đánh giá sẵn sàng cho CHAIN-02

**Mức độ: READY FOR CHAIN-02 INTEGRATION TESTING — có điều kiện.**

Đã sẵn sàng:

- CHAIN-01 registry, receipt, bytecode và owner/issuer read checks đều PASS.
- API có issue/verify/revoke service, chain/address guard và evidence mismatch guard.
- UI có đầy đủ trạng thái an toàn và không tạo xác minh giả.
- Test unit/UI bảo vệ Mainnet, mock issuance và verified claim thiếu bằng chứng.

Điều kiện để CHAIN-02 được nghiệm thu:

1. Cấu hình Supabase credentials database và server environment an toàn.
2. Dùng dedicated Fuji issuer đã được ủy quyền; không đưa private key ra frontend.
3. Phát hành **một credential test được gắn nhãn rõ** từ proof record đủ điều kiện.
4. Ghi receipt/issue transaction vào database và xác minh lại bằng read-only call.
5. Chạy UI với mã đó để chứng minh `valid`; đồng thời test `unissued`, `revoked`, evidence mismatch và RPC failure.
6. Không dùng deployment transaction làm bằng chứng cho bước phát hành credential.

Cho tới khi các điều kiện này có bằng chứng thực tế, CHAIN-02 chưa được đánh dấu PASS.
