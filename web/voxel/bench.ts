// A test island for trying the voxel look and measuring speed before agents can build (Phase 0 of
// docs/internal/plans/VOXEL_WORLD_PLAN.md): grass on top, a rocky underside, cherry trees, a pond, lanterns,
// rocks and a red gate. Its size is set by its radius in voxels; the real generators come in Phase 1.
import { hash3, newVolume, setVoxel, getVoxel } from '../../shared/voxel.ts';
import type { Volume } from '../../shared/voxel.ts';
import type { VoxelMaterial } from '../../shared/types.ts';

export const BENCH_PALETTE: VoxelMaterial[] = [
  { name: 'grass', color: '#5f9e3a', ramp: ['#4f8a30', '#6fae45', '#7dbb52'], jitter: 0.1, kind: 'solid' },
  { name: 'dirt', color: '#6b4a2f', ramp: ['#5d3f28', '#7a5636'], jitter: 0.08, kind: 'solid' },
  { name: 'stone', color: '#7d7a74', ramp: ['#6c6964', '#8c8982'], jitter: 0.08, kind: 'solid' },
  { name: 'dark stone', color: '#4f4b47', ramp: ['#433f3b'], jitter: 0.08, kind: 'solid' },
  { name: 'bark', color: '#5a3b2a', ramp: ['#4c3122', '#6a4632'], jitter: 0.08, kind: 'solid' },
  { name: 'blossom', color: '#f3b6cf', ramp: ['#e89ab8', '#f7cde0', '#fde6f0', '#e47fa6'], jitter: 0.06, kind: 'leaf' },
  { name: 'water', color: '#3d8fb0', ramp: ['#3482a2'], jitter: 0.04, kind: 'water', opacity: 0.65 },
  { name: 'lantern', color: '#ffcf7a', ramp: ['#ffd98f'], jitter: 0.03, kind: 'emissive', emissive: 3 },
  { name: 'red lacquer', color: '#b8322a', ramp: ['#a82c25', '#c43a30'], jitter: 0.05, kind: 'solid' },
  { name: 'dark wood', color: '#2e2420', jitter: 0.05, kind: 'solid' },
  { name: 'sand', color: '#cdb98f', ramp: ['#c2ad82'], jitter: 0.06, kind: 'solid' },
];
const M = Object.fromEntries(BENCH_PALETTE.map((m, i) => [m.name, i + 1])) as Record<string, number>;

/** Smooth noise in [0, 1) on a 2D grid (value noise, one octave). */
function noise2(x: number, z: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash3(ix, 0, iz, seed);
  const b = hash3(ix + 1, 0, iz, seed);
  const c = hash3(ix, 0, iz + 1, seed);
  const d = hash3(ix + 1, 0, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function sphere(v: Volume, cx: number, cy: number, cz: number, r: number, value: number, holes = 0, seed = 0): void {
  for (let y = -r; y <= r; y++)
    for (let z = -r; z <= r; z++)
      for (let x = -r; x <= r; x++) {
        const d = Math.sqrt(x * x + y * y * 1.4 + z * z);
        if (d > r - hash3(cx + x, cy + y, cz + z, seed + 3) * 1.6) continue;
        if (holes && hash3(cx + x, cy + y, cz + z, seed) < holes) continue;
        setVoxel(v, cx + x, cy + y, cz + z, value);
      }
}

function box(v: Volume, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, value: number): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) setVoxel(v, x, y, z, value);
}

function cherryTree(v: Volume, x: number, z: number, h: number, seed: number): void {
  // a trunk that leans a little, two branches, then clouds of blossom
  let tx = x;
  let tz = z;
  for (let y = 0; y < h; y++) {
    if (y > h * 0.4 && hash3(x, y, z, seed) < 0.25) tx += hash3(x, y, z, seed + 1) < 0.5 ? 1 : -1;
    box(v, tx, y, tz, tx + 1, y, tz + 1, M.bark);
  }
  const crowns: [number, number, number, number][] = [
    [tx, h + 2, tz, Math.round(h * 0.45)],
    [tx - Math.round(h * 0.35), h - 1, tz + 2, Math.round(h * 0.3)],
    [tx + Math.round(h * 0.3), h, tz - 2, Math.round(h * 0.32)],
  ];
  for (const [cx, cy, cz, r] of crowns) {
    box(v, tx, h - 2, tz, cx, h - 2, cz, M.bark);
    sphere(v, cx, cy, cz, r, M.blossom, 0.18, seed);
  }
  // fallen petals around it
  for (let i = 0; i < h * 6; i++) {
    const a = hash3(i, 1, 0, seed) * Math.PI * 2;
    const d = hash3(i, 2, 0, seed) * h * 0.8;
    const px = Math.round(x + Math.cos(a) * d);
    const pz = Math.round(z + Math.sin(a) * d);
    if (getVoxel(v, px, -1, pz) === M.grass && !getVoxel(v, px, 0, pz)) setVoxel(v, px, -1, pz, M.blossom);
  }
}

function lantern(v: Volume, x: number, z: number): void {
  box(v, x, 0, z, x, 3, z, M['dark stone']);
  box(v, x - 1, 4, z - 1, x + 1, 4, z + 1, M['dark stone']);
  box(v, x - 1, 5, z - 1, x + 1, 6, z + 1, M.lantern);
  box(v, x - 1, 7, z - 1, x + 1, 7, z + 1, M['dark stone']);
  setVoxel(v, x, 8, z, M['dark stone']);
}

function gate(v: Volume, x: number, z: number, s: number): void {
  const w = 5 * s;
  const h = 9 * s;
  for (const px of [x - w, x + w]) box(v, px, 0, z, px + s - 1, h, z + s - 1, M['red lacquer']);
  box(v, x - w - 2 * s, h + 1, z, x + w + 3 * s - 1, h + s, z + s - 1, M['dark wood']);
  box(v, x - w, h - 2 * s, z, x + w + s - 1, h - 2 * s + Math.max(0, s - 1), z + s - 1, M['red lacquer']);
}

/** The island, its top at y = 0 (a voxel's top face at the map's floor), centred on x = z = 0. */
export function benchIsland(radius = 90, voxelSize = 0.25): Volume {
  const v = newVolume(voxelSize);
  const R = Math.max(16, Math.round(radius));
  const seed = 7;
  const depth = R * 0.85;
  for (let z = -R - 8; z <= R + 8; z++)
    for (let x = -R - 8; x <= R + 8; x++) {
      const d = Math.sqrt(x * x + z * z);
      const edge = R * (0.88 + 0.22 * noise2(x, z, R * 0.35, seed));
      if (d > edge) continue;
      const t = d / edge;
      // the underside: a rough cone of rock hanging below the island
      const bottom = -Math.round(4 + depth * Math.pow(1 - t, 0.75) * (0.75 + 0.5 * noise2(x, z, 9, seed + 1)));
      const pond = Math.hypot(x - R * 0.35, z + R * 0.3) < R * 0.18;
      const top = pond ? -3 : -1;
      for (let y = bottom; y <= top; y++) {
        const fromTop = top - y;
        const mat = fromTop === 0 ? (pond ? M.sand : M.grass) : fromTop < 3 + Math.round(noise2(x, z, 6, seed + 2) * 3) ? M.dirt : y < bottom + 3 || hash3(x, y, z, seed) < 0.12 ? M['dark stone'] : M.stone;
        setVoxel(v, x, y, z, mat);
      }
      if (pond) box(v, x, -2, z, x, -1, z, M.water);
      // grass tufts at the edge
      else if (t > 0.75 && hash3(x, 0, z, seed + 4) < 0.08) setVoxel(v, x, 0, z, M.grass);
    }
  // trees, lanterns, rocks and a gate, in a ring that leaves the middle free for the Brain
  const trees = Math.max(3, Math.round(R / 14));
  for (let i = 0; i < trees; i++) {
    const a = (i / trees) * Math.PI * 2 + 0.4;
    const d = R * (0.55 + 0.25 * hash3(i, 0, 0, seed));
    cherryTree(v, Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d), Math.round(R / 5 + hash3(i, 1, 0, seed) * R / 8), seed + i);
  }
  for (let i = 0; i < trees * 2; i++) {
    const a = ((i + 0.5) / (trees * 2)) * Math.PI * 2;
    lantern(v, Math.round(Math.cos(a) * R * 0.42), Math.round(Math.sin(a) * R * 0.42));
  }
  for (let i = 0; i < trees * 2; i++) {
    const a = hash3(i, 5, 0, seed) * Math.PI * 2;
    const d = R * (0.3 + 0.6 * hash3(i, 6, 0, seed));
    sphere(v, Math.round(Math.cos(a) * d), 0, Math.round(Math.sin(a) * d), 2 + Math.round(hash3(i, 7, 0, seed) * 3), M.stone, 0, seed + 9);
  }
  gate(v, Math.round(-R * 0.62), Math.round(R * 0.5), Math.max(1, Math.round(R / 45)));
  return v;
}
