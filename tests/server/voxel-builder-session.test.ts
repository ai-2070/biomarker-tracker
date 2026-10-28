// A builder's session through the real tools, in map units: a street with lamps along it and a crowd, a
// character made of parts that an agent wears, a house with windows. What it reads back must be right.
import { describe, expect, it } from 'vitest';
import { callTool, toolDefs } from '../../server/tools.ts';
import { newAgent } from '../../server/library.ts';
import { agents, saveSettings } from '../../server/store.ts';
import { shownWorld } from '../../server/voxel/link.ts';
import { readObject, readPrefab } from '../../server/voxel/store.ts';
import { STEPS_HELP, STEP_TOPICS } from '../../server/voxel/tools.ts';

saveSettings({ look: { stationLook: 'world' } });
const a = agents.save(newAgent({ name: 'Builder', toolGroups: ['world'], autonomy: 'full' }));
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await callTool(a, name, args);
  expect(r.isError, r.text).toBeFalsy();
  return r.text;
};
const w = () => shownWorld().world!;
const prefab = (name: string) => w().prefabs.find((p) => p.name === name)!;

describe('a builder session in map units', () => {
  it('lamps along a street stand exactly every 4 map units, on both sides', async () => {
    await call('world_build', { object: 'Street', units: 'map', voxel_size: 0.5, steps: [{ use: 'cobble' }, { box: [30, 0.5, 6], at: [-15, -0.5, -3] }] });
    await call('world_build', { prefab: 'Street lamp', units: 'map', voxel_size: 0.1, steps: [{ use: 'iron' }, { cylinder: 0.1, height: 2.4 }, { use: 'lantern' }, { box: [0.3, 0.3, 0.3], at: [-0.15, 2.4, -0.15] }] });
    const text = await call('world_build', { object: 'Street', units: 'map', steps: [{ place: 'Street lamp', along: [[-14, 0], [14, 0]], every: 4, sides: 2, offset: 2.5 }] });
    expect(text).toMatch(/16 copies placed/);
    const street = w().objects.find((o) => o.name === 'Street')!;
    const spots = readObject(w().id, street.id)!.instances!.map((i) => i.p);
    expect(new Set(spots.map((p) => p[0]))).toEqual(new Set([-14, -10, -6, -2, 2, 6, 10, 14]));
    expect(new Set(spots.map((p) => Math.abs(p[2])))).toEqual(new Set([2.5]));
    // standing on the street, whose top is y = 0
    expect(spots.every((p) => p[1] === 0)).toBe(true);
  });

  it('a character of parts: the arms where they were asked, its size with the parts, its pivot named right', async () => {
    const arm = await call('world_build', { prefab: 'Arm', units: 'map', voxel_size: 0.1, pivot: 'top', steps: [{ use: 'skin medium' }, { box: [0.1, 0.5, 0.1] }] });
    expect(arm).toMatch(/It hangs from its top centre where it is placed/);
    await call('world_build', { prefab: 'Body', units: 'map', voxel_size: 0.1, steps: [{ use: 'cloth white' }, { box: [0.4, 1.5, 0.2], at: [-0.2, 0, -0.1] }] });
    const robot = await call('world_build', { prefab: 'Robot', units: 'map', steps: [{ place: 'Body', name: 'body' }, { place: 'Arm', at: [-0.3, 1.1, 0], name: 'left arm' }, { place: 'Arm', at: [0.3, 1.1, 0], name: 'right arm' }] });
    expect(robot).toMatch(/0 voxels \(by voxel size: none\) and 3 placed copies, all of it in those copies/);
    expect(robot).toMatch(/it is 0\.7×1\.5×0\.2 map units with the copies inside it/);
    const parts = readPrefab(w().id, prefab('Robot').id)!.instances!;
    expect(parts.find((i) => i.name === 'left arm')!.p).toEqual([-0.3, 1.1, 0]);
    expect(parts.find((i) => i.name === 'right arm')!.p).toEqual([0.3, 1.1, 0]);
    expect(prefab('Robot').size).toEqual([0.7, 1.5, 0.2]);
    await call('world_skin', { to: 'agent', character: 'Robot' });
    const list = await call('world_prefab', { action: 'list' });
    expect(list).toMatch(/"Robot" .* 0\.7×1\.5×0\.2 map units, .* \| worn as the character of Builder/);
    expect(list).toMatch(/"Body" .* \| 1 copy in the prefab "Robot"/);
    expect(await call('world_info', {})).toMatch(/"Robot" by Builder: no description \| 0\.7×1\.5×0\.2 map units, 0 voxels and 3 copies of other prefabs/);
  });

  it('sizes keep two decimals; stamped windows go where asked', async () => {
    expect(await call('world_build', { prefab: 'Window', units: 'map', steps: [{ use: 'glass' }, { box: [1, 1, 0.25] }] })).toMatch(/1×1×0\.25 map units \(x 0\.\.1, y 0\.\.1, z 0\.\.0\.25/);
    const house = await call('world_build', { object: 'House', units: 'map', position: [0, 0, 8], steps: [{ use: 'brick' }, { extrude: { points: [[0, 0], [6, 0], [6, 4], [0, 4]] }, height: 3, wall: 0.25 }, { stamp: 'Window', at: [1, 1, 0] }, { stamp: 'Window', at: [4, 1, 0] }] });
    expect(house).toMatch(/6×3×4 map units/);
    expect(house).toMatch(/32 repainted/);
  });
});

describe('the step help', () => {
  it("world_build's description has the common steps and points to world_steps for the rest", () => {
    const build = toolDefs(a).find((t) => t.name === 'world_build')!;
    expect(build.description).toContain(STEPS_HELP);
    expect(STEPS_HELP.length).toBeLessThan(2200);
    expect(STEPS_HELP).toMatch(/"units": "map"/);
    expect(STEPS_HELP).toMatch(/world_steps/);
  });

  it('world_steps has every topic, and all of them together', async () => {
    expect(await call('world_steps', { topic: 'regions' })).toBe(STEP_TOPICS.regions);
    const all = await call('world_steps', {});
    for (const t of Object.values(STEP_TOPICS)) expect(all).toContain(t);
    for (const verb of ['stairs', 'arch', 'snow_cover', 'unplace', 'stamp', 'heightmap']) expect(all).toContain(`"${verb}"`);
    const bad = await callTool(a, 'world_steps', { topic: 'dragons' });
    expect(bad).toMatchObject({ isError: true, text: expect.stringMatching(/Topics: units, state/) });
  });
});
