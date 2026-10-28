import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { agents, chats, workflows, routines, setSecret, listProjects } from '../../server/store.ts';
import { createProject, setLogo } from '../../server/projects.ts';
import { newAgent } from '../../server/library.ts';
import { saveSkill, getSkill, skillsLibrary } from '../../server/skills.ts';
import { saveAgentPreset, listPresets, deletePreset } from '../../server/presets.ts';
import { addKnowledgeFile } from '../../server/knowledge.ts';
import { dataPath } from '../../server/util.ts';
import * as backup from '../../server/backup.ts';
import type { Team } from '../../shared/types.ts';

const folder = (name: string) => path.join(os.homedir(), 'projects', name);
const linksWork = process.platform !== 'win32'; // file links need admin rights on Windows
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// A backup file with a hand-made payload (for files a real backup would never contain)
function craft(payload: Record<string, unknown>): Buffer {
  const head = `MY-DASHBOARD-BACKUP 1\n${JSON.stringify({ app: 'my-dashboard', name: 'Crafted' })}\n`;
  return Buffer.concat([Buffer.from(head), zlib.gzipSync(JSON.stringify({ app: 'my-dashboard', kind: 'workspace-backup', format: 1, createdAt: 1, project: { name: 'Crafted' }, ...payload }))]);
}

describe('workspace backups', () => {
  it('writes one file in <home>/Blacksite Backups with the project, its chats and knowledge, every skill and preset, and no keys', async () => {
    setSecret('anthropicKey', 'sk-ant-sentinel-not-in-backups-777');
    const p = await createProject({ name: 'Backed Up', mode: 'new', folder: folder('backed-up'), description: 'Launch work' });
    fs.writeFileSync(path.join(p.brainPath, 'PROJECT.md'), '# Backed Up\n\nThe plan.');
    fs.writeFileSync(path.join(p.brainPath, 'notes', 'idea.md'), 'An idea');
    setLogo(p.id, `data:image/png;base64,${PNG}`);
    const skill = saveSkill({ name: 'Voice Guide', description: 'How we write', body: 'Short sentences.' })!;
    fs.writeFileSync(path.join(skillsLibrary(), skill.slug, 'examples.md'), 'Example one');
    const a = newAgent({ name: 'Writer', skills: [skill.slug], workspace: path.join(p.brainPath, 'drafts') });
    const b = newAgent({ name: 'Editor' });
    workflows.save({ name: 'Crew', members: [a.id, b.id], lead: a.id, steps: [], skills: [skill.slug], schedule: { type: 'daily', time: '09:00' }, enabled: true } as Partial<Team>);
    routines.save({ name: 'Daily', text: '@Writer writes. Use @Voice Guide', mentions: [{ kind: 'agent', id: a.id, name: 'Writer' }, { kind: 'skill', id: skill.slug, name: 'Voice Guide' }], schedule: { type: 'daily', time: '08:00' }, enabled: true });
    const c = chats.create(a.id, 'First draft');
    c.items.push({ type: 'user', text: 'Write the launch post' }, { type: 'assistant', text: 'Here it is' });
    chats.save(c);
    addKnowledgeFile(a.id, 'brand.md', 'Brand is calm.');
    saveAgentPreset(b.id, { name: 'Editor preset' });

    const r = backup.createBackup(p.id);
    expect(path.dirname(r.file)).toBe(path.join(os.homedir(), 'Blacksite Backups'));
    expect(r.name).toMatch(/^backed-up-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.dashbackup$/);
    expect(r.summary).toMatchObject({ name: 'Backed Up', agents: 2, teams: 1, routines: 1, chats: 1, knowledgeFiles: 1 });
    expect(r.summary.skills).toBeGreaterThanOrEqual(1);
    expect(r.summary.presets).toBeGreaterThanOrEqual(1);

    const bytes = fs.readFileSync(r.file);
    expect(bytes.toString('utf8', 0, 20)).toBe('MY-DASHBOARD-BACKUP ');
    const data = backup.decodeBackup(bytes);
    expect(data.agents.map((x) => x.name).sort()).toEqual(['Editor', 'Writer']);
    expect(data.chats[0].chat.items).toHaveLength(2);
    expect(data.knowledge.map((f) => f.path)).toEqual([`${a.id}/brand.md`]);
    expect(data.brain.map((f) => f.path).sort()).toEqual(['BRAIN.md', 'PROJECT.md', 'notes/idea.md']);
    expect(data.logo?.path).toBe('logo.png');
    expect(data.skills.find((s) => s.slug === skill.slug)?.files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'examples.md']);
    expect(data.presets.some((x) => x.name === 'Editor preset')).toBe(true);
    expect(zlib.gunzipSync(bytes.subarray(bytes.indexOf(0x0a, bytes.indexOf(0x0a) + 1) + 1)).toString()).not.toContain('sentinel-not-in-backups');

    const listed = backup.listBackups().find((x) => x.name === r.name);
    expect(listed?.summary).toMatchObject({ name: 'Backed Up', agents: 2 });
  });

  it('restores a backup as a new project in a new folder, with agents, teams, routines, chats, knowledge, notes and logo', async () => {
    const src = listProjects().find((p) => p.name === 'Backed Up')!;
    const file = backup.listBackups().find((x) => x.summary?.name === 'Backed Up')!;
    const { project, restored } = await backup.restoreBackup(backup.readBackupFile(file.name), {});
    // a new folder, not the original project's
    expect(project.id).not.toBe(src.id);
    expect(project.brainPath).not.toBe(src.brainPath);
    expect(project.name).toBe('Backed Up');
    expect(project.description).toBe('Launch work');
    expect(restored).toMatchObject({ agents: 2, teams: 1, routines: 1, chats: 1, knowledgeFiles: 1, logo: true });
    expect(restored.skills.added).toBe(0); // same skills already in the library
    // it is open now, and has what the original had
    const list = agents.list();
    const writer = list.find((x) => x.name === 'Writer')!;
    expect(list).toHaveLength(2);
    expect(writer.workspace).toBe(path.join(project.brainPath, 'drafts'));
    expect(chats.list(writer.id)[0]).toMatchObject({ title: 'First draft', count: 2 });
    expect(fs.readFileSync(dataPath('projects', project.id, 'knowledge', writer.id, 'brand.md'), 'utf8')).toBe('Brand is calm.');
    expect(fs.readFileSync(path.join(project.brainPath, 'PROJECT.md'), 'utf8')).toContain('The plan.');
    expect(fs.readFileSync(path.join(project.brainPath, 'notes', 'idea.md'), 'utf8')).toBe('An idea');
    expect(fs.existsSync(path.join(project.brainPath, '.dashboard', 'logo.png'))).toBe(true);
    // schedules are paused so the copy doesn't run them twice
    expect(restored.paused).toBe(2);
    expect(workflows.list()[0].enabled).toBe(false);
    expect(routines.list()[0].enabled).toBe(false);
  });

  it('adds skills and presets you lack, and keeps yours when a skill with the same id differs', async () => {
    const src = listProjects().find((p) => p.name === 'Backed Up')!;
    const file = backup.createBackup(src.id);
    const slug = getSkill('voice-guide')!.slug;
    // change the skill here, and remove the preset: the backup still has the old ones
    saveSkill({ slug, name: 'Voice Guide', description: 'How we write', body: 'Long sentences now.' });
    const preset = listPresets().find((x) => x.name === 'Editor preset')!;
    deletePreset(preset.id);

    const { project, restored } = await backup.restoreBackup(fs.readFileSync(file.file), { name: 'Second copy' });
    expect(project.name).toBe('Second copy');
    expect(restored.skills.renamed).toEqual([{ from: slug, to: `${slug}-restored` }]);
    expect(getSkill(slug)!.body).toContain('Long sentences now.');
    expect(getSkill(`${slug}-restored`)!.body).toContain('Short sentences.');
    // what used the old skill uses the restored one
    expect(agents.list().find((x) => x.name === 'Writer')!.skills).toEqual([`${slug}-restored`]);
    expect(workflows.list()[0].skills).toEqual([`${slug}-restored`]);
    expect(routines.list()[0].mentions.find((m) => m.kind === 'skill')!.id).toBe(`${slug}-restored`);
    expect(restored.presets.added).toBe(1);
    expect(listPresets().some((x) => x.id === preset.id)).toBe(true);
  });

  it("won't restore into a folder another project uses, and never overwrites files in a folder you have", async () => {
    const src = listProjects().find((p) => p.name === 'Backed Up')!;
    const bytes = fs.readFileSync(backup.createBackup(src.id).file);
    await expect(backup.restoreBackup(bytes, { folder: src.brainPath })).rejects.toThrow(/belongs to the project "Backed Up"/);
    const mine = folder('mine');
    fs.mkdirSync(path.join(mine, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(mine, 'PROJECT.md'), 'My own brief');
    fs.writeFileSync(path.join(mine, 'notes', 'idea.md'), 'My own idea');
    const { project } = await backup.restoreBackup(bytes, { folder: mine, name: 'Into mine' });
    expect(project.brainPath).toBe(path.resolve(mine));
    expect(fs.readFileSync(path.join(mine, 'PROJECT.md'), 'utf8')).toBe('My own brief');
    expect(fs.readFileSync(path.join(mine, 'notes', 'idea.md'), 'utf8')).toBe('My own idea');
  });

  it('turns away files that are not backups, damaged or from a newer version', async () => {
    const before = listProjects().length;
    await expect(backup.restoreBackup(Buffer.from('{"hello":1}'))).rejects.toThrow(/isn't a dashboard backup/);
    await expect(backup.restoreBackup(Buffer.from('MY-DASHBOARD-BACKUP 1\n{}\nnot gzip'))).rejects.toThrow(/damaged/);
    await expect(backup.restoreBackup(Buffer.from('MY-DASHBOARD-BACKUP 99\n{}\n'))).rejects.toThrow(/newer version/);
    await expect(backup.restoreBackup(craft({ kind: 'something-else' }))).rejects.toThrow(/isn't a dashboard backup/);
    expect(listProjects().length).toBe(before); // nothing was created
    expect(() => backup.readBackupFile('../secrets.json')).toThrow(/No such backup/);
    expect(() => backup.readBackupFile('missing.dashbackup')).toThrow(/No such backup/);
  });

  it('keeps every file from a crafted backup inside its folder', async () => {
    const outside = path.join(os.homedir(), 'escaped.txt');
    const data = Buffer.from('pwned').toString('base64');
    const { project, restored } = await backup.restoreBackup(
      craft({
        agents: [{ id: 'ok-agent', name: 'Ok' }, { id: '../evil', name: 'Evil' }],
        chats: [{ agentId: '..', chat: { id: 'x', items: [] } }],
        knowledge: [{ path: '../../../escaped.txt', data }, { path: '/etc/escaped.txt', data }, { path: 'C:/escaped.txt', data }, { path: 'ok-agent/fine.md', data }],
        brain: [{ path: '../escaped.txt', data }, { path: 'notes/../../escaped.txt', data }, { path: 'secret.txt', data }],
        skills: [{ slug: '../evil', files: [{ path: 'SKILL.md', data }] }, { slug: 'crafted-skill', files: [{ path: 'SKILL.md', data }, { path: '../../escaped.txt', data }] }],
        presets: [{ id: '../../x', kind: 'agent', name: 'Bad' }],
        logo: { path: 'logo.png', data }, // not a real image
      }),
    );
    expect(fs.existsSync(outside)).toBe(false);
    // where '../../escaped.txt' from a skill's folder would land
    expect(fs.existsSync(dataPath('escaped.txt'))).toBe(false);
    expect(restored.agents).toBe(1);
    expect(restored.knowledgeFiles).toBe(1);
    expect(restored.brainFiles).toBe(0);
    expect(restored.logo).toBe(false);
    expect(fs.existsSync(path.join(project.brainPath, 'secret.txt'))).toBe(false);
    expect(fs.existsSync(path.join(skillsLibrary(), 'crafted-skill', 'SKILL.md'))).toBe(true);
    expect(fs.readdirSync(path.dirname(skillsLibrary()))).not.toContain('evil');
  });

  it.skipIf(!linksWork)('never packs a linked .json (it could point at the keys)', async () => {
    setSecret('openrouterKey', 'sk-or-linked-sentinel-555');
    const p = await createProject({ name: 'Linked', mode: 'new', folder: folder('linked') });
    newAgent({ name: 'Plain' });
    for (const sub of ['agents', 'workflows', 'routines', 'teamchats']) {
      fs.mkdirSync(dataPath('projects', p.id, sub), { recursive: true });
      fs.symlinkSync(dataPath('secrets.json'), dataPath('projects', p.id, sub, 'leak.json'));
    }
    fs.mkdirSync(dataPath('presets'), { recursive: true });
    fs.symlinkSync(dataPath('secrets.json'), dataPath('presets', 'pa-leak.json'));
    fs.symlinkSync(dataPath('secrets.json'), dataPath('projects', p.id, 'layout.json'));
    fs.symlinkSync(dataPath('secrets.json'), dataPath('projects', p.id, 'brain-chat.json'));
    const r = backup.createBackup(p.id);
    const bytes = fs.readFileSync(r.file);
    const all = zlib.gunzipSync(bytes.subarray(bytes.indexOf(0x0a, bytes.indexOf(0x0a) + 1) + 1)).toString();
    expect(all).not.toContain('linked-sentinel');
    expect(r.summary.agents).toBe(1);
    fs.rmSync(dataPath('presets', 'pa-leak.json'));
  });

  it.skipIf(!linksWork)('never packs from a data folder that is itself a link', async () => {
    const elsewhere = path.join(os.homedir(), 'elsewhere-backup');
    fs.mkdirSync(path.join(elsewhere, 'some-agent'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'stolen.json'), JSON.stringify({ id: 'stolen', name: 'Stolen', items: [], note: 'dir-link-sentinel-6060' }));
    fs.writeFileSync(path.join(elsewhere, 'some-agent', 'c1.json'), JSON.stringify({ id: 'c1', items: [], note: 'dir-link-sentinel-6060' }));
    const p = await createProject({ name: 'Linked dirs', mode: 'new', folder: folder('linked-dirs') });
    const pd = (...x: string[]) => dataPath('projects', p.id, ...x);
    for (const sub of ['agents', 'workflows', 'routines', 'teamchats', 'knowledge', 'chats']) {
      fs.rmSync(pd(sub), { recursive: true, force: true });
      fs.mkdirSync(pd(), { recursive: true });
      fs.symlinkSync(elsewhere, pd(sub));
    }
    const r = backup.createBackup(p.id);
    const bytes = fs.readFileSync(r.file);
    expect(zlib.gunzipSync(bytes.subarray(bytes.indexOf(0x0a, bytes.indexOf(0x0a) + 1) + 1)).toString()).not.toContain('dir-link-sentinel');
    expect(r.summary).toMatchObject({ agents: 0, teams: 0, chats: 0, knowledgeFiles: 0 });
  });

  it('counts a skill as the same only when it has exactly the same files', async () => {
    const s = saveSkill({ name: 'Exact Files', description: 'For the file-list check', body: 'Body.' })!;
    const p = await createProject({ name: 'Exact', mode: 'new', folder: folder('exact') });
    newAgent({ name: 'User', skills: [s.slug] });
    const file = backup.createBackup(p.id).file;
    // the same files: the same skill
    expect((await backup.restoreBackup(fs.readFileSync(file), { name: 'Exact 2' })).restored.skills.renamed).toEqual([]);
    // one more file here: not the same skill any more, so the backup's copy is added next to it
    fs.writeFileSync(path.join(skillsLibrary(), s.slug, 'extra.md'), 'Only here');
    const { restored } = await backup.restoreBackup(fs.readFileSync(file), { name: 'Exact 3' });
    expect(restored.skills.renamed).toEqual([{ from: s.slug, to: `${s.slug}-restored` }]);
    expect(agents.list()[0].skills).toEqual([`${s.slug}-restored`]);
  });

  it.skipIf(!linksWork)("won't restore into a link to another project's folder", async () => {
    const src = listProjects().find((p) => p.name === 'Backed Up')!;
    const alias = folder('alias-of-backed-up');
    fs.symlinkSync(src.brainPath, alias);
    const bytes = fs.readFileSync(backup.createBackup(src.id).file);
    await expect(backup.restoreBackup(bytes, { folder: alias })).rejects.toThrow(/belongs to the project "Backed Up"/);
    await expect(backup.restoreBackup(bytes, { folder: path.join(alias, '.') })).rejects.toThrow(/belongs to the project/);
  });

  it('leaves out and counts the files over a size limit', async () => {
    const p = await createProject({ name: 'Big notes', mode: 'new', folder: folder('big-notes') });
    fs.writeFileSync(path.join(p.brainPath, 'notes', 'small.md'), 'fits');
    fs.writeFileSync(path.join(p.brainPath, 'notes', 'huge.bin'), Buffer.alloc(21 * 1024 * 1024));
    const r = backup.createBackup(p.id);
    expect(r.summary.omitted).toBe(1);
    expect(backup.decodeBackup(fs.readFileSync(r.file)).brain.map((f) => f.path)).toContain('notes/small.md');
    expect(backup.listBackups().find((x) => x.name === r.name)?.summary?.omitted).toBe(1);
  });

  it('moves paths inside the old project folder to the new one, across Windows and Unix', () => {
    expect(backup.rebase('C:\\Users\\me\\proj\\drafts', 'C:\\Users\\me\\proj', '/home/me/new')).toBe(path.join('/home/me/new', 'drafts'));
    expect(backup.rebase('c:/users/ME/proj', 'C:\\Users\\me\\proj', '/x')).toBe('/x');
    expect(backup.rebase('/home/me/proj-other', '/home/me/proj', '/x')).toBeNull();
    expect(backup.rebase('/home/me/Proj/a', '/home/me/proj', '/x')).toBeNull();
  });
});
