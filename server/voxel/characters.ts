// Characters, animations and skins. An agent's "character" is any prefab: a person, an animal, a tree, a lamp,
// a floating crystal. It may be made of named parts (copies of part prefabs placed with "name") that its
// animations move, or be one piece moved whole ("self"). Its builder designs the animations as keys per part. A skin dresses an agent (its
// character and desk, and which animation plays when it is idle, working or needs you), a team's platform
// and hub, or the Brain, and can take any of them off the map. All voxel look only.
import { activeProject, agents, emit, workflows } from '../store.ts';
import { readPrefab, saveWorld } from './store.ts';
import { changeWorld, shownWorld } from './link.ts';
import { findPrefab, remember } from './build.ts';
import type { AgentSkin, AnimKey, AnimationClip, BrainSkin, TeamSkin, Vec3, VoxelPrefabMeta, VoxelWorld, WorldBuilder } from '../../shared/types.ts';

export const ANIM_LIMITS = { clips: 24, tracks: 40, keys: 64, duration: 60 };
const EASES = ['linear', 'smooth', 'step', 'bounce'] as const;

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const num = (v: unknown, what: string, min: number, max: number): number => {
  const n = Number(v);
  if (v === null || v === '' || !Number.isFinite(n)) throw bad(`${what} must be a number`);
  return Math.max(min, Math.min(max, n));
};
const vec = (v: unknown, what: string, lim: number): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => !Number.isFinite(Number(n)))) throw bad(`${what} must be [x, y, z]`);
  return v.map((n) => Math.max(-lim, Math.min(lim, Number(n)))) as Vec3;
};

/** The part names in a character, at any depth (parts can hold parts). */
export function partNames(w: VoxelWorld, prefabId: string, depth = 0, seen = new Set<string>()): string[] {
  if (depth > 4 || seen.has(prefabId)) return [];
  seen.add(prefabId);
  const out: string[] = [];
  for (const i of readPrefab(w.id, prefabId)?.instances || []) {
    if (i.name) out.push(i.name);
    out.push(...partNames(w, i.prefab, depth + 1, seen));
  }
  return [...new Set(out)];
}

// ---------- animations ----------
export function cleanClip(raw: Record<string, unknown>): AnimationClip {
  const duration = num(raw.duration ?? 1, 'duration', 0.1, ANIM_LIMITS.duration);
  const tracks = raw.tracks;
  if (!tracks || typeof tracks !== 'object' || Array.isArray(tracks)) throw bad('tracks is {"part name": [keys…]} ("self" moves the whole character)');
  const names = Object.keys(tracks);
  if (!names.length) throw bad('an animation needs at least one track');
  if (names.length > ANIM_LIMITS.tracks) throw bad(`at most ${ANIM_LIMITS.tracks} parts in one animation`);
  const out: AnimationClip = { duration, loop: raw.loop !== false, tracks: {} };
  for (const name of names) {
    const keys = (tracks as Record<string, unknown>)[name];
    if (!Array.isArray(keys) || !keys.length) throw bad(`track "${name}" is a list of keys like {"t": 0.5, "turn": [30, 0, 0]}`);
    if (keys.length > ANIM_LIMITS.keys) throw bad(`track "${name}": at most ${ANIM_LIMITS.keys} keys`);
    const clean: AnimKey[] = keys.map((k, i) => {
      if (!k || typeof k !== 'object') throw bad(`track "${name}", key ${i + 1} must be an object`);
      const o = k as Record<string, unknown>;
      const key: AnimKey = { t: num(o.t ?? i / Math.max(1, keys.length - 1), `track "${name}", key ${i + 1}: t`, 0, 1) };
      if (o.turn !== undefined) key.turn = vec(o.turn, `track "${name}", key ${i + 1}: turn`, 3600);
      if (o.move !== undefined) key.move = vec(o.move, `track "${name}", key ${i + 1}: move`, 50);
      if (o.scale !== undefined) key.scale = num(o.scale, `track "${name}", key ${i + 1}: scale`, 0.05, 10);
      if (o.ease !== undefined) {
        if (!EASES.includes(o.ease as (typeof EASES)[number])) throw bad(`ease is ${EASES.join(', ')}`);
        key.ease = o.ease as AnimKey['ease'];
      }
      if (!key.turn && !key.move && key.scale === undefined) throw bad(`track "${name}", key ${i + 1}: give turn, move or scale`);
      return key;
    });
    out.tracks[name.trim().toLowerCase()] = clean.sort((a, b) => a.t - b.t);
  }
  return out;
}

export interface AnimRequest {
  by: WorldBuilder;
  prefab: string;
  action: 'set' | 'remove' | 'list';
  clip?: string;
  fields?: Record<string, unknown>;
  project?: string;
}

export function setAnimation(req: AnimRequest): { prefab: VoxelPrefabMeta; text: string } {
  return changeWorld(req.project || activeProject().id, (w) => setAnimationIn(w, req));
}

function setAnimationIn(w: VoxelWorld, req: AnimRequest): { prefab: VoxelPrefabMeta; text: string } {
  const p = findPrefab(w, req.prefab);
  if (!p) throw bad(`There's no prefab "${req.prefab}".`, 404);
  const parts = partNames(w, p.id);
  if (req.action === 'list') {
    const clips = Object.entries(p.animations || {}).map(([n, c]) => `- "${n}": ${c.duration}s, ${c.loop ? 'loops' : 'plays once'}, moves ${Object.keys(c.tracks).join(', ')}`);
    return { prefab: p, text: `"${p.name}" has the parts: ${parts.join(', ') || 'none (place part prefabs in it with "name" to give it parts; "self" moves it whole)'}.\n${clips.length ? `Animations:\n${clips.join('\n')}` : 'No animations yet.'}` };
  }
  const clipName = String(req.clip ?? '').trim().toLowerCase().slice(0, 40);
  if (!clipName) throw bad('Name the animation (e.g. "idle", "working", "needs", "cheer").');
  const before = structuredClone(p);
  if (req.action === 'remove') {
    if (!p.animations?.[clipName]) throw bad(`"${p.name}" has no animation "${clipName}".`, 404);
    delete p.animations[clipName];
  } else {
    const clip = cleanClip(req.fields || {});
    p.animations = p.animations || {};
    if (!p.animations[clipName] && Object.keys(p.animations).length >= ANIM_LIMITS.clips) throw bad(`a prefab can have ${ANIM_LIMITS.clips} animations`);
    p.animations[clipName] = clip;
  }
  p.updatedAt = Date.now();
  p.lastBy = req.by;
  remember(w.id, { by: req.by, kind: 'prefab', what: `${req.action === 'remove' ? 'removed' : 'designed'} the animation ${clipName} of ${p.name}`, objectId: p.id, metaBefore: before });
  saveWorld(w, { prefabs: [p.id], animations: true, by: req.by.name });
  if (req.action === 'remove') return { prefab: p, text: `Removed the animation "${clipName}" from "${p.name}".` };
  const clip = p.animations![clipName];
  const unknown = Object.keys(clip.tracks).filter((n) => n !== 'self' && !parts.includes(n));
  return {
    prefab: p,
    text: `Saved the animation "${clipName}" of "${p.name}": ${clip.duration}s, ${clip.loop ? 'looping' : 'once'}, moving ${Object.keys(clip.tracks).join(', ')}.${unknown.length ? ` Note: "${p.name}" has no part called ${unknown.map((n) => `"${n}"`).join(', ')} (its parts: ${parts.join(', ') || 'none'}), so those tracks do nothing until there is one.` : ''}${['idle', 'working', 'needs'].includes(clipName) ? ` An agent wearing it plays "${clipName}" when it is ${clipName === 'needs' ? 'waiting for the user' : clipName} (unless its skin picks another).` : ' Play it with world_animate action "play", or pick it for a state with world_skin "states".'}`,
  };
}

/** Plays an animation once (or a few times) on an agent's character, then it goes back to its state's. */
export function playAnimation(req: { by: WorldBuilder; agent: string; clip: string; times?: unknown; project?: string }): string {
  // playing changes nothing, so a carried-over world isn't copied for it
  const w = shownWorld(req.project || activeProject().id).world;
  if (!w) throw bad('There is no world yet.', 404);
  const a = agents.get(req.agent) || agents.list().find((x) => x.name.toLowerCase() === String(req.agent).trim().toLowerCase());
  if (!a) throw bad(`There's no agent "${req.agent}".`, 404);
  const skin = w.skins.agents[a.id];
  const character = skin?.character ? w.prefabs.find((p) => p.id === skin.character) : null;
  if (!character) throw bad(`${a.name} doesn't have a voxel form in this world yet. Give it one first with world_skin "character".`);
  const clip = String(req.clip ?? '').trim().toLowerCase();
  if (!character.animations?.[clip]) throw bad(`"${character.name}" has no animation "${clip}" (it has: ${Object.keys(character.animations || {}).join(', ') || 'none'}).`);
  const times = req.times === undefined ? 1 : Math.round(num(req.times, 'times', 1, 20));
  emit('world-anim', { world: w.id, agent: a.id, clip, times });
  return `${a.name} plays "${clip}"${times > 1 ? ` ${times} times` : ''}.`;
}

// ---------- skins ----------
export type SkinTarget = 'agent' | 'team' | 'brain';

/** A prefab by name or id, for a skin. */
function prefabId(w: VoxelWorld, ref: unknown, what: string): string | undefined {
  if (ref === null || ref === '') return undefined;
  const p = findPrefab(w, ref);
  if (!p) throw bad(`There's no prefab "${String(ref)}" for the ${what}. world_prefab "list" shows them; build one with world_build and "prefab".`);
  return p.id;
}

export interface SkinRequest {
  by: WorldBuilder;
  to: SkinTarget;
  /** an agent's or team's id or name (not for the Brain) */
  id?: string;
  fields: Record<string, unknown>;
  project?: string;
}

/** Who is dressed: the agent or team found by id or name. */
export function skinTarget(to: SkinTarget, id: unknown): { id: string; name: string } {
  if (to === 'brain') return { id: 'brain', name: 'the Brain' };
  const ref = String(id ?? '').trim();
  if (to === 'agent') {
    const a = agents.get(ref) || agents.list().find((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (!a) throw bad(`There's no agent "${ref}".`, 404);
    return { id: a.id, name: a.name };
  }
  const t = workflows.get(ref) || workflows.list().find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!t) throw bad(`There's no team "${ref}".`, 404);
  return { id: t.id, name: `the team ${t.name}` };
}

export function setSkin(req: SkinRequest): { world: VoxelWorld; text: string } {
  if (!['agent', 'team', 'brain'].includes(req.to)) throw bad('to is "agent", "team" or "brain"');
  return changeWorld(req.project || activeProject().id, (w) => setSkinIn(w, req));
}

function setSkinIn(w: VoxelWorld, req: SkinRequest): { world: VoxelWorld; text: string } {
  const target = skinTarget(req.to, req.id);
  const f = req.fields;
  const list = (req.to === 'agent' ? w.skins.agents : req.to === 'team' ? w.skins.teams : null) as Record<string, AgentSkin | TeamSkin> | null;
  const before = (list ? list[target.id] : w.skins.brain) || null;
  let skin: AgentSkin & TeamSkin & BrainSkin = f.clear === true ? {} : structuredClone(before || {});
  if (f.clear !== true) {
    if (req.to === 'agent') {
      if (f.character !== undefined) skin.character = prefabId(w, f.character, 'character');
      if (f.desk !== undefined) skin.desk = prefabId(w, f.desk, 'desk');
      if (f.states !== undefined) {
        if (!f.states || typeof f.states !== 'object') throw bad('states is {"idle": "clip", "working": "clip", "needs": "clip"}');
        const st: NonNullable<AgentSkin['states']> = {};
        for (const k of ['idle', 'working', 'needs'] as const) {
          const v = (f.states as Record<string, unknown>)[k];
          if (typeof v === 'string' && v.trim()) st[k] = v.trim().toLowerCase();
        }
        skin.states = st;
      }
    }
    if (req.to === 'team') {
      if (f.platform !== undefined) skin.platform = prefabId(w, f.platform, 'platform');
      if (f.hub !== undefined) skin.hub = prefabId(w, f.hub, 'hub');
    }
    if (req.to === 'brain') {
      if (f.shell !== undefined) skin.shell = prefabId(w, f.shell, 'shell');
      if (f.globe !== undefined) skin.globe = f.globe !== false;
    }
    if (f.offset !== undefined) skin.offset = vec(f.offset, 'offset', 100);
    if (f.turn !== undefined) skin.turn = ((num(f.turn, 'turn', -3600, 3600) % 360) + 360) % 360;
    if (f.scale !== undefined) skin.scale = num(f.scale, 'scale', 0.1, 10);
    if (f.hidden !== undefined) skin.hidden = f.hidden === true;
    if (f.label !== undefined) skin.label = f.label !== false;
  }
  // (fields set to null or "" are gone)
  skin = Object.fromEntries(Object.entries(skin).filter(([, v]) => v !== undefined)) as typeof skin;
  skin.by = req.by;
  const empty = Object.keys(skin).filter((k) => k !== 'by').length === 0;
  if (list) {
    if (empty) delete list[target.id];
    else list[target.id] = skin;
  } else if (empty) delete w.skins.brain;
  else w.skins.brain = skin;
  remember(w.id, { by: req.by, kind: 'skin', what: `${f.clear === true ? 'undressed' : 'dressed'} ${target.name}`, objectId: `${req.to}:${target.id}`, metaBefore: null, sceneBefore: before });
  saveWorld(w, { skins: true, by: req.by.name });
  // a state that names an animation the character doesn't have
  const character = skin.character ? w.prefabs.find((p) => p.id === skin.character) : null;
  const missing = character ? Object.values(skin.states || {}).filter((c) => !character.animations?.[c]) : [];
  const note = missing.length ? ` Note: "${character!.name}" has no animation ${missing.map((c) => `"${c}"`).join(', ')} yet (design it with world_animate).` : '';
  return { world: w, text: empty ? `${cap(target.name)} looks classic again.` : `${cap(target.name)} in this world: ${skinText(w, skin)}.${note}` };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pname = (w: VoxelWorld, id?: string) => (id ? `"${w.prefabs.find((p) => p.id === id)?.name || id}"` : '');

/** Which skins use a prefab ("the character of Ada", "the platform of the team Writers"). */
export function skinUses(w: VoxelWorld, prefabId: string): string[] {
  const out: string[] = [];
  const b = w.skins.brain;
  if (b?.shell === prefabId) out.push("the Brain's shell");
  for (const [id, s] of Object.entries(w.skins.teams)) {
    const name = `the team ${workflows.get(id)?.name || id}`;
    if (s.platform === prefabId) out.push(`the platform of ${name}`);
    if (s.hub === prefabId) out.push(`the hub of ${name}`);
  }
  for (const [id, s] of Object.entries(w.skins.agents)) {
    const name = agents.get(id)?.name || `agent ${id}`;
    if (s.character === prefabId) out.push(`the character of ${name}`);
    if (s.desk === prefabId) out.push(`the desk of ${name}`);
  }
  return out;
}

export function skinText(w: VoxelWorld, s: AgentSkin & TeamSkin & BrainSkin): string {
  const bits = [
    s.hidden ? 'hidden from the map' : '',
    s.label === false ? 'no name label' : '',
    s.character ? `the character ${pname(w, s.character)}` : '',
    s.desk ? `the desk ${pname(w, s.desk)}` : '',
    s.platform ? `the platform ${pname(w, s.platform)}` : '',
    s.hub ? `the hub ${pname(w, s.hub)}` : '',
    s.shell ? `the shell ${pname(w, s.shell)}` : '',
    s.globe === false ? 'no globe' : '',
    s.states ? `animations ${Object.entries(s.states).map(([k, v]) => `${k}: "${v}"`).join(', ')}` : '',
    s.offset ? `moved ${s.offset.join(', ')}` : '',
    s.turn ? `turned ${s.turn}°` : '',
    s.scale && s.scale !== 1 ? `scale ${s.scale}` : '',
  ].filter(Boolean);
  return bits.join(', ') || 'classic';
}

/** Skins in words, for world_info and the Brain. */
export function skinsText(w: VoxelWorld): string {
  const lines: string[] = [];
  if (w.skins.brain) lines.push(`- the Brain: ${skinText(w, w.skins.brain)}`);
  for (const [id, s] of Object.entries(w.skins.teams)) lines.push(`- team ${workflows.get(id)?.name || `${id} (another project's)`}: ${skinText(w, s)}`);
  for (const [id, s] of Object.entries(w.skins.agents)) lines.push(`- ${agents.get(id)?.name || `agent ${id} (another project's)`}: ${skinText(w, s)}`);
  return lines.length ? `Skins (the voxel look of the Brain, teams and agents; anything not listed looks classic):\n${lines.join('\n')}` : 'No skins: the Brain, the team platforms and the agents look classic. Dress them with world_skin.';
}
