// The order projects are listed in (the project menu, and the Up / Down keys on the Station) is saved and can be changed.
import { describe, expect, it } from 'vitest';
import { listProjects, reorderProjects } from '../../server/store.ts';
import { createProject } from '../../server/projects.ts';

describe('reorderProjects()', () => {
  it('saves a new order, and it is what the list gives back', async () => {
    const a = await createProject({ name: 'Floor A' });
    const b = await createProject({ name: 'Floor B' });
    const c = await createProject({ name: 'Floor C' });
    const before = listProjects().map((p) => p.id);
    expect(before.slice(-3)).toEqual([a.id, b.id, c.id]);
    const next = reorderProjects([c.id, a.id, b.id]);
    expect(next.slice(0, 3).map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    expect(listProjects().slice(0, 3).map((p) => p.id)).toEqual([c.id, a.id, b.id]);
  });

  it('keeps projects it was not told about (after the others) and ignores ids that are not projects', async () => {
    const all = listProjects().map((p) => p.id);
    const last = all[all.length - 1];
    const out = reorderProjects([last, 'not-a-project', last, 42, null]);
    expect(out.map((p) => p.id)).toEqual([last, ...all.filter((id) => id !== last)]);
    // nothing lost, nothing doubled
    expect(new Set(out.map((p) => p.id)).size).toBe(all.length);
  });

  it('does nothing for something that is not a list', () => {
    const before = listProjects().map((p) => p.id);
    expect(reorderProjects('x').map((p) => p.id)).toEqual(before);
    expect(reorderProjects(undefined).map((p) => p.id)).toEqual(before);
  });
});
