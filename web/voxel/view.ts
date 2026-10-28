// The Station in the voxel look: sky, fog, a sun with soft shadows, sky light from above and ground light
// from below, the finishing passes (web/voxel/post.ts), and voxel volumes drawn from the mesher. Glowing
// things light their surroundings (lights.ts), particles fill the air (effects.ts), and a change of time of
// day eases in (envblend.ts). The classic lights are hidden while it is on and come back when it is
// disposed, so the classic map is exactly as it was.
import * as THREE from 'three';
import { meshRegion } from './mesher.ts';
import type { MeshPart, ObjectPart, RenderClass } from './mesher.ts';
import { envPreset, sunDirection } from '../../shared/worldenv.ts';
import { createPost } from './post.ts';
import { fitCamera, renderSnapshot, snapCamera } from './snapshot.ts';
import { setPictureSource } from './picture.ts';
import type { Post } from './post.ts';
import { createVoxelMaterials, castsShadow, takesShadow } from './materials.ts';
import type { VoxelUniforms } from './materials.ts';
import { LightPool } from './lights.ts';
import type { LightCandidate } from './lights.ts';
import { EffectsLayer } from './effects.ts';
import type { EffectPlace, EffectSpec } from './effects.ts';
import { BLEND_MS, ease, lerpEnv } from './envblend.ts';
import { SlowWatch } from './quality.ts';
import { CHUNK, countVoxels, parseChunkKey } from '../../shared/voxel.ts';
import type { Vec3i, Volume } from '../../shared/voxel.ts';
import type { VoxelMaterial, WorldEnvironment, WorldQuality } from '../../shared/types.ts';

export interface VolumeStats {
  voxels: number;
  faces: number;
  meshes: number;
  /** time spent meshing, ms */
  ms: number;
}

export interface WorldView {
  /** `aimMs`: how long a frame is meant to take when the Station holds frames back (0: not held back) */
  render(aimMs?: number): void;
  setSize(w: number, h: number): void;
  setEnvironment(env: WorldEnvironment): void;
  readonly environment: WorldEnvironment;
  /** Shadows for the Station's own meshes, and the sun's shadow box and the fog fitted to the map's size. */
  adopt(world: THREE.Object3D, radius: number): void;
  addVolume(id: string, vol: Volume, palette: VoxelMaterial[], at: THREE.Vector3, region?: number): VolumeStats;
  /** Meshed parts (from the mesher or its worker) as one group under `id`, replacing what was there. */
  addParts(id: string, parts: ObjectPart[]): THREE.Group;
  /** The material voxels of a render class are drawn with (for instanced copies of prefabs). */
  material(cls: RenderClass): THREE.Material;
  /** Puts something made elsewhere (a skin: a character, a platform) in the voxel world, or takes it out (its geometry is the caller's). */
  addObject(o: THREE.Object3D): void;
  removeObject(o: THREE.Object3D): void;
  /** Where the lights could be (glow spots and builders' lights); asked again every so often and when `version` changes. */
  setLights(source: () => LightCandidate[], version: number): void;
  /** The effects to show, and where each is each frame. */
  setEffects(specs: EffectSpec[], place: EffectPlace): void;
  removeVolume(id: string): void;
  /** A picture for world_look (a JPEG data: URL) of what is in `box`; `only` is drawn alone (a prefab), in the world's light. */
  snapshot(o: SnapshotRequest): string;
  /** What you see now (your own camera, the screen's shape), `width` pixels wide, as a JPEG data: URL. */
  picture(width?: number): string;
  /** Frames per second over the next few seconds (and the slowest frame, ms). */
  measure(seconds: number): Promise<{ fps: number; worstMs: number; frames: number }>;
  dispose(): void;
}

export interface SnapshotRequest {
  box: THREE.Box3;
  /** degrees (default 45 / 35, the Station's angle) */
  azimuth?: number;
  elevation?: number;
  /** 1 fits the box */
  zoom?: number;
  width: number;
  height: number;
  only?: THREE.Object3D;
}

export interface WorldViewOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  quality: WorldQuality;
  /** the classic map's lights and floor dots: hidden while the voxel look is on */
  classic: THREE.Object3D[];
  w: number;
  h: number;
  env?: WorldEnvironment;
  /** frames stay too slow at this quality: the Station steps down a level for this visit */
  onSlow?: () => void;
}

const SHADOW_MAP: Record<WorldQuality, number> = { low: 0, medium: 2048, high: 4096 };
/** A light breeze when the world doesn't say (map units a second). */
const DEFAULT_WIND: [number, number, number] = [0.4, 0, 0.2];

/** A meshed part as geometry, in its region's voxels (place it with partMatrix). */
export function partGeometry(p: MeshPart): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(p.colors, 3, true));
  if (p.glow) geo.setAttribute('glow', new THREE.BufferAttribute(p.glow, 1, true));
  geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

/** Where a part's geometry sits in its object: its region's corner, at its voxel size. */
export const partMatrix = (p: Pick<ObjectPart, 'min' | 'voxelSize'>, out = new THREE.Matrix4()): THREE.Matrix4 =>
  out.makeScale(p.voxelSize, p.voxelSize, p.voxelSize).setPosition(p.min[0] * p.voxelSize, p.min[1] * p.voxelSize, p.min[2] * p.voxelSize);

/** The sky: a gradient on a small canvas, painted again (not made again) as the time of day eases. */
function skyTexture(): { tex: THREE.CanvasTexture; paint: (env: WorldEnvironment) => void } {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return {
    tex,
    paint(env) {
      if (!ctx) return;
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, env.sky.top);
      g.addColorStop(0.62, env.sky.horizon);
      g.addColorStop(1, env.sky.bottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 2, 256);
      tex.needsUpdate = true;
    },
  };
}

/** Every material in a scene recompiles (shadows were switched on or off). */
function recompile(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.needsUpdate = true;
  });
}

export function createWorldView(o: WorldViewOptions): WorldView {
  const { renderer, scene, camera, quality } = o;
  let env = o.env || envPreset('station');
  let radius = 40;
  const shadowSize = SHADOW_MAP[quality];

  for (const c of o.classic) c.visible = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = shadowSize > 0;
  // (soft through shadow.radius: three.js 0.18x dropped PCFSoftShadowMap)
  renderer.shadowMap.type = THREE.PCFShadowMap;
  recompile(scene);

  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = shadowSize > 0;
  if (shadowSize) {
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
  }
  const voxels = new THREE.Group();
  const pool = new LightPool(quality);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effects = new EffectsLayer(quality, reduced);
  scene.add(hemi, sun, sun.target, voxels, pool.group, effects.group);
  const sky = skyTexture();
  scene.background = sky.tex;

  const uniforms: VoxelUniforms = { time: { value: 0 }, wind: { value: new THREE.Vector3() } };
  const mats = createVoxelMaterials(uniforms);
  const clock = new THREE.Clock();
  const slow = o.onSlow ? new SlowWatch(quality) : null;

  let post: Post | null = quality === 'low' ? null : createPost(renderer, scene, camera, quality, o.w, o.h);

  const fit = () => {
    const [dx, dy, dz] = sunDirection(env.sun.azimuth, env.sun.elevation);
    const r = radius + 10;
    sun.position.set(dx * r * 2.5, dy * r * 2.5, dz * r * 2.5);
    sun.target.position.set(0, 0, 0);
    const cam = sun.shadow.camera;
    Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 5 });
    cam.updateProjectionMatrix();
    // the camera stands 300 from what it looks at: things behind that fade into the sky
    if (env.fog.density > 0.01) {
      const fog = scene.fog instanceof THREE.Fog ? scene.fog : (scene.fog = new THREE.Fog(0));
      fog.color.set(env.fog.color);
      fog.near = 300 + radius * 0.2;
      fog.far = 300 + radius * (1.4 + 5 * (1 - env.fog.density));
    } else scene.fog = null;
  };

  // what is shown now: while a new time of day eases in, part way from the old one
  let shown = env;
  let blend: { from: WorldEnvironment; to: WorldEnvironment; start: number } | null = null;
  const show = (e: WorldEnvironment) => {
    shown = e;
    sky.paint(e);
    hemi.color.set(e.ambient.sky);
    hemi.groundColor.set(e.ambient.ground);
    hemi.intensity = e.ambient.intensity;
    sun.color.set(e.sun.color);
    sun.intensity = e.sun.intensity;
    renderer.toneMappingExposure = e.exposure;
    post?.setLook({ bloom: e.bloom, tiltShift: e.tiltShift });
    uniforms.wind.value.set(...(e.wind || DEFAULT_WIND));
    fit();
  };
  const setEnvironment = (e: WorldEnvironment) => {
    if (JSON.stringify(e) === JSON.stringify(env)) return;
    // eases from what is shown now (even part way through another change)
    blend = reduced ? null : { from: shown, to: e, start: performance.now() };
    env = e;
    if (!blend) show(e);
  };
  show(env);

  const volumes = new Map<string, THREE.Group>();
  const removeVolume = (id: string) => {
    const g = volumes.get(id);
    if (!g) return;
    voxels.remove(g);
    g.traverse((n) => (n as THREE.Mesh).geometry?.dispose());
    volumes.delete(id);
  };
  // meshed parts → one group of meshes (replacing what was there under that id)
  const addParts = (id: string, parts: ObjectPart[]): THREE.Group => {
    removeVolume(id);
    const g = new THREE.Group();
    for (const p of parts) {
      const mesh = new THREE.Mesh(partGeometry(p), mats[p.cls]);
      mesh.position.set(p.min[0], p.min[1], p.min[2]).multiplyScalar(p.voxelSize);
      mesh.scale.setScalar(p.voxelSize);
      mesh.castShadow = castsShadow(p.cls);
      mesh.receiveShadow = takesShadow(p.cls);
      g.add(mesh);
    }
    voxels.add(g);
    volumes.set(id, g);
    return g;
  };

  // frame timing for measure()
  let frames: number[] | null = null;
  let last = 0;
  let lastFrame = 0;

  // lights: picked again when their source changes, now and then, and when the view moved
  let lightSource: () => LightCandidate[] = () => [];
  let lightVersion = -1;
  let picked = { version: -2, at: 0, x: NaN, z: NaN, r: NaN };
  const look = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const ortho = camera as THREE.OrthographicCamera;
  const viewRadius = () => (ortho.isOrthographicCamera ? (ortho.top - ortho.bottom) / 2 : 40);
  const lookAt = () => look.copy(camera.position).add(camera.getWorldDirection(dir).multiplyScalar(300));
  const pickLights = (now: number) => {
    const t = lookAt();
    const r = viewRadius();
    const moved = !(Math.hypot(t.x - picked.x, t.z - picked.z) <= r * 0.15) || !(Math.abs(r - picked.r) <= r * 0.15);
    if (picked.version === lightVersion && !moved && now - picked.at < 600) return;
    picked = { version: lightVersion, at: now, x: t.x, z: t.z, r };
    pool.assign(lightSource(), t, r);
  };

  // effects: the builders', and the weather around where you look
  let effectSpecs: EffectSpec[] = [];
  let effectPlace: EffectPlace = () => null;
  const weatherAt = new THREE.Matrix4();
  const weatherSize = () => Math.min(80, viewRadius() * 1.4);
  const applyEffects = () => {
    const w = env.weather && env.weather !== 'none' ? env.weather : null;
    const r = weatherSize();
    const weather: EffectSpec[] = w ? [{ key: `weather:${w}:${Math.round(r / 10)}`, kind: w, box: { w: r * 2, h: 26, d: r * 2 }, amount: 0.7 }] : [];
    effects.set([...effectSpecs, ...weather]);
  };
  const place: EffectPlace = (key) => {
    if (!key.startsWith('weather:')) return effectPlace(key);
    const t = lookAt();
    return weatherAt.makeTranslation(t.x, Math.max(0, t.y), t.z);
  };
  let weatherKey = '';

  const picture = (width = 1600): string => {
    const size = renderer.getSize(new THREE.Vector2());
    const w = Math.max(64, Math.min(2048, Math.round(width)));
    const h = Math.max(64, Math.min(2048, Math.round((w * (size.y || 1)) / (size.x || 1))));
    return renderSnapshot(renderer, scene, camera, w, h, shown.bloom);
  };
  const unregister = setPictureSource(picture);

  return {
    picture,
    get environment() {
      return env;
    },
    render(aimMs = 0) {
      const now = performance.now();
      if (frames) {
        if (last) frames.push(now - last);
        last = now;
      }
      if (lastFrame && slow?.frame(now - lastFrame, aimMs)) o.onSlow?.();
      lastFrame = now;
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = clock.elapsedTime;
      uniforms.time.value = t;
      if (blend) {
        const k = ease((now - blend.start) / BLEND_MS);
        show(lerpEnv(blend.from, blend.to, k));
        if (k >= 1) blend = null;
      }
      // the weather follows the view's size
      const wk = `${env.weather || 'none'}:${Math.round(weatherSize() / 10)}`;
      if (wk !== weatherKey) (weatherKey = wk), applyEffects();
      pickLights(now);
      pool.tick(t);
      const px = ortho.isOrthographicCamera ? (renderer.domElement.height || 1) / Math.max(1e-3, ortho.top - ortho.bottom) : 10;
      effects.update(dt, t, place, (shown.wind as [number, number, number] | undefined) || DEFAULT_WIND, px);
      if (post) post.render();
      else renderer.render(scene, camera);
    },
    setSize(w, h) {
      post?.setSize(w, h);
    },
    setEnvironment,
    adopt(world, r) {
      radius = Math.max(20, r);
      world.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh && m.material instanceof THREE.MeshStandardMaterial) m.castShadow = m.receiveShadow = true;
      });
      fit();
    },
    addVolume(id, vol, palette, at, region = 32) {
      const started = performance.now();
      const parts: ObjectPart[] = [];
      // the regions that hold any chunk
      const regions = new Set<string>();
      for (const k of vol.chunks.keys()) regions.add(parseChunkKey(k).map((c) => Math.floor((c * CHUNK) / region)).join(','));
      for (const key of regions) {
        const min = key.split(',').map((n) => Number(n) * region) as Vec3i;
        for (const [cls, p] of Object.entries(meshRegion(vol, min, [region, region, region], palette)) as [RenderClass, MeshPart][]) parts.push({ ...p, cls, voxelSize: vol.voxelSize, min });
      }
      const g = addParts(id, parts);
      g.position.copy(at);
      return { voxels: countVoxels(vol), faces: parts.reduce((n, p) => n + p.faces, 0), meshes: g.children.length, ms: Math.round(performance.now() - started) };
    },
    addParts,
    material: (cls) => mats[cls],
    addObject: (obj) => voxels.add(obj),
    removeObject: (obj) => voxels.remove(obj),
    setLights(source, version) {
      lightSource = source;
      lightVersion = version;
    },
    setEffects(specs, where) {
      effectSpecs = specs;
      effectPlace = where;
      applyEffects();
    },
    removeVolume,
    snapshot(s) {
      const w = Math.max(64, Math.min(2048, Math.round(s.width) || 1024));
      const h = Math.max(64, Math.min(2048, Math.round(s.height) || 640));
      const f = fitCamera(s.box, s.azimuth ?? 45, s.elevation ?? 35, s.zoom ?? 1, w / h);
      // drawn alone: everything else (but the lights) off for this one picture
      const off: THREE.Object3D[] = [];
      if (s.only) {
        for (const c of scene.children) if (c.visible && !(c as THREE.Light).isLight) (c.visible = false), off.push(c);
        scene.add(s.only);
      }
      // the glowing things near what it shows light it, not the ones near your view
      pool.assign(lightSource(), f.target, Math.max(f.halfWidth, f.halfHeight));
      pool.tick(clock.elapsedTime);
      try {
        return renderSnapshot(renderer, scene, snapCamera(f), w, h, shown.bloom);
      } finally {
        for (const c of off) c.visible = true;
        if (s.only) scene.remove(s.only);
        // (your view's lights again on the next frame)
        picked.version = -2;
      }
    },
    async measure(seconds) {
      // a second to settle first: the first frames compile shaders
      await new Promise((r) => setTimeout(r, 1000));
      frames = [];
      last = 0;
      await new Promise((r) => setTimeout(r, seconds * 1000));
      const f = frames || [];
      frames = null;
      const total = f.reduce((a, b) => a + b, 0);
      return { fps: total ? Math.round((f.length / total) * 10000) / 10 : 0, worstMs: Math.round(Math.max(0, ...f)), frames: f.length };
    },
    dispose() {
      unregister();
      for (const id of [...volumes.keys()]) removeVolume(id);
      scene.remove(hemi, sun, sun.target, voxels, pool.group, effects.group);
      sun.shadow.map?.dispose();
      for (const m of Object.values(mats)) m.dispose();
      pool.dispose();
      effects.dispose();
      post?.dispose();
      post = null;
      sky.tex.dispose();
      scene.background = null;
      scene.fog = null;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.shadowMap.enabled = false;
      for (const c of o.classic) c.visible = true;
      recompile(scene);
    },
  };
}
