import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, FetchRequest, JsonRpcProvider, getAddress, isAddress, keccak256 } from 'ethers';
import { AVALANCHE_FUJI_CONFIG, avalancheFujiAddressUrl, avalancheFujiTransactionUrl } from '../avalanche-config.js';

const FUJI_CHAIN_ID = BigInt(AVALANCHE_FUJI_CONFIG.chainId);
const OFFICIAL_FUJI_RPC = AVALANCHE_FUJI_CONFIG.rpcUrl;
const RPC_TIMEOUT_MS = 20_000;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let provider;

async function loadLocalEnvironment() {
  const configuredPath = String(process.env.AVALANCHE_ENV_FILE || '').trim();
  const environmentPath = configuredPath
    ? (isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath))
    : join(root, '.env');
  try {
    const contents = await readFile(environmentPath, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function blocked(message, details = {}) {
  console.log(JSON.stringify({ status: 'BLOCKED', message, ...details }, null, 2));
  process.exitCode = 2;
}

function safeErrorMessage(error) {
  let message = String(error.shortMessage || error.reason || error.message || 'Unknown verification error');
  const configuredRpc = String(process.env.AVALANCHE_FUJI_RPC_URL || '');
  if (configuredRpc) message = message.split(configuredRpc).join('[REDACTED_RPC_URL]');
  return message;
}

async function main() {
  await loadLocalEnvironment();
  const manifest = await optionalJson(join(root, 'deployments', 'avalanche-fuji.json'));
  const pending = await optionalJson(join(root, 'deployments', 'avalanche-fuji.pending.local.json'));
  const rpcUrl = String(process.env.AVALANCHE_FUJI_RPC_URL || OFFICIAL_FUJI_RPC).trim();
  let configuredAddress = String(process.env.AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS || manifest?.address || AVALANCHE_FUJI_CONFIG.contractAddress).trim();
  const deploymentTransactionHash = manifest?.deploymentTransactionHash || pending?.deploymentTransactionHash || AVALANCHE_FUJI_CONFIG.deploymentTransactionHash;

  const rpcRequest = new FetchRequest(rpcUrl);
  rpcRequest.timeout = RPC_TIMEOUT_MS;
  provider = new JsonRpcProvider(rpcRequest);
  const network = await provider.getNetwork();
  if (BigInt(network.chainId) !== FUJI_CHAIN_ID) {
    blocked(`Connected to chain ${network.chainId}; Avalanche Fuji 43113 is required`, { chainId: Number(network.chainId) });
    return;
  }
  if (!configuredAddress && pending?.chainId && Number(pending.chainId) !== Number(FUJI_CHAIN_ID)) {
    blocked(`Pending deployment targets chain ${pending.chainId}, not Avalanche Fuji 43113`, { chainId: Number(network.chainId) });
    return;
  }
  if (!configuredAddress && deploymentTransactionHash) {
    const pendingReceipt = await provider.getTransactionReceipt(deploymentTransactionHash);
    if (!pendingReceipt) {
      blocked('Deployment transaction is still pending or unavailable; do not redeploy until it is resolved', {
        chainId: Number(network.chainId),
        deploymentTransactionHash,
      });
      return;
    }
    if (Number(pendingReceipt.status) !== 1 || !pendingReceipt.contractAddress) {
      console.log(JSON.stringify({
        status: 'FAIL',
        message: 'Deployment transaction was mined but did not create a contract successfully',
        chainId: Number(network.chainId),
        deploymentTransactionHash,
        receiptStatus: Number(pendingReceipt.status),
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    configuredAddress = pendingReceipt.contractAddress;
  }
  if (!isAddress(configuredAddress) || /^0x0{40}$/i.test(configuredAddress)) {
    blocked('AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS is missing or invalid', { chainId: Number(network.chainId), rpcReachable: true });
    return;
  }

  const address = getAddress(configuredAddress);
  const runtimeBytecode = await provider.getCode(address);
  if (!runtimeBytecode || runtimeBytecode === '0x') {
    console.log(JSON.stringify({
      status: 'FAIL',
      chainId: Number(network.chainId),
      address,
      bytecodePresent: false,
      ethGetCode: '0x',
      explorerAddressUrl: avalancheFujiAddressUrl(address),
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const artifact = JSON.parse(await readFile(join(root, 'artifacts', 'contracts', 'LearningCredentialRegistry.sol', 'LearningCredentialRegistry.json'), 'utf8'));
  const runtimeBytecodeHash = keccak256(runtimeBytecode);
  const artifactRuntimeBytecodeHash = keccak256(artifact.deployedBytecode);
  const contract = new Contract(address, artifact.abi, provider);
  const [owner, pendingOwner] = await Promise.all([contract.owner(), contract.pendingOwner()]);
  const ownerAuthorized = await contract.authorizedIssuers(owner);

  let deploymentReceipt = null;
  if (deploymentTransactionHash) {
    const receipt = await provider.getTransactionReceipt(deploymentTransactionHash);
    deploymentReceipt = receipt ? {
      transactionHash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      status: Number(receipt.status),
      contractAddress: receipt.contractAddress ? getAddress(receipt.contractAddress) : null,
      addressMatches: receipt.contractAddress ? getAddress(receipt.contractAddress) === address : false,
    } : null;
  }

  const runtimeBytecodeMatchesArtifact = runtimeBytecodeHash === artifactRuntimeBytecodeHash;
  const receiptMatches = !deploymentTransactionHash
    || Boolean(deploymentReceipt?.status === 1 && deploymentReceipt?.addressMatches);
  const verificationPassed = runtimeBytecodeMatchesArtifact && Boolean(ownerAuthorized) && receiptMatches;

  console.log(JSON.stringify({
    status: verificationPassed ? 'PASS' : 'FAIL',
    network: AVALANCHE_FUJI_CONFIG.network,
    chainId: Number(network.chainId),
    address,
    bytecodePresent: true,
    runtimeBytecodeBytes: (runtimeBytecode.length - 2) / 2,
    runtimeBytecodeHash,
    artifactRuntimeBytecodeHash,
    runtimeBytecodeMatchesArtifact,
    abiReadChecks: {
      owner: getAddress(owner),
      pendingOwner: getAddress(pendingOwner),
      ownerAuthorized: Boolean(ownerAuthorized),
    },
    deploymentReceipt,
    addressSource: process.env.AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS
      ? 'environment'
      : manifest?.address ? 'manifest' : pending?.deploymentTransactionHash ? 'pending-transaction-receipt' : 'unknown',
    explorerAddressUrl: avalancheFujiAddressUrl(address),
    explorerTransactionUrl: deploymentTransactionHash
      ? avalancheFujiTransactionUrl(deploymentTransactionHash)
      : null,
  }, null, 2));
  if (!verificationPassed) process.exitCode = 1;
}

main()
  .catch(error => {
    console.log(JSON.stringify({
      status: 'BLOCKED',
      message: `Fuji verification could not complete: ${safeErrorMessage(error)}`,
    }, null, 2));
    process.exitCode = 2;
  })
  .finally(() => provider?.destroy());
