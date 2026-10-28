// Skins: in the voxel look, the Brain, a team's platform and hub, and an agent's character and desk can be
// prefabs the builders made, or be taken off the map. The classic models are only hidden (never disposed),
// so leaving the voxel look shows them exactly as they were. Skins follow what they dress every frame (a
// dragged team, a desk turning to face you), and characters play their animations: the clip of their state
// (idle, working, needs you), and a clip played once when a builder asks.
import * as THREE from 'three';
import { Animator } from './animate.ts';
import { applyPose, buildRig, partTree } from './rig.ts';
import type { PartNode, Rig, RigLookup } from './rig.ts';
import type { Variant } from './instances.ts';
import { castsShadow, takesShadow } from './materials.ts';
import { LIGHT_STRIDE } from './mesher.ts';
import type { RenderClass } from './mesher.ts';
import { glowStrength } from './lights.ts';
import type { WorldView } from './view.ts';
import type { AgentSkin, BrainSkin, TeamSkin, Vec3, VoxelPrefabMeta, VoxelWorld } from '../../shared/types.ts';

export type DeskStatus = 'idle' | 'working' | 'needs';

/** What the Station shows of the Brain (the classic models, by role). */
export interface BrainTarget {
  anchor: THREE.Object3D;
  /** the pedestal */
  base: THREE.Object3D[];
  /** the particle globe, its frame, halo, beam and star */
  globe: THREE.Object3D[];
  pick: unknown;
}
export interface TeamTarget {
  anchor: THREE.Object3D;
  /** the round floor (slab, top, rim, track ring, the glow under it) */
  floor: THREE.Object3D[];
  /** the chat hub's base and rings (the team's mark stays) */
  hub: THREE.Object3D[];
  /** spokes, the lead's seat ring, the link to the Brain */
  extras: THREE.Object3D[];
  pick: unknown;
}
export interface AgentTarget {
  agentId: string;
  /** one per desk (an agent on two teams has two) */
  key: string;
  anchor: THREE.Object3D;
  person: THREE.Object3D;
  /** the desk itself: top, legs, monitor, stand, chair (the live screen stays) */
  furniture: THREE.Object3D[];
  status(): DeskStatus;
  pick: unknown;
}

/** The Station, as skins see it. version() changes whenever the Station built its models again. */
export interface SkinHost {
  version(): number;
  brain(): BrainTarget | null;
  team(id: string): TeamTarget | null;
  agents(): AgentTarget[];
  setLabel(kind: 'brain' | 'branch' | 'agent', id: string, hidden: boolean): void;
}

/** A prefab variant, meshed and shared (counted: release it when done). */
export interface SharedMesh {
  key: string;
  parts: { geo: THREE.BufferGeometry; cls: RenderClass; local: THREE.Matrix4; lights?: Float32Array; voxelSize?: number }[];
}

/** What skins need from the world layer: the world, its prefabs' voxels, meshes of them. */
export interface SkinContext {
  world(): VoxelWorld | null;
  loadPrefabs(ids: string[]): Promise<void>;
  lookup: RigLookup;
  mesh(prefab: string, variant: Variant): Promise<SharedMesh | null>;
  release(key: string): void;
  /** a skin was put on or taken off (its glowing voxels light things now, or no longer) */
  changed?(): void;
}

/** A glowing spot of a skin, in world space (see lights.ts). */
export interface SkinGlow {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  strength: number;
}

/** Which classic parts a skin hides, and what it draws instead (pure, tested). */
export interface SkinPlan {
  hideAll: boolean;
  hide: ('person' | 'furniture' | 'floor' | 'hub' | 'extras' | 'base' | 'globe')[];
  models: { role: 'character' | 'desk' | 'platform' | 'hub' | 'shell'; prefab: string }[];
  label: boolean;
}
export function agentPlan(s: AgentSkin | undefined, has: (id: string) => boolean): SkinPlan {
  const plan: SkinPlan = { hideAll: !!s?.hidden, hide: [], models: [], label: s?.label !== false };
  if (!s || s.hidden) return plan;
  if (s.character && has(s.character)) plan.hide.push('person'), plan.models.push({ role: 'character', prefab: s.character });
  if (s.desk && has(s.desk)) plan.hide.push('furniture'), plan.models.push({ role: 'desk', prefab: s.desk });
  return plan;
}
export function teamPlan(s: TeamSkin | undefined, has: (id: string) => boolean): SkinPlan {
  const plan: SkinPlan = { hideAll: false, hide: [], models: [], label: s?.label !== false };
  if (!s) return plan;
  if (s.hidden) {
    plan.hide.push('floor', 'hub', 'extras');
    return plan;
  }
  if (s.platform && has(s.platform)) plan.hide.push('floor'), plan.models.push({ role: 'platform', prefab: s.platform });
  if (s.hub && has(s.hub)) plan.hide.push('hub'), plan.models.push({ role: 'hub', prefab: s.hub });
  return plan;
}
export function brainPlan(s: BrainSkin | undefined, has: (id: string) => boolean): SkinPlan {
  const plan: SkinPlan = { hideAll: !!s?.hidden, hide: [], models: [], label: s?.label !== false };
  if (!s || s.hidden) return plan;
  if (s.globe === false) plan.hide.push('globe');
  // a shell takes the pedestal's place and wraps the globe
  if (s.shell && has(s.shell)) plan.hide.push('base'), plan.models.push({ role: 'shell', prefab: s.shell });
  return plan;
}

/** The clip an agent's character plays in a state: the skin's choice, else a clip named like the state. */
export function stateClip(s: AgentSkin | undefined, status: DeskStatus, has: (clip: string) => boolean): string | null {
  const chosen = s?.states?.[status];
  if (chosen && has(chosen)) return chosen;
  return has(status) ? status : null;
}

const DEG = Math.PI / 180;
/** Where a model of a role sits from its classic spot: a character on the chair facing the monitor. */
const ROLE_SPOT: Record<SkinPlan['models'][number]['role'], { at: Vec3; turn: number }> = {
  character: { at: [0, 0, 0.62], turn: 180 },
  desk: { at: [0, 0, 0], turn: 0 },
  platform: { at: [0, 0, 0], turn: 0 },
  hub: { at: [0, 0, 0], turn: 0 },
  shell: { at: [0, 0, 0], turn: 0 },
};

/** One dressed thing on the map. */
interface Dressed {
  fingerprint: string;
  anchor: THREE.Object3D;
  /** the skin's offset, turn and scale */
  local: THREE.Matrix4;
  root: THREE.Group;
  /** classic models hidden, with how they were */
  hidden: [THREE.Object3D, boolean][];
  label: [SkinHost['setLabel'] extends (...a: infer A) => void ? A : never] | null;
  meshKeys: string[];
  /** every prefab its models are made of, nested parts too (found while building them), and their versions then */
  parts: Set<string>;
  partsKey: string;
  /** meshes with glowing voxels, and where in them (LIGHT_STRIDE numbers a spot) */
  glow: { mesh: THREE.Mesh; lights: Float32Array }[];
  /** a character */
  rig?: Rig;
  animator?: Animator;
  agentId?: string;
  skin?: AgentSkin;
  status?: () => DeskStatus;
}

const stamp = (p: VoxelPrefabMeta | undefined) => (p ? (p.voxelsAt ?? p.updatedAt) : 0);

export class SkinLayer {
  private dressed = new Map<string, Dressed>();
  private version = -1;
  private syncing: Promise<void> | null = null;
  private again = false;
  private alive = true;
  private readonly clock = new THREE.Clock();
  private readonly view: WorldView;
  private readonly host: SkinHost;
  private readonly ctx: SkinContext;

  constructor(view: WorldView, host: SkinHost, ctx: SkinContext) {
    this.view = view;
    this.host = host;
    this.ctx = ctx;
  }

  /** Dress (and undress) to match the world's skins. Cheap when nothing changed. */
  sync(): Promise<void> {
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = this.run()
      .catch(() => {})
      .finally(() => {
        this.syncing = null;
        if (this.again && this.alive) {
          this.again = false;
          void this.sync();
        }
      });
    return this.syncing;
  }

  private async run(): Promise<void> {
    const w = this.ctx.world();
    const skins = w?.skins;
    const prefabs = new Map((w?.prefabs || []).map((p) => [p.id, p]));
    const has = (id: string) => prefabs.has(id);
    const v = this.host.version();
    this.version = v;
    const want = new Map<string, { plan: SkinPlan; anchorOf: () => THREE.Object3D | null; hideOf: (role: SkinPlan['hide'][number]) => THREE.Object3D[]; all: () => THREE.Object3D | null; skin: AgentSkin | TeamSkin | BrainSkin | undefined; label: [Parameters<SkinHost['setLabel']>[0], string]; pick: unknown; agent?: AgentTarget }>();
    if (w) {
      const b = this.host.brain();
      const bs = skins?.brain;
      if (b && bs) {
        want.set('brain', { plan: brainPlan(bs, has), anchorOf: () => b.anchor, hideOf: (r) => (r === 'base' ? b.base : r === 'globe' ? b.globe : []), all: () => b.anchor, skin: bs, label: ['brain', 'brain'], pick: b.pick });
      }
      for (const [id, ts] of Object.entries(skins?.teams || {})) {
        const t = this.host.team(id);
        if (!t) continue;
        want.set(`team:${id}`, { plan: teamPlan(ts, has), anchorOf: () => t.anchor, hideOf: (r) => (r === 'floor' ? t.floor : r === 'hub' ? t.hub : r === 'extras' ? t.extras : []), all: () => null, skin: ts, label: ['branch', id], pick: t.pick });
      }
      for (const a of this.host.agents()) {
        const as = skins?.agents?.[a.agentId];
        if (!as) continue;
        want.set(`agent:${a.key}`, { plan: agentPlan(as, has), anchorOf: () => a.anchor, hideOf: (r) => (r === 'person' ? [a.person] : r === 'furniture' ? a.furniture : []), all: () => a.anchor, skin: as, label: ['agent', a.agentId], pick: a.pick, agent: a });
      }
    }
    // what each needs, as a fingerprint: the skin, its prefabs' versions, the palette (all of it: a ramp or
    // jitter changes the colours too), the Station's build
    const palette = w ? JSON.stringify(w.palette) : '';
    const fingerprintOf = (key: string, x: { plan: SkinPlan; skin: unknown }) => {
      const prefabIds = x.plan.models.map((m) => m.prefab);
      return JSON.stringify([key, v, x.skin, prefabIds.map((id) => [id, stamp(prefabs.get(id)), prefabs.get(id)?.animations ? JSON.stringify(prefabs.get(id)!.animations) : '']), palette.length, hashText(palette)]);
    };
    // the nested parts aren't named by the skin: an edited part (or one put in place of another) redresses too
    const partsKeyOf = (parts: Set<string>) => JSON.stringify([...parts].sort().map((id) => [id, stamp(prefabs.get(id))]));
    for (const [key, d] of this.dressed) {
      const x = want.get(key);
      if (!x || fingerprintOf(key, x) !== d.fingerprint || partsKeyOf(d.parts) !== d.partsKey) this.undress(key);
    }
    for (const [key, x] of want) {
      if (this.dressed.has(key)) continue;
      const anchor = x.anchorOf();
      if (!anchor) continue;
      const fp = fingerprintOf(key, x);
      const d: Dressed = { fingerprint: fp, anchor, local: localMatrix(x.skin), root: new THREE.Group(), hidden: [], label: null, meshKeys: [], parts: new Set(), partsKey: '', glow: [] };
      d.root.matrixAutoUpdate = false;
      this.dressed.set(key, d);
      // take the classic models off
      const hide = (o: THREE.Object3D) => {
        d.hidden.push([o, o.visible]);
        o.visible = false;
      };
      const all = x.all();
      if (x.plan.hideAll && all) hide(all);
      else for (const role of x.plan.hide) x.hideOf(role).forEach(hide);
      if (!x.plan.label) {
        this.host.setLabel(x.label[0], x.label[1], true);
        d.label = [[x.label[0], x.label[1], false]];
      }
      // and put the skin's models on
      await this.ctx.loadPrefabs(x.plan.models.map((m) => m.prefab));
      if (!this.alive || this.dressed.get(key) !== d) return;
      for (const m of x.plan.models) {
        const model = await this.model(m.prefab, d);
        if (!this.alive || this.dressed.get(key) !== d) return;
        if (!model) continue;
        const spot = ROLE_SPOT[m.role];
        model.group.position.set(spot.at[0], spot.at[1], spot.at[2]);
        model.group.rotation.y = spot.turn * DEG;
        model.group.traverse((o) => (o.userData.pick = x.pick));
        d.root.add(model.group);
        if (m.role === 'character' && model.rig) {
          d.rig = model.rig;
          d.animator = new Animator(prefabs.get(m.prefab)?.animations);
          d.agentId = x.agent?.agentId;
          d.skin = x.skin as AgentSkin;
          d.status = x.agent?.status;
        }
      }
      d.partsKey = partsKeyOf(d.parts);
      this.view.addObject(d.root);
      this.ctx.changed?.();
    }
  }

  /** A prefab as a model: a rig of named parts (each part's own voxels as meshes). */
  private async model(prefab: string, d: Dressed): Promise<{ group: THREE.Group; rig: Rig } | null> {
    const tree = partTree(prefab, this.ctx.lookup);
    if (!tree) return null;
    const nodes: PartNode[] = [];
    const walk = (n: PartNode) => {
      nodes.push(n);
      d.parts.add(n.prefab);
      n.children.forEach(walk);
    };
    walk(tree);
    const meshes = new Map<PartNode, THREE.Object3D[]>();
    for (const n of nodes) {
      const sm = await this.ctx.mesh(n.prefab, n.variant);
      if (!this.alive) return null;
      if (!sm) continue;
      d.meshKeys.push(sm.key);
      meshes.set(
        n,
        sm.parts.map((p) => {
          const mesh = new THREE.Mesh(p.geo, this.view.material(p.cls));
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(p.local);
          mesh.castShadow = castsShadow(p.cls);
          mesh.receiveShadow = takesShadow(p.cls);
          if (p.lights?.length) d.glow.push({ mesh, lights: p.lights });
          return mesh;
        }),
      );
    }
    const rig = buildRig(tree, (n) => meshes.get(n) || []);
    return { group: rig.root, rig };
  }

  private undress(key: string): void {
    const d = this.dressed.get(key);
    if (!d) return;
    this.dressed.delete(key);
    this.view.removeObject(d.root);
    for (const [o, was] of d.hidden) o.visible = was;
    for (const [kind, id, hidden] of d.label || []) this.host.setLabel(kind, id, hidden);
    for (const k of d.meshKeys) this.ctx.release(k);
    if (d.glow.length) this.ctx.changed?.();
  }

  /** Glowing spots of every skin, where they are now (for the light pool). */
  glow(out: SkinGlow[]): void {
    const v = new THREE.Vector3();
    for (const d of this.dressed.values())
      for (const g of d.glow) {
        if (!visibleUp(g.mesh)) continue;
        g.mesh.updateWorldMatrix(true, false);
        const m = g.mesh.matrixWorld;
        // the size a voxel has on the map (its part's voxel size, times the skin's scale)
        const size = m.getMaxScaleOnAxis();
        for (let i = 0; i + LIGHT_STRIDE <= g.lights.length; i += LIGHT_STRIDE) {
          v.set(g.lights[i], g.lights[i + 1], g.lights[i + 2]).applyMatrix4(m);
          out.push({ x: v.x, y: v.y, z: v.z, r: g.lights[i + 3] ** 2.2, g: g.lights[i + 4] ** 2.2, b: g.lights[i + 5] ** 2.2, strength: glowStrength(g.lights[i + 6], size) });
        }
      }
  }

  /** Adds to `box` where the skins of the Brain, a team or an agent are now. */
  boundsOf(kind: 'brain' | 'team' | 'agent', id: string, box: THREE.Box3): void {
    for (const [key, d] of this.dressed) {
      const hit = kind === 'brain' ? key === 'brain' : kind === 'team' ? key === `team:${id}` : d.agentId === id || key.startsWith(`agent:${id}`);
      if (!hit) continue;
      d.root.updateWorldMatrix(true, true);
      box.expandByObject(d.root);
    }
  }

  /** Grows `box` around every skin worn now (for a picture of the whole world). */
  boundsOfAll(box: THREE.Box3): void {
    for (const d of this.dressed.values()) {
      d.root.updateWorldMatrix(true, true);
      box.expandByObject(d.root);
    }
  }

  /** A prefab on its own (for a picture of it): a model, and how to give its meshes back. */
  async standalone(prefab: string): Promise<{ group: THREE.Group; release: () => void } | null> {
    await this.ctx.loadPrefabs([prefab]);
    const d: Dressed = { fingerprint: '', anchor: new THREE.Object3D(), local: new THREE.Matrix4(), root: new THREE.Group(), hidden: [], label: null, meshKeys: [], parts: new Set(), partsKey: '', glow: [] };
    const model = await this.model(prefab, d);
    if (!model) {
      for (const k of d.meshKeys) this.ctx.release(k);
      return null;
    }
    return { group: model.group, release: () => d.meshKeys.forEach((k) => this.ctx.release(k)) };
  }

  /** Plays a clip once (or `times` times) on an agent's character, then back to its state's clip. */
  play(agentId: string, clip: string, times = 1): boolean {
    let any = false;
    const now = this.clock.getElapsedTime();
    for (const d of this.dressed.values()) if (d.agentId === agentId && d.animator) any = d.animator.play(clip, now, times) || any;
    return any;
  }

  /** Every frame: follow what they dress, and animate characters. */
  update(): void {
    if (this.host.version() !== this.version) void this.sync();
    const now = this.clock.getElapsedTime();
    for (const d of this.dressed.values()) {
      d.anchor.updateWorldMatrix(true, false);
      d.root.matrix.multiplyMatrices(d.anchor.matrixWorld, d.local);
      d.root.matrixWorldNeedsUpdate = true;
      if (d.rig && d.animator) {
        const st = d.status?.() || 'idle';
        d.animator.setState(stateClip(d.skin, st, (c) => d.animator!.has(c)), now);
        applyPose(d.rig, d.animator.update(now));
      }
    }
  }

  dispose(): void {
    this.alive = false;
    for (const key of [...this.dressed.keys()]) this.undress(key);
  }
}

/** A skin's offset, turn and scale from its classic spot. */
function localMatrix(s: { offset?: Vec3; turn?: number; scale?: number } | undefined): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const off = s?.offset && s.offset.length === 3 ? s.offset : [0, 0, 0];
  const sc = s?.scale && s.scale > 0 ? s.scale : 1;
  return m.compose(new THREE.Vector3(off[0], off[1], off[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (s?.turn || 0) * DEG, 0)), new THREE.Vector3(sc, sc, sc));
}

function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Shown on the map: it and everything it sits in are visible. */
function visibleUp(o: THREE.Object3D | null): boolean {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}
