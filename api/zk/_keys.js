/**
 * Server-only key configuration for ZK Proof of Learning.
 *
 * Public material only:
 *   - trusted Ed25519 evaluator public keys (rotation-aware);
 *   - the Groth16 verification key, pinned by SHA-256;
 *   - circuit version and trusted-setup mode.
 *
 * The evaluator private key is intentionally not loaded here. Signing belongs to
 * a later, separately approved phase and must use KMS/HSM or a server secret.
 *
 * Production fails closed when the vkey hash is missing/mismatched, when the
 * manifest is not marked production-ready, or when only development setup is
 * available.
 */

import { createHash, createPublicKey } from 'node:crypto';
import { readFile as defaultReadFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_VKEY_PATH = fileURLToPath(new URL('../../zk/build/verification_key.json', import.meta.url));

const HEX64 = /^[0-9a-f]{64}$/i;
const SETUP_MODES = new Set(['production', 'development']);
const ISSUER_STATUSES = new Set(['active', 'retired', 'revoked']);
const ISSUER_ENVIRONMENTS = new Set(['production', 'demo']);

function keyError(message, code, status = 503, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

function resolvePath(value) {
  const path = String(value).trim();
  return isAbsolute(path) ? path : resolve(path);
}

function parseDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw keyError(`${field} is invalid`, 'ZK_KEY_CONFIG_INVALID', 503);
  return date;
}

function assertPublicPem(pem, keyId) {
  const text = String(pem ?? '').trim();
  if (!text || /PRIVATE KEY/i.test(text)) {
    throw keyError(`Trusted issuer ${keyId} must contain a public key only`, 'ZK_KEY_CONFIG_INVALID', 503);
  }
  if (!/BEGIN PUBLIC KEY/.test(text)) {
    throw keyError(`Trusted issuer ${keyId} public key must be PEM encoded`, 'ZK_KEY_CONFIG_INVALID', 503);
  }
  return text;
}

function normalizeIssuerEntries(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed).map(([keyId, value]) => (
      typeof value === 'string'
        ? { keyId, publicKeyPem: value }
        : { keyId, ...(value || {}) }
    ));
  }
  throw keyError('Trusted issuer configuration is invalid', 'ZK_KEY_CONFIG_INVALID', 503);
}

export async function loadTrustedIssuers({
  env = process.env,
  reader = defaultReadFile,
  now = new Date(),
} = {}) {
  let parsed;
  const inline = String(env.ZK_TRUSTED_ISSUERS_JSON || '').trim();
  if (inline) {
    try {
      parsed = JSON.parse(inline);
    } catch {
      throw keyError('Trusted issuer JSON is invalid', 'ZK_KEY_CONFIG_INVALID', 503);
    }
  } else {
    const file = String(env.ZK_TRUSTED_ISSUERS_FILE || '').trim();
    if (!file) throw keyError('Trusted issuer configuration is missing', 'ZK_KEY_CONFIG_MISSING', 503);
    try {
      parsed = JSON.parse((await reader(resolvePath(file))).toString('utf8'));
    } catch {
      throw keyError('Trusted issuer file is unavailable', 'ZK_KEY_CONFIG_INVALID', 503);
    }
  }

  const entries = normalizeIssuerEntries(parsed);
  if (!entries.length) throw keyError('No trusted issuers are configured', 'ZK_TRUSTED_ISSUERS_EMPTY', 503);

  const all = new Map();
  const active = new Map();
  const timestamp = new Date(now).getTime();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      throw keyError('Trusted issuer entry is invalid', 'ZK_KEY_CONFIG_INVALID', 503);
    }
    const keyId = String(entry.keyId || '').trim();
    if (!keyId || keyId.length > 100) {
      throw keyError('Trusted issuer key ID is invalid', 'ZK_KEY_CONFIG_INVALID', 503);
    }
    if (all.has(keyId)) {
      throw keyError(`Trusted issuer key ID is duplicated: ${keyId}`, 'ZK_KEY_CONFIG_INVALID', 503);
    }

    const status = String(entry.status || 'active').trim().toLowerCase();
    if (!ISSUER_STATUSES.has(status)) {
      throw keyError(`Trusted issuer ${keyId} status is invalid`, 'ZK_KEY_CONFIG_INVALID', 503);
    }
    // Safe default: a key is DEMO unless explicitly marked production. An
    // official proof therefore requires an explicit production key marker.
    const environment = String(entry.environment || 'demo').trim().toLowerCase();
    if (!ISSUER_ENVIRONMENTS.has(environment)) {
      throw keyError(`Trusted issuer ${keyId} environment is invalid`, 'ZK_KEY_CONFIG_INVALID', 503);
    }

    const notBefore = parseDate(entry.notBefore, `Trusted issuer ${keyId} notBefore`);
    const notAfter = parseDate(entry.notAfter, `Trusted issuer ${keyId} notAfter`);
    if (notBefore && notAfter && notAfter < notBefore) {
      throw keyError(`Trusted issuer ${keyId} validity window is invalid`, 'ZK_KEY_CONFIG_INVALID', 503);
    }

    let publicKey;
    try {
      publicKey = createPublicKey(assertPublicPem(entry.publicKeyPem, keyId));
    } catch (error) {
      if (error?.code === 'ZK_KEY_CONFIG_INVALID') throw error;
      throw keyError(`Trusted issuer ${keyId} public key is invalid`, 'ZK_KEY_CONFIG_INVALID', 503, error);
    }
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw keyError(`Trusted issuer ${keyId} must use Ed25519`, 'ZK_KEY_CONFIG_INVALID', 503);
    }

    const fingerprint = createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex');

    const usable = status === 'active'
      && (!notBefore || timestamp >= notBefore.getTime())
      && (!notAfter || timestamp <= notAfter.getTime());

    const record = Object.freeze({
      keyId,
      status,
      environment,
      publicKey,
      fingerprint,
      notBefore: notBefore ? notBefore.toISOString() : null,
      notAfter: notAfter ? notAfter.toISOString() : null,
      usable,
    });
    all.set(keyId, record);
    if (usable) active.set(keyId, record);
  }

  return { all, active };
}

export async function loadVerificationKey({
  env = process.env,
  reader = defaultReadFile,
} = {}) {
  const circuitVersion = String(env.ZK_CIRCUIT_VERSION || '').trim();
  if (!circuitVersion || circuitVersion.length > 64) {
    throw keyError('ZK circuit version is required', 'ZK_CIRCUIT_VERSION_REQUIRED', 503);
  }

  const setupMode = String(env.ZK_TRUSTED_SETUP_MODE || '').trim().toLowerCase();
  if (!SETUP_MODES.has(setupMode)) {
    throw keyError('ZK trusted setup mode is invalid', 'ZK_TRUSTED_SETUP_MODE_INVALID', 503);
  }

  const vkeyPath = resolvePath(env.ZK_VKEY_PATH || DEFAULT_VKEY_PATH);
  let vkeyBuffer;
  try {
    vkeyBuffer = await reader(vkeyPath);
  } catch (error) {
    throw keyError('ZK verification key is unavailable', 'ZK_VKEY_UNAVAILABLE', 503, error);
  }

  const expectedHash = String(env.ZK_VKEY_SHA256 || '').trim().toLowerCase();
  if (!HEX64.test(expectedHash)) {
    throw keyError('ZK verification key hash is required', 'ZK_VKEY_HASH_REQUIRED', 503);
  }
  const actualHash = createHash('sha256').update(vkeyBuffer).digest('hex');
  if (actualHash !== expectedHash) {
    throw keyError('ZK verification key hash does not match the pinned value', 'ZK_VKEY_HASH_MISMATCH', 503);
  }

  let vkey;
  try {
    vkey = JSON.parse(Buffer.from(vkeyBuffer).toString('utf8'));
  } catch {
    throw keyError('ZK verification key JSON is invalid', 'ZK_VKEY_INVALID', 503);
  }
  if (!vkey || typeof vkey !== 'object') {
    throw keyError('ZK verification key JSON is invalid', 'ZK_VKEY_INVALID', 503);
  }
  if (vkey.protocol !== 'groth16' || vkey.curve !== 'bn128') {
    throw keyError('ZK verification key protocol/curve is unsupported', 'ZK_VKEY_INVALID', 503);
  }
  if (vkey.nPublic !== 6 || !Array.isArray(vkey.IC) || vkey.IC.length !== 7) {
    throw keyError('ZK verification key does not match the score_threshold circuit', 'ZK_VKEY_INVALID', 503);
  }

  const manifestPath = resolvePath(
    env.ZK_TRUSTED_SETUP_MANIFEST || join(dirname(vkeyPath), 'manifest.json'),
  );
  let manifestBuffer;
  try {
    manifestBuffer = await reader(manifestPath);
  } catch (error) {
    throw keyError('ZK trusted setup manifest is required', 'ZK_TRUSTED_SETUP_MANIFEST_REQUIRED', 503, error);
  }
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(manifestBuffer).toString('utf8'));
  } catch {
    throw keyError('ZK trusted setup manifest is invalid', 'ZK_TRUSTED_SETUP_MANIFEST_INVALID', 503);
  }
  if (!manifest || typeof manifest !== 'object') {
    throw keyError('ZK trusted setup manifest is invalid', 'ZK_TRUSTED_SETUP_MANIFEST_INVALID', 503);
  }
  const manifestHash = createHash('sha256').update(manifestBuffer).digest('hex');

  let productionVerified = false;
  if (setupMode === 'development') {
    if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production') {
      throw keyError('Development trusted setup is forbidden in production', 'ZK_DEVELOPMENT_SETUP_FORBIDDEN', 503);
    }
    if (String(env.ZK_ALLOW_DEVELOPMENT_SETUP || '') !== '1') {
      throw keyError('Development trusted setup is not allowed', 'ZK_DEVELOPMENT_SETUP_NOT_ALLOWED', 503);
    }
  } else {
    if (manifest?.trustedSetup?.productionReady !== true
      || String(manifest?.trustedSetup?.mode || '') === 'local-single-contributor') {
      throw keyError('Development trusted setup cannot be used in production', 'ZK_DEVELOPMENT_SETUP_FORBIDDEN', 503);
    }

    // Independent production pins: a manifest claim alone is not enough.
    const productionVkeyPin = String(env.ZK_PRODUCTION_VKEY_SHA256 || '').trim().toLowerCase();
    if (!HEX64.test(productionVkeyPin)) {
      throw keyError('Production verification key pin is required', 'ZK_PRODUCTION_VKEY_PIN_REQUIRED', 503);
    }
    if (actualHash !== productionVkeyPin) {
      throw keyError('Verification key does not match the production pin', 'ZK_PRODUCTION_VKEY_PIN_MISMATCH', 503);
    }
    const productionManifestPin = String(env.ZK_MANIFEST_SHA256 || '').trim().toLowerCase();
    if (!HEX64.test(productionManifestPin)) {
      throw keyError('Production manifest pin is required', 'ZK_MANIFEST_PIN_REQUIRED', 503);
    }
    if (manifestHash !== productionManifestPin) {
      throw keyError('Trusted setup manifest does not match the production pin', 'ZK_MANIFEST_PIN_MISMATCH', 503);
    }
    productionVerified = true;
  }

  if (manifest?.circuit?.version && String(manifest.circuit.version) !== circuitVersion) {
    throw keyError('ZK circuit version does not match the manifest', 'ZK_CIRCUIT_VERSION_MISMATCH', 503);
  }

  return Object.freeze({
    verificationKey: vkey,
    vkeySha256: actualHash,
    vkeyPath,
    manifestPath,
    manifestHash,
    manifest,
    circuitVersion,
    setupMode,
    productionVerified,
  });
}

export async function loadKeyConfig({
  env = process.env,
  reader = defaultReadFile,
  now = new Date(),
} = {}) {
  const issuers = await loadTrustedIssuers({ env, reader, now });
  if (issuers.active.size === 0) {
    throw keyError('No active trusted issuer keys are configured', 'ZK_TRUSTED_ISSUERS_EMPTY', 503);
  }
  const verification = await loadVerificationKey({ env, reader });

  return Object.freeze({
    trustedIssuers: issuers.all,
    activeTrustedIssuers: issuers.active,
    activeIssuerKeyIds: Object.freeze([...issuers.active.keys()]),
    verificationKey: verification.verificationKey,
    vkeySha256: verification.vkeySha256,
    vkeyPath: verification.vkeyPath,
    circuitVersion: verification.circuitVersion,
    setupMode: verification.setupMode,
    productionVerified: verification.productionVerified,
    manifest: verification.manifest,
    manifestHash: verification.manifestHash,
  });
}

export function resolveIssuerKey(config, keyId) {
  const key = config?.activeTrustedIssuers?.get(String(keyId || '').trim());
  if (!key) {
    throw keyError('Attestation issuer is not trusted', 'ZK_UNTRUSTED_ISSUER', 403);
  }
  return key;
}
