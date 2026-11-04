#!/usr/bin/env node
/**
 * Build-time verification for the public ZK verification artifacts.
 *
 * The runtime only needs two public files:
 *   - zk/build/verification_key.json
 *   - zk/build/manifest.json
 *
 * This script fails closed when either file is missing, when the verification
 * key does not match the manifest, when a pinned SHA-256 is wrong, or when a
 * development setup tries to claim production readiness. It never reads or
 * packages proving keys, witness files or evaluator private keys.
 *
 * Usage:
 *   node scripts/zk-verification-artifacts.mjs --check
 *   node scripts/zk-verification-artifacts.mjs --write-lock [--force]
 *   node scripts/zk-verification-artifacts.mjs --dir <path> --skip-include-files
 *
 * Environment pins (recommended for packaging):
 *   ZK_VKEY_SHA256
 *   ZK_MANIFEST_SHA256
 *   ZK_PRODUCTION_VKEY_SHA256 (required only for productionReady manifests)
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HEX64 = /^[0-9a-f]{64}$/i;
const REQUIRED_ARTIFACTS = Object.freeze(['verification_key.json', 'manifest.json']);
const LOCK_SCHEMA = 'paradox-zk-verification-lock-v1';
const MANIFEST_SCHEMA = 'paradox-zk-build-manifest-v1';
const PROHIBITED = /\.(zkey|wasm|ptau|r1cs|wtns|sym)$/i;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArgs(argv) {
  const options = {
    check: true,
    writeLock: false,
    force: false,
    json: false,
    skipIncludeFiles: false,
    dir: process.env.ZK_ARTIFACT_DIR || 'zk/build',
    lock: process.env.ZK_ARTIFACT_LOCK || 'zk/verification-artifacts.lock.json',
    vercel: 'vercel.json',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--write-lock') { options.writeLock = true; options.check = false; }
    else if (arg === '--force') options.force = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--skip-include-files') options.skipIncludeFiles = true;
    else if (arg === '--dir') options.dir = argv[++index];
    else if (arg === '--lock') options.lock = argv[++index];
    else if (arg === '--vercel') options.vercel = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('See the header of scripts/zk-verification-artifacts.mjs for usage.\n');
      process.exit(0);
    } else {
      fail('ZK_ARTIFACT_ARGUMENT_INVALID', `Unknown argument: ${arg}`);
    }
  }
  if (!options.dir || !options.lock || !options.vercel) {
    fail('ZK_ARTIFACT_ARGUMENT_INVALID', 'Path arguments must not be empty');
  }
  return options;
}

async function readRequired(path, code, message) {
  try {
    return await readFile(path);
  } catch (error) {
    throw Object.assign(new Error(message), { code, cause: error });
  }
}

function parseJson(buffer, code, message) {
  try {
    return JSON.parse(Buffer.from(buffer).toString('utf8'));
  } catch {
    fail(code, message);
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function validateVerificationKey(vkey) {
  if (!vkey || typeof vkey !== 'object' || Array.isArray(vkey)) {
    fail('ZK_VKEY_INVALID', 'verification_key.json must be a JSON object');
  }
  if (vkey.protocol !== 'groth16' || vkey.curve !== 'bn128') {
    fail('ZK_VKEY_INVALID', 'verification key must use Groth16 on bn128');
  }
  if (!Number.isInteger(vkey.nPublic) || vkey.nPublic < 1 || vkey.nPublic > 64) {
    fail('ZK_VKEY_INVALID', 'verification key nPublic is invalid');
  }
  if (!Array.isArray(vkey.IC) || vkey.IC.length !== vkey.nPublic + 1) {
    fail('ZK_VKEY_INVALID', 'verification key IC length does not match nPublic');
  }
  for (const point of vkey.IC) {
    if (!Array.isArray(point) || point.length !== 3) {
      fail('ZK_VKEY_INVALID', 'verification key IC entry is invalid');
    }
  }
}

function validateManifest(manifest, vkey, vkeyHash) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('ZK_MANIFEST_INVALID', 'manifest.json must be a JSON object');
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA) {
    fail('ZK_MANIFEST_INVALID', `manifest schemaVersion must be ${MANIFEST_SCHEMA}`);
  }
  if (manifest.circuit?.name !== 'score_threshold') {
    fail('ZK_MANIFEST_INVALID', 'manifest circuit name must be score_threshold');
  }
  const circuitVersion = String(manifest.circuit?.version || '').trim();
  if (!circuitVersion || circuitVersion.length > 64) {
    fail('ZK_MANIFEST_INVALID', 'manifest circuit version is invalid');
  }
  if (manifest.circuit?.curve !== vkey.curve) {
    fail('ZK_MANIFEST_INVALID', 'manifest curve does not match the verification key');
  }
  if (manifest.circuit?.nPublicInputs !== vkey.nPublic) {
    fail('ZK_MANIFEST_INVALID', 'manifest public input count does not match the verification key');
  }
  if (String(manifest.groth16?.verificationKeySha256 || '').toLowerCase() !== vkeyHash) {
    fail('ZK_MANIFEST_VKEY_MISMATCH', 'manifest verificationKeySha256 does not match verification_key.json');
  }
  if (typeof manifest.trustedSetup?.productionReady !== 'boolean') {
    fail('ZK_MANIFEST_INVALID', 'manifest trustedSetup.productionReady must be boolean');
  }
  const mode = String(manifest.trustedSetup?.mode || '').trim();
  if (!mode) {
    fail('ZK_MANIFEST_INVALID', 'manifest trustedSetup.mode is required');
  }
  return { circuitVersion, mode };
}

function environmentPin(name) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return null;
  if (!HEX64.test(value)) {
    fail('ZK_ARTIFACT_PIN_INVALID', `${name} must be a 64-character SHA-256 hex value`);
  }
  return value;
}

function globToRegExp(glob) {
  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        source += '.*';
        index += 1;
        if (glob[index + 1] === '/') {
          source += '/?';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

async function checkIncludeFiles({ vercelPath, artifactDir, requiredRelativePaths }) {
  let config;
  try {
    config = JSON.parse(await readFile(vercelPath, 'utf8'));
  } catch {
    fail('ZK_VERCEL_CONFIG_INVALID', 'vercel.json is missing or invalid');
  }
  const includeFiles = config.functions?.['api/learning-records/index.js']?.includeFiles;
  if (typeof includeFiles !== 'string' || !includeFiles.trim()) {
    fail('ZK_INCLUDE_FILES_INVALID', 'functions["api/learning-records/index.js"].includeFiles must be a non-empty string glob');
  }
  if (PROHIBITED.test(includeFiles)) {
    fail('ZK_INCLUDE_FILES_PROHIBITED', 'includeFiles must not match proving or witness artifacts');
  }

  const pattern = includeFiles.trim().replace(/\\/g, '/');
  const matcher = globToRegExp(pattern);
  for (const relativePath of requiredRelativePaths) {
    if (!matcher.test(relativePath)) {
      fail('ZK_INCLUDE_FILES_MISSING', `includeFiles does not match ${relativePath}`);
    }
  }

  let entries;
  try {
    entries = await readdir(artifactDir, { withFileTypes: true });
  } catch {
    fail('ZK_ARTIFACT_DIR_UNAVAILABLE', 'artifact directory is unavailable');
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const relativePath = relative(ROOT, join(artifactDir, entry.name)).replace(/\\/g, '/');
    if (!matcher.test(relativePath)) continue;
    if (!REQUIRED_ARTIFACTS.includes(entry.name)) {
      fail('ZK_INCLUDE_FILES_UNEXPECTED', `includeFiles would package an unexpected file: ${entry.name}`);
    }
    if (PROHIBITED.test(entry.name)) {
      fail('ZK_INCLUDE_FILES_PROHIBITED', `includeFiles would package a prohibited file: ${entry.name}`);
    }
  }
  return pattern;
}

async function readLock(lockPath) {
  let buffer;
  try {
    buffer = await readFile(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('ZK_LOCK_UNAVAILABLE', 'artifact lock file is unreadable');
  }
  const lock = parseJson(buffer, 'ZK_LOCK_INVALID', 'artifact lock file is not valid JSON');
  if (lock.schemaVersion !== LOCK_SCHEMA) {
    fail('ZK_LOCK_INVALID', `artifact lock schemaVersion must be ${LOCK_SCHEMA}`);
  }
  return lock;
}

function checkLock(lock, { vkeyHash, manifestHash, classification, circuitVersion }) {
  if (!lock) return;
  if (String(lock.vkeySha256 || '').toLowerCase() !== vkeyHash) {
    fail('ZK_LOCK_VKEY_MISMATCH', 'artifact lock vkeySha256 does not match verification_key.json');
  }
  if (String(lock.manifestSha256 || '').toLowerCase() !== manifestHash) {
    fail('ZK_LOCK_MANIFEST_MISMATCH', 'artifact lock manifestSha256 does not match manifest.json');
  }
  if (lock.classification !== classification) {
    fail('ZK_LOCK_CLASSIFICATION_MISMATCH', 'artifact lock classification does not match the manifest');
  }
  if (String(lock.circuitVersion || '') !== circuitVersion) {
    fail('ZK_LOCK_CIRCUIT_MISMATCH', 'artifact lock circuitVersion does not match the manifest');
  }
}

async function writeLock(lockPath, payload, { force }) {
  let existing = null;
  try {
    existing = JSON.parse(await readFile(lockPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') fail('ZK_LOCK_INVALID', 'existing artifact lock is unreadable');
  }
  if (existing && !force) {
    const same = existing.vkeySha256 === payload.vkeySha256
      && existing.manifestSha256 === payload.manifestSha256
      && existing.classification === payload.classification
      && existing.circuitVersion === payload.circuitVersion;
    if (same) return false;
    fail('ZK_LOCK_EXISTS', 'artifact lock already exists with different hashes; use --force to replace it');
  }
  const temporary = `${lockPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(temporary, lockPath);
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifactDir = resolve(ROOT, options.dir);
  const lockPath = resolve(ROOT, options.lock);
  const vercelPath = resolve(ROOT, options.vercel);

  const vkeyBuffer = await readRequired(
    join(artifactDir, 'verification_key.json'),
    'ZK_VKEY_UNAVAILABLE',
    'verification_key.json is missing',
  );
  const manifestBuffer = await readRequired(
    join(artifactDir, 'manifest.json'),
    'ZK_MANIFEST_UNAVAILABLE',
    'manifest.json is missing',
  );

  const vkey = parseJson(vkeyBuffer, 'ZK_VKEY_INVALID', 'verification_key.json is not valid JSON');
  const manifest = parseJson(manifestBuffer, 'ZK_MANIFEST_INVALID', 'manifest.json is not valid JSON');
  const vkeyHash = sha256(vkeyBuffer);
  const manifestHash = sha256(manifestBuffer);

  validateVerificationKey(vkey);
  const { circuitVersion, mode } = validateManifest(manifest, vkey, vkeyHash);

  const productionReady = manifest.trustedSetup.productionReady === true;
  if (productionReady && mode === 'local-single-contributor') {
    fail('ZK_DEVELOPMENT_PRODUCTION_CLAIM', 'a local-single-contributor setup cannot be marked productionReady');
  }
  const classification = productionReady ? 'PRODUCTION' : 'DEMO';

  const vkeyPin = environmentPin('ZK_VKEY_SHA256');
  const manifestPin = environmentPin('ZK_MANIFEST_SHA256');
  const productionVkeyPin = environmentPin('ZK_PRODUCTION_VKEY_SHA256');

  if (vkeyPin && vkeyPin !== vkeyHash) {
    fail('ZK_VKEY_PIN_MISMATCH', 'verification_key.json does not match ZK_VKEY_SHA256');
  }
  if (manifestPin && manifestPin !== manifestHash) {
    fail('ZK_MANIFEST_PIN_MISMATCH', 'manifest.json does not match ZK_MANIFEST_SHA256');
  }

  if (productionReady) {
    if (!productionVkeyPin) {
      fail('ZK_PRODUCTION_VKEY_PIN_REQUIRED', 'ZK_PRODUCTION_VKEY_SHA256 is required for a production manifest');
    }
    if (productionVkeyPin !== vkeyHash) {
      fail('ZK_PRODUCTION_VKEY_PIN_MISMATCH', 'verification_key.json does not match ZK_PRODUCTION_VKEY_SHA256');
    }
    if (!manifestPin) {
      fail('ZK_MANIFEST_PIN_REQUIRED', 'ZK_MANIFEST_SHA256 is required for a production manifest');
    }
  } else {
    if (productionVkeyPin) {
      fail('ZK_PRODUCTION_PIN_ON_DEMO', 'ZK_PRODUCTION_VKEY_SHA256 must not be set for a development artifact');
    }
    if (manifest.trustedSetup.productionReady !== false) {
      fail('ZK_DEMO_PRODUCTION_CLAIM', 'development artifacts must set trustedSetup.productionReady=false');
    }
  }

  const lock = await readLock(lockPath);
  // --write-lock --force is the explicit way to re-pin changed artifacts.
  // Every other mode must match the existing lock.
  if (!(options.writeLock && options.force)) {
    checkLock(lock, { vkeyHash, manifestHash, classification, circuitVersion });
  }

  if (options.check && !lock && (!vkeyPin || !manifestPin)) {
    fail(
      'ZK_ARTIFACT_PIN_REQUIRED',
      'set ZK_VKEY_SHA256 and ZK_MANIFEST_SHA256, or commit a verification-artifacts lock file',
    );
  }

  let includeFiles = null;
  if (!options.skipIncludeFiles) {
    includeFiles = await checkIncludeFiles({
      vercelPath,
      artifactDir,
      requiredRelativePaths: REQUIRED_ARTIFACTS.map(name => relative(ROOT, join(artifactDir, name)).replace(/\\/g, '/')),
    });
  }

  const result = {
    ok: true,
    classification,
    circuitVersion,
    vkeySha256: vkeyHash,
    manifestSha256: manifestHash,
    artifacts: {
      vkey: relative(ROOT, join(artifactDir, 'verification_key.json')).replace(/\\/g, '/'),
      manifest: relative(ROOT, join(artifactDir, 'manifest.json')).replace(/\\/g, '/'),
    },
    includeFiles,
    lock: relative(ROOT, lockPath).replace(/\\/g, '/'),
    productionVerified: productionReady,
  };

  if (options.writeLock) {
    const payload = {
      schemaVersion: LOCK_SCHEMA,
      circuit: manifest.circuit.name,
      circuitVersion,
      classification,
      vkeySha256: vkeyHash,
      manifestSha256: manifestHash,
      generatedAt: new Date().toISOString(),
    };
    const changed = await writeLock(lockPath, payload, { force: options.force });
    result.lockWritten = changed;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`[zk-artifacts] OK ${classification} circuit=${circuitVersion}\n`);
    process.stdout.write(`[zk-artifacts] vkeySha256=${vkeyHash}\n`);
    process.stdout.write(`[zk-artifacts] manifestSha256=${manifestHash}\n`);
    if (includeFiles) process.stdout.write(`[zk-artifacts] includeFiles=${includeFiles}\n`);
    if (result.lockWritten !== undefined) {
      process.stdout.write(`[zk-artifacts] lock ${result.lockWritten ? 'written' : 'unchanged'}: ${result.lock}\n`);
    }
  }
}

main().catch(error => {
  process.stderr.write(`[zk-artifacts] FAIL ${error?.code || 'ZK_ARTIFACT_ERROR'}: ${error?.message || error}\n`);
  process.exitCode = 1;
});
