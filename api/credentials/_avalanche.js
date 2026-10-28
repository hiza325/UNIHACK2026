import { Contract, Interface, JsonRpcProvider, Wallet, getAddress, id, isAddress } from 'ethers';

export const AVALANCHE_FUJI_CHAIN_ID = 43113n;
export const AVALANCHE_FUJI_NETWORK = 'avalanche-fuji';
export const AVALANCHE_FUJI_EXPLORER_TX = 'https://subnets-test.avax.network/c-chain/tx/';

export const LEARNING_CREDENTIAL_REGISTRY_ABI = Object.freeze([
  'function authorizedIssuers(address) view returns (bool)',
  'function credentialExists(bytes32 credentialId) view returns (bool)',
  'function credentialIdForEvidence(bytes32 evidenceHash) view returns (bytes32)',
  'function getCredential(bytes32 credentialId) view returns (bytes32 evidenceHash, address issuer, uint64 issuedAt, uint64 revokedAt)',
  'function isCredentialValid(bytes32 credentialId) view returns (bool)',
  'function issueCredential(bytes32 credentialId, bytes32 evidenceHash)',
  'function revokeCredential(bytes32 credentialId)',
  'error UnauthorizedIssuer(address account)',
  'error InvalidCredentialId()',
  'error InvalidEvidenceHash()',
  'error CredentialAlreadyExists(bytes32 credentialId)',
  'error EvidenceAlreadyRegistered(bytes32 evidenceHash)',
  'error CredentialNotFound(bytes32 credentialId)',
  'error CredentialAlreadyRevoked(bytes32 credentialId)',
]);

const registryInterface = new Interface(LEARNING_CREDENTIAL_REGISTRY_ABI);
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

function serviceError(message, code, status, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

export function avalancheConfig(env = process.env, { requireSigner = false } = {}) {
  const rpcUrl = String(env.AVALANCHE_FUJI_RPC_URL || '').trim();
  const contractAddress = String(env.AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS || '').trim();
  const privateKey = String(env.AVALANCHE_ISSUER_PRIVATE_KEY || '').trim();
  if (!rpcUrl) throw serviceError('Avalanche Fuji RPC is not configured', 'AVALANCHE_RPC_NOT_CONFIGURED', 503);
  let parsedUrl;
  try { parsedUrl = new URL(rpcUrl); } catch { throw serviceError('Avalanche Fuji RPC URL is invalid', 'AVALANCHE_RPC_INVALID', 503); }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) throw serviceError('Avalanche Fuji RPC URL is invalid', 'AVALANCHE_RPC_INVALID', 503);
  if (!isAddress(contractAddress) || /^0x0{40}$/i.test(contractAddress)) throw serviceError('Credential registry address is not configured', 'AVALANCHE_CONTRACT_NOT_CONFIGURED', 503);
  if (requireSigner && (!PRIVATE_KEY.test(privateKey) || /^0x0{64}$/i.test(privateKey))) throw serviceError('Avalanche issuer wallet is not configured', 'AVALANCHE_ISSUER_NOT_CONFIGURED', 503);
  return { rpcUrl, contractAddress: getAddress(contractAddress), privateKey };
}

export async function assertFujiNetwork(provider) {
  let network;
  try { network = await provider.getNetwork(); }
  catch (error) { throw serviceError('Unable to connect to Avalanche Fuji', 'AVALANCHE_RPC_UNAVAILABLE', 503, error); }
  if (BigInt(network.chainId) !== AVALANCHE_FUJI_CHAIN_ID) {
    throw serviceError(`Refusing chain ${network.chainId}; Avalanche Fuji (43113) is required`, 'AVALANCHE_WRONG_CHAIN', 503);
  }
  return network;
}

export function credentialIdFromCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized || normalized.length > 80) throw serviceError('Invalid credential code', 'INVALID_CREDENTIAL_CODE', 400);
  return id(`paradox-learning-credential:${normalized}`);
}

export function normalizeEvidenceHash(value) {
  const raw = String(value || '').trim().replace(/^sha256:/i, '0x');
  const normalized = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
  if (!BYTES32.test(normalized) || /^0x0{64}$/i.test(normalized)) {
    throw serviceError('Evidence hash must be a non-zero SHA-256 hash', 'INVALID_EVIDENCE_HASH', 400);
  }
  return normalized.toLowerCase();
}

function revertData(error) {
  return error?.data || error?.info?.error?.data || error?.error?.data || error?.cause?.data || null;
}

export function mapAvalancheError(error) {
  if (error?.code && /^AVALANCHE_|^DUPLICATE_|^CREDENTIAL_|^EVIDENCE_|^ISSUER_/.test(error.code)) return error;
  let name = error?.revert?.name;
  if (!name) {
    try { name = registryInterface.parseError(revertData(error))?.name; } catch { /* Unknown RPC error. */ }
  }
  const mapped = {
    UnauthorizedIssuer: ['Issuer wallet is not authorized by the registry', 'ISSUER_NOT_AUTHORIZED', 403],
    CredentialAlreadyExists: ['Credential already exists on Avalanche', 'DUPLICATE_CREDENTIAL', 409],
    EvidenceAlreadyRegistered: ['Evidence hash is already registered on Avalanche', 'DUPLICATE_EVIDENCE', 409],
    CredentialNotFound: ['Credential does not exist on Avalanche', 'CREDENTIAL_NOT_FOUND', 404],
    CredentialAlreadyRevoked: ['Credential has already been revoked', 'CREDENTIAL_ALREADY_REVOKED', 409],
    InvalidCredentialId: ['Credential ID hash is invalid', 'INVALID_CREDENTIAL_ID', 400],
    InvalidEvidenceHash: ['Evidence hash is invalid', 'INVALID_EVIDENCE_HASH', 400],
  }[name];
  if (mapped) return serviceError(mapped[0], mapped[1], mapped[2], error);
  if (error?.code === 'INSUFFICIENT_FUNDS') return serviceError('Issuer wallet needs Fuji testnet AVAX for gas', 'FUJI_AVAX_REQUIRED', 503, error);
  if (error?.code === 'NONCE_EXPIRED' || error?.code === 'REPLACEMENT_UNDERPRICED') return serviceError('Avalanche transaction nonce conflict', 'AVALANCHE_NONCE_CONFLICT', 409, error);
  return serviceError('Avalanche transaction failed', 'AVALANCHE_TRANSACTION_FAILED', 502, error);
}

function receiptSummary(receipt) {
  return {
    transactionHash: receipt.hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed?.toString() || null,
    status: Number(receipt.status),
  };
}

export async function createAvalancheGateway({ env = process.env, write = false, provider: suppliedProvider, contract: suppliedContract, wallet: suppliedWallet } = {}) {
  const config = avalancheConfig(env, { requireSigner: write });
  const provider = suppliedProvider || new JsonRpcProvider(config.rpcUrl);
  await assertFujiNetwork(provider);
  const wallet = write ? (suppliedWallet || new Wallet(config.privateKey, provider)) : null;
  const contract = suppliedContract || new Contract(config.contractAddress, LEARNING_CREDENTIAL_REGISTRY_ABI, wallet || provider);

  async function verifyCredential(credentialId) {
    try {
      const exists = await contract.credentialExists(credentialId);
      if (!exists) return { exists: false, valid: false, revoked: false, credentialId };
      const [record, valid] = await Promise.all([contract.getCredential(credentialId), contract.isCredentialValid(credentialId)]);
      return {
        exists: true,
        valid: Boolean(valid),
        revoked: BigInt(record.revokedAt) > 0n,
        credentialId,
        evidenceHash: record.evidenceHash,
        issuer: record.issuer,
        issuedAt: Number(record.issuedAt),
        revokedAt: Number(record.revokedAt),
      };
    } catch (error) { throw mapAvalancheError(error); }
  }

  async function requireAuthorizedWallet() {
    if (!write || !wallet) throw serviceError('Issuer wallet is required for this operation', 'AVALANCHE_ISSUER_NOT_CONFIGURED', 503);
    let authorized;
    try { authorized = await contract.authorizedIssuers(wallet.address); }
    catch (error) { throw mapAvalancheError(error); }
    if (!authorized) throw serviceError('Issuer wallet is not authorized by the registry', 'ISSUER_NOT_AUTHORIZED', 403);
    return wallet.address;
  }

  async function submit(method, args, onSubmitted) {
    try {
      const transaction = await contract[method](...args);
      await onSubmitted?.(transaction.hash);
      const receipt = await transaction.wait(1);
      if (!receipt || Number(receipt.status) !== 1) {
        throw serviceError('Avalanche transaction was mined but failed', 'AVALANCHE_TRANSACTION_REVERTED', 502);
      }
      return receiptSummary(receipt);
    } catch (error) { throw mapAvalancheError(error); }
  }

  return {
    chainId: Number(AVALANCHE_FUJI_CHAIN_ID),
    network: AVALANCHE_FUJI_NETWORK,
    contractAddress: config.contractAddress,
    issuerAddress: wallet?.address || null,
    verifyCredential,
    async issueCredential({ credentialId, evidenceHash, onSubmitted }) {
      await requireAuthorizedWallet();
      const receipt = await submit('issueCredential', [credentialId, evidenceHash], onSubmitted);
      return { receipt, credential: await verifyCredential(credentialId) };
    },
    async revokeCredential({ credentialId, onSubmitted }) {
      await requireAuthorizedWallet();
      const receipt = await submit('revokeCredential', [credentialId], onSubmitted);
      return { receipt, credential: await verifyCredential(credentialId) };
    },
  };
}
