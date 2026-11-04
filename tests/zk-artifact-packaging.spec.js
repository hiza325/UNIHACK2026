import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactPaths, artifactsReady, BUILD_DIR } from '../zk/lib/artifacts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REQUIRED_ARTIFACTS = ['verification_key.json', 'manifest.json'];

test('Vercel packages only the read-only verification key and manifest', async () => {
  const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
  const functionConfig = config.functions?.['api/learning-records/index.js'];
  expect(functionConfig).toBeTruthy();
  // Vercel's schema requires includeFiles to be a string glob, not an array.
  expect(typeof functionConfig.includeFiles).toBe('string');
  expect(functionConfig.includeFiles).toBe('zk/build/*.json');
  expect(functionConfig.includeFiles).not.toMatch(/\.zkey|\.wasm|\.ptau|\.r1cs|\.wtns/i);
});

test('local bundle contains the required artifacts and pinned verification key', async () => {
  test.skip(!(await artifactsReady()), 'ZK build artifacts are not present; run `cd zk && npm run build`.');
  const paths = artifactPaths(BUILD_DIR);
  const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
  const includeFiles = config.functions['api/learning-records/index.js'].includeFiles;
  expect(includeFiles).toBe('zk/build/*.json');

  for (const name of REQUIRED_ARTIFACTS) {
    await access(join(BUILD_DIR, name));
  }

  // The wildcard must only match the two public JSON artifacts. The build
  // directory also contains proving material locally; it must not be bundled.
  const jsonArtifacts = (await readdir(BUILD_DIR))
    .filter(name => name.toLowerCase().endsWith('.json'))
    .sort();
  expect(jsonArtifacts).toEqual([...REQUIRED_ARTIFACTS].sort());

  const vkeyBuffer = await readFile(paths.vkey);
  const manifestBuffer = await readFile(paths.manifest);
  const vkeyHash = createHash('sha256').update(vkeyBuffer).digest('hex');
  const manifestHash = createHash('sha256').update(manifestBuffer).digest('hex');
  const manifest = JSON.parse(manifestBuffer.toString('utf8'));

  expect(vkeyHash).toMatch(/^[0-9a-f]{64}$/);
  expect(manifestHash).toMatch(/^[0-9a-f]{64}$/);
  expect(manifest.circuit?.name).toBe('score_threshold');
  expect(manifest.trustedSetup?.productionReady).toBe(false);
  expect(manifest.trustedSetup?.mode).toBe('local-single-contributor');
  expect(vkeyBuffer.length).toBeLessThan(1024 * 1024);
  expect(manifestBuffer.length).toBeLessThan(64 * 1024);
});
