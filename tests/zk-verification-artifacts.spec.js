import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { artifactsReady } from '../zk/lib/artifacts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'zk-verification-artifacts.mjs');
const execFileAsync = promisify(execFile);
const PINS = ['ZK_VKEY_SHA256', 'ZK_MANIFEST_SHA256', 'ZK_PRODUCTION_VKEY_SHA256'];

function vkeyFixture(nPublic = 6) {
  return {
    protocol: 'groth16',
    curve: 'bn128',
    nPublic,
    IC: Array.from({ length: nPublic + 1 }, (_, index) => [
      String(index + 1), String(index + 2), '1',
    ]),
  };
}

function manifestFixture(vkeyText, {
  productionReady = false,
  mode = 'local-single-contributor',
  circuitVersion = '1.0.0',
  nPublicInputs = 6,
} = {}) {
  return {
    schemaVersion: 'paradox-zk-build-manifest-v1',
    circuit: {
      name: 'score_threshold',
      version: circuitVersion,
      curve: 'bn128',
      nPublicInputs,
    },
    groth16: {
      verificationKeySha256: createHash('sha256').update(vkeyText).digest('hex'),
    },
    trustedSetup: { mode, productionReady },
  };
}

async function fixture({ vkey = vkeyFixture(), manifest, writeManifest = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'paradox-zk-artifacts-'));
  const vkeyText = JSON.stringify(vkey);
  const manifestText = JSON.stringify(manifest ?? manifestFixture(vkeyText));
  await writeFile(join(dir, 'verification_key.json'), vkeyText);
  if (writeManifest) await writeFile(join(dir, 'manifest.json'), manifestText);
  return {
    dir,
    vkeyText,
    manifestText,
    vkeyHash: createHash('sha256').update(vkeyText).digest('hex'),
    manifestHash: createHash('sha256').update(manifestText).digest('hex'),
  };
}

async function run(args, env = {}) {
  const cleanEnv = { ...process.env };
  for (const key of PINS) delete cleanEnv[key];
  Object.assign(cleanEnv, env);
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: cleanEnv,
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
}

test('valid DEMO artifacts pass with independent pins', async () => {
  const item = await fixture();
  try {
    const result = await run(
      ['--check', '--json', '--skip-include-files', '--dir', item.dir, '--lock', join(item.dir, 'lock.json')],
      { ZK_VKEY_SHA256: item.vkeyHash, ZK_MANIFEST_SHA256: item.manifestHash },
    );
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      ok: true,
      classification: 'DEMO',
      circuitVersion: '1.0.0',
      vkeySha256: item.vkeyHash,
      manifestSha256: item.manifestHash,
      productionVerified: false,
    });
  } finally {
    await cleanup(item.dir);
  }
});

test('missing and tampered artifacts fail closed', async () => {
  const missing = await fixture({ writeManifest: false });
  try {
    let result = await run(['--check', '--skip-include-files', '--dir', missing.dir]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_MANIFEST_UNAVAILABLE');

    await writeFile(join(missing.dir, 'verification_key.json'), JSON.stringify(vkeyFixture()));
    await rm(join(missing.dir, 'verification_key.json'));
    result = await run(['--check', '--skip-include-files', '--dir', missing.dir]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_VKEY_UNAVAILABLE');
  } finally {
    await cleanup(missing.dir);
  }

  const tampered = await fixture();
  try {
    const tamperedVkey = vkeyFixture();
    tamperedVkey.IC[1][0] = '999999';
    const tamperedVkeyText = JSON.stringify(tamperedVkey);
    await writeFile(join(tampered.dir, 'verification_key.json'), tamperedVkeyText);
    await writeFile(
      join(tampered.dir, 'manifest.json'),
      JSON.stringify(manifestFixture(tamperedVkeyText)),
    );
    // The manifest now matches the replaced vkey, but the old independent pin
    // must still reject it.
    const result = await run(
      ['--check', '--skip-include-files', '--dir', tampered.dir, '--lock', join(tampered.dir, 'lock.json')],
      { ZK_VKEY_SHA256: tampered.vkeyHash, ZK_MANIFEST_SHA256: tampered.manifestHash },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_VKEY_PIN_MISMATCH');
  } finally {
    await cleanup(tampered.dir);
  }
});

test('wrong pins fail closed', async () => {
  const item = await fixture();
  try {
    let result = await run(
      ['--check', '--skip-include-files', '--dir', item.dir],
      { ZK_VKEY_SHA256: '00'.repeat(32), ZK_MANIFEST_SHA256: item.manifestHash },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_VKEY_PIN_MISMATCH');

    result = await run(
      ['--check', '--skip-include-files', '--dir', item.dir],
      { ZK_VKEY_SHA256: item.vkeyHash, ZK_MANIFEST_SHA256: '00'.repeat(32) },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_MANIFEST_PIN_MISMATCH');
  } finally {
    await cleanup(item.dir);
  }
});

test('development setup cannot claim production readiness', async () => {
  const vkey = vkeyFixture();
  const item = await fixture({
    vkey,
    manifest: manifestFixture(JSON.stringify(vkey), {
      productionReady: true,
      mode: 'local-single-contributor',
    }),
  });
  try {
    const result = await run(
      ['--check', '--skip-include-files', '--dir', item.dir],
      {
        ZK_VKEY_SHA256: item.vkeyHash,
        ZK_MANIFEST_SHA256: item.manifestHash,
        ZK_PRODUCTION_VKEY_SHA256: item.vkeyHash,
      },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_DEVELOPMENT_PRODUCTION_CLAIM');
  } finally {
    await cleanup(item.dir);
  }
});

test('production manifest requires independent production pins', async () => {
  const vkey = vkeyFixture();
  const item = await fixture({
    vkey,
    manifest: manifestFixture(JSON.stringify(vkey), {
      productionReady: true,
      mode: 'multi-party-ceremony',
    }),
  });
  try {
    const lockPath = join(item.dir, 'lock.json');
    let result = await run(
      ['--check', '--skip-include-files', '--dir', item.dir, '--lock', lockPath],
      { ZK_VKEY_SHA256: item.vkeyHash, ZK_MANIFEST_SHA256: item.manifestHash },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_PRODUCTION_VKEY_PIN_REQUIRED');

    result = await run(
      ['--check', '--skip-include-files', '--dir', item.dir, '--lock', lockPath],
      { ZK_VKEY_SHA256: item.vkeyHash, ZK_PRODUCTION_VKEY_SHA256: item.vkeyHash },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_MANIFEST_PIN_REQUIRED');

    result = await run(
      ['--check', '--json', '--skip-include-files', '--dir', item.dir, '--lock', lockPath],
      {
        ZK_VKEY_SHA256: item.vkeyHash,
        ZK_MANIFEST_SHA256: item.manifestHash,
        ZK_PRODUCTION_VKEY_SHA256: item.vkeyHash,
      },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ classification: 'PRODUCTION', productionVerified: true });
  } finally {
    await cleanup(item.dir);
  }
});

test('lock file pins artifacts and detects replacement', async () => {
  const item = await fixture();
  const lockPath = join(item.dir, 'lock.json');
  try {
    let result = await run(
      ['--write-lock', '--json', '--skip-include-files', '--dir', item.dir, '--lock', lockPath],
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).lockWritten).toBe(true);

    result = await run(['--check', '--json', '--skip-include-files', '--dir', item.dir, '--lock', lockPath]);
    expect(result.code).toBe(0);

    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    expect(lock).toMatchObject({
      schemaVersion: 'paradox-zk-verification-lock-v1',
      classification: 'DEMO',
      vkeySha256: item.vkeyHash,
      manifestSha256: item.manifestHash,
    });

    lock.vkeySha256 = '00'.repeat(32);
    await writeFile(lockPath, JSON.stringify(lock));
    result = await run(['--check', '--skip-include-files', '--dir', item.dir, '--lock', lockPath]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_LOCK_VKEY_MISMATCH');
  } finally {
    await cleanup(item.dir);
  }
});

test('missing lock and missing pins fail closed', async () => {
  const item = await fixture();
  try {
    const result = await run(
      ['--check', '--skip-include-files', '--dir', item.dir, '--lock', join(item.dir, 'missing-lock.json')],
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_ARTIFACT_PIN_REQUIRED');
  } finally {
    await cleanup(item.dir);
  }
});

test('repository artifacts pass the build-time check with the lock file', async () => {
  test.skip(!(await artifactsReady()), 'ZK build artifacts are not present; run `cd zk && npm run build`.');
  const result = await run(['--check', '--json']);
  expect(result.code).toBe(0, result.stderr);
  const payload = JSON.parse(result.stdout);
  expect(payload).toMatchObject({
    ok: true,
    classification: 'DEMO',
    circuitVersion: '1.0.0',
    productionVerified: false,
    includeFiles: 'zk/build/*.json',
  });
  expect(payload.vkeySha256).toMatch(/^[0-9a-f]{64}$/);
  expect(payload.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
});

test('Vercel includeFiles must be a safe string glob', async () => {
  const item = await fixture();
  const configPath = join(item.dir, 'vercel.json');
  const repoPins = {
    ZK_VKEY_SHA256: createHash('sha256')
      .update(await readFile(join(ROOT, 'zk/build/verification_key.json')))
      .digest('hex'),
    ZK_MANIFEST_SHA256: createHash('sha256')
      .update(await readFile(join(ROOT, 'zk/build/manifest.json')))
      .digest('hex'),
  };
  const writeConfig = includeFiles => writeFile(configPath, JSON.stringify({
    functions: { 'api/learning-records/index.js': { includeFiles } },
  }));
  try {
    await writeConfig(['zk/build/verification_key.json', 'zk/build/manifest.json']);
    let result = await run(
      ['--check', '--dir', 'zk/build', '--vercel', configPath, '--lock', join(item.dir, 'lock.json')],
      repoPins,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_INCLUDE_FILES_INVALID');

    await writeConfig('zk/build/*.zkey');
    result = await run(
      ['--check', '--dir', 'zk/build', '--vercel', configPath, '--lock', join(item.dir, 'lock.json')],
      repoPins,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_INCLUDE_FILES_PROHIBITED');

    // Use a temp artifact directory with an extra JSON file so this case does
    // not depend on local proving artifacts that CI intentionally does not have.
    const tempGlob = `${relative(ROOT, item.dir).replace(/\\/g, '/')}/*.json`;
    await writeFile(join(item.dir, 'unexpected.json'), '{}');
    await writeConfig(tempGlob);
    result = await run(
      ['--check', '--dir', item.dir, '--vercel', configPath, '--lock', join(item.dir, 'lock.json')],
      {
        ZK_VKEY_SHA256: item.vkeyHash,
        ZK_MANIFEST_SHA256: item.manifestHash,
      },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ZK_INCLUDE_FILES_UNEXPECTED');
  } finally {
    await cleanup(item.dir);
  }
});
