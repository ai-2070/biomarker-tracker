// Placed prefab copies, worked out before drawing: each copy's matrix, copies inside copies (nested
// prefabs, up to 4 levels, never looping), and the prefab variants they need (mirrored, materials
// swapped). Pure (three.js math only), so it can be tested without WebGL.
import * as THREE from 'three';
import { CHUNK, CHUNK_CELLS, cellIndex, chunkKey, decodeChunk, encodeChunk, parseChunkKey } from '../../shared/voxel.ts';
import type { PrefabInstance, Vec3, VoxelMaterial, VoxelObjectData } from '../../shared/types.ts';

/** How deep copies may sit inside copies (a copy placed in an object is level 1). */
export const MAX_NESTING = 4;

const DEG = Math.PI / 180;
const quarter = (n: number | undefined) => ((((Math.round((n || 0) / 90) * 90) % 360) + 360) % 360) * DEG;
const _t = new THREE.Matrix4();

/** A copy's matrix: T(p) · Ry(turn) · Rx(tilt) · Rz(roll) · S(scale) · T(-pivot). */
export function instanceMatrix(i: Pick<PrefabInstance, 'p' | 'turn' | 'tilt' | 'roll' | 'scale'>, pivot: Vec3, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.makeTranslation(i.p[0], i.p[1], i.p[2]);
  if (i.turn) out.multiply(_t.makeRotationY(i.turn * DEG));
  if (i.tilt) out.multiply(_t.makeRotationX(quarter(i.tilt)));
  if (i.roll) out.multiply(_t.makeRotationZ(quarter(i.roll)));
  const s = i.scale && Number.isFinite(i.scale) && i.scale > 0 ? i.scale : 1;
  if (s !== 1) out.multiply(_t.makeScale(s, s, s));
  return out.multiply(_t.makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
}

/** The variant of a prefab a copy needs: mirrored, and its swaps (sorted, so equal swaps share one mesh). */
export interface Variant {
  mirror: boolean;
  swap: [string, string][];
}
export const variantKey = (v: Variant): string => `${v.mirror ? 'm' : ''}|${v.swap.map(([a, b]) => `${a}>${b}`).join(',')}`;

/** The prefab data a copy needs (null: not loaded or gone; it and what's inside it are left out). */
export type PrefabLookup = (id: string) => { data: VoxelObjectData | null; pivot: Vec3 } | null;

/** One copy to draw: which prefab, which variant, and its matrix in the object's space. */
export interface FlatCopy {
  prefab: string;
  variant: Variant;
  key: string;
  matrix: THREE.Matrix4;
}

const norm = (s: string) => s.trim().toLowerCase();

/** A parent's swaps applied after the child's own: the child's "shirt" → "red", then the parent's "red" → "blue". */
export function composeSwaps(child: Record<string, string> | undefined, parent: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(child || {})) out.set(norm(k), parent.get(norm(v)) ?? norm(v));
  for (const [k, v] of parent) if (!out.has(k)) out.set(k, v);
  return out;
}

/**
 * Every copy in `instances`, and every copy inside those prefabs, as one flat list in the object's space.
 * A mirrored copy's inner copies are mirrored with it (their spot, turn and roll flip across x).
 * A prefab that holds itself (directly or further down) stops there.
 */
export function expandInstances(instances: PrefabInstance[] | undefined, lookup: PrefabLookup, maxDepth = MAX_NESTING): FlatCopy[] {
  const out: FlatCopy[] = [];
  const walk = (list: PrefabInstance[] | undefined, parent: THREE.Matrix4 | null, mirrored: boolean, swaps: Map<string, string>, depth: number, path: Set<string>) => {
    if (!list || depth > maxDepth) return;
    for (const raw of list) {
      if (!raw || typeof raw.prefab !== 'string' || !Array.isArray(raw.p) || path.has(raw.prefab)) continue;
      const pf = lookup(raw.prefab);
      if (!pf) continue;
      // inside a mirrored parent: this copy is mirrored too, and sits where the mirror puts it
      const mirror = !!raw.mirror !== mirrored;
      const i: PrefabInstance = mirrored ? { ...raw, p: [-raw.p[0], raw.p[1], raw.p[2]], turn: -(raw.turn || 0), roll: -(raw.roll || 0) } : raw;
      const pivot: Vec3 = mirror ? [-pf.pivot[0], pf.pivot[1], pf.pivot[2]] : pf.pivot;
      const m = instanceMatrix(i, pivot);
      if (parent) m.premultiply(parent);
      const swap = composeSwaps(raw.swap, swaps);
      const variant: Variant = { mirror, swap: [...swap].sort((a, b) => (a[0] < b[0] ? -1 : 1)) };
      out.push({ prefab: raw.prefab, variant, key: variantKey(variant), matrix: m });
      if (pf.data?.instances?.length) walk(pf.data.instances, m, mirror, swap, depth + 1, new Set([...path, raw.prefab]));
    }
  };
  walk(instances, null, false, new Map(), 1, new Set());
  return out;
}

/** Every prefab id reachable from these copies (to load before expanding), to the same depth. */
export function reachablePrefabs(instances: PrefabInstance[] | undefined, dataOf: (id: string) => VoxelObjectData | null | undefined, maxDepth = MAX_NESTING): Set<string> {
  const seen = new Set<string>();
  let level = (instances || []).map((i) => i?.prefab).filter((x): x is string => typeof x === 'string');
  for (let d = 1; d <= maxDepth && level.length; d++) {
    const next: string[] = [];
    for (const id of level) {
      if (seen.has(id)) continue;
      seen.add(id);
      for (const i of dataOf(id)?.instances || []) if (typeof i?.prefab === 'string') next.push(i.prefab);
    }
    level = next;
  }
  return seen;
}

/** The palette with swapped materials: where the prefab uses "shirt", it draws "cloth red". Unknown names are ignored. */
export function swapPalette(palette: VoxelMaterial[], swap: [string, string][]): VoxelMaterial[] {
  if (!swap.length) return palette;
  const out = palette.slice();
  for (const [from, to] of swap) {
    const i = palette.findIndex((m) => norm(m.name) === from);
    const target = palette.find((m) => norm(m.name) === to);
    if (i >= 0 && target) out[i] = { ...target };
  }
  return out;
}

/** The voxels mirrored across x (x → -1 - x, which is x → -x in map units at any voxel size). */
export function mirrorData(data: VoxelObjectData): VoxelObjectData {
  return {
    volumes: (data.volumes || []).map((v) => {
      const chunks: Record<string, string> = {};
      for (const [k, text] of Object.entries(v.chunks || {})) {
        const [cx, cy, cz] = parseChunkKey(k);
        const src = decodeChunk(text);
        const dst = new Uint8Array(CHUNK_CELLS);
        for (let y = 0; y < CHUNK; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) dst[cellIndex(CHUNK - 1 - x, y, z)] = src[cellIndex(x, y, z)];
        chunks[chunkKey(-1 - cx, cy, cz)] = encodeChunk(dst);
      }
      return { id: v.id, voxelSize: v.voxelSize, chunks };
    }),
  };
}
