// Bringing voxels in and taking them out: MagicaVoxel .vox files in (as a prefab or an object), and an
// object, a prefab or the whole world out as .vox or .glb (glTF), plus pictures of the world. What goes out
// is saved to Artifacts, so it shows on the Outbox page with who made it.
import fs from 'node:fs';
import path from 'node:path';
import { activeProject } from '../store.ts';
import { ensureDir, slugify, uid } from '../util.ts';
import { cleanMaterial, LIMITS, loadGrids, saveGrids } from './ops.ts';
import type { Grid } from './ops.ts';
import { parseVox, voxToGrid, gridToVox } from './vox.ts';
import { toGlb } from './gltf.ts';
import { readObject, readPrefab, saveWorld, writeObject, writePrefab, worldVoxels } from './store.ts';
import { changeWorld, shownWorld } from './link.ts';
import { WORLD_LIMITS, cleanAnchor, findObject, findPrefab, pivotOf, remember, volumesMeta } from './build.ts';
import { stockMaterial } from './materials.ts';
import type { Vec3, VoxelObjectMeta, VoxelPrefabMeta, VoxelWorld, WorldBuilder } from '../../shared/types.ts';

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const fmt = (n: number) => n.toLocaleString('en-US');

// ---------- in ----------
export interface ImportRequest {
  by: WorldBuilder;
  /** the file's real path (checked by the caller against the folders the builder may read) */
  file: string;
  as: 'prefab' | 'object';
  name: string;
  voxelSize?: unknown;
  anchor?: unknown;
  position?: unknown;
  project?: string;
}

export function importVox(req: ImportRequest): string {
  return changeWorld(req.project || activeProject().id, (w) => importVoxIn(w, req));
}

function importVoxIn(w: VoxelWorld, req: ImportRequest): string {
  const name = String(req.name || path.basename(req.file, path.extname(req.file))).trim().slice(0, 80);
  if (!name) throw bad('Name it.');
  if (req.as === 'prefab' ? findPrefab(w, name) : findObject(w, name)) throw bad(`There's already ${req.as === 'prefab' ? 'a prefab' : 'an object'} called "${name}".`);
  const st = fs.statSync(req.file);
  if (!st.isFile() || st.size > 64 * 1024 * 1024) throw bad('That is not a .vox file this can read (up to 64 MB).');
  const size = req.voxelSize === undefined ? (req.as === 'prefab' ? 0.1 : w.voxelSize) : Number(req.voxelSize);
  if (!Number.isFinite(size) || size < 0.05 || size > 4) throw bad('voxel_size is from 0.05 to 4 map units');
  const vox = parseVox(new Uint8Array(fs.readFileSync(req.file)));
  const { grid, materials, count } = voxToGrid(vox, name, size, () => uid('v'));
  // its colours become materials of the world's palette ("<name> 12"), reused when they are there already
  const map = new Map<number, number>();
  materials.forEach((m, i) => {
    let at = w.palette.findIndex((x) => x.name === m.name);
    if (at < 0) {
      if (w.palette.length >= LIMITS.palette) throw bad(`The world's palette can't take ${materials.length} more colours.`);
      w.palette.push(cleanMaterial({ ...m, material: m.name }, stockMaterial(m.name)));
      at = w.palette.length - 1;
    }
    map.set(i + 1, at + 1);
  });
  for (const c of grid.vol.chunks.values()) for (let i = 0; i < c.length; i++) if (c[i]) c[i] = map.get(c[i]) ?? c[i];
  const volumes = volumesMeta([grid]);
  const span = volumes[0]?.min && volumes[0]?.max ? volumes[0].max.map((n, a) => n - volumes[0].min![a] + 1) : [0, 0, 0];
  if (span.some((n) => n > LIMITS.reach * 2)) throw bad(`That model is ${span.join('×')} voxels; the most is ${LIMITS.reach * 2} a side. Bring it in at a bigger voxel size.`);
  // it stands on y = 0, centred on x and z: every voxel must be within the build tools' reach, or it can't be edited
  const R = LIMITS.reach;
  const v0 = volumes[0];
  if (v0?.min && v0.max && (v0.min.some((n) => n < -R) || v0.max.some((n) => n >= R))) throw bad(`That model is ${span.join('×')} voxels and stands on its base, so it reaches past ${R} voxels from its middle (the most the build tools can edit). Bring it in at a bigger voxel size.`);
  if (worldVoxels(w) + count > WORLD_LIMITS.voxels) throw bad(`The world has no room for ${fmt(count)} more voxels.`);
  const now = Date.now();
  if (req.as === 'prefab') {
    if (count > WORLD_LIMITS.prefabVoxels || span.some((n) => n > WORLD_LIMITS.prefabSide)) throw bad(`A prefab is at most ${WORLD_LIMITS.prefabSide} voxels a side and ${fmt(WORLD_LIMITS.prefabVoxels)} voxels; bring this in as an object.`);
    const p: VoxelPrefabMeta = { id: uid('p'), name, description: `from ${path.basename(req.file)}`, tags: ['imported'], by: req.by, volumes, pivot: [0, 0, 0], size: [0, 0, 0], createdAt: now, updatedAt: now, voxelsAt: now };
    Object.assign(p, pivotOf(volumes));
    writePrefab(w.id, p.id, saveGrids([grid]));
    w.prefabs.push(p);
    // (a world with only a prefab is built too: it isn't replaced by another project's world)
    w.built = true;
    remember(w.id, { by: req.by, kind: 'prefab', what: `brought in the prefab ${name} from a .vox file`, objectId: p.id, metaBefore: null });
    saveWorld(w, { prefabs: [p.id], by: req.by.name });
    return `Brought "${path.basename(req.file)}" in as the prefab "${name}": ${fmt(count)} voxels at voxel size ${size}, ${p.size.join('×')} map units, ${materials.length} colours. Place copies with {"place": "${name}"}.`;
  }
  if (w.objects.length >= WORLD_LIMITS.objects) throw bad(`This world has ${WORLD_LIMITS.objects} objects, the most it can hold.`);
  const o: VoxelObjectMeta = { id: uid('o'), name, by: req.by, anchor: cleanAnchor(req.anchor), position: Array.isArray(req.position) && req.position.length === 3 ? (req.position.map(Number) as Vec3) : [0, 0, 0], rotation: 0, scale: 1, volumes, createdAt: now, updatedAt: now, voxelsAt: now };
  writeObject(w.id, o.id, saveGrids([grid]));
  w.objects.push(o);
  w.built = true;
  remember(w.id, { by: req.by, what: `brought in ${name} from a .vox file`, objectId: o.id, metaBefore: null });
  saveWorld(w, { objects: [o.id], by: req.by.name, builder: req.by, added: count });
  return `Brought "${path.basename(req.file)}" in as the object "${name}": ${fmt(count)} voxels at voxel size ${size}, ${materials.length} colours, at ${o.position.join(', ')}.`;
}

// ---------- out ----------
export type ExportFormat = 'glb' | 'vox';

/** Files for an object, a prefab or the whole world (.vox: one per voxel size; the whole world only as .glb). */
export function exportFiles(w: VoxelWorld, what: 'object' | 'prefab' | 'world', ref: string | undefined, format: ExportFormat): { title: string; files: { name: string; bytes: Uint8Array }[]; note: string } {
  if (what === 'world') {
    if (format !== 'glb') throw bad('The whole world goes out as .glb (a .vox file holds one voxel size).');
    return { title: `${w.name} (3D model)`, files: [{ name: `${slugify(w.name) || 'world'}.glb`, bytes: toGlb(w, { kind: 'world' }) }], note: 'Objects pinned to a team or an agent stand where they are from the middle of the map; the Station itself is not in it.' };
  }
  const o = what === 'object' ? findObject(w, ref) : findPrefab(w, ref);
  if (!o) throw bad(`There's no ${what} "${ref || ''}".`, 404);
  const base = slugify(o.name) || what;
  if (format === 'glb') return { title: `${o.name} (3D model)`, files: [{ name: `${base}.glb`, bytes: toGlb(w, { kind: what, id: o.id }) }], note: '' };
  const data = what === 'object' ? readObject(w.id, o.id) : readPrefab(w.id, o.id);
  const grids = loadGrids(data).filter((g) => g.vol.chunks.size);
  if (!grids.length) throw bad(`"${o.name}" has no voxels.`);
  const files = grids.map((g: Grid) => ({ name: grids.length > 1 ? `${base}-${g.voxelSize}.vox` : `${base}.vox`, bytes: gridToVox(g, w.palette) }));
  return { title: `${o.name} (MagicaVoxel)`, files, note: `${grids.length > 1 ? 'One file per voxel size. ' : ''}${data?.instances?.length ? 'Placed copies are not in a .vox file; export as .glb to keep them.' : ''}`.trim() };
}

/** Writes export files into a folder, and gives back the paths. */
export function writeFiles(dir: string, files: { name: string; bytes: Uint8Array }[]): string[] {
  ensureDir(dir);
  return files.map((f) => {
    const p = path.join(dir, f.name);
    fs.writeFileSync(p, f.bytes);
    return p;
  });
}

/** A picture (data: URL) as a file in a folder. */
export function writePicture(dir: string, name: string, image: string): string {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) throw bad('That is not a picture.');
  ensureDir(dir);
  const file = path.join(dir, `${slugify(name) || 'world'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

export { shownWorld };
