// Versions of skills, agents and teams: kept before each change and before a delete, with who changed
// it; edits close together are one change; restoring and bringing back deleted ones.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agents, workflows } from '../../server/store.ts';
import { newAgent } from '../../server/library.ts';
import * as skills from '../../server/skills.ts';
import { applyActions } from '../../server/overseer.ts';
import { historyOf, versionOf, restoreVersion, deletedItems, undelete, asText } from '../../server/history.ts';
import { keepVersion, listVersions, canonical, changedFields, withActor, versionFilesDir, COALESCE_MS, VERSIONS_KEPT } from '../../server/versions.ts';
import { dataPath } from '../../server/util.ts';
import type { Agent, Team } from '../../shared/types.ts';

// move the clock on, past the window in which edits count as one change
const later = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + COALESCE_MS + 1000);
};
afterEach(() => {
  vi.useRealTimers();
});

describe('versions.ts', () => {
  it('compares without key order or ignored fields', () => {
    expect(canonical({ b: 1, a: { y: 2, x: 1 } })).toBe(canonical({ a: { x: 1, y: 2 }, b: 1 }));
    expect(canonical({ a: 1, updatedAt: 5 }, ['updatedAt'])).toBe(canonical({ a: 1, updatedAt: 9 }, ['updatedAt']));
    expect(changedFields({ a: 1, b: [1], c: 3 }, { a: 1, b: [2], d: 4 })).toEqual(['b', 'c', 'd']);
  });

  it('keeps a version only for a real change, one per run of edits, and the last 50', () => {
    const dir = dataPath('versions', 'unit', 'x');
    expect(keepVersion(dir, { a: 1 }, { a: 1 })).toBeNull();
    expect(keepVersion(dir, { a: 1 }, { a: 2 })).not.toBeNull();
    // the same one again right away: same run of edits
    expect(keepVersion(dir, { a: 2 }, { a: 3 })).toBeNull();
    // someone else: a new version
    expect(withActor('brain', () => keepVersion(dir, { a: 3 }, { a: 4 }))?.by).toBe('brain');
    // a forced one (a restore) and a delete are always kept
    expect(withActor('brain', () => keepVersion(dir, { a: 4 }, { a: 5 }, {}), { force: true })).not.toBeNull();
    expect(keepVersion(dir, { a: 5 }, null, { deleted: true })?.deleted).toBe(true);
    for (let i = 0; i < VERSIONS_KEPT + 5; i++) withActor('you', () => keepVersion(dir, { i }, { i: i + 1 }), { force: true });
    expect(listVersions(dir)).toHaveLength(VERSIONS_KEPT);
  });
});

describe("the Brain's changes", () => {
  it('each answer is a new version, even right after the last one; one answer changing it twice is one', () => {
    skills.saveSkill({ name: 'Brain edits', description: 'Use for testing.', body: 'One.' });
    applyActions([{ do: 'update_skill', skill: 'brain-edits', append: 'Two.' }]);
    applyActions([{ do: 'update_skill', skill: 'brain-edits', append: 'Three.' }]);
    applyActions([
      { do: 'update_skill', skill: 'brain-edits', append: 'Four.' },
      { do: 'update_skill', skill: 'brain-edits', append: 'Five.' },
    ]);
    const h = historyOf('skill', 'brain-edits');
    expect(h.versions.map((v) => v.by)).toEqual(['brain', 'brain', 'brain']);
    expect(listVersions<{ body: string }>(skills.skillVersionsDir('brain-edits')).map((v) => v.item.body.split(/\s+/).pop())).toEqual(['Three.', 'Two.', 'One.']);
    // your edits close together on the page are still one change
    skills.saveSkill({ slug: 'brain-edits', name: 'Brain edits', description: 'Use for testing.', body: 'Six.' });
    skills.saveSkill({ slug: 'brain-edits', name: 'Brain edits', description: 'Use for testing.', body: 'Seven.' });
    expect(historyOf('skill', 'brain-edits').versions.map((v) => v.by)).toEqual(['you', 'brain', 'brain', 'brain']);
  });

  it('an answer that changes a skill and then deletes it is one version: the deleted one, from before the answer', () => {
    skills.saveSkill({ name: 'Edit then delete', description: 'Use for testing.', body: 'Before the answer.' });
    const r = applyActions([
      { do: 'update_skill', skill: 'edit-then-delete', append: 'Added by the Brain.' },
      { do: 'delete_skill', skill: 'edit-then-delete' },
    ]);
    expect(r.done.map((d) => d.kind)).toEqual(['skill', 'skill']);
    const kept = listVersions<{ body: string; files?: string[] }>(skills.skillVersionsDir('edit-then-delete'));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ by: 'brain', deleted: true, item: { body: 'Before the answer.', files: [] } });
    expect(deletedItems('skill').map((x) => x.id)).toContain('edit-then-delete');
    undelete('skill', 'edit-then-delete');
    expect(skills.getSkill('edit-then-delete')?.body.trim()).toBe('Before the answer.');
  });

  it('the same for teams', () => {
    const a = newAgent({ name: 'Brain team member' });
    applyActions([{ do: 'create_team', name: 'Brain edited team', members: [{ agent: a.id }] }]);
    const t = workflows.list().find((w) => w.name === 'Brain edited team')!;
    applyActions([{ do: 'update_team', team: t.id, description: 'Goal one' }]);
    applyActions([{ do: 'update_team', team: t.id, description: 'Goal two' }]);
    expect(historyOf('team', t.id).versions.map((v) => v.by)).toEqual(['brain', 'brain']);
  });
});

describe('versions made close together (review fixes)', () => {
  it('a deletion in the same millisecond as an edit is still the newest version', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    for (let i = 0; i < 20; i++) {
      const a = newAgent({ name: `Same ms ${i}` });
      withActor('brain', () => agents.save({ ...agents.get(a.id)!, specialty: 'changed' }));
      agents.remove(a.id);
      expect(listVersions(agents.versionsDir(a.id)!)[0].deleted).toBe(true);
      expect(deletedItems('agent').map((x) => x.id)).toContain(a.id);
    }
  });

  it("drops a version's kept files when the version itself is dropped", () => {
    const dir = dataPath('versions', 'unit', 'sidecars');
    const first = withActor('you', () => keepVersion(dir, { n: 0 }, { n: 1 }), { force: true })!;
    fs.mkdirSync(versionFilesDir(dir, first.id), { recursive: true });
    fs.writeFileSync(path.join(versionFilesDir(dir, first.id), 'f.txt'), 'x');
    for (let i = 1; i <= VERSIONS_KEPT; i++) withActor('you', () => keepVersion(dir, { n: i }, { n: i + 1 }), { force: true });
    expect(listVersions(dir).some((v) => v.id === first.id)).toBe(false);
    expect(fs.existsSync(versionFilesDir(dir, first.id))).toBe(false);
  });
});

describe('agents and teams', () => {
  it("keeps an agent's version before a change, not for its last model or pin", () => {
    const a = newAgent({ name: 'Versioned', systemPrompt: 'First instructions.' });
    agents.save({ ...agents.get(a.id)!, lastModel: 'sonnet', lastModelAt: Date.now(), pinned: true });
    expect(listVersions(agents.versionsDir(a.id)!)).toHaveLength(0);
    agents.save({ ...agents.get(a.id)!, systemPrompt: 'Second instructions.', toolGroups: ['web'] });
    const h = historyOf('agent', a.id);
    expect(h.versions).toHaveLength(1);
    expect(h.versions[0]).toMatchObject({ by: 'you', changes: ['instructions', 'tools'] });
    expect(h.current).toContain('Second instructions.');
    expect(versionOf('agent', a.id, h.versions[0].id).text).toContain('First instructions.');
  });

  it("puts an agent's version back, keeping its pin, and the restore can be undone", () => {
    const a = newAgent({ name: 'Restorer', systemPrompt: 'Old way.' });
    agents.save({ ...agents.get(a.id)!, systemPrompt: 'New way.' });
    agents.save({ ...agents.get(a.id)!, pinned: true });
    const old = historyOf('agent', a.id).versions[0];
    restoreVersion('agent', a.id, old.id);
    expect(agents.get(a.id)).toMatchObject({ systemPrompt: 'Old way.', pinned: true });
    const after = historyOf('agent', a.id).versions;
    expect(after).toHaveLength(2);
    expect(after[0].note).toMatch(/replaced by the version from/);
    expect(versionOf('agent', a.id, after[0].id).text).toContain('New way.');
  });

  it("a team's place on the map isn't a version; its goal is", () => {
    const t = workflows.save({ name: 'Map team', description: 'Goal one', members: [], lead: null, steps: [] } as Partial<Team>);
    workflows.save({ ...workflows.get(t.id)!, pos: { x: 3, z: 4 }, rot: 1 });
    expect(listVersions(workflows.versionsDir(t.id)!)).toHaveLength(0);
    workflows.save({ ...workflows.get(t.id)!, description: 'Goal two' });
    expect(historyOf('team', t.id).versions[0].changes).toEqual(['goal']);
  });

  it("restoring a team keeps when its schedule last ran, so it doesn't run again right away", () => {
    const t = workflows.save({ name: 'Scheduled team', description: 'Goal A', members: [], lead: null, steps: [], schedule: { type: 'interval', minutes: 60 } } as Partial<Team>);
    workflows.save({ ...workflows.get(t.id)!, lastScheduledAt: 1000 } as Partial<Team>);
    workflows.save({ ...workflows.get(t.id)!, description: 'Goal B' });
    workflows.save({ ...workflows.get(t.id)!, lastScheduledAt: 999_999 } as Partial<Team>);
    restoreVersion('team', t.id, historyOf('team', t.id).versions[0].id);
    expect(workflows.get(t.id)).toMatchObject({ description: 'Goal A', lastScheduledAt: 999_999 });
  });

  it('brings back a deleted agent and team', () => {
    const a = newAgent({ name: 'Gone soon' });
    const t = workflows.save({ name: 'Gone team', description: 'x', members: [a.id], lead: null, steps: [] } as Partial<Team>);
    agents.remove(a.id);
    workflows.remove(t.id);
    expect(deletedItems('agent').map((x) => x.name)).toContain('Gone soon');
    expect(deletedItems('team').map((x) => x.name)).toContain('Gone team');
    expect(historyOf('agent', a.id).current).toBeNull();
    undelete('agent', a.id);
    undelete('team', t.id);
    expect(agents.get(a.id)?.name).toBe('Gone soon');
    expect(workflows.get(t.id)?.members).toEqual([a.id]);
    expect(deletedItems('agent').map((x) => x.id)).not.toContain(a.id);
    expect(() => undelete('agent', a.id)).toThrow(/isn't deleted/);
  });

  it("marks the Brain's changes as the Brain's", () => {
    const a = newAgent({ name: 'Brain-touched' });
    later();
    applyActions([{ do: 'create_team', name: 'Brain team', members: [{ agent: a.id }] }]);
    const t = workflows.list().find((w) => w.name === 'Brain team')!;
    applyActions([{ do: 'update_team', team: t.id, description: 'Brain goal' }]);
    expect(historyOf('team', t.id).versions[0].by).toBe('brain');
  });
});

describe('skills', () => {
  it('keeps versions of your edits too, and restores one', () => {
    later();
    skills.saveSkill({ name: 'Versioned skill', description: 'Use for v.', body: 'Version one.' });
    skills.saveSkill({ slug: 'versioned-skill', name: 'Versioned skill', description: 'Use for v.', body: 'Version two.' });
    const h = historyOf('skill', 'versioned-skill');
    expect(h.versions).toHaveLength(1);
    expect(h.versions[0].changes).toEqual(['instructions']);
    restoreVersion('skill', 'versioned-skill', h.versions[0].id);
    expect(skills.getSkill('versioned-skill')?.body.trim()).toBe('Version one.');
  });

  it('brings back a deleted skill with its extra files', () => {
    const s = skills.saveSkill({ name: 'With files', description: 'Use with files.', body: 'See ref.md.' })!;
    fs.mkdirSync(dataPath('skills', s.slug, 'refs'), { recursive: true });
    fs.writeFileSync(dataPath('skills', s.slug, 'refs', 'ref.md'), 'the reference');
    skills.deleteSkillEverywhere(s.slug);
    expect(skills.getSkill(s.slug)).toBeNull();
    expect(deletedItems('skill').map((x) => x.name)).toContain('With files');
    undelete('skill', s.slug);
    expect(skills.getSkill(s.slug)?.body).toContain('See ref.md.');
    expect(fs.readFileSync(path.join(dataPath('skills', s.slug), 'refs', 'ref.md'), 'utf8')).toBe('the reference');
  });

  it('a version older than a deletion still says what changed next', () => {
    const a = newAgent({ name: 'Edited then deleted', systemPrompt: 'v1' });
    agents.save({ ...agents.get(a.id)!, systemPrompt: 'v2' });
    later();
    agents.remove(a.id);
    const h = historyOf('agent', a.id);
    expect(h.versions.map((v) => v.changes)).toEqual([['deleted'], ['instructions']]);
    expect(versionOf('agent', a.id, h.versions[1].id).changes).toEqual(['instructions']);
  });

  it('shows every versioned field, so a listed change is never invisible', () => {
    const agent = asText('agent', { name: 'A', engine: 'openai', provider: 'openrouter', temperature: 0.3, color: '#123456', systemPrompt: 'x' } as Agent);
    expect(agent).toContain('Provider: openrouter');
    expect(agent).toContain('Temperature: 0.3');
    expect(agent).toContain('color: "#123456"');
    const team = asText('team', {
      name: 'T',
      description: 'g',
      members: [],
      lead: null,
      schedule: { type: 'daily', time: '09:00', days: [1, 3], input: 'the news' },
      steps: [{ type: 'tool', tool: 'web_search', args: '{"q":"x"}', label: 'Search' }, { type: 'agent', agentId: 'a1', prompt: 'Sum it up' }],
    } as unknown as Team);
    expect(team).toContain('Schedule: daily at 09:00 on Mon, Wed');
    expect(team).toContain('with: the news');
    expect(team).toContain('tool: web_search');
    expect(team).toContain('prompt: Sum it up');
  });

  it('a deleted skill comes back with all its files: hidden ones, and past the 200 agents see', () => {
    const s = skills.saveSkill({ name: 'Many files', description: 'Use with many files.', body: 'Lots.' })!;
    const dir = skills.skillDir(s.slug);
    for (let i = 0; i < 205; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, '0')}.txt`), `file ${i}`);
    fs.mkdirSync(path.join(dir, 'deep', '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'deep', '.hidden', 'x.md'), 'hidden one');
    fs.writeFileSync(path.join(dir, '.env.example'), 'KEY=');
    skills.deleteSkillEverywhere(s.slug);
    undelete('skill', s.slug);
    expect(fs.readFileSync(path.join(dir, 'f204.txt'), 'utf8')).toBe('file 204');
    expect(fs.readFileSync(path.join(dir, 'deep', '.hidden', 'x.md'), 'utf8')).toBe('hidden one');
    expect(fs.existsSync(path.join(dir, '.env.example'))).toBe(true);
  });

  it("restoring a version kept with its files puts back exactly those files, and that can be undone", () => {
    const s = skills.saveSkill({ name: 'File swap', description: 'Use to swap.', body: 'Old.' })!;
    const dir = skills.skillDir(s.slug);
    fs.writeFileSync(path.join(dir, 'old.md'), 'old file');
    skills.deleteSkillEverywhere(s.slug);
    const deletedVersion = historyOf('skill', s.slug).versions[0].id;
    // made again, with other files
    later();
    skills.saveSkill({ name: 'File swap', description: 'Use to swap.', body: 'New.' });
    fs.writeFileSync(path.join(dir, 'new.md'), 'new file');
    restoreVersion('skill', s.slug, deletedVersion);
    expect(skills.getSkill(s.slug)?.body).toContain('Old.');
    expect(skills.skillExtraFiles(dir)).toEqual(['old.md']);
    // undo: the version from before the restore has the new file
    const undo = historyOf('skill', s.slug).versions[0];
    expect(undo.note).toMatch(/replaced by/);
    restoreVersion('skill', s.slug, undo.id);
    expect(skills.getSkill(s.slug)?.body).toContain('New.');
    expect(skills.skillExtraFiles(dir)).toEqual(['new.md']);
  });

  it('restoring the oldest version kept brings back its files too (keeping one more would prune it)', () => {
    const s = skills.saveSkill({ name: 'Oldest one', description: 'Use it.', body: 'First.' })!;
    const dir = skills.skillDir(s.slug);
    fs.writeFileSync(path.join(dir, 'script.sh'), 'echo first');
    skills.deleteSkillEverywhere(s.slug);
    const oldest = historyOf('skill', s.slug).versions[0].id;
    skills.saveSkill({ name: 'Oldest one', description: 'Use it.', body: 'Again 0.' });
    for (let i = 1; i < VERSIONS_KEPT; i++) withActor('you', () => skills.saveSkill({ slug: s.slug, name: 'Oldest one', description: 'Use it.', body: `Again ${i}.` }));
    const vdir = skills.skillVersionsDir(s.slug);
    expect(listVersions(vdir)).toHaveLength(VERSIONS_KEPT);
    expect(listVersions(vdir).at(-1)?.id).toBe(oldest);
    restoreVersion('skill', s.slug, oldest);
    expect(skills.getSkill(s.slug)?.body).toContain('First.');
    expect(fs.readFileSync(path.join(dir, 'script.sh'), 'utf8')).toBe('echo first');
    expect(listVersions(vdir)).toHaveLength(VERSIONS_KEPT);
  });

  it('as text', () => {
    expect(asText('skill', { slug: 's', name: 'S', description: 'Use it.', body: 'Do it.' })).toBe('Name: S\nWhen to use it: Use it.\n\nDo it.');
    expect(asText('agent', { name: 'A', emoji: '🤖', engine: 'claude-code', systemPrompt: 'Be kind.' } as Agent)).toMatch(/^Name: 🤖 A\n[\s\S]*\n\nInstructions:\nBe kind\.$/);
  });

  it('refuses unknown ids', () => {
    expect(() => historyOf('skill', '../etc')).toThrow();
    expect(() => historyOf('agent', 'nobody')).toThrow(/No agent/);
  });
});
