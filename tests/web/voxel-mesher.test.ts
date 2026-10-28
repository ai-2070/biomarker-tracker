import { describe, expect, it } from 'vitest';
import { AO_LEVELS, LIGHT_STRIDE, meshObject, meshRegion } from '../../web/voxel/mesher.ts';
import type { MeshPart } from '../../web/voxel/mesher.ts';
import { ENV_PRESETS, envPreset, sunDirection } from '../../shared/worldenv.ts';
import { benchIsland, BENCH_PALETTE } from '../../web/voxel/bench.ts';
import { chunkKey, countVoxels, encodeChunk, newVolume, setVoxel } from '../../shared/voxel.ts';
import type { VoxelMaterial } from '../../shared/types.ts';

const PALETTE: VoxelMaterial[] = [
  { name: 'stone', color: '#808080', jitter: 0, kind: 'solid' },
  { name: 'water', color: '#3060a0', jitter: 0, kind: 'water' },
  { name: 'lamp', color: '#ffcc80', jitter: 0, kind: 'emissive' },
  { name: 'glass', color: '#c0e0ff', jitter: 0, kind: 'glass' },
];
const S = 1;
const W = 2;
const L = 3;
const G = 4;

/** The faces of a mesh part as "normal@position of first corner" strings. */
function normalsOf(p: MeshPart): string[] {
  const out: string[] = [];
  for (let f = 0; f < p.faces; f++) out.push([p.normals[f * 12], p.normals[f * 12 + 1], p.normals[f * 12 + 2]].map((n) => Math.sign(n)).join(','));
  return out;
}

function mesh(cells: [number, number, number, number][], size = 8) {
  const v = newVolume();
  for (const [x, y, z, m] of cells) setVoxel(v, x, y, z, m);
  return meshRegion(v, [0, 0, 0], [size, size, size], PALETTE);
}

describe('meshRegion', () => {
  it('a lone voxel has six faces, all fully lit', () => {
    const r = mesh([[2, 2, 2, S]]);
    const p = r.opaque!;
    expect(p.faces).toBe(6);
    expect(p.positions.length).toBe(6 * 4 * 3);
    expect(p.indices.length).toBe(6 * 6);
    expect(new Set(normalsOf(p)).size).toBe(6);
    expect(Math.min(...p.colors)).toBe(128);
    expect(r.emissive).toBeUndefined();
  });

  it('faces between two solid voxels are hidden', () => {
    expect(mesh([[2, 2, 2, S], [3, 2, 2, S]]).opaque!.faces).toBe(10);
    // a 3×3×3 block shows only its outside
    const block: [number, number, number, number][] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) block.push([x + 1, y + 1, z + 1, S]);
    expect(mesh(block).opaque!.faces).toBe(54);
  });

  it('every face winds counter-clockwise seen from outside', () => {
    const p = mesh([[1, 1, 1, S]]).opaque!;
    for (let t = 0; t < p.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((ax) => p.positions[p.indices[t + k] * 3 + ax]));
      const e1 = b.map((n, i) => n - a[i]);
      const e2 = c.map((n, i) => n - a[i]);
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = [0, 1, 2].map((ax) => p.normals[p.indices[t] * 3 + ax]);
      expect(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it('darkens corners in a crease (ambient occlusion)', () => {
    // a floor voxel with a wall voxel on top of its neighbour: the floor's top face is darker on that side
    const r = mesh([[2, 1, 2, S], [3, 1, 2, S], [3, 2, 2, S]]);
    const p = r.opaque!;
    const tops: number[] = [];
    for (let f = 0; f < p.faces; f++) {
      if (p.normals[f * 12 + 1] <= 0) continue;
      for (let k = 0; k < 4; k++) {
        const v = f * 4 + k;
        if (p.positions[v * 3] <= 3 && p.positions[v * 3 + 1] === 2) tops.push(p.colors[v * 3]);
      }
    }
    expect(Math.min(...tops)).toBe(Math.round(128 * AO_LEVELS[2]));
    expect(Math.max(...tops)).toBe(128);
  });

  it('splits solid, glowing and water voxels, and shows solid faces behind water', () => {
    const r = mesh([[2, 2, 2, S], [3, 2, 2, W], [5, 5, 5, L]]);
    expect(r.emissive!.faces).toBe(6);
    expect(r.water!.faces).toBe(5);
    expect(r.opaque!.faces).toBe(6);
  });

  it('water next to water has no face between, water next to glass does', () => {
    expect(mesh([[2, 2, 2, W], [3, 2, 2, W]]).water!.faces).toBe(10);
    const r = mesh([[2, 2, 2, W], [3, 2, 2, G]]);
    expect(r.water!.faces + r.transparent!.faces).toBe(12);
  });

  it('leaves and metal get their own parts; glowing voxels carry how bright they glow, and light spots', () => {
    const pal: VoxelMaterial[] = [...PALETTE, { name: 'leaves', color: '#3f7f34', kind: 'leaf' }, { name: 'iron', color: '#4a4d52', kind: 'metal' }, { name: 'neon', color: '#ff0000', kind: 'emissive', emissive: 8 }];
    const v = newVolume();
    setVoxel(v, 0, 0, 0, 5);
    setVoxel(v, 2, 0, 0, 6);
    setVoxel(v, 4, 0, 0, 3);
    setVoxel(v, 20, 0, 0, 7);
    const r = meshRegion(v, [0, 0, 0], [32, 32, 32], pal);
    expect(r.leaf!.faces).toBe(6);
    expect(r.metal!.faces).toBe(6);
    const e = r.emissive!;
    expect(e.glow!.length).toBe(e.faces * 4);
    // the lamp has no level: the default 3 of 8; the neon is 8 of 8
    expect(new Set(e.glow)).toEqual(new Set([Math.round((3 / 8) * 255), 255]));
    // two spots, far apart: each near its voxel's middle, red for the neon
    expect(e.lights!.length).toBe(2 * LIGHT_STRIDE);
    const spots = [0, 1].map((k) => [...e.lights!.slice(k * LIGHT_STRIDE, (k + 1) * LIGHT_STRIDE)]);
    const neon = spots.find((sp) => sp[0] > 10)!;
    expect(neon[0]).toBeCloseTo(20.5, 1);
    expect(neon[3]).toBeCloseTo(1, 2);
    expect(neon[4]).toBeCloseTo(0, 2);
  });

  it('reads neighbours outside the region, across chunks', () => {
    const v = newVolume();
    setVoxel(v, 15, 0, 0, S);
    setVoxel(v, 16, 0, 0, S);
    // only the chunk with x 0..15: the face towards x = 16 is hidden by the voxel in the next chunk
    const r = meshRegion(v, [0, 0, 0], [16, 16, 16], PALETTE);
    expect(r.opaque!.faces).toBe(5);
  });

  it('refuses regions too big for byte positions', () => {
    expect(() => meshRegion(newVolume(), [0, 0, 0], [256, 1, 1], PALETTE)).toThrow(/at most/);
  });
});

describe('voxel look presets and the test island', () => {
  it('every time of day is complete and copies are independent', () => {
    for (const [name, env] of Object.entries(ENV_PRESETS)) {
      expect(env.preset).toBe(name);
      for (const c of [env.sky.top, env.sky.horizon, env.sky.bottom, env.fog.color, env.sun.color, env.ambient.sky, env.ambient.ground]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const a = envPreset('golden');
    a.sun.intensity = 99;
    expect(ENV_PRESETS.golden.sun.intensity).not.toBe(99);
    expect(envPreset('unknown').preset).toBe('station');
  });

  it('the sun is up for every preset', () => {
    for (const env of Object.values(ENV_PRESETS)) expect(sunDirection(env.sun.azimuth, env.sun.elevation)[1]).toBeGreaterThan(0);
  });

  it('the test island is repeatable and meshes into every class', () => {
    const a = benchIsland(24);
    const b = benchIsland(24);
    expect(countVoxels(a)).toBe(countVoxels(b));
    expect(countVoxels(a)).toBeGreaterThan(5000);
    const r = meshRegion(a, [-32, -32, -32], [64, 64, 64], BENCH_PALETTE);
    expect(r.opaque!.faces).toBeGreaterThan(1000);
    expect(r.emissive!.faces).toBeGreaterThan(0);
    expect(r.water!.faces).toBeGreaterThan(0);
  });
});

describe('meshObject', () => {
  it('meshes every grid of a stored object at its own voxel size', () => {
    const a = newVolume(0.25);
    setVoxel(a, 0, 0, 0, 1);
    const b = newVolume(0.1);
    setVoxel(b, 40, 0, 0, 3);
    const enc = (v: ReturnType<typeof newVolume>) => Object.fromEntries([...v.chunks].map(([k, c]) => [k, encodeChunk(c)]));
    const parts = meshObject({ volumes: [{ id: 'a', voxelSize: 0.25, chunks: enc(a) }, { id: 'b', voxelSize: 0.1, chunks: enc(b) }] }, PALETTE);
    expect(parts.map((p) => [p.cls, p.voxelSize, p.min, p.faces])).toEqual([
      ['opaque', 0.25, [0, 0, 0], 6],
      ['emissive', 0.1, [32, 0, 0], 6],
    ]);
    expect(chunkKey(2, 0, 0)).toBe('2,0,0');
  });
});
