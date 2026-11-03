import { buildPoseidon } from 'circomlibjs';

let poseidonPromise = null;

/**
 * Lazily builds the circomlibjs Poseidon instance. The same parameter set is
 * used by circomlib's Poseidon(7) template, so JS and circuit hashes agree.
 */
export function getPoseidon() {
  poseidonPromise ??= buildPoseidon();
  return poseidonPromise;
}

export async function poseidon(inputs) {
  const poseidon = await getPoseidon();
  const hash = poseidon(inputs.map(value => BigInt(value)));
  return BigInt(poseidon.F.toString(hash));
}
