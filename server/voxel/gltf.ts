// An object, a prefab or a whole world as a glTF 2.0 model (.glb): meshed like the page meshes it (the
// same mesher), one material per kind (solid, glowing, glass, water, leaf, metal). Placed copies stay
// copies: a prefab is one mesh that every copy's node uses, so a crowd stays small.
import { meshObject } from '../../shared/voxelmesh.ts';
import { composeSwaps } from '../../shared/voxel.ts';
import type { ObjectPart, RenderClass } from '../../shared/voxelmesh.ts';
import { readObject, readPrefab } from './store.ts';
import type { PrefabInstance, VoxelMaterial, VoxelObjectData, VoxelWorld } from '../../shared/types.ts';

type Json = Record<string, unknown>;

/** Nodes one file may hold: every placed copy (copies inside copies too) is a node or two. */
export const GLB_MAX_NODES = 200_000;

const CLASS_MATERIAL: Record<RenderClass, Json> = {
  opaque: { name: 'solid', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.88 } },
  // glowing: unlit, so its colours show at full strength (glTF has no per-vertex emission)
  emissive: { name: 'glowing', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, extensions: { KHR_materials_unlit: {} } },
  transparent: { name: 'glass', alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.38], metallicFactor: 0, roughnessFactor: 0.1 } },
  water: { name: 'water', alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.72], metallicFactor: 0, roughnessFactor: 0.15 } },
  leaf: { name: 'leaf', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true },
  metal: { name: 'metal', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.6, roughnessFactor: 0.35 } },
};
const CLASSES = Object.keys(CLASS_MATERIAL) as RenderClass[];

/** sRGB byte → linear light (glTF vertex colours are linear). */
const LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

export interface GltfTarget {
  kind: 'object' | 'prefab' | 'world';
  id?: string;
}

/** A quaternion for turning around y, then x (tilt), then z (roll), degrees. */
function quat(turn = 0, tilt = 0, roll = 0): [number, number, number, number] {
  const h = Math.PI / 360;
  const [cy, sy] = [Math.cos(turn * h), Math.sin(turn * h)];
  const [cx, sx] = [Math.cos(tilt * h), Math.sin(tilt * h)];
  const [cz, sz] = [Math.cos(roll * h), Math.sin(roll * h)];
  // q = qy * qx * qz
  const yx = [cy * sx, sy * cx, -sy * sx, cy * cx];
  return [yx[0] * cz + yx[1] * sz, yx[1] * cz - yx[0] * sz, yx[2] * cz + yx[3] * sz, yx[3] * cz - yx[2] * sz] as [number, number, number, number];
}

export function toGlb(w: VoxelWorld, target: GltfTarget): Uint8Array {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Json[] = [];
  const accessors: Json[] = [];
  const meshes: Json[] = [];
  const nodes: Json[] = [];
  const used = new Set<RenderClass>();
  const add = (bytes: Uint8Array, target?: number): number => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    byteLength += bytes.length;
    return bufferViews.length - 1;
  };
  const accessor = (bytes: Uint8Array, a: Json, target?: number) => (accessors.push({ bufferView: add(bytes, target), ...a }), accessors.length - 1);

  /** A mesh for meshed parts (null when there is nothing to draw). */
  const meshOf = (parts: ObjectPart[], name: string): number | null => {
    const primitives: Json[] = [];
    for (const p of parts) {
      const n = p.positions.length / 3;
      const pos = new Float32Array(n * 3);
      const nor = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n * 3; i++) {
        const a = i % 3;
        const v = (p.min[a] + p.positions[i]) * p.voxelSize;
        pos[i] = v;
        lo[a] = Math.min(lo[a], v);
        hi[a] = Math.max(hi[a], v);
        nor[i] = p.normals[i] / 127;
        col[i] = LINEAR[p.colors[i]];
      }
      used.add(p.cls);
      primitives.push({
        attributes: {
          POSITION: accessor(new Uint8Array(pos.buffer), { componentType: 5126, count: n, type: 'VEC3', min: lo, max: hi }, 34962),
          NORMAL: accessor(new Uint8Array(nor.buffer), { componentType: 5126, count: n, type: 'VEC3' }, 34962),
          COLOR_0: accessor(new Uint8Array(col.buffer), { componentType: 5126, count: n, type: 'VEC3' }, 34962),
        },
        indices: accessor(new Uint8Array(p.indices.buffer, p.indices.byteOffset, p.indices.byteLength), { componentType: 5125, count: p.indices.length, type: 'SCALAR' }, 34963),
        material: CLASSES.indexOf(p.cls),
      });
    }
    if (!primitives.length) return null;
    meshes.push({ name, primitives });
    return meshes.length - 1;
  };

  // prefabs: one mesh per prefab and swap, shared by every copy
  const prefabMeshes = new Map<string, number | null>();
  const paletteFor = (swap: [string, string][]): VoxelMaterial[] => {
    if (!swap.length) return w.palette;
    const pal = [...w.palette];
    for (const [from, to] of swap) {
      const i = pal.findIndex((m) => m.name.toLowerCase() === from);
      const t = w.palette.find((m) => m.name.toLowerCase() === to);
      if (i >= 0 && t) pal[i] = t;
    }
    return pal;
  };
  const prefabData = new Map<string, ReturnType<typeof readPrefab>>();
  const dataOf = (id: string) => {
    if (!prefabData.has(id)) prefabData.set(id, readPrefab(w.id, id));
    return prefabData.get(id) ?? null;
  };
  /** Nodes for the copies placed in some data (and the copies inside them), as children of `into`. */
  const copies = (list: PrefabInstance[] | undefined, depth: number, seen: string[], parentSwap: Map<string, string> = new Map()): number[] => {
    const out: number[] = [];
    if (depth > 4) return out;
    for (const inst of list || []) {
      const p = w.prefabs.find((x) => x.id === inst.prefab);
      if (!p || seen.includes(p.id)) continue;
      if (nodes.length + 2 > GLB_MAX_NODES) throw Object.assign(new Error(`That has too many copies (copies inside copies counted) to go in one file: the most is about ${(GLB_MAX_NODES / 2).toLocaleString('en-US')}.`), { status: 413 });
      // a copy's swaps, then the ones of the copies it is inside (as the page draws it)
      const swap = composeSwaps(inst.swap, parentSwap);
      const sorted = [...swap].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const key = `${p.id}|${JSON.stringify(sorted)}`;
      const data = dataOf(p.id);
      if (!prefabMeshes.has(key)) prefabMeshes.set(key, data ? meshOf(meshObject({ volumes: data.volumes }, paletteFor(sorted)), p.name) : null);
      const mesh = prefabMeshes.get(key);
      // its pivot stands at p: the prefab's voxels are moved back by the pivot in a child node
      const inner: Json = { name: `${p.name} (voxels)`, translation: p.pivot.map((n) => -n), ...(mesh !== null && mesh !== undefined ? { mesh } : {}) };
      nodes.push(inner);
      const innerId = nodes.length - 1;
      const kids = [innerId];
      for (const c of copies(data?.instances, depth + 1, [...seen, p.id], swap)) {
        // copies inside the prefab are in its voxels' frame too
        (nodes[innerId].children = (nodes[innerId].children as number[] | undefined) || []).push(c);
      }
      const s = inst.scale || 1;
      nodes.push({ name: inst.name || p.name, translation: inst.p, rotation: quat(inst.turn, inst.tilt, inst.roll), scale: [inst.mirror ? -s : s, s, s], children: kids });
      out.push(nodes.length - 1);
    }
    return out;
  };
  const objectNode = (data: VoxelObjectData | null, name: string, extra: Json, seen: string[] = []): number => {
    const mesh = data ? meshOf(meshObject({ volumes: data.volumes }, w.palette), name) : null;
    const kids = copies(data?.instances, 0, seen);
    nodes.push({ name, ...extra, ...(mesh !== null ? { mesh } : {}), ...(kids.length ? { children: kids } : {}) });
    return nodes.length - 1;
  };

  let roots: number[];
  if (target.kind === 'prefab') {
    const p = w.prefabs.find((x) => x.id === target.id);
    if (!p) throw Object.assign(new Error('No such prefab.'), { status: 404 });
    roots = [objectNode(readPrefab(w.id, p.id), p.name, { translation: p.pivot.map((n) => -n) }, [p.id])];
  } else {
    const list = target.kind === 'object' ? w.objects.filter((o) => o.id === target.id) : w.objects.filter((o) => !o.hidden);
    if (!list.length) throw Object.assign(new Error(target.kind === 'object' ? 'No such object.' : 'Nothing is built in this world yet.'), { status: 404 });
    // (pinned to a team or an agent: placed from the middle of the map; the Station isn't in the file)
    roots = list.map((o) => objectNode(readObject(w.id, o.id), o.name, target.kind === 'world' ? { translation: o.position, rotation: quat(o.rotation), scale: [o.scale, o.scale, o.scale] } : {}));
  }

  const json: Json = {
    asset: { version: '2.0', generator: 'Blacksite voxel world' },
    scene: 0,
    scenes: [{ name: w.name, nodes: roots }],
    nodes,
    meshes,
    materials: CLASSES.map((c) => CLASS_MATERIAL[c]),
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
    ...(used.has('emissive') ? { extensionsUsed: ['KHR_materials_unlit'] } : {}),
  };
  const bin = new Uint8Array(byteLength + ((4 - (byteLength % 4)) % 4));
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.length;
  }
  let text = new TextEncoder().encode(JSON.stringify(json));
  if (text.length % 4) text = Uint8Array.from([...text, ...new Array(4 - (text.length % 4)).fill(0x20)]);
  const out = new Uint8Array(12 + 8 + text.length + 8 + bin.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, text.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  v.setUint32(20 + text.length, bin.length, true);
  v.setUint32(24 + text.length, 0x004e4942, true);
  out.set(bin, 28 + text.length);
  return out;
}
