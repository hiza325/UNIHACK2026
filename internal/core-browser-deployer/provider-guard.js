import { AVALANCHE_FUJI_CONFIG } from '../../avalanche-config.js';

export const FUJI_CHAIN_ID = BigInt(AVALANCHE_FUJI_CONFIG.chainId);
export const FUJI_CHAIN_HEX = AVALANCHE_FUJI_CONFIG.chainIdHex;

export function normalizeChainId(value) {
  try { return BigInt(value); } catch { return null; }
}

export async function inspectCoreSigningNetwork(coreProvider) {
  const ethChainIdRaw = await coreProvider.request({ method: 'eth_chainId' });
  const ethChainId = normalizeChainId(ethChainIdRaw);
  let coreChain;
  try {
    coreChain = await coreProvider.request({ method: 'wallet_getEthereumChain', params: [] });
  } catch (error) {
    return {
      verified: false,
      reason: 'Core wallet_getEthereumChain is unavailable',
      ethChainId,
      ethChainIdHex: ethChainIdRaw,
      coreChainId: null,
      coreChainIdHex: null,
      coreChainName: null,
      isTestnet: null,
      methodErrorCode: error?.code ?? null,
    };
  }
  const coreChainId = normalizeChainId(coreChain?.chainId);
  const isTestnet = coreChain?.isTestnet === true;
  const verified = ethChainId === FUJI_CHAIN_ID && coreChainId === FUJI_CHAIN_ID && isTestnet;
  return {
    verified,
    reason: verified ? null : 'EVM chain and Core signing network do not both identify Fuji',
    ethChainId,
    ethChainIdHex: ethChainIdRaw,
    coreChainId,
    coreChainIdHex: coreChain?.chainId ?? null,
    coreChainName: typeof coreChain?.chainName === 'string' ? coreChain.chainName : null,
    isTestnet: coreChain?.isTestnet ?? null,
    methodErrorCode: null,
  };
}

export function createFujiGuardedProvider(coreProvider, { getExpectedAddress = () => null, onDiagnostic = () => {} } = {}) {
  if (!coreProvider?.request) throw new Error('Core EIP-1193 provider is required');
  return {
    async request(payload) {
      if (payload?.method === 'eth_sendTransaction') {
        // These are deliberately the final provider calls before forwarding
        // the transaction to Core. Both EVM chain and Core's internal signing
        // mode must identify Fuji; transaction.chainId alone is insufficient.
        const signingNetwork = await inspectCoreSigningNetwork(coreProvider);
        onDiagnostic('before-eth_sendTransaction', signingNetwork);
        if (!signingNetwork.verified) {
          throw new Error(`Transaction blocked immediately before eth_sendTransaction: ${signingNetwork.reason}; eth_chainId=${signingNetwork.ethChainId}, Core chainId=${signingNetwork.coreChainId}, isTestnet=${signingNetwork.isTestnet}`);
        }
        const transaction = payload.params?.[0] || {};
        if (transaction.chainId !== undefined && normalizeChainId(transaction.chainId) !== FUJI_CHAIN_ID) {
          throw new Error(`Transaction blocked: payload Chain ID ${transaction.chainId} is not Fuji 43113`);
        }
        const expectedAddress = getExpectedAddress();
        if (transaction.from && expectedAddress && String(transaction.from).toLowerCase() !== String(expectedAddress).toLowerCase()) {
          throw new Error('Transaction blocked: sender changed after preflight');
        }
      }
      return coreProvider.request(payload);
    },
    on: typeof coreProvider.on === 'function' ? coreProvider.on.bind(coreProvider) : undefined,
    removeListener: typeof coreProvider.removeListener === 'function' ? coreProvider.removeListener.bind(coreProvider) : undefined,
  };
}
