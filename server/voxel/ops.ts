// The build language: a list of plain JSON steps run in order on one object or prefab (VOXEL_WORLD_PLAN.md §4, §4b).
// Nothing is run as code and nothing is built in: shapes, shape tools (revolve, extrude, path, blob), region tools
// (copy, shift, rotate, flip), and prefabs the agents made themselves, stamped into the voxels or placed as copies.
// Positions are whole voxels of the current voxel size, from the cursor (map units with "units": "map": inVoxels).
// A call either works as a whole or changes nothing: a step that fails puts back everything it changed.
import { CHUNK, CHUNK_CELLS, cellIndex, chunkKey, composeSwaps, decodeChunk, encodeChunk, hash3, hexRgb, newVolume, volumeBounds } from '../../shared/voxel.ts';
import { rng, valueNoise } from './noise.ts';
import type { Volume } from '../../shared/voxel.ts';
import { stockMaterial } from './materials.ts';
import { glyph, GLYPH_H, GLYPH_W } from './font.ts';
import type { PrefabInstance, VoxelMaterial, VoxelMaterialKind, VoxelObjectData } from '../../shared/types.ts';

export const LIMITS = {
  /** voxels one call may add, remove or repaint */
  changedPerCall: 250_000,
  /** voxels from the object's origin, each way */
  reach: 256,
  volumesPerObject: 16,
  palette: 255,
  /** single voxels in one "set" step */
  setPoints: 5000,
  steps: 400,
  /** steps one script may run (a set() of many voxels counts once per 5,000) */
  scriptSteps: 20_000,
  scatter: 400,
  /** prefab copies one call may place */
  placedPerCall: 2000,
  /** points in a path, an outline or a profile */
  points: 512,
  /** how far a point of a path, an outline or a profile may be from the step's spot, in voxels */
  pointReach: 2048,
  /** voxel spots one call may look at (also those it leaves as they are), so no step can run for ever */
  work: 20_000_000,
};
export const VOXEL_SIZE_MIN = 0.05;
export const VOXEL_SIZE_MAX = 4;
const KINDS: VoxelMaterialKind[] = ['solid', 'glass', 'water', 'emissive', 'metal', 'leaf', 'snow'];

/** A step that can't be done, with the step's number and what to change. */
export class BuildError extends Error {}

/** One grid of an object, in memory. */
export interface Grid {
  id: string;
  voxelSize: number;
  vol: Volume;
}

export function loadGrids(data: VoxelObjectData | null | undefined): Grid[] {
  return (data?.volumes || []).map((v) => {
    const vol = newVolume(v.voxelSize);
    for (const [k, text] of Object.entries(v.chunks || {})) vol.chunks.set(k, decodeChunk(text));
    return { id: v.id, voxelSize: v.voxelSize, vol };
  });
}

/** Grids as stored: empty chunks and empty grids left out. */
export function saveGrids(grids: Grid[]): VoxelObjectData {
  const volumes: VoxelObjectData['volumes'] = [];
  for (const g of grids) {
    const chunks: Record<string, string> = {};
    for (const [k, c] of g.vol.chunks) if (c.some((x) => x)) chunks[k] = encodeChunk(c);
    if (Object.keys(chunks).length) volumes.push({ id: g.id, voxelSize: g.voxelSize, chunks });
  }
  return { volumes };
}

/** What shape tools draw with: positions in voxels from the step's spot. */
interface Pen {
  /** the voxel size, in map units */
  readonly size: number;
  /** map units → whole voxels at this size (at least 1) */
  vox(mapUnits: number): number;
  /** a palette value by material name (a stock material is added on first use) */
  mat(name: string): number;
  /** the next repeatable random number in [0, 1) */
  rand(): number;
  put(x: number, y: number, z: number, value: number, opts?: { keep?: boolean }): void;
  get(x: number, y: number, z: number): number;
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, value: number, opts?: { keep?: boolean }): void;
  /** an ellipsoid; holes: the share of voxels left out (leafy crowns) */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, value: number, opts?: { keep?: boolean; holes?: number; rough?: number }): void;
  /** a line of spheres of radius r (0: one voxel thick) */
  line(a: [number, number, number], b: [number, number, number], value: number, r?: number, opts?: { keep?: boolean }): void;
}

/** What a call changed. before: every touched chunk as it was (null: there was none), for undo. */
export interface BuildOutcome {
  added: number;
  removed: number;
  painted: number;
  grids: Grid[];
  before: { gridId: string; voxelSize: number; chunks: Record<string, string | null> }[];
  /** materials added to the palette */
  newMaterials: string[];
  notes: string[];
  /** the prefab copies placed in it now, and how many this call placed and took away */
  instances: PrefabInstance[];
  placed: number;
  unplaced: number;
}

type Step = Record<string, unknown>;
type V3 = [number, number, number];

const num = (v: unknown, what: string, { min = -Infinity, max = Infinity, def }: { min?: number; max?: number; def?: number } = {}): number => {
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    throw new BuildError(`${what} is missing`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BuildError(`${what} must be a number`);
  return Math.max(min, Math.min(max, n));
};
const int = (v: unknown, what: string, o: { min?: number; max?: number; def?: number } = {}): number => Math.round(num(v, what, o));
const vec = (v: unknown, what: string, def?: V3): V3 => {
  if (v === undefined && def) return def;
  if (!Array.isArray(v) || v.length !== 3) throw new BuildError(`${what} must be [x, y, z]`);
  return [num(v[0], what), num(v[1], what), num(v[2], what)];
};
const ivec = (v: unknown, what: string, def?: V3): V3 => vec(v, what, def).map(Math.round) as V3;
const size3 = (v: unknown, what: string): V3 => {
  const s = typeof v === 'number' ? [v, v, v] : v;
  const out = ivec(s, what);
  if (out.some((n) => n < 1 || n > LIMITS.reach * 2)) throw new BuildError(`${what}: each side from 1 to ${LIMITS.reach * 2} voxels`);
  return out;
};

// (placing first: a "place" step may also say "mirror", which alone is a state step)
const SHAPE_VERBS = ['place', 'unplace', 'stamp', 'box', 'sphere', 'ellipsoid', 'blob', 'cylinder', 'cone', 'pyramid', 'torus', 'revolve', 'extrude', 'path', 'line', 'stairs', 'arch', 'set', 'layers', 'text', 'heightmap', 'replace', 'copy', 'shift', 'rotate', 'flip', 'snow_cover', 'overgrow', 'weather', 'clear', 'scatter'];
const STATE_VERBS = ['voxel_size', 'material', 'use', 'seed', 'at', 'move', 'mirror'];
export const VERBS = [...SHAPE_VERBS, ...STATE_VERBS];

// ---------- map units ----------
// A step (or a whole call) with "units": "map" gives its positions and sizes in map units, the numbers
// world_info and plans use; here they become voxels of the current voxel size before the step runs.
// Character drawings stay in voxels: layers, heightmap rows, extrude rows and text's letter scale.
type Conv = 'pos' | 'size' | 'len';
const STEP_LENGTHS: Record<string, Record<string, Conv | Record<string, Conv>>> = {
  box: { box: 'size' },
  sphere: { sphere: 'len' },
  ellipsoid: { ellipsoid: 'len' },
  blob: { blob: 'len' },
  cylinder: { cylinder: 'len', height: 'size' },
  cone: { cone: 'len', height: 'size' },
  pyramid: { pyramid: 'size', height: 'size' },
  torus: { torus: 'len', tube: 'len' },
  revolve: { revolve: 'pos' },
  extrude: { extrude: { points: 'pos', height: 'size', wall: 'size' }, height: 'size', wall: 'size' },
  path: { path: 'pos', width: 'size', height: 'size' },
  line: { line: 'pos', thickness: 'size' },
  stairs: { stairs: { width: 'size', rise: 'size', run: 'size' } },
  arch: { arch: { width: 'size', height: 'size', thickness: 'size', depth: 'size' } },
  set: { set: 'pos' },
  text: { depth: 'size' },
  heightmap: { heightmap: { size: 'size', height: 'size', cell: 'size' } },
  copy: { copy: 'size', from: 'pos' },
  shift: { shift: 'size', from: 'pos' },
  rotate: { rotate: 'size' },
  flip: { flip: 'size' },
  snow_cover: { snow_cover: { depth: 'size' } },
  overgrow: { overgrow: { hang: 'size' } },
  scatter: { scatter: { area: 'size' } },
  // (copies stand exactly where asked: their spots aren't rounded to whole voxels)
  place: { scatter: { area: 'size', spacing: 'len' }, along: 'len', every: 'len', offset: 'len', grid: { gap: 'len' } },
};

/** A step in map units, in voxels of `size` (state steps keep "units": "map": the cursor is in map units). */
export function inVoxels(step: Step, size: number): Step {
  const verb = verbOf(step);
  if (verb === 'at' || verb === 'move') return { ...step, units: 'map' };
  const conv = (v: unknown, how: Conv): unknown => {
    if (typeof v === 'number') return how === 'pos' ? Math.round(v / size) : how === 'size' ? Math.max(v > 0 ? 1 : 0, Math.round(v / size)) : v / size;
    if (Array.isArray(v)) return v.map((x) => conv(x, how));
    return v;
  };
  const out: Step = { ...step };
  delete out.units;
  if (step.at !== undefined) out.at = conv(step.at, verb === 'place' ? 'len' : 'pos');
  if (verb === 'place') out.exact = true;
  if (step.in !== undefined) out.in = conv(step.in, 'size');
  for (const [field, how] of Object.entries(STEP_LENGTHS[verb] || {})) {
    if (out[field] === undefined) continue;
    if (typeof how === 'string') out[field] = conv(out[field], how);
    else if (out[field] && typeof out[field] === 'object' && !Array.isArray(out[field])) {
      const inner = { ...(out[field] as Record<string, unknown>) };
      for (const [k, h] of Object.entries(how)) if (inner[k] !== undefined) inner[k] = conv(inner[k], h);
      out[field] = inner;
    }
  }
  // the step a scatter repeats is in map units too (it is turned into voxels when it runs)
  const sc = out.scatter as Record<string, unknown> | undefined;
  if (verb === 'scatter' && sc?.step && typeof sc.step === 'object' && !Array.isArray(sc.step)) out.scatter = { ...sc, step: { ...(sc.step as Step), units: 'map' } };
  return out;
}

function verbOf(step: Step): string {
  for (const v of SHAPE_VERBS) if (v in step) return v;
  for (const v of STATE_VERBS) if (v in step) return v;
  throw new BuildError(`unknown step. Each step has one of: ${VERBS.join(', ')}`);
}

/** A material from a step, checked. Unknown fields are ignored. */
export function cleanMaterial(step: Step, base?: VoxelMaterial): VoxelMaterial {
  const name = String(step.material ?? base?.name ?? '').trim().toLowerCase().slice(0, 40);
  if (!name) throw new BuildError('a material needs a name');
  const hex = (v: unknown, what: string) => {
    const s = String(v).trim();
    if (!/^#[0-9a-f]{6}$/i.test(s)) throw new BuildError(`${what} must be a color like #a0522d`);
    return s.toLowerCase();
  };
  const kind = step.kind === undefined ? base?.kind || 'solid' : String(step.kind);
  if (!KINDS.includes(kind as VoxelMaterialKind)) throw new BuildError(`kind is one of ${KINDS.join(', ')}`);
  const m: VoxelMaterial = { name, color: step.color !== undefined ? hex(step.color, 'color') : base?.color || '#8a8a8a', kind: kind as VoxelMaterialKind };
  const ramp = step.ramp !== undefined ? step.ramp : base?.ramp;
  if (ramp !== undefined) {
    if (!Array.isArray(ramp)) throw new BuildError('ramp must be a list of colors');
    m.ramp = ramp.slice(0, 6).map((c, i) => hex(c, `ramp[${i}]`));
  }
  const jitter = step.jitter ?? base?.jitter;
  if (jitter !== undefined) m.jitter = num(jitter, 'jitter', { min: 0, max: 0.3 });
  const emissive = step.emissive ?? base?.emissive;
  if (emissive !== undefined) m.emissive = num(emissive, 'emissive', { min: 0, max: 8 });
  const opacity = step.opacity ?? base?.opacity;
  if (opacity !== undefined) m.opacity = num(opacity, 'opacity', { min: 0.05, max: 1 });
  const roughness = step.roughness ?? base?.roughness;
  if (roughness !== undefined) m.roughness = num(roughness, 'roughness', { min: 0, max: 1 });
  return m;
}

export interface BuildInput {
  grids: Grid[];
  /** changed in place on success (materials added or changed) */
  palette: VoxelMaterial[];
  /** the voxel size the build starts with */
  voxelSize: number;
  steps: unknown[];
  seed?: number;
  newId: () => string;
  /** the prefab copies placed in it so far */
  instances?: PrefabInstance[];
  /** the world's prefabs, to place or stamp by name */
  prefabs?: PrefabRef[];
  /** a prefab's voxels and the copies inside it (for stamp) */
  loadPrefab?: (id: string) => { grids: Grid[]; instances: PrefabInstance[] } | null;
  /** why a prefab can't be placed here (a prefab inside itself), or null */
  cantPlace?: (id: string) => string | null;
  /** "map": every step's positions and sizes are in map units (else voxels, unless a step says "units": "map") */
  units?: 'voxels' | 'map';
  /** a script drives the build instead of `steps`: each step it hands over runs at once, and it can ask what
   *  is built so far. Whatever it throws undoes the whole build, like a failing step. */
  drive?: (api: BuildApi) => void;
}

/** What a script building an object or a prefab can do (positions in map units from its origin). */
export interface BuildApi {
  step(step: unknown): void;
  /** is anything built at that point (in any of its voxel sizes)? */
  solid(x: number, y: number, z: number): boolean;
  /** the material there at the current voxel size, or null */
  materialAt(x: number, y: number, z: number): string | null;
  /** the top of what is built in that column, at or below y, or null */
  top(x: number, z: number, fromY: number): number | null;
}

/** A prefab as a build sees it. */
export interface PrefabRef {
  id: string;
  name: string;
  /** map units from its voxels' origin to its bottom centre */
  pivot: V3;
}

export function runBuild(input: BuildInput): BuildOutcome {
  if (!input.drive && (!Array.isArray(input.steps) || !input.steps.length)) throw new BuildError('steps must be a list of build steps');
  if (input.steps.length > LIMITS.steps) throw new BuildError(`at most ${LIMITS.steps} steps in one call: split the build`);
  const grids = input.grids;
  const palette = input.palette.map((m) => ({ ...m }));
  const newMaterials: string[] = [];
  const instances = [...(input.instances || [])];
  let placed = 0;
  let unplaced = 0;
  const notes: string[] = [];
  const before = new Map<Grid, Map<string, Uint8Array | null>>();
  let added = 0;
  let removed = 0;
  let painted = 0;
  let work = 0;
  /** counts spots looked at: a step too big to work out stops with an error instead of holding up the server */
  const tick = (n = 1) => {
    work += n;
    if (work > LIMITS.work) throw new BuildError(`this is too much to work out in one call (more than ${LIMITS.work.toLocaleString('en-US')} voxel spots looked at): make the shapes smaller, split the build, or use a bigger voxel size`);
  };

  // ---------- state ----------
  let grid: Grid;
  let use = 0;
  let seed = input.seed ?? 1;
  let random = rng(seed);
  /** the cursor, in map units */
  let cursor: V3 = [0, 0, 0];
  let mirror: ('x' | 'y' | 'z')[] = [];

  const gridFor = (size: number): Grid => {
    const s = num(size, 'voxel_size', { min: VOXEL_SIZE_MIN, max: VOXEL_SIZE_MAX });
    const found = grids.find((g) => Math.abs(g.voxelSize - s) < 1e-6);
    if (found) return found;
    if (grids.length >= LIMITS.volumesPerObject) throw new BuildError(`an object can mix at most ${LIMITS.volumesPerObject} voxel sizes`);
    const g: Grid = { id: input.newId(), voxelSize: s, vol: newVolume(s) };
    grids.push(g);
    return g;
  };
  grid = gridFor(input.voxelSize);

  const matIndex = (name: unknown): number => {
    const n = String(name ?? '').trim().toLowerCase();
    if (!n) throw new BuildError('no material named');
    const i = palette.findIndex((m) => m.name === n);
    if (i >= 0) return i + 1;
    const stock = stockMaterial(n);
    if (!stock) throw new BuildError(`no material "${n}". Define it first: {"material": "${n}", "color": "#rrggbb"}, or use a stock one (grass, stone, wood, water, lantern…)`);
    if (palette.length >= LIMITS.palette) throw new BuildError(`the palette is full (${LIMITS.palette} materials)`);
    palette.push({ ...stock });
    newMaterials.push(stock.name);
    return palette.length;
  };

  // ---------- writing voxels ----------
  const current = () => grid;
  const base = (): V3 => cursor.map((c) => Math.round(c / grid.voxelSize)) as V3;
  const setAbs = (x: number, y: number, z: number, value: number, keep = false, grid = current()) => {
    tick();
    const R = LIMITS.reach;
    if (x < -R || x >= R || y < -R || y >= R || z < -R || z >= R) throw new BuildError(`it reaches past ${R} voxels from the object's origin. Use a bigger voxel size, or build that part as another object`);
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const k = chunkKey(cx, cy, cz);
    let c = grid.vol.chunks.get(k);
    const i = cellIndex(x - cx * CHUNK, y - cy * CHUNK, z - cz * CHUNK);
    const was = c ? c[i] : 0;
    if (was === value || (keep && was)) return;
    let seen = before.get(grid);
    if (!seen) before.set(grid, (seen = new Map()));
    if (!seen.has(k)) seen.set(k, c ? c.slice() : null);
    if (!c) grid.vol.chunks.set(k, (c = new Uint8Array(CHUNK_CELLS)));
    c[i] = value;
    if (!was) added++;
    else if (!value) removed++;
    else painted++;
    if (added + removed + painted > LIMITS.changedPerCall) throw new BuildError(`one call may change at most ${LIMITS.changedPerCall.toLocaleString('en-US')} voxels: split the build, or use a bigger voxel size`);
  };
  const getAbs = (x: number, y: number, z: number, grid = current()): number => {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const c = grid.vol.chunks.get(chunkKey(cx, cy, cz));
    return c ? c[cellIndex(x - cx * CHUNK, y - cy * CHUNK, z - cz * CHUNK)] : 0;
  };
  /** puts a voxel at a spot from `o` (voxels), mirrored across the cursor when mirroring is on */
  const putFrom = (o: V3) => (x: number, y: number, z: number, value: number, keep = false) => {
    const p: V3 = [o[0] + x, o[1] + y, o[2] + z];
    const b = base();
    const spots: V3[] = [p];
    for (const ax of mirror) {
      const a = ax === 'x' ? 0 : ax === 'y' ? 1 : 2;
      for (const s of [...spots]) {
        const m: V3 = [...s];
        m[a] = 2 * b[a] - 1 - s[a];
        spots.push(m);
      }
    }
    for (const s of spots) setAbs(s[0], s[1], s[2], value, keep);
  };

  const makePen = (o: V3): Pen => {
    const put = putFrom(o);
    const pen: Pen = {
      size: grid.voxelSize,
      vox: (m) => Math.max(1, Math.round(num(m, 'size') / grid.voxelSize)),
      mat: (name) => matIndex(name),
      rand: () => random(),
      put: (x, y, z, v, opts) => put(Math.round(x), Math.round(y), Math.round(z), v, opts?.keep),
      get: (x, y, z) => getAbs(o[0] + Math.round(x), o[1] + Math.round(y), o[2] + Math.round(z)),
      box(x0, y0, z0, x1, y1, z1, v, opts) {
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) put(x, y, z, v, opts?.keep);
      },
      blob(cx, cy, cz, rx, ry, rz, v, opts) {
        const [ax, ay, az] = [Math.max(0.5, rx), Math.max(0.5, ry), Math.max(0.5, rz)];
        const rough = opts?.rough ?? 0;
        for (let y = Math.floor(-ay); y <= Math.ceil(ay); y++)
          for (let z = Math.floor(-az); z <= Math.ceil(az); z++)
            for (let x = Math.floor(-ax); x <= Math.ceil(ax); x++) {
              tick();
              const d = (x / ax) ** 2 + (y / ay) ** 2 + (z / az) ** 2;
              const edge = 1 - rough * hash3(cx + x, cy + y, cz + z, seed + 3);
              if (d > edge * edge) continue;
              if (opts?.holes && hash3(cx + x, cy + y, cz + z, seed + 5) < opts.holes) continue;
              put(Math.round(cx + x), Math.round(cy + y), Math.round(cz + z), v, opts?.keep);
            }
      },
      line(a, b, v, r = 0, opts) {
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]))));
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as V3;
          if (r < 0.5) put(p[0], p[1], p[2], v, opts?.keep);
          else pen.blob(p[0], p[1], p[2], r, r, r, v, opts);
        }
      },
    };
    return pen;
  };

  /** fills the voxels of a box (from `o`, size `s`) that `inside` says, solid or as a one-voxel shell */
  const fillShape = (put: ReturnType<typeof putFrom>, s: V3, inside: (x: number, y: number, z: number) => boolean, value: number, hollow: boolean, keep: boolean) => {
    for (let y = 0; y < s[1]; y++)
      for (let z = 0; z < s[2]; z++)
        for (let x = 0; x < s[0]; x++) {
          tick();
          if (!inside(x, y, z)) continue;
          if (hollow && inside(x + 1, y, z) && inside(x - 1, y, z) && inside(x, y + 1, z) && inside(x, y - 1, z) && inside(x, y, z + 1) && inside(x, y, z - 1)) continue;
          put(x, y, z, value, keep);
        }
  };


  // ---------- prefabs and copies ----------
  const prefabRef = (name: unknown): PrefabRef => {
    const n = String(name ?? '').trim().toLowerCase();
    const list = input.prefabs || [];
    const found = list.find((p) => p.id === n || p.name.toLowerCase() === n);
    if (!found) throw new BuildError(`no prefab "${String(name ?? '')}". ${list.length ? `This world's prefabs: ${list.map((p) => p.name).join(', ')}.` : 'This world has no prefabs yet.'} Make one with world_build and "prefab": "<name>".`);
    return found;
  };
  /** {"shirt": "cloth red"} as material names, checked (the new one is added to the palette if it is stock) */
  const swapNames = (sw: unknown): Record<string, string> => {
    if (!sw || typeof sw !== 'object' || Array.isArray(sw)) throw new BuildError('swap is {"material in the prefab": "material to use instead"}');
    const out: Record<string, string> = {};
    for (const [from, to] of Object.entries(sw)) {
      matIndex(to);
      out[from.trim().toLowerCase()] = String(to).trim().toLowerCase();
    }
    return out;
  };
  const swapValues = (sw: unknown): Map<number, number> => {
    const out = new Map<number, number>();
    if (sw === undefined) return out;
    for (const [from, to] of Object.entries(swapNames(sw))) {
      const i = palette.findIndex((m) => m.name === from);
      if (i >= 0) out.set(i + 1, matIndex(to));
    }
    return out;
  };
  const addInstance = (i: PrefabInstance) => {
    if (++placed > LIMITS.placedPerCall) throw new BuildError(`one call may place at most ${LIMITS.placedPerCall} copies`);
    instances.push(i);
  };
  /** the top of what is built below (map units), in any of this object's grids, looking down from y */
  const surfaceAt = (x: number, z: number, fromY: number): number | null => {
    let top: number | null = null;
    for (const g of grids) {
      const gx = Math.floor(x / g.voxelSize);
      const gz = Math.floor(z / g.voxelSize);
      for (let y = Math.min(LIMITS.reach - 1, Math.floor(fromY / g.voxelSize)); y >= -LIMITS.reach; y--)
        if (getAbs(gx, y, gz, g)) {
          const t = (y + 1) * g.voxelSize;
          if (top === null || t > top) top = t;
          break;
        }
    }
    return top;
  };
  const solidAt = (x: number, y: number, z: number): boolean => grids.some((g) => getAbs(Math.floor(x / g.voxelSize), Math.floor(y / g.voxelSize), Math.floor(z / g.voxelSize), g) > 0);

  // ---------- the steps ----------
  const run = (given: Step, depth: number) => {
    const step = input.units === 'map' || given.units === 'map' ? inVoxels(given, grid.voxelSize) : given;
    const verb = verbOf(step);
    // state
    if (!SHAPE_VERBS.includes(verb)) {
      if (verb === 'voxel_size') {
        grid = gridFor(num(step.voxel_size, 'voxel_size'));
      } else if (verb === 'material') {
        const name = String(step.material).trim().toLowerCase();
        const i = palette.findIndex((m) => m.name === name);
        const m = cleanMaterial(step, i >= 0 ? palette[i] : stockMaterial(name));
        if (i >= 0) palette[i] = m;
        else {
          if (palette.length >= LIMITS.palette) throw new BuildError(`the palette is full (${LIMITS.palette} materials)`);
          palette.push(m);
          newMaterials.push(m.name);
        }
        use = i >= 0 ? i + 1 : palette.length;
      } else if (verb === 'use') {
        use = matIndex(step.use);
      } else if (verb === 'seed') {
        seed = int(step.seed, 'seed');
        random = rng(seed);
      } else if (verb === 'at') {
        const p = vec(step.at, 'at');
        cursor = step.units === 'map' ? p : (p.map((n) => Math.round(n) * grid.voxelSize) as V3);
      } else if (verb === 'move') {
        const p = vec(step.move, 'move');
        cursor = cursor.map((c, i) => c + (step.units === 'map' ? p[i] : Math.round(p[i]) * grid.voxelSize)) as V3;
      } else if (verb === 'mirror') {
        const m = step.mirror;
        const list = m === false || m === 'none' || m === null ? [] : Array.isArray(m) ? m : [m];
        if (list.some((a) => !['x', 'y', 'z'].includes(String(a)))) throw new BuildError('mirror is "x", "y", "z", a list of them, or "none"');
        mirror = [...new Set(list.map(String))] as ('x' | 'y' | 'z')[];
      }
      return;
    }

    // a shape: where, with what
    const off: V3 = step.at === undefined ? [0, 0, 0] : step.units === 'map' ? (vec(step.at, 'at').map((n) => Math.round(n / grid.voxelSize)) as V3) : ivec(step.at, 'at');
    const b = base();
    const o: V3 = [b[0] + off[0], b[1] + off[1], b[2] + off[2]];
    const erase = step.erase === true;
    const keep = step.keep === true;
    const hollow = step.hollow === true;
    const value = () => {
      if (erase) return 0;
      if (step.use !== undefined) return matIndex(step.use);
      if (!use) throw new BuildError('pick a material first: {"use": "stone"} (or "use" in this step)');
      return use;
    };
    const put = putFrom(o);

    switch (verb) {
      // ---------- shape tools ----------
      case 'blob': {
        const r = vec(typeof step.blob === 'number' ? [step.blob, step.blob, step.blob] : step.blob, 'blob').map((n) => Math.max(0.5, Math.min(LIMITS.reach, n))) as V3;
        makePen(o).blob(0, 0, 0, r[0], r[1], r[2], value(), { keep, holes: num(step.holes, 'holes', { min: 0, max: 0.9, def: 0 }), rough: num(step.rough, 'rough', { min: 0, max: 0.9, def: 0 }) });
        break;
      }
      case 'revolve': {
        // [radius, height] points (voxels), turned around the vertical through the spot: columns, domes, vases, trunks
        const pts = points(step.revolve, 'revolve', 2).map((p, i) => [num(p[0], `revolve point ${i + 1}: radius`, { min: 0, max: LIMITS.reach }), num(p[1], `revolve point ${i + 1}: height`, { min: -LIMITS.reach * 2, max: LIMITS.reach * 2 })] as [number, number]);
        pts.sort((a, b) => a[1] - b[1]);
        const sides = int(step.sides, 'sides', { min: 0, max: 64, def: 0 });
        if (sides && sides < 3) throw new BuildError('sides is 0 (round) or 3 and up (4: square, 6, 8…)');
        const y0 = Math.floor(pts[0][1]);
        const y1 = Math.ceil(pts[pts.length - 1][1]);
        const rAt = (y: number) => {
          for (let i = 0; i < pts.length - 1; i++) {
            const [ra, ya] = pts[i];
            const [rb, yb] = pts[i + 1];
            if (y >= ya && y <= yb) return yb === ya ? Math.max(ra, rb) : ra + ((rb - ra) * (y - ya)) / (yb - ya);
          }
          return 0;
        };
        const inDisc = (x: number, z: number, r: number) => {
          if (r <= 0) return false;
          const d = Math.hypot(x, z);
          if (!sides) return d * d <= r * r + 0.25;
          // r is the distance to the middle of a side (so a square of radius 2 is 5 wide), a flat side facing +x
          const seg = (Math.PI * 2) / sides;
          const a = ((((Math.atan2(z, x) + seg / 2) % seg) + seg) % seg) - seg / 2;
          return d * Math.cos(a) <= r + 0.3;
        };
        const inside = (x: number, y: number, z: number) => y >= y0 && y < y1 && inDisc(x, z, rAt(y + 0.5));
        const R = Math.ceil(Math.max(...pts.map((p) => p[0]))) + 1;
        const v = value();
        for (let y = y0; y < y1; y++)
          for (let z = -R; z <= R; z++)
            for (let x = -R; x <= R; x++) {
              tick(pts.length);
              if (!inside(x, y, z)) continue;
              if (hollow && inside(x + 1, y, z) && inside(x - 1, y, z) && inside(x, y, z + 1) && inside(x, y, z - 1) && inside(x, y + 1, z) && inside(x, y - 1, z)) continue;
              put(x, y, z, v, keep);
            }
        break;
      }
      case 'extrude': {
        // an outline raised to a height: a polygon of [x, z] points, or rows of characters (rows along z, x along a row)
        const e = (step.extrude && typeof step.extrude === 'object' ? step.extrude : {}) as Record<string, unknown>;
        const height = int(e.height ?? step.height, 'height', { min: 1, max: LIMITS.reach * 2, def: 1 });
        // ("wall" beside "height", as the help shows it, or inside "extrude")
        const wallRaw = e.wall ?? step.wall;
        const wall = wallRaw === undefined ? 0 : int(wallRaw, 'wall', { min: 1, max: 64 });
        let inPlan: (x: number, z: number) => boolean;
        let box: [number, number, number, number];
        if (Array.isArray(e.rows)) {
          const rows = e.rows.map((r) => String(r));
          inPlan = (x, z) => z >= 0 && z < rows.length && x >= 0 && x < rows[z].length && rows[z][x] !== '.' && rows[z][x] !== ' ';
          box = [0, 0, Math.max(0, ...rows.map((r) => r.length)) - 1, rows.length - 1];
        } else {
          const poly = points(e.points, 'extrude.points', 3).map((p, i) => [num(p[0], `point ${i + 1}`), num(p[1], `point ${i + 1}`)] as [number, number]);
          box = [Math.floor(Math.min(...poly.map((p) => p[0]))), Math.floor(Math.min(...poly.map((p) => p[1]))), Math.ceil(Math.max(...poly.map((p) => p[0]))), Math.ceil(Math.max(...poly.map((p) => p[1])))];
          // which cells are inside, worked out once a row at a time (even-odd rule at the voxel's middle)
          const [x0, z0] = box;
          const w = box[2] - x0 + 1;
          const d = box[3] - z0 + 1;
          tick(w * d + d * poly.length);
          const mask = new Uint8Array(w * d);
          for (let row = 0; row < d; row++) {
            const pz = z0 + row + 0.5;
            const xs: number[] = [];
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const [xi, zi] = poly[i];
              const [xj, zj] = poly[j];
              if (zi > pz !== zj > pz) xs.push(((xj - xi) * (pz - zi)) / (zj - zi) + xi);
            }
            xs.sort((m, n) => m - n);
            // inside when an odd number of crossings lie right of the cell's middle
            let k = 0;
            for (let col = 0; col < w; col++) {
              const px = x0 + col + 0.5;
              while (k < xs.length && xs[k] <= px) k++;
              if ((xs.length - k) % 2) mask[row * w + col] = 1;
            }
          }
          inPlan = (x, z) => x >= x0 && z >= z0 && x - x0 < w && z - z0 < d && mask[(z - z0) * w + (x - x0)] === 1;
        }
        // with a wall thickness, only the cells that near the outline
        const nearEdge = (x: number, z: number) => {
          for (let d = 1; d <= wall; d++) {
            tick();
            if (!inPlan(x + d, z) || !inPlan(x - d, z) || !inPlan(x, z + d) || !inPlan(x, z - d)) return true;
          }
          return false;
        };
        const v = value();
        for (let z = box[1]; z <= box[3]; z++)
          for (let x = box[0]; x <= box[2]; x++) {
            tick();
            if (!inPlan(x, z) || (wall && !nearEdge(x, z))) continue;
            for (let y = 0; y < height; y++) put(x, y, z, v, keep);
          }
        break;
      }
      case 'path': {
        // a brush swept along points ([x, z] or [x, y, z]): roads, rivers, walls, fences
        const pts = points(step.path, 'path', 2).map((p, i) => (p.length === 3 ? [num(p[0], `point ${i + 1}`), num(p[1], `point ${i + 1}`), num(p[2], `point ${i + 1}`)] : [num(p[0], `point ${i + 1}`), 0, num(p[1], `point ${i + 1}`)]) as V3);
        const half = num(step.width, 'width', { min: 1, max: 256, def: 1 }) / 2;
        const height = int(step.height, 'height', { min: 1, max: 256, def: 1 });
        const v = value();
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay, az] = pts[i];
          const [bx, by, bz] = pts[i + 1];
          const dx = bx - ax;
          const dz = bz - az;
          const len2 = dx * dx + dz * dz || 1;
          for (let z = Math.floor(Math.min(az, bz) - half); z <= Math.ceil(Math.max(az, bz) + half); z++)
            for (let x = Math.floor(Math.min(ax, bx) - half); x <= Math.ceil(Math.max(ax, bx) + half); x++) {
              tick();
              const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
              if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) > half) continue;
              const y = Math.round(ay + (by - ay) * t);
              for (let k = 0; k < height; k++) put(x, y + k, z, v, keep);
            }
        }
        break;
      }
      // ---------- region tools ----------
      case 'copy':
      case 'shift':
      case 'rotate':
      case 'flip': {
        const size = size3(step[verb], verb);
        // copy and shift read from "from" and write at the spot; rotate and flip work in place at the spot
        const src: V3 = verb === 'copy' || verb === 'shift' ? ((f) => [b[0] + f[0], b[1] + f[1], b[2] + f[2]] as V3)(ivec(step.from, 'from')) : o;
        const q = quarter(verb === 'flip' ? 0 : step.turn ?? (verb === 'rotate' ? 90 : 0), 'turn');
        const flipAxis = verb === 'flip' ? String(step.axis || 'x') : step.mirror === undefined ? '' : String(step.mirror);
        if (flipAxis && !['x', 'y', 'z'].includes(flipAxis)) throw new BuildError('the axis to flip is x, y or z');
        const cells: [number, number, number, number][] = [];
        for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
          tick();
          const v = getAbs(src[0] + x, src[1] + y, src[2] + z);
          if (v) cells.push([x, y, z, v]);
        }
        if (verb !== 'copy') for (const [x, y, z] of cells) setAbs(src[0] + x, src[1] + y, src[2] + z, 0);
        const [w, , d] = size;
        for (const [cx, cy, cz, v] of cells) {
          let [x, y, z] = [cx, cy, cz];
          if (flipAxis === 'x') x = w - 1 - x;
          if (flipAxis === 'y') y = size[1] - 1 - y;
          if (flipAxis === 'z') z = d - 1 - z;
          [x, z] = turnQuarter(x, z, w, d, q);
          setAbs(o[0] + x, o[1] + y, o[2] + z, v, keep);
        }
        break;
      }
      // ---------- finishing passes ----------
      case 'snow_cover':
      case 'overgrow':
      case 'weather': {
        const opts = (step[verb] && typeof step[verb] === 'object' ? step[verb] : {}) as Record<string, unknown>;
        // the voxels to look at: a box from the spot ("in": [w, h, d]), or everything at this voxel size
        const box = step.in !== undefined ? size3(step.in, 'in') : null;
        const inBox = (x: number, y: number, z: number) => !box || (x >= o[0] && y >= o[1] && z >= o[2] && x < o[0] + box[0] && y < o[1] + box[1] && z < o[2] + box[2]);
        const cells: V3[] = [];
        for (const [k, c] of grid.vol.chunks) {
          const [cx, cy, cz] = k.split(',').map(Number);
          for (let i = 0; i < c.length; i++) {
            if (!c[i]) continue;
            const x = cx * CHUNK + (i % CHUNK);
            const y = cy * CHUNK + Math.floor(i / (CHUNK * CHUNK));
            const z = cz * CHUNK + (Math.floor(i / CHUNK) % CHUNK);
            if (inBox(x, y, z)) cells.push([x, y, z]);
          }
        }
        const kindOf = (v: number) => palette[v - 1]?.kind;
        const chance = num(opts.chance ?? opts.amount, 'chance', { min: 0, max: 1, def: verb === 'snow_cover' ? 0.9 : verb === 'overgrow' ? 0.25 : 0.3 });
        const roll = (x: number, y: number, z: number, salt: number) => hash3(x, y, z, seed + salt) < chance;
        // what to write is worked out first, so new snow or moss isn't covered again
        const writes: [number, number, number, number][] = [];
        if (verb === 'snow_cover') {
          const snow = step.use !== undefined ? matIndex(step.use) : matIndex('snow');
          const depth = int(opts.depth, 'depth', { min: 1, max: 8, def: 1 });
          const sheltered = opts.sheltered === true;
          for (const [x, y, z] of cells) {
            const v = getAbs(x, y, z);
            if (v === snow || kindOf(v) === 'water' || getAbs(x, y + 1, z) || !roll(x, y, z, 21)) continue;
            // only where the sky can see it (a ledge under an overhang stays bare), unless "sheltered"
            let open = true;
            for (let k = 2; k <= 48 && open && !sheltered; k++) if (getAbs(x, y + k, z)) open = false;
            if (!open) continue;
            for (let k = 1; k <= depth && !getAbs(x, y + k, z); k++) writes.push([x, y + k, z, snow]);
          }
        } else if (verb === 'overgrow') {
          const moss = step.use !== undefined ? matIndex(step.use) : matIndex('moss');
          const hang = int(opts.hang, 'hang', { min: 0, max: 32, def: 3 });
          for (const [x, y, z] of cells) {
            const v = getAbs(x, y, z);
            if (v === moss || kindOf(v) === 'water' || kindOf(v) === 'emissive') continue;
            // tufts on top
            if (!getAbs(x, y + 1, z) && roll(x, y, z, 31)) writes.push([x, y + 1, z, moss]);
            // vines hanging down a wall from its top edge
            if (!hang || getAbs(x, y + 1, z)) continue;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              if (getAbs(x + dx, y, z + dz) || hash3(x + dx, y, z + dz, seed + 37) >= chance * 0.6) continue;
              const len = 1 + Math.floor(hash3(x, y, z + dz, seed + 41) * hang);
              for (let k = 0; k < len && !getAbs(x + dx, y - k, z + dz) && getAbs(x, y - k, z); k++) writes.push([x + dx, y - k, z + dz, moss]);
            }
          }
        } else {
          // worn: a darker copy of each material, more of it near the bottom
          const dark = num(opts.dark, 'dark', { min: 0.02, max: 0.6, def: 0.18 });
          const b = volumeBounds(grid.vol);
          const lo = b ? b.min[1] : 0;
          const span = b ? Math.max(1, b.max[1] - b.min[1]) : 1;
          const worn = new Map<number, number>();
          const wornOf = (v: number) => {
            if (!worn.has(v)) {
              const m = palette[v - 1];
              if (!m || m.kind === 'emissive' || m.kind === 'water' || m.kind === 'glass' || m.name.endsWith(' worn')) worn.set(v, v);
              else {
                const shade = (hex: string) => '#' + hexRgb(hex).map((c) => Math.round(c * (1 - dark)).toString(16).padStart(2, '0')).join('');
                const name = `${m.name} worn`;
                const at = palette.findIndex((x) => x.name === name);
                if (at >= 0) worn.set(v, at + 1);
                else {
                  if (palette.length >= LIMITS.palette) throw new BuildError(`the palette is full (${LIMITS.palette} materials)`);
                  palette.push({ ...m, name, color: shade(m.color), ...(m.ramp ? { ramp: m.ramp.map(shade) } : {}) });
                  newMaterials.push(name);
                  worn.set(v, palette.length);
                }
              }
            }
            return worn.get(v)!;
          };
          for (const [x, y, z] of cells) {
            const v = getAbs(x, y, z);
            const low = 1 - ((y - lo) / span) * 0.7;
            if (hash3(x, y, z, seed + 51) < chance * low) writes.push([x, y, z, wornOf(v)]);
          }
        }
        for (const [x, y, z, v] of writes) setAbs(x, y, z, v);
        break;
      }
      // ---------- prefabs ----------
      case 'stamp': {
        // a prefab's voxels baked into this object (turned in quarter turns), for parts of a building
        const ref = prefabRef(step.stamp);
        const loaded = input.loadPrefab?.(ref.id);
        if (!loaded) throw new BuildError(`the prefab "${ref.name}" has no voxels yet`);
        const q = quarter(step.turn ?? 0, 'turn (a stamp turns in 90° steps; place a copy for any angle)');
        const swap = swapValues(step.swap);
        const spot = o.map((n) => n * grid.voxelSize) as V3;
        for (const g of loaded.grids) {
          const target = gridFor(g.voxelSize);
          const pv = ref.pivot.map((n) => n / g.voxelSize) as V3;
          const sp = spot.map((n) => Math.round(n / g.voxelSize)) as V3;
          for (const [k, c] of g.vol.chunks) {
            const [kx, ky, kz] = k.split(',').map(Number);
            for (let i = 0; i < c.length; i++) {
              if (!c[i]) continue;
              const x = kx * CHUNK + (i % CHUNK) - pv[0];
              const y = ky * CHUNK + Math.floor(i / (CHUNK * CHUNK)) - pv[1];
              const z = kz * CHUNK + (Math.floor(i / CHUNK) % CHUNK) - pv[2];
              const [rx, rz] = turnAround(x + 0.5, z + 0.5, q);
              setAbs(Math.floor(sp[0] + rx), Math.round(sp[1] + y), Math.floor(sp[2] + rz), swap.get(c[i]) ?? c[i], keep, target);
            }
          }
        }
        // copies inside it come along as copies: checked like placing them, and recoloured by the stamp's swap too
        for (const id of new Set(loaded.instances.map((i) => i.prefab))) {
          const why = input.cantPlace?.(id);
          if (why) throw new BuildError(why);
        }
        const outer = step.swap === undefined ? null : new Map(Object.entries(swapNames(step.swap)));
        for (const inst of loaded.instances) {
          const [rx, rz] = turnAround(inst.p[0] - ref.pivot[0], inst.p[2] - ref.pivot[2], q);
          const { swap: own, ...rest } = inst;
          const sw = outer ? Object.fromEntries(composeSwaps(own, outer)) : own;
          addInstance({ ...rest, p: [spot[0] + rx, spot[1] + inst.p[1] - ref.pivot[1], spot[2] + rz], turn: ((inst.turn || 0) + q * 90) % 360, ...(sw && Object.keys(sw).length ? { swap: sw } : {}) });
        }
        break;
      }
      case 'place': {
        const names = Array.isArray(step.place) ? step.place : [step.place];
        if (!names.length) throw new BuildError('name the prefab to place');
        const refs = names.map((n) => prefabRef(n));
        for (const r of refs) {
          const why = input.cantPlace?.(r.id);
          if (why) throw new BuildError(why);
        }
        const swaps = step.swap === undefined ? [undefined] : Array.isArray(step.swap) ? step.swap.map((x) => swapNames(x)) : [swapNames(step.swap)];
        const tilt = quarter(step.tilt ?? 0, 'tilt');
        const roll = quarter(step.roll ?? 0, 'roll');
        const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
        const turnOf = (facing: number) => {
          const t = step.turn;
          const extra = t === 'random' ? random() * 360 : Array.isArray(t) ? num(t[0], 'turn') + random() * (num(t[1], 'turn') - num(t[0], 'turn')) : num(t, 'turn', { def: 0 });
          return (((facing + extra) % 360) + 360) % 360;
        };
        const scaleOf = () => (Array.isArray(step.scale) ? num(step.scale[0], 'scale', { min: 0.1, max: 10 }) + random() * (num(step.scale[1], 'scale', { min: 0.1, max: 10 }) - num(step.scale[0], 'scale', { min: 0.1, max: 10 })) : num(step.scale, 'scale', { min: 0.1, max: 10, def: 1 }));
        // where: one spot, scattered in an area, along a path, or in a grid ([x, y, z] voxels, and the way it faces)
        const spots: { at: V3; facing: number }[] = [];
        // in map units a copy stands exactly where asked; in voxels, in the middle of the spot's voxel
        const exact = step.exact === true;
        const at0 = step.at === undefined ? ([0, 0, 0] as V3) : vec(step.at, 'at');
        const po: V3 = exact ? [cursor[0] / grid.voxelSize + at0[0], cursor[1] / grid.voxelSize + at0[1], cursor[2] / grid.voxelSize + at0[2]] : o;
        const many = step.scatter !== undefined || step.along !== undefined || step.grid !== undefined;
        if (step.scatter !== undefined) {
          const sc = (step.scatter && typeof step.scatter === 'object' ? step.scatter : {}) as Record<string, unknown>;
          const count = int(sc.count, 'scatter.count', { min: 1, max: LIMITS.placedPerCall });
          const [w, d] = Array.isArray(sc.area) ? [int(sc.area[0], 'scatter.area', { min: 1, max: 1024 }), int(sc.area[1], 'scatter.area', { min: 1, max: 1024 })] : [16, 16];
          const gap = num(sc.spacing, 'scatter.spacing', { min: 0, max: 256, def: 0 });
          for (let tries = 0; spots.length < count && tries < count * 30; tries++) {
            const at: V3 = [po[0] + (exact ? random() * w : Math.floor(random() * w)), po[1], po[2] + (exact ? random() * d : Math.floor(random() * d))];
            if (gap && spots.some((s) => Math.hypot(s.at[0] - at[0], s.at[2] - at[2]) < gap)) continue;
            spots.push({ at, facing: 0 });
          }
        } else if (step.along !== undefined) {
          const pts = points(step.along, 'along', 2).map((p, i) => (p.length === 3 ? [num(p[0], `point ${i + 1}`), num(p[1], `point ${i + 1}`), num(p[2], `point ${i + 1}`)] : [num(p[0], `point ${i + 1}`), 0, num(p[1], `point ${i + 1}`)]) as V3);
          const every = num(step.every, 'every', { min: 0.5, max: 1024, def: 8 });
          const sides = int(step.sides, 'sides', { min: 1, max: 2, def: 1 });
          const offset = num(step.offset, 'offset', { min: -256, max: 256, def: 0 });
          const face = String(step.face || 'along');
          if (!['along', 'across', 'none'].includes(face)) throw new BuildError('face is "along" (the way the path goes), "across" (towards the path) or "none"');
          let carry = 0;
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay, az] = pts[i];
            const [bx, by, bz] = pts[i + 1];
            const len = Math.hypot(bx - ax, bz - az);
            if (!len) continue;
            const ux = (bx - ax) / len;
            const uz = (bz - az) / len;
            for (let t = carry; t <= len; t += every) {
              for (const side of sides === 2 ? [1, -1] : [1]) {
                // left of the way the path goes is (uz, -ux)… seen from above with +z towards you; offset moves the copy sideways
                const nx = -uz * side;
                const nz = ux * side;
                const at: V3 = [po[0] + ax + ux * t + nx * offset, po[1] + ay + ((by - ay) * t) / len, po[2] + az + uz * t + nz * offset];
                const facing = face === 'along' ? (Math.atan2(ux, uz) * 180) / Math.PI : face === 'across' ? (Math.atan2(-nx, -nz) * 180) / Math.PI : 0;
                spots.push({ at, facing });
              }
              if (spots.length > LIMITS.placedPerCall) break;
              carry = t + every - len;
            }
            if (spots.length > LIMITS.placedPerCall) break;
          }
        } else if (step.grid !== undefined) {
          const g = (step.grid && typeof step.grid === 'object' ? step.grid : {}) as Record<string, unknown>;
          const rows = int(g.rows, 'grid.rows', { min: 1, max: 200 });
          const cols = int(g.cols, 'grid.cols', { min: 1, max: 200 });
          const [gx, gz] = Array.isArray(g.gap) ? [num(g.gap[0], 'grid.gap', { min: 0.5, max: 512 }), num(g.gap[1], 'grid.gap', { min: 0.5, max: 512 })] : [8, 8];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) spots.push({ at: [po[0] + c * gx, po[1], po[2] + r * gz], facing: 0 });
        } else spots.push({ at: [...po] as V3, facing: 0 });
        if (spots.length > LIMITS.placedPerCall) throw new BuildError(`one call may place at most ${LIMITS.placedPerCall} copies`);
        // a part's name in a character ("left arm"): only for one copy at a time
        const partName = step.name === undefined ? '' : String(step.name).trim().toLowerCase().slice(0, 40);
        if (partName && spots.length > 1) throw new BuildError('"name" is for one copy at a time (a part of a character)');
        if (partName === 'self') throw new BuildError('"self" means the whole character; give the part another name');
        if (partName && instances.some((i) => i.name === partName)) throw new BuildError(`there is already a part called "${partName}" here`);
        const onSurface = step.on === undefined ? many : step.on === 'surface';
        if (step.on !== undefined && step.on !== 'surface' && step.on !== 'spot') throw new BuildError('on is "surface" (stand on what is built below) or "spot" (exactly at the height given)');
        const size = grid.voxelSize;
        for (const s of spots) {
          // the middle of the spot's voxel
          const x = (s.at[0] + (exact ? 0 : 0.5)) * size;
          const z = (s.at[2] + (exact ? 0 : 0.5)) * size;
          let y = s.at[1] * size;
          if (onSurface) {
            const top = surfaceAt(x, z, y + (many ? 32 : 0));
            if (top !== null) y = top;
          }
          if (step.avoid === 'solid' && solidAt(x, y + size * 0.5, z)) continue;
          const mirrorIt = step.mirror === 'random' ? random() < 0.5 : step.mirror === true;
          const sw = pick(swaps);
          addInstance({
            prefab: pick(refs).id,
            p: [round3(x), round3(y), round3(z)],
            ...(turnOf(s.facing) ? { turn: Math.round(turnOf(s.facing) * 10) / 10 } : {}),
            ...(tilt ? { tilt: tilt * 90 } : {}),
            ...(roll ? { roll: roll * 90 } : {}),
            ...((sc) => (sc !== 1 ? { scale: Math.round(sc * 100) / 100 } : {}))(scaleOf()),
            ...(mirrorIt ? { mirror: true } : {}),
            ...(sw && Object.keys(sw).length ? { swap: sw } : {}),
            ...(partName ? { name: partName } : {}),
          });
        }
        break;
      }
      case 'unplace': {
        const which = step.unplace === 'all' ? null : new Set((Array.isArray(step.unplace) ? step.unplace : [step.unplace]).map((n) => prefabRef(n).id));
        // inside a box from the spot ("in": [w, h, d], voxels), or everywhere in this object
        const box = step.in !== undefined ? size3(step.in, 'in') : null;
        const lo = o.map((n) => n * grid.voxelSize);
        const keepIt = (i: PrefabInstance) => {
          if (which && !which.has(i.prefab)) return true;
          if (!box) return false;
          return i.p.some((n, a) => n < lo[a] || n >= lo[a] + box[a] * grid.voxelSize);
        };
        const before = instances.length;
        const left = instances.filter(keepIt);
        instances.splice(0, instances.length, ...left);
        unplaced += before - left.length;
        break;
      }
      case 'box': {
        const s = size3(step.box, 'box');
        const v = value();
        if (step.frame === true) {
          const edge = (x: number, y: number, z: number) => [x === 0 || x === s[0] - 1, y === 0 || y === s[1] - 1, z === 0 || z === s[2] - 1].filter(Boolean).length >= 2;
          fillShape(put, s, edge, v, false, keep);
        } else fillShape(put, s, (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < s[0] && y < s[1] && z < s[2], v, hollow, keep);
        break;
      }
      case 'sphere':
      case 'ellipsoid': {
        const r: V3 = verb === 'sphere' ? (([n]) => [n, n, n] as V3)([num(step.sphere, 'sphere', { min: 0.5, max: LIMITS.reach })]) : (vec(step.ellipsoid, 'ellipsoid').map((n) => Math.max(0.5, Math.min(LIMITS.reach, n))) as V3);
        const v = value();
        const lo = r.map((n) => -Math.ceil(n)) as V3;
        const s = r.map((n) => Math.ceil(n) * 2 + 1) as V3;
        const inside = (x: number, y: number, z: number) => ((x + lo[0]) / r[0]) ** 2 + ((y + lo[1]) / r[1]) ** 2 + ((z + lo[2]) / r[2]) ** 2 <= 1;
        fillShape(putFrom([o[0] + lo[0], o[1] + lo[1], o[2] + lo[2]]), s, inside, v, hollow, keep);
        break;
      }
      case 'cylinder':
      case 'cone': {
        const r = num(step[verb], verb, { min: 0.5, max: LIMITS.reach });
        const h = int(step.height, 'height', { min: 1, max: LIMITS.reach * 2 });
        const axis = String(step.axis || 'y');
        if (!['x', 'y', 'z'].includes(axis)) throw new BuildError('axis is x, y or z');
        const down = step.down === true;
        const v = value();
        const R = Math.ceil(r);
        const radiusAt = (t: number) => (verb === 'cone' ? r * (1 - (down ? h - 1 - t : t) / h) : r);
        // (t: along the axis, a and c: across it)
        const inside = (t: number, a: number, c: number) => t >= 0 && t < h && (a - R) ** 2 + (c - R) ** 2 <= radiusAt(t) ** 2 + 0.25;
        const map = (t: number, a: number, c: number): V3 => (axis === 'y' ? [a - R, t, c - R] : axis === 'x' ? [t, a - R, c - R] : [a - R, c - R, t]);
        for (let t = 0; t < h; t++)
          for (let a = 0; a <= 2 * R; a++)
            for (let c = 0; c <= 2 * R; c++) {
              tick();
              if (!inside(t, a, c)) continue;
              if (hollow && inside(t, a + 1, c) && inside(t, a - 1, c) && inside(t, a, c + 1) && inside(t, a, c - 1) && (verb === 'cylinder' ? true : inside(t + 1, a, c) && inside(t - 1, a, c))) continue;
              const [x, y, z] = map(t, a, c);
              put(x, y, z, v, keep);
            }
        break;
      }
      case 'pyramid': {
        const [w, d] = Array.isArray(step.pyramid) ? [int(step.pyramid[0], 'pyramid', { min: 1, max: 512 }), int(step.pyramid[1], 'pyramid', { min: 1, max: 512 })] : [int(step.pyramid, 'pyramid', { min: 1, max: 512 }), int(step.pyramid, 'pyramid', { min: 1, max: 512 })];
        const h = int(step.height, 'height', { min: 1, max: 512, def: Math.ceil(Math.min(w, d) / 2) });
        const v = value();
        for (let y = 0; y < h; y++) {
          const k = 1 - y / h;
          const hw = Math.max(0, Math.round((w * k) / 2));
          const hd = Math.max(0, Math.round((d * k) / 2));
          if (!hw || !hd) break;
          for (let z = -hd; z < hd; z++) for (let x = -hw; x < hw; x++) if (!hollow || y === 0 || x === -hw || x === hw - 1 || z === -hd || z === hd - 1) put(x, y, z, v, keep);
        }
        break;
      }
      case 'torus': {
        const R = num(step.torus, 'torus', { min: 1, max: LIMITS.reach });
        const t = num(step.tube, 'tube', { min: 0.5, max: R, def: Math.max(1, R / 4) });
        const v = value();
        const E = Math.ceil(R + t);
        const T = Math.ceil(t);
        for (let y = -T; y <= T; y++) for (let z = -E; z <= E; z++) for (let x = -E; x <= E; x++) {
          tick();
          if ((Math.hypot(x, z) - R) ** 2 + y * y <= t * t) put(x, y, z, v, keep);
        }
        break;
      }
      case 'line': {
        const to = ivec(step.line, 'line');
        const thick = num(step.thickness, 'thickness', { min: 1, max: 32, def: 1 });
        makePen(o).line([0, 0, 0], to, value(), (thick - 1) / 2, { keep });
        break;
      }
      case 'stairs': {
        const s = (step.stairs && typeof step.stairs === 'object' ? step.stairs : {}) as Record<string, unknown>;
        const steps = int(s.steps, 'stairs.steps', { min: 1, max: 256 });
        const width = int(s.width, 'stairs.width', { min: 1, max: 256, def: 3 });
        const rise = int(s.rise, 'stairs.rise', { min: 1, max: 8, def: 1 });
        const runLen = int(s.run, 'stairs.run', { min: 1, max: 8, def: 1 });
        const dir = String(s.dir || '+x');
        if (!['+x', '-x', '+z', '-z'].includes(dir)) throw new BuildError('stairs.dir is +x, -x, +z or -z');
        const v = value();
        const solid = s.solid !== false;
        for (let i = 0; i < steps; i++)
          for (let r = 0; r < runLen; r++)
            for (let wv = 0; wv < width; wv++)
              for (let y = solid ? 0 : i * rise; y < (i + 1) * rise; y++) {
                const along = i * runLen + r;
                const [x, z] = dir === '+x' ? [along, wv] : dir === '-x' ? [-along, wv] : dir === '+z' ? [wv, along] : [wv, -along];
                put(x, y, z, v, keep);
              }
        break;
      }
      case 'arch': {
        const s = (step.arch && typeof step.arch === 'object' ? step.arch : {}) as Record<string, unknown>;
        const width = int(s.width, 'arch.width', { min: 3, max: 256 });
        const height = int(s.height, 'arch.height', { min: 2, max: 256 });
        const thick = int(s.thickness, 'arch.thickness', { min: 1, max: 64, def: 1 });
        const depth = int(s.depth, 'arch.depth', { min: 1, max: 64, def: 1 });
        const axis = String(s.axis || 'x');
        const v = value();
        // a wall `width` wide and `height` high with a round-topped opening; centred on the spot, along `axis`
        const hw = width / 2;
        const inner = hw - thick;
        const spring = Math.max(0, height - thick - inner);
        for (let y = 0; y < height; y++)
          for (let a = 0; a < width; a++) {
            const ax = a - hw + 0.5;
            const inOpening = inner > 0 && (y < spring ? Math.abs(ax) < inner : (ax / inner) ** 2 + ((y - spring) / Math.max(1, inner)) ** 2 < 1);
            if (inOpening) continue;
            for (let dd = 0; dd < depth; dd++) put(axis === 'x' ? a - Math.floor(hw) : dd, y, axis === 'x' ? dd : a - Math.floor(hw), v, keep);
          }
        break;
      }
      case 'set': {
        if (!Array.isArray(step.set)) throw new BuildError('set is a list of [x, y, z]');
        if (step.set.length > LIMITS.setPoints) throw new BuildError(`at most ${LIMITS.setPoints} voxels in one set: use shapes or layers for more`);
        const v = value();
        for (const p of step.set) {
          const [x, y, z] = ivec(p, 'each point of set');
          put(x, y, z, v, keep);
        }
        break;
      }
      case 'layers': {
        if (!Array.isArray(step.layers)) throw new BuildError('layers is a list of layers (bottom first), each a list of rows');
        const key = (step.key && typeof step.key === 'object' ? step.key : {}) as Record<string, unknown>;
        const values = new Map<string, number>();
        for (const [ch, name] of Object.entries(key)) {
          if ([...ch].length !== 1) throw new BuildError(`key: "${ch}" must be one character`);
          values.set(ch, name === null || name === '' ? 0 : matIndex(name));
        }
        if (step.layers.length > LIMITS.reach * 2) throw new BuildError('too many layers');
        step.layers.forEach((layer, y) => {
          if (!Array.isArray(layer)) throw new BuildError(`layer ${y} must be a list of rows`);
          layer.forEach((row, z) => {
            if (typeof row !== 'string') throw new BuildError(`layer ${y}, row ${z} must be a string`);
            [...row].forEach((ch, x) => {
              if (ch === '.' || ch === ' ') return;
              const v = values.get(ch);
              if (v === undefined) throw new BuildError(`layer ${y}, row ${z}: "${ch}" isn't in key (use "." for empty)`);
              put(x, y, z, v, keep);
            });
          });
        });
        break;
      }
      case 'text': {
        const text = String(step.text ?? '').slice(0, 80);
        const scale = int(step.scale, 'scale', { min: 1, max: 8, def: 1 });
        const depth = int(step.depth, 'depth', { min: 1, max: 8, def: 1 });
        const facing = String(step.facing || '+z');
        if (!['+z', '-z', '+x', '-x'].includes(facing)) throw new BuildError('facing is +z, -z, +x or -x');
        const v = value();
        let col = 0;
        for (const ch of text) {
          const g = glyph(ch);
          if (g)
            for (let r = 0; r < GLYPH_H; r++)
              for (let c = 0; c < GLYPH_W; c++) {
                if (!g[r][c]) continue;
                for (let sy = 0; sy < scale; sy++)
                  for (let sx = 0; sx < scale; sx++)
                    for (let d = 0; d < depth; d++) {
                      const u = (col + c) * scale + sx;
                      const y = (GLYPH_H - 1 - r) * scale + sy;
                      // reads left to right for someone facing the sign
                      const [x, z] = facing === '+z' ? [u, d] : facing === '-z' ? [-u, -d] : facing === '+x' ? [d, -u] : [-d, u];
                      put(x, y, z, v, keep);
                    }
              }
          col += GLYPH_W + 1;
        }
        break;
      }
      case 'heightmap': {
        const h = (step.heightmap && typeof step.heightmap === 'object' ? step.heightmap : {}) as Record<string, unknown>;
        const fill = value();
        const top = step.top !== undefined ? matIndex(step.top) : fill;
        const heights: number[][] = [];
        if (Array.isArray(h.rows)) {
          // digits and letters: 0-9 then a-z (10-35)
          for (const row of h.rows) heights.push([...String(row)].map((ch) => (ch === '.' ? -1 : parseInt(ch, 36) * num(h.scale, 'heightmap.scale', { min: 0.1, max: 16, def: 1 }))));
        } else {
          const [w, d] = Array.isArray(h.size) ? [int(h.size[0], 'heightmap.size', { min: 1, max: 512 }), int(h.size[1], 'heightmap.size', { min: 1, max: 512 })] : [16, 16];
          const max = num(h.height, 'heightmap.height', { min: 0, max: 256, def: 6 });
          const cell = num(h.cell, 'heightmap.cell', { min: 2, max: 256, def: 12 });
          for (let z = 0; z < d; z++) {
            const row: number[] = [];
            for (let x = 0; x < w; x++) row.push(1 + valueNoise(x, z, cell, seed) * max);
            heights.push(row);
          }
        }
        heights.forEach((row, z) =>
          row.forEach((hgt, x) => {
            const n = Math.round(hgt);
            for (let y = 0; y < n; y++) put(x, y, z, y === n - 1 ? top : fill, keep);
          }),
        );
        break;
      }
      case 'replace': {
        const r = (step.replace && typeof step.replace === 'object' ? step.replace : {}) as Record<string, unknown>;
        const from = matIndex(r.from);
        const to = r.to === null || r.to === '' ? 0 : matIndex(r.to);
        const chance = num(r.chance, 'replace.chance', { min: 0, max: 1, def: 1 });
        // inside a box from the spot ("in": [w, h, d]), or the whole of this voxel size's grid
        const box = step.in !== undefined ? size3(step.in, 'in') : null;
        const visit = (x: number, y: number, z: number) => {
          tick();
          if (getAbs(x, y, z) !== from) return;
          if (chance < 1 && hash3(x, y, z, seed + 11) >= chance) return;
          setAbs(x, y, z, to);
        };
        if (box) for (let y = 0; y < box[1]; y++) for (let z = 0; z < box[2]; z++) for (let x = 0; x < box[0]; x++) visit(o[0] + x, o[1] + y, o[2] + z);
        else
          for (const [k, c] of [...grid.vol.chunks]) {
            const [cx, cy, cz] = k.split(',').map(Number);
            for (let i = 0; i < c.length; i++) if (c[i] === from) visit(cx * CHUNK + (i % CHUNK), cy * CHUNK + Math.floor(i / (CHUNK * CHUNK)), cz * CHUNK + (Math.floor(i / CHUNK) % CHUNK));
          }
        break;
      }
      case 'clear': {
        // everything at this voxel size in this object
        for (const [k, c] of [...grid.vol.chunks]) {
          const [cx, cy, cz] = k.split(',').map(Number);
          for (let i = 0; i < c.length; i++) if (c[i]) setAbs(cx * CHUNK + (i % CHUNK), cy * CHUNK + Math.floor(i / (CHUNK * CHUNK)), cz * CHUNK + (Math.floor(i / CHUNK) % CHUNK), 0);
        }
        break;
      }
      case 'scatter': {
        if (depth > 0) throw new BuildError("a scatter can't hold another scatter");
        const s = (step.scatter && typeof step.scatter === 'object' ? step.scatter : {}) as Record<string, unknown>;
        const count = int(s.count, 'scatter.count', { min: 1, max: LIMITS.scatter });
        const [w, d] = Array.isArray(s.area) ? [int(s.area[0], 'scatter.area', { min: 1, max: 512 }), int(s.area[1], 'scatter.area', { min: 1, max: 512 })] : [16, 16];
        const what = s.step;
        if (!what || typeof what !== 'object' || Array.isArray(what)) throw new BuildError('scatter.step is the step to repeat, e.g. {"tree": {"kind": "pine"}}');
        // each copy stands on the highest voxel of its column (or at the area's floor)
        const saved = cursor;
        for (let i = 0; i < count; i++) {
          const x = o[0] + Math.floor(random() * w);
          const z = o[2] + Math.floor(random() * d);
          let y = o[1];
          for (let yy = o[1] + 64; yy >= o[1] - 64; yy--)
            if (getAbs(x, yy, z)) {
              y = yy + 1;
              break;
            }
          cursor = [x * grid.voxelSize, y * grid.voxelSize, z * grid.voxelSize];
          const { at: _at, ...rest } = what as Step;
          run(rest, depth + 1);
        }
        cursor = saved;
        break;
      }
    }
  };

  try {
    if (input.drive) {
      let n = 0;
      input.drive({
        step: (s) => {
          if (++n > LIMITS.scriptSteps) throw new BuildError(`a script may run at most ${LIMITS.scriptSteps.toLocaleString('en-US')} steps; split the build`);
          if (!s || typeof s !== 'object' || Array.isArray(s)) throw new BuildError('a step must be an object like {"box": [4, 2, 4]}');
          run(s as Step, 0);
        },
        solid: (x, y, z) => solidAt(x, y, z),
        materialAt: (x, y, z) => {
          const v = getAbs(Math.floor(x / grid.voxelSize), Math.floor(y / grid.voxelSize), Math.floor(z / grid.voxelSize));
          return v ? palette[v - 1]?.name || null : null;
        },
        top: (x, z, fromY) => surfaceAt(x, z, fromY),
      });
    } else input.steps.forEach((s, i) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw new BuildError(`step ${i + 1} must be an object like {"box": [4, 2, 4]}`);
      try {
        run(s as Step, 0);
      } catch (e) {
        if (e instanceof BuildError && !e.message.startsWith('Step ')) {
          let name = Object.keys(s as Step)[0];
          try {
            name = verbOf(s as Step);
          } catch {
            /* an unknown step: its first key */
          }
          throw new BuildError(`Step ${i + 1} (${name}): ${e.message}`);
        }
        throw e;
      }
    });
  } catch (e) {
    // put every changed chunk back as it was
    for (const [g, chunks] of before) for (const [k, c] of chunks) c ? g.vol.chunks.set(k, c) : g.vol.chunks.delete(k);
    if (e instanceof BuildError) throw e;
    throw new BuildError(e instanceof Error ? e.message : String(e));
  }

  input.palette.splice(0, input.palette.length, ...palette);
  if (!added && !removed && !painted && !placed && !unplaced) notes.push('Nothing changed: every voxel was already like that.');
  return {
    added,
    removed,
    painted,
    grids,
    before: [...before].map(([g, chunks]) => ({ gridId: g.id, voxelSize: g.voxelSize, chunks: Object.fromEntries([...chunks].map(([k, c]) => [k, c ? encodeChunk(c) : null])) })),
    newMaterials,
    notes,
    instances,
    placed,
    unplaced,
  };
}

/** A list of points, each a list of numbers. */
function points(v: unknown, what: string, min: number): number[][] {
  if (!Array.isArray(v) || v.length < min) throw new BuildError(`${what} is a list of at least ${min} points`);
  if (v.length > LIMITS.points) throw new BuildError(`${what}: at most ${LIMITS.points} points`);
  return v.map((p, i) => {
    if (!Array.isArray(p) || p.length < 2 || p.length > 3) throw new BuildError(`${what}: point ${i + 1} must be [x, z] or [x, y, z]`);
    const out = p.map(Number);
    // (a point far out makes a shape too big to work out, or one whose loops never move on)
    if (out.some((n) => Math.abs(n) > LIMITS.pointReach)) throw new BuildError(`${what}: point ${i + 1} is more than ${LIMITS.pointReach} voxels from the spot`);
    return out;
  });
}

/** 0, 90, 180 or 270 degrees as quarter turns (0-3). */
function quarter(v: unknown, what: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || ((n % 90) + 90) % 90 !== 0) throw new BuildError(`${what} is 0, 90, 180 or 270`);
  return (((n / 90) % 4) + 4) % 4;
}

/** A cell (x, z) of a w×d box turned q quarter turns (like turnAround), as a cell of the turned box (corner kept at 0, 0). */
function turnQuarter(x: number, z: number, w: number, d: number, q: number): [number, number] {
  if (q === 1) return [z, w - 1 - x];
  if (q === 2) return [w - 1 - x, d - 1 - z];
  if (q === 3) return [d - 1 - z, x];
  return [x, z];
}

/** A point turned q quarter turns around the origin, the same way as turn in placing (+z towards +x). */
function turnAround(x: number, z: number, q: number): [number, number] {
  if (q === 1) return [z, -x];
  if (q === 2) return [-x, -z];
  if (q === 3) return [-z, x];
  return [x, z];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
