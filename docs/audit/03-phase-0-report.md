# PARADOX AI — Báo cáo Giai đoạn 0

**Ngày hoàn tất:** 2026-10-28  
**Commit kiểm kê:** `e6d126c`  
**Kết luận ngắn:** nền tảng web/auth/AI orchestration có staging tách biệt, schema và AUTH E2E đã đạt; hệ thống vẫn chưa sẵn sàng chuyển sang tích hợp Avalanche thực tế vì chưa có Fuji deployment, live AI chưa được kiểm chứng và dependency High chưa xử lý.

## 1. Những gì đã hoàn thành

- Kiểm kê 13 màn hình/hash route, module frontend và toàn bộ API.
- Xác định backend thực tế là Vercel Node.js Serverless, không phải một server framework riêng.
- Xác định AI provider trong code là AnyRouter, không phải Gemini.
- Xác minh Supabase Auth/REST được cấu hình local và cả 6 bảng migration tồn tại bằng request read-only.
- Rà soát migration, RLS, ownership filter và service-role boundaries.
- Rà soát contract, ABI, chain guard, transaction lifecycle và deploy script.
- Chạy 65 test web/API: tất cả pass.
- Chạy 8 test Solidity: tất cả pass.
- Chạy dependency audit và phát hiện 3 High advisory trong toolchain Hardhat/Zod.
- Kiểm tra production read-only: static app hoạt động; protected APIs từ chối request không session.
- Kiểm tra Git/env secret hygiene mà không in giá trị secret.
- Bổ sung sơ đồ thành phần/trust boundary và ma trận phân biệt dữ liệu thật, local và mock.
- Xác minh clean setup qua GitHub Actions run `40687693284` của đúng commit audit: `npm ci`, Solidity test và Playwright đều thành công.

## 2. Những gì chưa hoàn thành/không được kiểm chứng

- Vercel/Supabase staging, schema và acceptance accounts đã có; live AI staging chưa được kiểm chứng.
- Student A, Student B và Admin đã được provision trên Supabase staging; login, confirmation và role đúng. Cross-user/admin web E2E chưa chạy.
- Clean setup đã được CI runner xác minh; chưa kiểm thử live external services trong CI do không cấp production secrets.
- Không gọi live AnyRouter vì local thiếu key và audit không tiêu tốn production service.
- Không gửi OTP/email thật trong audit.
- Không ghi/read E2E learning records trên staging.
- Không có contract Fuji deployment, address, bytecode hoặc transaction thật.
- Không kiểm tra balance/issuer authorization bằng RPC vì không có cấu hình chain thực tế.
- Không deploy contract và không thay đổi dữ liệu/schema production. Hai migration và một session ownership test chỉ chạy trên staging sau approval.

## 3. Lỗi nghiêm trọng và rủi ro chính

### Critical

- **Avalanche integration chưa tồn tại trên mạng:** hiện chỉ có code, artifact và mock/unit tests. Tiêu chí Avalanche Integration 25 điểm chưa có bằng chứng on-chain.

### High

- **AUTH-01 pass:** role/admin guard, cross-user API ownership và RLS isolation đều đạt trên staging.
- **AI quota abuse:** public AI endpoints và limiter không dùng shared store.
- **Dependency security:** Hardhat/Zod chain có 3 advisory High.
- **Authorization config drift:** admin allowlist cụ thể hardcode ở source và environment.

### Medium

- File upload chưa triển khai thực sự.
- CSRF chủ yếu dựa SameSite cookie.
- CI thiếu lint/type-check/migration drift check.
- GitHub Pages và Vercel cung cấp hai phiên bản có khả năng khác nhau.
- Private-key operations chưa có KMS/rotation/runbook.

## 4. Đánh giá vòng loại

### Technical Implementation — mức hiện tại

**Đánh giá: Khá nhưng chưa production-ready.**

Điểm mạnh:

- UI đa route, responsive/accessibility test tốt.
- Auth/OTP/session/admin có server-side authorization.
- AI output validation, rubric và Proof of Learning off-chain có chiều sâu.
- Learning Records có schema, RLS và ownership defense-in-depth.
- 65 tests pass.

Điểm trừ:

- Live AI chưa được xác minh trong staging.
- Một số chức năng vẫn mock/local-only.
- Public AI abuse controls chưa đủ.
- Acceptance fixtures đã có; cross-user data test còn thiếu.
- Không có lint/type-check/security headers đầy đủ.

### Avalanche Integration — mức hiện tại

**Đánh giá: Có implementation code tốt, nhưng bằng chứng tích hợp thực tế bằng 0.**

Điểm mạnh:

- Contract có access control, duplicate prevention, revoke và ownership transfer.
- Fuji-only chain guard, ABI, receipt/error handling và persistence logic rõ ràng.
- 8 Solidity tests pass; service tests bao phủ issue/revoke/verify/retry.

Blocker:

- Không deployment address.
- Không bytecode check.
- Không issuer authorization check trên Fuji.
- Không transaction/Explorer proof.
- Passport hiện có thể rơi về mock.

## 5. Danh sách ưu tiên trước Giai đoạn 1

### P0 — bắt buộc

1. Cấu hình AnyRouter staging key quota thấp và chạy live AI E2E.
2. Tạo fixtures staging: Student A, Student B, Admin; kiểm tra cross-user access và role.
3. Cấu hình AnyRouter staging key quota thấp; chạy smoke/E2E AI thật.
4. Xử lý advisory Hardhat/Zod bằng phiên bản đã vá sau khi kiểm tra compatibility.
5. Quyết định và tài liệu hóa một production origin; tránh quảng bá static GitHub Pages như app đầy đủ.

### P1 — Avalanche readiness

1. Review contract độc lập, thêm coverage/fuzz cases và threat model.
2. Chuẩn bị ví Fuji riêng, secret storage/rotation và faucet balance; không dùng ví cá nhân/mainnet.
3. Deploy contract Fuji chỉ sau approval riêng.
4. Ghi deployment manifest, contract address, tx hash, chain ID và owner/issuer.
5. Read-only verify `eth_chainId`, `eth_getCode`, ABI calls và Explorer transaction.
6. Chạy E2E issue -> receipt -> DB confirmed -> verify -> revoke bằng credential test có nhãn.

### P1 — security/reliability

1. Yêu cầu auth cho Debate/Support hoặc áp quota/API gateway phù hợp.
2. Chuyển rate limit sang shared store.
3. Loại bỏ hardcoded admin identities; chỉ dùng `app_metadata`/controlled provisioning.
4. Thêm Origin/CSRF defense, security response headers và request-size limits.
5. Hoặc triển khai upload an toàn bằng Supabase Storage + MIME/size/scan/RLS, hoặc bỏ tuyên bố upload khỏi UI.
6. Thêm migration drift check, lint/type-check và clean-install CI acceptance.

### P2 — sản phẩm

1. Đồng bộ profile/settings/practice nếu cần đa thiết bị.
2. Thêm public read-only credential verification nếu phù hợp use case.
3. Tách rõ nhãn mock/real trên mọi dashboard/passport state.
4. Thêm backup/retention policy cho cascade delete từ Auth.

## 6. Điều kiện chuyển sang Giai đoạn 1

Chỉ chuyển khi đạt tối thiểu:

- [x] ENV-01 PASS: Vercel và Supabase staging tách khỏi production.
- [x] AUTH-01 PASS với Student A, Student B, Admin và cross-user isolation.
- [x] SETUP-01 PASS trên checkout sạch bằng lockfile và workflow tương ứng README.
- [ ] AnyRouter live smoke test pass trên staging, không dùng mock.
- [ ] Dependency High advisory được xử lý hoặc có risk acceptance có thời hạn.
- [ ] Contract review/test plan được phê duyệt.
- [ ] Có change approval riêng trước mọi Fuji deploy/transaction.

Để đạt CHAIN-01 sau đó cần contract Fuji có bytecode, chain ID 43113, ABI read calls tương thích và ít nhất một transaction test được xác minh read-only từ receipt/Explorer.

## 7. Trạng thái nghiệm thu Giai đoạn 0

| Tiêu chí | Trạng thái |
|---|---|
| SETUP-01 | PASS |
| ENV-01 | PASS |
| AUTH-01 | PASS |
| CHAIN-01 | FAIL |

**Quyết định:** chưa đủ điều kiện chuyển sang Giai đoạn 1. Có thể tiếp tục sau khi hoàn thành P0 và có staging an toàn; Avalanche deployment phải là hoạt động riêng có phê duyệt, không nằm trong Giai đoạn 0.
