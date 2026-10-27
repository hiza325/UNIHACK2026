import { createMockLearningPassport } from './learning-passport-mock.js';

export const LEARNING_PASSPORT_API_INTERFACE = Object.freeze({
  schemaVersion: 'paradox-learning-passport-v1',
  routes: {
    passport: 'GET /api/learning-passport/:learnerId',
    ingestAiEvaluation: 'POST /api/learning-passport/evaluations',
    credential: 'GET /api/learning-passport/credentials/:code',
    verifyCredential: 'POST /api/learning-passport/credentials/:code/verify',
  },
  aiInput: ['proofRecord', 'evaluation', 'learnerId', 'sessionId'],
});

export const AVALANCHE_CREDENTIAL_INTERFACE = Object.freeze({
  interfaceVersion: 'paradox-avalanche-credential-v1',
  contractAddress: null,
  supportedNetworks: [
    { id: 'avalanche-mainnet', chainId: 43114, explorerTransactionBaseUrl: 'https://subnets.avax.network/c-chain/tx/' },
    { id: 'avalanche-fuji', chainId: 43113, explorerTransactionBaseUrl: 'https://subnets-test.avax.network/c-chain/tx/' },
  ],
  readMethods: [
    { name: 'getCredential', inputs: ['bytes32 credentialId'], outputs: ['bytes32 evidenceHash', 'uint64 issuedAt', 'uint8 status'] },
    { name: 'isCredentialValid', inputs: ['bytes32 credentialId'], outputs: ['bool'] },
  ],
  writeMethods: [
    { name: 'issueCredential', inputs: ['bytes32 credentialId', 'bytes32 evidenceHash'] },
    { name: 'revokeCredential', inputs: ['bytes32 credentialId'] },
  ],
});

const STATUS_VALUES = new Set(['unverified', 'pending', 'verified', 'revoked']);
const CERTIFICATE_CODE = /^PXP-\d{4}-[A-Z0-9]{3,8}-\d{4}$/;
const TRANSACTION_HASH = /^0x[a-fA-F0-9]{64}$/;

export function isCertificateCode(value) {
  return CERTIFICATE_CODE.test(String(value || '').trim().toUpperCase());
}

export function isAvalancheTransactionHash(value) {
  return TRANSACTION_HASH.test(String(value || '').trim());
}

export function hasActualAvalancheVerification(credential) {
  return credential?.verification?.source === 'avalanche'
    && credential.verification.checked === true
    && credential.verification.valid === true
    && isAvalancheTransactionHash(credential.transactionHash);
}

export function getCredentialDisplayStatus(credential) {
  const status = STATUS_VALUES.has(credential?.status) ? credential.status : 'unverified';
  if (status === 'verified' && !hasActualAvalancheVerification(credential)) return 'unverified';
  return status;
}

export function getAvalancheExplorerUrl(credential) {
  if (!isAvalancheTransactionHash(credential?.transactionHash)) return null;
  const network = AVALANCHE_CREDENTIAL_INTERFACE.supportedNetworks.find(item => item.id === credential.network);
  return network ? `${network.explorerTransactionBaseUrl}${credential.transactionHash}` : null;
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

export function createLearningPassportService({ mode = 'mock', apiBaseUrl = '', fetcher = globalThis.fetch } = {}) {
  return {
    mode,
    getSnapshot(user, language) {
      if (mode !== 'mock') throw new Error('Synchronous snapshots are available only in mock mode');
      return createMockLearningPassport(user, language);
    },
    findCredential(passport, code) {
      const normalized = String(code || '').trim().toUpperCase();
      return passport?.credentials?.find(item => item.code === normalized) || null;
    },
    getDisplayStatus: getCredentialDisplayStatus,
    getExplorerUrl: getAvalancheExplorerUrl,
    async fetchPassport(learnerId) {
      requireApiBase(apiBaseUrl);
      const response = await fetcher(`${apiBaseUrl}/learning-passport/${encodeURIComponent(learnerId)}`, { credentials: 'same-origin' });
      if (!response.ok) throw Object.assign(new Error('Learning Passport request failed'), { code: 'PASSPORT_API_ERROR', status: response.status });
      return response.json();
    },
    async ingestAiEvaluation(payload) {
      requireApiBase(apiBaseUrl);
      const draft = createCredentialDraftFromAiEvaluation(payload);
      const response = await fetcher(`${apiBaseUrl}/learning-passport/evaluations`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, credential: draft }),
      });
      if (!response.ok) throw Object.assign(new Error('AI evaluation import failed'), { code: 'PASSPORT_API_ERROR', status: response.status });
      return response.json();
    },
  };
}
