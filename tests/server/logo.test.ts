// A project's logo (kept in <folder>/.dashboard) and the short description the Brain panel shows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addNote, createProject, logoFile, modelFile, projectSummary, removeLogo, removeModel, setLogo, updateProject, withLogo } from '../../server/projects.ts';

// a real 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const folder = (name: string) => path.join(os.homedir(), 'projects', name);

describe('project logo', () => {
  it('saves a PNG into the project folder and reports when it changed', async () => {
    const p = await createProject({ name: 'Logo one', mode: 'new', folder: folder('logo-one') });
    expect(withLogo(p).logoAt).toBeNull();
    const after = setLogo(p.id, PNG);
    expect(logoFile(p)).toBe(path.join(p.brainPath, '.dashboard', 'logo.png'));
    expect(after.logoAt).toBeTypeOf('number');
  });

  it('replaces the old logo, even when the new one has another type', async () => {
    const p = await createProject({ name: 'Logo two', mode: 'new', folder: folder('logo-two') });
    setLogo(p.id, PNG);
    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    setLogo(p.id, gif);
    expect(fs.readdirSync(path.join(p.brainPath, '.dashboard')).filter((n) => n.startsWith('logo.'))).toEqual(['logo.gif']);
  });

  it('checks what the bytes really are, not what the browser says', async () => {
    const p = await createProject({ name: 'Logo three', mode: 'new', folder: folder('logo-three') });
    const fakePng = `data:image/png;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
    expect(() => setLogo(p.id, fakePng)).toThrow(/PNG, JPG/);
    expect(() => setLogo(p.id, 'data:image/svg+xml;base64,PHN2Zy8+')).toThrow();
    expect(() => setLogo(p.id, 'not a data url')).toThrow();
    expect(logoFile(p)).toBeNull();
  });

  it('refuses images over 3 MB', async () => {
    const p = await createProject({ name: 'Logo four', mode: 'new', folder: folder('logo-four') });
    const big = Buffer.concat([Buffer.from(PNG.split(',')[1], 'base64'), Buffer.alloc(3 * 1024 * 1024)]);
    expect(() => setLogo(p.id, `data:image/png;base64,${big.toString('base64')}`)).toThrow(/too big/);
  });

  it('removes the logo', async () => {
    const p = await createProject({ name: 'Logo five', mode: 'new', folder: folder('logo-five') });
    setLogo(p.id, PNG);
    expect(removeLogo(p.id).logoAt).toBeNull();
    expect(logoFile(p)).toBeNull();
  });
});

describe('project summary', () => {
  it("uses the project's description first", async () => {
    const p = await createProject({ name: 'Sum one', mode: 'new', folder: folder('sum-one'), description: 'A launch campaign for NET.' });
    expect(projectSummary(p)).toEqual({ text: 'A launch campaign for NET.', from: 'description' });
  });

  it('else the first real paragraph of PROJECT.md (skipping headings)', async () => {
    const p = await createProject({ name: 'Sum two', mode: 'new', folder: folder('sum-two') });
    fs.writeFileSync(path.join(p.brainPath, 'PROJECT.md'), '# Sum two\n\n## What it is\n\nA game about\nbuilding cities.\n\n## Goals\n\nShip it.');
    expect(projectSummary(p)).toEqual({ text: 'A game about building cities.', from: 'PROJECT.md' });
  });

  it('says nothing when there is nothing to say', async () => {
    const p = await createProject({ name: 'Sum three', mode: 'new', folder: folder('sum-three') });
    expect(projectSummary(updateProject(p.id, { description: '' })).text).toBe('');
  });
});

// Links planted in a project folder (junctions need no admin rights on Windows; elsewhere 'junction' makes a plain folder link)
describe('links in the project folder', () => {
  it("doesn't serve or remove a logo or model through a .dashboard link", async () => {
    const p = await createProject({ name: 'Logo link', mode: 'new', folder: folder('logo-link') });
    const outside = fs.mkdtempSync(path.join(os.homedir(), 'outside-media-'));
    fs.writeFileSync(path.join(outside, 'logo.png'), 'private-sentinel');
    fs.writeFileSync(path.join(outside, 'brain-model.glb'), 'private-sentinel');
    fs.rmSync(path.join(p.brainPath, '.dashboard'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(p.brainPath, '.dashboard'), 'junction');
    expect(logoFile(p)).toBeNull();
    expect(modelFile(p)).toBeNull();
    removeLogo(p.id);
    removeModel(p.id);
    expect(fs.readdirSync(outside).sort()).toEqual(['brain-model.glb', 'logo.png']);
  });

  it("doesn't write a note through a notes link", async () => {
    const p = await createProject({ name: 'Note link', mode: 'new', folder: folder('note-link') });
    const outside = fs.mkdtempSync(path.join(os.homedir(), 'outside-notes-'));
    fs.writeFileSync(path.join(outside, 'precious.md'), 'keep me');
    fs.rmSync(path.join(p.brainPath, 'notes'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(p.brainPath, 'notes'), 'junction');
    expect(() => addNote('precious', 'overwritten by note', p)).toThrow(/link/);
    expect(fs.readFileSync(path.join(outside, 'precious.md'), 'utf8')).toBe('keep me');
    // a plain notes folder still works
    fs.rmSync(path.join(p.brainPath, 'notes'));
    expect(fs.readFileSync(addNote('fine', 'hello', p), 'utf8')).toBe('hello');
  });
});
