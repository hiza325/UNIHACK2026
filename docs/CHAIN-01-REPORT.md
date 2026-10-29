# PARADOX AI — CHAIN-01 Verification Report

**Cập nhật:** 2026-10-29

**Trạng thái CHAIN-01:** **PASS**

> Báo cáo này thay thế snapshot `BLOCKED` ngày 2026-10-28. Các kiểm tra cập nhật chỉ đọc RPC công khai; không ký, phát hành credential, deploy lại hoặc gửi giao dịch.

## 1. Deployment đã xác minh

| Thuộc tính | Giá trị |
|---|---|
| Contract | `LearningCredentialRegistry` |
| Network | Avalanche Fuji Testnet / C-Chain |
| Chain ID | `43113` (`0xa869`) |
| Contract address | `0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b` |
| Deployment transaction | `0x45c55865fb43bf28a1972597ce4ecedf9d769876344034a9447cd75a6de2d56f` |
| Block | `60163894` |
| Receipt status | `1` — success |
| Deployer / owner | `0x35d1dc8183326f3CBc631ED04094765052B365cD` |
| Deployed at | `2026-10-28T19:10:21.000Z` |

- [Contract trên Fuji Explorer](https://explorer-test.avax.network/c-chain/address/0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b)
- [Deployment transaction trên Fuji Explorer](https://explorer-test.avax.network/c-chain/tx/0x45c55865fb43bf28a1972597ce4ecedf9d769876344034a9447cd75a6de2d56f)

Explorer là Fuji Testnet Explorer, không phải Avalanche Mainnet.

## 2. Bằng chứng read-only

RPC:

```text
https://api.avax-test.network/ext/bc/C/rpc
```

Kết quả kiểm tra ngày 2026-10-29:

| Kiểm tra | Kết quả |
|---|---|
| `eth_chainId` | `43113` — PASS |
| `eth_getCode` | Có runtime bytecode, `2322` bytes — PASS |
| Runtime bytecode hash | `0x23f60c83fb818b19f0dec2fc489db30bb84c611819da7e9a31676c41c31a6710` |
| Artifact runtime bytecode hash | `0x23f60c83fb818b19f0dec2fc489db30bb84c611819da7e9a31676c41c31a6710` |
| Bytecode match | PASS |
| Receipt contract address | Khớp address cấu hình — PASS |
| `owner()` | `0x35d1dc8183326f3CBc631ED04094765052B365cD` |
| `pendingOwner()` | Zero address |
| `authorizedIssuers(owner)` | `true` — PASS |

Manifest công khai đã được ghi tại `deployments/avalanche-fuji.json`. Metadata dùng chung nằm tại `avalanche-config.js`.

## 3. Compile và unit tests

| Lệnh | Kết quả |
|---|---|
| `npm run contract:build` | PASS — không có thay đổi contract cần compile lại |
| `npm run contract:test` | PASS — `8/8` |
| `npm run contract:verify:fuji` | PASS — chain, receipt, bytecode và ABI reads |

ABI/runtime vẫn lấy từ `artifacts/contracts/LearningCredentialRegistry.sol/LearningCredentialRegistry.json`. Không thay đổi Solidity contract hoặc `hardhat.config.ts` trong giai đoạn UI này.

## 4. Ranh giới bằng chứng

Deployment thành công **không** chứng minh mọi Certificate đã được phát hành.

Một credential chỉ được giao diện báo **Verified on Avalanche** khi đồng thời có:

1. Bản ghi credential cụ thể.
2. Network `avalanche-fuji`, Chain ID `43113` và đúng contract address.
3. On-chain credential tồn tại.
4. Evidence hash khớp dữ liệu đã lưu.
5. Credential chưa bị revoke và `isCredentialValid` trả `true`.
6. Kết quả kiểm tra đến từ Avalanche, có transaction hash phát hành đúng định dạng.

Các mã Demo không phải credential thật. Lỗi RPC không được chuyển thành “không tồn tại” hoặc “đã xác minh”.

## 5. An toàn vận hành

- Mainnet `43114` vẫn bị chain guard từ chối.
- API dùng address deployment cố định; environment trỏ sang address khác sẽ bị từ chối.
- Issuer private key không nằm trong cấu hình dùng chung hoặc manifest.
- Deployment script từ chối ghi đè manifest hiện có nếu không có override tường minh.
- Verify UI là read-only; không kết nối ví, ký hoặc gửi transaction.

## 6. Kết luận

**CHAIN-01: PASS** cho deployment registry và bằng chứng read-only.

Điều này cho phép chuyển sang đánh giá **CHAIN-02** ở mức tích hợp credential. CHAIN-02 vẫn cần kiểm thử end-to-end với một credential được phát hành hợp lệ; không được dùng deployment transaction thay thế issuance evidence.
