// Folders from before the app was called Blacksite (My Dashboard) keep working.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupsRoot, listBackups } from '../../server/backup.ts';
import { overview, projectsRoot } from '../../server/projects.ts';

const home = os.homedir();

describe('folders from before the rename', () => {
  it('moves the old backups folder to Blacksite Backups, once, with its backups', () => {
    const old = path.join(home, 'My Dashboard Backups');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'Launch.dashbackup'), 'MY-DASHBOARD-BACKUP 1\n{"app":"my-dashboard","name":"Launch"}\n');

    expect(backupsRoot()).toBe(path.join(home, 'Blacksite Backups'));
    expect(fs.existsSync(old)).toBe(false);
    expect(listBackups().map((b) => b.name)).toEqual(['Launch.dashbackup']);

    // a later folder with the old name is left alone
    fs.mkdirSync(old);
    backupsRoot();
    expect(fs.existsSync(old)).toBe(true);
  });

  it('puts new projects in Documents/Blacksite and still finds project folders in the old one', () => {
    expect(projectsRoot()).toBe(path.join(home, 'Documents', 'Blacksite'));
    const oldProject = path.join(home, 'Documents', 'My Dashboard', 'Old work');
    fs.mkdirSync(oldProject, { recursive: true });
    fs.writeFileSync(path.join(oldProject, 'PROJECT.md'), '# Old work\n');

    expect(overview().found.map((f) => f.folder)).toContain(oldProject);
  });
});
