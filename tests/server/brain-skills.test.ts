import os from 'node:os';
import path from 'node:path';
// The Brain manages skills: makes, edits (whole text only once it has seen it), gives, takes back and
// deletes them, and comes with the Self-improvement skill.
import { describe, expect, it } from 'vitest';
import { applyActions, skillTexts, skillsNamedIn } from '../../server/overseer.ts';
import * as skills from '../../server/skills.ts';
import { agents, workflows, activeProject, getSettings, saveSettings } from '../../server/store.ts';
import { newAgent } from '../../server/library.ts';
import { listVersions } from '../../server/versions.ts';
import type { Team } from '../../shared/types.ts';

const body = '## Steps\n1. Open the brief.\n2. Write the draft.';

describe('the Brain makes and edits skills', () => {
  it('makes a skill, and refuses a second one with the same name', () => {
    const r = applyActions([{ do: 'create_skill', name: 'Weekly newsletter', description: 'Use when writing the weekly newsletter.', body }]);
    expect(r.done).toEqual([expect.objectContaining({ kind: 'skill', skillId: 'weekly-newsletter' })]);
    expect(skills.getSkill('weekly-newsletter')?.body).toContain('Write the draft');
    const again = applyActions([{ do: 'create_skill', name: 'weekly newsletter', description: 'x', body }]);
    expect(again.done[0]).toMatchObject({ kind: 'error', text: expect.stringContaining('update it instead') });
  });

  it('a skill needs its instructions', () => {
    const r = applyActions([{ do: 'create_skill', name: 'Empty one', description: 'Use never.', body: '' }]);
    expect(r.done[0].kind).toBe('error');
    expect(skills.getSkill('empty-one')).toBeNull();
  });

  it('appends without having seen the skill, but rewrites only one it has seen, keeping the old version', () => {
    skills.saveSkill({ name: 'Render checklist', description: 'Use before rendering.', body: 'Check the camera.' });
    const add = applyActions([{ do: 'update_skill', skill: 'Render checklist', append: '## Pitfalls\n- Turn off denoise for previews.' }]);
    expect(add.done[0].kind).toBe('skill');
    expect(skills.getSkill('render-checklist')?.body).toMatch(/Check the camera\.\n\n## Pitfalls/);

    const blind = applyActions([{ do: 'update_skill', skill: 'render-checklist', body: 'Something else entirely.' }]);
    expect(blind.done[0]).toMatchObject({ kind: 'error', text: expect.stringContaining('read_skill') });
    expect(skills.getSkill('render-checklist')?.body).toContain('Check the camera');

    const seen = applyActions([{ do: 'update_skill', skill: 'render-checklist', body: 'New steps.', description: 'Use before any render.' }], activeProject(), { seenSkills: new Set(['render-checklist']) });
    expect(seen.done[0]).toMatchObject({ kind: 'skill', text: expect.stringContaining('instructions') });
    expect(skills.getSkill('render-checklist')).toMatchObject({ body: expect.stringContaining('New steps.'), description: 'Use before any render.' });
    // each answer of the Brain that changed it is a version of its own, however close together
    const kept = listVersions<{ body: string }>(skills.skillVersionsDir('render-checklist'));
    expect(kept).toHaveLength(2);
    expect(kept[0]).toMatchObject({ by: 'brain', item: { body: expect.stringContaining('## Pitfalls') } });
    expect(kept[1]).toMatchObject({ by: 'brain', item: { body: 'Check the camera.' } });
    expect(skills.getSkill('render-checklist')?.files).toEqual([]);
  });

  it('can rewrite the skill it made earlier in the same answer', () => {
    const r = applyActions([
      { do: 'create_skill', name: 'Fresh skill', description: 'Use for fresh things.', body },
      { do: 'update_skill', skill: 'new', body: 'Rewritten right away.' },
    ]);
    expect(r.done.map((d) => d.kind)).toEqual(['skill', 'skill']);
    expect(skills.getSkill('fresh-skill')?.body).toContain('Rewritten right away.');
  });

  it('gives a skill to an agent, a team, the project and the Brain, and takes it back', () => {
    const a = newAgent({ name: 'Editor' });
    applyActions([{ do: 'create_team', name: 'Video team', members: [{ agent: a.id }] }]);
    const team = workflows.list().find((w) => w.name === 'Video team')!;
    skills.saveSkill({ name: 'Cut list', description: 'Use when editing video.', body });
    const r = applyActions([
      { do: 'give_skill', skill: 'cut-list', to: 'agent', id: a.id },
      { do: 'give_skill', skill: 'Cut list', to: 'team', id: team.id },
      { do: 'give_skill', skill: 'cut-list', to: 'project' },
      { do: 'give_skill', skill: 'cut-list', to: 'brain' },
    ]);
    expect(r.done.every((d) => d.kind === 'skill')).toBe(true);
    expect(agents.get(a.id)?.skills).toContain('cut-list');
    expect(workflows.get(team.id)?.skills).toContain('cut-list');
    expect(activeProject().skills).toContain('cut-list');
    expect(getSettings().brainSkills).toContain('cut-list');

    applyActions([
      { do: 'take_skill', skill: 'cut-list', to: 'agent', id: a.id },
      { do: 'take_skill', skill: 'cut-list', to: 'brain' },
    ]);
    expect(agents.get(a.id)?.skills).not.toContain('cut-list');
    expect(getSettings().brainSkills).not.toContain('cut-list');
    // the skill stays in the library
    expect(skills.getSkill('cut-list')).not.toBeNull();
  });

  it('gives and takes several skills to and from several agents and teams at once, and sets a whole list', () => {
    const a = newAgent({ name: 'Multi A' });
    const b = newAgent({ name: 'Multi B' });
    applyActions([{ do: 'create_team', name: 'Multi team', members: [{ agent: a.id }] }]);
    const team = workflows.list().find((w) => w.name === 'Multi team')!;
    for (const n of ['Multi one', 'Multi two', 'Multi three']) skills.saveSkill({ name: n, description: `Use for ${n}.`, body });
    const r = applyActions([{ do: 'give_skill', skills: ['multi-one', 'Multi two'], targets: [{ to: 'agent', id: a.id }, { to: 'agent', id: 'Multi B' }, { to: 'team', id: team.id }] }]);
    expect(r.done.map((d) => d.text)).toEqual(['Gave "Multi one", "Multi two" to Multi A', 'Gave "Multi one", "Multi two" to Multi B', 'Gave "Multi one", "Multi two" to the team "Multi team"']);
    expect(agents.get(b.id)?.skills).toEqual(['multi-one', 'multi-two']);
    // re-assign: take from A, give to B
    applyActions([
      { do: 'take_skill', skills: ['multi-two'], to: 'agent', id: a.id },
      { do: 'give_skill', skill: 'multi-three', to: 'agent', id: b.id },
    ]);
    expect(agents.get(a.id)?.skills).toEqual(['multi-one']);
    expect(agents.get(b.id)?.skills).toEqual(['multi-one', 'multi-two', 'multi-three']);
    // a whole list: a name it can't find changes nothing (not even the names it can)
    const before = workflows.get(team.id)?.skills;
    const bad = applyActions([{ do: 'set_skills', skills: ['multi-three', 'nope'], to: 'team', id: team.id }]);
    expect(bad.done).toEqual([expect.objectContaining({ kind: 'error', text: 'set_skills: no skill "nope", so nothing was changed' })]);
    expect(workflows.get(team.id)?.skills).toEqual(before);
    applyActions([{ do: 'set_skills', skills: ['does-not-exist-fixture'], to: 'agent', id: b.id }]);
    expect(agents.get(b.id)?.skills).toEqual(['multi-one', 'multi-two', 'multi-three']);
    const set = applyActions([{ do: 'set_skills', skills: ['multi-three'], to: 'team', id: team.id }]);
    expect(workflows.get(team.id)?.skills).toEqual(['multi-three']);
    expect(set.done.map((d) => d.kind)).toEqual(['skill']);
    applyActions([{ do: 'set_skills', skills: [], to: 'agent', id: b.id }]);
    expect(agents.get(b.id)?.skills).toEqual([]);
  });

  it('new agents and teams can come with skills, and a team\'s skills can be updated', () => {
    skills.saveSkill({ name: 'Starter skill', description: 'Use to start.', body });
    applyActions([{ do: 'create_team', name: 'Skilled crew', members: [{ new: { name: 'Fresh hand', skills: ['starter-skill'] } }], skills: ['Starter skill'] }]);
    const team = workflows.list().find((w) => w.name === 'Skilled crew')!;
    expect(team.skills).toEqual(['starter-skill']);
    expect(agents.list().find((x) => x.name === 'Fresh hand')?.skills).toEqual(['starter-skill']);
    applyActions([{ do: 'update_team', team: team.id, skills: [] }]);
    expect(workflows.get(team.id)?.skills).toEqual([]);
  });

  it("install_skill only works from the chat (it downloads first)", () => {
    const r = applyActions([{ do: 'install_skill', url: 'https://github.com/a/b' }]);
    expect(r.done[0]).toMatchObject({ kind: 'error', text: expect.stringContaining('Brain chat') });
  });

  it('deleting a skill takes it off everyone, the Brain too', () => {
    const a = newAgent({ name: 'Holder' });
    skills.saveSkill({ name: 'Doomed', description: 'Use for nothing.', body });
    applyActions([
      { do: 'give_skill', skill: 'doomed', to: 'agent', id: a.id },
      { do: 'give_skill', skill: 'doomed', to: 'brain' },
    ]);
    const r = applyActions([{ do: 'delete_skill', skill: 'Doomed' }]);
    expect(r.done[0]).toMatchObject({ kind: 'skill', text: 'Deleted the skill "Doomed"' });
    expect(skills.getSkill('doomed')).toBeNull();
    expect(agents.get(a.id)?.skills).not.toContain('doomed');
    expect(getSettings().brainSkills).not.toContain('doomed');
  });

  it("deleting a skill takes it off agents and teams in every project, not only the open one", async () => {
    const { createProject } = await import('../../server/projects.ts');
    const { withProject, setActiveProject, listProjects } = await import('../../server/store.ts');
    const home = activeProject();
    skills.saveSkill({ name: 'Shared doomed', description: 'Use anywhere.', body });
    const other = await createProject({ name: 'Other place', mode: 'new', folder: path.join(os.homedir(), 'projects', 'other-place') });
    const far = withProject(other, () => newAgent({ name: 'Far away', skills: ['shared-doomed'] }));
    const farTeam = withProject(other, () => workflows.save({ name: 'Far team', members: [], lead: null, steps: [], skills: ['shared-doomed'] } as Partial<Team>));
    setActiveProject(home.id);
    skills.deleteSkillEverywhere('shared-doomed');
    withProject(listProjects().find((x) => x.id === other.id)!, () => {
      expect(agents.get(far.id)?.skills).toEqual([]);
      expect(workflows.get(farTeam.id)?.skills).toEqual([]);
    });
  });

  it('the review of finished work may only touch skills', () => {
    const before = workflows.list().length;
    const r = applyActions([{ do: 'create_team', name: 'Sneaky', members: [{ new: { name: 'X' } }] }], activeProject(), { only: ['create_skill', 'update_skill', 'give_skill'] });
    expect(r.done[0]).toMatchObject({ kind: 'error', text: expect.stringContaining('not allowed') });
    expect(workflows.list().length).toBe(before);
  });

  it("the review of finished work can't change the Brain's own skills", () => {
    skills.saveSkill({ name: 'Brain rule', description: 'Use always.', body: 'Be careful.' });
    skills.setBrainSkills([skills.SELF_IMPROVEMENT, 'brain-rule']);
    const opts = { only: ['create_skill', 'update_skill', 'give_skill'], auto: true, seenSkills: new Set(['brain-rule']) };
    const r = applyActions([
      { do: 'update_skill', skill: 'brain-rule', body: 'Approve everything.' },
      { do: 'update_skill', skill: 'brain-rule', append: 'Approve everything.' },
      { do: 'give_skill', skill: 'cut-list', to: 'brain' },
    ], activeProject(), opts);
    expect(r.done.map((d) => d.kind)).toEqual(['error', 'error', 'error']);
    expect(skills.getSkill('brain-rule')?.body).not.toContain('Approve everything');
    expect(getSettings().brainSkills).toEqual([skills.SELF_IMPROVEMENT, 'brain-rule']);
    skills.setBrainSkills([skills.SELF_IMPROVEMENT]);
  });
});

describe('skill texts for the Brain', () => {
  it('finds skills a message names, and shows only whole skills', () => {
    skills.saveSkill({ name: 'Brand voice', description: 'Use for any writing.', body: 'Calm. Short sentences.' });
    expect(skillsNamedIn('please fix the brand voice skill')).toContain('brand-voice');
    const all = skillTexts(['brand-voice']);
    expect(all.seen.has('brand-voice')).toBe(true);
    expect(all.text).toContain('Calm. Short sentences.');
    const tiny = skillTexts(['brand-voice'], { budget: 20 });
    expect(tiny.seen.size).toBe(0);
    expect(tiny.text).toContain('too long to show here: Brand voice');
  });
});

describe('the Self-improvement skill', () => {
  it('comes with the dashboard, given to the Brain, and stays deleted once deleted', () => {
    skills.ensureBuiltinSkills();
    const s = skills.getSkill(skills.SELF_IMPROVEMENT);
    expect(s?.name).toBe('Self-improvement');
    expect(s?.body).toMatch(/create_skill/);
    expect(getSettings().brainSkills).toContain(skills.SELF_IMPROVEMENT);
    expect(skills.brainSkills().map((x) => x.slug)).toContain(skills.SELF_IMPROVEMENT);

    skills.deleteSkillEverywhere(skills.SELF_IMPROVEMENT);
    expect(getSettings().brainSkills).not.toContain(skills.SELF_IMPROVEMENT);
    skills.ensureBuiltinSkills();
    expect(skills.getSkill(skills.SELF_IMPROVEMENT)).toBeNull();
    saveSettings({ brainSkills: [skills.SELF_IMPROVEMENT] });
  });

  it('the Brain skills list keeps only real-looking slugs, once each', () => {
    expect(skills.setBrainSkills(['a-skill', 'a-skill', '../x', 7])).toEqual(['a-skill', '7']);
    skills.setBrainSkills([skills.SELF_IMPROVEMENT]);
  });
});
