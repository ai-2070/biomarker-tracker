// MagicaVoxel .vox files: read one into voxels (every model of it, placed by its scene graph) and write an
// object or prefab out as one. MagicaVoxel is z-up; the world is y-up: (x, y, z) in a file is (x, z, -y) here.
// The format: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
import { CHUNK, newVolume, setVoxel, hexRgb } from '../../shared/voxel.ts';
import type { Volume } from '../../shared/voxel.ts';
import type { VoxelMaterial, VoxelMaterialKind } from '../../shared/types.ts';
import type { Grid } from './ops.ts';

const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });
/** The most voxels a file may bring in. */
export const VOX_MAX_VOXELS = 1_000_000;

interface VoxModel {
  size: [number, number, number];
  /** x, y, z, colour index (1-255), four bytes each */
  xyzi: Uint8Array;
}
interface VoxNode {
  kind: 'trn' | 'grp' | 'shp';
  child?: number;
  children?: number[];
  models?: number[];
  t?: [number, number, number];
  /** a 3×3 rotation, row by row */
  r?: number[];
}
export interface VoxFile {
  models: VoxModel[];
  /** 256 colours: index i of a voxel is palette[i - 1] */
  palette: [number, number, number, number][];
  /** per colour index (1-255): what the file says the material is */
  materials: Map<number, { type: string; alpha?: number; emit?: number }>;
  nodes: Map<number, VoxNode>;
}

// ---------- reading ----------
export function parseVox(buf: Uint8Array): VoxFile {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const text = (at: number, n: number) => String.fromCharCode(...buf.subarray(at, at + n));
  if (buf.length < 20 || text(0, 4) !== 'VOX ') throw bad("That isn't a MagicaVoxel .vox file.");
  const out: VoxFile = { models: [], palette: defaultPalette(), materials: new Map(), nodes: new Map() };
  let size: [number, number, number] | null = null;
  let total = 0;
  const dict = (at: number): [Record<string, string>, number] => {
    const n = view.getInt32(at, true);
    let p = at + 4;
    const d: Record<string, string> = {};
    for (let i = 0; i < n && i < 256; i++) {
      const kl = view.getInt32(p, true);
      const k = text(p + 4, kl);
      p += 4 + kl;
      const vl = view.getInt32(p, true);
      d[k] = text(p + 4, vl);
      p += 4 + vl;
    }
    return [d, p];
  };
  // chunks: id, content size, children size, then the content; MAIN holds the rest as children
  let at = 8;
  while (at + 12 <= buf.length) {
    const id = text(at, 4);
    const n = view.getInt32(at + 4, true);
    const c = at + 12;
    if (n < 0 || c + n > buf.length) throw bad('That .vox file is damaged.');
    if (id === 'SIZE') size = [view.getInt32(c, true), view.getInt32(c + 4, true), view.getInt32(c + 8, true)];
    else if (id === 'XYZI') {
      const count = view.getInt32(c, true);
      if (count < 0 || c + 4 + count * 4 > buf.length) throw bad('That .vox file is damaged.');
      total += count;
      if (total > VOX_MAX_VOXELS) throw bad(`That .vox file has more than ${VOX_MAX_VOXELS.toLocaleString('en-US')} voxels.`);
      out.models.push({ size: size || [256, 256, 256], xyzi: buf.slice(c + 4, c + 4 + count * 4) });
    } else if (id === 'RGBA') {
      for (let i = 0; i < 256; i++) out.palette[i] = [buf[c + i * 4], buf[c + i * 4 + 1], buf[c + i * 4 + 2], buf[c + i * 4 + 3]];
    } else if (id === 'MATL') {
      const mid = view.getInt32(c, true);
      const [d] = dict(c + 4);
      out.materials.set(mid, { type: d._type || '_diffuse', alpha: d._alpha ? Number(d._alpha) : undefined, emit: d._emit ? Number(d._emit) : undefined });
    } else if (id === 'nTRN') {
      const nid = view.getInt32(c, true);
      const [, p] = dict(c + 4);
      const child = view.getInt32(p, true);
      const frames = view.getInt32(p + 12, true);
      const node: VoxNode = { kind: 'trn', child };
      if (frames > 0) {
        const [f] = dict(p + 16);
        if (f._t) node.t = f._t.split(' ').map(Number) as [number, number, number];
        if (f._r) node.r = rotation(Number(f._r));
      }
      out.nodes.set(nid, node);
    } else if (id === 'nGRP') {
      const nid = view.getInt32(c, true);
      const [, p] = dict(c + 4);
      const k = view.getInt32(p, true);
      const children: number[] = [];
      for (let i = 0; i < k && i < 4096; i++) children.push(view.getInt32(p + 4 + i * 4, true));
      out.nodes.set(nid, { kind: 'grp', children });
    } else if (id === 'nSHP') {
      const nid = view.getInt32(c, true);
      const [, p] = dict(c + 4);
      const k = view.getInt32(p, true);
      const models: number[] = [];
      let q = p + 4;
      for (let i = 0; i < k && i < 256; i++) {
        models.push(view.getInt32(q, true));
        q = dict(q + 4)[1];
      }
      out.nodes.set(nid, { kind: 'shp', models });
    }
    // MAIN's own content is empty; step into its children rather than over them. Every other chunk's
    // children must fit in the file too, so each turn moves forward (a negative size would loop forever).
    const kids = view.getInt32(at + 8, true);
    if (kids < 0 || (id !== 'MAIN' && c + n + kids > buf.length)) throw bad('That .vox file is damaged.');
    at = id === 'MAIN' ? c + n : c + n + kids;
  }
  if (!out.models.length) throw bad('That .vox file has no models in it.');
  return out;
}

/** The rotation byte of an nTRN frame as a 3×3 matrix (row by row). */
function rotation(b: number): number[] {
  const i0 = b & 3;
  const i1 = (b >> 2) & 3;
  const i2 = 3 - i0 - i1;
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  m[i0] = b & 16 ? -1 : 1;
  m[3 + i1] = b & 32 ? -1 : 1;
  m[6 + i2] = b & 64 ? -1 : 1;
  return m;
}

/** Scene nodes and models one file's scene may visit (groups can name the same node many times over). */
export const VOX_MAX_VISITS = 200_000;

/** Every voxel of the file, placed: [x, y, z (file space, z up), colour index]. */
export function voxVoxels(f: VoxFile): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let visits = 0;
  const put = (m: VoxModel, t: [number, number, number], r: number[]) => {
    // a model placed many times counts each time: the limit is on what comes in, not what is stored
    if (out.length + m.xyzi.length / 4 > VOX_MAX_VOXELS) throw bad(`That .vox file places more than ${VOX_MAX_VOXELS.toLocaleString('en-US')} voxels.`);
    const half = m.size.map((s) => Math.floor(s / 2));
    for (let i = 0; i < m.xyzi.length; i += 4) {
      const v = [m.xyzi[i] - half[0], m.xyzi[i + 1] - half[1], m.xyzi[i + 2] - half[2]];
      out.push([t[0] + r[0] * v[0] + r[1] * v[1] + r[2] * v[2], t[1] + r[3] * v[0] + r[4] * v[1] + r[5] * v[2], t[2] + r[6] * v[0] + r[7] * v[1] + r[8] * v[2], m.xyzi[i + 3]]);
    }
  };
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul = (a: number[], b: number[]) => [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]));
  if (!f.nodes.size) {
    // no scene graph: the models where the file left them (side by side when there are several)
    let x = 0;
    for (const m of f.models) {
      put(m, [x + Math.floor(m.size[0] / 2), Math.floor(m.size[1] / 2), Math.floor(m.size[2] / 2)], I);
      x += m.size[0] + 1;
    }
    return out;
  }
  const walk = (id: number, t: [number, number, number], r: number[], depth: number) => {
    const n = f.nodes.get(id);
    if (!n || depth > 64) return;
    if (++visits > VOX_MAX_VISITS) throw bad("That .vox file's scene is too big to read.");
    if (n.kind === 'trn') {
      const nt = n.t || [0, 0, 0];
      const nr = n.r || I;
      const pt: [number, number, number] = [t[0] + r[0] * nt[0] + r[1] * nt[1] + r[2] * nt[2], t[1] + r[3] * nt[0] + r[4] * nt[1] + r[5] * nt[2], t[2] + r[6] * nt[0] + r[7] * nt[1] + r[8] * nt[2]];
      if (n.child !== undefined) walk(n.child, pt, mul(r, nr), depth + 1);
    } else if (n.kind === 'grp') for (const c of n.children || []) walk(c, t, r, depth + 1);
    else
      for (const mid of n.models || []) {
        if (++visits > VOX_MAX_VISITS) throw bad("That .vox file's scene is too big to read.");
        if (f.models[mid]) put(f.models[mid], t, r);
      }
  };
  walk(0, [0, 0, 0], I, 0);
  return out;
}

/** A .vox file as a grid at a voxel size, with the palette entries it needs (named "<name> 12"). */
export function voxToGrid(f: VoxFile, name: string, voxelSize: number, newId: () => string): { grid: Grid; materials: VoxelMaterial[]; colorOf: Map<number, number>; count: number } {
  const voxels = voxVoxels(f);
  const used = [...new Set(voxels.map((v) => v[3]))].sort((a, b) => a - b);
  if (used.length > 255) throw bad('That .vox file uses too many colours.');
  const materials: VoxelMaterial[] = used.map((ci) => {
    const [r, g, b] = f.palette[ci - 1] || [128, 128, 128];
    const m = f.materials.get(ci);
    const kind: VoxelMaterialKind = m?.type === '_emit' ? 'emissive' : m?.type === '_glass' || m?.type === '_blend' ? 'glass' : m?.type === '_metal' ? 'metal' : 'solid';
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    return { name: `${name.toLowerCase().slice(0, 30)} ${ci}`, color: hex, jitter: 0.04, kind, ...(kind === 'emissive' ? { emissive: Math.max(1, Math.min(8, (m?.emit ?? 0.5) * 6)) } : {}), ...(kind === 'glass' ? { opacity: Math.max(0.1, Math.min(1, 1 - (m?.alpha ?? 0.5))) } : {}) };
  });
  // values 1..n in the order of `materials`; the caller maps them to the world's palette
  const colorOf = new Map(used.map((ci, i) => [ci, i + 1]));
  // centred on x and z, standing on y = 0
  let [minX, minY, minZ, maxX, maxY, maxZ] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of voxels) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const cx = Math.floor((minX + maxX) / 2);
  const cy = Math.floor((minY + maxY) / 2);
  const vol: Volume = newVolume(voxelSize);
  for (const [x, y, z, ci] of voxels) setVoxel(vol, x - cx, z - minZ, -(y - cy), colorOf.get(ci)!);
  return { grid: { id: newId(), voxelSize, vol }, materials, colorOf, count: voxels.length };
}

// ---------- writing ----------
/** A grid as a .vox file (one model per 256³ block, placed by a scene graph). Colours from the palette. */
export function gridToVox(grid: Grid, palette: VoxelMaterial[]): Uint8Array {
  // file space: (x, -z, y); blocks of 256 voxels counted from the model's own corner (a small one is one model)
  const all: number[] = [];
  for (const [k, c] of grid.vol.chunks) {
    const [cx, cy, cz] = k.split(',').map(Number);
    for (let i = 0; i < c.length; i++) if (c[i]) all.push(cx * CHUNK + (i % CHUNK), -(cz * CHUNK + (Math.floor(i / CHUNK) % CHUNK)), cy * CHUNK + Math.floor(i / (CHUNK * CHUNK)), c[i]);
  }
  const lo = [0, 1, 2].map((a) => all.reduce((m, _, i) => (i % 4 === a ? Math.min(m, all[i]) : m), Infinity));
  const blocks = new Map<string, number[]>();
  for (let i = 0; i < all.length; i += 4) {
    const key = [0, 1, 2].map((a) => Math.floor((all[i + a] - lo[a]) / 256)).join(',');
    let list = blocks.get(key);
    if (!list) blocks.set(key, (list = []));
    list.push(all[i], all[i + 1], all[i + 2], all[i + 3]);
  }
  const parts: Uint8Array[] = [];
  const int = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, n, true);
    return b;
  };
  const str = (s: string) => {
    const t = new TextEncoder().encode(s);
    return concat([int(t.length), t]);
  };
  const dictOf = (d: Record<string, string>) => concat([int(Object.keys(d).length), ...Object.entries(d).flatMap(([k, v]) => [str(k), str(v)])]);
  const chunk = (id: string, content: Uint8Array) => concat([new TextEncoder().encode(id), int(content.length), int(0), content]);
  const models: { size: number[]; at: number[] }[] = [];
  for (const [key, list] of blocks) {
    const base = key.split(',').map((n, a) => Number(n) * 256 + lo[a]);
    const xyzi = new Uint8Array(list.length);
    for (let i = 0; i < list.length; i += 4) {
      xyzi[i] = list[i] - base[0];
      xyzi[i + 1] = list[i + 1] - base[1];
      xyzi[i + 2] = list[i + 2] - base[2];
      xyzi[i + 3] = list[i + 3];
    }
    parts.push(chunk('SIZE', concat([int(256), int(256), int(256)])), chunk('XYZI', concat([int(list.length / 4), xyzi])));
    models.push({ size: [256, 256, 256], at: base });
  }
  // the scene: a root transform, a group, then a transform and a shape per model
  const nodes: Uint8Array[] = [chunk('nTRN', concat([int(0), dictOf({}), int(1), int(-1), int(-1), int(1), dictOf({})])), chunk('nGRP', concat([int(1), dictOf({}), int(models.length), ...models.map((_, i) => int(2 + i * 2))]))];
  models.forEach((m, i) => {
    const t = m.at.map((n, a) => n + m.size[a] / 2).join(' ');
    nodes.push(chunk('nTRN', concat([int(2 + i * 2), dictOf({}), int(3 + i * 2), int(-1), int(0), int(1), dictOf({ _t: t })])));
    nodes.push(chunk('nSHP', concat([int(3 + i * 2), dictOf({}), int(1), int(i), dictOf({})])));
  });
  const rgba = new Uint8Array(256 * 4);
  const matl: Uint8Array[] = [];
  palette.slice(0, 255).forEach((m, i) => {
    const [r, g, b] = hexRgb(m.color);
    rgba.set([r, g, b, 255], i * 4);
    const d: Record<string, string> = m.kind === 'emissive' ? { _type: '_emit', _emit: String(Math.min(1, (m.emissive ?? 3) / 6)) } : m.kind === 'glass' || m.kind === 'water' ? { _type: '_glass', _alpha: String(1 - (m.opacity ?? 0.5)) } : m.kind === 'metal' ? { _type: '_metal' } : {};
    if (Object.keys(d).length) matl.push(chunk('MATL', concat([int(i + 1), dictOf(d)])));
  });
  const children = concat([...parts, ...nodes, chunk('RGBA', rgba), ...matl]);
  return concat([new TextEncoder().encode('VOX '), int(150), new TextEncoder().encode('MAIN'), int(0), int(children.length), children]);
}

function concat(list: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(list.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of list) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** MagicaVoxel's palette when a file has none: a simple ramp, enough to read a file without colours. */
function defaultPalette(): [number, number, number, number][] {
  return Array.from({ length: 256 }, (_, i) => {
    const v = 255 - (i % 32) * 7;
    return [v, v, v, 255];
  });
}
