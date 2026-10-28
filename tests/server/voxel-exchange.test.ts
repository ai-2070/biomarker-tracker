// .vox in and out, glTF out, and pictures: voxels leaving and entering the world.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gridToVox, parseVox, voxToGrid, voxVoxels } from '../../server/voxel/vox.ts';
import { toGlb } from '../../server/voxel/gltf.ts';
import { exportFiles } from '../../server/voxel/exchange.ts';
import { runBuild } from '../../server/voxel/ops.ts';
import type { Grid } from '../../server/voxel/ops.ts';
import { build } from '../../server/voxel/build.ts';
import { shownWorld } from '../../server/voxel/link.ts';
import { callTool } from '../../server/tools.ts';
import { newAgent } from '../../server/library.ts';
import { artifacts } from '../../server/store.ts';
import { countVoxels, getVoxel, volumeBounds } from '../../shared/voxel.ts';
import type { VoxelMaterial, WorldBuilder } from '../../shared/types.ts';

let n = 0;
const newId = () => `g${++n}`;
function grid(steps: unknown[], palette: VoxelMaterial[] = []) {
  const grids: Grid[] = [];
  runBuild({ grids, palette, voxelSize: 0.1, steps, newId });
  return { g: grids[0], palette };
}

describe('.vox files', () => {
  it('round-trips voxels, colours and up', () => {
    // a column 3 tall with a red top, and a blue voxel to the front (+z)
    const { g, palette } = grid([{ box: [1, 3, 1], use: 'stone' }, { box: [1, 1, 1], at: [0, 3, 0], use: 'red lacquer' }, { box: [1, 1, 1], at: [0, 0, 2], use: 'neon blue' }]);
    const file = parseVox(gridToVox(g, palette));
    expect(file.models.length).toBe(1);
    expect(voxVoxels(file).length).toBe(5);
    const back = voxToGrid(file, 'Tower', 0.1, newId);
    expect(countVoxels(back.grid.vol)).toBe(5);
    expect(back.materials.map((m) => m.color).sort()).toEqual(['#4fc8ff', '#7d7a74', '#b8322a'].sort());
    expect(back.materials.find((m) => m.color === '#4fc8ff')!.kind).toBe('emissive');
    // still upright: the red voxel is the highest, three above the bottom
    let topY = -Infinity;
    let red = -1;
    for (const [k, c] of back.grid.vol.chunks) {
      const [, cy] = k.split(',').map(Number);
      c.forEach((v, i) => {
        if (!v) return;
        const y = cy * 16 + Math.floor(i / 256);
        if (y > topY) (topY = y), (red = v);
      });
    }
    expect(topY).toBe(3);
    expect(back.materials[red - 1].color).toBe('#b8322a');
  });

  it('splits big grids into models placed by the scene graph, and reads them back in place', () => {
    const { g, palette } = grid([{ box: [300, 1, 2], at: [-150, 0, 0], use: 'stone' }]);
    const file = parseVox(gridToVox(g, palette));
    expect(file.models.length).toBe(2);
    const back = voxToGrid(file, 'Wall', 0.1, newId);
    expect(countVoxels(back.grid.vol)).toBe(600);
    // one continuous run along x, 300 long, 1 high, 2 deep (the two models met where they should)
    const b = volumeBounds(back.grid.vol)!;
    expect(b.max.map((m, i) => m - b.min[i] + 1)).toEqual([300, 1, 2]);
    const row = Array.from({ length: 300 }, (_, x) => getVoxel(back.grid.vol, b.min[0] + x, b.min[1], b.min[2]));
    expect(row.every(Boolean)).toBe(true);
  });

  it('takes a big model (hundreds of thousands of voxels) without running out of stack', () => {
    // a solid 80×80×80 block: 512,000 voxels
    const side = 80;
    const xyzi = new Uint8Array(side * side * side * 4);
    let i = 0;
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) for (let z = 0; z < side; z++) xyzi.set([x, y, z, 1], (i++) * 4);
    const f = { models: [{ size: [side, side, side] as [number, number, number], xyzi }], palette: [[200, 100, 50, 255] as [number, number, number, number]], materials: new Map(), nodes: new Map() };
    const r = voxToGrid(f, 'Block', 0.25, newId);
    expect(r.count).toBe(side ** 3);
    expect(countVoxels(r.grid.vol)).toBe(side ** 3);
  });

  it('refuses what is not a .vox file', () => {
    expect(() => parseVox(new TextEncoder().encode('hello there, not a vox file'))).toThrow(/isn't a MagicaVoxel/);
  });
});

describe('glTF', () => {
  const me: WorldBuilder = { kind: 'agent', id: 'mira', name: 'Mira' };
  const glbJson = (bytes: Uint8Array) => {
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    expect(v.getUint32(0, true)).toBe(0x46546c67);
    expect(v.getUint32(8, true)).toBe(bytes.length);
    const len = v.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as { nodes: { name: string; mesh?: number; rotation?: number[]; scale?: number[]; children?: number[] }[]; meshes: unknown[]; materials: { name: string }[]; accessors: { min?: number[]; max?: number[] }[] };
  };

  it('a prefab placed many times is one mesh; copies are nodes, mirrored ones flipped', () => {
    build({ by: me, prefab: 'Post', steps: [{ voxel_size: 0.125 }, { box: [1, 8, 1], use: 'iron' }, { box: [1, 1, 1], at: [0, 8, 0], use: 'lantern' }] });
    build({ by: me, object: 'Street', steps: [{ box: [20, 1, 4], use: 'cobble' }, { place: 'Post', grid: { rows: 1, cols: 10, gap: [2, 2] }, at: [0, 1, 0] }, { place: 'Post', at: [0, 1, 3], turn: 90, mirror: true }] });
    const w = shownWorld().world!;
    const j = glbJson(toGlb(w, { kind: 'object', id: w.objects.find((o) => o.name === 'Street')!.id }));
    // the street's own mesh + one for the post (plain), one for... no swaps: two meshes
    expect(j.meshes.length).toBe(2);
    expect(j.nodes.filter((nd) => nd.name === 'Post').length).toBe(11);
    expect(j.nodes.some((nd) => nd.scale?.[0] === -1)).toBe(true);
    expect(j.materials.map((m) => m.name)).toContain('glowing');
    expect(j.accessors.some((a) => a.min && a.max)).toBe(true);
  });

  it('turns are the same as the page draws them (y, then x, then z)', () => {
    const w = shownWorld().world!;
    const j = glbJson(toGlb(w, { kind: 'object', id: w.objects.find((o) => o.name === 'Street')!.id }));
    const turned = j.nodes.find((nd) => nd.name === 'Post' && nd.rotation && Math.abs(nd.rotation[1]) > 0.1)!;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'YXZ'));
    expect(turned.rotation!.map((x) => Math.round(x * 1000) / 1000)).toEqual([q.x, q.y, q.z, q.w].map((x) => Math.round(x * 1000) / 1000));
  });

  it('exports: whole world only as glb; a .vox per voxel size', () => {
    const w = shownWorld().world!;
    expect(() => exportFiles(w, 'world', undefined, 'vox')).toThrow(/as \.glb/);
    expect(exportFiles(w, 'world', undefined, 'glb').files[0].name).toMatch(/\.glb$/);
    const vox = exportFiles(w, 'object', 'Street', 'vox');
    expect(vox.files.map((f) => f.name)).toEqual(['street.vox']);
    expect(vox.note).toMatch(/Placed copies are not in a \.vox file/);
  });
});

describe('the tools', () => {
  it('world_export saves to Artifacts; world_import brings a .vox back as a prefab', async () => {
    const a = newAgent({ name: 'Exporter', toolGroups: ['world', 'files'], autonomy: 'full' });
    const out = await callTool(a, 'world_export', { what: 'object', name: 'Street', format: 'vox' });
    expect(out.text).toMatch(/Saved .*street\.vox .* added it to Artifacts/);
    const file = out.text.match(/Saved (.*?street\.vox)/)![1];
    expect(fs.existsSync(file)).toBe(true);
    expect(artifacts.list().some((x) => x.title === 'Street (MagicaVoxel)')).toBe(true);
    const r = await callTool(a, 'world_import', { file, name: 'Street copy', voxel_size: 0.25 });
    expect(r.text).toMatch(/Brought "street\.vox" in as the prefab "Street copy": 80 voxels/);
    expect(shownWorld().world!.palette.some((m) => m.name.startsWith('street copy '))).toBe(true);
    expect((await callTool(a, 'world_import', { file: path.join('/', 'etc', 'hosts') })).text).toMatch(/outside the folders/);
  });
});

describe('the prefab library in backups', () => {
  it('goes into every backup, and a restore adds what this computer lacks', async () => {
    const { packProject, encodeBackup, decodeBackup, restoreBackup } = await import('../../server/backup.ts');
    const { publishPrefab, libraryEntries } = await import('../../server/voxel/prefabs.ts');
    const { listProjects } = await import('../../server/store.ts');
    const { dataPath } = await import('../../server/util.ts');
    const me: WorldBuilder = { kind: 'agent', id: 'mira', name: 'Mira' };
    build({ by: me, prefab: 'Lantern post', steps: [{ voxel_size: 0.125 }, { box: [1, 6, 1], use: 'iron' }, { box: [1, 1, 1], at: [0, 6, 0], use: 'lantern' }] });
    publishPrefab({ by: me, prefab: 'Lantern post' });
    const entry = libraryEntries().find((e) => e.name === 'Lantern post')!;
    const packed = packProject(listProjects()[0]);
    expect(packed.prefabLibrary.map((e) => e.name)).toContain('Lantern post');
    const bytes = encodeBackup(packed);
    const back = decodeBackup(bytes);
    expect(back.prefabLibrary.find((e) => e.id === entry.id)!.data.volumes.length).toBe(1);
    // on a computer without it (here: taken out of the library), a restore brings it back
    fs.rmSync(dataPath('prefab-library', `${entry.id}.json`));
    const first = await restoreBackup(bytes, { name: 'Restored with library' });
    expect(first.restored.libraryPrefabs).toEqual({ added: 1, same: 0 });
    expect(libraryEntries().find((e) => e.id === entry.id)!.palette.map((m) => m.name)).toEqual(['iron', 'lantern']);
    // and leaves it alone when it is there
    const again = await restoreBackup(bytes, { name: 'Restored again' });
    expect(again.restored.libraryPrefabs).toEqual({ added: 0, same: 1 });
  }, 30_000);

  it('a damaged library entry in a backup is left out', async () => {
    const { putLibraryEntry } = await import('../../server/voxel/prefabs.ts');
    expect(putLibraryEntry({ id: '../evil', name: 'x', palette: [], data: { volumes: [] } })).toBeNull();
    expect(putLibraryEntry({ id: 'lp-bad', name: 'Bad', palette: [], data: { volumes: [{ id: 'v', voxelSize: 0.1, chunks: { '0,0,0': '!!!' } }] } })).toBeNull();
    expect(putLibraryEntry({ id: 'lp-bad2', name: 'Bad colour', palette: [{ name: 'x', color: 'red', kind: 'solid' }], data: { volumes: [] } })).toBeNull();
  });
});
