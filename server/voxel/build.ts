// Building in a project's world: runs build steps on an object or a prefab, moves, hides or deletes objects, and undoes.
// Every change keeps what it replaced (history/), so a builder can undo its own last change.
import fs from 'node:fs';
import { activeProject } from '../store.ts';
import { listFiles, readPlain, uid, writeJSON } from '../util.ts';
import { decodeChunk, countVoxels, newVolume, volumeBounds } from '../../shared/voxel.ts';
import { BuildError, loadGrids, runBuild, saveGrids, VOXEL_SIZE_MAX, VOXEL_SIZE_MIN } from './ops.ts';
import type { BuildInput, BuildOutcome, Grid } from './ops.ts';
import { readObject, readPrefab, saveWorld, worldDir, writeObject, writePrefab, worldVoxels } from './store.ts';
import { changeWorld } from './link.ts';
import type { AgentSkin, BrainSkin, TeamSkin, PrefabInstance, VoxelMaterial, Vec3, WorldEffect, WorldEnvironment, WorldLight, VoxelObjectData, VoxelObjectMeta, VoxelPrefabMeta, VoxelVolumeMeta, VoxelWorld, WorldAnchor, WorldBuilder } from '../../shared/types.ts';

// drawn: the copies one object or prefab may draw, the copies inside copies counted too
export const WORLD_LIMITS = { voxels: 4_000_000, objects: 300, prefabs: 300, copies: 20_000, drawn: 20_000, prefabSide: 128, prefabVoxels: 200_000, nesting: 4 };
const HISTORY_KEPT = 50;

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

// ---------- finding things ----------
/** An object by id, or by name (any case). */
export function findObject(w: VoxelWorld, ref: unknown): VoxelObjectMeta | null {
  return byRef(w.objects, ref);
}
export function findPrefab(w: VoxelWorld, ref: unknown): VoxelPrefabMeta | null {
  return byRef(w.prefabs, ref);
}
function byRef<T extends { id: string; name: string }>(list: T[], ref: unknown): T | null {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  return list.find((o) => o.id === r) || list.find((o) => o.name.toLowerCase() === r.toLowerCase()) || null;
}

/** Copies placed in the world's objects (a copy of a prefab with copies inside counts once). */
export const placedCopies = (w: VoxelWorld): number => w.objects.reduce((n, o) => n + (o.instances || 0), 0);

export function cleanAnchor(a: unknown): WorldAnchor {
  if (a === undefined || a === null || a === 'world') return { to: 'world' };
  if (a === 'brain') return { to: 'brain' };
  const o = (typeof a === 'string' ? (([to, id]) => ({ to, id }))(a.split(':')) : a) as { to?: unknown; id?: unknown };
  const to = String(o.to || '');
  if (to === 'world' || to === 'brain') return { to };
  if ((to === 'team' || to === 'agent') && typeof o.id === 'string' && /^[\w.-]{1,80}$/.test(o.id)) return { to, id: o.id };
  throw bad('anchor is "world", "brain", "team:<team id>" or "agent:<agent id>"');
}

const vec3 = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => !Number.isFinite(Number(n)))) throw bad(`${what} must be [x, y, z] in map units`);
  return v.map((n) => Math.max(-2000, Math.min(2000, Number(n)))) as Vec3;
};

/** Who a builder is, for the history and the page. */
export const builderKey = (b: WorldBuilder) => `${b.kind}:${b.id || ''}`;

// ---------- history (undo) ----------
export interface HistoryEntry {
  id: string;
  at: number;
  by: WorldBuilder;
  what: string;
  /** an object (the default), a prefab, a light, an effect or the environment */
  kind?: 'object' | 'prefab' | 'light' | 'effect' | 'environment' | 'skin';
  objectId: string;
  /** the object or prefab before (null: it was new) */
  metaBefore: VoxelObjectMeta | VoxelPrefabMeta | null;
  /** the voxels it replaced: every touched chunk (null: there was none) */
  chunks?: BuildOutcome['before'];
  /** the copies placed in it before, when the change placed or took some away */
  instancesBefore?: PrefabInstance[];
  /** the whole thing, when it was deleted */
  dataBefore?: VoxelObjectData | null;
  /** a light, effect or environment as it was (null: the light or effect was new) */
  sceneBefore?: WorldLight | WorldEffect | WorldEnvironment | AgentSkin | TeamSkin | BrainSkin | null;
  /** a prefab this change made from part of the object (world_prefab save with replace): undoing takes it away too */
  prefabMade?: string;
  /** palette entries the change set (the palette is the whole world's): each as it was (null: new) and as it was made */
  materials?: MaterialChange[];
}

export interface MaterialChange {
  /** its place in the palette (voxels hold it plus one) */
  at: number;
  before: VoxelMaterial | null;
  after: VoxelMaterial;
}

/** The palette entries `after` changed or added compared with `before`. */
export function paletteChanges(before: VoxelMaterial[], after: VoxelMaterial[]): MaterialChange[] {
  const out: MaterialChange[] = [];
  after.forEach((m, at) => {
    const was = before[at];
    if (!was || JSON.stringify(was) !== JSON.stringify(m)) out.push({ at, before: was ? structuredClone(was) : null, after: structuredClone(m) });
  });
  return out;
}

/** A history entry without what it replaced (the voxels are read only to undo it). */
export type HistoryHead = Pick<HistoryEntry, 'id' | 'at' | 'by' | 'what' | 'objectId' | 'kind' | 'prefabMade'> & { file: string };

const historyDir = (worldId: string) => worldDir(worldId, 'history');
// Entries can hold megabytes of voxels, so each file is read once and its head kept (until the file changes).
const heads = new Map<string, Map<string, { stamp: string; head: HistoryHead | null }>>();
function history(worldId: string): HistoryHead[] {
  const names = listFiles(historyDir(worldId), (n) => n.endsWith('.json'));
  let known = heads.get(worldId);
  if (!known) heads.set(worldId, (known = new Map()));
  const out: HistoryHead[] = [];
  for (const n of names) {
    const file = worldDir(worldId, 'history', n);
    let stamp = '';
    try {
      const st = fs.statSync(file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      continue;
    }
    let k = known.get(n);
    if (!k || k.stamp !== stamp) {
      const h = readPlain<HistoryEntry | null>(file, null);
      k = { stamp, head: h && typeof h.at === 'number' ? { id: h.id, at: h.at, by: h.by, what: h.what, objectId: h.objectId, kind: h.kind, prefabMade: h.prefabMade, file: n } : null };
      known.set(n, k);
    }
    if (k.head) out.push(k.head);
  }
  const present = new Set(names);
  for (const n of known.keys()) if (!present.has(n)) known.delete(n);
  return out.sort((a, b) => b.at - a.at);
}
export function remember(worldId: string, h: Omit<HistoryEntry, 'id' | 'at'>): void {
  const all = history(worldId);
  // strictly after the last one, even in the same millisecond: undo goes by this order
  const e: HistoryEntry = { id: uid('h'), at: Math.max(Date.now(), (all[0]?.at ?? 0) + 1), ...h };
  writeJSON(worldDir(worldId, 'history', `${e.id}.json`), e);
  // the new one is newest, so it is kept
  for (const old of all.slice(HISTORY_KEPT - 1)) fs.rmSync(worldDir(worldId, 'history', old.file), { force: true });
}

// ---------- building ----------
export interface BuildRequest {
  by: WorldBuilder;
  /** an object's id or name; a new one is made when there's none by that name */
  object?: string;
  /** build into a prefab (by id or name; new when there's none) instead of an object */
  prefab?: string;
  /** a new or changed prefab: what it is, and words to find it by */
  description?: unknown;
  tags?: unknown;
  /** a prefab: the point copies stand on and turn around ("bottom", "top", "center" or [x, y, z]) */
  pivot?: unknown;
  anchor?: unknown;
  /** map units from the anchor (new objects only; move with changeObject) */
  position?: unknown;
  /** the voxel size the steps start with (default: the world's) */
  voxelSize?: unknown;
  steps: unknown;
  /** "map": the steps' positions and sizes are in map units (default: voxels of the current voxel size) */
  units?: unknown;
  /** a script that hands the steps over one by one instead of `steps` (always in map units; script.ts) */
  drive?: BuildInput['drive'];
  seed?: unknown;
  /** the project whose world it is (default: the active one) */
  project?: string;
}

export interface BuildReport {
  world: VoxelWorld;
  /** the object, or the prefab, built in */
  object: VoxelObjectMeta | VoxelPrefabMeta;
  kind: 'object' | 'prefab';
  created: boolean;
  outcome: BuildOutcome;
  text: string;
}

export function volumesMeta(grids: Grid[]): VoxelVolumeMeta[] {
  return grids
    .map((g) => {
      const b = volumeBounds(g.vol);
      return { id: g.id, voxelSize: g.voxelSize, count: countVoxels(g.vol), min: b?.min || null, max: b?.max || null };
    })
    .filter((v) => v.count > 0);
}

/** An object's size in map units, for messages. */
export function objectBox(o: { volumes: VoxelVolumeMeta[] }): { min: Vec3; max: Vec3 } | null {
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  for (const v of o.volumes) {
    if (!v.min || !v.max) continue;
    const lo = v.min.map((n) => n * v.voxelSize) as Vec3;
    const hi = v.max.map((n) => (n + 1) * v.voxelSize) as Vec3;
    min = min ? (min.map((n, i) => Math.min(n, lo[i])) as Vec3) : lo;
    max = max ? (max.map((n, i) => Math.max(n, hi[i])) as Vec3) : hi;
  }
  return min && max ? { min, max } : null;
}
// two decimals: at the fine voxel sizes (0.1, 0.125) one would round 0.25 up to 0.3
const r1 = (n: number) => Math.round(n * 100) / 100;
export const boxText = (o: { volumes: VoxelVolumeMeta[] }, box?: { min: Vec3; max: Vec3 } | null): string => {
  const b = box === undefined ? objectBox(o) : box;
  if (!b) return 'empty';
  const s = b.max.map((n, i) => r1(n - b.min[i]));
  return `${s[0]}×${s[1]}×${s[2]} map units (x ${r1(b.min[0])}..${r1(b.max[0])}, y ${r1(b.min[1])}..${r1(b.max[1])}, z ${r1(b.min[2])}..${r1(b.max[2])} from its position)`;
};

/**
 * A prefab's box in map units from its voxels' origin, with the copies of other prefabs inside it (a
 * character made only of parts has no voxels of its own). A copy stands as the page draws it:
 * T(p) · Ry(turn) · Rx(tilt) · Rz(roll) · S(scale, mirrored in x) · T(-pivot) (web/voxel/instances.ts).
 */
export function prefabBox(w: VoxelWorld, id: string, depth = 0, memo = new Map<string, { min: Vec3; max: Vec3 } | null>()): { min: Vec3; max: Vec3 } | null {
  // each prefab's box is worked out once per depth: copies of copies would otherwise multiply the work
  const key = `${id}@${depth}`;
  if (memo.has(key)) return memo.get(key)!;
  const p = w.prefabs.find((x) => x.id === id);
  if (!p) return null;
  let box = objectBox(p);
  if (!p.instances || depth >= WORLD_LIMITS.nesting) return box;
  const DEG = Math.PI / 180;
  for (const i of readPrefab(w.id, id)?.instances || []) {
    const child = w.prefabs.find((x) => x.id === i.prefab);
    const cb = child ? prefabBox(w, child.id, depth + 1, memo) : null;
    if (!child || !cb) continue;
    const s = i.scale ?? 1;
    const [ct, st] = [Math.cos((i.turn || 0) * DEG), Math.sin((i.turn || 0) * DEG)];
    const [cx, sx] = [Math.cos((i.tilt || 0) * DEG), Math.sin((i.tilt || 0) * DEG)];
    const [cz, sz] = [Math.cos((i.roll || 0) * DEG), Math.sin((i.roll || 0) * DEG)];
    for (const x0 of [cb.min[0], cb.max[0]])
      for (const y0 of [cb.min[1], cb.max[1]])
        for (const z0 of [cb.min[2], cb.max[2]]) {
          let [x, y, z] = [(x0 - child.pivot[0]) * s * (i.mirror ? -1 : 1), (y0 - child.pivot[1]) * s, (z0 - child.pivot[2]) * s];
          [x, y] = [cz * x - sz * y, sz * x + cz * y];
          [y, z] = [cx * y - sx * z, sx * y + cx * z];
          [x, z] = [ct * x + st * z, -st * x + ct * z];
          const v: Vec3 = [x + i.p[0], y + i.p[1], z + i.p[2]];
          box = box ? { min: box.min.map((n, a) => Math.min(n, v[a])) as Vec3, max: box.max.map((n, a) => Math.max(n, v[a])) as Vec3 } : { min: [...v] as Vec3, max: [...v] as Vec3 };
        }
  }
  memo.set(key, box);
  return box;
}

/** A prefab's size in map units, copies inside it included (for messages). */
export function prefabSize(w: VoxelWorld, p: VoxelPrefabMeta): string {
  const b = prefabBox(w, p.id);
  return b ? b.max.map((n, a) => r1(n - b.min[a])).join('×') : '0×0×0';
}

/**
 * Does prefab `id` hold `target` (directly or deeper)? And how deep do copies nest inside `id` (its longest
 * chain)? A prefab reached by two paths counts on both: only one on the current path (a loop) stops there.
 */
export function nesting(w: VoxelWorld, id: string, target: string | null, memo = new Map<string, { holds: boolean; depth: number }>(), path = new Set<string>()): { holds: boolean; depth: number } {
  const known = memo.get(id);
  if (known) return known;
  if (path.has(id)) return { holds: false, depth: 0 };
  path.add(id);
  let holds = false;
  let depth = 0;
  for (const child of new Set((readPrefab(w.id, id)?.instances || []).map((i) => i.prefab))) {
    if (child === target) holds = true;
    const n = nesting(w, child, target, memo, path);
    holds ||= n.holds;
    depth = Math.max(depth, n.depth + 1);
  }
  path.delete(id);
  const out = { holds, depth };
  memo.set(id, out);
  return out;
}

/**
 * How many copies these copies draw, counting the copies inside them all the way down (the page and a .glb
 * draw every one). `override` stands in for a prefab's copies before they are saved.
 */
export function drawnCopies(w: VoxelWorld, list: PrefabInstance[], override?: { id: string; instances: PrefabInstance[] }, memo = new Map<string, number>()): number {
  const inside = (id: string, path: Set<string>): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (path.has(id) || path.size > WORLD_LIMITS.nesting) return 0;
    path.add(id);
    let n = 0;
    const kids = override?.id === id ? override.instances : readPrefab(w.id, id)?.instances || [];
    // (counted per prefab, then multiplied: a big number never takes long to reach)
    const per = new Map<string, number>();
    for (const i of kids) per.set(i.prefab, (per.get(i.prefab) || 0) + 1);
    for (const [child, times] of per) n += times * (1 + inside(child, path));
    path.delete(id);
    memo.set(id, n);
    return n;
  };
  let total = 0;
  for (const i of list) total += 1 + inside(i.prefab, new Set());
  return total;
}

const count = (v: VoxelVolumeMeta[]) => v.reduce((n, x) => n + x.count, 0);
const fmt = (n: number) => n.toLocaleString('en-US');

/** A prefab's pivot (bottom centre unless chosen: top centre, the middle, or a point) and size, map units. */
export function pivotOf(volumes: VoxelVolumeMeta[], at: VoxelPrefabMeta['pivotAt'] = 'bottom'): { pivot: Vec3; size: Vec3 } {
  const b = objectBox({ volumes });
  if (!b) return { pivot: Array.isArray(at) ? at : [0, 0, 0], size: [0, 0, 0] };
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const y = at === 'top' ? b.max[1] : at === 'center' ? (b.min[1] + b.max[1]) / 2 : b.min[1];
  const pivot: Vec3 = Array.isArray(at) ? (at.map(r) as Vec3) : [r((b.min[0] + b.max[0]) / 2), r(y), r((b.min[2] + b.max[2]) / 2)];
  return { pivot, size: [r(b.max[0] - b.min[0]), r(b.max[1] - b.min[1]), r(b.max[2] - b.min[2])] };
}

/** "bottom", "top", "center" or [x, y, z] (map units from the prefab's voxels' origin). */
export function cleanPivot(v: unknown): VoxelPrefabMeta['pivotAt'] {
  if (v === 'bottom' || v === 'top' || v === 'center') return v;
  if (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n)))) return v.map(Number) as Vec3;
  throw bad('pivot is "bottom", "top", "center" or [x, y, z] in map units from the prefab\'s origin');
}

export function build(req: BuildRequest): BuildReport {
  return changeWorld(req.project || activeProject().id, (w) => buildIn(w, req));
}

function buildIn(w: VoxelWorld, req: BuildRequest): BuildReport {
  const kind = req.prefab !== undefined && req.prefab !== null && String(req.prefab).trim() ? 'prefab' : 'object';
  const name = String((kind === 'prefab' ? req.prefab : req.object) ?? '').trim().slice(0, 80);
  if (!name) throw bad('Name the object to build (a new name makes a new one), or a prefab with "prefab".');
  const now = Date.now();
  let target: VoxelObjectMeta | VoxelPrefabMeta | null = kind === 'prefab' ? findPrefab(w, name) : findObject(w, name);
  const created = !target;
  if (!target && kind === 'prefab') {
    if (w.prefabs.length >= WORLD_LIMITS.prefabs) throw bad(`This world has ${WORLD_LIMITS.prefabs} prefabs, the most it can hold.`);
    target = { id: uid('p'), name, description: '', tags: [], by: req.by, volumes: [], pivot: [0, 0, 0], size: [0, 0, 0], createdAt: now, updatedAt: now };
  } else if (!target) {
    if (w.objects.length >= WORLD_LIMITS.objects) throw bad(`This world has ${WORLD_LIMITS.objects} objects, the most it can hold. Add to an existing one, or delete one first.`);
    target = { id: uid('o'), name, by: req.by, anchor: cleanAnchor(req.anchor), position: req.position === undefined ? [0, 0, 0] : vec3(req.position, 'position'), rotation: 0, scale: 1, volumes: [], createdAt: now, updatedAt: now };
  }
  const t = target;
  // everything that can be refused is checked before anything is written
  const pivotAt = kind === 'prefab' && req.pivot !== undefined ? cleanPivot(req.pivot) : undefined;
  const voxelSize = req.voxelSize === undefined ? w.voxelSize : Number(req.voxelSize);
  if (!Number.isFinite(voxelSize) || voxelSize < VOXEL_SIZE_MIN || voxelSize > VOXEL_SIZE_MAX) throw bad(`voxel_size is from ${VOXEL_SIZE_MIN} to ${VOXEL_SIZE_MAX} map units`);
  const data = kind === 'prefab' ? readPrefab(w.id, t.id) : readObject(w.id, t.id);
  const grids = loadGrids(data);
  const palette = [...w.palette];
  if (req.units !== undefined && req.units !== 'map' && req.units !== 'voxels') throw bad('units is "map" or "voxels"');
  const outcome = runBuild({
    units: req.drive || req.units === 'map' ? 'map' : 'voxels',
    drive: req.drive,
    grids,
    palette,
    voxelSize,
    steps: req.steps as unknown[],
    seed: req.seed === undefined ? undefined : Number(req.seed) || 1,
    newId: () => uid('v'),
    instances: data?.instances || [],
    prefabs: w.prefabs.map((p) => ({ id: p.id, name: p.name, pivot: p.pivot })),
    loadPrefab: (id) => {
      const d = readPrefab(w.id, id);
      return d ? { grids: loadGrids(d), instances: d.instances || [] } : null;
    },
    cantPlace: (id) => {
      if (kind !== 'prefab') return null;
      const n = nesting(w, id, t.id);
      if (id === t.id || n.holds) return `a prefab can't be placed inside itself ("${t.name}")`;
      if (n.depth + 1 >= WORLD_LIMITS.nesting) return `prefabs nest at most ${WORLD_LIMITS.nesting} deep`;
      return null;
    },
  });

  const volumes = volumesMeta(outcome.grids);
  const total = worldVoxels(w) - count(t.volumes) + count(volumes);
  if (total > WORLD_LIMITS.voxels) throw new BuildError(`This would make the world ${fmt(total)} voxels; it can hold ${fmt(WORLD_LIMITS.voxels)}. Use a bigger voxel size, place copies of a prefab instead of building the same thing again, or remove something first.`);
  if (kind === 'prefab') {
    const box = objectBox({ volumes });
    if (count(volumes) > WORLD_LIMITS.prefabVoxels) throw new BuildError(`a prefab can hold ${fmt(WORLD_LIMITS.prefabVoxels)} voxels; this would be ${fmt(count(volumes))}. Make it smaller, or build it as an object.`);
    if (box && volumes.some((v) => v.min && v.max && v.max.some((n, a) => n - v.min![a] + 1 > WORLD_LIMITS.prefabSide))) throw new BuildError(`a prefab is at most ${WORLD_LIMITS.prefabSide} voxels on a side; build big things as objects`);
  } else {
    const copies = placedCopies(w) - ((t as VoxelObjectMeta).instances || 0) + outcome.instances.length;
    if (copies > WORLD_LIMITS.copies) throw new BuildError(`This would make ${fmt(copies)} placed copies in the world; it can hold ${fmt(WORLD_LIMITS.copies)}.`);
  }
  if (outcome.placed > 0) drawnCheck(w, kind, t, outcome.instances);

  const metaBefore = created ? null : structuredClone(t);
  const instancesChanged = outcome.placed > 0 || outcome.unplaced > 0;
  const saved: VoxelObjectData = { ...saveGrids(outcome.grids), ...(outcome.instances.length ? { instances: outcome.instances } : {}) };
  if (kind === 'prefab') writePrefab(w.id, t.id, saved);
  else writeObject(w.id, t.id, saved);
  t.volumes = volumes;
  t.instances = outcome.instances.length || undefined;
  t.updatedAt = t.voxelsAt = Date.now();
  t.lastBy = req.by;
  if (kind === 'prefab') {
    const p = t as VoxelPrefabMeta;
    if (pivotAt !== undefined) p.pivotAt = pivotAt;
    Object.assign(p, pivotOf(volumes, p.pivotAt));
    if (created) w.prefabs.push(p);
    // (copies placed inside count too: a character made of parts has no voxels of its own)
    const full = prefabBox(w, p.id);
    if (full) p.size = full.max.map((n, a) => Math.round((n - full.min[a]) * 1000) / 1000) as Vec3;
    if (req.description !== undefined) p.description = String(req.description).slice(0, 300);
    if (Array.isArray(req.tags)) p.tags = [...new Set(req.tags.map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  } else if (created) w.objects.push(t as VoxelObjectMeta);
  const materials = paletteChanges(w.palette, palette);
  w.palette = palette;
  w.built = true;
  remember(w.id, { by: req.by, kind, what: `${created ? 'built' : 'changed'} ${kind === 'prefab' ? 'the prefab ' : ''}${t.name}`, objectId: t.id, metaBefore, chunks: outcome.before, ...(instancesChanged ? { instancesBefore: data?.instances || [] } : {}), ...(materials.length ? { materials } : {}) });
  // (builder and the counts: the page plays the build where it happened, with a beam from the builder's desk)
  saveWorld(w, { [kind === 'prefab' ? 'prefabs' : 'objects']: [t.id], by: req.by.name, builder: req.by, added: outcome.added, placed: outcome.placed });

  const sizes = volumes.map((v) => `${v.voxelSize}: ${fmt(v.count)}`).join(', ');
  const pv = (t as VoxelPrefabMeta).pivotAt;
  const stands = !pv || pv === 'bottom' ? 'Its bottom centre stands' : pv === 'top' ? 'It hangs from its top centre' : pv === 'center' ? 'Its middle is' : `Its pivot (${pv.join(', ')}) is`;
  const where = kind === 'prefab' ? `${stands} where it is placed, and turns around it; it is ${prefabSize(w, t as VoxelPrefabMeta)} map units${outcome.instances.length ? ' with the copies inside it' : ''}. Place copies with {"place": "${t.name}"}, or bake it into an object with {"stamp": "${t.name}"}.` : `at ${(t as VoxelObjectMeta).position.join(', ')} from ${anchorText((t as VoxelObjectMeta).anchor)}`;
  const text = [
    `${created ? 'Built' : 'Changed'} ${kind === 'prefab' ? 'the prefab' : ''} "${t.name}" in the world "${w.name}": ${fmt(outcome.added)} voxels added, ${fmt(outcome.removed)} removed, ${fmt(outcome.painted)} repainted${instancesChanged ? `; ${fmt(outcome.placed)} ${outcome.placed === 1 ? 'copy' : 'copies'} placed, ${fmt(outcome.unplaced)} taken away` : ''}.`.replace('Built  "', 'Built "').replace('Changed  "', 'Changed "'),
    `It now has ${fmt(count(volumes))} voxels (by voxel size: ${sizes || 'none'})${outcome.instances.length ? ` and ${fmt(outcome.instances.length)} placed ${outcome.instances.length === 1 ? 'copy' : 'copies'}` : ''}, ${kind === 'prefab' && !count(volumes) && outcome.instances.length ? 'all of it in those copies' : boxText({ volumes })}. ${where}`,
    outcome.newMaterials.length ? `Added to the palette: ${outcome.newMaterials.join(', ')}.` : '',
    ...outcome.notes,
    `The world has ${fmt(total)} of ${fmt(WORLD_LIMITS.voxels)} voxels${kind === 'object' ? ` and ${fmt(placedCopies(w))} of ${fmt(WORLD_LIMITS.copies)} placed copies` : ''}.`,
  ]
    .filter(Boolean)
    .join('\n');
  return { world: w, object: t, kind, created, outcome, text };
}

/** Refuses copies that would draw too many copies (copies inside copies counted), here or in a prefab that holds this one. */
function drawnCheck(w: VoxelWorld, kind: 'object' | 'prefab', t: { id: string; name: string }, instances: PrefabInstance[]): void {
  const tooMany = (n: number, where: string) => new BuildError(`This would make ${where} draw ${fmt(n)} copies, counting the copies inside copies; the most is ${fmt(WORLD_LIMITS.drawn)}. Place fewer, or stamp parts into a prefab's voxels instead of placing them.`);
  if (kind === 'object') {
    const n = drawnCopies(w, instances);
    if (n > WORLD_LIMITS.drawn) throw tooMany(n, `"${t.name}"`);
    return;
  }
  // a prefab that grows makes everything that holds it grow too
  const override = { id: t.id, instances };
  const memo = new Map<string, number>();
  for (const p of [{ id: t.id, name: t.name }, ...w.prefabs.filter((p) => p.id !== t.id && p.instances)]) {
    const n = drawnCopies(w, [{ prefab: p.id, p: [0, 0, 0] }], override, memo) - 1;
    if (n > WORLD_LIMITS.drawn) throw tooMany(n, `the prefab "${p.name}"`);
  }
  // (only objects with a copy of it, directly or inside another prefab, can have grown)
  const holdsMemo = new Map<string, { holds: boolean; depth: number }>();
  const holders = new Set([t.id, ...w.prefabs.filter((p) => p.instances && nesting(w, p.id, t.id, holdsMemo).holds).map((p) => p.id)]);
  for (const o of w.objects) {
    if (!o.instances) continue;
    const list = readObject(w.id, o.id)?.instances || [];
    if (!list.some((i) => holders.has(i.prefab))) continue;
    const n = drawnCopies(w, list, override, memo);
    if (n > WORLD_LIMITS.drawn) throw tooMany(n, `"${o.name}"`);
  }
}

export const anchorText = (a: WorldAnchor): string => (a.to === 'world' ? 'the middle of the map' : a.to === 'brain' ? 'the Brain' : `${a.to} ${a.id}`);

// ---------- changing an object ----------
export interface ObjectChange {
  by: WorldBuilder;
  object: string;
  project?: string;
  name?: unknown;
  position?: unknown;
  /** add to the position (map units) */
  move?: unknown;
  rotation?: unknown;
  scale?: unknown;
  anchor?: unknown;
  hidden?: unknown;
  duplicate?: unknown;
  delete?: unknown;
}

export function changeObject(c: ObjectChange): { world: VoxelWorld; object: VoxelObjectMeta | null; text: string } {
  return changeWorld(c.project || activeProject().id, (w) => changeObjectIn(w, c));
}

function changeObjectIn(w: VoxelWorld, c: ObjectChange): { world: VoxelWorld; object: VoxelObjectMeta | null; text: string } {
  const meta = findObject(w, c.object);
  if (!meta) throw bad(`There's no object "${c.object}" in this world. world_info lists them.`, 404);
  const before = structuredClone(meta);
  if (c.delete === true) {
    const data = readObject(w.id, meta.id);
    w.objects = w.objects.filter((o) => o.id !== meta.id);
    writeObject(w.id, meta.id, null);
    remember(w.id, { by: c.by, what: `deleted ${meta.name}`, objectId: meta.id, metaBefore: before, dataBefore: data });
    saveWorld(w, { objects: [meta.id], deleted: true, by: c.by.name });
    return { world: w, object: null, text: `Deleted "${meta.name}". It can be brought back with world_undo.` };
  }
  if (c.duplicate === true) {
    if (w.objects.length >= WORLD_LIMITS.objects) throw bad(`This world has ${WORLD_LIMITS.objects} objects, the most it can hold.`);
    const count = meta.volumes.reduce((n, v) => n + v.count, 0);
    if (worldVoxels(w) + count > WORLD_LIMITS.voxels) throw bad(`A copy would make the world bigger than ${WORLD_LIMITS.voxels.toLocaleString('en-US')} voxels.`);
    // the copy keeps every prefab copy placed in it
    const copies = placedCopies(w) + (meta.instances || 0);
    if (copies > WORLD_LIMITS.copies) throw bad(`A copy would make ${fmt(copies)} placed copies in the world; it can hold ${fmt(WORLD_LIMITS.copies)}.`);
    const now = Date.now();
    const copy: VoxelObjectMeta = { ...structuredClone(meta), id: uid('o'), name: uniqueName(w, String(c.name || `${meta.name} copy`)), by: c.by, lastBy: c.by, createdAt: now, updatedAt: now };
    if (c.position !== undefined) copy.position = vec3(c.position, 'position');
    if (c.move !== undefined) copy.position = copy.position.map((n, i) => n + vec3(c.move, 'move')[i]) as Vec3;
    if (c.anchor !== undefined) copy.anchor = cleanAnchor(c.anchor);
    writeObject(w.id, copy.id, readObject(w.id, meta.id));
    w.objects.push(copy);
    remember(w.id, { by: c.by, what: `copied ${meta.name}`, objectId: copy.id, metaBefore: null, chunks: [] });
    saveWorld(w, { objects: [copy.id], by: c.by.name });
    return { world: w, object: copy, text: `Copied "${meta.name}" as "${copy.name}" at ${copy.position.join(', ')} from ${anchorText(copy.anchor)}.` };
  }
  const changed: string[] = [];
  if (c.name !== undefined) {
    const n = String(c.name).trim().slice(0, 80);
    if (!n) throw bad('name is empty');
    if (n.toLowerCase() !== meta.name.toLowerCase() && findObject(w, n)) throw bad(`There's already an object called "${n}".`);
    meta.name = n;
    changed.push('name');
  }
  if (c.anchor !== undefined) (meta.anchor = cleanAnchor(c.anchor)), changed.push('anchor');
  if (c.position !== undefined) (meta.position = vec3(c.position, 'position')), changed.push('position');
  if (c.move !== undefined) (meta.position = meta.position.map((n, i) => n + vec3(c.move, 'move')[i]) as Vec3), changed.push('position');
  if (c.rotation !== undefined) {
    const r = Number(c.rotation);
    if (!Number.isFinite(r)) throw bad('rotation is in degrees');
    meta.rotation = ((r % 360) + 360) % 360;
    changed.push('rotation');
  }
  if (c.scale !== undefined) {
    const s = Number(c.scale);
    if (!Number.isFinite(s) || s < 0.1 || s > 10) throw bad('scale is from 0.1 to 10');
    meta.scale = s;
    changed.push('scale');
  }
  if (c.hidden !== undefined) (meta.hidden = c.hidden === true), changed.push(meta.hidden ? 'hidden' : 'shown');
  if (!changed.length) return { world: w, object: meta, text: 'Nothing to change: give name, position, move, rotation, scale, anchor, hidden, duplicate or delete.' };
  meta.updatedAt = Date.now();
  meta.lastBy = c.by;
  remember(w.id, { by: c.by, what: `changed ${meta.name} (${changed.join(', ')})`, objectId: meta.id, metaBefore: before });
  saveWorld(w, { objects: [meta.id], moved: true, by: c.by.name });
  return { world: w, object: meta, text: `Changed "${meta.name}": ${changed.join(', ')}. It is at ${meta.position.join(', ')} from ${anchorText(meta.anchor)}, turned ${meta.rotation}°, scale ${meta.scale}.` };
}

function uniqueName(w: VoxelWorld, want: string): string {
  let n = want.slice(0, 76);
  for (let i = 2; findObject(w, n); i++) n = `${want.slice(0, 72)} ${i}`;
  return n;
}

// ---------- undo ----------
/** Undoes the last change `by` made (or anyone's, when `anyone`). Refuses when someone else changed that thing since. */
export function undo(by: WorldBuilder, { project, anyone = false }: { project?: string; anyone?: boolean } = {}): { world: VoxelWorld; text: string } {
  return changeWorld(project || activeProject().id, (w) => undoIn(w, by, anyone));
}

function undoIn(w: VoxelWorld, by: WorldBuilder, anyone: boolean): { world: VoxelWorld; text: string } {
  const all = history(w.id);
  const head = all.find((h) => anyone || builderKey(h.by) === builderKey(by));
  if (!head) return { world: w, text: 'Nothing to undo.' };
  const touched = (h: HistoryHead) => h.objectId === head.objectId || (!!head.prefabMade && h.objectId === head.prefabMade);
  const later = all.filter((h) => h.at > head.at && touched(h) && builderKey(h.by) !== builderKey(head.by));
  if (later.length) throw bad(`${later[0].by.name} changed that after you (${later[0].what}). Ask them, or change it again yourself.`, 409);
  const mine = readPlain<HistoryEntry | null>(worldDir(w.id, 'history', head.file), null);
  if (!mine) throw bad('That change can no longer be undone.', 409);
  // everything that can refuse is checked first: a refused undo changes nothing and stays to be undone later
  const isThing = mine.kind === undefined || mine.kind === 'object' || mine.kind === 'prefab';
  if (isThing && mine.metaBefore) {
    // names stay one per object (and per prefab): giving one back that another has now would make two
    const others: { id: string; name: string }[] = mine.kind === 'prefab' ? w.prefabs : w.objects;
    const name = mine.metaBefore.name.toLowerCase();
    const taken = others.find((o) => o.id !== mine.objectId && o.name.toLowerCase() === name);
    if (taken) throw bad(`Undoing it would give back the name "${mine.metaBefore.name}", and another ${mine.kind === 'prefab' ? 'prefab' : 'object'} is called that now. Rename that one first.`, 409);
  }
  // the palette is the whole world's: a material changed again since is left alone, so the undo waits
  const mats = mine.materials || [];
  for (const m of mats) if (m.before && JSON.stringify(w.palette[m.at]) !== JSON.stringify(m.after)) throw bad(`The material "${m.after.name}" was changed again after that. Change it back yourself with {"material": "${m.after.name}", …}.`, 409);
  // a prefab the change made goes away with it, unless it is in use now
  const made = mine.prefabMade || (mine.kind === 'prefab' && !mine.metaBefore ? mine.objectId : '');
  if (made) {
    const holds = (d: VoxelObjectData | null) => !!d?.instances?.some((i) => i.prefab === made);
    const elsewhere = [
      ...w.objects.filter((o) => o.id !== (mine.prefabMade ? mine.objectId : '') && o.instances && holds(readObject(w.id, o.id))).map((o) => `"${o.name}"`),
      ...w.prefabs.filter((p) => p.id !== made && p.instances && holds(readPrefab(w.id, p.id))).map((p) => `the prefab "${p.name}"`),
    ];
    if (elsewhere.length) throw bad(`The prefab it made is placed in ${elsewhere.join(', ')} now. Take those copies away first.`, 409);
    const sk = w.skins;
    if (sk.brain?.shell === made || Object.values(sk.teams).some((t) => t.platform === made || t.hub === made) || Object.values(sk.agents).some((a) => a.character === made || a.desk === made)) throw bad('The prefab it made is worn now (world_skin). Give that skin another prefab first.', 409);
  }
  if (mats.length) {
    for (const m of mats) if (m.before) w.palette[m.at] = m.before;
    // new materials go too, when they are the last ones and nothing was changed since (so nothing else uses them)
    if (all[0] === head) for (const m of [...mats].sort((a, b) => b.at - a.at)) if (!m.before && m.at === w.palette.length - 1) w.palette.pop();
  }
  if (mine.prefabMade) {
    w.prefabs = w.prefabs.filter((p) => p.id !== mine.prefabMade);
    writePrefab(w.id, mine.prefabMade, null);
  }
  if (mine.kind === 'skin') {
    // "agent:<id>", "team:<id>" or "brain:brain"
    const [to, id] = mine.objectId.split(':');
    const before = mine.sceneBefore as AgentSkin | null;
    if (to === 'brain') {
      if (before) w.skins.brain = before as BrainSkin;
      else delete w.skins.brain;
    } else {
      const list = (to === 'agent' ? w.skins.agents : w.skins.teams) as Record<string, AgentSkin | TeamSkin>;
      if (before) list[id] = before;
      else delete list[id];
    }
    fs.rmSync(worldDir(w.id, 'history', head.file), { force: true });
    saveWorld(w, { skins: true, undone: true, by: by.name });
    return { world: w, text: `Undid: ${mine.by.name} ${mine.what}.` };
  }
  if (mine.kind === 'light' || mine.kind === 'effect' || mine.kind === 'environment') {
    if (mine.kind === 'environment') w.environment = (mine.sceneBefore as WorldEnvironment) || w.environment;
    else {
      const list: { id: string }[] = mine.kind === 'light' ? w.lights : w.effects;
      const i = list.findIndex((x) => x.id === mine.objectId);
      if (i >= 0) list.splice(i, 1);
      if (mine.sceneBefore) list.push(mine.sceneBefore as WorldLight & WorldEffect);
    }
    fs.rmSync(worldDir(w.id, 'history', head.file), { force: true });
    saveWorld(w, { [mine.kind === 'environment' ? 'environment' : `${mine.kind}s`]: true, undone: true, by: by.name });
    return { world: w, text: `Undid: ${mine.by.name} ${mine.what}.` };
  }
  const isPrefab = mine.kind === 'prefab';
  const list: { id: string }[] = isPrefab ? w.prefabs : w.objects;
  const read = (id: string) => (isPrefab ? readPrefab(w.id, id) : readObject(w.id, id));
  const write = (id: string, d: VoxelObjectData | null) => (isPrefab ? writePrefab(w.id, id, d) : writeObject(w.id, id, d));
  const idx = list.findIndex((o) => o.id === mine.objectId);
  const putBack = (m: VoxelObjectMeta | VoxelPrefabMeta) => {
    if (isPrefab) {
      const i = w.prefabs.findIndex((o) => o.id === m.id);
      if (i >= 0) w.prefabs[i] = m as VoxelPrefabMeta;
      else w.prefabs.push(m as VoxelPrefabMeta);
    } else {
      const i = w.objects.findIndex((o) => o.id === m.id);
      if (i >= 0) w.objects[i] = m as VoxelObjectMeta;
      else w.objects.push(m as VoxelObjectMeta);
    }
  };
  if (!mine.metaBefore) {
    // it was new: take it away
    if (idx >= 0) list.splice(idx, 1);
    write(mine.objectId, null);
  } else if (mine.dataBefore !== undefined) {
    // it was deleted: bring it back
    write(mine.objectId, mine.dataBefore);
    mine.metaBefore.voxelsAt = Date.now();
    putBack(mine.metaBefore);
  } else {
    if (mine.chunks?.length || mine.instancesBefore) {
      const data = read(mine.objectId);
      const grids = loadGrids(data);
      for (const b of mine.chunks || []) {
        let g = grids.find((x) => x.id === b.gridId);
        // a grid the change emptied isn't saved (saveGrids leaves empty ones out): it comes back here
        if (!g) grids.push((g = { id: b.gridId, voxelSize: b.voxelSize, vol: newVolume(b.voxelSize) }));
        for (const [k, c] of Object.entries(b.chunks)) c ? g.vol.chunks.set(k, decodeChunk(c)) : g.vol.chunks.delete(k);
      }
      const instances = mine.instancesBefore ?? data?.instances ?? [];
      write(mine.objectId, { ...saveGrids(grids), ...(instances.length ? { instances } : {}) });
      mine.metaBefore.volumes = volumesMeta(grids);
      mine.metaBefore.instances = instances.length || undefined;
      mine.metaBefore.voxelsAt = Date.now();
    }
    putBack(mine.metaBefore);
  }
  fs.rmSync(worldDir(w.id, 'history', head.file), { force: true });
  saveWorld(w, { [isPrefab ? 'prefabs' : 'objects']: [mine.objectId], undone: true, by: by.name });
  return { world: w, text: `Undid: ${mine.by.name} ${mine.what}.` };
}

/** Recent changes, newest first (for world_info and the page). */
export function recentChanges(worldId: string, n = 8): { at: number; by: string; what: string }[] {
  return history(worldId)
    .slice(0, n)
    .map((h) => ({ at: h.at, by: h.by.name, what: h.what }));
}

/** Who may change an object without asking: whoever built it, the Brain, and you. */
export function ownsObject(by: WorldBuilder, o: { by: WorldBuilder }): boolean {
  return by.kind !== 'agent' || (o.by.kind === 'agent' && o.by.id === by.id);
}

