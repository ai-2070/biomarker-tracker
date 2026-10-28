// Prefabs the builders make: save part of an object as one, rename or describe it, delete it, and share it
// through the prefab library (data/prefab-library/, every world and project) or take one from there.
// Building a prefab's voxels and placing copies are build steps (build.ts, ops.ts).
import fs from 'node:fs';
import { activeProject } from '../store.ts';
import { dataPath, listFiles, readPlain, uid, writeJSON } from '../util.ts';
import { CHUNK, chunkKey, cellIndex } from '../../shared/voxel.ts';
import { loadGrids, saveGrids, cleanMaterial } from './ops.ts';
import type { Grid } from './ops.ts';
import { stockMaterial } from './materials.ts';
import { newVolume } from '../../shared/voxel.ts';
import { readObject, readPrefab, saveWorld, writeObject, writePrefab, worldVoxels } from './store.ts';
import { changeWorld, shownWorld } from './link.ts';
import { ANIM_LIMITS, cleanClip, skinUses } from './characters.ts';
import { WORLD_LIMITS, cleanPivot, findObject, findPrefab, nesting, pivotOf as pivotFrom, placedCopies, prefabSize, remember, volumesMeta } from './build.ts';
import type { AnimationClip, PrefabInstance, Vec3, VoxelMaterial, VoxelObjectData, VoxelPrefabMeta, VoxelWorld, WorldBuilder } from '../../shared/types.ts';

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const fmt = (n: number) => n.toLocaleString('en-US');
const count = (p: { volumes: { count: number }[] }) => p.volumes.reduce((n, v) => n + v.count, 0);
const copiesText = (n: number) => `${fmt(n)} ${n === 1 ? 'copy' : 'copies'}`;

function pivotOf(p: VoxelPrefabMeta): void {
  Object.assign(p, pivotFrom(p.volumes, p.pivotAt));
}

function uniqueName(w: VoxelWorld, want: string): string {
  let n = want.slice(0, 76);
  for (let i = 2; findPrefab(w, n); i++) n = `${want.slice(0, 72)} ${i}`;
  return n;
}

/** Where each prefab is used: objects and prefabs with copies of it. */
export function prefabUses(w: VoxelWorld): Map<string, { in: string[]; copies: number }> {
  const out = new Map<string, { in: string[]; copies: number }>();
  const note = (list: PrefabInstance[] | undefined, where: string) => {
    for (const i of list || []) {
      const u = out.get(i.prefab) || { in: [], copies: 0 };
      u.copies++;
      if (!u.in.includes(where)) u.in.push(where);
      out.set(i.prefab, u);
    }
  };
  for (const o of w.objects) if (o.instances) note(readObject(w.id, o.id)?.instances, `"${o.name}"`);
  for (const p of w.prefabs) if (p.instances) note(readPrefab(w.id, p.id)?.instances, `the prefab "${p.name}"`);
  return out;
}

export function prefabList(w: VoxelWorld): string {
  if (!w.prefabs.length) return 'No prefabs yet. Build one with world_build and "prefab": "<name>", or save part of an object with world_prefab (action "save").';
  const uses = prefabUses(w);
  return w.prefabs
    .map((p) => {
      const u = uses.get(p.id);
      const parts = (readPrefab(w.id, p.id)?.instances || []).map((i) => i.name).filter(Boolean);
      const clips = Object.keys(p.animations || {});
      const worn = skinUses(w, p.id);
      return `- "${p.name}" (id ${p.id}) by ${p.by.name}: ${p.description || 'no description'}${p.tags.length ? ` [${p.tags.join(', ')}]` : ''} | ${prefabSize(w, p)} map units, ${fmt(count(p))} voxels at voxel size ${[...new Set(p.volumes.map((v) => v.voxelSize))].join(' and ') || '-'}, pivot ${p.pivotAt && !Array.isArray(p.pivotAt) ? p.pivotAt : p.pivotAt ? p.pivotAt.join(', ') : 'bottom'}${p.instances ? `, ${copiesText(p.instances)} of other prefabs inside` : ''}${parts.length ? `, parts: ${parts.join(', ')}` : ''}${clips.length ? `, animations: ${clips.join(', ')}` : ''} | ${[u ? `${copiesText(u.copies)} in ${u.in.join(', ')}` : '', worn.length ? `worn as ${worn.join(', ')}` : ''].filter(Boolean).join('; ') || 'not placed yet'}`;
    })
    .join('\n');
}

// ---------- making one from an object ----------
export interface SaveFrom {
  by: WorldBuilder;
  name: string;
  /** the object to take it from */
  from: string;
  /** a box in map units from the object's origin ([min, max]); the whole object when left out */
  box?: unknown;
  description?: unknown;
  tags?: unknown;
  /** take that part out of the object and put a copy of the new prefab in its place */
  replace?: boolean;
  project?: string;
}

export function savePrefabFrom(req: SaveFrom): { prefab: VoxelPrefabMeta; text: string } {
  return changeWorld(req.project || activeProject().id, (w) => savePrefabFromIn(w, req));
}

function savePrefabFromIn(w: VoxelWorld, req: SaveFrom): { prefab: VoxelPrefabMeta; text: string } {
  const o = findObject(w, req.from);
  if (!o) throw bad(`There's no object "${req.from}". world_info lists them.`, 404);
  const name = String(req.name ?? '').trim().slice(0, 80);
  if (!name) throw bad('Name the new prefab.');
  if (findPrefab(w, name)) throw bad(`There's already a prefab called "${name}".`);
  if (w.prefabs.length >= WORLD_LIMITS.prefabs) throw bad(`This world has ${WORLD_LIMITS.prefabs} prefabs, the most it can hold.`);
  let lo: Vec3 = [-Infinity, -Infinity, -Infinity];
  let hi: Vec3 = [Infinity, Infinity, Infinity];
  if (req.box !== undefined) {
    const b = req.box as { min?: unknown; max?: unknown } | unknown[];
    const pair = Array.isArray(b) ? b : [b?.min, b?.max];
    const ok = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n)));
    if (!ok(pair[0]) || !ok(pair[1])) throw bad('box is {"min": [x, y, z], "max": [x, y, z]} in map units from the object\'s origin');
    lo = pair[0].map((n, i) => Math.min(Number(n), Number((pair[1] as Vec3)[i]))) as Vec3;
    hi = pair[0].map((n, i) => Math.max(Number(n), Number((pair[1] as Vec3)[i]))) as Vec3;
  }
  const data = readObject(w.id, o.id);
  const grids = loadGrids(data);
  const taken: Grid[] = [];
  // voxels whose middle is inside the box
  for (const g of grids) {
    const out: Grid = { id: g.id, voxelSize: g.voxelSize, vol: newVolume(g.voxelSize) };
    for (const [k, c] of g.vol.chunks) {
      const [cx, cy, cz] = k.split(',').map(Number);
      for (let i = 0; i < c.length; i++) {
        if (!c[i]) continue;
        const x = cx * CHUNK + (i % CHUNK);
        const y = cy * CHUNK + Math.floor(i / (CHUNK * CHUNK));
        const z = cz * CHUNK + (Math.floor(i / CHUNK) % CHUNK);
        const m = [(x + 0.5) * g.voxelSize, (y + 0.5) * g.voxelSize, (z + 0.5) * g.voxelSize];
        if (m.some((n, a) => n < lo[a] || n > hi[a])) continue;
        const key = chunkKey(cx, cy, cz);
        let oc = out.vol.chunks.get(key);
        if (!oc) out.vol.chunks.set(key, (oc = new Uint8Array(c.length)));
        oc[cellIndex(x - cx * CHUNK, y - cy * CHUNK, z - cz * CHUNK)] = c[i];
        if (req.replace) c[i] = 0;
      }
    }
    if (out.vol.chunks.size) taken.push(out);
  }
  const inBox = (i: PrefabInstance) => i.p.every((n, a) => n >= lo[a] && n <= hi[a]);
  const instances = (data?.instances || []).filter(inBox);
  const meta: VoxelPrefabMeta = { id: uid('p'), name, description: String(req.description ?? '').slice(0, 300), tags: Array.isArray(req.tags) ? req.tags.map((t) => String(t).toLowerCase()).slice(0, 12) : [], by: req.by, volumes: volumesMeta(taken), instances: instances.length || undefined, pivot: [0, 0, 0], size: [0, 0, 0], createdAt: Date.now(), updatedAt: Date.now(), voxelsAt: Date.now() };
  if (!count(meta) && !instances.length) throw bad('Nothing of that object is inside the box.');
  if (count(meta) > WORLD_LIMITS.prefabVoxels) throw bad(`a prefab can hold ${fmt(WORLD_LIMITS.prefabVoxels)} voxels; that part has ${fmt(count(meta))}.`);
  // kept in the object too, the part's voxels count twice
  if (!req.replace && worldVoxels(w) + count(meta) > WORLD_LIMITS.voxels) throw bad(`The world has no room for ${fmt(count(meta))} more voxels (it holds ${fmt(WORLD_LIMITS.voxels)}). Use "replace" to turn that part into a copy instead.`);
  // the copies it takes in nest one level deeper inside it, as deep as placing them in a prefab may go
  const memo = new Map<string, { holds: boolean; depth: number }>();
  const deepest = Math.max(-1, ...[...new Set(instances.map((i) => i.prefab))].map((id) => nesting(w, id, null, memo).depth));
  if (deepest + 1 >= WORLD_LIMITS.nesting) throw bad(`The copies in that part already nest ${deepest + 1} deep; prefabs nest at most ${WORLD_LIMITS.nesting} deep, so they can't go inside a new prefab. Stamp some of them into voxels first.`);
  pivotOf(meta);
  writePrefab(w.id, meta.id, { ...saveGrids(taken), ...(instances.length ? { instances } : {}) });
  w.prefabs.push(meta);
  let note = '';
  if (req.replace) {
    // the part becomes a copy of the new prefab, standing where it stood
    const left = (data?.instances || []).filter((i) => !inBox(i));
    left.push({ prefab: meta.id, p: meta.pivot });
    const before = structuredClone(o);
    writeObject(w.id, o.id, { ...saveGrids(grids), instances: left });
    o.volumes = volumesMeta(grids);
    o.instances = left.length;
    o.updatedAt = o.voxelsAt = Date.now();
    o.lastBy = req.by;
    // one change: undoing it puts the part back and takes the new prefab away
    remember(w.id, { by: req.by, what: `turned part of ${o.name} into the prefab ${name}`, objectId: o.id, metaBefore: before, dataBefore: data, prefabMade: meta.id });
    note = ` That part of "${o.name}" is now a copy of it.`;
  } else remember(w.id, { by: req.by, kind: 'prefab', what: `made the prefab ${name}`, objectId: meta.id, metaBefore: null });
  saveWorld(w, { prefabs: [meta.id], objects: req.replace ? [o.id] : [], by: req.by.name });
  return { prefab: meta, text: `Made the prefab "${name}" from "${o.name}": ${fmt(count(meta))} voxels${instances.length ? ` and ${instances.length} copies of other prefabs` : ''}, ${prefabSize(w, meta)} map units.${note} Place copies with {"place": "${name}"}.` };
}

// ---------- changing one ----------
export function changePrefab(req: { by: WorldBuilder; prefab: string; name?: unknown; description?: unknown; tags?: unknown; pivot?: unknown; project?: string }): { prefab: VoxelPrefabMeta; text: string } {
  return changeWorld(req.project || activeProject().id, (w) => changePrefabIn(w, req));
}

function changePrefabIn(w: VoxelWorld, req: { by: WorldBuilder; prefab: string; name?: unknown; description?: unknown; tags?: unknown; pivot?: unknown; project?: string }): { prefab: VoxelPrefabMeta; text: string } {
  const p = findPrefab(w, req.prefab);
  if (!p) throw bad(`There's no prefab "${req.prefab}".`, 404);
  const before = structuredClone(p);
  const changed: string[] = [];
  if (req.name !== undefined) {
    const n = String(req.name).trim().slice(0, 80);
    if (!n) throw bad('name is empty');
    if (n.toLowerCase() !== p.name.toLowerCase() && findPrefab(w, n)) throw bad(`There's already a prefab called "${n}".`);
    p.name = n;
    changed.push('name');
  }
  if (req.description !== undefined) (p.description = String(req.description).slice(0, 300)), changed.push('description');
  if (Array.isArray(req.tags)) (p.tags = req.tags.map((t) => String(t).toLowerCase()).slice(0, 12)), changed.push('tags');
  if (req.pivot !== undefined) {
    p.pivotAt = cleanPivot(req.pivot);
    pivotOf(p);
    p.voxelsAt = Date.now();
    changed.push(`pivot (now ${p.pivot.join(', ')}; copies already placed now stand and turn on it)`);
  }
  if (!changed.length) return { prefab: p, text: 'Nothing to change: give name, description, tags or pivot.' };
  p.updatedAt = Date.now();
  p.lastBy = req.by;
  remember(w.id, { by: req.by, kind: 'prefab', what: `changed the prefab ${p.name} (${changed.join(', ')})`, objectId: p.id, metaBefore: before });
  saveWorld(w, { prefabs: [p.id], by: req.by.name });
  return { prefab: p, text: `Changed the prefab "${p.name}": ${changed.join(', ')}.` };
}

export function deletePrefab(req: { by: WorldBuilder; prefab: string; project?: string }): string {
  return changeWorld(req.project || activeProject().id, (w) => deletePrefabIn(w, req));
}

function deletePrefabIn(w: VoxelWorld, req: { by: WorldBuilder; prefab: string; project?: string }): string {
  const p = findPrefab(w, req.prefab);
  if (!p) throw bad(`There's no prefab "${req.prefab}".`, 404);
  const used = prefabUses(w).get(p.id);
  if (used) throw bad(`"${p.name}" is placed ${used.copies} times (in ${used.in.join(', ')}). Take those copies away first ({"unplace": "${p.name}"}), then delete it.`, 409);
  const skins = skinUses(w, p.id);
  if (skins.length) throw bad(`"${p.name}" is ${skins.join(', ')}. Give ${skins.length > 1 ? 'those' : 'it'} another prefab (or the classic look) with world_skin first, then delete it.`, 409);
  const data = readPrefab(w.id, p.id);
  w.prefabs = w.prefabs.filter((x) => x.id !== p.id);
  writePrefab(w.id, p.id, null);
  remember(w.id, { by: req.by, kind: 'prefab', what: `deleted the prefab ${p.name}`, objectId: p.id, metaBefore: p, dataBefore: data });
  saveWorld(w, { prefabs: [p.id], deleted: true, by: req.by.name });
  return `Deleted the prefab "${p.name}". It can be brought back with world_undo.`;
}

// ---------- the prefab library ----------
/** A prefab shared to every world: its voxels use its own small palette. */
export interface LibraryPrefab {
  id: string;
  name: string;
  description: string;
  tags: string[];
  by: string;
  fromWorld: string;
  size: Vec3;
  voxels: number;
  palette: VoxelMaterial[];
  data: VoxelObjectData;
  /** the point copies stand on and turn around, as its builder chose it (missing: bottom centre) */
  pivotAt?: VoxelPrefabMeta['pivotAt'];
  animations?: Record<string, AnimationClip>;
  createdAt: number;
}

/** A library entry's pivot and animations, checked (anything damaged is left out). */
function libraryLook(e: Partial<LibraryPrefab>): Pick<LibraryPrefab, 'pivotAt' | 'animations'> {
  const out: Pick<LibraryPrefab, 'pivotAt' | 'animations'> = {};
  if (e.pivotAt !== undefined)
    try {
      out.pivotAt = cleanPivot(e.pivotAt);
    } catch {
      /* the default pivot */
    }
  if (e.animations && typeof e.animations === 'object' && !Array.isArray(e.animations)) {
    const clips: Record<string, AnimationClip> = {};
    for (const [name, clip] of Object.entries(e.animations).slice(0, ANIM_LIMITS.clips))
      try {
        if (clip && typeof clip === 'object') clips[name.slice(0, 40)] = cleanClip(clip as unknown as Record<string, unknown>);
      } catch {
        /* left out */
      }
    if (Object.keys(clips).length) out.animations = clips;
  }
  return out;
}
const LIB_ID = /^[\w-]{1,64}$/;
const libDir = () => dataPath('prefab-library');
const libFile = (id: string) => dataPath('prefab-library', `${id}.json`);
function library(): LibraryPrefab[] {
  return listFiles(libDir(), (n) => n.endsWith('.json') && LIB_ID.test(n.slice(0, -5)))
    .map((n) => readPlain<LibraryPrefab | null>(dataPath('prefab-library', n), null))
    .filter((x): x is LibraryPrefab => !!x && typeof x.name === 'string' && !!x.data);
}

/** Every prefab in the library, voxels and all (for backups). */
export const libraryEntries = (): LibraryPrefab[] => library();

/** A library prefab from a backup, checked: added when the library doesn't have it (by id), else left as it is. */
export function putLibraryEntry(raw: unknown): 'added' | 'same' | null {
  const e = raw as Partial<LibraryPrefab> | null;
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !LIB_ID.test(e.id) || typeof e.name !== 'string' || !e.name.trim()) return null;
  if (!Array.isArray(e.palette) || e.palette.length > 255 || !e.data || !Array.isArray(e.data.volumes)) return null;
  try {
    loadGrids(e.data);
  } catch {
    // damaged voxels: left out
    return null;
  }
  if (library().some((x) => x.id === e.id)) return 'same';
  const palette = e.palette.flatMap((m) => {
    try {
      return [cleanMaterial({ ...m, material: m.name })];
    } catch {
      return [];
    }
  });
  if (palette.length !== e.palette.length) return null;
  const entry: LibraryPrefab = {
    id: e.id,
    name: e.name.trim().slice(0, 80),
    description: String(e.description ?? '').slice(0, 300),
    tags: Array.isArray(e.tags) ? e.tags.map(String).slice(0, 12) : [],
    by: String(e.by ?? '').slice(0, 80),
    fromWorld: String(e.fromWorld ?? '').slice(0, 80),
    size: Array.isArray(e.size) && e.size.length === 3 ? (e.size.map(Number) as Vec3) : [0, 0, 0],
    voxels: Number(e.voxels) || 0,
    palette,
    data: { volumes: e.data.volumes },
    ...libraryLook(e),
    createdAt: Number(e.createdAt) || Date.now(),
  };
  writeJSON(libFile(entry.id), entry);
  return 'added';
}

/** The library's prefabs without their voxels (for the page). */
export function libraryItems(query = ''): Omit<LibraryPrefab, 'data' | 'palette'>[] {
  const q = query.trim().toLowerCase();
  return library()
    .filter((p) => !q || `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase().includes(q))
    .map(({ data: _d, palette: _p, ...rest }) => rest);
}

export function libraryList(query = ''): string {
  const q = query.trim().toLowerCase();
  const all = library().filter((p) => !q || `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase().includes(q));
  if (!all.length) return q ? `Nothing in the prefab library matches "${query}".` : 'The prefab library is empty. Publish a prefab you made (action "publish") to share it with every world.';
  return all.map((p) => `- "${p.name}" by ${p.by} (from "${p.fromWorld}"): ${p.description || 'no description'}${p.tags.length ? ` [${p.tags.join(', ')}]` : ''} | ${p.size.join('×')} map units, ${fmt(p.voxels)} voxels`).join('\n');
}

/** Values in a prefab's voxels, through a map (palette value → palette value). */
function remap(data: VoxelObjectData, map: Map<number, number>): VoxelObjectData {
  const grids = loadGrids(data);
  for (const g of grids) for (const c of g.vol.chunks.values()) for (let i = 0; i < c.length; i++) if (c[i]) c[i] = map.get(c[i]) ?? c[i];
  return saveGrids(grids);
}

export function publishPrefab(req: { by: WorldBuilder; prefab: string; project?: string }): string {
  // publishing changes only the library, so a carried-over world isn't copied for it
  const w = shownWorld(req.project || activeProject().id).world;
  if (!w) throw bad('There is no world yet.', 404);
  const p = findPrefab(w, req.prefab);
  if (!p) throw bad(`There's no prefab "${req.prefab}".`, 404);
  const data = readPrefab(w.id, p.id);
  if (!data) throw bad(`"${p.name}" has no voxels yet.`);
  if (data.instances?.length) throw bad(`"${p.name}" holds copies of other prefabs. Publish those first, or stamp them into it ({"stamp": …}) so it stands alone.`);
  // its own palette: only the materials it uses, in a new order
  const used = new Set<number>();
  for (const g of loadGrids(data)) for (const c of g.vol.chunks.values()) for (const v of c) if (v) used.add(v);
  const order = [...used].sort((a, b) => a - b);
  const palette = order.map((v) => w.palette[v - 1] || { name: `material ${v}`, color: '#8a8a8a', kind: 'solid' as const });
  const map = new Map(order.map((v, i) => [v, i + 1]));
  // the same name again replaces that entry
  const existing = library().find((x) => x.name.toLowerCase() === p.name.toLowerCase());
  const entry: LibraryPrefab = { id: existing?.id || uid('lp'), name: p.name, description: p.description, tags: p.tags, by: req.by.name, fromWorld: w.name, size: p.size, voxels: count(p), palette, data: remap(data, map), ...(p.pivotAt !== undefined ? { pivotAt: p.pivotAt } : {}), ...(p.animations && Object.keys(p.animations).length ? { animations: structuredClone(p.animations) } : {}), createdAt: Date.now() };
  writeJSON(libFile(entry.id), entry);
  return `${existing ? 'Updated' : 'Published'} "${p.name}" in the prefab library: every world can take it now (world_prefab action "import").`;
}

export function importPrefab(req: { by: WorldBuilder; name: string; as?: unknown; project?: string }): { prefab: VoxelPrefabMeta; text: string } {
  return changeWorld(req.project || activeProject().id, (w) => importPrefabIn(w, req));
}

function importPrefabIn(w: VoxelWorld, req: { by: WorldBuilder; name: string; as?: unknown; project?: string }): { prefab: VoxelPrefabMeta; text: string } {
  const lib = library().find((x) => x.name.toLowerCase() === String(req.name ?? '').trim().toLowerCase() || x.id === req.name);
  if (!lib) throw bad(`There's no "${req.name}" in the prefab library. Action "library" lists what is there.`, 404);
  if (w.prefabs.length >= WORLD_LIMITS.prefabs) throw bad(`This world has ${WORLD_LIMITS.prefabs} prefabs, the most it can hold.`);
  if (worldVoxels(w) + lib.voxels > WORLD_LIMITS.voxels) throw bad(`This world has no room for ${fmt(lib.voxels)} more voxels.`);
  // its materials by name: the world's own when it has one by that name (so it fits the world's look), else added
  const map = new Map<number, number>();
  const added: string[] = [];
  lib.palette.forEach((m, i) => {
    const name = String(m.name).toLowerCase();
    let at = w.palette.findIndex((x) => x.name === name);
    if (at < 0) {
      if (w.palette.length >= 255) throw bad("This world's palette is full.");
      w.palette.push(cleanMaterial({ ...m, material: name }, stockMaterial(name)));
      added.push(name);
      at = w.palette.length - 1;
    }
    map.set(i + 1, at + 1);
  });
  const data = remap(lib.data, map);
  const name = uniqueName(w, String(req.as ?? '').trim() || lib.name);
  const meta: VoxelPrefabMeta = { id: uid('p'), name, description: lib.description, tags: lib.tags, by: req.by, volumes: volumesMeta(loadGrids(data)), pivot: [0, 0, 0], size: [0, 0, 0], ...libraryLook(lib), createdAt: Date.now(), updatedAt: Date.now(), voxelsAt: Date.now() };
  pivotOf(meta);
  writePrefab(w.id, meta.id, data);
  w.prefabs.push(meta);
  w.built = true;
  remember(w.id, { by: req.by, kind: 'prefab', what: `took the prefab ${name} from the library`, objectId: meta.id, metaBefore: null });
  saveWorld(w, { prefabs: [meta.id], by: req.by.name });
  return { prefab: meta, text: `Took "${lib.name}" from the prefab library as "${name}"${added.length ? `; added to the palette: ${added.join(', ')}` : ''}. Place copies with {"place": "${name}"}.` };
}

export function removeFromLibrary(name: string): string {
  const lib = library().find((x) => x.name.toLowerCase() === name.trim().toLowerCase() || x.id === name);
  if (!lib) throw bad(`There's no "${name}" in the prefab library.`, 404);
  fs.rmSync(libFile(lib.id), { force: true });
  return `Took "${lib.name}" out of the prefab library (worlds that took it keep their copy).`;
}

export { placedCopies };
