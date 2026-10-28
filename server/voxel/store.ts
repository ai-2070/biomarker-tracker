// Voxel worlds on disk: data/worlds/<world id>/
//   world.json         the world: palette, objects (without their voxels), environment
//   objects/<id>.json  an object's voxels (shared/voxel.ts encoding) and the prefab copies placed in it
//   prefabs/<id>.json  a prefab's voxels (and copies of other prefabs inside it)
//   WORLD.md           what the world is (worldmd.ts), versions/world-md/ its earlier versions
//   history/<id>.json  what each build replaced, for undo (history.ts)
// Worlds aren't inside a project: projects point at one (link.ts), and two projects can share one.
import fs from 'node:fs';
import path from 'node:path';
import { dataPath, ensureDir, isPlainDir, listFiles, readPlain, uid, writeJSON } from '../util.ts';
import { emit } from '../store.ts';
import { envPreset } from '../../shared/worldenv.ts';
import type { VoxelObjectData, VoxelWorld } from '../../shared/types.ts';

export const WORLD_ID = /^[\w-]{1,64}$/;
export const OBJECT_ID = /^[\w-]{1,64}$/;
/** The voxel size a new world starts with: a desk (2.6 wide) is about 10 voxels. */
export const DEFAULT_VOXEL_SIZE = 0.25;

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

export function worldDir(id: string, ...parts: string[]): string {
  if (!WORLD_ID.test(id)) throw bad('Not a world id');
  return dataPath('worlds', id, ...parts);
}

/** A world as stored, with anything missing filled in (an older or hand-edited file). */
function clean(w: Partial<VoxelWorld>, id: string): VoxelWorld {
  const now = Date.now();
  return {
    format: 1,
    id,
    name: typeof w.name === 'string' && w.name.trim() ? w.name.slice(0, 80) : 'World',
    homeProject: typeof w.homeProject === 'string' ? w.homeProject : '',
    built: !!w.built,
    voxelSize: typeof w.voxelSize === 'number' && w.voxelSize > 0 ? w.voxelSize : DEFAULT_VOXEL_SIZE,
    palette: Array.isArray(w.palette) ? w.palette : [],
    objects: Array.isArray(w.objects) ? w.objects : [],
    prefabs: Array.isArray(w.prefabs) ? w.prefabs : [],
    lights: Array.isArray(w.lights) ? w.lights : [],
    effects: Array.isArray(w.effects) ? w.effects : [],
    skins: w.skins && typeof w.skins === 'object' ? { ...w.skins, teams: w.skins.teams || {}, agents: w.skins.agents || {} } : { teams: {}, agents: {} },
    environment: w.environment && typeof w.environment === 'object' ? { ...envPreset(w.environment.preset || 'station'), ...w.environment } : envPreset('station'),
    createdAt: w.createdAt || now,
    updatedAt: w.updatedAt || now,
  };
}

export function getWorld(id: string | null | undefined): VoxelWorld | null {
  if (!id || !WORLD_ID.test(id)) return null;
  const w = readPlain<Partial<VoxelWorld> | null>(worldDir(id, 'world.json'), null);
  return w ? clean(w, id) : null;
}

export function listWorlds(): VoxelWorld[] {
  const root = dataPath('worlds');
  if (!isPlainDir(root)) return [];
  return fs
    .readdirSync(root)
    .filter((n) => WORLD_ID.test(n) && isPlainDir(path.join(root, n)))
    .map((n) => getWorld(n))
    .filter((w): w is VoxelWorld => !!w);
}

// How many times each world was saved since the server started (link.ts: did a change save anything?)
const saves = new Map<string, number>();
export const saveCount = (id: string): number => saves.get(id) || 0;

/** Saves a world's meta (world.json) and tells open pages. */
export function saveWorld(w: VoxelWorld, event: Record<string, unknown> = {}): VoxelWorld {
  saves.set(w.id, saveCount(w.id) + 1);
  w.updatedAt = Date.now();
  w.built = w.built || w.objects.length > 0;
  if (isLink(worldDir(w.id))) throw bad('That world folder is a link; not writing through it.');
  writeJSON(worldDir(w.id, 'world.json'), w);
  emit('world', { world: w.id, ...event });
  return w;
}

export function newWorld(homeProject: string, name = 'World'): VoxelWorld {
  const w = clean({ name, homeProject, built: false }, uid('w'));
  ensureDir(worldDir(w.id));
  return saveWorld(w);
}

export function readObject(worldId: string, objectId: string): VoxelObjectData | null {
  if (!OBJECT_ID.test(objectId)) return null;
  return readPlain<VoxelObjectData | null>(worldDir(worldId, 'objects', `${objectId}.json`), null);
}

export function readPrefab(worldId: string, prefabId: string): VoxelObjectData | null {
  if (!OBJECT_ID.test(prefabId)) return null;
  return readPlain<VoxelObjectData | null>(worldDir(worldId, 'prefabs', `${prefabId}.json`), null);
}

export function writePrefab(worldId: string, prefabId: string, data: VoxelObjectData | null): void {
  writeData(worldId, 'prefabs', prefabId, data);
}

export function writeObject(worldId: string, objectId: string, data: VoxelObjectData | null): void {
  writeData(worldId, 'objects', objectId, data);
}

function writeData(worldId: string, kind: 'objects' | 'prefabs', id: string, data: VoxelObjectData | null): void {
  if (!OBJECT_ID.test(id)) throw bad('Not an id');
  const file = worldDir(worldId, kind, `${id}.json`);
  if (isLink(path.dirname(file)) || isLink(file)) throw bad('That object file is a link; not writing through it.');
  if (data) writeJSON(file, data);
  else fs.rmSync(file, { force: true });
}

/** A new world with everything another one has (its own id; no undo history). */
export function copyWorld(fromId: string, homeProject: string, name?: string): VoxelWorld {
  const from = getWorld(fromId);
  if (!from) throw bad('No such world', 404);
  const to = clean({ ...from, name: name || from.name, homeProject, createdAt: Date.now() }, uid('w'));
  ensureDir(worldDir(to.id));
  for (const n of listFiles(worldDir(fromId, 'objects'), (f) => f.endsWith('.json'))) {
    const data = readObject(fromId, n.slice(0, -5));
    if (data) writeObject(to.id, n.slice(0, -5), data);
  }
  for (const n of listFiles(worldDir(fromId, 'prefabs'), (f) => f.endsWith('.json'))) {
    const data = readPrefab(fromId, n.slice(0, -5));
    if (data) writePrefab(to.id, n.slice(0, -5), data);
  }
  try {
    if (fs.lstatSync(worldDir(fromId, 'WORLD.md')).isFile()) fs.copyFileSync(worldDir(fromId, 'WORLD.md'), worldDir(to.id, 'WORLD.md'));
  } catch {
    /* it has none yet */
  }
  return saveWorld(to);
}

export function deleteWorld(id: string): void {
  const dir = worldDir(id);
  if (isLink(dir)) throw bad('That world folder is a link; not deleting through it.');
  fs.rmSync(dir, { recursive: true, force: true });
  emit('world', { world: id, deleted: true });
}

/** Voxels in a world (from its objects' and prefabs' meta; placed copies don't count again). */
export const worldVoxels = (w: VoxelWorld): number => [...w.objects, ...w.prefabs].reduce((n, o) => n + o.volumes.reduce((m, v) => m + v.count, 0), 0);

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
