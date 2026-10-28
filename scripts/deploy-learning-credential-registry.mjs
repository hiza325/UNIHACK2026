import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, FetchRequest, JsonRpcProvider, Wallet, formatEther, getAddress, isAddress, keccak256 } from 'ethers';

const FUJI_CHAIN_ID = 43113n;
const RPC_TIMEOUT_MS = 20_000;
const RECEIPT_TIMEOUT_MS = 10 * 60_000;
const DEPLOY_CONFIRMATION = 'DEPLOY_LEARNING_CREDENTIAL_REGISTRY_TO_FUJI';
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

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeErrorMessage(error) {
  let message = String(error.shortMessage || error.reason || error.message || 'Unknown deployment error');
  for (const [name, replacement] of [
    ['AVALANCHE_ISSUER_PRIVATE_KEY', '[REDACTED_PRIVATE_KEY]'],
    ['AVALANCHE_FUJI_RPC_URL', '[REDACTED_RPC_URL]'],
  ]) {
    const secret = String(process.env[name] || '');
    if (secret) message = message.split(secret).join(replacement);
  }
  return message;
}

async function fileExists(path) {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function main() {
  await loadLocalEnvironment();
  const preflightOnly = process.argv.includes('--preflight');
  const outputPath = join(root, 'deployments', 'avalanche-fuji.json');
  const pendingPath = join(root, 'deployments', 'avalanche-fuji.pending.local.json');
  const allowRedeploy = process.env.AVALANCHE_ALLOW_REDEPLOY === '1';
  if (!allowRedeploy && await fileExists(outputPath)) {
    throw new Error('Fuji deployment manifest already exists; refusing to redeploy or overwrite it without AVALANCHE_ALLOW_REDEPLOY=1');
  }
  if (!allowRedeploy && await fileExists(pendingPath)) {
    throw new Error(`A pending deployment journal exists at ${pendingPath}; verify its transaction before any retry`);
  }

  const rpcUrl = required('AVALANCHE_FUJI_RPC_URL');
  const privateKey = required('AVALANCHE_ISSUER_PRIVATE_KEY');
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey) || /^0x0{64}$/i.test(privateKey)) throw new Error('AVALANCHE_ISSUER_PRIVATE_KEY must be a non-zero 32-byte hex key');

  const rpcRequest = new FetchRequest(rpcUrl);
  rpcRequest.timeout = RPC_TIMEOUT_MS;
  provider = new JsonRpcProvider(rpcRequest);
  const network = await provider.getNetwork();
  if (BigInt(network.chainId) !== FUJI_CHAIN_ID) {
    throw new Error(`Deployment refused: connected to chain ${network.chainId}, expected Avalanche Fuji 43113`);
  }

  const wallet = new Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);
  if (balance === 0n) throw new Error(`Issuer ${wallet.address} has no Fuji testnet AVAX for gas`);

  const artifactPath = join(root, 'artifacts', 'contracts', 'LearningCredentialRegistry.sol', 'LearningCredentialRegistry.json');
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  if (!artifact.bytecode || artifact.bytecode === '0x') throw new Error('LearningCredentialRegistry artifact has no deployment bytecode');
  if (!artifact.deployedBytecode || artifact.deployedBytecode === '0x') throw new Error('LearningCredentialRegistry artifact has no runtime bytecode');
  const constructorInputs = artifact.abi.find(item => item.type === 'constructor')?.inputs || [];
  if (constructorInputs.length !== 0) throw new Error(`Expected zero constructor arguments, artifact requires ${constructorInputs.length}`);

  const configuredAddress = String(process.env.AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS || '').trim();
  if (!allowRedeploy && configuredAddress) {
    if (!isAddress(configuredAddress) || /^0x0{40}$/i.test(configuredAddress)) {
      throw new Error('AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS is configured but invalid; remove the placeholder before a first deployment');
    }
    const configuredCode = await provider.getCode(getAddress(configuredAddress));
    const codeStatus = configuredCode === '0x' ? 'has no Fuji bytecode' : 'already has Fuji bytecode';
    throw new Error(`AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS ${codeStatus}; verify or deliberately set AVALANCHE_ALLOW_REDEPLOY=1 before another deployment`);
  }

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const deployRequest = await factory.getDeployTransaction();
  const estimatedGas = await provider.estimateGas({ ...deployRequest, from: wallet.address });
  const gasLimit = estimatedGas * 120n / 100n;
  const feeData = await provider.getFeeData();
  const maximumFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (maximumFeePerGas === null) throw new Error('Fuji RPC did not return usable fee data');
  const estimatedMaximumCost = gasLimit * maximumFeePerGas;
  if (balance < estimatedMaximumCost) {
    throw new Error(`Issuer ${wallet.address} does not have enough Fuji testnet AVAX for the buffered deployment estimate`);
  }

  console.log(JSON.stringify({
    status: 'PREFLIGHT_READY',
    network: 'avalanche-fuji',
    chainId: Number(network.chainId),
    deployer: wallet.address,
    balanceAvax: formatEther(balance),
    constructorArguments: [],
    estimatedGas: estimatedGas.toString(),
    bufferedGasLimit: gasLimit.toString(),
    estimatedMaximumCostAvax: formatEther(estimatedMaximumCost),
    manifestPresent: false,
    pendingDeploymentPresent: false,
    transactionSigned: false,
    transactionSent: false,
  }, null, 2));
  if (preflightOnly) return;

  if (process.env.AVALANCHE_DEPLOY_CONFIRM !== DEPLOY_CONFIRMATION) {
    throw new Error(`Deployment confirmation missing; set AVALANCHE_DEPLOY_CONFIRM=${DEPLOY_CONFIRMATION} only when you intend to broadcast`);
  }

  console.log(`Deploying LearningCredentialRegistry to Avalanche Fuji (43113) from ${wallet.address}`);
  console.log(`Fuji balance: ${formatEther(balance)} AVAX`);
  const contract = await factory.deploy({ gasLimit });
  const deploymentTransaction = contract.deploymentTransaction();
  console.log(`Deployment submitted: ${deploymentTransaction.hash}`);
  await mkdir(dirname(pendingPath), { recursive: true });
  await writeFile(pendingPath, `${JSON.stringify({
    status: 'PENDING',
    contract: 'LearningCredentialRegistry',
    network: 'avalanche-fuji',
    chainId: Number(FUJI_CHAIN_ID),
    deploymentTransactionHash: deploymentTransaction.hash,
    deployer: wallet.address,
    submittedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  const receipt = await deploymentTransaction.wait(1, RECEIPT_TIMEOUT_MS);
  if (!receipt || Number(receipt.status) !== 1) throw new Error('Deployment transaction was mined but failed');

  const contractAddress = getAddress(await contract.getAddress());
  const runtimeBytecode = await provider.getCode(contractAddress);
  if (!runtimeBytecode || runtimeBytecode === '0x') throw new Error('Post-deployment bytecode verification failed');
  const runtimeBytecodeHash = keccak256(runtimeBytecode);
  const artifactRuntimeBytecodeHash = keccak256(artifact.deployedBytecode);
  if (runtimeBytecodeHash !== artifactRuntimeBytecodeHash) throw new Error('Deployed runtime bytecode does not match the compiled artifact');

  const owner = getAddress(await contract.owner());
  if (owner !== getAddress(wallet.address)) throw new Error('Post-deployment owner verification failed');
  if (!(await contract.authorizedIssuers(wallet.address))) throw new Error('Post-deployment issuer authorization check failed');

  const manifest = {
    contract: 'LearningCredentialRegistry',
    network: 'avalanche-fuji',
    chainId: Number(FUJI_CHAIN_ID),
    address: contractAddress,
    deploymentTransactionHash: deploymentTransaction.hash,
    deployer: wallet.address,
    owner,
    blockNumber: Number(receipt.blockNumber),
    receiptStatus: Number(receipt.status),
    runtimeBytecodeHash,
    artifactRuntimeBytecodeHash,
    runtimeBytecodeMatchesArtifact: true,
    explorerAddressUrl: `https://subnets-test.avax.network/c-chain/address/${contractAddress}`,
    explorerTransactionUrl: `https://subnets-test.avax.network/c-chain/tx/${deploymentTransaction.hash}`,
    deployedAt: new Date().toISOString(),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rm(pendingPath, { force: true });
  console.log(JSON.stringify(manifest, null, 2));
  console.log(`Saved deployment manifest to ${outputPath}`);
}

main()
  .catch(error => {
    console.error(`Fuji deployment failed: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  })
  .finally(() => provider?.destroy());
