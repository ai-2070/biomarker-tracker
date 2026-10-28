import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as skills from '../../server/skills.ts';
import { agents, outbox } from '../../server/store.ts';
import { newAgent } from '../../server/library.ts';
import { postId } from '../../server/reddit.ts';
import { dataPath } from '../../server/util.ts';

const linksWork = process.platform !== 'win32'; // file links need admin rights on Windows

describe('collections', () => {
  it("won't touch files outside their folder through an id", () => {
    const keep = dataPath('keep.json');
    fs.writeFileSync(keep, '{"keep":true}');
    outbox.remove('../keep');
    outbox.remove('..\\keep');
    expect(fs.existsSync(keep)).toBe(true);
    expect(outbox.get('../keep')).toBeNull();
    expect(() => outbox.save({ id: '../keep', parts: [] })).toThrow(/id/);
    expect(fs.readFileSync(keep, 'utf8')).toBe('{"keep":true}');
  });
});

describe('skills', () => {
  it.runIf(linksWork)("won't read a file outside the library through a link in a skill", () => {
    const s = skills.saveSkill({ name: 'Linked', description: 'Use for links.', body: 'x' })!;
    const outside = path.join(os.homedir(), 'private.txt');
    fs.writeFileSync(outside, 'private');
    fs.symlinkSync(outside, dataPath('skills', s.slug, 'leak.md'));
    expect(() => skills.readSkillFile(s.slug, 'leak.md')).toThrow(/not part of the skill/);
  });

  it.runIf(linksWork)('still lists skills when one has a broken link', () => {
    const s = skills.saveSkill({ name: 'Broken link', description: 'Use for broken links.', body: 'x' })!;
    fs.writeFileSync(dataPath('skills', s.slug, 'ok.md'), 'ok');
    fs.symlinkSync(path.join(os.homedir(), 'missing.md'), dataPath('skills', s.slug, 'gone.md'));
    expect(skills.listSkills().map((x) => x.slug)).toContain(s.slug);
    expect(skills.getSkill(s.slug)?.files.map((f) => f.path)).toEqual(['ok.md']);
  });

  it('lists each skill with its id, so two with the same name can be told apart', () => {
    const a = skills.saveSkill({ name: 'Twin', description: 'First twin.', body: 'first' })!;
    const b = skills.saveSkill({ name: 'Twin', description: 'Second twin.', body: 'second' })!;
    const prompt = skills.skillsPrompt({ skills: [a.slug, b.slug] });
    expect(prompt).toContain(`[id: ${a.slug}]`);
    expect(prompt).toContain(`[id: ${b.slug}]`);
    expect(skills.findSkill(b.slug)?.body).toContain('second');
  });
});

describe('agents', () => {
  it("copies don't inherit the original's always-allow grants", () => {
    const a = newAgent({ name: 'Original' });
    a.alwaysAllow = ['run_command'];
    agents.save(a);
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = a;
    expect(newAgent({ ...rest, name: 'Original (copy)' }).alwaysAllow).toEqual([]);
  });
});

describe('reddit post ids', () => {
  it('reads permalinks, redd.it links, fullnames and bare ids', () => {
    expect(postId('https://www.reddit.com/r/LocalLLaMA/comments/1abc2d/some_title/')).toBe('1abc2d');
    expect(postId('https://redd.it/1abc2d')).toBe('1abc2d');
    expect(postId('redd.it/1abc2d')).toBe('1abc2d');
    expect(postId('t3_1abc2d')).toBe('1abc2d');
    expect(postId(' 1abc2d ')).toBe('1abc2d');
  });

  it('refuses anything else', () => {
    expect(() => postId('')).toThrow(/Which post/);
    expect(() => postId('../api/me')).toThrow(/Which post/);
  });
});
