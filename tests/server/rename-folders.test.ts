// Biomarker Tracker is built on Blacksite. It keeps its own folders and never reaches into
// Blacksite's, or those of the app Blacksite used to be (My Dashboard).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupsRoot, listBackups } from '../../server/backup.ts';
import { overview, projectsRoot } from '../../server/projects.ts';

const home = os.homedir();

describe('own folders, apart from other apps', () => {
  it('writes backups to its own folder and leaves other apps\' backup folders alone', () => {
    for (const other of ['My Dashboard Backups', 'Blacksite Backups']) {
      const dir = path.join(home, other);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'Launch.dashbackup'), 'MY-DASHBOARD-BACKUP 1\n{"app":"my-dashboard","name":"Launch"}\n');
    }

    expect(backupsRoot()).toBe(path.join(home, 'Biomarker Tracker Backups'));
    expect(fs.existsSync(path.join(home, 'My Dashboard Backups', 'Launch.dashbackup'))).toBe(true);
    expect(fs.existsSync(path.join(home, 'Blacksite Backups', 'Launch.dashbackup'))).toBe(true);
    expect(listBackups()).toEqual([]);
  });

  it('puts projects in Documents/Biomarker Tracker and does not pick up other apps\' project folders', () => {
    expect(projectsRoot()).toBe(path.join(home, 'Documents', 'Biomarker Tracker'));
    for (const other of ['My Dashboard', 'Blacksite']) {
      const p = path.join(home, 'Documents', other, 'Old work');
      fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(p, 'PROJECT.md'), '# Old work\n');
    }

    const found = overview().found.map((f) => f.folder);
    expect(found.some((f) => f.includes(`${path.sep}My Dashboard${path.sep}`) || f.includes(`${path.sep}Blacksite${path.sep}`))).toBe(false);
  });
});
