import { createMockLearningPassport } from './learning-passport-mock.js';
import { AVALANCHE_FUJI_CONFIG, avalancheFujiTransactionUrl, isEvmTransactionHash } from './avalanche-config.js';

export const LEARNING_PASSPORT_API_INTERFACE = Object.freeze({
  schemaVersion: 'paradox-learning-passport-v1',
  routes: {
    passport: 'GET /api/credentials',
    credential: 'GET /api/credentials?code=:code',
    issueCredential: 'POST /api/credentials { action: "issue" }',
    verifyCredential: 'POST /api/credentials { action: "verify" }',
    revokeCredential: 'POST /api/credentials { action: "revoke" }',
    eligibleLearningEvaluations: 'GET /api/learning-records?view=evaluations',
  },
  aiInput: ['proofRecord', 'evaluation', 'learnerId', 'sessionId'],
});

export const AVALANCHE_CREDENTIAL_INTERFACE = Object.freeze({
  interfaceVersion: 'paradox-avalanche-credential-v1',
  contractAddressEnvironmentVariable: 'AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS',
  contractName: AVALANCHE_FUJI_CONFIG.contractName,
  contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress,
  deploymentTransactionHash: AVALANCHE_FUJI_CONFIG.deploymentTransactionHash,
  supportedNetworks: [
    {
      id: AVALANCHE_FUJI_CONFIG.network,
      name: AVALANCHE_FUJI_CONFIG.networkName,
      chainId: AVALANCHE_FUJI_CONFIG.chainId,
      contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress,
      explorerBaseUrl: AVALANCHE_FUJI_CONFIG.explorerBaseUrl,
    },
  ],
  readMethods: [
    { name: 'getCredential', inputs: ['bytes32 credentialId'], outputs: ['bytes32 evidenceHash', 'address issuer', 'uint64 issuedAt', 'uint64 revokedAt'] },
    { name: 'isCredentialValid', inputs: ['bytes32 credentialId'], outputs: ['bool'] },
  ],
  writeMethods: [
    { name: 'issueCredential', inputs: ['bytes32 credentialId', 'bytes32 evidenceHash'] },
    { name: 'revokeCredential', inputs: ['bytes32 credentialId'] },
  ],
});

const STATUS_VALUES = new Set(['unverified', 'pending', 'verified', 'revoked']);

// HTML `pattern` is compiled with the Unicode `v` flag in modern browsers. In
// that mode a literal hyphen inside a character class must be escaped, and the
// pattern is implicitly anchored. Export the exact source used by the browser
// so the UI and isCertificateCode() cannot drift apart.
export const CERTIFICATE_CODE_HTML_PATTERN = '\\s*[Pp][Xx][Pp]-[A-Za-z0-9\\-]{4,76}\\s*';
const CERTIFICATE_CODE = new RegExp(`^${CERTIFICATE_CODE_HTML_PATTERN}$`);

export function isCertificateCode(value) {
  return CERTIFICATE_CODE.test(String(value || '').trim().toUpperCase());
}

export function isAvalancheTransactionHash(value) {
  return isEvmTransactionHash(value);
}

export function isExpectedFujiCredential(credential) {
  return credential?.source === 'avalanche'
    && credential.network === AVALANCHE_FUJI_CONFIG.network
    && Number(credential.chainId) === AVALANCHE_FUJI_CONFIG.chainId
    && String(credential.contractAddress || '').toLowerCase() === AVALANCHE_FUJI_CONFIG.contractAddress.toLowerCase();
}

export function hasActualAvalancheVerification(credential) {
  return credential?.status === 'verified'
    && credential.transactionStatus === 'confirmed'
    && isExpectedFujiCredential(credential)
    && credential?.verification?.source === 'avalanche'
    && credential.verification.checked === true
    && credential.verification.valid === true
    && credential.verification.exists === true
    && isAvalancheTransactionHash(credential.issueTransactionHash)
    && credential.transactionHash === credential.issueTransactionHash;
}

export function getCredentialDisplayStatus(credential) {
  const status = STATUS_VALUES.has(credential?.status) ? credential.status : 'unverified';
  if (status === 'verified' && !hasActualAvalancheVerification(credential)) return 'unverified';
  return status;
}

export function getAvalancheExplorerUrl(credential) {
  if (!isExpectedFujiCredential(credential) || !isAvalancheTransactionHash(credential?.transactionHash)) return null;
  return avalancheFujiTransactionUrl(credential.transactionHash);
}

export function getCredentialVerificationState(credential) {
  if (!credential) return 'not-found';
  if (credential.source === 'mock') return 'demo';
  if (hasActualAvalancheVerification(credential)) return 'valid';
  const checkedOnExpectedContract = isExpectedFujiCredential(credential)
    && credential.verification?.source === 'avalanche'
    && credential.verification.checked === true;
  if (checkedOnExpectedContract && credential.verification?.exists === false) return 'unissued';
  if (checkedOnExpectedContract && credential.verification?.exists === true && (credential.status === 'revoked' || credential.verification.revoked === true)) return 'revoked';
  return 'unavailable';
}

export function createCredentialDraftFromAiEvaluation(payload = {}) {
  const proof = payload.proofRecord;
  if (!proof || typeof proof.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(proof.contentHash)) {
    throw new TypeError('A valid AI proofRecord contentHash is required');
  }
  return {
    schemaVersion: LEARNING_PASSPORT_API_INTERFACE.schemaVersion,
    learnerId: String(payload.learnerId || ''),
    sessionId: String(payload.sessionId || ''),
    status: 'unverified',
    source: 'ai-evaluation',
    evidenceHash: `sha256:${proof.contentHash.toLowerCase()}`,
    assessmentScore: Number.isFinite(proof.score) ? Math.max(0, Math.min(100, proof.score)) : null,
    rubricVersion: proof.rubricVersion || null,
    model: proof.model || null,
    transactionHash: null,
    network: null,
    verification: { checked: false, valid: false, source: null, checkedAt: null },
  };
}

function requireApiBase(apiBaseUrl) {
  if (!apiBaseUrl) throw Object.assign(new Error('Learning Passport API is not configured'), { code: 'PASSPORT_API_NOT_CONFIGURED' });
}

export function createLearningPassportService({ mode = 'mock', apiBaseUrl = '/api', fetcher = globalThis.fetch } = {}) {
  const baseUrl = String(apiBaseUrl).replace(/\/$/, '');
  async function apiRequest(path = '', options = {}) {
    requireApiBase(baseUrl);
    const response = await fetcher(`${baseUrl}/credentials${path}`, { credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(data.error || 'Learning Passport request failed'), { code: data.code || 'PASSPORT_API_ERROR', status: response.status });
    }
    return data;
  }
  return {
    mode,
    getSnapshot(user, language) {
      return createMockLearningPassport(user, language);
    },
    findCredential(passport, code) {
      const normalized = String(code || '').trim().toUpperCase();
      return passport?.credentials?.find(item => item.code === normalized) || null;
    },
    getDisplayStatus: getCredentialDisplayStatus,
    getExplorerUrl: getAvalancheExplorerUrl,
    async fetchPassport() {
      const data = await apiRequest();
      return data.passport;
    },
    async fetchCredential(code) {
      const data = await apiRequest(`?${new URLSearchParams({ code: String(code || '').trim().toUpperCase() })}`);
      return data.credential;
    },
    async verifyCredential(code) {
      const data = await apiRequest('', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', credentialCode: String(code || '').trim().toUpperCase() }),
      });
      return data.credential;
    },
  };
}
