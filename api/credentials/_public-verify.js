import { createCredentialStore } from './_store.js';
import { createAvalancheGateway, credentialIdFromCode } from './_avalanche.js';
import { metadataFieldsFromRow, verifyMetadataAttestation } from './_metadata-attestation.js';
import { AVALANCHE_FUJI_CONFIG, avalancheFujiTransactionUrl } from '../../avalanche-config.js';
import { verifyIssueTransaction } from './_transaction-verify.js';

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

export async function handlePublicVerify(req, res, { storeFactory = createCredentialStore, avalancheFactory = createAvalancheGateway } = {}) {
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

  if (code.startsWith('DEMO-')) {
    return res.status(200).json({ status: 'DEMO', transactionVerification: 'DEMO', code, message: 'Demo only — not verified on Avalanche.' });
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
  let databaseUnavailable = false;
  try {
    const store = storeFactory();
    dbRow = await store.findByCode(code);
  } catch (e) {
    databaseUnavailable = true;
  }

  if (['demo', 'mock'].includes(dbRow?.source)) {
    return res.status(200).json({ status: 'DEMO', transactionVerification: 'DEMO', code, message: 'Demo only — not verified on Avalanche.' });
  }

  let gateway;
  try {
    gateway = await avalancheFactory({ write: false });
  } catch (e) {
    console.error('[public-verify] gateway init failed code:', e?.code || 'unknown');
    return res.status(503).json({
      status: 'UNAVAILABLE',
      error: 'Avalanche RPC unavailable.',
      transactionVerification: 'UNAVAILABLE',
      code: e?.code || 'AVALANCHE_RPC_UNAVAILABLE',
      chainId: 43113,
      certificateCode: code,
    });
  }

  let onchain;
  try {
    onchain = await gateway.verifyCredential(credentialId);
  } catch (e) {
    console.error('[public-verify] verifyCredential failed code:', e?.code || 'unknown');
    return res.status(503).json({
      status: 'UNAVAILABLE',
      error: 'Avalanche RPC unavailable.',
      transactionVerification: 'UNAVAILABLE',
      code: e?.code || 'AVALANCHE_RPC_UNAVAILABLE',
      chainId: 43113,
    });
  }

  const transactionWarnings = [];
  const transactionVerification = databaseUnavailable ? 'UNAVAILABLE' : await verifyIssueTransaction({
    transactionHash: dbRow?.issue_tx_hash,
    credentialId,
    onchain,
    rpcUrls: gateway.rpcUrls,
    reportReason: reason => transactionWarnings.push(reason),
  });

  if (!onchain || !onchain.exists) {
    if (databaseUnavailable) {
      return res.status(503).json({ status: 'UNAVAILABLE', transactionVerification, code, message: 'No on-chain record found; pending issuance status is unavailable. Please retry.' });
    }
    if (['pending', 'submitting'].includes(dbRow?.blockchain_status)) {
      return res.status(200).json({ status: 'PENDING', transactionVerification, warnings: transactionWarnings, code, message: 'Issuance is pending. Not yet verified on Avalanche.' });
    }
    return res.status(404).json({
      status: 'NOT_FOUND',
      transactionVerification,
      warnings: transactionWarnings,
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
  // Blockchain status is decided only by the smart contract.
  const status = revoked ? 'REVOKED' : (valid ? 'VALID' : 'INVALID');

  // Metadata integrity is independent from blockchain status. Attestations are
  // created at issuance confirmation and never re-signed during verification.
  const metadataIntegrity = dbRow
    ? verifyMetadataAttestation(metadataFieldsFromRow(dbRow), dbRow.metadata_attestation)
    : 'UNVERIFIED';

  const onChainHash = typeof onchain.evidenceHash === 'string' ? onchain.evidenceHash : null;
  const databaseHash = typeof dbRow?.evidence_hash === 'string' ? dbRow.evidence_hash : null;
  const evidenceIntegrity = (onChainHash && databaseHash)
    ? (onChainHash.toLowerCase() === databaseHash.toLowerCase() ? 'MATCH' : 'MISMATCH')
    : 'UNKNOWN';

  const warnings = [...transactionWarnings];
  if (metadataIntegrity === 'MISMATCH') warnings.push('METADATA_MISMATCH');
  if (evidenceIntegrity === 'MISMATCH') warnings.push('EVIDENCE_HASH_MISMATCH');

  const txHash = /^0x[0-9a-fA-F]{64}$/.test(dbRow?.issue_tx_hash || '') ? dbRow.issue_tx_hash : null;
  const explorerUrl = txHash ? avalancheFujiTransactionUrl(txHash) : null;

  return res.status(200).json({
    status,
    transactionVerification,
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
      evidenceHash: onChainHash,
    },
    metadata: {
      integrity: metadataIntegrity,
      attestedAt: dbRow?.metadata_attested_at || null,
    },
    evidence: {
      integrity: evidenceIntegrity,
      onChainHash,
      databaseHash,
    },
    warnings,
    transactionHash: txHash,
    explorerUrl,
    credential: dbRow ? {
      title: dbRow.title || null,
      skill: dbRow.skill || null,
      source: dbRow.source || null,
      isTest: Boolean(dbRow.is_test) || String(dbRow.credential_code || '').toUpperCase().startsWith('PXP-TEST-'),
      metadataIntegrity,
    } : null,
    message: status === 'VALID'
      ? 'Credential verified on Avalanche Fuji.'
      : status === 'REVOKED'
        ? 'Credential has been revoked.'
        : 'Credential is not valid.',
  });
}
