// A clone, a backup or a copied project folder is a project of its own: its folders, team pictures and
// chats' engine sessions are its own, and nothing that was already in its folder is overwritten.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agents, chats, setActiveProject, withProject, workflows } from '../../server/store.ts';
import { createProject } from '../../server/projects.ts';
import { newAgent } from '../../server/library.ts';
import { cloneProject, encodeBackup, packProject, restoreBackup } from '../../server/backup.ts';
import { markFile, setMarkFile } from '../../server/teammark.ts';
import * as sync from '../../server/projectsync.ts';
import { dataPath } from '../../server/util.ts';
import type { Project, Team } from '../../shared/types.ts';

const folder = (name: string) => path.join(os.homedir(), 'clones', name);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const agentIn = (p: Project, id: string) => withProject(p, () => agents.get(id)!);

describe('cloning a project', () => {
  it("keeps an agent's knowledge folder in the copy's notes", async () => {
    const p = await createProject({ name: 'Linked notes', mode: 'new', folder: folder('linked') });
    const ref = path.join(p.brainPath, 'notes', 'reference');
    fs.mkdirSync(ref, { recursive: true });
    fs.writeFileSync(path.join(ref, 'guide.md'), '# Guide');
    const a = newAgent({ name: 'Reader' });
    agents.save({ ...a, knowledge: { folders: [ref] } });
    const copy = (await cloneProject(p.id, 'Linked notes copy')).project;
    const moved = path.join(copy.brainPath, 'notes', 'reference');
    expect(agentIn(copy, a.id).knowledge?.folders).toEqual([moved]);
    expect(fs.existsSync(path.join(moved, 'guide.md'))).toBe(true);
  });

  it("starts the copy's chats in new engine sessions, from what was said", async () => {
    const p = await createProject({ name: 'Sessions', mode: 'new', folder: folder('sessions') });
    const a = newAgent({ name: 'Claw', engine: 'openclaw' });
    const c = chats.create(a.id);
    c.items.push({ type: 'user', text: 'hello', ts: 1 });
    c.sessionId = 'dummy-source-session';
    c.sessionEngine = 'openclaw';
    chats.save(c);
    const copy = (await cloneProject(p.id, 'Sessions copy')).project;
    const theirs = withProject(copy, () => chats.get(a.id, c.id)!);
    expect(theirs).toMatchObject({ sessionId: null, reseed: true, items: [{ type: 'user', text: 'hello' }] });
    expect(withProject(p, () => chats.get(a.id, c.id)!.sessionId)).toBe('dummy-source-session');
  });

  it("carries the teams' pictures", async () => {
    const p = await createProject({ name: 'Marks', mode: 'new', folder: folder('marks') });
    const a = newAgent({ name: 'Painter' });
    const t = workflows.save({ name: 'Studio', members: [a.id], lead: a.id, steps: [] } as Partial<Team>);
    setMarkFile(t.id, 'badge.png', png);
    const copy = (await cloneProject(p.id, 'Marks copy')).project;
    const team = withProject(copy, () => workflows.get(t.id)!);
    expect(team.markFile).toMatchObject({ kind: 'image', ext: 'png' });
    expect(withProject(copy, () => markFile(team))).not.toBeNull();
  });
});

describe('restoring a backup into a folder you have', () => {
  it('leaves your BRAIN.md as it is, even one that still has the starting text', async () => {
    const p = await createProject({ name: 'Brain source', mode: 'new', folder: folder('brain-src') });
    fs.writeFileSync(path.join(p.brainPath, 'BRAIN.md'), 'Backup BRAIN content');
    const bytes = encodeBackup(packProject(p));
    const mine = folder('brain-mine');
    fs.mkdirSync(mine, { recursive: true });
    const text = "# Mine\n\nThis folder is the project's Brain.\n\nUser edited sentinel.\n";
    fs.writeFileSync(path.join(mine, 'BRAIN.md'), text);
    await restoreBackup(bytes, { folder: mine, name: 'Brain restored' });
    expect(fs.readFileSync(path.join(mine, 'BRAIN.md'), 'utf8')).toBe(text);
    // a new folder gets the saved one instead of the starting text
    const fresh = (await restoreBackup(bytes, { name: 'Brain fresh' })).project;
    expect(fs.readFileSync(path.join(fresh.brainPath, 'BRAIN.md'), 'utf8')).toBe('Backup BRAIN content');
  });
});

describe('opening a copied project folder', () => {
  it("moves folders inside the original's folder to the copy, and the team pictures come along", async () => {
    const src = folder('folder-a');
    const p = await createProject({ name: 'Folder A', mode: 'new', folder: src });
    const ref = path.join(src, 'notes', 'reference');
    fs.mkdirSync(ref, { recursive: true });
    fs.writeFileSync(path.join(ref, 'note.md'), 'original project note');
    const outside = folder('outside-notes');
    fs.mkdirSync(outside, { recursive: true });
    const a = newAgent({ name: 'Worker' });
    agents.save({ ...a, workspace: ref, knowledge: { folders: [ref, outside] } });
    // an earlier version too
    agents.save({ ...agents.get(a.id)!, systemPrompt: 'changed' });
    const t = workflows.save({ name: 'Crew', members: [a.id], lead: a.id, steps: [] } as Partial<Team>);
    setMarkFile(t.id, 'badge.png', png);
    sync.saveProject(p.id);
    const dst = folder('folder-b');
    fs.cpSync(src, dst, { recursive: true });
    const b = await createProject({ name: 'Folder B', mode: 'existing', folder: dst });
    expect(sync.restoreInto(b.id, dst)).toMatchObject({ agents: 1 });
    const moved = path.join(dst, 'notes', 'reference');
    setActiveProject(b.id);
    expect(agents.get(a.id)).toMatchObject({ workspace: moved, knowledge: { folders: [moved, outside] } });
    expect(markFile(workflows.get(t.id)!)).not.toBeNull();
    // its kept versions too
    const vdir = dataPath('projects', b.id, 'versions', 'agents', a.id);
    const versions = fs.readdirSync(vdir).map((n) => JSON.parse(fs.readFileSync(path.join(vdir, n), 'utf8')) as { item: { workspace?: string } });
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) if (v.item.workspace) expect(v.item.workspace).toBe(moved);
  });
});
