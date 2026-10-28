import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as skills from '../../server/skills.ts';
import { dataPath } from '../../server/util.ts';
import { activeProject, saveProjects, listProjects } from '../../server/store.ts';

const make = (name: string, description = `Use for ${name}.`, body = `Steps for ${name}.`) => skills.saveSkill({ name, description, body });

describe('skills library', () => {
  it('needs a name and a "when to use it" line', () => {
    expect(() => skills.saveSkill({ name: '', description: 'x', body: '' })).toThrow(/name/);
    expect(() => skills.saveSkill({ name: 'X', description: '', body: '' })).toThrow(/when/i);
  });

  it('saves a SKILL.md in Claude Code format and lists it', () => {
    const s = make('Brand voice', 'Use when writing anything for the brand.', 'Be calm.');
    expect(s?.slug).toBe('brand-voice');
    const file = fs.readFileSync(dataPath('skills', 'brand-voice', 'SKILL.md'), 'utf8');
    expect(file).toMatch(/^---\nname: Brand voice\ndescription: Use when writing anything for the brand\.\n---/);
    expect(skills.listSkills().map((x) => x.slug)).toContain('brand-voice');
  });

  it('gives two skills with the same name different slugs', () => {
    const a = make('Same name');
    const b = make('Same name');
    expect(a?.slug).not.toBe(b?.slug);
  });

  it('reads multi-line descriptions (YAML >- blocks)', () => {
    const dir = dataPath('skills', 'folded');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: folded\ndescription: >-\n  first line\n  second line\n---\nbody');
    expect(skills.getSkill('folded')?.description).toBe('first line second line');
  });

  it('reads back exactly the name and description it saved, however often it is saved', () => {
    const name = 'Say "Hello" #1: it\'s';
    const description = 'Use for C:\\src\\new and a trailing \\';
    let s = skills.saveSkill({ name, description, body: 'Hi.' })!;
    for (let i = 0; i < 3; i++) {
      expect(s).toMatchObject({ name, description });
      s = skills.saveSkill({ slug: s.slug, name: s.name, description: s.description, body: s.body })!;
    }
    for (const odd of ['>', '| pipe', '- dash', '[x]', '{x}', '@x', 'true\\']) expect(skills.saveSkill({ name: odd, description: 'Use it.', body: '' })?.name).toBe(odd);
  });

  it('decodes quoted names and descriptions written by hand or the old way', () => {
    const dir = dataPath('skills', 'quoted');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: "Say \\"Hi\\" \\x41\\u00e9"\ndescription: \'It\'\'s for C:\\src\'\n---\nbody');
    expect(skills.getSkill('quoted')).toMatchObject({ name: 'Say "Hi" Aé', description: "It's for C:\\src" });
    // an escape YAML doesn't know is kept as it was, and a plain value keeps its quotes
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: "C:\\src\\q"\ndescription: Say "hi"\n---\nbody');
    expect(skills.getSkill('quoted')).toMatchObject({ name: 'C:\\src\\q', description: 'Say "hi"' });
  });

  it('finds a skill by its display name, with the full instructions', () => {
    make('Email to clients', 'Use for client emails.', 'Always sign with the team name.');
    const s = skills.findSkill('email to clients');
    expect(s?.body).toContain('Always sign');
  });

  it("won't read files outside a skill's folder", () => {
    const s = make('Has files');
    fs.writeFileSync(dataPath('skills', s!.slug, 'ref.md'), 'reference');
    expect(skills.readSkillFile(s!.slug, 'ref.md')).toBe('reference');
    expect(() => skills.readSkillFile(s!.slug, '../brand-voice/SKILL.md')).toThrow();
  });

  it('deletes a skill', () => {
    const s = make('Temporary');
    skills.deleteSkill(s!.slug);
    expect(skills.getSkill(s!.slug)).toBeNull();
  });
});

describe('who gets which skill', () => {
  it('combines the agent, its team and the project, without duplicates', () => {
    const a = make('Agent skill');
    const t = make('Team skill');
    const p = make('Project skill');
    const projects = listProjects();
    projects[0].skills = [p!.slug, a!.slug];
    saveProjects(projects);
    expect(activeProject().skills).toContain(p!.slug);
    const list = skills.skillsFor({ skills: [a!.slug] } as never, [t!.slug]);
    expect(list.map((s) => [s.slug, s.via])).toEqual([
      [a!.slug, 'agent'],
      [t!.slug, 'team'],
      [p!.slug, 'project'],
    ]);
  });

  it('lists skills in the instructions only when there are some', () => {
    const projects = listProjects();
    projects[0].skills = [];
    saveProjects(projects);
    expect(skills.skillsPrompt({ skills: [] } as never)).toBe('');
    const s = make('Checklist', 'Use before finishing a task.');
    const prompt = skills.skillsPrompt({ skills: [s!.slug] } as never);
    expect(prompt).toContain('# Your skills');
    expect(prompt).toContain('- Checklist: Use before finishing a task.');
    expect(prompt).toContain('read_skill');
  });
});

describe('importing a Claude Code skill', () => {
  const claudeSkill = (name: string) => {
    const dir = path.join(os.homedir(), '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  it('copies its files but leaves out a linked folder', () => {
    const src = claudeSkill('with-link');
    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: With link\ndescription: Use it.\n---\n\nSteps.');
    fs.writeFileSync(path.join(src, 'notes.md'), 'extra');
    const outside = fs.mkdtempSync(path.join(os.homedir(), 'outside-skill-'));
    fs.writeFileSync(path.join(outside, 'private.md'), 'outside-sentinel');
    // (junctions need no admin rights on Windows; elsewhere this makes a plain folder link)
    fs.symlinkSync(outside, path.join(src, 'linked'), 'junction');
    const s = skills.importClaudeSkill('with-link');
    expect(s?.body).toContain('Steps.');
    expect(s?.files.map((f) => f.path)).toEqual(['notes.md']);
    expect(fs.existsSync(path.join(dataPath('skills', s!.slug), 'linked'))).toBe(false);
  });

  it('refuses a SKILL.md that is a link', (ctx) => {
    const src = claudeSkill('linked-md');
    const outside = path.join(fs.mkdtempSync(path.join(os.homedir(), 'outside-md-')), 'secret.md');
    fs.writeFileSync(outside, '---\nname: Secret\ndescription: x\n---\n\noutside-sentinel');
    try {
      fs.symlinkSync(outside, path.join(src, 'SKILL.md'));
    } catch (e) {
      // file links need admin rights on Windows
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip();
      throw e;
    }
    expect(() => skills.importClaudeSkill('linked-md')).toThrow(/link/);
    expect(skills.listSkills().some((x) => x.preview?.includes('outside-sentinel'))).toBe(false);
  });
});
