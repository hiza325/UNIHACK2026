# PARADOX AI — ZK Proof of Learning Checkpoint (2026-11-04)

> **Trạng thái: FREEZE.** ZK Proof of Learning là tính năng **chưa phát hành**.
> Tài liệu này ghi lại trạng thái đã xác minh để có thể khôi phục và tiếp tục
> phát triển sau này. Không merge, không deploy, không thay đổi database/env.

## 1. Project information

| Item | Value |
|---|---|
| Repository | https://github.com/hiza325/UNIHACK2026 |
| Branch | `feat/zk-integration-foundation` |
| PR | https://github.com/hiza325/UNIHACK2026/pull/10 (OPEN, `mergeable=clean`) |
| HEAD tại checkpoint | `d9238926d23a88cb060db8d85bc018d134287466` |
| Supabase staging | `ekkyygjlshrhibrdmhlx` (eu-central-2, ACTIVE_HEALTHY) |
| Supabase production (protected) | `bwjpnyifsoiwoetxflzf` |
| Migration ZK | `202611050001_zk_proof_of_learning.sql` |
| Migration checksum | `17546442FD6FAEF5F5A9945CBD26BF911707B4C2CB00E0BB0CF652C4FE00841B` |
| Classification | **DEMO / DEVELOPMENT** — chưa production-ready |

## 2. Cách đọc mức độ bằng chứng

| Nhãn | Ý nghĩa |
|---|---|
| **VERIFIED** | Đã xác minh trực tiếp bằng lệnh/đầu ra trong quá trình checkpoint hoặc trong phiên OP2 gần nhất (có output). |
| **REPORTED** | Chỉ được báo cáo bởi agent ở phase trước, chưa chạy lại tại checkpoint. |
| **NOT_RUN** | Chưa được kiểm thử live. |

## 3. Completed

### 3.1 Code / circuit / API

| Item | Trạng thái | Ghi chú |
|---|---|---|
| Circom2 + Groth16 circuit & verification pipeline | **REPORTED** | `zk/`, CI check `Circom + Groth16 tests = success` (VERIFIED qua GitHub API) |
| Ed25519 evaluator attestation | **REPORTED** | `api/zk/_signing.js`, `_keys.js` |
| Backend ZK API (`status`, `proofs`, `generate`, `verify`) | **REPORTED** | `api/zk/*`, routed via `api/learning-records/index.js` |
| Frontend ZK integration | **REPORTED** | `views/zk.js`, `#/zk` |
| Local automated browser tests | **REPORTED** | Full Playwright 498 passed / 12 skipped (commit `d923892`) |
| CI checks tại `d923892` | **VERIFIED** | playwright / lighthouse / Circom+Groth16 / Vercel Preview Comments = success; Supabase Preview = skipped |
| Verification artifacts | **VERIFIED** | `npm run zk:artifacts:check` → OK, DEMO, `vkeySha256=78c792…97ca`, `manifestSha256=6ce082…e42f` |

### 3.2 Staging database

| Item | Trạng thái | Bằng chứng |
|---|---|---|
| Staging identity verified (Vercel Preview → ref staging) | **VERIFIED** | runtime diagnostic: `urlRefClass=STAGING`, `serviceKeyRef=MATCH`, `anonKeyRef=MATCH`, `service_role HTTP 200` |
| `unihack2026` Preview trỏ production | **VERIFIED** | `urlRefClass=PRODUCTION` → bị loại khỏi mọi thao tác staging |
| Staging backup created | **VERIFIED** | schema + data logical dump, checksum ghi ở mục 5 |
| Backup restore rehearsal | **VERIFIED** | restore vào Docker Postgres 17.11 cô lập: 6 tables / 27 indexes / 4 policies / 5 functions / 6 triggers / 74 constraints khớp; row counts khớp |
| Migration ZK applied | **VERIFIED** | `Applying migration 202611050001_zk_proof_of_learning.sql...` → exit 0 |
| `public.zk_proofs` created | **VERIFIED** | 20 columns, 14 CHECK + PK + 2 FK, 5 indexes, 1 trigger, 1 policy |
| RLS enabled + forced | **VERIFIED** | `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` trong DDL staging |
| PostgREST service_role access | **VERIFIED** | `GET /rest/v1/zk_proofs` → **200** (cache đã cập nhật, không PGRST205) |
| Anon access denied | **VERIFIED** | → **401**, PostgreSQL code **42501** |
| OP1 integrity | **VERIFIED** | 6 block DDL bảng OP1 giống hệt trước/sau; row counts `27/31/6/3/13/0` không đổi |
| Production untouched | **VERIFIED** | mọi lệnh DB dùng `--remote=ekkyygjlshrhibrdmhlx`; không query/mutate production |

### 3.3 Chưa kiểm thử live

| Item | Trạng thái |
|---|---|
| Authenticated JWT đọc/ghi `zk_proofs` trên staging | **NOT_RUN** (chỉ xác minh ở tầng quyền: `has_table_privilege=false`, `SET ROLE authenticated` → denied trên bản restore) |
| Live Groth16 proof generation trên staging | **NOT_RUN** |
| Ed25519 DEMO issuance live | **NOT_RUN** |
| OP1 + OP2 live E2E | **NOT_RUN** |

## 4. Database checkpoint

### 4.1 Staging

```
project ref : ekkyygjlshrhibrdmhlx
host        : db.ekkyygjlshrhibrdmhlx.supabase.co
region      : eu-central-2
migration   : 202611050001_zk_proof_of_learning.sql
checksum    : 17546442FD6FAEF5F5A9945CBD26BF911707B4C2CB00E0BB0CF652C4FE00841B
status      : APPLIED (2026-11-04)
history row : 202611050001 (chỉ version này được ghi)
```

Migration được thực thi bằng một workdir tạm **chỉ chứa duy nhất** file migration
đã review (không sửa nội dung), sau khi dry-run chứng minh chỉ 1 migration được
chọn. Không dùng `db push --include-all` trên workdir của repository.

### 4.2 Schema verification (`public.zk_proofs`)

| Item | Kết quả |
|---|---|
| Columns | 20 (id, evaluation_id, learner_id, credential_id_hash, evidence_hash, threshold, circuit_version, vkey_hash, commitment, public_signals, proof, attestation, issuer_key_id, issued_at, status, proof_mode, credential_is_test, revoked_at, created_at, updated_at) |
| CHECK constraints | 14 |
| PK / FK | PK `id`; FK `evaluation_id → learning_evaluations(id) ON DELETE CASCADE`; FK `learner_id → auth.users(id) ON DELETE CASCADE` |
| Indexes | 5: 1 unique partial (`active_eval_threshold_circuit`) + 4 thường |
| Trigger | `zk_proofs_set_updated_at` |
| RLS | ENABLE + FORCE |
| Policy | `zk_proofs_service_role_all` (chỉ `service_role`) |
| Privileges | REVOKE khỏi `public, anon, authenticated`; GRANT ALL cho `service_role` |
| Rows | 0 |
| Sensitive columns | Không có `score`, `nonce`, `witness` |

### 4.3 RLS / privilege tests

| Test | Kết quả |
|---|---|
| Staging DDL: RLS forced + chỉ service_role có quyền | **VERIFIED** |
| Rehearsal DB `SET ROLE anon; SELECT/INSERT zk_proofs` | **denied** |
| Rehearsal DB `SET ROLE authenticated; SELECT/INSERT zk_proofs` | **denied** |
| Rehearsal DB `SET ROLE service_role; SELECT zk_proofs` | **OK** |
| Live PostgREST service_role | **200** |
| Live PostgREST anon | **401 / 42501** |
| Live PostgREST authenticated (JWT thật) | **NOT_RUN** |

### 4.4 PostgREST

- `GET /rest/v1/zk_proofs` với service role → **200** ⇒ schema cache đã có bảng.
- `NOTIFY pgrst, 'reload schema'` **không được chạy trực tiếp** (không có kênh SQL/DB password), nhưng cache đã đúng thực tế.

### 4.5 OP1 integrity

- 6 bảng OP1 (`learning_credentials`, `credential_transactions`, `learning_evaluations`,
  `learning_interactions`, `learning_sessions`, `learning_submissions`) — DDL **không đổi**.
- Row counts trước = sau: `27 / 31 / 6 / 3 / 13 / 0`.
- Functions/policies/triggers ngoài ZK không đổi.

### 4.6 Known migration drift

Các version sau **chưa được ghi** vào `supabase_migrations.schema_migrations`
(schema đã có từ trước, được áp dụng ngoài CLI):

```
202610280001
202610280002
202610290001
202611010001
202611020001
202611020002
202611040001
```

Ngoài ra `public.admin_audit_log` (thuộc `202611010001`) **chưa tồn tại** trên staging.

> Không chạy `supabase db push --include-all` từ workdir repository: CLI sẽ cố
> apply lại 7 migration đã có schema. Không tự sửa migration history.

## 5. Backup

| File | Size | SHA-256 |
|---|---|---|
| `staging-public-schema.sql` | 32,858 B | `C1DC83606BE0496AB338CF153D30FEA16A60C9FE1320FB487C3296893E0DB4F6` |
| `staging-public-data.sql` | 61,746 B | `67C2AD3101AC30F7B4F36978A26A8B72371E3D469FF2D83036BC2600FBEDECCC` |

- Vị trí hiện tại: `%TEMP%\opencode\paradox-zk-backups\staging-20261104-153959\`
- Nội dung: schema `public` + data (5 bảng có dữ liệu, `credential_transactions` rỗng).
- **Chứa dữ liệu staging** (có thể có thông tin cá nhân) → không commit, không upload,
  không đưa vào log. Cần chuyển vào vault riêng tư được phê duyệt hoặc xoá khi không
  còn nhu cầu rollback.
- Restore rehearsal: **PASS** (xem 3.2). Không restore đè staging/production.
- Rollback (chỉ sau phê duyệt riêng):
  `drop policy if exists zk_proofs_service_role_all on public.zk_proofs; drop table if exists public.zk_proofs;`

## 6. Current blockers

1. 7 OP1 migration versions chưa đồng bộ vào migration history (xem 4.6).
2. `admin_audit_log` chưa tồn tại trên staging.
3. Live authenticated JWT test chưa chạy.
4. `ZK_*` Preview environment chưa cấu hình.
5. DEMO issuer signing key chưa tạo.
6. Live Groth16 proof generation chưa chạy trên staging.
7. OP1 + OP2 live E2E chưa hoàn thành.
8. PR #10 chưa merge.

## 7. Trạng thái phát hành

- ZK hiện tại là **DEMO / DEVELOPMENT**.
- Development trusted setup ⇒ **không thể OFFICIAL**.
- Không có production deploy, không có blockchain transaction, không có Vercel env change.
- ZK chưa được đưa vào production UI. `main` không được sửa cho ZK.

## 8. Freeze rules

- Không merge PR #10.
- Không deploy production.
- Không thay đổi database staging/production.
- Không thay đổi Vercel env.
- Không tạo persistent signing key.
- Không chạy `db push --include-all` trên repo.
- Không xoá backup.
