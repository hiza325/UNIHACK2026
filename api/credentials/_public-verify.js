import { createCredentialStore } from './_store.js';
import { createAvalancheGateway, credentialIdFromCode } from './_avalanche.js';
import { AVALANCHE_FUJI_CONFIG, avalancheFujiTransactionUrl } from '../../avalanche-config.js';

const RATE_BUCKETS = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

function rateLimit(ip) {
  const now = Date.now();
  let bucket = RATE_BUCKETS.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    RATE_BUCKETS.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX;
}

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress || 'unknown');
}

const CODE_RE = /^[A-Z0-9-]{8,80}$/;

export async function handlePublicVerify(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const ip = clientIp(req);
  if (!rateLimit(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ status: 'UNAVAILABLE', error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' });
  }

  const code = String(req.query?.code || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    return res.status(400).json({
      status: 'INVALID_INPUT',
      error: 'Invalid certificate code format.',
      code: 'INVALID_CERTIFICATE_CODE',
    });
  }

  let credentialId;
  try {
    credentialId = credentialIdFromCode(code);
  } catch (e) {
    return res.status(400).json({
      status: 'INVALID_INPUT',
      error: 'Invalid certificate code.',
      code: 'INVALID_CERTIFICATE_CODE',
    });
  }

  let dbRow = null;
  try {
    const store = createCredentialStore();
    dbRow = await store.findByCode(code);
  } catch (e) {
    dbRow = null;
  }

  let gateway;
  try {
    gateway = await createAvalancheGateway({ write: false });
  } catch (e) {
    return res.status(503).json({
      status: 'UNAVAILABLE',
      error: 'Avalanche RPC unavailable.',
      code: e?.code || 'AVALANCHE_RPC_UNAVAILABLE',
      chainId: 43113,
      certificateCode: code,
    });
  }

  let onchain;
  try {
    onchain = await gateway.verifyCredential(credentialId);
  } catch (e) {
    return res.status(503).json({
      status: 'UNAVAILABLE',
      error: 'Avalanche RPC unavailable.',
      code: e?.code || 'AVALANCHE_RPC_UNAVAILABLE',
      chainId: 43113,
    });
  }

  if (!onchain || !onchain.exists) {
    return res.status(404).json({
      status: 'NOT_FOUND',
      code,
      chainId: 43113,
      network: 'Avalanche Fuji Testnet',
      contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress,
      credentialId,
      message: 'Credential not found on Avalanche Fuji.',
    });
  }

  const revoked = onchain.revoked === true;
  const valid = onchain.valid === true && !revoked;
  // Never report REVOKED unless the chain confirms revokedAt != 0.
  const status = revoked ? 'REVOKED' : (valid ? 'VALID' : 'INVALID');

  const txHash = (typeof dbRow?.issue_tx_hash === 'string') ? dbRow.issue_tx_hash : null;
  const explorerUrl = txHash ? avalancheFujiTransactionUrl(txHash) : null;

  return res.status(200).json({
    status,
    code,
    chainId: 43113,
    network: 'Avalanche Fuji Testnet',
    contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress,
    credentialId,
    onChain: {
      exists: true,
      valid: Boolean(onchain.valid),
      revoked,
      issuedAt: onchain.issuedAt || null,
      issuer: onchain.issuer || null,
      evidenceHash: onchain.evidenceHash || null,
    },
    transactionHash: txHash,
    explorerUrl,
    credential: dbRow ? {
      title: dbRow.title || null,
      skill: dbRow.skill || null,
      source: dbRow.source || null,
    } : null,
    message: status === 'VALID'
      ? 'Credential verified on Avalanche Fuji.'
      : status === 'REVOKED'
        ? 'Credential has been revoked.'
        : 'Credential is not valid.',
  });
}