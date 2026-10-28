// Lights, effects and the environment of a world: what builders put up besides voxels. Glowing voxels light
// their surroundings by themselves (the page does that); these are the extra lights, the particles (petals,
// snow, fireflies, smoke…) and the time of day, sky, fog, weather and wind.
import { activeProject } from '../store.ts';
import { uid } from '../util.ts';
import { envPreset, ENV_PRESETS } from '../../shared/worldenv.ts';
import { saveWorld } from './store.ts';
import { changeWorld } from './link.ts';
import { anchorText, cleanAnchor, findObject, remember } from './build.ts';
import type { Vec3, VoxelWorld, WorldBuilder, WorldEffect, WorldEffectKind, WorldEnvironment, WorldEnvPreset, WorldLight } from '../../shared/types.ts';

export const SCENE_LIMITS = { lights: 32, effects: 24 };
export const EFFECT_KINDS: WorldEffectKind[] = ['petals', 'leaves', 'snow', 'rain', 'fireflies', 'embers', 'sparks', 'smoke', 'steam', 'mist', 'dust', 'birds'];
const WEATHER = ['none', 'snow', 'rain', 'petals', 'leaves', 'dust'] as const;

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const num = (v: unknown, what: string, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${what} must be a number`);
  return Math.max(min, Math.min(max, n));
};
const hex = (v: unknown, what: string): string => {
  const s = String(v ?? '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(s)) throw bad(`${what} must be a colour like #ffcf7a`);
  return s;
};
const vec = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => !Number.isFinite(Number(n)))) throw bad(`${what} must be [x, y, z] in map units`);
  return v.map((n) => Math.max(-2000, Math.min(2000, Number(n)))) as Vec3;
};

function byRef<T extends { id: string; name: string }>(list: T[], ref: unknown): T | null {
  const r = String(ref ?? '').trim().toLowerCase();
  return r ? list.find((x) => x.id === r) || list.find((x) => x.name.toLowerCase() === r) || null : null;
}

/** The fields lights and effects share: name, where, pinned to what. */
function place<T extends { name: string; anchor: WorldLight['anchor']; object?: string; position: Vec3 }>(w: VoxelWorld, item: T, f: Record<string, unknown>): void {
  if (f.name !== undefined) item.name = String(f.name).trim().slice(0, 80) || item.name;
  if (f.anchor !== undefined) item.anchor = cleanAnchor(f.anchor);
  if (f.object !== undefined) {
    if (f.object === null || f.object === '') delete item.object;
    else {
      const o = findObject(w, f.object);
      if (!o) throw bad(`There's no object "${f.object}" to pin it to.`);
      item.object = o.id;
    }
  }
  if (f.position !== undefined) item.position = vec(f.position, 'position');
}

const where = (w: VoxelWorld, x: { anchor: WorldLight['anchor']; object?: string; position: Vec3 }) => `at ${x.position.join(', ')} from ${x.object ? `the object "${w.objects.find((o) => o.id === x.object)?.name || x.object}"` : anchorText(x.anchor)}`;

// ---------- lights ----------
export interface LightRequest {
  by: WorldBuilder;
  action: 'add' | 'change' | 'remove';
  light?: string;
  fields?: Record<string, unknown>;
  project?: string;
}

export function setLight(req: LightRequest): { world: VoxelWorld; light: WorldLight | null; text: string } {
  return changeWorld(req.project || activeProject().id, (w) => setLightIn(w, req));
}

function setLightIn(w: VoxelWorld, req: LightRequest): { world: VoxelWorld; light: WorldLight | null; text: string } {
  const f = req.fields || {};
  const existing = req.action === 'add' ? null : byRef(w.lights, req.light);
  if (req.action !== 'add' && !existing) throw bad(`There's no light "${req.light}". world_info lists them.`, 404);
  if (req.action === 'remove') {
    w.lights = w.lights.filter((l) => l.id !== existing!.id);
    remember(w.id, { by: req.by, kind: 'light', what: `took the light ${existing!.name} away`, objectId: existing!.id, metaBefore: null, sceneBefore: existing });
    saveWorld(w, { lights: true, by: req.by.name });
    return { world: w, light: null, text: `Took the light "${existing!.name}" away.` };
  }
  if (!existing && w.lights.length >= SCENE_LIMITS.lights) throw bad(`A world can have ${SCENE_LIMITS.lights} lights. Glowing voxels (kind "emissive") light their surroundings by themselves, without a light.`);
  const before = existing ? structuredClone(existing) : null;
  const l: WorldLight = existing || { id: uid('l'), name: 'Light', by: req.by, kind: 'point', color: '#ffd59a', intensity: 3, range: 12, anchor: { to: 'world' }, position: [0, 4, 0] };
  place(w, l, f);
  if (f.kind !== undefined) {
    if (f.kind !== 'point' && f.kind !== 'spot') throw bad('kind is "point" or "spot"');
    l.kind = f.kind;
  }
  if (f.color !== undefined) l.color = hex(f.color, 'color');
  if (f.intensity !== undefined) l.intensity = num(f.intensity, 'intensity', 0, 10);
  if (f.range !== undefined) l.range = num(f.range, 'range', 1, 200);
  if (f.target !== undefined) l.target = vec(f.target, 'target');
  if (f.angle !== undefined) l.angle = num(f.angle, 'angle', 5, 120);
  if (f.flicker !== undefined) l.flicker = num(f.flicker, 'flicker', 0, 1);
  if (l.kind === 'spot' && !l.target) l.target = [l.position[0], 0, l.position[2]];
  if (!existing) w.lights.push(l);
  remember(w.id, { by: req.by, kind: 'light', what: `${existing ? 'changed' : 'put up'} the light ${l.name}`, objectId: l.id, metaBefore: null, sceneBefore: before });
  saveWorld(w, { lights: true, by: req.by.name });
  return { world: w, light: l, text: `${existing ? 'Changed' : 'Put up'} the light "${l.name}": a ${l.kind} light, ${l.color}, intensity ${l.intensity}, reaching ${l.range} map units, ${where(w, l)}.` };
}

// ---------- effects ----------
export interface EffectRequest {
  by: WorldBuilder;
  action: 'add' | 'change' | 'remove';
  effect?: string;
  fields?: Record<string, unknown>;
  project?: string;
}

export function setEffect(req: EffectRequest): { world: VoxelWorld; effect: WorldEffect | null; text: string } {
  return changeWorld(req.project || activeProject().id, (w) => setEffectIn(w, req));
}

function setEffectIn(w: VoxelWorld, req: EffectRequest): { world: VoxelWorld; effect: WorldEffect | null; text: string } {
  const f = req.fields || {};
  const existing = req.action === 'add' ? null : byRef(w.effects, req.effect);
  if (req.action !== 'add' && !existing) throw bad(`There's no effect "${req.effect}". world_info lists them.`, 404);
  if (req.action === 'remove') {
    w.effects = w.effects.filter((e) => e.id !== existing!.id);
    remember(w.id, { by: req.by, kind: 'effect', what: `took the effect ${existing!.name} away`, objectId: existing!.id, metaBefore: null, sceneBefore: existing });
    saveWorld(w, { effects: true, by: req.by.name });
    return { world: w, effect: null, text: `Took the effect "${existing!.name}" away.` };
  }
  if (!existing && w.effects.length >= SCENE_LIMITS.effects) throw bad(`A world can have ${SCENE_LIMITS.effects} effects; make one bigger instead of adding another.`);
  if (!existing && f.kind === undefined) throw bad(`Say which kind: ${EFFECT_KINDS.join(', ')}.`);
  const before = existing ? structuredClone(existing) : null;
  const e: WorldEffect = existing || { id: uid('e'), name: String(f.kind), by: req.by, kind: 'petals', size: [10, 6, 10], amount: 0.5, anchor: { to: 'world' }, position: [0, 0, 0] };
  if (f.kind !== undefined) {
    if (!EFFECT_KINDS.includes(f.kind as WorldEffectKind)) throw bad(`kind is one of ${EFFECT_KINDS.join(', ')}`);
    e.kind = f.kind as WorldEffectKind;
  }
  place(w, e, f);
  if (f.size !== undefined) e.size = vec(f.size, 'size').map((n) => Math.max(0.5, Math.min(400, Math.abs(n)))) as Vec3;
  if (f.amount !== undefined) e.amount = num(f.amount, 'amount', 0, 1);
  if (f.colors !== undefined) {
    if (!Array.isArray(f.colors)) throw bad('colors is a list of colours');
    e.colors = f.colors.slice(0, 8).map((c, i) => hex(c, `colors[${i}]`));
    if (!e.colors.length) delete e.colors;
  }
  if (f.wind !== undefined) e.wind = vec(f.wind, 'wind').map((n) => Math.max(-20, Math.min(20, n))) as Vec3;
  if (!existing) w.effects.push(e);
  remember(w.id, { by: req.by, kind: 'effect', what: `${existing ? 'changed' : 'added'} the effect ${e.name}`, objectId: e.id, metaBefore: null, sceneBefore: before });
  saveWorld(w, { effects: true, by: req.by.name });
  return { world: w, effect: e, text: `${existing ? 'Changed' : 'Added'} the effect "${e.name}": ${e.kind}, amount ${e.amount}, in ${e.size.join('×')} map units ${where(w, e)}.` };
}

// ---------- the environment ----------
/** A preset, then any of its fields changed. Colours #rrggbb, angles in degrees. */
export function setEnvironment(req: { by: WorldBuilder; fields: Record<string, unknown>; project?: string }): { world: VoxelWorld; text: string } {
  return changeWorld(req.project || activeProject().id, (w) => setEnvironmentIn(w, req));
}

function setEnvironmentIn(w: VoxelWorld, req: { by: WorldBuilder; fields: Record<string, unknown>; project?: string }): { world: VoxelWorld; text: string } {
  const f = req.fields;
  const before = structuredClone(w.environment);
  let env: WorldEnvironment = structuredClone(w.environment);
  if (f.preset !== undefined) {
    if (!(String(f.preset) in ENV_PRESETS)) throw bad(`preset is one of ${Object.keys(ENV_PRESETS).join(', ')}`);
    // the preset's light and sky; the weather and wind stay unless given
    env = { ...envPreset(String(f.preset) as WorldEnvPreset), weather: env.weather, wind: env.wind };
  }
  const sub = <K extends 'sky' | 'fog' | 'sun' | 'ambient'>(key: K, fields: Record<string, (v: unknown) => unknown>) => {
    const g = f[key];
    if (g === undefined) return;
    if (!g || typeof g !== 'object') throw bad(`${key} is an object`);
    for (const [k, read] of Object.entries(fields)) {
      const v = (g as Record<string, unknown>)[k];
      if (v !== undefined) (env[key] as Record<string, unknown>)[k] = read(v);
    }
  };
  sub('sky', { top: (v) => hex(v, 'sky.top'), horizon: (v) => hex(v, 'sky.horizon'), bottom: (v) => hex(v, 'sky.bottom') });
  sub('fog', { color: (v) => hex(v, 'fog.color'), density: (v) => num(v, 'fog.density', 0, 1) });
  sub('sun', { color: (v) => hex(v, 'sun.color'), intensity: (v) => num(v, 'sun.intensity', 0, 8), azimuth: (v) => num(v, 'sun.azimuth', -360, 360), elevation: (v) => num(v, 'sun.elevation', 2, 90) });
  sub('ambient', { sky: (v) => hex(v, 'ambient.sky'), ground: (v) => hex(v, 'ambient.ground'), intensity: (v) => num(v, 'ambient.intensity', 0, 4) });
  if (f.bloom !== undefined) env.bloom = num(f.bloom, 'bloom', 0, 2);
  if (f.tiltShift !== undefined) env.tiltShift = num(f.tiltShift, 'tiltShift', 0, 1);
  if (f.exposure !== undefined) env.exposure = num(f.exposure, 'exposure', 0.3, 3);
  if (f.weather !== undefined) {
    if (!WEATHER.includes(f.weather as (typeof WEATHER)[number])) throw bad(`weather is one of ${WEATHER.join(', ')}`);
    env.weather = f.weather as WorldEnvironment['weather'];
  }
  if (f.wind !== undefined) env.wind = vec(f.wind, 'wind').map((n) => Math.max(-20, Math.min(20, n))) as Vec3;
  w.environment = env;
  remember(w.id, { by: req.by, kind: 'environment', what: `changed the time of day and weather (${env.preset}${env.weather && env.weather !== 'none' ? `, ${env.weather}` : ''})`, objectId: 'environment', metaBefore: null, sceneBefore: before });
  saveWorld(w, { environment: true, by: req.by.name });
  return { world: w, text: `The world's look is now ${envText(env)}.` };
}

export const envText = (e: WorldEnvironment): string =>
  `${e.preset} (sun ${e.sun.color} at ${e.sun.elevation}° up, sky ${e.sky.top} to ${e.sky.horizon}, fog ${e.fog.density}, bloom ${e.bloom}, tilt-shift ${e.tiltShift})${e.weather && e.weather !== 'none' ? `, weather: ${e.weather}` : ''}${e.wind ? `, wind ${e.wind.join(', ')}` : ''}`;

/** builder: for world_info, so a builder knows which tools change the look (the Brain has actions instead). */
export function sceneText(w: VoxelWorld, { builder = false }: { builder?: boolean } = {}): string {
  const lights = w.lights.map((l) => `- light "${l.name}" by ${l.by.name}: ${l.kind}, ${l.color}, intensity ${l.intensity}, range ${l.range}, ${where(w, l)}${l.flicker ? `, flicker ${l.flicker}` : ''}`);
  const effects = w.effects.map((e) => `- effect "${e.name}" by ${e.by.name}: ${e.kind}, amount ${e.amount}, ${e.size.join('×')} map units ${where(w, e)}`);
  const tools = builder ? ` Change the time of day (${Object.keys(ENV_PRESETS).join(', ')}), sun, sky, fog, weather or wind with world_environment; you don't need to ask.` : '';
  return [`Look: ${envText(w.environment)}.${tools}`, lights.length ? `Lights (${lights.length} of ${SCENE_LIMITS.lights}; glowing voxels light things by themselves too):\n${lights.join('\n')}` : 'No lights put up (glowing voxels light their surroundings by themselves).', effects.length ? `Effects (${effects.length} of ${SCENE_LIMITS.effects}):\n${effects.join('\n')}` : 'No effects.'].join('\n');
}
