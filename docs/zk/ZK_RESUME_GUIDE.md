# PARADOX AI — ZK Resume Guide (sau checkpoint 2026-11-04)

> Hướng dẫn khôi phục và tiếp tục OP2 ZK Proof of Learning.
> Đọc kèm: [`ZK_CHECKPOINT_2026-11-04.md`](./ZK_CHECKPOINT_2026-11-04.md).
> **Không chứa secrets.** Không merge, không deploy production.

## 1. Git: branch và commit cần checkout

```bash
git fetch origin
git switch feat/zk-integration-foundation
git pull --ff-only
git log --oneline -3
```

- Base code ZK: `d9238926d23a88cb060db8d85bc018d134287466`
- Checkpoint docs: commit ngay sau `d923892` (xem PR #10).
- Remote: `https://github.com/hiza325/UNIHACK2026.git`
- Nếu working tree không sạch: kiểm tra từng file trước khi làm gì tiếp. Không `reset --hard`, không `stash drop`.

## 2. PR #10

- https://github.com/hiza325/UNIHACK2026/pull/10
- Base: `main` — **giữ OPEN**, không merge cho đến khi hoàn tất mục 11.

## 3. Database staging hiện tại

| Item | Value |
|---|---|
| Project ref | `ekkyygjlshrhibrdmhlx` |
| Host | `db.ekkyygjlshrhibrdmhlx.supabase.co` |
| Trạng thái | ACTIVE_HEALTHY, eu-central-2 |
| `public.zk_proofs` | Đã tồn tại (0 rows) |
| RLS | ENABLE + FORCE |
| Quyền | Chỉ `service_role`; `anon`/`authenticated` bị từ chối |
| Production | `bwjpnyifsoiwoetxflzf` — **cấm mọi thao tác** |

## 4. Migration ZK đã được áp dụng

```
202611050001_zk_proof_of_learning.sql
checksum: 17546442FD6FAEF5F5A9945CBD26BF911707B4C2CB00E0BB0CF652C4FE00841B
status  : APPLIED trên staging (2026-11-04)
```

**Không chạy lại migration này.** Nếu cần xác nhận trạng thái, chỉ dùng lệnh read-only:

```bash
npx supabase migration list --remote=ekkyygjlshrhibrdmhlx --workdir .
npx supabase db dump --remote=ekkyygjlshrhibrdmhlx --schema public -f /tmp/staging-schema.sql
```

## 5. Migration history còn thiếu

Chỉ `202611050001` được ghi trong `supabase_migrations.schema_migrations`.
Các version sau có schema trên staging nhưng **chưa được ghi**:

```
202610280001
202610280002
202610290001
202611010001   ← admin_audit_log chưa tồn tại
202611020001
202611020002
202611040001
```

Quy tắc:

- **Không** chạy `supabase db push` / `db push --include-all` từ workdir repository.
- **Không** tự `migration repair` / re-baseline khi chưa có phê duyệt.
- Nếu cần apply migration mới: dùng workdir tạm chỉ chứa đúng file migration đó, dry-run trước, xác nhận chỉ 1 migration được chọn.
- `admin_audit_log` là quyết định riêng (ngoài phạm vi ZK), cần approval.

## 6. Biến môi trường cần cấu hình (Preview-only, `paradox-ai-staging`)

Chỉ áp dụng cho project Vercel `paradox-ai-staging` (`prj_7zV05yXHekJ4ryhlbxVI8rIjzLK9`).
**Không** cấu hình cho `unihack2026` (project này trỏ Supabase production).

| Variable | Format | Scope | Sensitive |
|---|---|---|---|
| `ZK_PREVIEW_DEMO` | chuỗi `1` | Preview | Không |
| `ZK_TRUSTED_SETUP_MODE` | `development` | Preview | Không |
| `ZK_CIRCUIT_VERSION` | `1.0.0` | Preview | Không |
| `ZK_VKEY_SHA256` | 64 hex thường | Preview | Không |
| `ZK_MANIFEST_SHA256` | 64 hex thường | Preview | Không |
| `ZK_TRUSTED_ISSUERS_JSON` | JSON array public key Ed25519 | Preview | Không |
| `ZK_DEMO_ISSUER_KEY_ID` | chuỗi ổn định ≤100 ký tự | Preview | Không |
| `ZK_EVALUATOR_PRIVATE_KEY` | Ed25519 PKCS8 PEM | Preview | **Có** |

- Giá trị public pins đọc từ `zk/verification-artifacts.lock.json` (không chép tay từ tài liệu này).
- **Không** đặt `ZK_PRODUCTION_VKEY_SHA256` trên Preview.
- **Không** đặt `ZK_ALLOW_DEVELOPMENT_SETUP` trên Vercel Preview.
- Không ghi giá trị key vào repo, tài liệu, log hoặc PR.

### Format `ZK_TRUSTED_ISSUERS_JSON`

```json
[
  {
    "keyId": "paradox-zk-demo-issuer",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
    "status": "active",
    "environment": "demo"
  }
]
```

Chỉ public key. `status`: `active | retired | revoked`. `environment`: `demo | production`.
Optional: `notBefore`, `notAfter`.

## 7. DEMO issuer key requirements

1. Cặp khoá **Ed25519**, tạo offline trên máy được phê duyệt.
2. Private key: PKCS8 PEM, lưu trong Vercel Sensitive env (Preview) hoặc KMS/HSM; backup trong vault.
3. Public key (SPKI PEM) đưa vào `ZK_TRUSTED_ISSUERS_JSON`.
4. `keyId` ổn định: `paradox-zk-demo-issuer`.
5. Không commit private key; không đưa vào log/PR.
6. Không rotate trong lúc E2E. Rotation cần thêm key mới và giữ key cũ theo policy.
7. Lưu ý: verifier hiện chỉ resolve key `active`; verify proof lịch sử sau revoke/retire chưa được hỗ trợ đầy đủ.
8. Development trusted setup chỉ tạo **DEMO** — không thể OFFICIAL.

## 8. Lệnh kiểm thử an toàn (không ghi DB)

```bash
# Artifacts
npm run zk:artifacts:check

# Browser tests cho ZK UI (mock API, không cần DB)
npx playwright test tests/zk-frontend.spec.js

# Guard + preflight (unit)
npx playwright test tests/zk-staging-isolation.spec.js
npx playwright test tests/zk-staging-preflight.spec.js

# ZK API contracts
npx playwright test tests/zk-verification-api.spec.js
npx playwright test tests/zk-verification-artifacts.spec.js

# Full regression
npm test

# Read-only staging checks (cần credential staging trong shell approved)
npm run zk:staging:preflight
```

Quy tắc: mọi lệnh có `--remote` phải chỉ rõ `ekkyygjlshrhibrdmhlx`.
Nếu output nhắc `bwjpnyifsoiwoetxflzf` → dừng ngay.

## 9. Live E2E cần hoàn thành

Điều kiện tiên quyết: Preview `ZK_*` đã cấu hình, DEMO key `active`, `/api/zk/status` trả `200` với `setupMode=development`.

1. Đăng nhập learner staging được chỉ định (không tạo learner mới nếu chưa được duyệt).
2. `GET /api/learning-records?view=evaluations` → chỉ evaluation của chính learner.
3. Evaluation đủ điều kiện: `status=pass`, `score>=80`, `credential_eligible=true`, hash khớp credential test.
4. `POST /api/zk/generate` → `200`, `status=generated`, `classification=DEMO`, có `proofId`.
5. `POST /api/zk/verify` → `valid=true`, `reason=OK`, `classification=DEMO`, `checks.attestation=true`.
6. `GET /api/zk/proofs/:proofId` → chỉ public projection (không `score/nonce/witness/learner_id/evaluation_id`).
7. Kiểm tra Fuji read-only với `PXP-TEST-CPP-004` (chainId 43113, registry, exists/valid/not revoked, evidence hash).
8. Learner thấy điểm thật của mình; session thứ hai (ngoài) không thấy điểm/proof của learner thứ nhất.
9. Negative cases: revoked, invalid/tampered, replay — chỉ dùng dữ liệu test cô lập được duyệt.
10. OP1 regression sau khi bật ZK.

Không dùng simulated AI score để tuyên bố năng lực thực tế; ghi rõ fixture nếu có.

## 10. Đồng bộ nhánh ZK với website mới trước khi merge

```bash
git fetch origin
git switch feat/zk-integration-foundation
git merge origin/main        # hoặc rebase theo quy ước team
# giải quyết xung đột, đặc biệt: views/zk.js, app.js/app-*.js, vercel.json, router
npm run zk:artifacts:check
npx playwright test tests/zk-frontend.spec.js
npm test
```

Yêu cầu:

- Review xung đột frontend (view ZK, routing, nav, i18n, CSS).
- Không sửa `main` để chứa ZK.
- Không thêm entry ZK vào production UI.
- Không thay đổi API OP1.
- Chỉ kích hoạt ZK sau khi live E2E PASS.

## 11. Điều kiện bắt buộc trước khi merge PR #10

1. Staging identity verified (Vercel Preview → `ekkyygjlshrhibrdmhlx`).
2. `public.zk_proofs` + RLS/privilege smoke PASS.
3. Preview `ZK_*` cấu hình đúng, `/api/zk/status` → `200`, DEMO.
4. DEMO issuer key `active`, verify Ed25519 PASS.
5. Live DEMO generate + verify PASS.
6. Public API privacy PASS (không lộ score/nonce/witness).
7. Fuji read-only binding PASS.
8. OP1 regression PASS.
9. Branch đã sync với `main`, full test suite + CI green.
10. Migration history/drift có quyết định rõ ràng.
11. Approval merge riêng.

## 12. Thao tác bị cấm trên Production

- Không query/mutate `bwjpnyifsoiwoetxflzf` bằng credential ghi.
- Không apply migration, không reset, không sửa schema/data production.
- Không trỏ env/Vercel Preview của `unihack2026` sang staging hoặc ngược lại.
- Không deploy production, không merge khi chưa đủ điều kiện.
- Không gửi blockchain transaction.
- Không commit secret/private key/backup chứa dữ liệu người dùng.

## Khôi phục checkpoint

- Code: checkout commit checkpoint trên `feat/zk-integration-foundation`.
- DB: `zk_proofs` đã tồn tại — **không chạy lại migration**.
- Backup rollback (chỉ sau approval):
  `%TEMP%\opencode\paradox-zk-backups\staging-20261104-153959\`
  (schema SHA-256 `C1DC8360…DB4F6`, data SHA-256 `67C2AD31…BECCC`).
- Backup chứa dữ liệu staging → giữ riêng tư, không commit/upload.
