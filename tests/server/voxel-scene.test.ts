// Finishing passes, lights, effects and the environment: building the look as well as the voxels.
import { describe, expect, it } from 'vitest';
import { runBuild } from '../../server/voxel/ops.ts';
import type { Grid } from '../../server/voxel/ops.ts';
import { countVoxels, getVoxel } from '../../shared/voxel.ts';
import { build, undo } from '../../server/voxel/build.ts';
import { setEffect, setEnvironment, setLight } from '../../server/voxel/scene.ts';
import { shownWorld } from '../../server/voxel/link.ts';
import { worldInfo } from '../../server/voxel/describe.ts';
import type { VoxelMaterial, WorldBuilder } from '../../shared/types.ts';

let n = 0;
function run(steps: unknown[], grids: Grid[] = [], palette: VoxelMaterial[] = []) {
  const out = runBuild({ grids, palette, voxelSize: 0.25, steps, newId: () => `g${++n}` });
  return { ...out, palette, g: grids[0].vol };
}
const nameAt = (r: ReturnType<typeof run>, x: number, y: number, z: number) => r.palette[getVoxel(r.g, x, y, z) - 1]?.name;

describe('finishing passes', () => {
  it('snow covers every ledge the sky can see, not under an overhang', () => {
    // a floor 5 wide with a roof over its left part
    const r = run([{ box: [5, 1, 1], use: 'stone' }, { box: [2, 1, 1], at: [0, 4, 0], use: 'stone' }, { snow_cover: { chance: 1 } }]);
    expect(nameAt(r, 4, 1, 0)).toBe('snow');
    expect(nameAt(r, 0, 5, 0)).toBe('snow');
    expect(getVoxel(r.g, 0, 1, 0)).toBe(0);
    // sheltered: under the roof too
    expect(nameAt(run([{ box: [5, 1, 1], use: 'stone' }, { box: [2, 1, 1], at: [0, 4, 0], use: 'stone' }, { snow_cover: { chance: 1, sheltered: true } }]), 0, 1, 0)).toBe('snow');
  });

  it('only inside the box when one is given, and deeper snow', () => {
    const r = run([{ box: [6, 1, 1], use: 'stone' }, { snow_cover: { chance: 1, depth: 2 }, in: [3, 4, 1] }]);
    expect([nameAt(r, 0, 1, 0), nameAt(r, 0, 2, 0), getVoxel(r.g, 4, 1, 0)]).toEqual(['snow', 'snow', 0]);
  });

  it('overgrow adds tufts on top and vines down walls', () => {
    const r = run([{ box: [8, 6, 8], use: 'brick' }, { seed: 2 }, { overgrow: { chance: 0.6, hang: 4 } }]);
    const moss = r.palette.findIndex((m) => m.name === 'moss') + 1;
    let top = 0;
    let side = 0;
    for (let x = -1; x <= 8; x++)
      for (let z = -1; z <= 8; z++)
        for (let y = 0; y <= 6; y++) {
          if (getVoxel(r.g, x, y, z) !== moss) continue;
          if (y === 6) top++;
          else side++;
        }
    expect(top).toBeGreaterThan(10);
    expect(side).toBeGreaterThan(5);
  });

  it('weather adds darker worn copies of materials, more near the bottom', () => {
    const r = run([{ box: [10, 20, 10], use: 'stone' }, { weather: { amount: 0.5 } }]);
    const worn = r.palette.find((m) => m.name === 'stone worn')!;
    expect(worn.color < r.palette[0].color).toBe(true);
    const wornAt = (y: number) => {
      let c = 0;
      for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) if (nameAt(r, x, y, z) === 'stone worn') c++;
      return c;
    };
    expect(wornAt(0) + wornAt(1)).toBeGreaterThan(wornAt(18) + wornAt(19));
    expect(countVoxels(r.g)).toBe(2000);
  });
});

const me: WorldBuilder = { kind: 'agent', id: 'mira', name: 'Mira' };

describe('lights, effects and the environment', () => {
  it('lights: add, change, pin to an object, take away, undo', () => {
    build({ by: me, object: 'Temple', steps: [{ box: [8, 8, 8], use: 'sand' }] });
    const r = setLight({ by: me, action: 'add', fields: { name: 'Doorway', kind: 'spot', color: '#ffb860', intensity: 5, range: 10, object: 'Temple', position: [1, 2, 2.5], target: [1, 0, 6] } });
    expect(r.text).toMatch(/Put up the light "Doorway": a spot light, #ffb860, intensity 5.*from the object "Temple"/);
    expect(r.light!.object).toBe(shownWorld().world!.objects[0].id);
    expect(setLight({ by: me, action: 'change', light: 'doorway', fields: { flicker: 0.4, intensity: 50 } }).light!).toMatchObject({ flicker: 0.4, intensity: 10 });
    expect(() => setLight({ by: me, action: 'add', fields: { color: 'orange' } })).toThrow(/colour like/);
    setLight({ by: me, action: 'remove', light: 'Doorway' });
    expect(shownWorld().world!.lights).toEqual([]);
    undo(me);
    expect(shownWorld().world!.lights.map((l) => l.name)).toEqual(['Doorway']);
  });

  it('effects need a kind, are checked, and show in world_info', () => {
    expect(() => setEffect({ by: me, action: 'add', fields: {} })).toThrow(/Say which kind/);
    expect(() => setEffect({ by: me, action: 'add', fields: { kind: 'lava' } })).toThrow(/kind is one of/);
    setEffect({ by: me, action: 'add', fields: { kind: 'fireflies', name: 'Pond lights', size: [6, 2, 6], amount: 0.7, position: [3, 0, -4] } });
    expect(worldInfo()).toMatch(/effect "Pond lights" by Mira: fireflies, amount 0.7, 6×2×6/);
    expect(worldInfo()).toMatch(/light "Doorway"/);
  });

  it("world_info tells builders they may set the time of day; the Brain's view doesn't name the tool", async () => {
    expect(worldInfo()).toMatch(/Change the time of day \(station, day, golden, dusk, night, overcast, snow\), sun, sky, fog, weather or wind with world_environment; you don't need to ask\./);
    const { worldText } = await import('../../server/voxel/describe.ts');
    expect(worldText(shownWorld().world!, { how: 'own' })).not.toMatch(/world_environment/);
  });

  it('environment: a preset, then any part of it, eased by the page, and undone', () => {
    const r = setEnvironment({ by: me, fields: { preset: 'dusk', sun: { elevation: 6 }, weather: 'snow', wind: [1, 0, 0.5] } });
    expect(r.world.environment).toMatchObject({ preset: 'dusk', weather: 'snow', wind: [1, 0, 0.5] });
    expect(r.world.environment.sun.elevation).toBe(6);
    // a new preset keeps the weather
    expect(setEnvironment({ by: me, fields: { preset: 'night' } }).world.environment).toMatchObject({ preset: 'night', weather: 'snow' });
    expect(() => setEnvironment({ by: me, fields: { preset: 'noon' } })).toThrow(/preset is one of/);
    expect(() => setEnvironment({ by: me, fields: { weather: 'hail' } })).toThrow(/weather is one of/);
    undo(me);
    expect(shownWorld().world!.environment.preset).toBe('dusk');
  });
});
