// Shape tools, region tools, prefabs and placing copies: everything in a world is built by its builders.
import { describe, expect, it } from 'vitest';
import { runBuild } from '../../server/voxel/ops.ts';
import type { Grid, PrefabRef } from '../../server/voxel/ops.ts';
import { countVoxels, getVoxel } from '../../shared/voxel.ts';
import { build, undo, changeObject, placedCopies, WORLD_LIMITS } from '../../server/voxel/build.ts';
import { setSkin } from '../../server/voxel/characters.ts';
import { savePrefabFrom, deletePrefab, publishPrefab, importPrefab, libraryList, prefabList, changePrefab } from '../../server/voxel/prefabs.ts';
import { shownWorld, chooseWorld } from '../../server/voxel/link.ts';
import { readObject, readPrefab } from '../../server/voxel/store.ts';
import type { PrefabInstance, VoxelMaterial, WorldBuilder } from '../../shared/types.ts';

let n = 0;
const newId = () => `g${++n}`;
function run(steps: unknown[], o: { grids?: Grid[]; palette?: VoxelMaterial[]; instances?: PrefabInstance[]; prefabs?: PrefabRef[]; loadPrefab?: (id: string) => { grids: Grid[]; instances: PrefabInstance[] } | null } = {}) {
  const grids = o.grids || [];
  const palette = o.palette || [];
  const out = runBuild({ grids, palette, voxelSize: 0.25, steps, newId, instances: o.instances, prefabs: o.prefabs, loadPrefab: o.loadPrefab });
  return { ...out, palette, total: grids.reduce((s, g) => s + countVoxels(g.vol), 0), g: grids[0]?.vol };
}

describe('shape tools', () => {
  it('revolve turns a profile into a round or many-sided column', () => {
    const r = run([{ revolve: [[1, 0], [1, 4]], use: 'stone' }]);
    expect(r.total).toBe(4 * 5);
    expect(run([{ revolve: [[2, 0], [2, 1]], sides: 4, use: 'stone' }]).total).toBeGreaterThan(run([{ revolve: [[2, 0], [2, 1]], use: 'stone' }]).total);
    // a cone-like taper: narrower at the top
    const t = run([{ revolve: [[4, 0], [0, 4]], use: 'stone' }]);
    expect(getVoxel(t.g, 3, 0, 0)).toBe(1);
    expect(getVoxel(t.g, 3, 3, 0)).toBe(0);
    expect(() => run([{ revolve: [[1, 0]], use: 'stone' }])).toThrow(/at least 2 points/);
  });

  it('extrude raises an outline, solid or as walls', () => {
    expect(run([{ extrude: { points: [[0, 0], [4, 0], [4, 3], [0, 3]], height: 2 }, use: 'stone' }]).total).toBe(4 * 3 * 2);
    expect(run([{ extrude: { rows: ['###', '#.#', '###'], height: 1 }, use: 'brick' }]).total).toBe(8);
    expect(run([{ extrude: { points: [[0, 0], [5, 0], [5, 5], [0, 5]], height: 1, wall: 1 }, use: 'stone' }]).total).toBe(16);
  });

  it('path sweeps a brush along points', () => {
    const r = run([{ path: [[0, 0], [10, 0]], width: 3, use: 'cobble' }]);
    expect(getVoxel(r.g, 5, 0, 1)).toBe(1);
    expect(getVoxel(r.g, 5, 0, 3)).toBe(0);
    const hill = run([{ path: [[0, 0, 0], [10, 5, 0]], width: 1, use: 'cobble' }]);
    expect(getVoxel(hill.g, 10, 5, 0)).toBe(1);
  });

  it('blob is rough and holey, and repeatable', () => {
    const a = run([{ seed: 3 }, { blob: [4, 3, 4], rough: 0.3, holes: 0.2, use: 'leaves' }]);
    const b = run([{ seed: 3 }, { blob: [4, 3, 4], rough: 0.3, holes: 0.2, use: 'leaves' }]);
    expect(a.total).toBe(b.total);
    expect(a.total).toBeLessThan(run([{ ellipsoid: [4, 3, 4], use: 'leaves' }]).total);
  });
});

describe('region tools', () => {
  const L = () => run([{ box: [3, 1, 1], use: 'stone' }, { box: [1, 1, 1], at: [0, 0, 1], use: 'brick' }]);
  it('copy turned and mirrored, shift, rotate and flip', () => {
    const grids: Grid[] = [];
    run([{ box: [3, 1, 1], use: 'stone' }, { box: [1, 1, 1], at: [0, 0, 1], use: 'brick' }, { copy: [3, 1, 2], from: [0, 0, 0], at: [10, 0, 0], turn: 90 }], { grids });
    const g = grids[0].vol;
    // the brick at (0, 1) of the 3×2 box, turned a quarter, is at (1, 2) of the 2×3 box
    expect(getVoxel(g, 11, 0, 2)).toBe(2);
    expect(countVoxels(g)).toBe(8);
    const s: Grid[] = [];
    run([{ box: [2, 1, 1], use: 'stone' }, { shift: [2, 1, 1], from: [0, 0, 0], at: [5, 0, 0] }], { grids: s });
    expect([getVoxel(s[0].vol, 0, 0, 0), getVoxel(s[0].vol, 5, 0, 0), getVoxel(s[0].vol, 6, 0, 0)]).toEqual([0, 1, 1]);
    const f: Grid[] = [];
    run([{ box: [1, 1, 1], use: 'stone' }, { flip: [3, 1, 1], axis: 'x' }], { grids: f });
    expect([getVoxel(f[0].vol, 0, 0, 0), getVoxel(f[0].vol, 2, 0, 0)]).toEqual([0, 1]);
    expect(L().total).toBe(4);
    expect(() => run([{ box: [1, 1, 1], use: 'stone' }, { rotate: [2, 1, 2], turn: 45 }])).toThrow(/0, 90, 180 or 270/);
  });
});

describe('placing copies', () => {
  const prefabs: PrefabRef[] = [
    { id: 'p1', name: 'Palm', pivot: [0.125, 0, 0.125] },
    { id: 'p2', name: 'Person', pivot: [0, 0, 0] },
  ];
  it('places one at a spot, at any angle, recoloured', () => {
    const r = run([{ place: 'palm', at: [4, 0, 8], turn: 33.3, swap: { leaves: 'autumn leaves' }, scale: 1.5 }], { prefabs });
    expect(r.instances).toEqual([{ prefab: 'p1', p: [1.125, 0, 2.125], turn: 33.3, scale: 1.5, swap: { leaves: 'autumn leaves' } }]);
    expect(r.palette.map((m) => m.name)).toContain('autumn leaves');
    expect(r.placed).toBe(1);
  });

  it('scatter puts many on the ground below them, picked from a list', () => {
    const grids: Grid[] = [];
    const r = run([{ use: 'sand' }, { box: [40, 2, 40] }, { place: ['Palm', 'Person'], scatter: { area: [40, 40], count: 30, spacing: 2 }, turn: 'random' }], { grids, prefabs });
    expect(r.instances.length).toBe(30);
    expect(r.instances.every((i) => i.p[1] === 0.5)).toBe(true);
    expect(new Set(r.instances.map((i) => i.prefab)).size).toBe(2);
    expect(new Set(r.instances.map((i) => i.turn)).size).toBeGreaterThan(20);
  });

  it('along a path on both sides facing along it, and in a grid', () => {
    const r = run([{ place: 'Person', along: [[0, 0], [40, 0]], every: 10, sides: 2, offset: 4, face: 'along', on: 'spot' }], { prefabs });
    expect(r.instances.length).toBe(10);
    expect(new Set(r.instances.map((i) => i.p[2]))).toEqual(new Set([1.125, -0.875]));
    expect(r.instances.every((i) => i.turn === 90)).toBe(true);
    expect(run([{ place: 'Person', grid: { rows: 3, cols: 4, gap: [2, 2] } }], { prefabs }).instances.length).toBe(12);
  });

  it('unplace takes copies away; a failing step keeps the copies there were', () => {
    const instances: PrefabInstance[] = [{ prefab: 'p1', p: [0, 0, 0] }, { prefab: 'p2', p: [0, 0, 0] }, { prefab: 'p1', p: [100, 0, 0] }];
    const r = run([{ unplace: 'Palm', in: [10, 10, 10], at: [-5, -5, -5] }], { prefabs, instances });
    expect(r.instances).toEqual([{ prefab: 'p2', p: [0, 0, 0] }, { prefab: 'p1', p: [100, 0, 0] }]);
    expect(r.unplaced).toBe(1);
    expect(() => run([{ place: 'Palm' }, { place: 'Nope' }], { prefabs, instances })).toThrow(/Step 2 \(place\): no prefab "Nope". This world's prefabs: Palm, Person/);
    expect(instances.length).toBe(3);
  });

  it('stamp bakes a prefab into the voxels, turned in quarter turns', () => {
    const pg: Grid[] = [];
    const palette: VoxelMaterial[] = [];
    run([{ box: [2, 1, 1], use: 'stone' }], { grids: pg, palette });
    const loadPrefab = () => ({ grids: pg, instances: [] });
    const grids: Grid[] = [];
    run([{ stamp: 'Palm', at: [10, 0, 10], turn: 90 }], { grids, palette, prefabs: [{ id: 'p1', name: 'Palm', pivot: [0, 0, 0] }], loadPrefab });
    expect(countVoxels(grids[0].vol)).toBe(2);
    // turned a quarter (like a placed copy's turn: +x goes to -z): it runs along z now
    expect(getVoxel(grids[0].vol, 10, 0, 9) + getVoxel(grids[0].vol, 10, 0, 8)).toBe(2);
    expect(() => run([{ stamp: 'Palm', turn: 30 }], { prefabs: [{ id: 'p1', name: 'Palm', pivot: [0, 0, 0] }], loadPrefab })).toThrow(/90° steps/);
  });
});

const me: WorldBuilder = { kind: 'agent', id: 'mira', name: 'Mira' };

describe('prefabs in a world', () => {
  it('build a prefab, place copies of it in an object, and its pivot is its bottom centre', () => {
    const r = build({ by: me, prefab: 'Lamp post', description: 'an iron street lamp', steps: [{ voxel_size: 0.125 }, { box: [2, 16, 2], at: [-1, 0, -1], use: 'iron' }, { box: [2, 2, 2], at: [-1, 16, -1], use: 'lantern' }] });
    expect(r.kind).toBe('prefab');
    expect(r.text).toMatch(/Built the prefab "Lamp post"/);
    const lamp = shownWorld().world!.prefabs.find((p) => p.name === 'Lamp post')!;
    expect(lamp.pivot).toEqual([0, 0, 0]);
    expect(lamp.size).toEqual([0.25, 2.25, 0.25]);
    const street = build({ by: me, object: 'Street', steps: [{ box: [41, 1, 8], use: 'cobble' }, { place: 'Lamp post', along: [[0, 4], [40, 4]], every: 10, sides: 2, offset: 3 }] });
    // every 10 voxels from 0 to 40 is 5 a side
    expect(street.text).toMatch(/10 copies placed/);
    const data = readObject(shownWorld().world!.id, street.object.id)!;
    expect(data.instances!.length).toBe(10);
    expect(data.instances!.every((i) => i.p[1] === 0.25)).toBe(true);
    expect(shownWorld().world!.objects.find((o) => o.name === 'Street')!.instances).toBe(10);
    expect(prefabList(shownWorld().world!)).toMatch(/"Lamp post" .* 10 copies in "Street"/);
  });

  it("a prefab can hold copies of others, but not of itself", () => {
    build({ by: me, prefab: 'Corner', steps: [{ box: [4, 1, 4], use: 'stone' }, { place: 'Lamp post', at: [2, 1, 2] }] });
    expect(() => build({ by: me, prefab: 'Lamp post', steps: [{ place: 'Corner' }] })).toThrow(/can't be placed inside itself/);
    expect(() => build({ by: me, prefab: 'Corner', steps: [{ place: 'Corner' }] })).toThrow(/can't be placed inside itself/);
  });

  it('undo takes placed copies away again', () => {
    build({ by: me, object: 'Street', steps: [{ place: 'Lamp post', at: [20, 1, 0] }] });
    expect(readObject(shownWorld().world!.id, shownWorld().world!.objects.find((o) => o.name === 'Street')!.id)!.instances!.length).toBe(11);
    undo(me);
    expect(readObject(shownWorld().world!.id, shownWorld().world!.objects.find((o) => o.name === 'Street')!.id)!.instances!.length).toBe(10);
  });

  it('save part of an object as a prefab, putting a copy where it was', () => {
    build({ by: me, object: 'Market', steps: [{ box: [8, 1, 8], use: 'sand' }, { box: [2, 3, 2], at: [5, 1, 5], use: 'wood' }] });
    const r = savePrefabFrom({ by: me, name: 'Stall', from: 'Market', box: { min: [1.25, 0.25, 1.25], max: [1.75, 1, 1.75] }, replace: true, description: 'a wooden stall' });
    expect(r.prefab.volumes[0].count).toBe(12);
    const w = shownWorld().world!;
    const market = w.objects.find((o) => o.name === 'Market')!;
    expect(market.volumes[0].count).toBe(64);
    expect(readObject(w.id, market.id)!.instances).toEqual([{ prefab: r.prefab.id, p: r.prefab.pivot }]);
    expect(() => savePrefabFrom({ by: me, name: 'Empty', from: 'Market', box: { min: [100, 100, 100], max: [101, 101, 101] } })).toThrow(/Nothing of that object/);
  });

  it("can't delete a prefab that is placed; rename and describe one", () => {
    expect(() => deletePrefab({ by: me, prefab: 'Lamp post' })).toThrow(/placed \d+ times/);
    expect(changePrefab({ by: me, prefab: 'Stall', name: 'Market stall', tags: ['market'] }).text).toMatch(/name, tags/);
    build({ by: me, prefab: 'Spare', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    expect(deletePrefab({ by: me, prefab: 'Spare' })).toMatch(/Deleted the prefab "Spare"/);
    undo(me);
    expect(shownWorld().world!.prefabs.some((p) => p.name === 'Spare')).toBe(true);
  });

  it('publish to the library and import into another world, materials matched by name', () => {
    expect(() => publishPrefab({ by: me, prefab: 'Corner' })).toThrow(/holds copies of other prefabs/);
    expect(publishPrefab({ by: me, prefab: 'Lamp post' })).toMatch(/Published "Lamp post"/);
    expect(libraryList('lamp')).toMatch(/"Lamp post" by Mira/);
    const from = shownWorld().world!;
    chooseWorld(from.homeProject, 'new');
    const r = importPrefab({ by: me, name: 'lamp post' });
    const w = shownWorld().world!;
    expect(w.id).not.toBe(from.id);
    expect(w.palette.map((m) => m.name).sort()).toEqual(['iron', 'lantern']);
    expect(readPrefab(w.id, r.prefab.id)!.volumes[0].chunks).toBeTruthy();
    expect(r.prefab.size).toEqual([0.25, 2.25, 0.25]);
    void changeObject;
  });
});

describe('prefabs: undo, skins and limits', () => {
  it('saving with replace is one change: one undo puts the part back and takes the prefab away', () => {
    build({ by: me, object: 'Yard', steps: [{ box: [4, 1, 4], use: 'sand' }, { box: [1, 2, 1], at: [1, 1, 1], use: 'wood' }] });
    const w0 = shownWorld().world!;
    const yard = w0.objects.find((o) => o.name === 'Yard')!;
    const before = readObject(w0.id, yard.id);
    const r = savePrefabFrom({ by: me, name: 'Post', from: 'Yard', box: { min: [0.25, 0.25, 0.25], max: [0.5, 0.75, 0.5] }, replace: true });
    expect(r.prefab.volumes[0].count).toBe(2);
    expect(undo(me).text).toMatch(/turned part of Yard into the prefab Post/);
    const w = shownWorld().world!;
    expect(w.prefabs.some((p) => p.id === r.prefab.id)).toBe(false);
    expect(readPrefab(w.id, r.prefab.id)).toBeNull();
    expect(readObject(w.id, yard.id)).toEqual(before);
    expect(w.objects.find((o) => o.id === yard.id)!.volumes[0].count).toBe(18);
  });

  it("won't undo the replace while the new prefab is placed somewhere else", () => {
    savePrefabFrom({ by: me, name: 'Post', from: 'Yard', box: { min: [0.25, 0.25, 0.25], max: [0.5, 0.75, 0.5] }, replace: true });
    build({ by: { kind: 'user', name: 'You' }, object: 'Fence', steps: [{ place: 'Post', at: [0, 0, 0] }] });
    expect(() => undo(me)).toThrow(/placed in "Fence"/);
    expect(shownWorld().world!.prefabs.some((p) => p.name === 'Post')).toBe(true);
  });

  it("can't delete a prefab the Brain, a team or an agent wears", () => {
    build({ by: me, prefab: 'Shell', steps: [{ box: [3, 3, 3], use: 'glass', hollow: true }] });
    setSkin({ by: me, to: 'brain', fields: { shell: 'Shell' } });
    expect(() => deletePrefab({ by: me, prefab: 'Shell' })).toThrow(/"Shell" is the Brain's shell/);
    setSkin({ by: me, to: 'brain', fields: { shell: null } });
    expect(deletePrefab({ by: me, prefab: 'Shell' })).toMatch(/Deleted the prefab "Shell"/);
  });

  it('a copy of an object counts the copies placed in it toward the limit', () => {
    build({ by: me, prefab: 'Peg', steps: [{ box: [1, 1, 1], use: 'wood' }] });
    build({ by: me, object: 'Pegs', steps: [0, 2, 4, 6].map((x) => ({ place: 'Peg', at: [x, 0, 0] })) });
    const was = WORLD_LIMITS.copies;
    WORLD_LIMITS.copies = placedCopies(shownWorld().world!) + 3;
    try {
      expect(() => changeObject({ by: me, object: 'Pegs', duplicate: true })).toThrow(/placed copies/);
    } finally {
      WORLD_LIMITS.copies = was;
    }
    expect(changeObject({ by: me, object: 'Pegs', duplicate: true }).object!.instances).toBe(4);
  });
});
