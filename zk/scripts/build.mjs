#!/usr/bin/env node
/**
 * Reproducible local build for the ZK Proof of Learning MVP.
 *
 * Stages:
 *   1. compile circuits/score_threshold.circom with Circom 2
 *   2. create a LOCAL development powers-of-tau file (power 12)
 *   3. run Groth16 circuit setup and export the verification key
 *
 * The generated files live in zk/build/ and are gitignored. This is a
 * development setup, NOT a production trusted ceremony. See docs.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ZK_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD_DIR = join(ZK_ROOT, 'build');
const CIRCUIT_SOURCE = join(ZK_ROOT, 'circuits', 'score_threshold.circom');
const PTAU_POWER = 12;

const PATHS = {
  r1cs: join(BUILD_DIR, 'score_threshold.r1cs'),
  wasm: join(BUILD_DIR, 'score_threshold_js', 'score_threshold.wasm'),
  sym: join(BUILD_DIR, 'score_threshold.sym'),
  ptau0: join(BUILD_DIR, `pot${PTAU_POWER}_0000.ptau`),
  ptau1: join(BUILD_DIR, `pot${PTAU_POWER}_0001.ptau`),
  ptauFinal: join(BUILD_DIR, `pot${PTAU_POWER}_final.ptau`),
  zkey0: join(BUILD_DIR, 'score_threshold_0000.zkey'),
  zkey: join(BUILD_DIR, 'score_threshold.zkey'),
  vkey: join(BUILD_DIR, 'verification_key.json'),
  verifier: join(BUILD_DIR, 'Groth16Verifier.sol'),
  manifest: join(BUILD_DIR, 'manifest.json'),
};

const SNARKJS_CLI = join(ZK_ROOT, 'node_modules', 'snarkjs', 'build', 'cli.cjs');

function log(message) {
  process.stdout.write(`[zk-build] ${message}\n`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ZK_ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function snark(args, options = {}) {
  return run(process.execPath, [SNARKJS_CLI, ...args], options);
}

async function sha256File(path) {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

/** Reads the r1cs header directly to avoid loading the whole constraint system. */
async function readR1csHeader(path) {
  const buffer = await readFile(path);
  if (buffer.subarray(0, 4).toString('utf8') !== 'r1cs') throw new Error('r1cs magic is invalid');
  let offset = 4;
  const version = buffer.readUInt32LE(offset);
  offset += 4;
  const sections = buffer.readUInt32LE(offset);
  offset += 4;

  for (let index = 0; index < sections; index += 1) {
    const type = buffer.readUInt32LE(offset);
    offset += 4;
    const size = Number(buffer.readBigUInt64LE(offset));
    offset += 8;
    if (type === 1) {
      const fieldSize = buffer.readUInt32LE(offset);
      let cursor = offset + 4 + fieldSize;
      const nWires = buffer.readUInt32LE(cursor); cursor += 4;
      const nPubOut = buffer.readUInt32LE(cursor); cursor += 4;
      const nPubIn = buffer.readUInt32LE(cursor); cursor += 4;
      const nPrvIn = buffer.readUInt32LE(cursor); cursor += 4;
      const nLabels = Number(buffer.readBigUInt64LE(cursor)); cursor += 8;
      const nConstraints = buffer.readUInt32LE(cursor);
      return {
        version,
        nVars: nWires,
        nWires,
        nOutputs: nPubOut,
        nPubInputs: nPubIn,
        nPrvInputs: nPrvIn,
        nLabels,
        nConstraints,
      };
    }
    offset += size;
  }
  throw new Error('r1cs header section is missing');
}

async function latestMtime(paths) {
  let newest = 0;
  for (const path of paths) {
    try {
      newest = Math.max(newest, (await stat(path)).mtimeMs);
    } catch {
      return null;
    }
  }
  return newest;
}

async function ensureCircomBinary() {
  const platform = process.platform;
  const asset = {
    win32: 'circom-windows-amd64.exe',
    linux: 'circom-linux-amd64',
    darwin: 'circom-macos-amd64',
  }[platform];
  const localName = platform === 'win32' ? 'circom.exe' : 'circom';
  const localPath = join(ZK_ROOT, 'tools', localName);

  if (existsSync(localPath)) return localPath;
  if (!asset) {
    try {
      run('circom', ['--version']);
      return 'circom';
    } catch {
      throw new Error(`No Circom binary available for platform ${platform}`);
    }
  }

  log(`downloading Circom 2 compiler (${asset}) into zk/tools/`);
  await mkdir(dirname(localPath), { recursive: true });
  const response = await fetch(`https://github.com/iden3/circom/releases/latest/download/${asset}`, {
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Unable to download Circom: HTTP ${response.status}`);
  await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
  if (platform !== 'win32') await chmod(localPath, 0o755);
  return localPath;
}

async function compileCircuit(force = false) {
  const upToDate = !force
    && existsSync(PATHS.r1cs)
    && existsSync(PATHS.wasm)
    && (await latestMtime([PATHS.r1cs, PATHS.wasm])) > (await latestMtime([CIRCUIT_SOURCE]));

  if (upToDate) {
    log('circuit artifacts are up to date');
    return;
  }

  const circom = await ensureCircomBinary();
  log('compiling circuits/score_threshold.circom');
  await mkdir(BUILD_DIR, { recursive: true });
  run(circom, [
    CIRCUIT_SOURCE,
    '--r1cs',
    '--wasm',
    '--sym',
    '-l',
    join(ZK_ROOT, 'node_modules'),
    '-o',
    BUILD_DIR,
  ], { inherit: true });
}

async function ensurePtau(force = false) {
  if (!force && existsSync(PATHS.ptauFinal)) {
    log('powers-of-tau file already exists');
    return;
  }

  log(`creating local powers-of-tau (bn128, 2^${PTAU_POWER})`);
  snark(['powersoftau', 'new', 'bn128', String(PTAU_POWER), PATHS.ptau0, '-v']);

  log('contributing development entropy (single contributor, NOT production)');
  snark([
    'powersoftau',
    'contribute',
    PATHS.ptau0,
    PATHS.ptau1,
    '--name=PARADOX ZK dev ptau',
    `-e=${randomBytes(64).toString('hex')}`,
  ]);

  log('preparing phase 2 powers-of-tau');
  snark(['powersoftau', 'prepare', 'phase2', PATHS.ptau1, PATHS.ptauFinal, '-v']);
}

async function ensureGroth16Setup(force = false) {
  if (!force && existsSync(PATHS.zkey) && existsSync(PATHS.vkey)) {
    log('Groth16 proving/verification keys already exist');
    return;
  }

  if (!existsSync(PATHS.r1cs)) throw new Error('r1cs is missing; compile the circuit first');
  if (!existsSync(PATHS.ptauFinal)) throw new Error('powers-of-tau file is missing');

  log('running Groth16 circuit setup');
  snark(['groth16', 'setup', PATHS.r1cs, PATHS.ptauFinal, PATHS.zkey0]);

  log('contributing circuit-specific entropy (single contributor, NOT production)');
  snark([
    'zkey',
    'contribute',
    PATHS.zkey0,
    PATHS.zkey,
    '--name=PARADOX ZK dev phase2',
    `-e=${randomBytes(64).toString('hex')}`,
  ]);

  log('exporting verification key and reference Solidity verifier');
  snark(['zkey', 'export', 'verificationkey', PATHS.zkey, PATHS.vkey]);
  snark(['zkey', 'export', 'solidityverifier', PATHS.zkey, PATHS.verifier]);
}

async function readExistingManifest() {
  try {
    return JSON.parse(await readFile(PATHS.manifest, 'utf8'));
  } catch {
    return null;
  }
}

async function writeManifest() {
  const info = await readR1csHeader(PATHS.r1cs);
  const circuitSourceSha256 = await sha256File(CIRCUIT_SOURCE);
  const [r1csSha256, wasmSha256, zkeySha256, vkeySha256] = await Promise.all([
    sha256File(PATHS.r1cs),
    sha256File(PATHS.wasm),
    sha256File(PATHS.zkey),
    sha256File(PATHS.vkey),
  ]);
  const manifest = {
    schemaVersion: 'paradox-zk-build-manifest-v1',
    generatedAt: new Date().toISOString(),
    circuit: {
      name: 'score_threshold',
      version: '1.0.0',
      source: 'circuits/score_threshold.circom',
      sourceSha256: circuitSourceSha256,
      curve: 'bn128',
      nVars: info.nVars,
      nConstraints: info.nConstraints,
      nPublicInputs: info.nPubInputs,
      nPrivateInputs: info.nPrvInputs,
    },
    groth16: {
      ptauPower: PTAU_POWER,
      r1csSha256,
      wasmSha256,
      zkeySha256,
      verificationKeySha256: vkeySha256,
    },
    trustedSetup: {
      mode: 'local-single-contributor',
      productionReady: false,
      warning: 'Development-only setup. Every contributor secret was generated by this build script and is in the build environment; a production deployment requires a multi-party ceremony.',
    },
  };
  await writeFile(PATHS.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function build({ force = false, circuitOnly = false, setupOnly = false } = {}) {
  await mkdir(BUILD_DIR, { recursive: true });
  if (!setupOnly) await compileCircuit(force);
  if (!circuitOnly) {
    if (!existsSync(PATHS.r1cs)) throw new Error('r1cs is missing; compile the circuit first');

    // A zkey is only valid for the exact r1cs it was generated from. Compare the
    // current r1cs hash with the manifest so circuit edits cannot silently keep
    // an old proving key.
    const previous = await readExistingManifest();
    const r1csSha256 = await sha256File(PATHS.r1cs);
    const keysPresent = existsSync(PATHS.zkey) && existsSync(PATHS.vkey);
    const setupNeeded = force
      || !keysPresent
      || previous?.groth16?.r1csSha256 !== r1csSha256;

    await ensurePtau(force);
    await ensureGroth16Setup(setupNeeded);
  }
  if (circuitOnly) {
    // Do not rewrite the manifest here: it records which r1cs the current zkey
    // belongs to. Leaving the old hash in place makes the next full build detect
    // the circuit change and regenerate the proving/verification keys.
    log('circuit compiled; run `npm run build` to refresh Groth16 keys');
    return readExistingManifest();
  }
  const manifest = await writeManifest();
  log(`done: ${manifest.circuit.nConstraints} constraints, ${manifest.circuit.nPublicInputs} public inputs`);
  return manifest;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const args = new Set(process.argv.slice(2));
  build({
    force: args.has('--force'),
    circuitOnly: args.has('--circuit-only'),
    setupOnly: args.has('--setup-only'),
  }).catch(error => {
    console.error(`[zk-build] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
