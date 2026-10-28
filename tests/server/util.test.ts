import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataPath, DATA, parseFrontmatter, readJSON, renderTemplate, slugify, truncate, uid, writeJSON } from '../../server/util.ts';

describe('util', () => {
  it('uses the throwaway data folder from DASH_DATA', () => {
    expect(DATA).toBe(path.resolve(process.env.DASH_DATA!));
    expect(dataPath('a', 'b.json')).toBe(path.join(DATA, 'a', 'b.json'));
  });

  it('slugify makes safe ids', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
    expect(slugify('  Ünïcode — Test  ')).toMatch(/^[a-z0-9-]+$/);
    // never an empty id
    expect(slugify('')).toBe('item');
  });

  it('uid is unique and keeps its prefix', () => {
    const a = uid('r');
    const b = uid('r');
    expect(a).not.toBe(b);
    expect(a.startsWith('r')).toBe(true);
  });

  it('writeJSON / readJSON round-trip, with a fallback for missing or broken files', () => {
    const file = dataPath('t', 'x.json');
    writeJSON(file, { n: 1, list: ['a'] });
    expect(readJSON<{ n: number; list: string[] }>(file, null)).toEqual({ n: 1, list: ['a'] });
    expect(readJSON(dataPath('t', 'missing.json'), { fallback: true })).toEqual({ fallback: true });
    fs.writeFileSync(dataPath('t', 'broken.json'), '{ not json');
    expect(readJSON(dataPath('t', 'broken.json'), null)).toBeNull();
  });

  it('renderTemplate fills {{placeholders}}', () => {
    expect(renderTemplate('Hi {{name}}, {{missing}}!', { name: 'Ada' })).toContain('Hi Ada');
  });

  it('truncate keeps short text and shortens long text', () => {
    expect(truncate('short', 100)).toBe('short');
    const long = truncate('x'.repeat(500), 100);
    expect(long.length).toBeLessThan(200);
  });

  it('parseFrontmatter splits meta and body', () => {
    const r = parseFrontmatter('---\nname: Writer\ndescription: writes\n---\nBody text');
    expect(r.meta.name).toBe('Writer');
    expect(r.meta.description).toBe('writes');
    expect(r.body.trim()).toBe('Body text');
    expect(parseFrontmatter('no frontmatter').body).toBe('no frontmatter');
  });
});
