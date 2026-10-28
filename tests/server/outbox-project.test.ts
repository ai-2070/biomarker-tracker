// The Outbox belongs to a project: switching projects shows that project's posts, and the old shared Outbox is sorted into projects.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { outbox, artifacts, setActiveProject, activeProject, migrateGlobalOutbox, listProjects } from '../../server/store.ts';
import { createProject } from '../../server/projects.ts';
import { dataPath } from '../../server/util.ts';
import type { OutboxPost } from '../../shared/types.ts';

const post = (id: string, over: Partial<OutboxPost> = {}): OutboxPost => ({ id, platform: 'x', parts: ['hi'], status: 'pending', ...over });

describe('Outbox and Artifacts per project', () => {
  it('each project keeps its own posts and artifacts', async () => {
    const a = await createProject({ name: 'Alpha' });
    const b = await createProject({ name: 'Beta' });
    setActiveProject(a.id);
    outbox.save(post('pa'));
    artifacts.save({ id: 'aa', title: 'Alpha result', kind: 'text', text: 'x' });
    setActiveProject(b.id);
    expect(outbox.list()).toEqual([]);
    expect(artifacts.list()).toEqual([]);
    outbox.save(post('pb'));
    setActiveProject(a.id);
    expect(outbox.list().map((p) => p.id)).toEqual(['pa']);
    expect(artifacts.list().map((x) => x.id)).toEqual(['aa']);
    setActiveProject(b.id);
    expect(outbox.list().map((p) => p.id)).toEqual(['pb']);
  });

  it('moves the old shared Outbox into the project of each post\'s author', async () => {
    const a = await createProject({ name: 'Gamma' });
    const b = await createProject({ name: 'Delta' });
    // an agent that lives in Gamma
    fs.mkdirSync(dataPath('projects', a.id, 'agents'), { recursive: true });
    fs.writeFileSync(dataPath('projects', a.id, 'agents', 'writer-1.json'), JSON.stringify({ id: 'writer-1', name: 'Writer' }));
    const old = dataPath('outbox');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'p1.json'), JSON.stringify(post('p1', { agentId: 'writer-1' })));
    fs.writeFileSync(path.join(old, 'p2.json'), JSON.stringify(post('p2', { agentId: 'gone-agent' })));
    setActiveProject(b.id);
    expect(migrateGlobalOutbox()).toBe(2);
    expect(fs.existsSync(old)).toBe(false);
    // p1 went to its author's project, p2 (author unknown) to the open one
    expect(fs.existsSync(dataPath('projects', a.id, 'outbox', 'p1.json'))).toBe(true);
    expect(fs.existsSync(dataPath('projects', b.id, 'outbox', 'p2.json'))).toBe(true);
    expect(activeProject().id).toBe(b.id);
    expect(listProjects().length).toBeGreaterThan(1);
    expect(migrateGlobalOutbox()).toBe(0);
  });
});
