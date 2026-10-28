// world_script: a builder's JavaScript program, sealed off in QuickJS, builds through the same build as
// world_build (limits, all-or-nothing, undo). What it can and can't do, and what it says when it goes wrong.
import { describe, expect, it } from 'vitest';
import { callTool } from '../../server/tools.ts';
import { newAgent } from '../../server/library.ts';
import { agents, saveSettings } from '../../server/store.ts';
import { shownWorld } from '../../server/voxel/link.ts';
import { readObject } from '../../server/voxel/store.ts';
import { SCRIPT_LIMITS } from '../../server/voxel/script.ts';

saveSettings({ look: { stationLook: 'world' } });
const a = agents.save(newAgent({ name: 'Coder', toolGroups: ['world'], autonomy: 'full' }));
const script = (args: Record<string, unknown>) => callTool(a, 'world_script', args);
const obj = (name: string) => shownWorld().world?.objects.find((o) => o.name === name);
const data = (name: string) => readObject(shownWorld().world!.id, obj(name)!.id);

describe('world_script', () => {
  it('builds the same voxels as the same steps by hand, in map units', async () => {
    const r = await script({ object: 'Row', code: 'use("stone");\nfor (let i = 0; i < 4; i++) box([i * 2, 0, 0], [1, 1 + i, 1]);' });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/Built "Row".*\b640 voxels added/);
    await callTool(a, 'world_build', { object: 'Row by hand', units: 'map', steps: [{ use: 'stone' }, ...[0, 1, 2, 3].map((i) => ({ box: [1, 1 + i, 1], at: [i * 2, 0, 0] }))] });
    expect(data('Row')!.volumes[0].chunks).toEqual(data('Row by hand')!.volumes[0].chunks);
  });

  it('single voxels by the thousand, reading back what is built, a seeded random and noise, and a log', async () => {
    const code = `use("sand");
for (let x = 0; x < 80; x++) for (let z = 0; z < 80; z++) set(x * 0.25, 0, z * 0.25);
log("solid:", solid(1, 0.1, 1), "air:", solid(1, 3, 1), "top:", top(1, 1), "material:", materialAt(1, 0.1, 1));
const r1 = random(); log("random", r1 >= 0 && r1 < 1, "noise", noise(3, 4) >= 0 && noise(3, 4) <= 1);`;
    const r = await script({ object: 'Sand', code });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/6,400 voxels added/);
    expect(r.text).toMatch(/The script's log:\nsolid: true air: false top: 0\.25 material: sand\nrandom true noise true/);
    // the same seed gives the same build; another seed another one
    const pick = 'use("stone"); for (let i = 0; i < 30; i++) set(Math.floor(random() * 40) * 0.25, 0, 0);';
    await script({ object: 'Seeded A', code: pick, seed: 5 });
    await script({ object: 'Seeded B', code: pick, seed: 5 });
    await script({ object: 'Seeded C', code: pick, seed: 6 });
    expect(data('Seeded A')!.volumes[0].chunks).toEqual(data('Seeded B')!.volumes[0].chunks);
    expect(data('Seeded A')!.volumes[0].chunks).not.toEqual(data('Seeded C')!.volumes[0].chunks);
  });

  it('says which line went wrong, and builds nothing', async () => {
    const syntax = await script({ object: 'Broken', code: 'use("stone");\nbox([0, 0, 0], [1, 1, 1]\n' });
    expect(syntax).toMatchObject({ isError: true, text: expect.stringMatching(/^Nothing was built\. Line \d+.*SyntaxError/) });
    const typo = await script({ object: 'Broken', code: 'use("stone");\nbox([0, 0, 0], [1, 1, 1]);\nbx([0, 0, 0], [1, 1, 1]);' });
    expect(typo.text).toMatch(/^Nothing was built\. Line 3 \(bx\(\[0, 0, 0\], \[1, 1, 1\]\);\): ReferenceError: 'bx' is not defined/);
    const step = await script({ object: 'Broken', code: 'use("stone");\nbox([0, 0, 0], [1, 1, 1]);\nbox([0, 0, 0], "big");' });
    expect(step.text).toMatch(/^Nothing was built\. Line 3 .*box/);
    // a step that failed fails the build even when the script catches it
    const caught = await script({ object: 'Broken', code: 'use("stone");\nbox([0, 0, 0], [1, 1, 1]);\ntry { box([0, 0, 0], "big"); } catch (e) {}' });
    expect(caught.text).toMatch(/^Nothing was built\. A step failed: .* \(the script caught it, but nothing was built: fix the step\)/);
    expect(obj('Broken')).toBeUndefined();
    // a script that builds and then throws builds nothing either
    await script({ object: 'Half', code: 'use("stone"); box([0, 0, 0], [2, 2, 2]); throw new Error("changed my mind");' });
    expect(obj('Half')).toBeUndefined();
  });

  it('is sealed off: no files, network, timers or the computer, and a script that runs forever is stopped', async () => {
    const r = await script({ object: 'Probe', code: 'log([typeof require, typeof process, typeof fetch, typeof setTimeout, typeof globalThis.Bun, typeof XMLHttpRequest].join(","));\nuse("stone"); box([0, 0, 0], [1, 1, 1]);' });
    expect(r.text).toMatch(/The script's log:\nundefined,undefined,undefined,undefined,undefined,undefined/);
    expect((await script({ object: 'Probe 2', code: 'import("fs").then(() => log("got it"));' })).text).not.toMatch(/got it/);
    const was = SCRIPT_LIMITS.ms;
    SCRIPT_LIMITS.ms = 300;
    try {
      const t = Date.now();
      const forever = await script({ object: 'Forever', code: 'while (true) {}' });
      expect(forever.text).toMatch(/ran longer than 0\.3 seconds and was stopped\. Nothing was built/);
      expect(Date.now() - t).toBeLessThan(5000);
    } finally {
      SCRIPT_LIMITS.ms = was;
    }
    expect((await script({ object: 'Long', code: `// ${'x'.repeat(SCRIPT_LIMITS.codeChars)}` })).text).toMatch(/at most 40,000 characters/);
  });

  it('places prefab copies, builds a prefab, and is undone like any build', async () => {
    await callTool(a, 'world_build', { prefab: 'Post', units: 'map', voxel_size: 0.125, steps: [{ use: 'wood' }, { box: [0.25, 1, 0.25], at: [-0.125, 0, -0.125] }] });
    const fence = await script({ object: 'Fence', code: 'for (let i = 0; i < 10; i++) place("Post", [i * 1.5, 0, 0], { turn: i * 9 });' });
    expect(fence.text).toMatch(/10 copies placed/);
    expect(data('Fence')!.instances!.map((i) => i.p[0])).toEqual([0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5]);
    const tree = await script({ prefab: 'Little tree', voxel_size: 0.125, code: 'use("bark"); cylinder([0, 0, 0], 0.125, 1.2);\nuse("leaves");\nfunction crown(y, r) { if (r < 0.2) return; blob([0, y, 0], [r, r * 0.8, r]); crown(y + r, r * 0.6); }\ncrown(1.4, 0.6);' });
    expect(tree.isError, tree.text).toBeFalsy();
    expect(tree.text).toMatch(/Built the prefab "Little tree"/);
    expect((await callTool(a, 'world_undo', {})).text).toMatch(/Undid: Coder built the prefab Little tree/);
  });
});
