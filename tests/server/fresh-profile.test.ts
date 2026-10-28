// A fresh data folder (a new install, or the desktop app beside the browser version) makes its default
// project in a "My workspace" folder that may already hold a saved copy. That copy is loaded, not saved over.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// written before the dashboard makes its default project (nothing has imported the store yet)
const brain = path.join(os.homedir(), 'Documents', 'Blacksite', 'My workspace');
fs.mkdirSync(path.join(brain, '.dashboard'), { recursive: true });
fs.writeFileSync(
  path.join(brain, '.dashboard', 'project.json'),
  JSON.stringify({
    format: 1,
    app: 'my-dashboard',
    savedAt: Date.now(),
    project: { name: 'My workspace', description: 'Saved by the other profile', repo: '', skills: [] },
    agents: [{ id: 'kept1', name: 'Kept', engine: 'claude', model: '', instructions: 'Stay.' }],
    teams: [],
    routines: [],
  }),
);

const store = await import('../../server/store.ts');
const sync = await import('../../server/projectsync.ts');

describe("a fresh profile's default project", () => {
  it('loads the copy already saved in its folder before the first auto-save', () => {
    expect(store.listProjects().map((p) => p.id)).toEqual(['default']);
    const fresh = store.takeNewDefaultProject();
    expect(fresh?.brainPath).toBe(brain);
    // said once: a later start (or a second call) doesn't load it again
    expect(store.takeNewDefaultProject()).toBeNull();
    expect(sync.adoptSavedFolder('default')).toMatchObject({ agents: 1 });
    store.setActiveProject('default');
    expect(store.agents.list().map((a) => a.name)).toEqual(['Kept']);
    expect(store.activeProject().description).toBe('Saved by the other profile');
    // and the save that follows keeps what was there
    sync.saveProject('default');
    const saved = JSON.parse(fs.readFileSync(path.join(brain, '.dashboard', 'project.json'), 'utf8')) as { agents: { name: string }[] };
    expect(saved.agents.map((a) => a.name)).toEqual(['Kept']);
    // a project that already has agents is never loaded over
    expect(sync.adoptSavedFolder('default')).toBeNull();
  });
});
