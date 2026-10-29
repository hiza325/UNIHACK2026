/* Public, non-secret deployment metadata shared by browser, API, and tooling. */
export const AVALANCHE_FUJI_CONFIG = Object.freeze({
  contractName: 'LearningCredentialRegistry',
  network: 'avalanche-fuji',
  networkName: 'Avalanche Fuji Testnet',
  chainName: 'Avalanche Fuji C-Chain',
  chainId: 43113,
  chainIdHex: '0xa869',
  rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
  explorerBaseUrl: 'https://explorer-test.avax.network/c-chain',
  contractAddress: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
  deploymentTransactionHash: '0x45c55865fb43bf28a1972597ce4ecedf9d769876344034a9447cd75a6de2d56f',
});

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;

export function isEvmAddress(value) {
  return ADDRESS.test(String(value || '').trim());
}

export function isEvmTransactionHash(value) {
  return TRANSACTION_HASH.test(String(value || '').trim());
}

export function avalancheFujiAddressUrl(address = AVALANCHE_FUJI_CONFIG.contractAddress) {
  return isEvmAddress(address) ? `${AVALANCHE_FUJI_CONFIG.explorerBaseUrl}/address/${address}` : null;
}

export function avalancheFujiTransactionUrl(transactionHash) {
  return isEvmTransactionHash(transactionHash) ? `${AVALANCHE_FUJI_CONFIG.explorerBaseUrl}/tx/${transactionHash}` : null;
}

export const AVALANCHE_FUJI_CONTRACT_URL = avalancheFujiAddressUrl();
export const AVALANCHE_FUJI_DEPLOYMENT_URL = avalancheFujiTransactionUrl(AVALANCHE_FUJI_CONFIG.deploymentTransactionHash);
