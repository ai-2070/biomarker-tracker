// Characters made of named parts, animations their builders design, and skins that dress (or hide) the
// Brain, teams and agents in the voxel world.
import { describe, expect, it } from 'vitest';
import { build, undo } from '../../server/voxel/build.ts';
import { partNames, playAnimation, setAnimation, setSkin, skinsText } from '../../server/voxel/characters.ts';
import { changePrefab } from '../../server/voxel/prefabs.ts';
import { shownWorld } from '../../server/voxel/link.ts';
import { readPrefab } from '../../server/voxel/store.ts';
import { agents, bus, workflows } from '../../server/store.ts';
import { newAgent } from '../../server/library.ts';
import type { ServerEvent, WorldBuilder } from '../../shared/types.ts';

const mira = agents.save(newAgent({ name: 'Mira', toolGroups: ['world'] }));
const team = workflows.save({ name: 'Gardeners', members: [mira.id], steps: [], schedule: { type: 'none' }, enabled: false } as unknown as Parameters<typeof workflows.save>[0]);
const me: WorldBuilder = { kind: 'agent', id: mira.id, name: 'Mira' };
const w = () => shownWorld().world!;

describe('characters', () => {
  it('a part prefab can hang from its top; changing the pivot moves where copies stand', () => {
    build({ by: me, prefab: 'Arm', pivot: 'top', steps: [{ voxel_size: 0.1 }, { box: [1, 5, 1], use: 'skin light' }] });
    const arm = w().prefabs.find((p) => p.name === 'Arm')!;
    expect(arm.pivotAt).toBe('top');
    expect(arm.pivot).toEqual([0.05, 0.5, 0.05]);
    expect(changePrefab({ by: me, prefab: 'Arm', pivot: 'center' }).text).toMatch(/pivot \(now 0.05, 0.25, 0.05/);
    changePrefab({ by: me, prefab: 'Arm', pivot: 'top' });
    expect(() => build({ by: me, prefab: 'Arm', pivot: 'left', steps: [{ box: [1, 1, 1], use: 'stone' }] })).toThrow(/pivot is "bottom", "top"/);
  });

  it('a character places its parts one at a time, by name', () => {
    build({ by: me, prefab: 'Body', steps: [{ voxel_size: 0.1 }, { box: [3, 6, 2], at: [-1, 0, -1], use: 'cloth white' }] });
    build({ by: me, prefab: 'Gardener', steps: [{ voxel_size: 0.1 }, { place: 'Body', at: [0, 0, 0], name: 'body' }, { place: 'Arm', at: [-2, 6, 0], name: 'Left arm' }, { place: 'Arm', at: [2, 6, 0], name: 'right arm', mirror: true }] });
    const data = readPrefab(w().id, w().prefabs.find((p) => p.name === 'Gardener')!.id)!;
    expect(data.instances!.map((i) => i.name)).toEqual(['body', 'left arm', 'right arm']);
    expect(partNames(w(), w().prefabs.find((p) => p.name === 'Gardener')!.id)).toEqual(['body', 'left arm', 'right arm']);
    expect(() => build({ by: me, prefab: 'Gardener', steps: [{ place: 'Arm', name: 'body' }] })).toThrow(/already a part called "body"/);
    expect(() => build({ by: me, prefab: 'Gardener', steps: [{ place: 'Arm', grid: { rows: 2, cols: 1 }, name: 'x' }] })).toThrow(/one copy at a time/);
  });

  it('animations: keys per part, checked, sorted, with a note for parts it lacks', () => {
    const r = setAnimation({ by: me, prefab: 'Gardener', action: 'set', clip: 'Working', fields: { duration: 0.8, tracks: { 'left arm': [{ t: 1, turn: [0, 0, 0] }, { t: 0, turn: [0, 0, 0] }, { t: 0.5, turn: [-50, 0, 0], ease: 'smooth' }], self: [{ t: 0.5, move: [0, 0.05, 0] }], tail: [{ t: 0, scale: 2 }] } } });
    expect(r.text).toMatch(/Saved the animation "working" of "Gardener": 0.8s, looping/);
    expect(r.text).toMatch(/no part called "tail"/);
    expect(r.text).toMatch(/plays "working" when it is working/);
    const clip = w().prefabs.find((p) => p.name === 'Gardener')!.animations!.working;
    expect(clip.tracks['left arm'].map((k) => k.t)).toEqual([0, 0.5, 1]);
    expect(() => setAnimation({ by: me, prefab: 'Gardener', action: 'set', clip: 'x', fields: { tracks: { 'left arm': [{ t: 0 }] } } })).toThrow(/give turn, move or scale/);
    expect(() => setAnimation({ by: me, prefab: 'Gardener', action: 'set', clip: 'x', fields: { tracks: { body: [{ t: 0, turn: [0, 0, 0], ease: 'wobbly' }] } } })).toThrow(/ease is linear/);
    expect(setAnimation({ by: me, prefab: 'Gardener', action: 'list' }).text).toMatch(/parts: body, left arm, right arm[\s\S]*"working": 0.8s/);
  });
});

describe('skins', () => {
  it('dress an agent: character, states; play an animation once', () => {
    const r = setSkin({ by: me, to: 'agent', id: 'Mira', fields: { character: 'Gardener', states: { working: 'working', idle: 'missing' }, offset: [0, 0, 0.3] } });
    expect(r.text).toMatch(/Mira in this world: the character "Gardener", animations idle: "missing", working: "working", moved 0, 0, 0.3\. Note: "Gardener" has no animation "missing" yet/);
    expect(w().skins.agents[mira.id].character).toBe(w().prefabs.find((p) => p.name === 'Gardener')!.id);
    const seen: ServerEvent[] = [];
    const on = (e: ServerEvent) => seen.push(e);
    bus.on('event', on);
    expect(playAnimation({ by: me, agent: 'mira', clip: 'working', times: 3 })).toBe('Mira plays "working" 3 times.');
    bus.off('event', on);
    expect(seen.find((e) => e.type === 'world-anim')).toMatchObject({ agent: mira.id, clip: 'working', times: 3 });
    expect(() => playAnimation({ by: me, agent: 'mira', clip: 'dance' })).toThrow(/no animation "dance"/);
    expect(() => setSkin({ by: me, to: 'agent', id: 'Mira', fields: { character: 'Nobody' } })).toThrow(/no prefab "Nobody"/);
  });

  it('hide a team platform and its label, take the Brain\'s globe away, undo, and look classic again', () => {
    setSkin({ by: me, to: 'team', id: team.id, fields: { hidden: true, label: false } });
    setSkin({ by: me, to: 'brain', fields: { globe: false, scale: 1.5 } });
    expect(skinsText(w())).toMatch(/team Gardeners: hidden from the map, no name label/);
    expect(skinsText(w())).toMatch(/the Brain: no globe, scale 1.5/);
    undo(me);
    expect(w().skins.brain).toBeUndefined();
    setSkin({ by: me, to: 'team', id: 'gardeners', fields: { clear: true } });
    expect(w().skins.teams[team.id]).toBeUndefined();
    expect(() => setSkin({ by: me, to: 'team', id: 'Nope', fields: { hidden: true } })).toThrow(/no team "Nope"/);
  });
});

describe('world_info: where the platforms and desks are', () => {
  it('gives each platform its centre and every desk its spot, as the Station draws them', async () => {
    const { worldInfo } = await import('../../server/voxel/describe.ts');
    const { teamSpots } = await import('../../shared/stationlayout.ts');
    const text = worldInfo({ agentId: mira.id });
    const [spot] = teamSpots([{ id: team.id, members: [mira.id] }], { benchCount: agents.list().length > 1 ? 1 : 0, hasAgent: () => true });
    const xz = (p: [number, number]) => `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`;
    expect(text).toContain(`- team "Gardeners" (anchor team:${team.id}): centre ${xz(spot.center)}, platform radius ${spot.radius.toFixed(1)}, 1 agent ← your team; desks: Mira at ${xz(spot.desks[0].at)}`);
    expect(text).toMatch(/each takes a circle of 1.6 map units around its spot/);
    expect(text).toContain(`centre ${xz(spot.center)}). Build there unless asked otherwise.`);
  });
});
