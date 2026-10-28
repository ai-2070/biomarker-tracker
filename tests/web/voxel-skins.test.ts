// Skins and the animations builders design: sampling clips, crossfades, play-once clips, part trees of a
// character (any prefab, with or without named parts), and which classic models a skin hides.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Animator, blendPoses, cleanKeys, clipTime, ease, fadeWeight, prepareClip, restPose, sampleClip, samplePart } from '../../web/voxel/animate.ts';
import type { Pose } from '../../web/voxel/animate.ts';
import { applyPose, buildRig, partNames, partTree } from '../../web/voxel/rig.ts';
import type { RigLookup } from '../../web/voxel/rig.ts';
import { agentPlan, brainPlan, SkinLayer, stateClip, teamPlan } from '../../web/voxel/skins.ts';
import type { SkinHost } from '../../web/voxel/skins.ts';
import type { WorldView } from '../../web/voxel/view.ts';
import type { AnimationClip, PrefabInstance, Vec3, VoxelPrefabMeta, VoxelWorld } from '../../shared/types.ts';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe('easing and sampling', () => {
  it('eases: linear, smooth, step, bounce overshoots and lands', () => {
    expect([ease('linear', 0.25), ease('step', 0.99), ease('step', 1)]).toEqual([0.25, 0, 1]);
    close(ease(undefined, 0.5), 0.5);
    expect(ease('smooth', 0.25)).toBeLessThan(0.25);
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map((x) => ease('bounce', x)))).toBeGreaterThan(1);
    close(ease('bounce', 1), 1);
  });

  it('holds before the first key and after the last; interpolates between, eased into the next key', () => {
    const keys = cleanKeys([
      { t: 0.8, turn: [0, 90, 0] },
      { t: 0.2, turn: [0, 0, 0] },
      { t: 0.5, move: [0, 1, 0], ease: 'linear' },
    ]);
    expect(keys.map((k) => k.t)).toEqual([0.2, 0.5, 0.8]);
    const p = restPose();
    samplePart(keys, 0, p);
    expect(p.turn).toEqual([0, 0, 0]);
    expect(p.move).toEqual([0, 1, 0]);
    samplePart(keys, 1, p);
    expect(p.turn).toEqual([0, 90, 0]);
    // turn: from 0 at 0.2 to 90 at 0.8, smooth at the middle is half way
    samplePart(keys, 0.5, p);
    close(p.turn[1], 45);
    expect(p.scale).toBe(1);
  });

  it('a clip loops or plays once', () => {
    expect(clipTime({ duration: 2, loop: true }, 5)).toEqual({ t: 0.5, done: false });
    expect(clipTime({ duration: 2, loop: false }, 5)).toEqual({ t: 1, done: true });
    expect(clipTime({ duration: 2, loop: false }, 1).t).toBe(0.5);
  });

  it('crossfades by weight, parts missing on one side count as rest', () => {
    const a: Pose = new Map([['arm', { turn: [90, 0, 0], move: [0, 0, 0], scale: 1 }]]);
    const b: Pose = new Map([['head', { turn: [0, 40, 0], move: [0, 0, 0], scale: 2 }]]);
    const out: Pose = new Map();
    blendPoses(a, b, 0.5, out);
    close(out.get('arm')!.turn[0], 45);
    close(out.get('head')!.turn[1], 20);
    close(out.get('head')!.scale, 1.5);
    expect([fadeWeight(0), fadeWeight(0.125), fadeWeight(1)]).toEqual([0, 0.5, 1]);
  });

  it('track and clip names match without case', () => {
    const c = prepareClip({ duration: 1, loop: true, tracks: { 'Left Arm': [{ t: 0, turn: [10, 0, 0] }] } });
    expect(sampleClip(c, 0, new Map()).get('left arm')!.turn[0]).toBe(10);
    expect(new Animator({ Wave: c as unknown as AnimationClip }).has('wave')).toBe(true);
  });
});

describe('Animator', () => {
  const clips: Record<string, AnimationClip> = {
    idle: { duration: 2, loop: true, tracks: { self: [{ t: 0, move: [0, 0, 0] }, { t: 0.5, move: [0, 1, 0], ease: 'linear' }, { t: 1, move: [0, 0, 0], ease: 'linear' }] } },
    working: { duration: 1, loop: true, tracks: { arm: [{ t: 0, turn: [-60, 0, 0] }] } },
    cheer: { duration: 1, loop: false, tracks: { arm: [{ t: 0, turn: [0, 0, 160] }] } },
  };
  it('plays the state clip, crossfades to a new one, plays one once and goes back', () => {
    const a = new Animator(clips);
    a.setState('idle', 0);
    close(a.update(0.5).get('self')!.move[1], 0.5);
    a.setState('working', 1);
    // half way through the fade: half of working's arm
    close(a.update(1.125).get('arm')!.turn[0], -30);
    close(a.update(2).get('arm')!.turn[0], -60);
    expect(a.play('cheer', 2)).toBe(true);
    close(a.update(2.5).get('arm')!.turn[2], 160);
    // after its second, back to working (fading in)
    a.update(3.01);
    close(a.update(3.5).get('arm')!.turn[0], -60);
    expect(a.play('nope', 4)).toBe(false);
  });

  it('a state without a clip stands still', () => {
    const a = new Animator(clips);
    a.setState('needs', 0);
    expect([...a.update(1).values()].every((p) => p.turn.every((n) => n === 0))).toBe(true);
  });
});

// prefabs for part trees: a figure with a body, a head and two arms (one a mirrored copy)
const P = (p: Vec3, prefab: string, extra: Partial<PrefabInstance> = {}): PrefabInstance => ({ prefab, p, ...extra });
const prefabs: Record<string, { instances?: PrefabInstance[]; pivot: Vec3 }> = {
  figure: { pivot: [0, 0, 0], instances: [P([0, 0.6, 0], 'body', { name: 'Body' }), P([0, 1.2, 0], 'head', { name: 'head' }), P([-0.3, 1.2, 0], 'arm', { name: 'left arm' }), P([0.3, 1.2, 0], 'arm', { name: 'right arm', mirror: true })] },
  body: { pivot: [0, 0, 0] },
  head: { pivot: [0, 0, 0] },
  arm: { pivot: [0.05, 0.5, 0], instances: [P([0, 0, 0], 'hand', { name: 'hand' })] },
  hand: { pivot: [0, 0, 0] },
  loop: { pivot: [0, 0, 0], instances: [P([0, 1, 0], 'loop', { name: 'again' })] },
  crystal: { pivot: [0, 0, 0] },
};
const lookup: RigLookup = (id) => (prefabs[id] ? { data: { volumes: [], instances: prefabs[id].instances }, pivot: prefabs[id].pivot } : null);

describe('part trees', () => {
  it('names (any case), nesting, mirrored parts carry their mirror down', () => {
    const t = partTree('figure', lookup)!;
    expect(partNames(t)).toEqual(['body', 'head', 'left arm', 'hand', 'right arm', 'hand']);
    const right = t.children[3];
    expect(right.variant.mirror).toBe(true);
    expect(right.pivot).toEqual([-0.05, 0.5, 0]);
    expect(right.children[0].variant.mirror).toBe(true);
  });

  it('a prefab holding itself stops, and the depth is limited', () => {
    const t = partTree('loop', lookup)!;
    expect(t.children).toEqual([]);
    expect(partTree('figure', lookup, 1)!.children.every((c) => c.children.length === 0)).toBe(true);
    expect(partTree('missing', lookup)).toBeNull();
  });

  it('any prefab can be a character: without parts it is one piece that "self" moves', () => {
    const t = partTree('crystal', lookup)!;
    expect(partNames(t)).toEqual([]);
    const rig = buildRig(t, () => [new THREE.Mesh()]);
    expect([...rig.parts.keys()]).toEqual(['self']);
    applyPose(rig, new Map([['self', { turn: [0, 90, 0], move: [0, 0.5, 0], scale: 1 }]]));
    const g = rig.parts.get('self')![0].group;
    close(g.position.y, 0.5);
    close(new THREE.Euler().setFromQuaternion(g.quaternion).y, Math.PI / 2);
  });

  it('a pose turns a part around its pivot, and a part without a pose rests', () => {
    const rig = buildRig(partTree('figure', lookup)!, () => []);
    const arm = rig.parts.get('left arm')![0].group;
    expect(arm.position.toArray()).toEqual([-0.3, 1.2, 0]);
    applyPose(rig, new Map([['left arm', { turn: [-90, 0, 0], move: [0, 0, 0], scale: 1 }]]));
    // the arm's hand end (0.5 below the pivot) swings forward to +z
    const hand = new THREE.Vector3(0, -0.5, 0).applyQuaternion(arm.quaternion);
    close(hand.z, 0.5);
    applyPose(rig, new Map());
    expect(arm.quaternion.equals(new THREE.Quaternion())).toBe(true);
  });
});

describe('what a skin hides', () => {
  const has = (id: string) => id !== 'gone';
  it('an agent: its character takes the person\'s place, its desk the furniture\'s; hidden takes it all', () => {
    expect(agentPlan({ character: 'c', desk: 'd' }, has)).toMatchObject({ hideAll: false, hide: ['person', 'furniture'], label: true });
    expect(agentPlan({ character: 'gone' }, has).hide).toEqual([]);
    expect(agentPlan({ hidden: true, label: false }, has)).toMatchObject({ hideAll: true, models: [], label: false });
    expect(agentPlan(undefined, has)).toMatchObject({ hideAll: false, hide: [], models: [] });
  });
  it('a team and the Brain', () => {
    expect(teamPlan({ hidden: true }, has).hide).toEqual(['floor', 'hub', 'extras']);
    expect(teamPlan({ platform: 'p' }, has).hide).toEqual(['floor']);
    expect(brainPlan({ shell: 's' }, has)).toMatchObject({ hide: ['base'], models: [{ role: 'shell', prefab: 's' }] });
    expect(brainPlan({ globe: false }, has).hide).toEqual(['globe']);
    expect(brainPlan({ hidden: true }, has).hideAll).toBe(true);
  });
  it('the clip of a state: the skin\'s choice, else one named like the state, else none', () => {
    const clips = new Set(['idle', 'wave']);
    const hasClip = (c: string) => clips.has(c);
    expect(stateClip({ states: { needs: 'wave' } }, 'needs', hasClip)).toBe('wave');
    expect(stateClip(undefined, 'idle', hasClip)).toBe('idle');
    expect(stateClip({ states: { working: 'missing' } }, 'working', hasClip)).toBeNull();
  });
});

describe('dressing again when a skin changes', () => {
  // a Brain shell made of a frame that holds a nested part, on a fake map
  const meta = (id: string, voxelsAt: number) => ({ id, name: id, description: '', tags: [], by: { kind: 'brain', name: 'the Brain' }, volumes: [], pivot: [0, 0, 0], size: [1, 1, 1], createdAt: 1, updatedAt: 1, voxelsAt }) as VoxelPrefabMeta;
  const setup = () => {
    const world = {
      palette: [{ name: 'stone', color: '#888888', kind: 'solid' }],
      prefabs: [meta('shell', 1), meta('part', 1)],
      skins: { brain: { shell: 'shell' } },
    } as unknown as VoxelWorld;
    const meshed: string[] = [];
    const parts: Record<string, PrefabInstance[]> = { shell: [P([0, 1, 0], 'part')], part: [] };
    const brain = { anchor: new THREE.Group(), base: [new THREE.Group()], globe: [], pick: null };
    const view = { addObject: () => {}, removeObject: () => {}, material: () => new THREE.MeshBasicMaterial() } as unknown as WorldView;
    const host: SkinHost = { version: () => 1, brain: () => brain, team: () => null, agents: () => [], setLabel: () => {} };
    const layer = new SkinLayer(view, host, {
      world: () => world,
      loadPrefabs: async () => {},
      lookup: (id) => (parts[id] ? { data: { volumes: [], instances: parts[id] }, pivot: [0, 0, 0] } : null),
      mesh: async (id) => {
        meshed.push(id);
        return { key: id, parts: [{ geo: new THREE.BoxGeometry(id === 'part' ? 8 : 1, 1, 1), cls: 'opaque', local: new THREE.Matrix4() }] };
      },
      release: () => {},
    });
    return { world, meshed, layer };
  };

  it('an edited nested part, or a change to a ramp or jitter, dresses it again', async () => {
    const { world, meshed, layer } = setup();
    await layer.sync();
    expect(meshed).toEqual(['shell', 'part']);
    await layer.sync();
    expect(meshed).toHaveLength(2); // nothing changed
    world.prefabs[1] = meta('part', 2);
    await layer.sync();
    expect(meshed).toEqual(['shell', 'part', 'shell', 'part']);
    world.palette[0] = { ...world.palette[0], jitter: 0.2 };
    await layer.sync();
    expect(meshed).toHaveLength(6);
  });

  it('the whole-world bounds take in every skin', async () => {
    const { layer } = setup();
    await layer.sync();
    const box = new THREE.Box3();
    layer.boundsOfAll(box);
    expect(box.max.x - box.min.x).toBeCloseTo(8);
  });
});
