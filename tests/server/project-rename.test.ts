// Renaming a project: the name is trimmed, cannot be blank, is kept to 80 characters, and only the name changes.
import { describe, expect, it } from 'vitest';
import { createProject, updateProject } from '../../server/projects.ts';
import { listProjects } from '../../server/store.ts';

describe('renaming a project', () => {
  it('saves the new name and leaves the rest alone', async () => {
    const p = await createProject({ name: 'Old name', description: 'A description.' });
    const after = updateProject(p.id, { name: 'New name' });
    expect(after).toMatchObject({ id: p.id, name: 'New name', description: 'A description.', brainPath: p.brainPath });
    expect(listProjects().find((x) => x.id === p.id)?.name).toBe('New name');
  });

  it('trims the name and keeps it to 80 characters', async () => {
    const p = await createProject({ name: 'Trim me' });
    expect(updateProject(p.id, { name: '   Spaced out   ' }).name).toBe('Spaced out');
    expect(updateProject(p.id, { name: 'x'.repeat(200) }).name).toHaveLength(80);
  });

  it('refuses a blank name and keeps the old one', async () => {
    const p = await createProject({ name: 'Keep me' });
    expect(() => updateProject(p.id, { name: '' })).toThrow(/name/);
    expect(() => updateProject(p.id, { name: '    ' })).toThrow(/name/);
    expect(listProjects().find((x) => x.id === p.id)?.name).toBe('Keep me');
  });

  it('is not touched when a patch has no name (a description edit)', async () => {
    const p = await createProject({ name: 'Same name' });
    expect(updateProject(p.id, { description: 'New text' }).name).toBe('Same name');
  });

  it('says so for a project that is not there', () => {
    expect(() => updateProject('nope', { name: 'x' })).toThrow(/No such project/);
  });
});
