// Deleting a project backs it up first and checks the backup before anything is removed; cloning makes a copy as a new project.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agents, workflows, listProjects, setActiveProject, activeProject } from '../../server/store.ts';
import { createProject } from '../../server/projects.ts';
import { newAgent } from '../../server/library.ts';
import { backupAndDeleteProject, cloneProject, verifyBackup, backupsRoot } from '../../server/backup.ts';
import { dataPath } from '../../server/util.ts';
import type { Team } from '../../shared/types.ts';

const folder = (name: string) => path.join(os.homedir(), 'projects', name);

describe('verifyBackup()', () => {
  const write = (name: string, body: Buffer | string) => {
    const file = path.join(os.tmpdir(), `verify-${Date.now()}-${name}`);
    fs.writeFileSync(file, body);
    return file;
  };

  it('refuses a backup that is missing, empty, the wrong size, unreadable or of another project', () => {
    expect(() => verifyBackup({ file: path.join(os.tmpdir(), 'nope.dashbackup'), name: 'nope', size: 500, summary: {} as never }, { name: 'X' })).toThrow(/not written/);
    const empty = write('empty.dashbackup', '');
    expect(() => verifyBackup({ file: empty, name: 'e', size: 0, summary: {} as never }, { name: 'X' })).toThrow(/empty or incomplete/);
    const junk = write('junk.dashbackup', 'x'.repeat(400));
    expect(() => verifyBackup({ file: junk, name: 'j', size: 400, summary: {} as never }, { name: 'X' })).toThrow(/could not be read back/);
    expect(() => verifyBackup({ file: junk, name: 'j', size: 123, summary: {} as never }, { name: 'X' })).toThrow(/empty or incomplete/);
  });
});

describe('deleting a project', () => {
  it('backs it up, checks the backup, then removes it, setting its data aside and leaving its folder alone', async () => {
    const keep = await createProject({ name: 'Delete: keeper', mode: 'new', folder: folder('del-keep') });
    const gone = await createProject({ name: 'Delete: doomed', mode: 'new', folder: folder('del-gone') });
    setActiveProject(gone.id);
    newAgent({ name: 'Doomed agent' });
    fs.writeFileSync(path.join(gone.brainPath, 'PROJECT.md'), '# Doomed\n\nA project that is going.');
    const r = backupAndDeleteProject(gone.id);
    // the backup is in the backups folder, is not empty, and holds the project
    expect(path.dirname(r.backup.file)).toBe(backupsRoot());
    expect(fs.statSync(r.backup.file).size).toBe(r.backup.size);
    expect(r.backup.summary.agents).toBe(1);
    // the project is gone from the list, and the open project moved off it
    expect(listProjects().some((p) => p.id === gone.id)).toBe(false);
    expect(activeProject().id).not.toBe(gone.id);
    // its dashboard data was set aside, not erased
    expect(fs.existsSync(dataPath('projects', gone.id))).toBe(false);
    expect(r.setAside).toMatch(/_removed-\d{4}-\d{2}-\d{2}/);
    expect(fs.existsSync(path.join(r.setAside, 'agents'))).toBe(true);
    // and its folder with the user's files is untouched
    expect(fs.readFileSync(path.join(gone.brainPath, 'PROJECT.md'), 'utf8')).toContain('A project that is going.');
    expect(listProjects().some((p) => p.id === keep.id)).toBe(true);
  });

  it('refuses to delete the last project, or one that is not there, and makes no backup then', async () => {
    const before = fs.existsSync(backupsRoot()) ? fs.readdirSync(backupsRoot()).length : 0;
    expect(() => backupAndDeleteProject('not-a-project')).toThrow(/No such project/);
    for (const p of listProjects().slice(1)) backupAndDeleteProject(p.id);
    const only = listProjects();
    expect(only).toHaveLength(1);
    const count = fs.readdirSync(backupsRoot()).length;
    expect(() => backupAndDeleteProject(only[0].id)).toThrow(/Keep at least one project/);
    expect(fs.readdirSync(backupsRoot()).length).toBe(count);
    expect(count).toBeGreaterThanOrEqual(before);
  });
});

describe('cloning a project', () => {
  it('makes a new project with copies of its agents and teams, and leaves the original as it was', async () => {
    const src = await createProject({ name: 'Clone: source', mode: 'new', folder: folder('clone-src'), description: 'The original.' });
    setActiveProject(src.id);
    const a = newAgent({ name: 'Writer' });
    const b = newAgent({ name: 'Editor' });
    workflows.save({ name: 'Crew', members: [a.id, b.id], lead: a.id, steps: [], schedule: { type: 'daily', time: '09:00' }, enabled: true } as Partial<Team>);
    const { project, restored } = await cloneProject(src.id);
    expect(project.name).toBe('Clone: source (copy)');
    expect(project.id).not.toBe(src.id);
    expect(project.brainPath).not.toBe(src.brainPath);
    expect(restored.agents).toBe(2);
    expect(restored.teams).toBe(1);
    // the copy has its own agents and team, with the schedule paused
    setActiveProject(project.id);
    expect(agents.list().map((x) => x.name).sort()).toEqual(['Editor', 'Writer']);
    expect(workflows.list()[0]).toMatchObject({ name: 'Crew', enabled: false });
    // the original still has its own
    setActiveProject(src.id);
    expect(agents.list()).toHaveLength(2);
    expect(workflows.list()[0].enabled).toBe(true);
  });

  it('takes the name it is given, and says so for a project that is not there', async () => {
    const src = await createProject({ name: 'Clone: named', mode: 'new', folder: folder('clone-named') });
    const { project } = await cloneProject(src.id, '  Fresh start  ');
    expect(project.name).toBe('Fresh start');
    await expect(cloneProject('nope')).rejects.toThrow(/No such project/);
  });
});
