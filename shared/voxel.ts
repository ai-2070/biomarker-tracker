// Voxel data the server and the page share: a volume is sparse 16³ chunks of palette values (0 = empty),
// stored run-length encoded as base64 text, and each voxel gets its own shade of its material so builds
// look hand-made (the same voxel always gets the same shade).
import type { VoxelMaterial } from './types.ts';

export const CHUNK = 16;
export const CHUNK_CELLS = CHUNK * CHUNK * CHUNK;

/** A grid of voxels of one size (in map units). Chunks are keyed "cx,cy,cz". */
export interface Volume {
  voxelSize: number;
  chunks: Map<string, Uint8Array>;
}

export type Vec3i = [number, number, number];

export const chunkKey = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`;
export function parseChunkKey(k: string): Vec3i {
  const [x, y, z] = k.split(',').map(Number);
  return [x, y, z];
}

export const newVolume = (voxelSize = 0.25): Volume => ({ voxelSize, chunks: new Map() });

/** Where voxel (x, y, z) sits inside its chunk. Layers go up in y, so a chunk reads bottom to top. */
export const cellIndex = (x: number, y: number, z: number): number => x + CHUNK * (z + CHUNK * y);

export function getVoxel(v: Volume, x: number, y: number, z: number): number {
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  const cz = Math.floor(z / CHUNK);
  const c = v.chunks.get(chunkKey(cx, cy, cz));
  return c ? c[cellIndex(x - cx * CHUNK, y - cy * CHUNK, z - cz * CHUNK)] : 0;
}

export function setVoxel(v: Volume, x: number, y: number, z: number, value: number): void {
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  const cz = Math.floor(z / CHUNK);
  const k = chunkKey(cx, cy, cz);
  let c = v.chunks.get(k);
  if (!c) {
    if (!value) return;
    c = new Uint8Array(CHUNK_CELLS);
    v.chunks.set(k, c);
  }
  c[cellIndex(x - cx * CHUNK, y - cy * CHUNK, z - cz * CHUNK)] = value & 255;
}

export function countVoxels(v: Volume): number {
  let n = 0;
  for (const c of v.chunks.values()) for (let i = 0; i < c.length; i++) if (c[i]) n++;
  return n;
}

/** The smallest box of voxels holding every filled one ([min, max], inclusive), or null when empty. */
export function volumeBounds(v: Volume): { min: Vec3i; max: Vec3i } | null {
  const min: Vec3i = [Infinity, Infinity, Infinity];
  const max: Vec3i = [-Infinity, -Infinity, -Infinity];
  for (const [k, c] of v.chunks) {
    const [cx, cy, cz] = parseChunkKey(k);
    for (let i = 0; i < c.length; i++) {
      if (!c[i]) continue;
      const p: Vec3i = [cx * CHUNK + (i % CHUNK), cy * CHUNK + Math.floor(i / (CHUNK * CHUNK)), cz * CHUNK + (Math.floor(i / CHUNK) % CHUNK)];
      for (let a = 0; a < 3; a++) {
        if (p[a] < min[a]) min[a] = p[a];
        if (p[a] > max[a]) max[a] = p[a];
      }
    }
  }
  return min[0] === Infinity ? null : { min, max };
}

// ---------- storage: run-length encoding as base64 ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((ch, i) => [ch, i]));

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const ch = clean[i + j];
      const v = ch === undefined ? 0 : B64_INDEX.get(ch);
      if (v === undefined) throw new Error('Not base64');
      n = (n << 6) | v;
    }
    for (let j = 0; j < 3 && o < out.length; j++) out[o++] = (n >> (16 - 8 * j)) & 255;
  }
  return out;
}

/** A chunk as text: pairs of (run length 1..255, value), base64. A whole empty or solid chunk is 48 characters. */
export function encodeChunk(c: Uint8Array): string {
  const pairs: number[] = [];
  for (let i = 0; i < c.length; ) {
    const v = c[i];
    let run = 1;
    while (run < 255 && i + run < c.length && c[i + run] === v) run++;
    pairs.push(run, v);
    i += run;
  }
  return toBase64(Uint8Array.from(pairs));
}

export function decodeChunk(text: string): Uint8Array {
  const pairs = fromBase64(text);
  const out = new Uint8Array(CHUNK_CELLS);
  let o = 0;
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const run = pairs[i];
    if (!run || o + run > CHUNK_CELLS) throw new Error('A voxel chunk is damaged');
    out.fill(pairs[i + 1], o, o + run);
    o += run;
  }
  if (o !== CHUNK_CELLS) throw new Error('A voxel chunk is damaged');
  return out;
}

// ---------- shading ----------
/** A repeatable number in [0, 1) for a voxel position (and a seed). */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function hexRgb(hex: string): Vec3i {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 0, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A material's colors, read once (the mesher shades thousands of voxels with them). */
export interface MaterialShades {
  shades: Vec3i[];
  jitter: number;
}
export const materialShades = (m: VoxelMaterial): MaterialShades => ({ shades: [m.color, ...(m.ramp || [])].map(hexRgb), jitter: Math.max(0, Math.min(0.3, m.jitter ?? 0.06)) });

/** The color of the voxel at (x, y, z), 0..255 each: one of the material's shades, a little lighter or darker. */
export function voxelShade(s: MaterialShades, x: number, y: number, z: number, seed = 0): Vec3i {
  const pick = s.shades.length > 1 ? s.shades[Math.floor(hash3(x, y, z, seed + 1) * s.shades.length)] : s.shades[0];
  const k = 1 + (hash3(x, y, z, seed) * 2 - 1) * s.jitter;
  return [Math.min(255, Math.round(pick[0] * k)), Math.min(255, Math.round(pick[1] * k)), Math.min(255, Math.round(pick[2] * k))];
}

/**
 * A copy's own material swaps with its parent's applied after them: the child's "shirt" → "red", then the
 * parent's "red" → "blue" (the same as web/voxel/instances.ts draws nested copies).
 */
export function composeSwaps(child: Record<string, string> | undefined, parent: Map<string, string>): Map<string, string> {
  const norm = (s: string) => s.trim().toLowerCase();
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(child || {})) out.set(norm(k), parent.get(norm(v)) ?? norm(v));
  for (const [k, v] of parent) if (!out.has(k)) out.set(k, v);
  return out;
}
