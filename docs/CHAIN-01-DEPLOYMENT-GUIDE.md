# CHAIN-01 — Safe Avalanche Fuji Deployment Guide

## Current status

**BLOCKED for deployment execution.** The contract and scripts are ready, but the local environment does not currently contain a dedicated Fuji signer and its test AVAX balance has not been verified. No blockchain transaction has been signed or sent.

Target:

- Network: Avalanche Fuji C-Chain
- Chain ID: `43113`
- RPC: `https://api.avax-test.network/ext/bc/C/rpc`
- Contract: `LearningCredentialRegistry`
- Constructor arguments: none (`[]`)

## 1. Create a dedicated Fuji-only wallet

Create a new wallet used only for Fuji. Do not reuse a Mainnet or personal wallet. Never paste its private key into chat, source code, terminal history, CI logs, or the deployment report.

Fund only its **public address** with test AVAX from a Fuji faucet.

## 2. Create the ignored environment file

Create `.env.avalanche-fuji` in the repository root:

```dotenv
AVALANCHE_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
AVALANCHE_ISSUER_PRIVATE_KEY=<FUJI-ONLY-PRIVATE-KEY>
```

Do not add `AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS` before the first deployment. Do not set `AVALANCHE_ALLOW_REDEPLOY=1` for a first deployment.

`.env.avalanche-fuji` is covered by `.gitignore` through the `.env.*` rule.

## 3. Select the environment file

PowerShell:

```powershell
$env:AVALANCHE_ENV_FILE = ".env.avalanche-fuji"
```

This variable contains only a file path, not the private key.

## 4. Run read-only preflight

```powershell
npm run contract:preflight:fuji
```

Preflight does not sign or send a transaction. It checks:

- RPC availability and timeout.
- Actual Chain ID equals `43113`.
- Private-key format without printing the key.
- Signer public address and Fuji AVAX balance.
- Zero constructor arguments.
- Artifact deployment/runtime bytecode.
- Deployment gas estimate plus a 20% gas-limit buffer.
- Absence of an existing manifest, pending deployment, or configured address.

Continue only when the output contains `"status": "PREFLIGHT_READY"`.

## 5. Explicitly authorize and run deployment

Setting this variable is an explicit local broadcast confirmation:

```powershell
$env:AVALANCHE_DEPLOY_CONFIRM = "DEPLOY_LEARNING_CREDENTIAL_REGISTRY_TO_FUJI"
npm run contract:deploy:fuji
```

This command compiles first, then deploys with no constructor arguments. It waits for one confirmation and verifies runtime bytecode, owner, and issuer authorization before writing the final manifest.

Do not set `AVALANCHE_ALLOW_REDEPLOY=1` unless an existing deployment and any pending transaction have been investigated deliberately.

## 6. Obtain the address and transaction hash

After success, the public deployment evidence is saved to:

```text
deployments/avalanche-fuji.json
```

Read the values in PowerShell:

```powershell
$deployment = Get-Content deployments/avalanche-fuji.json -Raw | ConvertFrom-Json
$deployment.address
$deployment.deploymentTransactionHash
$deployment.explorerAddressUrl
$deployment.explorerTransactionUrl
```

The terminal also prints `Deployment submitted: <transaction hash>` immediately after broadcast.

## 7. Verify and rerun CHAIN-01

Run the read-only verifier:

```powershell
npm run contract:verify:fuji
```

CHAIN-01 can become PASS only when the verifier reports all of the following:

- `status: PASS`
- `chainId: 43113`
- `bytecodePresent: true`
- `runtimeBytecodeMatchesArtifact: true`
- `abiReadChecks.ownerAuthorized: true`
- Successful deployment receipt matching the contract address

Then rerun the Solidity tests:

```powershell
npm run contract:test
```

Update `docs/CHAIN-01-REPORT.md` with the real address, transaction hash, block number, `eth_getCode` result, and Fuji Explorer links. Never invent or manually substitute these values.

## 8. Failure and recovery rules

### RPC unavailable

The scripts stop with a non-zero exit code. No transaction is sent if the terminal has not printed `Deployment submitted:`.

### Wrong Chain ID

Deployment is refused unless the RPC reports exactly `43113`.

### Transaction rejected before broadcast

If no transaction hash was printed and no pending journal exists, fix the reported issue and rerun preflight.

### Transaction hash printed, but deployment times out or post-check fails

Do **not** deploy again. The script stores:

```text
deployments/avalanche-fuji.pending.local.json
```

Run:

```powershell
npm run contract:verify:fuji
```

The verifier reads the pending transaction receipt, reports BLOCKED while it is pending, reports FAIL if it reverted, or recovers and verifies the contract address when it succeeded.

### Existing manifest or pending journal

Deployment is refused to prevent duplicate contracts. Investigate the existing address/transaction first. `AVALANCHE_ALLOW_REDEPLOY=1` is an emergency, explicit override and should not remain configured permanently.

## 9. Owner and issuer behavior

- The deployment signer becomes `owner`.
- The same signer is automatically an authorized issuer.
- The owner cannot remove itself as issuer while it remains owner.
- Ownership transfer requires `transferOwnership(newOwner)` and a separate `acceptOwnership()` transaction from the pending owner.
- After ownership transfer, the previous owner remains an issuer until the new owner explicitly removes it with `setIssuer(previousOwner, false)`.
- Any authorized issuer can issue credentials and revoke existing credentials.

Any post-deployment issuer or ownership transaction requires separate review and explicit approval.
