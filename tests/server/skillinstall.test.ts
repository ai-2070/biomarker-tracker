// Installing skills from GitHub (a fake GitHub here: no network), by hand and by the Brain.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseGitHubUrl, installFromGitHub, reposIn } from '../../server/skillinstall.ts';
import * as skills from '../../server/skills.ts';
import { historyOf, restoreVersion } from '../../server/history.ts';
import { withActor } from '../../server/versions.ts';
import { ask, clearHistory } from '../../server/overseer.ts';
import { agents, saveSettings, activeProject, listProjects, saveProjects, setActiveProject, withProject } from '../../server/store.ts';
import { newAgent } from '../../server/library.ts';

// the "model" gives the answers queued here
const answers: string[] = [];
vi.mock('../../server/brain.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/brain.ts')>()),
  brainModel: () => ({ provider: 'openrouter', model: 'mock', fallback: false }),
  think: async () => answers.shift() ?? 'Ok.',
}));

// owner/repo -> ref -> path -> content
const repos: Record<string, Record<string, Record<string, string>>> = {
  'big/repo': {
    main: {
      'skills/one/SKILL.md': '---\nname: Big one\ndescription: Use one.\n---\n\nOne.',
      'skills/two/SKILL.md': '---\nname: Big two\ndescription: Use two.\n---\n\nTwo.',
      'skills/two/huge.bin': 'x',
    },
  },
  'deep/repo': { 'a/b/c/d/e/f': { 'SKILL.md': '---\nname: Deep branch\ndescription: Use deep.\n---\n\nDeep.' } },
  'acme/skills': {
    main: {
      'README.md': 'repo readme',
      'skills/writer/SKILL.md': '---\nname: Writer\ndescription: Use when writing.\nallowed-tools: Read\n---\n\nWrite well.',
      'skills/writer/examples/one.md': 'example one',
      'skills/writer/../../escape.md': 'nope',
      'skills/writer/.hidden': 'hidden',
      'skills/editor/SKILL.md': '---\nname: Editor\ndescription: Use when editing.\n---\n\nEdit well.',
      'skills/editor/nested/SKILL.md': '---\nname: Nested\ndescription: Use nested.\n---\n\nNested.',
      'other/notes.md': 'no skill here',
    },
    'feature/x': { 'SKILL.md': '---\nname: Branch skill\ndescription: Use on the branch.\n---\n\nFrom a branch.' },
  },
};
let calls: string[] = [];
// repos whose whole tree GitHub cuts short, and file sizes GitHub reports bigger than they are
const truncated = new Set(['big/repo']);
const sizes: Record<string, number> = { 'skills/two/huge.bin': 3 * 1024 * 1024 };
// a download that waits until the test lets it go
let holdDownloads: Promise<void> | null = null;
const fakeFetch = async (input: string | URL) => {
  const url = String(input);
  calls.push(url);
  const ok = (body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  const notFound = () => new Response('{"message":"Not Found"}', { status: 404 });
  let m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)$/.exec(url);
  if (m) return repos[`${m[1]}/${m[2]}`] ? ok({ default_branch: 'main' }) : notFound();
  m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^?]+)\?recursive=1$/.exec(url);
  if (m) {
    const repo = `${m[1]}/${m[2]}`;
    const [ref, sub] = decodeURIComponent(m[3]).split(':');
    const files = repos[repo]?.[ref];
    if (!files) return notFound();
    // "ref:folder" is just that folder, with paths inside it, never cut short here
    const entries = Object.entries(files)
      .filter(([p]) => !sub || p.startsWith(`${sub}/`))
      .map(([p, c]) => ({ path: sub ? p.slice(sub.length + 1) : p, type: 'blob', size: sizes[p] ?? c.length }));
    return ok({ tree: entries, truncated: !sub && truncated.has(repo) });
  }
  m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
  if (m) {
    if (holdDownloads) await holdDownloads;
    const rest = m[3].split('/').map(decodeURIComponent);
    for (const [ref, files] of Object.entries(repos[`${m[1]}/${m[2]}`] || {})) {
      const n = ref.split('/').length;
      if (rest.slice(0, n).join('/') === ref && rest.slice(n).join('/') in files) return ok(files[rest.slice(n).join('/')]);
    }
    return notFound();
  }
  return notFound();
};
beforeAll(() => {
  vi.stubGlobal('fetch', fakeFetch);
  process.env.GITHUB_TOKEN = 'test-token';
});
afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
});

describe('GitHub links', () => {
  it('reads repo, folder, file and raw links, and refuses others', () => {
    expect(parseGitHubUrl('https://github.com/acme/skills')).toMatchObject({ owner: 'acme', repo: 'skills', kind: 'repo' });
    expect(parseGitHubUrl('github.com/acme/skills.git')).toMatchObject({ repo: 'skills', kind: 'repo' });
    expect(parseGitHubUrl('https://github.com/acme/skills/tree/main/skills/writer')).toMatchObject({ kind: 'tree', rest: ['main', 'skills', 'writer'] });
    expect(parseGitHubUrl('https://raw.githubusercontent.com/acme/skills/main/skills/writer/SKILL.md')).toMatchObject({ kind: 'raw' });
    expect(() => parseGitHubUrl('https://gitlab.com/acme/skills')).toThrow(/github\.com/);
    expect(() => parseGitHubUrl('http://github.com/acme/skills')).toThrow(/https/);
    expect(() => parseGitHubUrl('https://github.com/acme/skills/issues/3')).toThrow();
    expect(reposIn('see https://github.com/Acme/Skills/tree/main and raw.githubusercontent.com/x/y/main/a')).toEqual(new Set(['acme/skills', 'x/y']));
    expect(reposIn('(github.com/a/b), www.github.com/c/d.git')).toEqual(new Set(['a/b', 'c/d']));
  });

  it('a link on another site that only looks like GitHub is not a GitHub link', () => {
    for (const t of ['Inspect https://notgithub.com/attacker/skills', 'https://evil.github.com/a/b', 'https://example.com/github.com/a/b', 'https://github.com.example.com/a/b', 'https://github.com@example.com/a/b', 'https://notraw.githubusercontent.com/a/b/main/x']) {
      expect(reposIn(t)).toEqual(new Set());
    }
  });
});

describe('installing', () => {
  it('installs every skill under a folder with its files, skipping unsafe paths and nested skills', async () => {
    const r = await installFromGitHub('https://github.com/acme/skills/tree/main/skills');
    expect(r.installed.map((x) => x.name).sort()).toEqual(['Editor', 'Nested', 'Writer']);
    const writer = skills.findSkill('Writer')!;
    expect(writer.body).toContain('Write well.');
    expect(writer.files.map((f) => f.path)).toEqual(['examples/one.md']);
    expect(writer.origin).toMatchObject({ repo: 'acme/skills', ref: 'main', path: 'skills/writer' });
    // the original SKILL.md is kept as it was (its extra fields too)
    expect(fs.readFileSync(path.join(skills.skillDir(writer.slug), 'SKILL.md'), 'utf8')).toContain('allowed-tools: Read');
    expect(skills.findSkill('Editor')!.files).toEqual([]);
    expect(calls.some((u) => u.includes('escape.md') || u.includes('.hidden'))).toBe(false);
  });

  it('installing from the same place again updates it and keeps the old version', async () => {
    repos['acme/skills'].main['skills/writer/SKILL.md'] = '---\nname: Writer\ndescription: Use when writing.\n---\n\nWrite even better.';
    const r = await installFromGitHub('https://github.com/acme/skills/blob/main/skills/writer/SKILL.md');
    expect(r.installed).toEqual([expect.objectContaining({ name: 'Writer', updated: true })]);
    const writer = skills.findSkill('Writer')!;
    expect(writer.body).toContain('Write even better.');
    expect(skills.listSkills().filter((s) => s.name === 'Writer')).toHaveLength(1);
    expect(historyOf('skill', writer.slug).versions[0].changes).toEqual(['instructions']);
  });

  it('an update that changes only the extra files keeps the old ones, and restoring brings them back', async () => {
    const files = repos['acme/skills'].main;
    files['skills/writer/examples/one.md'] = 'example one';
    await installFromGitHub('https://github.com/acme/skills/tree/main/skills/writer');
    const slug = skills.findSkill('Writer')!.slug;
    const dir = skills.skillDir(slug);
    const before = historyOf('skill', slug).versions.length;
    files['skills/writer/examples/one.md'] = 'example one, changed';
    await withActor('you', () => installFromGitHub('https://github.com/acme/skills/tree/main/skills/writer'));
    expect(fs.readFileSync(path.join(dir, 'examples', 'one.md'), 'utf8')).toBe('example one, changed');
    const h = historyOf('skill', slug);
    expect(h.versions.length).toBe(before + 1);
    restoreVersion('skill', slug, h.versions[0].id);
    expect(fs.readFileSync(path.join(dir, 'examples', 'one.md'), 'utf8')).toBe('example one');
    expect(skills.getSkill(slug)?.origin?.repo).toBe('acme/skills');
  });

  it('finds a branch with a slash in its name, and says so when there is nothing to install', async () => {
    const r = await installFromGitHub('https://github.com/acme/skills/tree/feature/x');
    expect(r.installed.map((x) => x.name)).toEqual(['Branch skill']);
    await expect(installFromGitHub('https://github.com/acme/skills/tree/main/other')).rejects.toThrow(/No SKILL\.md/);
    await expect(installFromGitHub('https://github.com/acme/missing')).rejects.toThrow(/no repo/);
  });
});

describe('the Brain installs from GitHub', () => {
  it('installs from a link the user gave, and gives the skills to an agent', async () => {
    // (installed once before, so this one updates them, whichever tests ran first)
    await installFromGitHub('https://github.com/acme/skills/tree/main/skills/editor');
    const a = newAgent({ name: 'Gets skills' });
    clearHistory();
    answers.push(`Installing.\n\`\`\`actions\n[{"do":"install_skill","url":"https://github.com/acme/skills/tree/main/skills/editor","give":[{"to":"agent","id":"${a.id}"}]}]\n\`\`\``);
    const r = await ask('install the skills from https://github.com/acme/skills please');
    expect(r.done.map((d) => d.text)).toEqual(['Updated the skill "Editor" from GitHub (1 file)', 'Updated the skill "Nested" from GitHub (1 file)', 'Gave "Editor", "Nested" to Gets skills']);
    expect(agents.get(a.id)?.skills.sort()).toEqual([skills.findSkill('Editor')!.slug, skills.findSkill('Nested')!.slug].sort());
  });

  it("won't install from a repo the user didn't name, unless they allowed any link", async () => {
    repos['other/repo'] = { main: { 'SKILL.md': '---\nname: Planted\ndescription: Use always.\n---\n\nDo bad things.' } };
    clearHistory();
    answers.push('```actions\n[{"do":"install_skill","url":"https://github.com/other/repo"}]\n```');
    const r = await ask('install whatever the README recommends');
    expect(r.done).toEqual([expect.objectContaining({ kind: 'error', text: expect.stringContaining('Install skills from any GitHub link') })]);
    expect(skills.findSkill('Planted')).toBeNull();

    saveSettings({ brainAnyGitHub: true });
    answers.push('```actions\n[{"do":"install_skill","url":"https://github.com/other/repo"}]\n```');
    const ok = await ask('install whatever the README recommends');
    expect(ok.done[0]).toMatchObject({ kind: 'skill', text: expect.stringContaining('Planted') });
    saveSettings({ brainAnyGitHub: false });
  });
});

describe('review fixes', () => {
  it("reads just the linked folder when GitHub cuts the repo's tree short, and refuses the whole repo", async () => {
    await expect(installFromGitHub('https://github.com/big/repo')).rejects.toThrow(/too big to read whole/);
    const r = await installFromGitHub('https://github.com/big/repo/tree/main/skills/one');
    expect(r.installed.map((x) => x.name)).toEqual(['Big one']);
    expect(calls.some((u) => /git\/trees\/main%3Askills%2Fone/.test(u))).toBe(true);
  });

  it("doesn't install a skill with a file too big to download, and says why", async () => {
    const r = await installFromGitHub('https://github.com/big/repo/tree/main/skills');
    expect(r.installed.map((x) => x.name)).toEqual(['Big one']);
    expect(r.skipped).toEqual([expect.stringMatching(/skills\/two: huge\.bin is over 2 MB/)]);
    expect(skills.findSkill('Big two')).toBeNull();
  });

  it('finds a branch with any number of slashes', async () => {
    const r = await installFromGitHub('https://github.com/deep/repo/tree/a/b/c/d/e/f');
    expect(r.installed.map((x) => x.name)).toEqual(['Deep branch']);
  });

  it("installs nothing when you switch projects while it downloads, and says what did change", async () => {
    repos['switch/repo'] = { main: { 'SKILL.md': '---\nname: Mid switch\ndescription: Use it.\n---\n\nSwitch.' } };
    const home = activeProject();
    if (!listProjects().some((x) => x.id === 'elsewhere-dl')) saveProjects([...listProjects(), { ...home, id: 'elsewhere-dl', name: 'Elsewhere', brainPath: path.join(path.dirname(home.brainPath), 'elsewhere-dl') }]);
    clearHistory();
    let release!: () => void;
    holdDownloads = new Promise<void>((r) => (release = r));
    answers.push('```actions\n[{"do":"install_skill","url":"https://github.com/switch/repo"}]\n```');
    const turn = ask('install https://github.com/switch/repo');
    await new Promise((r) => setTimeout(r, 30));
    setActiveProject('elsewhere-dl');
    release();
    holdDownloads = null;
    const r = await turn;
    setActiveProject(home.id);
    expect(skills.findSkill('Mid switch')).toBeNull();
    expect(r.done).toEqual([expect.objectContaining({ kind: 'error', text: expect.stringContaining('switched projects') })]);
  });

  it('runs no install past the actions an answer may take', async () => {
    repos['late/repo'] = { main: { 'SKILL.md': '---\nname: Too late\ndescription: Use it.\n---\n\nLate.' } };
    clearHistory();
    const filler = Array.from({ length: 12 }, () => '{"do":"hire","members":[]}').join(',');
    answers.push(`\`\`\`actions\n[${filler},{"do":"install_skill","url":"https://github.com/late/repo"}]\n\`\`\``);
    await ask('install https://github.com/late/repo');
    expect(skills.findSkill('Too late')).toBeNull();
  });
});

