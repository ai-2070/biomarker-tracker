// Repeatable randomness for builds: the same seed always builds the same thing.
import { hash3 } from '../../shared/voxel.ts';

/** A seeded random number source in [0, 1) (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [0, 1) on a 2D grid of `cell` voxels. */
export function valueNoise(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const sx = (fx - ix) ** 2 * (3 - 2 * (fx - ix));
  const sz = (fz - iz) ** 2 * (3 - 2 * (fz - iz));
  const a = hash3(ix, 0, iz, seed);
  const b = hash3(ix + 1, 0, iz, seed);
  const c = hash3(ix, 0, iz + 1, seed);
  const d = hash3(ix + 1, 0, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
