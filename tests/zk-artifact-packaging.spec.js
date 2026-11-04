import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactPaths, artifactsReady, BUILD_DIR } from '../zk/lib/artifacts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function resolveIncludeFile(path) {
  return isAbsolute(path) ? path : join(ROOT, path);
}

test('Vercel packages only the read-only verification key and manifest', async () => {
  const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
  const functionConfig = config.functions?.['api/learning-records/index.js'];
  expect(functionConfig).toBeTruthy();
  const includeFiles = Array.isArray(functionConfig.includeFiles)
    ? functionConfig.includeFiles
    : [functionConfig.includeFiles];
  expect(includeFiles).toEqual(expect.arrayContaining([
    'zk/build/verification_key.json',
    'zk/build/manifest.json',
  ]));
  expect(includeFiles.some(path => /\.zkey$|\.wasm$|\.ptau$|\.r1cs$|\.wtns$/i.test(path))).toBe(false);
});

test('local bundle contains the required artifacts and pinned verification key', async () => {
  test.skip(!(await artifactsReady()), 'ZK build artifacts are not present; run `cd zk && npm run build`.');
  const paths = artifactPaths(BUILD_DIR);
  const config = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
  const includeFiles = config.functions['api/learning-records/index.js'].includeFiles;
  for (const relative of includeFiles) {
    const absolute = resolveIncludeFile(relative);
    await access(absolute);
  }

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
