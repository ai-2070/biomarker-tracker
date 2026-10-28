// Backups carry earlier versions: the project's agents and teams (deleted ones too), and every skill's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { agents, workflows, setActiveProject } from '../../server/store.ts';
import { createProject } from '../../server/projects.ts';
import { newAgent } from '../../server/library.ts';
import * as skills from '../../server/skills.ts';
import { historyOf, versionOf, deletedItems, undelete } from '../../server/history.ts';
import { listVersions, withActor } from '../../server/versions.ts';
import * as backup from '../../server/backup.ts';
import type { Team } from '../../shared/types.ts';

const folder = (name: string) => path.join(os.homedir(), 'projects', name);
const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64');
// A backup file with a hand-made payload
function craft(payload: Record<string, unknown>): Buffer {
  const head = `MY-DASHBOARD-BACKUP 1\n${JSON.stringify({ app: 'my-dashboard', name: 'Crafted' })}\n`;
  return Buffer.concat([Buffer.from(head), zlib.gzipSync(JSON.stringify({ app: 'my-dashboard', kind: 'workspace-backup', format: 1, createdAt: 1, project: { name: 'Crafted' }, agents: [], teams: [], ...payload }))]);
}
// forget a skill on this PC (as on another PC that never had it)
const forget = (slug: string) => {
  fs.rmSync(skills.skillDir(slug), { recursive: true, force: true });
  fs.rmSync(skills.skillVersionsDir(slug), { recursive: true, force: true });
};

describe('backups with earlier versions', () => {
  it('back up and restore the history of agents, teams and skills, deleted ones included', async () => {
    const p = await createProject({ name: 'With history', mode: 'new', folder: folder('with-history') });
    const sk = skills.saveSkill({ name: 'History skill', description: 'Use h.', body: 'Skill v1.' })!;
    skills.saveSkill({ slug: sk.slug, name: 'History skill', description: 'Use h.', body: 'Skill v2.' });
    const gone = skills.saveSkill({ name: 'Gone skill', description: 'Use g.', body: 'Gone body.' })!;
    fs.writeFileSync(path.join(skills.skillDir(gone.slug), 'ref.md'), 'gone reference');
    skills.deleteSkillEverywhere(gone.slug);
    const a = newAgent({ name: 'Historian', systemPrompt: 'Agent v1.', skills: [sk.slug] });
    agents.save({ ...agents.get(a.id)!, systemPrompt: 'Agent v2.' });
    const dropped = newAgent({ name: 'Dropped agent' });
    agents.remove(dropped.id);
    const t = workflows.save({ name: 'Versioned crew', description: 'Goal v1', members: [a.id], lead: null, steps: [], schedule: { type: 'daily', time: '09:00' }, enabled: true } as Partial<Team>);
    withActor('brain', () => workflows.save({ ...workflows.get(t.id)!, description: 'Goal v2' }));

    const file = backup.createBackup(p.id);
    expect(file.summary.versions).toBeGreaterThanOrEqual(5);

    // another PC: these skills aren't in its library
    forget(sk.slug);
    forget(gone.slug);
    const { project, restored } = await backup.restoreBackup(fs.readFileSync(file.file), { name: 'History again' });
    setActiveProject(project.id);
    expect(restored.versions).toBe(file.summary.versions);
    // agents and teams
    const ah = historyOf('agent', a.id);
    expect(ah.current).toContain('Agent v2.');
    expect(versionOf('agent', a.id, ah.versions[0].id).text).toContain('Agent v1.');
    const th = historyOf('team', t.id);
    expect(th.versions[0]).toMatchObject({ by: 'brain', changes: ['goal'] });
    expect(deletedItems('agent').map((x) => x.name)).toEqual(['Dropped agent']);
    undelete('agent', dropped.id);
    expect(agents.get(dropped.id)?.name).toBe('Dropped agent');
    // skills: the history, and a deleted one that comes back with its files
    expect(versionOf('skill', sk.slug, historyOf('skill', sk.slug).versions[0].id).text).toContain('Skill v1.');
    expect(deletedItems('skill').map((x) => x.name)).toContain('Gone skill');
    undelete('skill', gone.slug);
    expect(fs.readFileSync(path.join(skills.skillDir(gone.slug), 'ref.md'), 'utf8')).toBe('gone reference');
  });

  it("restoring a team's old version from a backup starts it paused", async () => {
    const p = await createProject({ name: 'Paused history', mode: 'new', folder: folder('paused-history') });
    const t = workflows.save({ name: 'Scheduled', description: 'g1', members: [], lead: null, steps: [], schedule: { type: 'daily', time: '07:00' }, enabled: true } as Partial<Team>);
    workflows.save({ ...workflows.get(t.id)!, description: 'g2' });
    const file = backup.createBackup(p.id);
    const { project } = await backup.restoreBackup(fs.readFileSync(file.file), { name: 'Paused again' });
    setActiveProject(project.id);
    const old = listVersions<Team>(workflows.versionsDir(t.id)!)[0];
    expect(old.item).toMatchObject({ description: 'g1', enabled: false });
  });

  it("a skill added as <id>-restored takes its history along; yours keeps its own", async () => {
    const p = await createProject({ name: 'Renamed history', mode: 'new', folder: folder('renamed-history') });
    const sk = skills.saveSkill({ name: 'Clashing', description: 'Use c.', body: 'Theirs v1.' })!;
    skills.saveSkill({ slug: sk.slug, name: 'Clashing', description: 'Use c.', body: 'Theirs v2.' });
    newAgent({ name: 'Clash user', skills: [sk.slug] });
    const file = backup.createBackup(p.id);
    // here, a different skill with the same id, with a history of its own
    forget(sk.slug);
    skills.saveSkill({ name: 'Clashing', description: 'Use c.', body: 'Ours v1.' });
    skills.saveSkill({ slug: sk.slug, name: 'Clashing', description: 'Use c.', body: 'Ours v2.' });
    const { restored } = await backup.restoreBackup(fs.readFileSync(file.file), { name: 'Renamed again' });
    const to = `${sk.slug}-restored`;
    expect(restored.skills.renamed).toEqual([{ from: sk.slug, to }]);
    expect(versionOf('skill', to, historyOf('skill', to).versions[0].id).text).toContain('Theirs v1.');
    const ours = historyOf('skill', sk.slug).versions;
    expect(ours).toHaveLength(1);
    expect(versionOf('skill', sk.slug, ours[0].id).text).toContain('Ours v1.');
  });

  it("adds a backup's versions to the same skill here, once each", async () => {
    const p = await createProject({ name: 'Same history', mode: 'new', folder: folder('same-history') });
    const sk = skills.saveSkill({ name: 'Shared history', description: 'Use s.', body: 'v1.' })!;
    skills.saveSkill({ slug: sk.slug, name: 'Shared history', description: 'Use s.', body: 'v2.' });
    const file = backup.createBackup(p.id);
    const before = listVersions(skills.skillVersionsDir(sk.slug)).map((v) => v.id);
    // the backup has the same versions: nothing doubles
    await backup.restoreBackup(fs.readFileSync(file.file), { name: 'Same again' });
    expect(listVersions(skills.skillVersionsDir(sk.slug)).map((v) => v.id)).toEqual(before);
    // one of them lost here: it comes back
    fs.rmSync(path.join(skills.skillVersionsDir(sk.slug), `${before[0]}.json`));
    const { restored } = await backup.restoreBackup(fs.readFileSync(file.file), { name: 'Same third' });
    expect(listVersions(skills.skillVersionsDir(sk.slug)).map((v) => v.id)).toEqual(before);
    expect(restored.versions).toBeGreaterThanOrEqual(1);
  });

  it("leaves out a deleted skill's history when a different skill here has its id", async () => {
    const vid = 'v-old';
    const buf = craft({
      versions: [{ path: `skills/taken-here/${vid}.json`, data: b64({ at: 5, by: 'you', deleted: true, item: { name: 'Taken', description: 'Old.', body: 'Old body.' } }) }],
    });
    skills.saveSkill({ name: 'Taken here', description: 'Mine.', body: 'Mine.' });
    await backup.restoreBackup(buf, { name: 'Crafted taken' });
    expect(listVersions(skills.skillVersionsDir('taken-here')).map((v) => v.id)).not.toContain(vid);
  });

  it('checks every version in a crafted backup, and keeps each under the item and id it was saved as', async () => {
    const good = { at: 7, by: 'root', note: 'n', item: { id: 'someone-else', name: 'Crafted agent v1' } };
    const buf = craft({
      agents: [{ id: 'agent-x', name: 'Crafted agent' }],
      versions: [
        { path: 'agents/agent-x/v-good.json', data: b64(good) },
        { path: 'agents/agent-x/v-bad.json', data: b64({ at: 'soon', item: {} }) },
        { path: 'agents/agent-x/v-notjson.json', data: b64('{nope') },
        { path: 'agents/../escape/v-1.json', data: b64(good) },
        { path: 'routines/r-1/v-1.json', data: b64(good) },
        { path: 'skills/Bad Name/v-1.json', data: b64({ at: 1, item: { name: 'x', description: 'x', body: 'x' } }) },
        { path: 'skills/crafted-skill/v-s.json', data: b64({ at: 2, by: 'you', deleted: true, item: { name: 'Crafted skill', description: 'Old.', body: 'Body.' } }) },
        { path: 'skills/crafted-skill/files-v-s/../../../escape.md', data: b64('nope') },
        { path: 'skills/crafted-skill/files-v-s/ok.md', data: b64('ok file') },
      ],
    });
    const { project, restored } = await backup.restoreBackup(buf, { name: 'Crafted versions' });
    setActiveProject(project.id);
    expect(restored.versions).toBe(2);
    const kept = listVersions(agents.versionsDir('agent-x')!);
    expect(kept).toEqual([{ id: 'v-good', at: 7, by: 'you', note: 'n', item: expect.objectContaining({ id: 'agent-x', name: 'Crafted agent v1' }) }]);
    expect(fs.existsSync(path.join(path.dirname(agents.versionsDir('x')!), 'escape'))).toBe(false);
    undelete('skill', 'crafted-skill');
    expect(skills.skillExtraFiles(skills.skillDir('crafted-skill'))).toEqual(['ok.md']);
  });

  it('restores a backup made before versions were in backups', async () => {
    const { restored } = await backup.restoreBackup(craft({ agents: [{ id: 'agent-old', name: 'Old' }] }), { name: 'Older backup' });
    expect(restored.versions).toBe(0);
  });

  it('turns away versions dated in the future, and a future one here never swallows later edits', async () => {
    const future = Date.now() + 10 * 365 * 24 * 3600 * 1000;
    const { project, restored } = await backup.restoreBackup(
      craft({ agents: [{ id: 'agent-f', name: 'F' }], versions: [{ path: 'agents/agent-f/v-future.json', data: b64({ at: future, by: 'you', item: { name: 'From the future' } }) }] }),
      { name: 'Future versions' },
    );
    expect(restored.versions).toBe(0);
    setActiveProject(project.id);
    // and if one got here some other way, ordinary edits still each keep a version, dated now
    const dir = agents.versionsDir('agent-f')!;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'v-planted.json'), JSON.stringify({ id: 'v-planted', at: future, by: 'you', item: { id: 'agent-f', name: 'Planted' } }));
    agents.save({ ...agents.get('agent-f')!, specialty: 'one' });
    agents.save({ ...agents.get('agent-f')!, specialty: 'two' });
    const mine = listVersions(dir).filter((v) => v.id !== 'v-planted');
    expect(mine).toHaveLength(2);
    // (dated now: a few ms ahead at most, when versions are made faster than one a millisecond; never near the planted date)
    expect(mine.every((v) => v.at <= Date.now() + 1000)).toBe(true);
  });

  it('cleans agent and team versions field by field, so History never breaks on odd data', async () => {
    const buf = craft({
      agents: [{ id: 'agent-o', name: 'Odd' }],
      teams: [{ id: 'team-o', name: 'Odd team', members: [], lead: null, steps: [] }],
      versions: [
        { path: 'agents/agent-o/v-a.json', data: b64({ at: 3, by: 'you', item: { name: 'Odd v1', systemPrompt: { evil: true }, skills: 'nope', toolGroups: ['web', 3], knowledge: { folders: 'x' }, temperature: 'hot' } }) },
        { path: 'agents/agent-o/v-noname.json', data: b64({ at: 4, by: 'you', item: { systemPrompt: 'no name' } }) },
        { path: 'teams/team-o/v-t.json', data: b64({ at: 3, by: 'you', item: { name: 'Odd team v1', steps: 'nope', members: [1, 2], schedule: { type: 'daily', days: 'mon', input: { x: 1 } }, access: { toolGroups: 'web' } } }) },
      ],
    });
    const { project, restored } = await backup.restoreBackup(buf, { name: 'Odd versions' });
    setActiveProject(project.id);
    expect(restored.versions).toBe(2);
    const av = listVersions<Record<string, unknown>>(agents.versionsDir('agent-o')!)[0].item;
    expect(av).toEqual({ id: 'agent-o', name: 'Odd v1', skills: [] });
    expect(versionOf('agent', 'agent-o', historyOf('agent', 'agent-o').versions[0].id).text).toContain('Odd v1');
    const tv = listVersions<Record<string, unknown>>(workflows.versionsDir('team-o')!)[0].item;
    expect(tv).toEqual({ id: 'team-o', name: 'Odd team v1', schedule: { type: 'daily' }, access: { toolGroups: [], mcpServers: [] }, skills: [] });
    expect(versionOf('team', 'team-o', historyOf('team', 'team-o').versions[0].id).text).toContain('Odd team v1');
  });
});

