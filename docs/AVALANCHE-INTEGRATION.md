# PARADOX AI — Avalanche Fuji Integration Guide

**Network:** Avalanche Fuji Testnet (C-Chain) — Chain ID `43113` (`0xa869`)
**Contract:** `LearningCredentialRegistry` at `0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b`
**Explorer:** https://explorer-test.avax.network/c-chain
**RPC (primary):** https://api.avax-test.network/ext/bc/C/rpc

> This document is a read-only verification guide. It does not contain secrets, private keys, or deployment instructions.

## 1. Independent Verification Steps

Anyone can verify a PARADOX credential on-chain without trusting the backend:

1. **Get the credential code** (e.g. `PXP-2026-17C5080B-0026`) from the certificate or verify page.
2. **Compute the credential ID hash:**
   `credentialId = keccak256("paradox-learning-credential:" + code)` (Solidity `keccak256` / ethers `id()`).
3. **Compute the evidence hash:** SHA-256 of the evaluation proof content, prefixed with `0x`.
4. **Call the contract (read-only):**
   - `credentialExists(credentialId)` → must be `true`.
   - `getCredential(credentialId)` → returns `(evidenceHash, issuer, issuedAt, revokedAt)`.
     - `evidenceHash` must equal the computed evidence hash.
     - `issuer` must be an authorized issuer.
     - `issuedAt` > 0.
     - `revokedAt` == 0 for a valid credential.
   - `isCredentialValid(credentialId)` → must be `true`.
5. **Check the transaction:**
   - The `issueTransactionHash` (66-char hex) must be a real transaction on Fuji.
   - `eth_getTransactionByHash(hash)` → `chainId` == 43113, `to` == contract address, `value` == 0, `data` == `encodeFunctionData("issueCredential", [credentialId, evidenceHash])`.
   - `eth_getTransactionReceipt(hash)` → `status` == 1 (success).
6. **Check revocation:** `getCredential(credentialId).revokedAt > 0` → revoked.

## 2. On-chain vs Backend Data

| Field | Source of truth | Backend provides |
|---|---|---|
| `credentialId` (bytes32) | On-chain (`credentialExists`) | Computed from code |
| `evidenceHash` (bytes32) | On-chain (`getCredential`) | SHA-256 of proof |
| `issuer` (address) | On-chain (`getCredential`) | `issuer_address` column |
| `issuedAt` (uint64) | On-chain (`getCredential`) | `issued_at` column |
| `revokedAt` (uint64) | On-chain (`getCredential`) | `revoked_at` column |
| `valid` (bool) | On-chain (`isCredentialValid`) | `onchain_valid` column |
| `issueTransactionHash` | On-chain tx (explorer) | `issue_tx_hash` column |

The backend **never** fabricates on-chain data. It reads from the contract and caches in Supabase for performance. The frontend's `hasActualAvalancheVerification()` requires the issue hash to match the transaction hash, preventing "verified" status based on hash alone.

## 3. RPC Configuration

Primary RPC: `https://api.avax-test.network/ext/bc/C/rpc`
Fallback RPCs: set `AVALANCHE_FUJI_RPC_URLS` (comma-separated) in addition to `AVALANCHE_FUJI_RPC_URL`.

The gateway:
- Tries the primary endpoint first.
- Falls back to the next endpoint if the primary stalls (3s stall timeout).
- Does **not** retry `eth_sendTransaction` automatically (only read operations fail over).
- Validates `chainId == 43113` on every provider.

## 4. Contract Functions (read-only)

| Function | Returns |
|---|---|
| `authorizedIssuers(address)` | `bool` |
| `credentialExists(bytes32)` | `bool` |
| `credentialIdForEvidence(bytes32)` | `bytes32` |
| `getCredential(bytes32)` | `(bytes32 evidenceHash, address issuer, uint64 issuedAt, uint64 revokedAt)` |
| `isCredentialValid(bytes32)` | `bool` |

## 5. Independent Verification Tools

- **Fuji Explorer:** https://explorer-test.avax.network/c-chain/tx/<hash>
- **Contract:** https://explorer-test.avax.network/c-chain/address/0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b
- **RPC:** Any Fuji C-Chain RPC endpoint.

## 6. Security Notes

- Only opaque hashes (credential ID, evidence hash) are stored on-chain. No PII.
- The contract owner controls issuer authorization. Owner key must be secured.
- `revokeCredential` can be called by any authorized issuer (contract-level). Backend restricts to the original issuer row.
- No pause mechanism exists in the contract. Emergency response relies on issuer de-authorization.
