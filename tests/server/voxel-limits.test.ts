// Review fixes for the voxel world: work limits that keep a build or an import from holding up the
// server, undo that puts everything back (or refuses and changes nothing), and prefabs that keep what
// they are when they are stamped, saved, exported or shared.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, runBuild } from '../../server/voxel/ops.ts';
import type { Grid } from '../../server/voxel/ops.ts';
import { parseVox, voxVoxels, gridToVox } from '../../server/voxel/vox.ts';
import type { VoxFile } from '../../server/voxel/vox.ts';
import { toGlb } from '../../server/voxel/gltf.ts';
import { importVox } from '../../server/voxel/exchange.ts';
import { build, undo, changeObject, WORLD_LIMITS } from '../../server/voxel/build.ts';
import { savePrefabFrom, publishPrefab, importPrefab } from '../../server/voxel/prefabs.ts';
import { setAnimation } from '../../server/voxel/characters.ts';
import { shownWorld, chooseWorld } from '../../server/voxel/link.ts';
import { getWorld, readObject, readPrefab, worldVoxels } from '../../server/voxel/store.ts';
import { activeProject } from '../../server/store.ts';
import { dataPath, ensureDir } from '../../server/util.ts';
import { countVoxels, newVolume, setVoxel } from '../../shared/voxel.ts';
import type { VoxelMaterial, WorldBuilder } from '../../shared/types.ts';

const A: WorldBuilder = { kind: 'agent', id: 'ana', name: 'Ana' };
const B: WorldBuilder = { kind: 'agent', id: 'ben', name: 'Ben' };
/** a new empty world for the active project, so each test starts clean */
const fresh = () => chooseWorld(activeProject().id, 'new').world!;
const world = () => shownWorld().world!;

let n = 0;
const newId = () => `g${++n}`;
const run = (steps: unknown[], palette: VoxelMaterial[] = []) => {
  const grids: Grid[] = [];
  const out = runBuild({ grids, palette, voxelSize: 0.25, steps, newId });
  return { ...out, total: grids.reduce((s, g) => s + countVoxels(g.vol), 0) };
};

const int32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return [...b];
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('builds that would hold up the server stop with an error', () => {
  it('an outline with far-out points (finding 12)', () => {
    expect(() => run([{ extrude: { points: [[1e20, 0], [1e20, 1], [1e20, 2]] }, use: 'stone' }])).toThrow(/more than 2048 voxels from the spot/);
    expect(() => run([{ path: [[0, 0], [1e20, 0]], use: 'stone' }])).toThrow(/more than 2048 voxels/);
  }, 10_000);

  it('a huge shape that changes nothing still has a work limit (finding 12)', () => {
    // erasing nothing changes no voxels, so only the work limit stops it (a lower one here, to stay quick)
    const was = LIMITS.work;
    LIMITS.work = 1_000_000;
    try {
      expect(() => run([{ revolve: [[250, -250], [250, 250]], erase: true }])).toThrow(/too much to work out/);
      expect(() => run([{ box: [512, 512, 512], at: [-256, -256, -256], erase: true }])).toThrow(/too much to work out/);
      expect(() => run([{ cylinder: 250, height: 500, at: [0, -250, 0], erase: true }])).toThrow(/too much to work out/);
    } finally {
      LIMITS.work = was;
    }
    expect(run([{ box: [64, 64, 64], erase: true }]).total).toBe(0);
  }, 10_000);

  it('outlines still fill like before, now worked out a row at a time', () => {
    expect(run([{ extrude: { points: [[0, 0], [4, 0], [4, 3], [0, 3]], height: 2 }, use: 'stone' }]).total).toBe(24);
    // a triangle: half-ish of its box, even-odd at the voxels' middles
    expect(run([{ extrude: { points: [[0, 0], [8, 0], [0, 8]], height: 1 }, use: 'stone' }]).total).toBe(28);
  });

  it('"wall" beside "height" makes hollow walls, in voxels and in map units (finding 55)', () => {
    const square = [[0, 0], [5, 0], [5, 5], [0, 5]];
    expect(run([{ extrude: { points: square }, height: 1, wall: 1, use: 'stone' }]).total).toBe(16);
    const map = runBuild({ grids: [], palette: [], voxelSize: 0.25, units: 'map', newId, steps: [{ use: 'stone' }, { extrude: { points: [[0, 0], [1.25, 0], [1.25, 1.25], [0, 1.25]] }, height: 0.25, wall: 0.25 }] });
    expect(map.added).toBe(16);
  });
});

describe('.vox files that would hold up the server', () => {
  it('a 32-byte file with a negative children size is damaged, not an endless loop (finding 13)', () => {
    const bytes = new Uint8Array([...ascii('VOX '), ...int32(150), ...ascii('MAIN'), ...int32(0), ...int32(12), ...ascii('JUNK'), ...int32(0), ...int32(-12)]);
    expect(bytes.length).toBe(32);
    expect(() => parseVox(bytes)).toThrow(/damaged/);
  }, 5_000);

  // a chain of groups, each naming the next twice: 2^layers copies of one model
  const chain = (layers: number, voxels: number): VoxFile => {
    const nodes: VoxFile['nodes'] = new Map();
    nodes.set(0, { kind: 'trn', child: 1 });
    for (let i = 1; i <= layers; i++) nodes.set(i, { kind: 'grp', children: [i + 1, i + 1] });
    nodes.set(layers + 1, { kind: 'shp', models: [0] });
    const xyzi = new Uint8Array(voxels * 4);
    for (let i = 0; i < voxels; i++) xyzi.set([i, 0, 0, 1], i * 4);
    return { models: [{ size: [voxels || 1, 1, 1], xyzi }], palette: [], materials: new Map(), nodes };
  };

  it('counts every placed copy of a model toward the voxel limit (finding 14)', () => {
    expect(voxVoxels(chain(8, 1)).length).toBe(256);
    expect(() => voxVoxels(chain(30, 50))).toThrow(/places more than 1,000,000 voxels/);
  }, 10_000);

  it('a scene that names empty models over and over has a limit too (finding 14)', () => {
    expect(() => voxVoxels(chain(30, 0))).toThrow(/scene is too big/);
  }, 10_000);
});

describe('prefab graphs', () => {
  it('copies of copies have a limit on what they draw, and a prefab that grows counts for its holders (finding 48)', () => {
    fresh();
    build({ by: A, prefab: 'Leaf', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    build({ by: A, prefab: 'Hedge', steps: [{ place: 'Leaf', grid: { rows: 40, cols: 50, gap: [1, 1] } }] });
    // 9 hedges of 2,000 leaves: 18,009 copies drawn
    build({ by: A, prefab: 'Maze', steps: Array.from({ length: 9 }, (_, i) => ({ place: 'Hedge', at: [i * 60, 0, 0] })) });
    expect(() => build({ by: A, prefab: 'Maze', steps: [{ place: 'Hedge', at: [600, 0, 0] }] })).toThrow(/the prefab "Maze" draw 20,010 copies/);
    expect(() => build({ by: A, prefab: 'Hedge', steps: [{ place: 'Leaf', grid: { rows: 10, cols: 30, gap: [1, 1] }, at: [0, 0, 50] }] })).toThrow(/the prefab "Maze" draw/);
    expect(() => build({ by: A, object: 'Garden', steps: [{ place: 'Maze' }, { place: 'Maze', at: [0, 0, 100] }] })).toThrow(/"Garden" draw 36,020 copies/);
    expect(build({ by: A, object: 'Garden', steps: [{ place: 'Maze' }] }).created).toBe(true);
  }, 20_000);

  it('nesting depth is the longest path, even through a prefab reached twice (finding 99)', () => {
    fresh();
    build({ by: A, prefab: 'L', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    build({ by: A, prefab: 'C', steps: [{ place: 'L' }] });
    build({ by: A, prefab: 'A', steps: [{ place: 'C' }] });
    // B: C (and L) through one path, A (then C and L) through the other: 3 deep
    build({ by: A, prefab: 'B', steps: [{ place: 'C' }, { place: 'A', at: [4, 0, 0] }] });
    expect(() => build({ by: A, prefab: 'D', steps: [{ place: 'B' }] })).toThrow(/nest at most 4 deep/);
  });

  it('a stamp checks the copies it brings like placing them (finding 49)', () => {
    fresh();
    build({ by: A, prefab: 'Q', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    build({ by: A, prefab: 'P', steps: [{ box: [1, 1, 1], use: 'wood' }, { place: 'Q', at: [2, 0, 0] }] });
    expect(() => build({ by: A, prefab: 'Q', steps: [{ stamp: 'P', at: [0, 2, 0] }] })).toThrow(/can't be placed inside itself/);
    expect(readPrefab(world().id, world().prefabs.find((p) => p.name === 'Q')!.id)!.instances).toBeUndefined();
  });

  it('a stamp carries its swap into the copies it brings, after their own (finding 100)', () => {
    fresh();
    build({ by: A, prefab: 'Lf', steps: [{ box: [1, 1, 1], use: 'red lacquer' }] });
    build({ by: A, prefab: 'Cc', steps: [{ place: 'Lf' }, { place: 'Lf', at: [2, 0, 0], swap: { stone: 'red lacquer' } }] });
    const r = build({ by: A, object: 'Stamped', steps: [{ stamp: 'Cc', swap: { 'red lacquer': 'neon blue' } }] });
    const placed = readObject(world().id, r.object.id)!.instances!;
    expect(placed.map((i) => i.swap)).toEqual([{ 'red lacquer': 'neon blue' }, { stone: 'neon blue', 'red lacquer': 'neon blue' }]);
  });

  it('a .glb carries a parent copy\'s swap into the copies inside it (finding 52)', () => {
    fresh();
    build({ by: A, prefab: 'Lf', steps: [{ box: [1, 1, 1], use: 'red lacquer' }] });
    build({ by: A, prefab: 'Cc', steps: [{ place: 'Lf' }] });
    build({ by: A, object: 'Plain', steps: [{ place: 'Cc' }] });
    build({ by: A, object: 'Blue', steps: [{ place: 'Cc', swap: { 'red lacquer': 'neon blue' } }] });
    const glb = toGlb(world(), { kind: 'world' });
    const v = new DataView(glb.buffer, glb.byteOffset);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + v.getUint32(12, true)))) as { meshes: { name: string }[] };
    // the leaf drawn red in one and blue in the other: two meshes
    expect(json.meshes.filter((m) => m.name === 'Lf')).toHaveLength(2);
  });
});

describe('undo', () => {
  it('brings back a grid the change emptied (finding 15)', () => {
    fresh();
    build({ by: A, object: 'Shed', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    build({ by: A, object: 'Shed', steps: [{ clear: true }] });
    expect(readObject(world().id, world().objects[0].id)!.volumes).toHaveLength(0);
    expect(undo(A).text).toMatch(/Undid: Ana changed Shed/);
    const shed = world().objects[0];
    expect(readObject(world().id, shed.id)!.volumes).toHaveLength(1);
    expect(shed.volumes[0].count).toBe(1);
  });

  it('a bad pivot changes nothing (finding 16)', () => {
    fresh();
    build({ by: A, prefab: 'Rock', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    const id = world().prefabs[0].id;
    expect(() => build({ by: A, prefab: 'Rock', pivot: 'invalid', steps: [{ clear: true }] })).toThrow(/pivot is/);
    expect(readPrefab(world().id, id)!.volumes).toHaveLength(1);
  });

  it("won't take away a new prefab another builder has placed (finding 17)", () => {
    fresh();
    build({ by: A, prefab: 'Post', steps: [{ box: [1, 2, 1], use: 'wood' }] });
    build({ by: B, object: 'Fence', steps: [{ place: 'Post' }] });
    expect(() => undo(A)).toThrow(/placed in "Fence"/);
    expect(world().prefabs.some((p) => p.name === 'Post')).toBe(true);
    // once the copy is gone it can go
    undo(B);
    expect(undo(A).text).toMatch(/built the prefab Post/);
    expect(world().prefabs).toHaveLength(0);
  });

  it('puts a changed material back, and takes a new one away again (finding 18)', () => {
    fresh();
    build({ by: A, object: 'Rock', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    const stone = world().palette.find((m) => m.name === 'stone')!.color;
    build({ by: A, object: 'Rock', steps: [{ material: 'stone', color: '#ff0000' }] });
    expect(world().palette.find((m) => m.name === 'stone')!.color).toBe('#ff0000');
    undo(A);
    expect(world().palette.find((m) => m.name === 'stone')!.color).toBe(stone);
    build({ by: A, object: 'Lamp', steps: [{ box: [1, 1, 1], use: 'lantern' }] });
    expect(world().palette.some((m) => m.name === 'lantern')).toBe(true);
    undo(A);
    expect(world().palette.some((m) => m.name === 'lantern')).toBe(false);
  });

  it("won't put a material back over someone's later change to it (finding 18)", () => {
    fresh();
    build({ by: A, object: 'Rock', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    build({ by: A, object: 'Rock', steps: [{ material: 'stone', color: '#ff0000' }] });
    build({ by: B, object: 'Wall', steps: [{ material: 'stone', color: '#00ff00' }, { box: [1, 1, 1] }] });
    expect(() => undo(A)).toThrow(/"stone" was changed again/);
    expect(world().palette.find((m) => m.name === 'stone')!.color).toBe('#00ff00');
  });

  it("won't give back a name another object has now (finding 102)", () => {
    fresh();
    build({ by: A, object: 'Oak', steps: [{ box: [1, 1, 1], use: 'wood' }] });
    changeObject({ by: A, object: 'Oak', name: 'Birch' });
    build({ by: B, object: 'Oak', steps: [{ box: [1, 1, 1], use: 'wood' }] });
    expect(() => undo(A)).toThrow(/give back the name "Oak"/);
    expect(world().objects.map((o) => o.name).sort()).toEqual(['Birch', 'Oak']);
  });
});

describe('saving part of an object as a prefab', () => {
  it('counts against the world voxel limit when the part stays in the object too (finding 53)', () => {
    fresh();
    build({ by: A, object: 'Hut', steps: [{ box: [2, 2, 2], use: 'wood' }] });
    const was = WORLD_LIMITS.voxels;
    WORLD_LIMITS.voxels = worldVoxels(world()) + 1;
    try {
      expect(() => savePrefabFrom({ by: A, name: 'Hut part', from: 'Hut' })).toThrow(/no room/);
      expect(savePrefabFrom({ by: A, name: 'Hut part', from: 'Hut', replace: true }).prefab.name).toBe('Hut part');
    } finally {
      WORLD_LIMITS.voxels = was;
    }
  });

  it("won't wrap copies that already nest as deep as they may (finding 87)", () => {
    fresh();
    build({ by: A, prefab: 'L', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    build({ by: A, prefab: 'C', steps: [{ place: 'L' }] });
    build({ by: A, prefab: 'A', steps: [{ place: 'C' }] });
    build({ by: A, prefab: 'B', steps: [{ place: 'A' }] });
    build({ by: A, object: 'Tower', steps: [{ place: 'B' }] });
    expect(() => savePrefabFrom({ by: A, name: 'Wrapper', from: 'Tower', replace: true })).toThrow(/nest at most 4 deep/);
    expect(world().prefabs.some((p) => p.name === 'Wrapper')).toBe(false);
    // one level less is fine
    build({ by: A, object: 'Hall', steps: [{ place: 'A' }] });
    expect(savePrefabFrom({ by: A, name: 'Wrapper', from: 'Hall', replace: true }).prefab.instances).toBe(1);
  });
});

describe('the prefab library', () => {
  it('keeps a prefab\'s pivot and animations (finding 86)', () => {
    fresh();
    build({ by: A, prefab: 'Bell', pivot: 'top', steps: [{ box: [1, 2, 1], use: 'iron' }] });
    setAnimation({ by: A, prefab: 'Bell', action: 'set', clip: 'ring', fields: { duration: 1, tracks: { self: [{ t: 0, turn: [0, 0, 0] }, { t: 1, turn: [20, 0, 0] }] } } });
    publishPrefab({ by: A, prefab: 'Bell' });
    fresh();
    const r = importPrefab({ by: A, name: 'Bell' });
    expect(r.prefab.pivotAt).toBe('top');
    expect(r.prefab.pivot[1]).toBe(0.5);
    expect(Object.keys(r.prefab.animations || {})).toEqual(['ring']);
  });
});

describe('.vox import', () => {
  const voxFile = (name: string, points: [number, number, number][]) => {
    const vol = newVolume(0.25);
    for (const [x, y, z] of points) setVoxel(vol, x, y, z, 1);
    const dir = dataPath('vox-tests');
    ensureDir(dir);
    const file = `${dir}/${name}.vox`;
    fs.writeFileSync(file, gridToVox({ id: 'g', voxelSize: 0.25, vol }, [{ name: 'stone', color: '#7d7a74', kind: 'solid' }]));
    return file;
  };

  it('a prefab-only import marks the world built (finding 54)', () => {
    const w = fresh();
    expect(getWorld(w.id)!.built).toBe(false);
    importVox({ by: A, file: voxFile('pebble', [[0, 0, 0]]), as: 'prefab', name: 'Pebble' });
    expect(getWorld(w.id)!.built).toBe(true);
  });

  it('refuses a model the build tools could not edit (finding 101)', () => {
    fresh();
    expect(() => importVox({ by: A, file: voxFile('tall', [[0, 0, 0], [0, 256, 0]]), as: 'object', name: 'Tall', voxelSize: 0.25 })).toThrow(/reaches past 256 voxels/);
    expect(world().objects).toHaveLength(0);
    importVox({ by: A, file: voxFile('short', [[0, 0, 0], [0, 255, 0]]), as: 'object', name: 'Short', voxelSize: 0.25 });
    expect(build({ by: A, object: 'Short', steps: [{ clear: true }] }).outcome.removed).toBe(2);
  });
});
