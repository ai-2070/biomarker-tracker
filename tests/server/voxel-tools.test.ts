// The agents' world tools: building is low risk, changing what someone else built asks first,
// and a whole WORLD.md rewrite needs a fresh read.
import { afterEach, describe, expect, it } from 'vitest';
import { callTool, toolDefs, allTools } from '../../server/tools.ts';
import { newAgent } from '../../server/library.ts';
import { decide, listApprovals, setReviewer } from '../../server/approvals.ts';
import { saveSettings } from '../../server/store.ts';
import { shownWorld } from '../../server/voxel/link.ts';
import { buildSystemPrompt } from '../../server/engines/index.ts';

const tick = () => new Promise((r) => setTimeout(r, 10));
afterEach(() => {
  for (const a of listApprovals()) decide(a.id, { approved: false });
});
saveSettings({ brainApproves: false });
setReviewer(null);

const mira = newAgent({ name: 'Mira', toolGroups: ['world'], autonomy: 'auto' });
const kenji = newAgent({ name: 'Kenji', toolGroups: ['world'], autonomy: 'auto' });

describe('world tools', () => {
  it('come with the "world" tool group, with honest risks', () => {
    const names = toolDefs(mira).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['world_info', 'world_build', 'world_object', 'world_undo', 'world_prefab', 'world_light', 'world_effect', 'world_environment', 'world_md_read', 'world_md_section', 'world_md_write']));
    expect(toolDefs(newAgent({ name: 'Plain', toolGroups: [] })).some((t) => t.name.startsWith('world_'))).toBe(false);
    const risk = Object.fromEntries(allTools().map((t) => [t.name, t.risk]));
    expect(risk).toMatchObject({ world_info: 'none', world_build: 'low', world_object: 'varies', world_prefab: 'varies', world_light: 'varies', world_effect: 'varies', world_environment: 'low', world_md_read: 'none' });
    // the step language, prefabs and placing are in the build tool's description; nothing ready-made
    const build = toolDefs(mira).find((t) => t.name === 'world_build')!;
    expect(build.description).toMatch(/"voxel_size": 0.1/);
    expect(build.description).toMatch(/\{"place": "Palm tree"/);
    expect(build.description).toMatch(/nothing comes ready-made/);
    expect(build.description).not.toMatch(/torii|generator/i);
  });

  it('an agent builds without asking, and the answer says what it made', async () => {
    const r = await callTool(mira, 'world_build', { object: 'Pond', steps: [{ box: [3, 1, 3], use: 'water' }] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/Built "Pond".*9 voxels added/);
    expect(listApprovals()).toHaveLength(0);
    const bad = await callTool(mira, 'world_build', { object: 'Pond', steps: [{ box: 'big' }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/^Nothing was built\. Step 1 \(box\)/);
  });

  it("changing someone else's object asks first, and a no changes nothing", async () => {
    const pending = callTool(kenji, 'world_build', { object: 'Pond', steps: [{ box: [1, 1, 1], use: 'stone' }] });
    await tick();
    const [a] = listApprovals();
    expect(a.title).toMatch(/Kenji wants to use world_change_others/);
    expect(a.detail).toMatch(/Kenji wants to change "Pond", which Mira built/);
    decide(a.id, { approved: false });
    const r = await pending;
    expect(r.isError).toBe(true);
    expect(shownWorld().world!.objects.find((o) => o.name === 'Pond')!.volumes[0].count).toBe(9);
    // deleting is high risk for anyone (autonomy "auto" asks)
    const del = callTool(mira, 'world_object', { object: 'Pond', delete: true });
    await tick();
    expect(listApprovals()).toHaveLength(1);
    decide(listApprovals()[0].id, { approved: true });
    expect((await del).text).toMatch(/Deleted "Pond"/);
    expect((await callTool(mira, 'world_undo', {})).text).toMatch(/Undid: Mira deleted Pond/);
  });

  it("deleting someone else's object asks once, and the model can't pick another project's world", async () => {
    await callTool(mira, 'world_build', { object: 'Bridge', steps: [{ box: [4, 1, 1], use: 'wood' }] });
    const del = callTool(kenji, 'world_object', { object: 'Bridge', delete: true, project: 'some-other-project' });
    await tick();
    expect(listApprovals()).toHaveLength(1);
    decide(listApprovals()[0].id, { approved: true });
    await tick();
    expect(listApprovals()).toHaveLength(0);
    expect((await del).text).toMatch(/Deleted "Bridge"/);
    expect(shownWorld().world!.objects.some((o) => o.name === 'Bridge')).toBe(false);
  });

  it('WORLD.md: a section edit any time, a whole rewrite only after a fresh read', async () => {
    expect((await callTool(mira, 'world_md_section', { section: 'Places › Pond', content: 'Still water by the Brain.' })).isError).toBe(false);
    const blind = await callTool(kenji, 'world_md_write', { content: '# New\n\nAll new.' });
    expect(blind).toMatchObject({ isError: true, text: expect.stringMatching(/Read WORLD.md with world_md_read first/) });
    const read = await callTool(kenji, 'world_md_read', {});
    expect(read.text).toContain('Still water by the Brain.');
    await callTool(mira, 'world_md_section', { section: 'Story so far', content: '- the pond', append: true });
    expect((await callTool(kenji, 'world_md_write', { content: '# New\n\nAll new.' })).text).toMatch(/changed since you read it/);
    await callTool(kenji, 'world_md_read', {});
    expect((await callTool(kenji, 'world_md_write', { content: '# New\n\nAll new.' })).text).toMatch(/Saved WORLD.md/);
  });

  it("a section edit doesn't count as reading the whole of WORLD.md", async () => {
    const sol = newAgent({ name: 'Sol', toolGroups: ['world'], autonomy: 'auto' });
    await callTool(mira, 'world_md_section', { section: 'Places › Grove', content: 'Old trees.' });
    expect((await callTool(sol, 'world_md_section', { section: 'Story so far', content: '- a walk', append: true })).isError).toBe(false);
    expect((await callTool(sol, 'world_md_write', { content: '# Mine\n\nOnly mine.' })).text).toMatch(/Read WORLD.md with world_md_read first/);
    // after a read, its own section edits keep it up to date
    await callTool(sol, 'world_md_read', {});
    await callTool(sol, 'world_md_section', { section: 'Story so far', content: '- a swim', append: true });
    expect((await callTool(sol, 'world_md_write', { content: '# New\n\nAll new.' })).text).toMatch(/Saved WORLD.md/);
  });

  it("builders get WORLD.md in their instructions; others don't", () => {
    expect(buildSystemPrompt(mira)).toMatch(/# The voxel world: .*\n[\s\S]*<world-md>\n# New/);
    expect(buildSystemPrompt(newAgent({ name: 'Plain', toolGroups: [] }))).not.toMatch(/voxel world/);
  });
});

describe('a diorama, not a level', () => {
  it('builders, world_info and every member of a team with a builder hear it; other teams do not', async () => {
    const { workflows, agents } = await import('../../server/store.ts');
    const { briefing } = await import('../../server/teams.ts');
    const { BUILD_ORDER, DIORAMA } = await import('../../server/voxel/diorama.ts');
    expect(buildSystemPrompt(mira)).toContain(DIORAMA);
    expect(buildSystemPrompt(mira)).toContain(BUILD_ORDER);
    expect(BUILD_ORDER).toMatch(/first the shape of the terrain .* then the buildings .* then the props/);
    expect(toolDefs(mira).find((t) => t.name === 'world_build')!.description).toMatch(/a diorama to look at \(nobody walks through it or plays it/);
    expect((await callTool(mira, 'world_info', {})).text).toMatch(/The world is a diorama to look at/);
    const designer = agents.save(newAgent({ name: 'Level Designer', toolGroups: ['files'] }));
    const builder = agents.save(mira);
    const team = workflows.save({ name: 'World team', members: [designer.id, builder.id], steps: [], schedule: { type: 'none' }, enabled: false } as unknown as Parameters<typeof workflows.save>[0]);
    expect(briefing(team, designer)).toContain(`This team builds in the voxel world. ${DIORAMA}\n${BUILD_ORDER} Plan and hand out the work in that order.`);
    const plain = workflows.save({ name: 'Writers', members: [designer.id], steps: [], schedule: { type: 'none' }, enabled: false } as unknown as Parameters<typeof workflows.save>[0]);
    expect(briefing(plain, designer)).not.toMatch(/diorama/);
  });
});
