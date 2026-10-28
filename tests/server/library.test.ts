// The Agency comes with the dashboard (library/agency-agents in the repo): no download, no data folder needed.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as library from '../../server/library.ts';
import { agents } from '../../server/store.ts';
import { ROOT, parseFrontmatter } from '../../server/util.ts';

const bundled = path.join(ROOT, 'library', 'agency-agents');

describe('the bundled Agency library', () => {
  it('lists every specialist straight from the repo, with an empty data folder', () => {
    const list = library.agencyAgents();
    expect(list.length).toBeGreaterThan(250);
    for (const a of list) {
      expect(a.name).toBeTruthy();
      expect(a.description).toBeTruthy();
      expect(fs.existsSync(a.file)).toBe(true);
      expect(a.file.startsWith(bundled)).toBe(true);
    }
  });

  it('has every division that divisions.json names, and no others', () => {
    const named = Object.keys(JSON.parse(fs.readFileSync(path.join(bundled, 'divisions.json'), 'utf8')).divisions as Record<string, unknown>).sort();
    const onDisk = fs
      .readdirSync(bundled, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(onDisk).toEqual(named);
    const used = new Set(library.agencyAgents().map((a) => a.division));
    expect([...used].sort()).toEqual(named);
  });

  it("lists the security division's agents (their files are named security-*.md)", () => {
    const security = library.agencyAgents().filter((a) => a.division === 'security');
    expect(security.length).toBe(fs.readdirSync(path.join(bundled, 'security')).filter((f) => f.endsWith('.md')).length);
    expect(security.map((a) => a.slug)).toContain('security-appsec-engineer');
  });

  it('gives each specialist its own slug, since hiring looks one up by slug', () => {
    const slugs = library.agencyAgents().map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('shows up in the library index without file paths', async () => {
    const idx = await library.libraryIndex();
    expect(idx.agency.agents.length).toBe(library.agencyAgents().length);
    expect(idx.agency.agents[0]).not.toHaveProperty('file');
    expect(idx.agency).not.toHaveProperty('installed');
  });

  it('hires a specialist with its written instructions, and leaves the bundled file alone', () => {
    const pick = library.agencyAgents().find((a) => a.division === 'engineering')!;
    const before = fs.readFileSync(pick.file, 'utf8');
    const hired = library.hireFromAgency(pick.slug);
    expect(hired.name).toBe(pick.name);
    expect(hired.source).toEqual({ type: 'agency', slug: pick.slug, division: 'engineering' });
    expect(hired.systemPrompt).toBe(parseFrontmatter(before).body.trim());
    expect(agents.get(hired.id)?.name).toBe(pick.name);
    expect(fs.readFileSync(pick.file, 'utf8')).toBe(before);
  });

  it('refuses a specialist that is not in the library', () => {
    expect(() => library.hireFromAgency('no-such-specialist')).toThrow('not in the library');
  });
});

describe('Claude Code subagents', () => {
  it('exports a description with backslashes and quotes as frontmatter that reads back the same', () => {
    const description = 'Inspect C:\\src and say "done" \\';
    const a = library.newAgent({ name: 'Path checker', description, systemPrompt: 'Check paths.' });
    const text = fs.readFileSync(library.exportToClaude(a), 'utf8');
    expect(text).toContain('description: "Inspect C:\\\\src and say \\"done\\" \\\\"\n');
    expect(parseFrontmatter(text).meta).toMatchObject({ name: 'path-checker', description });
  });
});
