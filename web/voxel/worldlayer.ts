// The project's voxel world on the Station: loads the world it shows (GET /api/world), meshes each object
// in a worker, keeps every object on what it is pinned to (a team's platform moves when dragged), and
// reloads what changed when the server says the world changed.
// Prefab copies placed in an object are drawn as instances: each prefab variant (mirrored, materials
// swapped) is meshed once and repeated on the GPU, so a crowd of hundreds costs a few draw calls.
// It also tells the view where light comes from (spots of glowing voxels in objects and in every copy, and
// the lights builders put up) and which effects to show where.
import * as THREE from 'three';
import { GET, POST } from '../client/http.ts';
import { serverUrl } from '../client/connection.ts';
import { meshObject } from './mesher.ts';
import type { ObjectPart, RenderClass } from './mesher.ts';
import { partGeometry, partMatrix } from './view.ts';
import { glowStrength, reachOf } from './lights.ts';
import type { LightCandidate } from './lights.ts';
import { castsShadow, takesShadow } from './materials.ts';
import { LIGHT_STRIDE } from './mesher.ts';
import type { EffectSpec } from './effects.ts';
import type { WorldView } from './view.ts';
import { expandInstances, mirrorData, reachablePrefabs, swapPalette, variantKey } from './instances.ts';
import { SkinLayer } from './skins.ts';
import type { SkinGlow, SkinHost } from './skins.ts';
import { BuildFx } from './buildfx.ts';
import type { FlatCopy, Variant } from './instances.ts';
import { envPreset } from '../../shared/worldenv.ts';
import type { ShownWorld, VoxelMaterial, VoxelObjectData, VoxelObjectMeta, VoxelPrefabMeta, VoxelWorld, WorldAnchor, WorldBuilder, WorldEffect, WorldLight, WorldLookView } from '../../shared/types.ts';

/** Where an anchor is on the map now (null: not in this project, e.g. another project's team). */
export type AnchorAt = (a: WorldAnchor) => THREE.Vector3 | null;

export interface WorldLayer {
  /** what GET /api/world said last */
  readonly shown: ShownWorld | null;
  /** load again what changed (debounced); a build event also plays the build where it happened */
  refresh(ev?: WorldEventInfo): void;
  /** a 'world-look' request: a picture for world_look, posted back when this tab shows that world */
  look(req: WorldLookRequest): Promise<boolean>;
  /** follow anchors (each frame) */
  update(): void;
  /** how far the world reaches from the middle (map units), for fitting the view */
  radius(): number;
  /** plays an animation clip on an agent's character (a 'world-anim' event) */
  play(agentId: string, clip: string, times?: number): boolean;
  dispose(): void;
}

/** A 'world' event: a build carries { world, objects, builder, added, placed } (server/voxel/build.ts). */
export type WorldEventInfo = Record<string, unknown>;
/** A 'world-look' event: { request, world, view }. */
export type WorldLookRequest = Record<string, unknown>;

/** Answers from GET /api/world. */
type ShownWithName = ShownWorld & { fromProjectName?: string };

// One worker for the page; jobs answered in any order.
let worker: Worker | null = null;
let workerBroken = false;
let jobs = 0;
const waiting = new Map<number, { ok: (p: ObjectPart[]) => void; fail: (e: Error) => void }>();
function meshInWorker(data: VoxelObjectData, palette: VoxelMaterial[]): Promise<ObjectPart[]> {
  if (!worker && !workerBroken && typeof Worker === 'function') {
    try {
      worker = new Worker(serverUrl('/dist/voxel/mesh.worker.js'), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ job: number; parts?: ObjectPart[]; error?: string }>) => {
        const w = waiting.get(e.data.job);
        waiting.delete(e.data.job);
        if (e.data.error || !e.data.parts) w?.fail(new Error(e.data.error || 'meshing failed'));
        else w?.ok(e.data.parts);
      };
      worker.onerror = () => {
        // (no worker file, e.g. a dev build without it): mesh here instead from now on
        workerBroken = true;
        worker = null;
        for (const w of waiting.values()) w.fail(new Error('worker'));
        waiting.clear();
      };
    } catch {
      workerBroken = true;
    }
  }
  // (the worker only needs the voxels, not the copies placed in them)
  const voxelsOnly: VoxelObjectData = { volumes: data.volumes || [] };
  if (!worker) return Promise.resolve(meshObject(voxelsOnly, palette));
  const job = ++jobs;
  return new Promise<ObjectPart[]>((ok, fail) => {
    waiting.set(job, { ok, fail });
    worker!.postMessage({ job, data: voxelsOnly, palette, region: 32 });
  }).catch(() => meshObject(voxelsOnly, palette));
}

/** A prefab variant, meshed: its parts as shared geometry, and how many objects use it now. */
interface PrefabMesh {
  parts: { geo: THREE.BufferGeometry; cls: RenderClass; local: THREE.Matrix4; lights?: Float32Array; voxelSize: number }[];
  users: number;
}

/** A spot of glowing voxels, in its object's own space. */
interface GlowSpot {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  strength: number;
}

/** Glow spots of meshed parts, through a matrix (the part's place, and a copy's). */
function glowSpots(lights: Float32Array | undefined, voxelSize: number, m: THREE.Matrix4, out: GlowSpot[], v = new THREE.Vector3()): void {
  if (!lights) return;
  for (let i = 0; i + LIGHT_STRIDE <= lights.length; i += LIGHT_STRIDE) {
    v.set(lights[i], lights[i + 1], lights[i + 2]).applyMatrix4(m);
    // colour from sRGB to linear light
    out.push({ x: v.x, y: v.y, z: v.z, r: lights[i + 3] ** 2.2, g: lights[i + 4] ** 2.2, b: lights[i + 5] ** 2.2, strength: glowStrength(lights[i + 6], voxelSize) });
  }
}

/** An object on the map. */
interface Placed {
  meta: VoxelObjectMeta;
  /** the palette its voxels were coloured with */
  palette: string;
  group: THREE.Group;
  data: VoxelObjectData;
  /** the prefabs (and their versions) its copies were drawn from */
  copiesKey: string;
  copies: THREE.InstancedMesh[];
  meshKeys: string[];
  /** glowing spots of its own voxels and of its copies */
  glow: GlowSpot[];
  copyGlow: GlowSpot[];
}

const stampOf = (p: VoxelPrefabMeta) => p.voxelsAt ?? p.updatedAt;

export function createWorldLayer(view: WorldView, anchorAt: AnchorAt, host?: SkinHost, onShown?: (s: ShownWithName) => void): WorldLayer {
  let shown: ShownWithName | null = null;
  let alive = true;
  const placed = new Map<string, Placed>();
  /** prefab voxels, by id, with the version they are */
  const prefabData = new Map<string, { stamp: number; data: VoxelObjectData }>();
  /** meshed prefab variants, by prefab id, version, variant and palette */
  const prefabMeshes = new Map<string, PrefabMesh>();
  let envKey = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loading: Promise<void> | null = null;
  let again = false;
  let worldId = '';
  const groupId = (m: VoxelObjectMeta) => `world:${worldId}:${m.id}`;
  /** the world shown now, its prefabs by id, and its palette's fingerprint */
  let world: VoxelWorld | null = null;
  let prefabs = new Map<string, VoxelPrefabMeta>();
  let paletteKey = '';
  const stale = (wid: string) => !alive || worldId !== wid;

  // the voxels of these prefabs and every prefab they hold (nested ones too), each loaded once
  const loadPrefabs = async (instances: { prefab: string }[] | undefined): Promise<void> => {
    const wid = worldId;
    for (let round = 0; round < 5; round++) {
      const missing = [...reachablePrefabs(instances as VoxelObjectData['instances'], (id) => prefabData.get(id)?.data)].filter((id) => prefabs.has(id) && !prefabData.has(id));
      if (!missing.length) return;
      await Promise.all(
        missing.map(async (id) => {
          const d = await GET<VoxelObjectData>(`/worlds/${wid}/prefabs/${id}`).catch(() => null);
          const pm = prefabs.get(id);
          if (d && pm && !stale(wid)) prefabData.set(id, { stamp: stampOf(pm), data: d });
        }),
      );
      if (stale(wid)) return;
    }
  };
  // a prefab variant, meshed (once for every object and skin that uses it)
  const variantMesh = async (id: string, v: Variant, key: string): Promise<PrefabMesh | null> => {
    const hit = prefabMeshes.get(key);
    if (hit) return hit;
    const d = prefabData.get(id)?.data;
    const w = world;
    if (!d || !w) return null;
    const wid = worldId;
    const parts = await meshInWorker(v.mirror ? mirrorData(d) : d, swapPalette(w.palette, v.swap));
    if (stale(wid)) return null;
    // (another object meshed the same variant meanwhile)
    const raced = prefabMeshes.get(key);
    if (raced) return raced;
    const pm: PrefabMesh = { parts: parts.map((p) => ({ geo: partGeometry(p), cls: p.cls, local: partMatrix(p), lights: p.lights, voxelSize: p.voxelSize })), users: 0 };
    prefabMeshes.set(key, pm);
    return pm;
  };
  const meshKeyOf = (id: string, v: Variant) => `${id}@${prefabs.has(id) ? stampOf(prefabs.get(id)!) : 'gone'}|${variantKey(v)}|${paletteKey}`;

  // skins: the Brain, platforms and agents dressed as prefabs (when the Station says what it shows)
  const skins = host
    ? new SkinLayer(view, host, {
        world: () => world,
        loadPrefabs: (ids) => loadPrefabs(ids.map((prefab) => ({ prefab }))),
        lookup: (id) => {
          const meta = prefabs.get(id);
          const d = prefabData.get(id);
          return meta && d ? { data: d.data, pivot: meta.pivot } : null;
        },
        mesh: async (id, v) => {
          const key = meshKeyOf(id, v);
          const pm = await variantMesh(id, v, key);
          if (!pm) return null;
          pm.users++;
          return { key, parts: pm.parts };
        },
        release: (key) => {
          const pm = prefabMeshes.get(key);
          if (pm) pm.users--;
        },
        changed: () => lightsChanged(),
      })
    : null;

  // ---------- builds, as they happen ----------
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fx = new BuildFx(reduced);
  view.addObject(fx.group);
  /** builds the server told us about, waiting for their meshes: object id → who built it */
  const pendingBuilds = new Map<string, WorldBuilder | null>();
  /** objects whose build plays on the next frame (once their place on the map is known) */
  const playBuilds: { id: string; by: WorldBuilder | null }[] = [];


  // ---------- light and effects ----------
  let lights: WorldLight[] = [];
  let lightVersion = 0;
  const lightsChanged = () => view.setLights(candidates, ++lightVersion);
  const tmp = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  /** Where something placed like a light or an effect is: its object's frame, or its anchor's. Null: not here. */
  const frameOf = (x: { anchor: WorldAnchor; object?: string }, out: THREE.Matrix4): THREE.Matrix4 | null => {
    if (x.object) {
      const p = placed.get(x.object);
      if (!p) return null;
      p.group.updateWorldMatrix(true, false);
      return out.copy(p.group.matrixWorld);
    }
    const a = anchorAt(x.anchor);
    return a ? out.makeTranslation(a.x, a.y, a.z) : null;
  };
  const skinGlow: SkinGlow[] = [];
  function candidates(): LightCandidate[] {
    const out: LightCandidate[] = [];
    let seed = 0;
    // glowing voxels of skins (a crystal agent, a brazier hub) light things too
    skinGlow.length = 0;
    skins?.glow(skinGlow);
    for (const g of skinGlow) out.push({ x: g.x, y: g.y, z: g.z, r: g.r, g: g.g, b: g.b, strength: g.strength, range: reachOf(g.strength), flicker: 0, seed: seed++ });
    for (const p of placed.values()) {
      p.group.updateWorldMatrix(true, false);
      const m = p.group.matrixWorld;
      for (const list of [p.glow, p.copyGlow])
        for (const g of list) {
          tmp.set(g.x, g.y, g.z).applyMatrix4(m);
          out.push({ x: tmp.x, y: tmp.y, z: tmp.z, r: g.r, g: g.g, b: g.b, strength: g.strength, range: reachOf(g.strength), flicker: 0, seed: seed++ });
        }
    }
    const c = new THREE.Color();
    for (const l of lights) {
      const f = frameOf(l, tmpM);
      if (!f) continue;
      tmp.set(...l.position).applyMatrix4(f);
      c.set(l.color);
      const cand: LightCandidate = { x: tmp.x, y: tmp.y, z: tmp.z, r: c.r, g: c.g, b: c.b, strength: Math.max(0, Math.min(10, l.intensity)), range: l.range > 0 ? l.range : reachOf(l.intensity), flicker: l.flicker || 0, seed: seed++ };
      if (l.kind === 'spot') {
        const t = l.target ? new THREE.Vector3(...l.target).applyMatrix4(f) : new THREE.Vector3(tmp.x, tmp.y - 1, tmp.z);
        cand.spot = { x: t.x, y: t.y, z: t.z, angle: l.angle || 30 };
      }
      out.push(cand);
    }
    return out;
  }
  let effectList: WorldEffect[] = [];
  const effectMatrix = new THREE.Matrix4();
  const setEffects = (list: WorldEffect[]) => {
    effectList = list;
    const specs: EffectSpec[] = list.map((e) => ({ key: `${e.id}:${JSON.stringify([e.kind, e.size, e.amount, e.colors, e.wind])}`, kind: e.kind, box: { w: Math.max(0.5, e.size[0]), h: Math.max(0.5, e.size[1]), d: Math.max(0.5, e.size[2]) }, amount: e.amount, colors: e.colors, wind: e.wind }));
    view.setEffects(specs, (key) => {
      const e = effectList.find((x) => key.startsWith(`${x.id}:`));
      const f = e ? frameOf(e, effectMatrix) : null;
      return e && f ? f.multiply(tmpM.makeTranslation(...e.position)) : null;
    });
  };

  const freeUnused = () => {
    for (const [k, pm] of prefabMeshes) {
      if (pm.users > 0) continue;
      for (const part of pm.parts) part.geo.dispose();
      prefabMeshes.delete(k);
    }
  };
  /** Takes an object's copies off the map (their geometry stays while other objects use it). */
  const dropCopies = (p: Placed) => {
    for (const m of p.copies) {
      p.group.remove(m);
      m.dispose();
    }
    for (const k of p.meshKeys) {
      const pm = prefabMeshes.get(k);
      if (pm) pm.users--;
    }
    p.copies = [];
    p.meshKeys = [];
    p.copiesKey = '';
    p.copyGlow = [];
  };
  const dropObject = (p: Placed) => {
    // (copies first: removeVolume disposes the geometry of what is left in the group)
    dropCopies(p);
    view.removeVolume(groupId(p.meta));
  };
  const dropAll = () => {
    for (const p of placed.values()) dropObject(p);
    placed.clear();
    freeUnused();
    prefabData.clear();
  };

  async function load(): Promise<void> {
    const s = await GET<ShownWithName>('/world').catch(() => null);
    if (!alive || !s) return;
    shown = s;
    onShown?.(s);
    const w = s.world;
    // another world (or none): start over
    if (!w || w.id !== worldId) {
      dropAll();
      worldId = w?.id || '';
    }
    const env = w?.environment || envPreset('station');
    const ek = JSON.stringify(env);
    if (ek !== envKey) {
      envKey = ek;
      view.setEnvironment(env);
    }
    lights = w?.lights || [];
    setEffects(w?.effects || []);
    lightsChanged();
    if (!w) {
      // the world is gone: its skins come off too (and what they hid comes back)
      world = null;
      prefabs = new Map();
      await skins?.sync();
      return;
    }
    const wid = w.id;
    world = w;
    prefabs = new Map((w.prefabs || []).map((p) => [p.id, p]));
    const want = new Map(w.objects.filter((o) => !o.hidden).map((o) => [o.id, o]));
    for (const [id, p] of placed) if (!want.has(id)) (dropObject(p), placed.delete(id));
    // prefabs that were deleted or changed: their voxels are loaded again when needed
    for (const [id, d] of prefabData) {
      const pm = prefabs.get(id);
      if (!pm || stampOf(pm) !== d.stamp) prefabData.delete(id);
    }
    const palette = JSON.stringify(w.palette);
    paletteKey = hashText(palette);
    const stale = () => !alive || worldId !== wid;
    // which prefabs (and versions) an object's copies come from: when this changes, they are drawn again
    const copiesKeyOf = (data: VoxelObjectData) =>
      `${[...reachablePrefabs(data.instances, (id) => prefabData.get(id)?.data)]
        .sort()
        .map((id) => `${id}@${prefabs.has(id) ? stampOf(prefabs.get(id)!) : 'gone'}`)
        .join(',')}#${data.instances?.length || 0}`;


    const drawCopies = async (p: Placed): Promise<void> => {
      dropCopies(p);
      await loadPrefabs(p.data.instances);
      if (stale()) return;
      const flat = expandInstances(p.data.instances, (id) => {
        const meta = prefabs.get(id);
        const d = prefabData.get(id);
        return meta && d ? { data: d.data, pivot: meta.pivot } : null;
      });
      // the copies of each prefab variant together: one instanced mesh per part
      const byVariant = new Map<string, FlatCopy[]>();
      for (const c of flat) {
        const k = meshKeyOf(c.prefab, c.variant);
        const list = byVariant.get(k);
        if (list) list.push(c);
        else byVariant.set(k, [c]);
      }
      const m = new THREE.Matrix4();
      for (const [k, copies] of byVariant) {
        const pm = await variantMesh(copies[0].prefab, copies[0].variant, k);
        if (stale()) return;
        if (!pm) continue;
        pm.users++;
        p.meshKeys.push(k);
        for (const part of pm.parts) {
          const mesh = new THREE.InstancedMesh(part.geo, view.material(part.cls), copies.length);
          copies.forEach((c, i) => {
            mesh.setMatrixAt(i, m.multiplyMatrices(c.matrix, part.local));
            glowSpots(part.lights, part.voxelSize * c.matrix.getMaxScaleOnAxis(), m, p.copyGlow);
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
          mesh.castShadow = castsShadow(part.cls);
          mesh.receiveShadow = takesShadow(part.cls);
          p.group.add(mesh);
          p.copies.push(mesh);
        }
      }
      p.copiesKey = copiesKeyOf(p.data);
      lightsChanged();
    };

    for (const o of want.values()) {
      const p = placed.get(o.id);
      // its voxels and their colours are as meshed: at most its copies' prefabs changed
      if (p && p.palette === palette && p.meta.voxelsAt === o.voxelsAt && (p.meta.instances || 0) === (o.instances || 0) && JSON.stringify(p.meta.volumes) === JSON.stringify(o.volumes)) {
        p.meta = o;
        await loadPrefabs(p.data.instances);
        if (stale()) return;
        if (copiesKeyOf(p.data) !== p.copiesKey) await drawCopies(p);
        if (stale()) return;
        continue;
      }
      const data = await GET<VoxelObjectData>(`/worlds/${wid}/objects/${o.id}`).catch(() => null);
      if (stale()) return;
      if (!data) continue;
      const parts = await meshInWorker(data, w.palette);
      if (stale()) return;
      // (its old copies come off before addParts replaces the group and disposes what's in it)
      if (p) dropCopies(p);
      const glow: GlowSpot[] = [];
      const pm = new THREE.Matrix4();
      for (const part of parts) glowSpots(part.lights, part.voxelSize, partMatrix(part, pm), glow);
      const np: Placed = { meta: o, palette, group: view.addParts(groupId(o), parts), data, copiesKey: '', copies: [], meshKeys: [], glow, copyGlow: [] };
      placed.set(o.id, np);
      // a new object from a live build grows from its first frame on the map
      if (!p && pendingBuilds.has(o.id)) fx.grow(np.group, performance.now());
      lightsChanged();
      if (data.instances?.length) await drawCopies(np);
      if (stale()) return;
    }
    await skins?.sync();
    freeUnused();
    // the builds this load drew: played on the next frame, where they stand
    for (const [id, by] of pendingBuilds) {
      if (!placed.has(id)) continue;
      playBuilds.push({ id, by });
      pendingBuilds.delete(id);
    }
  }

  /** Where a builder is on the map: its desk (an agent) or the Brain; null when it isn't here (you, another project's agent). */
  const builderAt = (by: WorldBuilder | null, out: THREE.Vector3): THREE.Vector3 | null => {
    if (!by || !host) return null;
    if (by.kind === 'brain') {
      const b = host.brain();
      return b ? b.anchor.getWorldPosition(out).add(tmp.set(0, 5, 0)) : null;
    }
    if (by.kind === 'agent' && by.id) {
      const a = host.agents().find((x) => x.agentId === by.id);
      return a ? a.anchor.getWorldPosition(out).add(tmp.set(0, 2.2, 0)) : null;
    }
    return null;
  };
  const fxFrom = new THREE.Vector3();
  const fxTo = new THREE.Vector3();
  const fxBox = new THREE.Box3();

  // ---------- pictures for world_look ----------
  const lookBox = (v: WorldLookView, box: THREE.Box3): THREE.Box3 => {
    box.makeEmpty();
    const add = (o: THREE.Object3D | null | undefined) => {
      if (!o) return;
      o.updateWorldMatrix(true, true);
      box.expandByObject(o);
    };
    if (v.target === 'object' && v.id) add(placed.get(v.id)?.group);
    else if (v.target === 'brain') {
      add(host?.brain()?.anchor);
      skins?.boundsOf('brain', 'brain', box);
    } else if (v.target === 'team' && v.id) {
      add(host?.team(v.id)?.anchor);
      skins?.boundsOf('team', v.id, box);
    } else if (v.target === 'agent' && v.id) {
      for (const a of host?.agents() || []) if (a.agentId === v.id) add(a.anchor);
      skins?.boundsOf('agent', v.id, box);
    } else {
      // the whole world, and the Station on it (with its skins: a big character can reach past its desk)
      for (const p of placed.values()) add(p.group);
      add(host?.brain()?.anchor);
      for (const a of host?.agents() || []) add(a.anchor);
      skins?.boundsOfAll(box);
    }
    return box;
  };

  const run = () => {
    if (loading) {
      again = true;
      return;
    }
    loading = load()
      .catch(() => {})
      .finally(() => {
        loading = null;
        if (again && alive) {
          again = false;
          run();
        }
      });
  };
  run();
  // a refresh still waiting, or a load going on, lands first (world_look right after a build sees it)
  const settled = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      run();
    }
    while (loading) await loading;
  };

  // (reused every frame)
  const fallback = new THREE.Vector3();
  const box = new THREE.Box3();
  return {
    get shown() {
      return shown;
    },
    refresh(ev) {
      // a build in the world shown: remember it, so it plays once its meshes are in
      if (ev && ev.world === worldId && Array.isArray(ev.objects)) {
        const by = ev.builder && typeof ev.builder === 'object' ? (ev.builder as WorldBuilder) : null;
        const changed = Number(ev.added) > 0 || Number(ev.placed) > 0;
        if (changed) for (const id of ev.objects) if (typeof id === 'string') pendingBuilds.set(id, by);
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, 120);
    },
    async look(req) {
      const v = req.view as WorldLookView | undefined;
      if (typeof req.request !== 'string' || !v || typeof v !== 'object') return false;
      await settled();
      if (!alive || !worldId || req.world !== worldId) return false;
      let only: { group: THREE.Group; release: () => void } | null = null;
      try {
        const box = new THREE.Box3();
        if (v.target === 'prefab' && v.id) {
          only = (await skins?.standalone(v.id)) || null;
          if (!only) return false;
          only.group.updateWorldMatrix(true, true);
          box.setFromObject(only.group);
        } else lookBox(v, box);
        if (box.isEmpty()) return false;
        const image = view.snapshot({ box, azimuth: v.azimuth, elevation: v.elevation, zoom: v.zoom, width: v.width || 1024, height: v.height || 640, only: only?.group });
        await POST(`/world/snapshot/${encodeURIComponent(req.request)}`, { image });
        return true;
      } catch {
        return false;
      } finally {
        only?.release();
        freeUnused();
      }
    },
    update() {
      const now = performance.now();
      for (const p of placed.values()) {
        const m = p.meta;
        // pinned to something this project doesn't have: where it last stood, or from the middle
        const base = anchorAt(m.anchor) || (m.lastWorldPos ? fallback.set(m.lastWorldPos[0] - m.position[0], m.lastWorldPos[1] - m.position[1], m.lastWorldPos[2] - m.position[2]) : fallback.set(0, 0, 0));
        p.group.position.set(base.x + m.position[0], base.y + m.position[1], base.z + m.position[2]);
        p.group.rotation.y = (m.rotation * Math.PI) / 180;
        p.group.scale.setScalar(m.scale || 1);
        // a new object grows up out of the ground
        p.group.scale.y *= fx.heightOf(p.group, now);
      }
      skins?.update();
      // builds that just came in: an arc from the builder to what it built, a puff there
      while (playBuilds.length) {
        const b = playBuilds.shift()!;
        const p = placed.get(b.id);
        if (!p) continue;
        p.group.updateWorldMatrix(true, true);
        fxBox.setFromObject(p.group);
        if (fxBox.isEmpty()) continue;
        fxBox.getCenter(fxTo);
        fxTo.y = fxBox.max.y;
        fx.built(builderAt(b.by, fxFrom), fxTo, b.by?.kind === 'brain' ? '#ffd36e' : '#c4ff3d', now);
      }
      fx.update(now);
    },
    radius() {
      let r = 0;
      for (const p of placed.values()) {
        box.setFromObject(p.group);
        if (!box.isEmpty()) r = Math.max(r, Math.hypot(box.min.x, box.min.z), Math.hypot(box.max.x, box.max.z));
      }
      return r;
    },
    play(agentId, clip, times = 1) {
      return skins?.play(agentId, clip.trim().toLowerCase(), times) ?? false;
    },
    dispose() {
      alive = false;
      if (timer) clearTimeout(timer);
      skins?.dispose();
      view.removeObject(fx.group);
      fx.dispose();
      dropAll();
      view.setLights(() => [], ++lightVersion);
      view.setEffects([], () => null);
    },
  };
}

/** A short fingerprint of a text (the palette), for cache keys. */
function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${s.length}:${(h >>> 0).toString(36)}`;
}
