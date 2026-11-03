import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ZK_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BUILD_DIR = join(ZK_ROOT, 'build');

export function artifactPaths(buildDir = BUILD_DIR) {
  return {
    buildDir,
    wasm: join(buildDir, 'score_threshold_js', 'score_threshold.wasm'),
    zkey: join(buildDir, 'score_threshold.zkey'),
    vkey: join(buildDir, 'verification_key.json'),
    r1cs: join(buildDir, 'score_threshold.r1cs'),
    verifierSource: join(buildDir, 'Groth16Verifier.sol'),
    manifest: join(buildDir, 'manifest.json'),
  };
}

export async function artifactsReady(buildDir = BUILD_DIR) {
  const paths = artifactPaths(buildDir);
  try {
    await Promise.all([access(paths.wasm), access(paths.zkey), access(paths.vkey)]);
    return true;
  } catch {
    return false;
  }
}

export function projectRelative(path) {
  return path.startsWith(ZK_ROOT) ? path.slice(dirname(ZK_ROOT).length + 1) : path;
}
