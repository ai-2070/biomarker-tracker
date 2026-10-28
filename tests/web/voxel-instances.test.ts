import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { composeSwaps, expandInstances, instanceMatrix, mirrorData, reachablePrefabs, swapPalette, variantKey } from '../../web/voxel/instances.ts';
import type { PrefabLookup } from '../../web/voxel/instances.ts';
import { chunkKey, decodeChunk, encodeChunk, getVoxel, newVolume, setVoxel } from '../../shared/voxel.ts';
import type { PrefabInstance, Vec3, VoxelMaterial, VoxelObjectData } from '../../shared/types.ts';

const at = (m: THREE.Matrix4, p: Vec3) => new THREE.Vector3(...p).applyMatrix4(m).toArray().map((n) => Math.round(n * 1e6) / 1e6 + 0);
const F = new THREE.Matrix4().makeScale(-1, 1, 1);

function data(cells: [number, number, number, number][] = [], instances?: PrefabInstance[], size = 0.25): VoxelObjectData {
  const v = newVolume(size);
  for (const [x, y, z, m] of cells) setVoxel(v, x, y, z, m);
  return { volumes: [{ id: 'v', voxelSize: size, chunks: Object.fromEntries([...v.chunks].map(([k, c]) => [k, encodeChunk(c)])) }], ...(instances ? { instances } : {}) };
}

describe('instanceMatrix', () => {
  it('puts the pivot on the spot, then turns, tilts, rolls and scales around it', () => {
    const pivot: Vec3 = [0.5, 0, 0.5];
    expect(at(instanceMatrix({ p: [1, 2, 3] }, pivot), pivot)).toEqual([1, 2, 3]);
    // a quarter turn takes +x to -z
    expect(at(instanceMatrix({ p: [1, 2, 3], turn: 90 }, pivot), [1.5, 0, 0.5])).toEqual([1, 2, 2]);
    // tilt: +y to +z; roll: +x to +y
    expect(at(instanceMatrix({ p: [0, 0, 0], tilt: 90 }, [0, 0, 0]), [0, 1, 0])).toEqual([0, 0, 1]);
    expect(at(instanceMatrix({ p: [0, 0, 0], roll: 90 }, [0, 0, 0]), [1, 0, 0])).toEqual([0, 1, 0]);
    // tilt and roll snap to quarter turns
    expect(at(instanceMatrix({ p: [0, 0, 0], tilt: 80 }, [0, 0, 0]), [0, 1, 0])).toEqual([0, 0, 1]);
    expect(at(instanceMatrix({ p: [0, 0, 0], scale: 2 }, [0, 0, 0]), [1, 1, 1])).toEqual([2, 2, 2]);
    // a bad scale counts as 1
    expect(at(instanceMatrix({ p: [0, 0, 0], scale: -3 }, [0, 0, 0]), [1, 1, 1])).toEqual([1, 1, 1]);
  });
});

describe('expandInstances', () => {
  const prefabs: Record<string, { data: VoxelObjectData; pivot: Vec3 }> = {};
  const lookup: PrefabLookup = (id) => prefabs[id] || null;

  it('composes copies inside copies', () => {
    prefabs.lamp = { data: data([[0, 0, 0, 1]]), pivot: [0.125, 0, 0.125] };
    prefabs.block = { data: data([[0, 0, 0, 2]], [{ prefab: 'lamp', p: [2, 0, 0] }]), pivot: [0, 0, 0] };
    const flat = expandInstances([{ prefab: 'block', p: [10, 0, 0], turn: 90 }], lookup);
    expect(flat.map((c) => c.prefab)).toEqual(['block', 'lamp']);
    // the lamp's pivot ends up at block spot + the turned offset (+x → -z)
    expect(at(flat[1].matrix, prefabs.lamp.pivot)).toEqual([10, 0, -2]);
  });

  it('never loops on a prefab that holds itself, and stops at 4 levels', () => {
    prefabs.a = { data: data([], [{ prefab: 'b', p: [1, 0, 0] }]), pivot: [0, 0, 0] };
    prefabs.b = { data: data([], [{ prefab: 'a', p: [1, 0, 0] }, { prefab: 'self', p: [0, 0, 0] }]), pivot: [0, 0, 0] };
    prefabs.self = { data: data([], [{ prefab: 'self', p: [1, 0, 0] }]), pivot: [0, 0, 0] };
    expect(expandInstances([{ prefab: 'a', p: [0, 0, 0] }], lookup).map((c) => c.prefab)).toEqual(['a', 'b', 'self']);
    for (let i = 1; i <= 5; i++) prefabs[`n${i}`] = { data: data([], i < 5 ? [{ prefab: `n${i + 1}`, p: [1, 0, 0] }] : []), pivot: [0, 0, 0] };
    expect(expandInstances([{ prefab: 'n1', p: [0, 0, 0] }], lookup).map((c) => c.prefab)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect([...reachablePrefabs([{ prefab: 'n1', p: [0, 0, 0] }], (id) => prefabs[id]?.data)]).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect([...reachablePrefabs([{ prefab: 'a', p: [0, 0, 0] }], (id) => prefabs[id]?.data)].sort()).toEqual(['a', 'b', 'self']);
  });

  it('skips copies of prefabs that are gone, and odd entries', () => {
    const odd = [{ prefab: 'nope', p: [0, 0, 0] }, { p: [0, 0, 0] }, null] as unknown as PrefabInstance[];
    expect(expandInstances(odd, lookup)).toEqual([]);
  });

  it('a mirrored copy, drawn from mirrored voxels, lands where mirroring the original would put it', () => {
    prefabs.cart = { data: data([[0, 0, 0, 1]]), pivot: [0.5, 0, 0.25] };
    const i: PrefabInstance = { prefab: 'cart', p: [3, 1, -2], turn: 30, roll: 90, scale: 1.5, mirror: true };
    const [c] = expandInstances([i], lookup);
    expect(c.variant.mirror).toBe(true);
    const q: Vec3 = [0.7, 0.3, -0.4];
    // expected: T(p) R S F T(-pivot) on the original; drawn: the copy's matrix on the mirrored point F q
    const want = instanceMatrix(i, [0, 0, 0]).multiply(F).multiply(new THREE.Matrix4().makeTranslation(-0.5, 0, -0.25));
    expect(at(c.matrix, [-q[0], q[1], q[2]])).toEqual(at(want, q));
  });

  it('copies inside a mirrored copy are mirrored with it', () => {
    prefabs.person = { data: data([[0, 0, 0, 1]]), pivot: [0.1, 0, 0.1] };
    prefabs.boat = { data: data([[0, 0, 0, 2]], [{ prefab: 'person', p: [1, 0.5, 0.3], turn: 40, roll: 90 }]), pivot: [0.6, 0, 0.2] };
    const outer: PrefabInstance = { prefab: 'boat', p: [5, 0, 5], turn: 20, mirror: true };
    const flat = expandInstances([outer], lookup);
    const inner = flat[1];
    expect(inner.variant.mirror).toBe(true);
    const g: Vec3 = [0.3, 0.2, -0.1];
    // the truth: the boat's mirrored frame, then the person's own frame, on the person's original point
    const boatFrame = instanceMatrix({ ...outer }, [0, 0, 0]).multiply(F).multiply(new THREE.Matrix4().makeTranslation(-0.6, 0, -0.2));
    const want = boatFrame.multiply(instanceMatrix(prefabs.boat.data.instances![0], prefabs.person.pivot));
    expect(at(inner.matrix, [-g[0], g[1], g[2]])).toEqual(at(want, g));
  });

  it('variants: copies with the same mirror and swaps share a key', () => {
    const flat = expandInstances(
      [
        { prefab: 'lamp', p: [0, 0, 0], swap: { Glass: 'gold', iron: 'stone' } },
        { prefab: 'lamp', p: [1, 0, 0], swap: { iron: 'stone', glass: 'gold' } },
        { prefab: 'lamp', p: [2, 0, 0], mirror: true },
      ],
      lookup,
    );
    expect(flat[0].key).toBe(flat[1].key);
    expect(flat[0].key).toBe('|glass>gold,iron>stone');
    expect(flat[2].key).toBe(variantKey({ mirror: true, swap: [] }));
  });
});

describe('swaps', () => {
  const palette: VoxelMaterial[] = [
    { name: 'shirt', color: '#ffffff', kind: 'solid' },
    { name: 'cloth red', color: '#ff0000', kind: 'solid' },
    { name: 'blue', color: '#0000ff', kind: 'solid' },
  ];

  it("a parent's swaps apply after the child's own, and to what the child already uses", () => {
    expect([...composeSwaps({ Shirt: 'Cloth Red' }, new Map([['cloth red', 'blue'], ['hat', 'gold']]))]).toEqual([
      ['shirt', 'blue'],
      ['cloth red', 'blue'],
      ['hat', 'gold'],
    ]);
  });

  it('swapPalette draws one material as another, and ignores names it lacks', () => {
    const out = swapPalette(palette, [
      ['shirt', 'cloth red'],
      ['hat', 'blue'],
      ['blue', 'nothing'],
    ]);
    expect(out.map((m) => m.color)).toEqual(['#ff0000', '#ff0000', '#0000ff']);
    expect(palette[0].color).toBe('#ffffff');
    expect(swapPalette(palette, [])).toBe(palette);
  });
});

describe('mirrorData', () => {
  it('flips voxels across x (x → -1 - x), at every voxel size and across chunks', () => {
    const d = data([
      [0, 0, 0, 1],
      [17, 2, 3, 2],
      [-5, 1, 1, 3],
    ]);
    const m = mirrorData(d);
    const v = newVolume(0.25);
    for (const [k, text] of Object.entries(m.volumes[0].chunks)) v.chunks.set(k, decodeChunk(text));
    expect([getVoxel(v, -1, 0, 0), getVoxel(v, -18, 2, 3), getVoxel(v, 4, 1, 1)]).toEqual([1, 2, 3]);
    expect(getVoxel(v, 0, 0, 0)).toBe(0);
    expect(Object.keys(m.volumes[0].chunks).sort()).toEqual([chunkKey(-1, 0, 0), chunkKey(-2, 0, 0), chunkKey(0, 0, 0)].sort());
    // twice is the original
    expect(mirrorData(m).volumes[0].chunks).toEqual(d.volumes[0].chunks);
  });
});
