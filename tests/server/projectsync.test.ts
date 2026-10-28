import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agents, chats, workflows, setActiveProject, setSecret, bus } from '../../server/store.ts';
import { createProject, removeProject } from '../../server/projects.ts';
import { newAgent } from '../../server/library.ts';
import { dataPath } from '../../server/util.ts';
import * as sync from '../../server/projectsync.ts';
import type { Team } from '../../shared/types.ts';

const folder = (name: string) => path.join(os.homedir(), 'projects', name);
// every file under dir, as one string
const allText = (dir: string): string =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => fs.readFileSync(path.join(e.parentPath, e.name), 'utf8'))
    .join('\n');
const linksWork = process.platform !== 'win32'; // file links need admin rights on Windows

describe('auto-save into the project folder', () => {
  it('writes agents, teams and project info into <folder>/.dashboard, never secrets', async () => {
    setSecret('openrouterKey', 'sk-or-v1-sentinel-do-not-save-4242');
    const p = await createProject({ name: 'Saved one', mode: 'new', folder: folder('saved-one'), description: 'A test project' });
    const a = newAgent({ name: 'Writer' });
    workflows.save({ name: 'Crew', members: [a.id], lead: a.id, steps: [] } as Partial<Team>);
    const st = sync.saveProject(p.id);
    expect(st).toMatchObject({ agents: 1, teams: 1 });
    const file = JSON.parse(fs.readFileSync(path.join(p.brainPath, '.dashboard', 'project.json'), 'utf8'));
    expect(file.app).toBe('my-dashboard');
    expect(file.project).toMatchObject({ name: 'Saved one', description: 'A test project' });
    expect(file.agents.map((x: { name: string }) => x.name)).toEqual(['Writer']);
    expect(JSON.stringify(file)).not.toMatch(/openrouterKey|secret/i);
    expect(allText(path.join(p.brainPath, '.dashboard'))).not.toContain('sentinel-do-not-save');
    expect(sync.peek(p.brainPath)).toMatchObject({ name: 'Saved one', agents: 1, teams: 1 });
  });

  it('keeps a backup when a save would have fewer agents than the last one', async () => {
    const p = await createProject({ name: 'Backups', mode: 'new', folder: folder('backups') });
    const a = newAgent({ name: 'One' });
    newAgent({ name: 'Two' });
    sync.saveProject(p.id);
    agents.remove(a.id);
    sync.saveProject(p.id);
    const backups = fs.readdirSync(path.join(p.brainPath, '.dashboard', 'backups'));
    expect(backups.length).toBe(1);
    const old = JSON.parse(fs.readFileSync(path.join(p.brainPath, '.dashboard', 'backups', backups[0]), 'utf8'));
    expect(old.agents).toHaveLength(2);
  });

  it('keeps a backup when only a routine was deleted, and brings routines back from the folder', async () => {
    const { saveRoutine, deleteRoutine } = await import('../../server/routines.ts');
    const p = await createProject({ name: 'Routine backups', mode: 'new', folder: folder('routine-backups') });
    newAgent({ name: 'Keeper' });
    const r1 = saveRoutine({ name: 'Daily', text: '@Keeper checks in.' });
    saveRoutine({ name: 'Weekly', text: '@Keeper sums up.' });
    sync.saveProject(p.id);
    deleteRoutine(r1.id);
    sync.saveProject(p.id);
    const dir = path.join(p.brainPath, '.dashboard');
    const backups = fs.readdirSync(path.join(dir, 'backups'));
    expect(backups.length).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'backups', backups[0]), 'utf8')).routines.map((x: { name: string }) => x.name).sort()).toEqual(['Daily', 'Weekly']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).routines.map((x: { name: string }) => x.name)).toEqual(['Weekly']);
    // the folder opened as another project brings the routine back
    const copy = await createProject({ name: 'Routine copy', mode: 'existing', folder: p.brainPath });
    expect(sync.restoreInto(copy.id, p.brainPath)).toMatchObject({ agents: 1 });
    expect(fs.readdirSync(dataPath('projects', copy.id, 'routines'))).toHaveLength(1);
  });

  it('opening a saved folder as a new project brings its agents and teams back', async () => {
    const dir = folder('round-trip');
    const p = await createProject({ name: 'Round trip', mode: 'new', folder: dir });
    const a = newAgent({ name: 'Researcher', skills: ['method'] });
    workflows.save({ name: 'Research desk', members: [a.id], lead: a.id, steps: [] } as Partial<Team>);
    sync.saveProject(p.id);
    // remove it from the dashboard, then open the same folder again
    const other = await createProject({ name: 'Elsewhere', mode: 'new', folder: folder('elsewhere') });
    setActiveProject(other.id);
    removeProject(p.id);
    const again = await createProject({ name: 'Round trip again', mode: 'existing', folder: dir });
    const restored = sync.restoreInto(again.id, dir);
    expect(restored).toMatchObject({ agents: 1, teams: 1 });
    setActiveProject(again.id);
    expect(agents.list().map((x) => [x.name, x.skills])).toEqual([['Researcher', ['method']]]);
    expect(workflows.list()[0]).toMatchObject({ name: 'Research desk', members: [a.id], lead: a.id });
  });

  it("brings an agent's chats back too, with the engine's memory of them", async () => {
    const dir = folder('chats-trip');
    const p = await createProject({ name: 'Chats trip', mode: 'new', folder: dir });
    const a = newAgent({ name: 'Talker' });
    const c = chats.create(a.id, 'Planning');
    c.items.push({ type: 'user', text: 'distinctive-user-message', ts: Date.now() });
    c.sessionId = 'session-123';
    c.llm = [{ role: 'user', content: 'distinctive-user-message' }];
    chats.save(c);
    sync.saveProject(p.id);
    expect(fs.existsSync(path.join(dir, '.dashboard', 'chats', a.id, `${c.id}.json`))).toBe(true);
    const other = await createProject({ name: 'Somewhere', mode: 'new', folder: folder('somewhere') });
    setActiveProject(other.id);
    removeProject(p.id);
    const again = await createProject({ name: 'Chats trip again', mode: 'existing', folder: dir });
    expect(sync.restoreInto(again.id, dir)).toMatchObject({ agents: 1, chats: 1 });
    setActiveProject(again.id);
    expect(chats.list(a.id).map((x) => x.title)).toEqual(['Planning']);
    const back = chats.get(a.id, c.id)!;
    expect(back.items.map((i) => (i.type === 'user' ? i.text : i.type))).toEqual(['distinctive-user-message']);
    expect(back).toMatchObject({ id: c.id, agentId: a.id, sessionId: 'session-123', llm: [{ role: 'user', content: 'distinctive-user-message' }] });
  });

  it('drops agent chats that were deleted in the dashboard', async () => {
    const p = await createProject({ name: 'Chat prune', mode: 'new', folder: folder('chat-prune') });
    const a = newAgent({ name: 'Pruner' });
    const keep = chats.create(a.id, 'Keep');
    const gone = chats.create(a.id, 'Gone');
    sync.saveProject(p.id);
    chats.remove(a.id, gone.id);
    sync.saveProject(p.id);
    expect(fs.readdirSync(path.join(p.brainPath, '.dashboard', 'chats', a.id))).toEqual([`${keep.id}.json`]);
  });

  it('a chat change is announced with its project, so the auto-save saves the right one', async () => {
    const p = await createProject({ name: 'Announce', mode: 'new', folder: folder('announce') });
    const a = newAgent({ name: 'Announcer' });
    const seen: unknown[] = [];
    const on = (ev: { type: string; project?: unknown }) => ev.type === 'chats' && seen.push(ev.project);
    bus.on('event', on);
    try {
      chats.create(a.id, 'Hello');
    } finally {
      bus.off('event', on);
    }
    expect(seen).toEqual([p.id]);
  });

  it("doesn't restore chats through links, or chats of agents it didn't restore", async () => {
    const dir = folder('crafted-chats');
    const d = path.join(dir, '.dashboard');
    fs.mkdirSync(path.join(d, 'chats', 'agent-1'), { recursive: true });
    fs.mkdirSync(path.join(d, 'chats', 'stranger'), { recursive: true });
    fs.writeFileSync(path.join(d, 'project.json'), JSON.stringify({ format: 1, app: 'my-dashboard', project: {}, agents: [{ id: 'agent-1', name: 'One' }], teams: [] }));
    const chat = (id: string, agentId: string) => JSON.stringify({ id, agentId, title: 't', items: [], llm: [], sessionId: null, createdAt: 1, updatedAt: 1 });
    // claims another agent and id: it's put back where it was saved
    fs.writeFileSync(path.join(d, 'chats', 'agent-1', 'c-ok.json'), chat('c-other', 'someone-else'));
    fs.writeFileSync(path.join(d, 'chats', 'stranger', 'c-x.json'), chat('c-x', 'stranger'));
    fs.writeFileSync(path.join(d, 'chats', 'agent-1', 'not-a-chat.json'), '{"hello":1}');
    if (linksWork) {
      const secret = path.join(os.homedir(), 'chat-secret.json');
      fs.writeFileSync(secret, chat('c-secret', 'agent-1'));
      fs.symlinkSync(secret, path.join(d, 'chats', 'agent-1', 'c-secret.json'));
    }
    const p = await createProject({ name: 'Crafted chats', mode: 'existing', folder: dir });
    expect(sync.restoreInto(p.id, dir)).toMatchObject({ chats: 1 });
    expect(fs.readdirSync(dataPath('projects', p.id, 'chats'))).toEqual(['agent-1']);
    expect(fs.readdirSync(dataPath('projects', p.id, 'chats', 'agent-1'))).toEqual(['c-ok.json']);
    expect(JSON.parse(fs.readFileSync(dataPath('projects', p.id, 'chats', 'agent-1', 'c-ok.json'), 'utf8'))).toMatchObject({ id: 'c-ok', agentId: 'agent-1' });
  });

  it.runIf(linksWork)("doesn't restore through a linked folder above the files (chats/, teamchats/ or .dashboard itself)", async () => {
    const chat = (id: string) => JSON.stringify({ id, agentId: 'agent-1', title: 't', items: [], llm: [], sessionId: null, createdAt: 1, updatedAt: 1 });
    // files somewhere else on the PC, laid out like a saved project
    const elsewhere = path.join(os.homedir(), 'elsewhere-saved');
    fs.mkdirSync(path.join(elsewhere, 'chats', 'agent-1'), { recursive: true });
    fs.mkdirSync(path.join(elsewhere, 'teamchats'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'chats', 'agent-1', 'c-out.json'), chat('c-out'));
    fs.writeFileSync(path.join(elsewhere, 'teamchats', 'team-out.json'), '{"messages":[]}');
    fs.writeFileSync(path.join(elsewhere, 'project.json'), JSON.stringify({ format: 1, app: 'my-dashboard', project: { name: 'Outside' }, agents: [{ id: 'agent-1', name: 'One' }], teams: [] }));
    const project = JSON.stringify({ format: 1, app: 'my-dashboard', project: {}, agents: [{ id: 'agent-1', name: 'One' }], teams: [] });

    // chats/ and teamchats/ are links
    const dir = folder('linked-subfolders');
    fs.mkdirSync(path.join(dir, '.dashboard'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.dashboard', 'project.json'), project);
    fs.symlinkSync(path.join(elsewhere, 'chats'), path.join(dir, '.dashboard', 'chats'), 'dir');
    fs.symlinkSync(path.join(elsewhere, 'teamchats'), path.join(dir, '.dashboard', 'teamchats'), 'dir');
    const p = await createProject({ name: 'Linked subfolders', mode: 'existing', folder: dir });
    expect(sync.restoreInto(p.id, dir)).toMatchObject({ agents: 1, chats: 0 });
    expect(fs.existsSync(dataPath('projects', p.id, 'chats', 'agent-1', 'c-out.json'))).toBe(false);
    expect(fs.existsSync(dataPath('projects', p.id, 'teamchats', 'team-out.json'))).toBe(false);

    // .dashboard itself is a link: nothing is read from it
    const dir2 = folder('linked-dashboard');
    fs.mkdirSync(dir2, { recursive: true });
    fs.symlinkSync(elsewhere, path.join(dir2, '.dashboard'), 'dir');
    expect(sync.peek(dir2)).toBeNull();
    const p2 = await createProject({ name: 'Linked dashboard', mode: 'existing', folder: dir2 });
    expect(sync.restoreInto(p2.id, dir2)).toBeNull();
    expect(fs.existsSync(dataPath('projects', p2.id, 'chats'))).toBe(false);
  });

  it('saves the versions of agents and teams, and brings them back with a deleted agent', async () => {
    const { historyOf, deletedItems } = await import('../../server/history.ts');
    const dir = folder('versions-trip');
    const p = await createProject({ name: 'Versions trip', mode: 'new', folder: dir });
    const a = newAgent({ name: 'Keeps history', systemPrompt: 'Old instructions.' });
    agents.save({ ...agents.get(a.id)!, systemPrompt: 'New instructions.' });
    const gone = newAgent({ name: 'Deleted one' });
    agents.remove(gone.id);
    const t = workflows.save({ name: 'Versioned team', description: 'First goal', members: [a.id], lead: null, steps: [] } as Partial<Team>);
    workflows.save({ ...workflows.get(t.id)!, description: 'Second goal' });
    sync.saveProject(p.id);
    expect(fs.readdirSync(path.join(dir, '.dashboard', 'versions')).sort()).toEqual(['agents', 'workflows']);
    expect(allText(path.join(dir, '.dashboard', 'versions'))).toContain('Old instructions.');

    const other = await createProject({ name: 'Versions elsewhere', mode: 'new', folder: folder('versions-elsewhere') });
    setActiveProject(other.id);
    removeProject(p.id);
    const again = await createProject({ name: 'Versions again', mode: 'existing', folder: dir });
    expect(sync.restoreInto(again.id, dir)).toMatchObject({ agents: 1, teams: 1, versions: 3 });
    setActiveProject(again.id);
    const h = historyOf('agent', a.id);
    expect(h.current).toContain('New instructions.');
    expect(h.versions).toHaveLength(1);
    expect(historyOf('team', t.id).versions[0].changes).toEqual(['goal']);
    expect(deletedItems('agent').map((x) => x.name)).toEqual(['Deleted one']);
  });

  it("restores only versions that are plain files inside the folder, under the item they were saved for", async () => {
    const dir = folder('crafted-versions');
    const d = path.join(dir, '.dashboard');
    const vdir = path.join(d, 'versions', 'agents', 'agent-1');
    fs.mkdirSync(vdir, { recursive: true });
    fs.mkdirSync(path.join(d, 'versions', 'routines', 'r-1'), { recursive: true });
    fs.writeFileSync(path.join(d, 'project.json'), JSON.stringify({ format: 1, app: 'my-dashboard', project: {}, agents: [{ id: 'agent-1', name: 'One' }], teams: [] }));
    // claims another agent: it's put back under agent-1
    fs.writeFileSync(path.join(vdir, 'v-ok.json'), JSON.stringify({ id: 'v-other', at: 5, by: 'root', item: { id: 'someone-else', name: 'Old one' } }));
    fs.writeFileSync(path.join(vdir, 'v-bad.json'), JSON.stringify({ at: 'soon', item: 'nope' }));
    fs.writeFileSync(path.join(d, 'versions', 'routines', 'r-1', 'v-r.json'), JSON.stringify({ at: 1, by: 'you', item: { id: 'r-1' } }));
    if (linksWork) {
      const secret = path.join(os.homedir(), 'version-secret.json');
      fs.writeFileSync(secret, JSON.stringify({ at: 9, by: 'you', item: { id: 'agent-1', name: 'From outside' } }));
      fs.symlinkSync(secret, path.join(vdir, 'v-link.json'));
    }
    const p = await createProject({ name: 'Crafted versions', mode: 'existing', folder: dir });
    expect(sync.restoreInto(p.id, dir)).toMatchObject({ versions: 1 });
    const kept = dataPath('projects', p.id, 'versions', 'agents', 'agent-1');
    expect(fs.readdirSync(kept)).toEqual(['v-ok.json']);
    expect(JSON.parse(fs.readFileSync(path.join(kept, 'v-ok.json'), 'utf8'))).toEqual({ id: 'v-ok', at: 5, by: 'you', item: { id: 'agent-1', name: 'Old one' } });
    expect(fs.existsSync(dataPath('projects', p.id, 'versions', 'routines'))).toBe(false);
  });

  it('carries the skills the project uses, with their files and versions, into a library that lacks them', async () => {
    const skills = await import('../../server/skills.ts');
    const { historyOf } = await import('../../server/history.ts');
    const { saveRoutine } = await import('../../server/routines.ts');
    const dir = folder('skills-trip');
    const p = await createProject({ name: 'Skills trip', mode: 'new', folder: dir });
    skills.saveSkill({ name: 'Trip agent skill', description: 'Use a.', body: 'Agent v1.' });
    skills.saveSkill({ slug: 'trip-agent-skill', name: 'Trip agent skill', description: 'Use a.', body: 'Agent v2.' });
    fs.writeFileSync(path.join(skills.skillDir('trip-agent-skill'), 'ref.md'), 'a reference');
    skills.saveSkill({ name: 'Trip team skill', description: 'Use t.', body: 'Team.' });
    skills.saveSkill({ name: 'Trip routine skill', description: 'Use r.', body: 'Routine.' });
    skills.saveSkill({ name: 'Trip unused skill', description: 'Use u.', body: 'Unused.' });
    const a = newAgent({ name: 'Skilled', skills: ['trip-agent-skill'] });
    workflows.save({ name: 'Skilled team', members: [a.id], lead: null, steps: [], skills: ['trip-team-skill'] } as Partial<Team>);
    saveRoutine({ name: 'Uses a skill', text: '@Skilled works with @Trip routine skill.' });
    sync.saveProject(p.id);
    const out = path.join(dir, '.dashboard');
    expect(fs.readdirSync(path.join(out, 'skills')).sort()).toEqual(['trip-agent-skill', 'trip-routine-skill', 'trip-team-skill']);
    expect(fs.readdirSync(path.join(out, 'skill-versions'))).toEqual(['trip-agent-skill']);

    // another PC: the library doesn't have them
    for (const slug of ['trip-agent-skill', 'trip-team-skill', 'trip-routine-skill']) {
      fs.rmSync(skills.skillDir(slug), { recursive: true });
      fs.rmSync(skills.skillVersionsDir(slug), { recursive: true, force: true });
    }
    const other = await createProject({ name: 'Skills elsewhere', mode: 'new', folder: folder('skills-elsewhere') });
    setActiveProject(other.id);
    removeProject(p.id);
    const again = await createProject({ name: 'Skills again', mode: 'existing', folder: dir });
    const r = sync.restoreInto(again.id, dir);
    expect(r?.skills?.added.sort()).toEqual(['Trip agent skill', 'Trip routine skill', 'Trip team skill']);
    expect(skills.getSkill('trip-agent-skill')?.body).toContain('Agent v2.');
    expect(fs.readFileSync(path.join(skills.skillDir('trip-agent-skill'), 'ref.md'), 'utf8')).toBe('a reference');
    const h = historyOf('skill', 'trip-agent-skill');
    expect(h.versions).toHaveLength(1);
    expect(h.versions[0].changes).toEqual(['instructions']);

    // the project stops using a skill: the folder drops it
    setActiveProject(again.id);
    agents.save({ ...agents.get(a.id)!, skills: [] });
    sync.saveProject(again.id);
    expect(fs.readdirSync(path.join(out, 'skills')).sort()).toEqual(['trip-routine-skill', 'trip-team-skill']);
    expect(fs.existsSync(path.join(out, 'skill-versions'))).toBe(true);
    expect(fs.readdirSync(path.join(out, 'skill-versions'))).toEqual([]);
  });

  it("never changes a skill the library already has: a different copy becomes one of its versions", async () => {
    const skills = await import('../../server/skills.ts');
    const { historyOf, versionOf } = await import('../../server/history.ts');
    const dir = folder('skill-clash');
    const d = path.join(dir, '.dashboard');
    fs.mkdirSync(path.join(d, 'skills', 'clash-skill'), { recursive: true });
    fs.mkdirSync(path.join(d, 'skills', 'same-skill'), { recursive: true });
    fs.writeFileSync(path.join(d, 'project.json'), JSON.stringify({ format: 1, app: 'my-dashboard', project: { name: 'Clash' }, agents: [{ id: 'agent-c', name: 'C', skills: ['clash-skill'] }], teams: [] }));
    fs.writeFileSync(path.join(d, 'skills', 'clash-skill', 'SKILL.md'), '---\nname: Clash skill\ndescription: Theirs.\n---\n\nTheir steps.\n');
    skills.saveSkill({ name: 'Clash skill', description: 'Ours.', body: 'Our steps.' });
    const same = skills.saveSkill({ name: 'Same skill', description: 'Same.', body: 'Same steps.' })!;
    fs.copyFileSync(path.join(skills.skillDir(same.slug), 'SKILL.md'), path.join(d, 'skills', 'same-skill', 'SKILL.md'));
    const p = await createProject({ name: 'Clash', mode: 'existing', folder: dir });
    expect(sync.restoreInto(p.id, dir)?.skills).toEqual({ added: [], kept: ['Clash skill'] });
    expect(skills.getSkill('clash-skill')?.body).toContain('Our steps.');
    const h = historyOf('skill', 'clash-skill');
    expect(h.versions[0].note).toContain('Clash');
    expect(versionOf('skill', 'clash-skill', h.versions[0].id).text).toContain('Their steps.');
    expect(historyOf('skill', 'same-skill').versions).toHaveLength(0);
  });

  it('a project copy that differs only in its files is kept as a version, with those files', async () => {
    const skills = await import('../../server/skills.ts');
    const { historyOf, restoreVersion } = await import('../../server/history.ts');
    const dir = folder('skill-files-clash');
    const d = path.join(dir, '.dashboard');
    fs.mkdirSync(path.join(d, 'skills', 'files-clash'), { recursive: true });
    fs.writeFileSync(path.join(d, 'project.json'), JSON.stringify({ format: 1, app: 'my-dashboard', project: { name: 'Files clash' }, agents: [{ id: 'agent-f', name: 'F' }], teams: [] }));
    const ours = skills.saveSkill({ name: 'Files clash', description: 'Same text.', body: 'Same body.' })!;
    fs.copyFileSync(path.join(skills.skillDir(ours.slug), 'SKILL.md'), path.join(d, 'skills', 'files-clash', 'SKILL.md'));
    fs.writeFileSync(path.join(skills.skillDir(ours.slug), 'ref.md'), 'our reference');
    fs.writeFileSync(path.join(d, 'skills', 'files-clash', 'ref.md'), 'their reference');
    const p = await createProject({ name: 'Files clash', mode: 'existing', folder: dir });
    expect(sync.restoreInto(p.id, dir)?.skills?.kept).toEqual(['Files clash']);
    expect(fs.readFileSync(path.join(skills.skillDir(ours.slug), 'ref.md'), 'utf8')).toBe('our reference');
    restoreVersion('skill', ours.slug, historyOf('skill', ours.slug).versions[0].id);
    expect(fs.readFileSync(path.join(skills.skillDir(ours.slug), 'ref.md'), 'utf8')).toBe('their reference');
  });

  it("a synced skill's history keeps the files of its versions", async () => {
    const skills = await import('../../server/skills.ts');
    const { historyOf, restoreVersion, undelete } = await import('../../server/history.ts');
    const dir = folder('skill-version-files');
    const p = await createProject({ name: 'Version files', mode: 'new', folder: dir });
    const s = skills.saveSkill({ name: 'Version files skill', description: 'Use v.', body: 'First.' })!;
    fs.writeFileSync(path.join(skills.skillDir(s.slug), 'first.md'), 'first file');
    newAgent({ name: 'Uses it', skills: [s.slug] });
    skills.deleteSkillEverywhere(s.slug);
    undelete('skill', s.slug);
    // changed since: another file
    fs.rmSync(path.join(skills.skillDir(s.slug), 'first.md'));
    fs.writeFileSync(path.join(skills.skillDir(s.slug), 'second.md'), 'second file');
    agents.save({ ...agents.list().find((x) => x.name === 'Uses it')!, skills: [s.slug] });
    sync.saveProject(p.id);
    // another PC
    fs.rmSync(skills.skillDir(s.slug), { recursive: true });
    fs.rmSync(skills.skillVersionsDir(s.slug), { recursive: true });
    const other = await createProject({ name: 'Version files elsewhere', mode: 'new', folder: folder('version-files-elsewhere') });
    setActiveProject(other.id);
    removeProject(p.id);
    const again = await createProject({ name: 'Version files again', mode: 'existing', folder: dir });
    sync.restoreInto(again.id, dir);
    const deleted = historyOf('skill', s.slug).versions.find((v) => v.deleted)!;
    restoreVersion('skill', s.slug, deleted.id);
    expect(skills.skillExtraFiles(skills.skillDir(s.slug))).toEqual(['first.md']);
  });

  it('a skill change saves every project that uses it, not only the open one', async () => {
    const skills = await import('../../server/skills.ts');
    const user = await createProject({ name: 'Uses shared', mode: 'new', folder: folder('uses-shared') });
    const s = skills.saveSkill({ name: 'Shared everywhere', description: 'Use anywhere.', body: 'Shared.' })!;
    newAgent({ name: 'Shared user', skills: [s.slug] });
    const bystander = await createProject({ name: 'Bystander', mode: 'new', folder: folder('bystander') });
    setActiveProject(bystander.id);
    expect(sync.projectsWithSkills([s.slug])).toEqual([user.id]);
  });

  it("doesn't add skills that aren't skills, or through links", async () => {
    const skills = await import('../../server/skills.ts');
    const dir = folder('crafted-skills');
    const d = path.join(dir, '.dashboard');
    fs.mkdirSync(path.join(d, 'skills', 'no-skill-md'), { recursive: true });
    fs.mkdirSync(path.join(d, 'skills', 'Bad Name'), { recursive: true });
    fs.mkdirSync(path.join(d, 'skill-versions', 'crafted-ok'), { recursive: true });
    fs.mkdirSync(path.join(d, 'skills', 'crafted-ok'), { recursive: true });
    fs.writeFileSync(path.join(d, 'project.json'), JSON.stringify({ format: 1, app: 'my-dashboard', project: {}, agents: [{ id: 'agent-s', name: 'S' }], teams: [] }));
    fs.writeFileSync(path.join(d, 'skills', 'no-skill-md', 'notes.md'), 'x');
    fs.writeFileSync(path.join(d, 'skills', 'Bad Name', 'SKILL.md'), '---\nname: Bad\ndescription: x\n---\nx');
    fs.writeFileSync(path.join(d, 'skills', 'crafted-ok', 'SKILL.md'), '---\nname: Crafted ok\ndescription: Fine.\n---\nFine.');
    fs.writeFileSync(path.join(d, 'skill-versions', 'crafted-ok', 'v-good.json'), JSON.stringify({ at: 3, by: 'brain', item: { slug: 'other', name: 'Crafted ok', description: 'Old.', body: 'Older.' } }));
    fs.writeFileSync(path.join(d, 'skill-versions', 'crafted-ok', 'v-bad.json'), JSON.stringify({ at: 4, by: 'you', item: { name: 7 } }));
    if (linksWork) {
      const outside = path.join(os.homedir(), 'outside-skill');
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, 'SKILL.md'), '---\nname: Linked\ndescription: x\n---\nx');
      fs.symlinkSync(outside, path.join(d, 'skills', 'linked-skill'), 'dir');
      fs.writeFileSync(path.join(os.homedir(), 'secret.txt'), 'secret');
      fs.symlinkSync(path.join(os.homedir(), 'secret.txt'), path.join(d, 'skills', 'crafted-ok', 'secret.txt'));
    }
    const p = await createProject({ name: 'Crafted skills', mode: 'existing', folder: dir });
    expect(sync.restoreInto(p.id, dir)?.skills?.added).toEqual(['Crafted ok']);
    expect(skills.getSkill('no-skill-md')).toBeNull();
    expect(skills.getSkill('linked-skill')).toBeNull();
    expect(fs.existsSync(path.join(skills.skillDir('crafted-ok'), 'secret.txt'))).toBe(false);
    const kept = fs.readdirSync(skills.skillVersionsDir('crafted-ok'));
    expect(kept).toEqual(['v-good.json']);
    expect(JSON.parse(fs.readFileSync(path.join(skills.skillVersionsDir('crafted-ok'), 'v-good.json'), 'utf8')).item).toEqual({ slug: 'crafted-ok', name: 'Crafted ok', description: 'Old.', body: 'Older.' });
  });

  it('never restores over a project that already has agents', async () => {
    const dir = folder('busy');
    const p = await createProject({ name: 'Busy', mode: 'new', folder: dir });
    newAgent({ name: 'Already here' });
    sync.saveProject(p.id);
    expect(sync.restoreInto(p.id, dir)).toBeNull();
  });

  it('drops team chats and knowledge files that were deleted in the dashboard', async () => {
    const p = await createProject({ name: 'Pruned', mode: 'new', folder: folder('pruned') });
    const src = (...x: string[]) => dataPath('projects', p.id, ...x);
    const out = (...x: string[]) => path.join(p.brainPath, '.dashboard', ...x);
    fs.mkdirSync(src('teamchats'), { recursive: true });
    fs.writeFileSync(src('teamchats', 'gone.json'), '{"messages":[]}');
    fs.writeFileSync(src('teamchats', 'kept.json'), '{"messages":[]}');
    fs.mkdirSync(src('knowledge', 'agent-1'), { recursive: true });
    fs.writeFileSync(src('knowledge', 'agent-1', 'old.md'), 'old');
    fs.writeFileSync(src('knowledge', 'agent-1', 'still.md'), 'still');
    fs.mkdirSync(src('knowledge', 'agent-2'), { recursive: true });
    fs.writeFileSync(src('knowledge', 'agent-2', 'notes.md'), 'notes');
    sync.saveProject(p.id);
    expect(fs.existsSync(out('teamchats', 'gone.json'))).toBe(true);
    expect(fs.existsSync(out('knowledge', 'agent-2', 'notes.md'))).toBe(true);
    fs.rmSync(src('teamchats', 'gone.json'));
    fs.rmSync(src('knowledge', 'agent-1', 'old.md'));
    fs.rmSync(src('knowledge', 'agent-2'), { recursive: true });
    expect(sync.saveProject(p.id)?.error).toBeUndefined();
    expect(fs.readdirSync(out('teamchats'))).toEqual(['kept.json']);
    expect(fs.readdirSync(out('knowledge'))).toEqual(['agent-1']);
    expect(fs.readdirSync(out('knowledge', 'agent-1'))).toEqual(['still.md']);
  });

  it.runIf(linksWork)("won't write through a link planted in the project folder", async () => {
    const p = await createProject({ name: 'Planted', mode: 'new', folder: folder('planted') });
    const victim = path.join(os.homedir(), 'victim.txt');
    fs.writeFileSync(victim, 'original');
    fs.mkdirSync(path.join(p.brainPath, '.dashboard', 'teamchats'), { recursive: true });
    fs.symlinkSync(victim, path.join(p.brainPath, '.dashboard', 'teamchats', 'team-1.json'));
    fs.mkdirSync(dataPath('projects', p.id, 'teamchats'), { recursive: true });
    fs.writeFileSync(dataPath('projects', p.id, 'teamchats', 'team-1.json'), '{"messages":["overwritten"]}');
    expect(sync.saveProject(p.id)?.error).toMatch(/link/);
    expect(fs.readFileSync(victim, 'utf8')).toBe('original');
  });

  it.runIf(linksWork)("won't empty a folder that a planted knowledge link points at", async () => {
    const p = await createProject({ name: 'Planted dir', mode: 'new', folder: folder('planted-dir') });
    const precious = path.join(os.homedir(), 'precious');
    fs.mkdirSync(precious, { recursive: true });
    fs.writeFileSync(path.join(precious, 'thesis.md'), 'years of work');
    fs.mkdirSync(path.join(p.brainPath, '.dashboard'), { recursive: true });
    fs.symlinkSync(precious, path.join(p.brainPath, '.dashboard', 'knowledge'));
    fs.mkdirSync(dataPath('projects', p.id, 'knowledge', 'agent-1'), { recursive: true });
    fs.writeFileSync(dataPath('projects', p.id, 'knowledge', 'agent-1', 'a.md'), 'a');
    expect(sync.saveProject(p.id)?.error).toMatch(/link/);
    expect(fs.readdirSync(precious)).toEqual(['thesis.md']);
  });

  it.runIf(linksWork)("doesn't follow links when restoring team chats", async () => {
    const dir = folder('crafted');
    const secret = path.join(os.homedir(), 'secret.json');
    fs.writeFileSync(secret, '{"token":"abc"}');
    fs.mkdirSync(path.join(dir, '.dashboard', 'teamchats'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.dashboard', 'project.json'), JSON.stringify({ format: 1, app: 'my-dashboard', project: {}, agents: [], teams: [] }));
    fs.symlinkSync(secret, path.join(dir, '.dashboard', 'teamchats', 'stolen.json'));
    const p = await createProject({ name: 'Crafted', mode: 'existing', folder: dir });
    sync.restoreInto(p.id, dir);
    expect(fs.existsSync(dataPath('projects', p.id, 'teamchats', 'stolen.json'))).toBe(false);
  });

  it.runIf(linksWork)('never saves through a link in the data folder (keys or files elsewhere on the PC)', async () => {
    setSecret('openrouterKey', 'sk-or-v1-autosave-link-sentinel-9191');
    const outside = path.join(os.homedir(), 'private-notes');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'diary.md'), 'outside-sentinel-3131');
    const p = await createProject({ name: 'Links in data', mode: 'new', folder: folder('links-in-data') });
    const a = newAgent({ name: 'Plain' });
    const pd = (...x: string[]) => dataPath('projects', p.id, ...x);
    // a knowledge file saved first: it must go once knowledge/ turns into a link
    fs.mkdirSync(pd('knowledge', a.id), { recursive: true });
    fs.writeFileSync(pd('knowledge', a.id, 'brief.md'), 'fine');
    sync.saveProject(p.id);
    const out = path.join(p.brainPath, '.dashboard');
    expect(fs.existsSync(path.join(out, 'knowledge', a.id, 'brief.md'))).toBe(true);

    for (const sub of ['agents', 'workflows', 'routines', 'teamchats']) {
      fs.mkdirSync(pd(sub), { recursive: true });
      fs.symlinkSync(dataPath('secrets.json'), pd(sub, 'leak.json'));
    }
    fs.symlinkSync(dataPath('secrets.json'), pd('layout.json'));
    fs.symlinkSync(dataPath('secrets.json'), pd('brain-chat.json'));
    fs.rmSync(pd('knowledge'), { recursive: true });
    fs.symlinkSync(outside, pd('knowledge'));
    fs.mkdirSync(pd('chats'), { recursive: true });
    fs.symlinkSync(outside, pd('chats', 'linked-agent'));

    const st = sync.saveProject(p.id);
    expect(st?.error).toBeUndefined();
    expect(st).toMatchObject({ agents: 1 });
    const text = allText(out);
    expect(text).not.toContain('autosave-link-sentinel');
    expect(text).not.toContain('outside-sentinel');
    expect(fs.existsSync(path.join(out, 'knowledge', a.id, 'brief.md'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'teamchats', 'leak.json'))).toBe(false);
    const saved = JSON.parse(fs.readFileSync(path.join(out, 'project.json'), 'utf8'));
    expect(saved.layout).toEqual({});
    expect(saved.brainChat).toEqual({ messages: [] });
    // and the folder the link pointed at is untouched
    expect(fs.readFileSync(path.join(outside, 'diary.md'), 'utf8')).toBe('outside-sentinel-3131');
  });

  it.runIf(linksWork)('never saves from a data folder that is itself a link (agents/, teamchats/ -> elsewhere)', async () => {
    const elsewhere = path.join(os.homedir(), 'elsewhere-json');
    fs.mkdirSync(path.join(elsewhere, 'agent-dir'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'stolen.json'), JSON.stringify({ id: 'stolen', name: 'Stolen', token: 'folder-link-sentinel-4242', members: [], mentions: [] }));
    const p = await createProject({ name: 'Linked folders', mode: 'new', folder: folder('linked-folders') });
    const pd = (...x: string[]) => dataPath('projects', p.id, ...x);
    for (const sub of ['agents', 'workflows', 'routines', 'teamchats']) {
      fs.rmSync(pd(sub), { recursive: true, force: true });
      fs.mkdirSync(pd(), { recursive: true });
      fs.symlinkSync(elsewhere, pd(sub));
    }
    const st = sync.saveProject(p.id);
    expect(st?.error).toBeUndefined();
    expect(st).toMatchObject({ agents: 0, teams: 0 });
    expect(allText(path.join(p.brainPath, '.dashboard'))).not.toContain('folder-link-sentinel');
  });

  // directory junctions need no admin rights on Windows (elsewhere 'junction' makes a plain folder link)
  it.each(['skills', 'skill-versions', 'versions'])("won't prune a folder that a planted .dashboard/%s link points at", async (sub) => {
    const p = await createProject({ name: `Planted ${sub}`, mode: 'new', folder: folder(`planted-${sub}`) });
    const precious = path.join(os.homedir(), `precious-${sub}`);
    fs.mkdirSync(precious, { recursive: true });
    fs.writeFileSync(path.join(precious, 'precious.txt'), 'keep me');
    fs.mkdirSync(path.join(p.brainPath, '.dashboard'), { recursive: true });
    fs.symlinkSync(precious, path.join(p.brainPath, '.dashboard', sub), 'junction');
    expect(sync.saveProject(p.id)?.error).toMatch(/link/);
    expect(fs.readFileSync(path.join(precious, 'precious.txt'), 'utf8')).toBe('keep me');
  });
});
