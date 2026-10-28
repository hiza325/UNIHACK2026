import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from 'ethers';

const FUJI_CHAIN_ID = 43113n;
const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function loadLocalEnvironment() {
  try {
    const contents = await readFile(join(root, '.env'), 'utf8');
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

async function main() {
  await loadLocalEnvironment();
  const rpcUrl = required('AVALANCHE_FUJI_RPC_URL');
  const privateKey = required('AVALANCHE_ISSUER_PRIVATE_KEY');
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey) || /^0x0{64}$/i.test(privateKey)) throw new Error('AVALANCHE_ISSUER_PRIVATE_KEY must be a non-zero 32-byte hex key');

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (BigInt(network.chainId) !== FUJI_CHAIN_ID) {
    throw new Error(`Deployment refused: connected to chain ${network.chainId}, expected Avalanche Fuji 43113`);
  }

  const wallet = new Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);
  if (balance === 0n) throw new Error(`Issuer ${wallet.address} has no Fuji testnet AVAX for gas`);

  const artifactPath = join(root, 'artifacts', 'contracts', 'LearningCredentialRegistry.sol', 'LearningCredentialRegistry.json');
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log(`Deploying LearningCredentialRegistry to Avalanche Fuji (43113) from ${wallet.address}`);
  console.log(`Fuji balance: ${formatEther(balance)} AVAX`);
  const contract = await factory.deploy();
  const deploymentTransaction = contract.deploymentTransaction();
  console.log(`Deployment submitted: ${deploymentTransaction.hash}`);
  const receipt = await deploymentTransaction.wait(1);
  if (!receipt || Number(receipt.status) !== 1) throw new Error('Deployment transaction was mined but failed');

  const contractAddress = await contract.getAddress();
  if (!(await contract.authorizedIssuers(wallet.address))) throw new Error('Post-deployment issuer authorization check failed');

  const manifest = {
    contract: 'LearningCredentialRegistry',
    network: 'avalanche-fuji',
    chainId: Number(FUJI_CHAIN_ID),
    address: contractAddress,
    deploymentTransactionHash: deploymentTransaction.hash,
    deployer: wallet.address,
    blockNumber: Number(receipt.blockNumber),
    deployedAt: new Date().toISOString(),
  };
  const outputPath = join(root, 'deployments', 'avalanche-fuji.json');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
  console.log(`Saved deployment manifest to ${outputPath}`);
}

main().catch(error => {
  console.error(`Fuji deployment failed: ${error.shortMessage || error.reason || error.message}`);
  process.exitCode = 1;
});
