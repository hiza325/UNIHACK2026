# PARADOX AI — CHAIN-01 Verification Report

**Ngày kiểm tra:** 2026-10-28
**Commit nền được kiểm tra:** `9bb07e1`
**Trạng thái CHAIN-01:** **BLOCKED**

> `BLOCKED` được dùng đúng theo tiêu chí nghiệm thu: RPC Fuji hoạt động nhưng repository và environment hiện không có contract address thật để thực hiện `eth_getCode`. Compile/test thành công không được xem là bằng chứng triển khai on-chain.

## 1. Network và Chain ID thực tế

| Thuộc tính | Kết quả |
|---|---|
| Network mục tiêu | Avalanche Fuji C-Chain |
| Chain ID yêu cầu | `43113` |
| Chain ID RPC trả về | `43113` (`0xa869`) |
| Kết luận network | PASS — không kết nối nhầm mạng |
| RPC client quan sát được | AvalancheGo `1.15.2` |
| Block mới nhất tại thời điểm kiểm tra | `60158636` |

## 2. RPC được sử dụng

```text
https://api.avax-test.network/ext/bc/C/rpc
```

Các JSON-RPC call read-only đã thực hiện:

- `eth_chainId`: thành công, trả `0xa869`.
- `eth_blockNumber`: thành công.
- `web3_clientVersion`: thành công.
- `eth_getCode`: **chưa thể thực hiện**, vì không có địa chỉ contract được cấu hình.

RPC không phát sinh giao dịch, không ký dữ liệu và không thay đổi trạng thái chain.

## 3. Smart Contract

| Thuộc tính | Kết quả |
|---|---|
| Contract name | `LearningCredentialRegistry` |
| Source | `contracts/LearningCredentialRegistry.sol` |
| Solidity | `0.8.28` |
| EVM target | `paris` |
| Optimizer | Bật, 200 runs |
| Deployment bytecode | 2,494 bytes |
| Runtime bytecode artifact | 2,322 bytes |
| Runtime bytecode hash artifact | `0x23f60c83fb818b19f0dec2fc489db30bb84c611819da7e9a31676c41c31a6710` |

Contract lưu credential/evidence hash, issuer, timestamp và trạng thái revoke; không lưu bài làm hoặc PII. Deployer trở thành `owner` và issuer được ủy quyền. Ownership transfer là quy trình hai bước.

## 4. Contract address và `eth_getCode`

| Kiểm tra | Kết quả |
|---|---|
| `AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS` trong `.env` | Không có |
| `AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS` trong `.env.staging` | Không có |
| `deployments/avalanche-fuji.json` | Không tồn tại |
| Contract address xác minh được | **Không có** |
| Kết quả `eth_getCode` | **NOT_EXECUTED — thiếu address** |
| Bytecode trên Fuji | **Chưa thể kết luận** |

Không tự tạo địa chỉ hoặc transaction hash giả. Vì thiếu address nên trạng thái là `BLOCKED`, không phải `FAIL`. `FAIL` chỉ phù hợp khi có một địa chỉ cấu hình hợp lệ và Fuji RPC trả `0x` cho `eth_getCode` tại địa chỉ đó.

## 5. Deployment transaction

| Thuộc tính | Kết quả |
|---|---|
| Deployment transaction hash | Không có |
| Receipt | Không có |
| Block number triển khai | Không có |
| Deployer/owner on-chain | Chưa có |
| Fuji Explorer transaction link | Không có |
| Fuji Explorer address link | Không có |

Không có transaction nào được gửi trong lần kiểm tra này.

## 6. Compile

**Kết quả: PASS**

Lệnh:

```text
npx hardhat build --force
```

Bằng chứng:

```text
Compiled 2 Solidity files with solc 0.8.28 (evm target: paris)
```

Artifact được tạo tại `artifacts/contracts/LearningCredentialRegistry.sol/LearningCredentialRegistry.json`. ABI artifact có 29 entries. ABI tối thiểu trong `api/credentials/_avalanche.js` gồm 7 function và cả 7 đều khớp artifact.

## 7. Unit tests

**Kết quả: PASS — 8 PASS / 0 FAIL**

Lệnh:

```text
npm run contract:test
```

Phạm vi được test:

- Deployer là owner và authorized issuer.
- Owner thêm/xóa issuer.
- Issuer phát hành và xác minh credential.
- Issuer revoke credential.
- Chặn account không được ủy quyền.
- Chặn duplicate credential/evidence.
- Chặn hash rỗng, credential không tồn tại và revoke lần hai.
- Two-step ownership transfer và owner luôn giữ issuer authorization.

## 8. Dependencies và cấu hình

| Thành phần | Phiên bản/trạng thái |
|---|---|
| Node.js | `v24.18.0` (project yêu cầu `>=22.12`) |
| npm | `11.16.0` |
| Hardhat | `3.21.1` |
| ethers | `6.17.0` |
| Hardhat config | `hardhat.config.ts` |
| Fuji chain guard runtime | Bắt buộc `43113` trong `api/credentials/_avalanche.js` |
| Fuji chain guard deploy | Bắt buộc `43113` trong deployment script |

Không cần cài dependency mới.

## 9. Deployment readiness

Script hiện có: `scripts/deploy-learning-credential-registry.mjs`.

Script đã có sẵn các kiểm tra:

- RPC và chain ID phải là Fuji `43113`.
- Private key phải là 32-byte non-zero key.
- Ví phải có Fuji AVAX.
- Chờ receipt thành công.
- Kiểm tra deployer được authorized issuer.
- Ghi manifest gồm address, transaction hash, chain ID và block number.

Trong lần chuẩn bị CHAIN-01 này, script được gia cố thêm nhưng **không được chạy deploy**:

- Hỗ trợ file secret riêng qua `AVALANCHE_ENV_FILE`.
- Chặn ghi đè manifest/deploy lại ngoài ý muốn, trừ khi đặt rõ `AVALANCHE_ALLOW_REDEPLOY=1`.
- Có preflight read-only (`npm run contract:preflight:fuji`) để kiểm tra RPC, signer, balance, constructor và gas mà không ký/gửi transaction.
- Yêu cầu xác nhận broadcast tường minh qua `AVALANCHE_DEPLOY_CONFIRM`.
- Dùng RPC timeout 20 giây và receipt timeout 10 phút.
- Ghi pending journal ngay sau broadcast để chặn deploy trùng và hỗ trợ phục hồi nếu timeout.
- Xác minh `eth_getCode` sau receipt.
- So khớp runtime bytecode hash với artifact.
- Xác minh owner và issuer authorization trước khi ghi manifest.
- Ghi explorer URLs và bytecode hashes vào manifest.

Đã thêm script read-only:

```text
npm run contract:verify:fuji
```

Script lấy address từ environment, manifest hoặc receipt của pending transaction; kiểm tra chain ID, `eth_getCode`, runtime bytecode hash, ABI reads (`owner`, `pendingOwner`, `authorizedIssuers`) và deployment receipt nếu có. Chạy ở trạng thái hiện tại trả đúng:

```json
{
  "status": "BLOCKED",
  "message": "AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS is missing or invalid",
  "chainId": 43113,
  "rpcReachable": true
}
```

## 10. Lỗi và điều kiện còn thiếu

1. Chưa có dedicated Fuji deployment.
2. Chưa có contract address để gọi `eth_getCode`.
3. Chưa có deployment manifest/transaction receipt.
4. Chưa có dedicated Fuji issuer wallet được cấu hình trong environment an toàn.
5. Chưa có Fuji AVAX balance được xác minh cho issuer wallet.
6. Chưa thể kiểm tra owner/issuer authorization on-chain.
7. Chưa có explorer evidence.

## 11. Bước tiếp theo cần người dùng thực hiện

1. Tạo **ví testnet riêng** chỉ dùng cho Fuji; không tái sử dụng ví Mainnet hoặc ví cá nhân.
2. Lưu private key ngoài Git, ví dụ trong `.env.avalanche-fuji` đã được `.gitignore` bao phủ. Không gửi private key vào chat.
3. Cấu hình cục bộ:

   ```text
   AVALANCHE_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
   AVALANCHE_ISSUER_PRIVATE_KEY=<FUJI-ONLY-SECRET>
   ```

4. Gửi **public wallet address** tới Fuji faucet và nạp đủ test AVAX cho gas.
5. Xác nhận rõ ràng trước khi chạy deployment transaction.
6. Sau deploy thành công, dùng address từ manifest để cấu hình `AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS`, rồi chạy `npm run contract:verify:fuji`.
7. Chỉ nâng CHAIN-01 thành PASS khi verifier xác nhận chain `43113`, bytecode thật, artifact match và ABI reads thành công.

Hướng dẫn thao tác đầy đủ: `docs/CHAIN-01-DEPLOYMENT-GUIDE.md`.

## 12. Kết luận

**CHAIN-01: BLOCKED**

- RPC Fuji: PASS.
- Chain ID: PASS (`43113`).
- Compile: PASS.
- Solidity tests: PASS (`8/8`).
- ABI compatibility: PASS ở mức artifact/code.
- Contract address: thiếu.
- `eth_getCode`: chưa thể chạy.
- Fuji deployment evidence: thiếu.

Đã dừng ở bước chuẩn bị theo yêu cầu. Không deploy, không ký, không gửi transaction và không yêu cầu private key qua chat.
