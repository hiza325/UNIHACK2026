import { expect, test } from '@playwright/test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadKeyConfig } from '../api/zk/_keys.js';
import { classifyProofSnapshot } from '../api/zk/_policy.js';
import { createZkRouter, resetZkRateLimit } from '../api/zk/_router.js';

const PROOF_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function vkeyFixture() {
  return {
    protocol: 'groth16',
    curve: 'bn128',
    nPublic: 6,
    IC: Array.from({ length: 7 }, (_, index) => [String(index + 1), String(index + 2), '1']),
  };
}

function manifestFixture(vkeyText, {
  productionReady = false,
  mode = 'local-single-contributor',
} = {}) {
  return {
    schemaVersion: 'paradox-zk-build-manifest-v1',
    circuit: {
      name: 'score_threshold',
      version: '1.0.0',
      curve: 'bn128',
      nPublicInputs: 6,
    },
    groth16: {
      verificationKeySha256: createHash('sha256').update(vkeyText).digest('hex'),
    },
    trustedSetup: { mode, productionReady },
  };
}

async function writeFixture({ vkey = vkeyFixture(), manifest } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'paradox-zk-preview-'));
  const vkeyText = JSON.stringify(vkey);
  const manifestText = JSON.stringify(manifest ?? manifestFixture(vkeyText));
  const vkeyPath = join(dir, 'verification_key.json');
  const manifestPath = join(dir, 'manifest.json');
  await writeFile(vkeyPath, vkeyText);
  await writeFile(manifestPath, manifestText);
  return {
    dir,
    vkeyPath,
    manifestPath,
    vkeyHash: createHash('sha256').update(vkeyText).digest('hex'),
    manifestHash: createHash('sha256').update(manifestText).digest('hex'),
  };
}

function issuerJson(publicKeyPem, environment = 'demo') {
  return JSON.stringify([{
    keyId: 'issuer-1',
    publicKeyPem,
    status: 'active',
    environment,
  }]);
}

function keyEnv(fixture, { publicKeyPem, overrides = {} } = {}) {
  return {
    NODE_ENV: 'test',
    ZK_CIRCUIT_VERSION: '1.0.0',
    ZK_TRUSTED_SETUP_MODE: 'development',
    ZK_ALLOW_DEVELOPMENT_SETUP: '1',
    ZK_VKEY_PATH: fixture.vkeyPath,
    ZK_VKEY_SHA256: fixture.vkeyHash,
    ZK_TRUSTED_SETUP_MANIFEST: fixture.manifestPath,
    ZK_TRUSTED_ISSUERS_JSON: issuerJson(publicKeyPem),
    ...overrides,
  };
}

function previewEnv(fixture, publicKeyPem, overrides = {}) {
  const env = keyEnv(fixture, {
    publicKeyPem,
    overrides: {
      NODE_ENV: 'production',
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      ZK_PREVIEW_DEMO: '1',
      ...overrides,
    },
  });
  // Preview DEMO must not depend on the local-development allow flag.
  delete env.ZK_ALLOW_DEVELOPMENT_SETUP;
  return env;
}

function productionEnv(fixture, publicKeyPem, overrides = {}) {
  return keyEnv(fixture, {
    publicKeyPem,
    overrides: {
      NODE_ENV: 'test',
      ZK_TRUSTED_SETUP_MODE: 'production',
      ZK_PRODUCTION_VKEY_SHA256: fixture.vkeyHash,
      ZK_MANIFEST_SHA256: fixture.manifestHash,
      ...overrides,
    },
  });
}

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('preview + explicit DEMO flag allows development setup but never OFFICIAL', async () => {
  const fixture = await writeFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const config = await loadKeyConfig({
      env: previewEnv(fixture, publicKeyPem, {
        ZK_TRUSTED_ISSUERS_JSON: issuerJson(publicKeyPem, 'production'),
      }),
    });
    expect(config.setupMode).toBe('development');
    expect(config.previewDemo).toBe(true);
    expect(config.productionVerified).toBe(false);

    const classification = classifyProofSnapshot({
      credential: {
        is_test: false,
        source: 'ai-evaluation',
        credential_code: 'PXP-CERT-001',
      },
      keyConfig: config,
      issuerKeyId: 'issuer-1',
    });
    expect(classification.proofMode).toBe('demo');
    expect(classification.credentialIsTest).toBe(false);
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('preview without DEMO flag is denied', async () => {
  const fixture = await writeFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const env = previewEnv(fixture, publicKeyPem);
    delete env.ZK_PREVIEW_DEMO;
    await expect(loadKeyConfig({ env })).rejects.toMatchObject({
      code: 'ZK_PREVIEW_DEMO_REQUIRED',
      status: 503,
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('preview marker without trusted VERCEL=1 is denied', async () => {
  const fixture = await writeFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const env = previewEnv(fixture, publicKeyPem);
    delete env.VERCEL;
    await expect(loadKeyConfig({ env })).rejects.toMatchObject({
      code: 'ZK_DEPLOYMENT_ENV_UNTRUSTED',
      status: 503,
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('production deployment denies development setup even with DEMO flag', async () => {
  const fixture = await writeFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const env = keyEnv(fixture, {
      publicKeyPem,
      overrides: {
        NODE_ENV: 'production',
        VERCEL: '1',
        VERCEL_ENV: 'production',
        ZK_PREVIEW_DEMO: '1',
      },
    });
    await expect(loadKeyConfig({ env })).rejects.toMatchObject({
      code: 'ZK_DEVELOPMENT_SETUP_FORBIDDEN',
      status: 503,
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('local development still requires the existing explicit allow flag', async () => {
  const fixture = await writeFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const allowed = keyEnv(fixture, { publicKeyPem });
    const config = await loadKeyConfig({ env: allowed });
    expect(config.setupMode).toBe('development');
    expect(config.previewDemo).toBe(false);
    expect(config.productionVerified).toBe(false);

    const denied = keyEnv(fixture, { publicKeyPem });
    delete denied.ZK_ALLOW_DEVELOPMENT_SETUP;
    await expect(loadKeyConfig({ env: denied })).rejects.toMatchObject({
      code: 'ZK_DEVELOPMENT_SETUP_NOT_ALLOWED',
      status: 503,
    });

    const productionLocal = keyEnv(fixture, {
      publicKeyPem,
      overrides: { NODE_ENV: 'production' },
    });
    await expect(loadKeyConfig({ env: productionLocal })).rejects.toMatchObject({
      code: 'ZK_DEVELOPMENT_SETUP_FORBIDDEN',
      status: 503,
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('missing or wrong vkey pin is denied in preview DEMO mode', async () => {
  const fixture = await writeFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const missing = previewEnv(fixture, publicKeyPem);
    delete missing.ZK_VKEY_SHA256;
    await expect(loadKeyConfig({ env: missing })).rejects.toMatchObject({
      code: 'ZK_VKEY_HASH_REQUIRED',
      status: 503,
    });

    const wrong = previewEnv(fixture, publicKeyPem, { ZK_VKEY_SHA256: '00'.repeat(32) });
    await expect(loadKeyConfig({ env: wrong })).rejects.toMatchObject({
      code: 'ZK_VKEY_HASH_MISMATCH',
      status: 503,
    });
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('tampered or mismatched manifest is denied', async () => {
  const fixture = await writeFixture();
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    await writeFile(fixture.manifestPath, '{not-json');
    await expect(loadKeyConfig({ env: previewEnv(fixture, publicKeyPem) })).rejects.toMatchObject({
      code: 'ZK_TRUSTED_SETUP_MANIFEST_INVALID',
      status: 503,
    });

    const productionFixture = await writeFixture({
      manifest: manifestFixture(JSON.stringify(vkeyFixture()), {
        productionReady: true,
        mode: 'multi-party-ceremony',
      }),
    });
    try {
      const wrongManifestPin = productionEnv(productionFixture, publicKeyPem, {
        ZK_MANIFEST_SHA256: '00'.repeat(32),
      });
      await expect(loadKeyConfig({ env: wrongManifestPin })).rejects.toMatchObject({
        code: 'ZK_MANIFEST_PIN_MISMATCH',
        status: 503,
      });
    } finally {
      await rm(productionFixture.dir, { recursive: true, force: true });
    }
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('OFFICIAL requires independent production pins and is never allowed on preview', async () => {
  const fixture = await writeFixture({
    manifest: manifestFixture(JSON.stringify(vkeyFixture()), {
      productionReady: true,
      mode: 'multi-party-ceremony',
    }),
  });
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const missingProductionPin = productionEnv(fixture, publicKeyPem);
    delete missingProductionPin.ZK_PRODUCTION_VKEY_SHA256;
    await expect(loadKeyConfig({ env: missingProductionPin })).rejects.toMatchObject({
      code: 'ZK_PRODUCTION_VKEY_PIN_REQUIRED',
    });

    const missingManifestPin = productionEnv(fixture, publicKeyPem);
    delete missingManifestPin.ZK_MANIFEST_SHA256;
    await expect(loadKeyConfig({ env: missingManifestPin })).rejects.toMatchObject({
      code: 'ZK_MANIFEST_PIN_REQUIRED',
    });

    const configured = productionEnv(fixture, publicKeyPem, {
      ZK_TRUSTED_ISSUERS_JSON: issuerJson(publicKeyPem, 'production'),
    });
    const config = await loadKeyConfig({ env: configured });
    expect(config.productionVerified).toBe(true);
    expect(config.previewDemo).toBe(false);
    expect(classifyProofSnapshot({
      credential: {
        is_test: false,
        source: 'ai-evaluation',
        credential_code: 'PXP-CERT-001',
      },
      keyConfig: config,
      issuerKeyId: 'issuer-1',
    }).proofMode).toBe('official');

    const previewConfigured = previewEnv(fixture, publicKeyPem, {
      ZK_TRUSTED_SETUP_MODE: 'production',
      ZK_PRODUCTION_VKEY_SHA256: fixture.vkeyHash,
      ZK_MANIFEST_SHA256: fixture.manifestHash,
      ZK_TRUSTED_ISSUERS_JSON: issuerJson(publicKeyPem, 'production'),
    });
    const previewConfig = await loadKeyConfig({ env: previewConfigured });
    expect(previewConfig.productionVerified).toBe(false);
    expect(previewConfig.previewDemo).toBe(true);
    expect(classifyProofSnapshot({
      credential: {
        is_test: false,
        source: 'ai-evaluation',
        credential_code: 'PXP-CERT-001',
      },
      keyConfig: previewConfig,
      issuerKeyId: 'issuer-1',
    }).proofMode).toBe('demo');
  } finally {
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('client cannot override classification or proof mode', async () => {
  resetZkRateLimit();
  let verificationCalled = false;
  const router = createZkRouter({
    storeFactory: () => ({ findById: async () => null }),
    keyLoader: async () => {
      throw new Error('key loader must not run for an invalid body');
    },
    verificationFactory: () => {
      verificationCalled = true;
      return { verify: async () => ({ valid: true }) };
    },
    gatewayFactory: async () => ({ verifyCredential: async () => ({}) }),
  });
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      proofId: PROOF_ID,
      classification: 'official',
      proofMode: 'official',
    }),
  };
  const res = response();
  await router({ action: 'verifyProof', req, res, proofId: undefined });
  expect(res.statusCode).toBe(400);
  expect(res.body).toMatchObject({ code: 'ZK_INVALID_BODY' });
  expect(verificationCalled).toBe(false);
});
