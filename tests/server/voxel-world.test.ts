import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBuild, BuildError, LIMITS, saveGrids } from '../../server/voxel/ops.ts';
import type { Grid } from '../../server/voxel/ops.ts';
import { countVoxels, getVoxel } from '../../shared/voxel.ts';
import { build, changeObject, undo } from '../../server/voxel/build.ts';
import { shownWorld, chooseWorld, setDefaultWorld, deleteUnusedWorld, listWorldsFor } from '../../server/voxel/link.ts';
import { setEnvironment } from '../../server/voxel/scene.ts';
import { getWorld, listWorlds, readObject, worldDir } from '../../server/voxel/store.ts';
import { editSection, readWorldMd, writeWorldMd, writeWorldMdSection, worldMdVersionsDir, worldMdTemplate } from '../../server/voxel/worldmd.ts';
import { worldInfo } from '../../server/voxel/describe.ts';
import { listProjects, saveProjects } from '../../server/store.ts';
import { dataPath } from '../../server/util.ts';
import type { VoxelMaterial, WorldBuilder } from '../../shared/types.ts';

let n = 0;
const newId = () => `g${++n}`;
function run(steps: unknown[], grids: Grid[] = [], palette: VoxelMaterial[] = [], voxelSize = 0.25) {
  const out = runBuild({ grids, palette, voxelSize, steps, newId });
  return { ...out, palette, total: grids.reduce((s, g) => s + countVoxels(g.vol), 0) };
}

describe('build steps', () => {
  it('boxes, spheres and a hollow box', () => {
    expect(run([{ use: 'stone' }, { box: [4, 2, 3] }]).total).toBe(24);
    expect(run([{ box: [3, 3, 3], use: 'stone', hollow: true }]).total).toBe(26);
    expect(run([{ sphere: 1, use: 'stone' }]).total).toBe(7);
  });

  it('adds a stock material on first use, and explains an unknown one', () => {
    const r = run([{ box: [1, 1, 1], use: 'Grass' }]);
    expect(r.palette.map((m) => m.name)).toEqual(['grass']);
    expect(r.newMaterials).toEqual(['grass']);
    expect(() => run([{ box: [1, 1, 1], use: 'unobtainium' }])).toThrow(/Step 1 \(box\): no material "unobtainium". Define it first/);
    const own = run([{ material: 'Unobtainium', color: '#123456', kind: 'emissive', emissive: 2 }, { box: [1, 1, 1] }]);
    expect(own.palette[0]).toMatchObject({ name: 'unobtainium', color: '#123456', kind: 'emissive', emissive: 2 });
  });

  it('a voxel_size step builds into a second grid of the same object', () => {
    const grids: Grid[] = [];
    run([{ use: 'stone' }, { box: [2, 2, 2] }, { voxel_size: 0.1 }, { box: [2, 2, 2] }], grids);
    expect(grids.map((g) => g.voxelSize)).toEqual([0.25, 0.1]);
    expect(grids.map((g) => countVoxels(g.vol))).toEqual([8, 8]);
  });

  it('the cursor keeps its place in map units when the voxel size changes', () => {
    const grids: Grid[] = [];
    run([{ use: 'stone' }, { at: [4, 0, 0] }, { voxel_size: 0.5 }, { box: [1, 1, 1] }], grids);
    // 4 voxels of 0.25 = 1 map unit = 2 voxels of 0.5
    expect(getVoxel(grids[1].vol, 2, 0, 0)).toBe(1);
  });

  it('mirrors across the cursor', () => {
    const grids: Grid[] = [];
    run([{ use: 'stone' }, { mirror: 'x' }, { box: [2, 1, 1], at: [1, 0, 0] }], grids);
    const g = grids[0].vol;
    expect([getVoxel(g, 1, 0, 0), getVoxel(g, 2, 0, 0), getVoxel(g, -2, 0, 0), getVoxel(g, -3, 0, 0)]).toEqual([1, 1, 1, 1]);
    expect(countVoxels(g)).toBe(4);
  });

  it('layers draw rows of characters, bottom layer first', () => {
    const grids: Grid[] = [];
    run([{ layers: [['#.#', '.o.'], ['###']], key: { '#': 'wood', o: 'lantern' } }], grids);
    const g = grids[0].vol;
    expect(countVoxels(g)).toBe(6);
    expect(getVoxel(g, 1, 0, 1)).toBe(2);
    expect(getVoxel(g, 1, 1, 0)).toBe(1);
    expect(() => run([{ layers: [['#x']], key: { '#': 'wood' } }])).toThrow(/"x" isn't in key/);
  });

  it('text, stairs, heightmap, replace and clear', () => {
    expect(run([{ text: 'I', use: 'neon pink' }]).total).toBe(11);
    expect(run([{ stairs: { steps: 3, width: 1 }, use: 'stone' }]).total).toBe(6);
    expect(run([{ heightmap: { rows: ['12', '03'] }, use: 'dirt', top: 'grass' }]).total).toBe(6);
    const grids: Grid[] = [];
    run([{ box: [3, 1, 1], use: 'stone' }, { replace: { from: 'stone', to: 'brick' } }], grids);
    expect(getVoxel(grids[0].vol, 0, 0, 0)).toBe(2);
    run([{ clear: true }], grids, [{ name: 'stone', color: '#808080', kind: 'solid' }]);
    expect(countVoxels(grids[0].vol)).toBe(0);
  });

  it('a failing step puts back everything the call changed', () => {
    const grids: Grid[] = [];
    run([{ box: [2, 2, 2], use: 'stone' }], grids);
    expect(() => run([{ box: [4, 4, 4], use: 'brick' }, { sphere: 'big' }], grids)).toThrow(BuildError);
    expect(countVoxels(grids[0].vol)).toBe(8);
    expect(getVoxel(grids[0].vol, 0, 0, 0)).toBe(1);
  });

  it('refuses builds that are too big or reach too far, with what to do', () => {
    expect(() => run([{ box: [100, 100, 100], use: 'stone' }])).toThrow(/at most 250,000 voxels/);
    expect(() => run([{ box: [1, 1, 1], use: 'stone', at: [LIMITS.reach, 0, 0] }])).toThrow(/bigger voxel size/);
    expect(() => run([{ teleport: true }])).toThrow(/unknown step/);
    expect(() => run([])).toThrow(/list of build steps/);
  });

  it('erase and keep', () => {
    const grids: Grid[] = [];
    run([{ box: [3, 1, 1], use: 'stone' }, { box: [1, 1, 1], at: [1, 0, 0], erase: true }, { box: [3, 1, 1], use: 'brick', keep: true }], grids);
    expect([0, 1, 2].map((x) => getVoxel(grids[0].vol, x, 0, 0))).toEqual([1, 2, 1]);
  });
});

const me: WorldBuilder = { kind: 'agent', id: 'mira', name: 'Mira' };
const other: WorldBuilder = { kind: 'agent', id: 'kenji', name: 'Kenji' };

function addProject(id: string) {
  const dir = dataPath('brains', id);
  fs.mkdirSync(dir, { recursive: true });
  saveProjects([...listProjects().filter((p) => p.id !== id), { id, name: `Project ${id}`, brainPath: dir, repo: '', createdAt: Date.now() }]);
}

describe('steps in map units', () => {
  // the same steps by hand in voxels, and in map units: the same voxels
  const voxels = (steps: unknown[], units: 'map' | 'voxels', size = 0.25) => {
    const grids: Grid[] = [];
    let k = 0;
    runBuild({ grids, palette: [], voxelSize: size, steps, newId: () => `m${++k}`, units });
    return JSON.stringify(saveGrids(grids));
  };
  it.each([
    ['box', [{ use: 'stone' }, { box: [1, 0.5, 2], at: [0.5, 0, -1] }], [{ use: 'stone' }, { box: [4, 2, 8], at: [2, 0, -4] }]],
    ['cylinder and cone', [{ use: 'stone' }, { cylinder: 1, height: 2 }, { cone: 0.75, height: 1, at: [0, 2, 0] }], [{ use: 'stone' }, { cylinder: 4, height: 8 }, { cone: 3, height: 4, at: [0, 8, 0] }]],
    ['path', [{ use: 'cobble' }, { path: [[0, 0], [5, 0], [5, 3]], width: 1, height: 0.25 }], [{ use: 'cobble' }, { path: [[0, 0], [20, 0], [20, 12]], width: 4, height: 1 }]],
    ['revolve', [{ use: 'stone' }, { revolve: [[0.75, 0], [0.5, 0.5], [0.5, 3]] }], [{ use: 'stone' }, { revolve: [[3, 0], [2, 2], [2, 12]] }]],
    ['extrude walls', [{ use: 'brick' }, { extrude: { points: [[0, 0], [3, 0], [3, 2], [0, 2]] }, height: 1, wall: 0.25 }], [{ use: 'brick' }, { extrude: { points: [[0, 0], [12, 0], [12, 8], [0, 8]] }, height: 4, wall: 1 }]],
    ['cursor and erase', [{ use: 'wood' }, { at: [1, 0, 1] }, { box: [1, 1, 1] }, { box: [0.5, 0.5, 0.5], erase: true }], [{ use: 'wood' }, { at: [4, 0, 4] }, { box: [4, 4, 4] }, { box: [2, 2, 2], erase: true }]],
    ['stairs and arch', [{ use: 'stone' }, { stairs: { steps: 3, width: 1, rise: 0.25, run: 0.5 } }, { arch: { width: 2, height: 2, thickness: 0.25, depth: 0.5 }, at: [3, 0, 0] }], [{ use: 'stone' }, { stairs: { steps: 3, width: 4, rise: 1, run: 2 } }, { arch: { width: 8, height: 8, thickness: 1, depth: 2 }, at: [12, 0, 0] }]],
  ])('%s', (_name, map, vox) => {
    expect(voxels(map, 'map')).toBe(voxels(vox, 'voxels'));
  });

  it('follows a change of voxel size in the middle of the call; drawings stay in voxels', () => {
    const map = [{ use: 'stone' }, { box: [1, 1, 1] }, { voxel_size: 0.5 }, { box: [1, 1, 1], at: [2, 0, 0] }, { layers: [['##']], key: { '#': 'stone' }, at: [0, 2, 0] }];
    const vox = [{ use: 'stone' }, { box: [4, 4, 4] }, { voxel_size: 0.5 }, { box: [2, 2, 2], at: [4, 0, 0] }, { layers: [['##']], key: { '#': 'stone' }, at: [0, 4, 0] }];
    expect(voxels(map, 'map')).toBe(voxels(vox, 'voxels'));
  });

  it('one step can say "units": "map" on its own, and a scatter repeats a step in map units', () => {
    expect(voxels([{ use: 'stone' }, { box: [1, 1, 1], units: 'map' }], 'voxels')).toBe(voxels([{ use: 'stone' }, { box: [4, 4, 4] }], 'voxels'));
    const scattered = [{ seed: 3 }, { use: 'leaves' }, { scatter: { count: 5, area: [4, 4], step: { box: [0.5, 0.5, 0.5] } } }];
    const byHand = [{ seed: 3 }, { use: 'leaves' }, { scatter: { count: 5, area: [16, 16], step: { box: [2, 2, 2] } } }];
    expect(voxels(scattered, 'map')).toBe(voxels(byHand, 'voxels'));
    expect(voxels([{ seed: 3 }, { use: 'leaves' }, { scatter: { count: 5, area: [4, 4], step: { box: [0.5, 0.5, 0.5] } }, units: 'map' }], 'voxels')).toBe(voxels(byHand, 'voxels'));
  });

  it('a small size still makes at least one voxel', () => {
    expect(voxels([{ use: 'stone' }, { box: [0.1, 0.1, 0.1] }], 'map')).toBe(voxels([{ use: 'stone' }, { box: [1, 1, 1] }], 'voxels'));
  });

});

describe('worlds and projects', () => {
  it('a project has no world until its first build', () => {
    const pid = listProjects()[0].id;
    expect(shownWorld(pid)).toEqual({ world: null, how: 'none' });
    const r = build({ by: me, object: 'Garden', steps: [{ box: [2, 1, 2], use: 'grass' }] });
    expect(r.created).toBe(true);
    expect(r.text).toMatch(/Built "Garden".*4 voxels added/);
    const s = shownWorld(pid);
    expect(s.how).toBe('own');
    expect(s.world!.objects.map((o) => o.name)).toEqual(['Garden']);
    expect(listProjects()[0].world).toEqual({ id: s.world!.id, mode: 'own' });
  });

  it('an unbuilt project carries the built world over, and its first build makes its own copy', () => {
    const first = shownWorld(listProjects()[0].id).world!;
    addProject('p2');
    const s = shownWorld('p2');
    expect(s).toMatchObject({ how: 'carried', fromProject: first.homeProject });
    expect(s.world!.id).toBe(first.id);
    build({ by: me, object: 'Tower', project: 'p2', steps: [{ box: [1, 3, 1], use: 'stone' }] });
    const mine = shownWorld('p2');
    expect(mine.how).toBe('own');
    expect(mine.world!.id).not.toBe(first.id);
    expect(mine.world!.objects.map((o) => o.name).sort()).toEqual(['Garden', 'Tower']);
    // the first project's world didn't change
    expect(getWorld(first.id)!.objects.map((o) => o.name)).toEqual(['Garden']);
  });

  it('the default world wins the carry-over; a chosen world wins over everything', () => {
    const first = shownWorld(listProjects()[0].id).world!;
    const second = shownWorld('p2').world!;
    addProject('p3');
    // most recently built: the second
    expect(shownWorld('p3').world!.id).toBe(second.id);
    setDefaultWorld(first.id);
    expect(shownWorld('p3').world!.id).toBe(first.id);
    setDefaultWorld(null);
    chooseWorld('p3', 'share', first.id);
    expect(shownWorld('p3')).toMatchObject({ how: 'shared' });
    build({ by: other, object: 'Shared hut', project: 'p3', steps: [{ box: [1, 1, 1], use: 'wood' }] });
    expect(getWorld(first.id)!.objects.map((o) => o.name)).toContain('Shared hut');
    expect(() => deleteUnusedWorld(first.id)).toThrow(/still uses/);
    expect(listWorldsFor().find((w) => w.id === first.id)!.usedBy.sort()).toEqual([listProjects()[0].id, 'p3'].sort());
    chooseWorld('p3', 'new');
    expect(shownWorld('p3').world!.objects).toEqual([]);
  });

  it("a change that fails or changes nothing doesn't copy a carried-over world", () => {
    addProject('p4');
    const carried = shownWorld('p4');
    expect(carried.how).toBe('carried');
    const worlds = listWorlds().length;
    const still = () => {
      expect(shownWorld('p4')).toMatchObject({ how: 'carried', world: { id: carried.world!.id } });
      expect(listWorlds().length).toBe(worlds);
      expect(listProjects().find((p) => p.id === 'p4')!.world).toBeUndefined();
    };
    expect(undo(me, { project: 'p4' }).text).toBe('Nothing to undo.');
    still();
    expect(() => changeObject({ by: me, object: 'Nope', hidden: true, project: 'p4' })).toThrow(/no object "Nope"/);
    still();
    expect(changeObject({ by: me, object: 'Garden', project: 'p4' }).text).toMatch(/Nothing to change/);
    still();
    expect(() => build({ by: me, object: 'Wall', project: 'p4', steps: [{ box: 'big' }] })).toThrow();
    still();
    // a change that works does
    setEnvironment({ by: me, fields: { preset: 'night' }, project: 'p4' });
    const own = shownWorld('p4');
    expect(own.how).toBe('own');
    expect(own.world!.id).not.toBe(carried.world!.id);
    expect(getWorld(carried.world!.id)).toBeTruthy();
  });
});

describe('changing and undoing', () => {
  it('world_build takes "units": "map", and says sizes in map units back', () => {
    const r = build({ by: me, object: 'Map-unit hut', units: 'map', steps: [{ use: 'wood' }, { box: [4, 3, 6] }] });
    expect(r.text).toMatch(/4×3×6 map units/);
    expect(() => build({ by: me, object: 'Odd', units: 'feet', steps: [{ use: 'wood' }, { box: [1, 1, 1] }] })).toThrow(/units is "map" or "voxels"/);
    changeObject({ by: me, object: 'Map-unit hut', delete: true });
  });

  it('undo takes a new object away, and puts changed voxels back', () => {
    build({ by: me, object: 'Shed', steps: [{ box: [2, 2, 2], use: 'wood' }] });
    build({ by: me, object: 'Shed', steps: [{ box: [2, 1, 2], use: 'brick' }] });
    const w = shownWorld().world!;
    const shed = w.objects.find((o) => o.name === 'Shed')!;
    expect(undo(me).text).toMatch(/Undid: Mira changed Shed/);
    const back = shownWorld().world!.objects.find((o) => o.id === shed.id)!;
    expect(back.volumes[0].count).toBe(8);
    expect(readObject(w.id, shed.id)).toBeTruthy();
    undo(me);
    expect(shownWorld().world!.objects.find((o) => o.id === shed.id)).toBeUndefined();
  });

  it("won't undo over someone else's later change", () => {
    build({ by: me, object: 'Well', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    build({ by: other, object: 'Well', steps: [{ box: [1, 1, 1], at: [0, 1, 0], use: 'stone' }] });
    expect(() => undo(me)).toThrow(/Kenji changed that after you/);
  });

  it('move, hide, copy and delete, and undo a delete', () => {
    build({ by: me, object: 'Lamp', steps: [{ box: [1, 3, 1], use: 'iron' }, { box: [1, 1, 1], at: [0, 3, 0], use: 'lantern' }] });
    expect(changeObject({ by: me, object: 'lamp', move: [1, 0, 2] }).object!.position).toEqual([1, 0, 2]);
    expect(changeObject({ by: me, object: 'Lamp', duplicate: true, position: [5, 0, 5] }).object!.name).toBe('Lamp copy');
    changeObject({ by: me, object: 'Lamp', delete: true });
    expect(shownWorld().world!.objects.some((o) => o.name === 'Lamp')).toBe(false);
    undo(me);
    expect(shownWorld().world!.objects.some((o) => o.name === 'Lamp')).toBe(true);
    expect(() => changeObject({ by: me, object: 'Nope', hidden: true })).toThrow(/no object "Nope"/);
  });

  it('keeps the last 50 changes, and undo still finds the newest', () => {
    build({ by: me, object: 'Signpost', steps: [{ box: [1, 2, 1], use: 'wood' }] });
    for (let i = 1; i <= 55; i++) changeObject({ by: me, object: 'Signpost', position: [i, 0, 0] });
    const w = shownWorld().world!;
    expect(fs.readdirSync(worldDir(w.id, 'history')).filter((n) => n.endsWith('.json')).length).toBe(50);
    expect(undo(me).text).toMatch(/Undid: Mira changed Signpost \(position\)/);
    expect(shownWorld().world!.objects.find((o) => o.name === 'Signpost')!.position).toEqual([54, 0, 0]);
  });

  it('world_info describes the world, and maps an object from above', () => {
    const text = worldInfo({ map: 'Garden' });
    expect(text).toMatch(/World ".*" \(this project's own\)/);
    expect(text).toMatch(/"Garden" .* by Mira/);
    expect(text).toMatch(/Top view of "Garden"/);
    expect(text).toMatch(/a = grass/);
  });
});

describe('WORLD.md', () => {
  const base = '# W\n\n## Places\n\n### Pond\nOld text.\n\n## Story so far\n- day one\n';

  it('replaces a section, appends to one, and adds missing ones in the right place', () => {
    expect(editSection(base, 'Places › Pond', 'New text.')).toContain('### Pond\n\nNew text.\n\n## Story so far');
    expect(editSection(base, 'Story so far', '- day two', true)).toMatch(/- day one\n- day two\n$/);
    const added = editSection(base, 'Places > Bridge', 'Red and arched.');
    expect(added).toMatch(/Old text\.\n\n### Bridge\n\nRed and arched\.\n\n## Story so far/);
    expect(editSection(base, 'Characters', 'Mira: a gardener.')).toMatch(/## Characters\n\nMira: a gardener\.\n$/);
    // the body repeating its heading is fine
    expect(editSection(base, '## Places › ### Pond', '### Pond\nClear water.')).toContain('### Pond\n\nClear water.');
  });

  it('starts from the template, keeps versions and refuses what is too long', () => {
    const w = shownWorld().world!;
    expect(readWorldMd(w.id)).toBe(worldMdTemplate(w.name));
    writeWorldMd(w.id, '# Garden world\n\n## Theme and meaning\nCalm.');
    writeWorldMdSection(w.id, 'Theme and meaning', 'Growth.');
    expect(readWorldMd(w.id)).toContain('## Theme and meaning\n\nGrowth.');
    expect(fs.readdirSync(worldMdVersionsDir(w.id)).length).toBeGreaterThan(0);
    expect(() => writeWorldMd(w.id, 'x'.repeat(60_000))).toThrow(/up to 50,000/);
    expect(() => writeWorldMd(w.id, '   ')).toThrow(/empty/);
    expect(path.basename(worldMdVersionsDir(w.id))).toBe('world-md');
  });
});

describe('the world travels with its project', () => {
  it('auto-save puts the world in the project folder', async () => {
    const { saveProject } = await import('../../server/projectsync.ts');
    const p = listProjects()[0];
    fs.mkdirSync(p.brainPath, { recursive: true });
    expect(saveProject(p.id)?.error).toBeUndefined();
    const dir = path.join(p.brainPath, '.dashboard', 'world');
    const w = shownWorld(p.id).world!;
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'link.json'), 'utf8'))).toMatchObject({ id: w.id, mode: 'own' });
    expect(fs.readdirSync(path.join(dir, 'objects')).length).toBe(w.objects.length);
    expect(fs.readFileSync(path.join(dir, 'WORLD.md'), 'utf8')).toContain('Growth.');
    expect(fs.existsSync(path.join(dir, 'history'))).toBe(false);
  });

  it('loading the same folder into another project gives it its own world, unless it was shared', async () => {
    const { restoreInto } = await import('../../server/projectsync.ts');
    const p = listProjects()[0];
    const w = shownWorld(p.id).world!;
    addProject('p8');
    expect(restoreInto('p8', p.brainPath)).toBeTruthy();
    const loaded = shownWorld('p8');
    expect(loaded.how).toBe('own');
    expect(loaded.world!.id).not.toBe(w.id);
    expect(loaded.world!.homeProject).toBe('p8');
    expect(loaded.world!.objects.map((o) => o.name).sort()).toEqual(w.objects.map((o) => o.name).sort());
    expect(listProjects().find((x) => x.id === p.id)!.world!.id).toBe(w.id);
    // saved as shared: shared again
    const link = path.join(p.brainPath, '.dashboard', 'world', 'link.json');
    fs.writeFileSync(link, JSON.stringify({ id: w.id, mode: 'shared', name: w.name }));
    addProject('p9');
    restoreInto('p9', p.brainPath);
    expect(shownWorld('p9')).toMatchObject({ how: 'shared', world: { id: w.id } });
  });

  it('a backup brings the world back as a new world of the restored project', async () => {
    const { packProject, encodeBackup, restoreBackup, decodeBackup } = await import('../../server/backup.ts');
    const p = listProjects()[0];
    const before = shownWorld(p.id).world!;
    const packed = packProject(p);
    // world.json and WORLD.md first, so the voxels can't crowd them out of the size limit
    expect(packed.world!.files.slice(0, 2).map((f) => f.path).sort()).toEqual(['WORLD.md', 'world.json']);
    expect(packed.world!.files.every((f) => !f.path.startsWith('history/'))).toBe(true);
    expect(decodeBackup(encodeBackup(packed)).world!.files.length).toBe(packed.world!.files.length);
    const { project } = await restoreBackup(encodeBackup(packed), { name: 'Restored world' });
    const after = shownWorld(project.id);
    expect(after.how).toBe('own');
    expect(after.world!.id).not.toBe(before.id);
    expect(after.world!.homeProject).toBe(project.id);
    expect(after.world!.objects.map((o) => o.name).sort()).toEqual(before.objects.map((o) => o.name).sort());
    expect(readWorldMd(after.world!.id)).toBe(readWorldMd(before.id));
    expect(readObject(after.world!.id, after.world!.objects[0].id)).toEqual(readObject(before.id, after.world!.objects[0].id));
  });
});
