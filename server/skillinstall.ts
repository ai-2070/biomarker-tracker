// Install skills from GitHub. A link can be a repo, a folder (tree), a file (blob) or a raw file:
// every folder with a SKILL.md at or under it is a skill, installed with its files. Installing from the
// same place again updates the skill (its old version is kept). Public repos work as they are; for
// private ones the GitHub CLI's login (gh auth token) or GITHUB_TOKEN is used.
import fs from 'node:fs';
import path from 'node:path';
import { dataPath, ensureDir, run, which, writeJSON } from './util.ts';
import { emit, log } from './store.ts';
import { listSkills, getSkill, skillDir, skillVersionsDir, skillFromText, uniqueSlug, isSkillSlug, skillExtraFiles, skillFilesHash, copySkillFiles } from './skills.ts';
import type { SkillVersionItem } from './skills.ts';
import { keepVersion, versionFilesDir } from './versions.ts';
import type { SkillInstallResult, SkillOrigin } from '../shared/types.ts';

export const MAX_SKILLS = 20; // per link
const MAX_FILES = 200; // per skill
const MAX_FILE = 2 * 1024 * 1024; // per file
const MAX_SKILL = 10 * 1024 * 1024; // per skill, all files
const TIMEOUT = 20_000;

export interface GitHubLink {
  owner: string;
  repo: string;
  /** what follows the repo: for tree/blob/raw, the ref and then the path (a ref may have slashes) */
  rest: string[];
  kind: 'repo' | 'tree' | 'blob' | 'raw';
}

const NAME = /^[\w.-]{1,100}$/;
const fail = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

/** Read a GitHub link. Throws when it isn't one. */
export function parseGitHubUrl(input: string): GitHubLink {
  let u: URL;
  try {
    u = new URL(String(input || '').trim().replace(/^(?!https?:\/\/)(github\.com\/)/i, 'https://$1'));
  } catch {
    throw fail('That is not a link. Give a GitHub link, e.g. https://github.com/owner/repo/tree/main/skills/my-skill');
  }
  if (u.protocol !== 'https:') throw fail('Only https GitHub links.');
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const host = u.hostname.toLowerCase();
  if (host === 'raw.githubusercontent.com') {
    const [owner, repo, ...rest] = parts;
    if (!owner || !repo || rest.length < 2 || !NAME.test(owner) || !NAME.test(repo)) throw fail('That raw GitHub link has no owner, repo, branch and file.');
    return { owner, repo, rest, kind: 'raw' };
  }
  if (host !== 'github.com' && host !== 'www.github.com') throw fail('Skills can be installed from github.com links only.');
  const [owner, rawRepo, kind, ...rest] = parts;
  const repo = (rawRepo || '').replace(/\.git$/, '');
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) throw fail('That GitHub link has no owner and repo.');
  if (!kind) return { owner, repo, rest: [], kind: 'repo' };
  if ((kind === 'tree' || kind === 'blob') && rest.length) return { owner, repo, rest, kind };
  throw fail('Link to a repo, a folder or a SKILL.md on GitHub.');
}

// ---------- talking to GitHub ----------
let tokenCache: { token: string | null; at: number } | null = null;
async function token(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (tokenCache && Date.now() - tokenCache.at < 10 * 60_000) return tokenCache.token;
  let t: string | null = null;
  if (which('gh')) {
    const r = await run('gh', ['auth', 'token'], { timeout: 8000 }).catch(() => null);
    t = r?.stdout.trim() || null;
  }
  tokenCache = { token: t, at: Date.now() };
  return t;
}
async function headers(): Promise<Record<string, string>> {
  const t = await token();
  return { 'user-agent': 'blacksite', accept: 'application/vnd.github+json', ...(t ? { authorization: `Bearer ${t}` } : {}) };
}
async function api<T>(p: string): Promise<{ ok: boolean; status: number; json: T | null }> {
  const r = await fetch(`https://api.github.com${p}`, { headers: await headers(), signal: AbortSignal.timeout(TIMEOUT) });
  return { ok: r.ok, status: r.status, json: r.ok ? ((await r.json()) as T) : null };
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | string;
  size?: number;
}
interface Tree {
  tree: TreeEntry[];
  truncated?: boolean;
}

// The ref and the path inside the repo. A ref may have slashes, so the longest… no: the first ref
// GitHub knows wins, trying one segment, then two, and so on.
async function resolve(link: GitHubLink): Promise<{ ref: string; path: string; tree: Tree }> {
  const base = `/repos/${link.owner}/${link.repo}`;
  if (link.kind === 'repo') {
    const repo = await api<{ default_branch?: string }>(base);
    if (!repo.ok) throw fail(repo.status === 404 ? `GitHub has no repo ${link.owner}/${link.repo} (or it's private: sign in with the GitHub CLI, gh auth login).` : `GitHub said ${repo.status}.`, 404);
    const ref = repo.json?.default_branch || 'main';
    const tree = await api<Tree>(`${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (!tree.ok || !tree.json) throw fail(`Couldn't read ${link.owner}/${link.repo} (GitHub said ${tree.status}).`);
    return { ref, path: '', tree: tree.json };
  }
  // (every split is tried: a branch name can have any number of slashes)
  for (let n = 1; n <= link.rest.length - (link.kind === 'raw' ? 1 : 0); n++) {
    const ref = link.rest.slice(0, n).join('/');
    const tree = await api<Tree>(`${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (tree.status === 403 || tree.status === 429) throw fail('GitHub is limiting requests right now. Try again later, or sign in with the GitHub CLI (gh auth login).', 429);
    if (!tree.ok || !tree.json) continue;
    let p = link.rest.slice(n).join('/');
    // a file: its folder
    if (link.kind === 'blob' || link.kind === 'raw' || tree.json.tree.some((e) => e.path === p && e.type === 'blob')) p = path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p);
    return { ref, path: p.replace(/\/+$/, ''), tree: tree.json };
  }
  throw fail(`Couldn't find that branch or folder in ${link.owner}/${link.repo} (or the repo is private: sign in with the GitHub CLI, gh auth login).`, 404);
}

// A path inside a skill that's safe to write: no "..", no absolute paths, no hidden parts.
const safeRel = (rel: string) => rel.length > 0 && rel.length < 300 && !rel.split('/').some((x) => !x || x === '.' || x === '..' || x.startsWith('.')) && !/[\\:\0]/.test(rel);

async function download(link: GitHubLink, ref: string, file: string): Promise<Buffer> {
  const url = `https://raw.githubusercontent.com/${link.owner}/${link.repo}/${ref.split('/').map(encodeURIComponent).join('/')}/${file.split('/').map(encodeURIComponent).join('/')}`;
  const t = await token();
  const r = await fetch(url, { headers: { 'user-agent': 'blacksite', ...(t ? { authorization: `Bearer ${t}` } : {}) }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`couldn't download ${file} (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_FILE) throw new Error(`${file} is too big`);
  return buf;
}

// ---------- install ----------
// A tree GitHub cut short (too many files) can't be trusted to hold every skill or file: read just the
// linked folder instead, and give up if even that is cut short.
async function wholeTree(link: GitHubLink, ref: string, at: string, tree: Tree): Promise<Tree> {
  if (!tree.truncated) return tree;
  if (!at) throw fail("That repo is too big to read whole: link straight to the skill's folder (or a folder of skills).");
  const sub = await api<Tree>(`/repos/${link.owner}/${link.repo}/git/trees/${encodeURIComponent(`${ref}:${at}`)}?recursive=1`);
  if (!sub.ok || !sub.json) throw fail(`Couldn't read ${at} in ${link.owner}/${link.repo} (GitHub said ${sub.status}).`);
  if (sub.json.truncated) throw fail(`${at} is too big to read whole: link to one skill's folder.`);
  return { tree: sub.json.tree.map((e) => ({ ...e, path: `${at}/${e.path}` })) };
}

/** Install (or update) every skill at or under a GitHub link.
 *  proceed: asked just before each skill is put in the library; false leaves it out (e.g. you switched projects). */
export async function installFromGitHub(url: string, { proceed = () => true }: { proceed?: () => boolean } = {}): Promise<SkillInstallResult> {
  const link = parseGitHubUrl(url);
  const resolved = await resolve(link);
  const { ref, path: at } = resolved;
  const tree = await wholeTree(link, ref, at, resolved.tree);
  const under = (p: string) => !at || p === at || p.startsWith(`${at}/`);
  const blobs = tree.tree.filter((e) => e.type === 'blob' && under(e.path));
  const roots = blobs.filter((e) => path.posix.basename(e.path) === 'SKILL.md').map((e) => path.posix.dirname(e.path).replace(/^\.$/, ''));
  if (!roots.length) throw fail(`No SKILL.md at or under that link in ${link.owner}/${link.repo}.`, 404);
  if (roots.length > MAX_SKILLS) throw fail(`That link has ${roots.length} skills; link to a folder with at most ${MAX_SKILLS}, or to one skill.`);

  const result: SkillInstallResult = { installed: [], skipped: [] };
  for (const root of roots) {
    const label = root || `${link.owner}/${link.repo}`;
    try {
      // the skill's files: everything in its folder that isn't part of a skill further down
      const inner = roots.filter((r) => r !== root && (!root || r.startsWith(`${root}/`)));
      const mine = blobs.filter((e) => (!root || e.path.startsWith(`${root}/`)) && !inner.some((r) => e.path.startsWith(`${r}/`)));
      const files: { rel: string; size: number; path: string }[] = [];
      let total = 0;
      for (const e of mine) {
        const rel = root ? e.path.slice(root.length + 1) : e.path;
        // hidden files and odd paths are left out; a file too big to download means the skill isn't whole, so it isn't installed
        if (!safeRel(rel)) continue;
        if ((e.size ?? 0) > MAX_FILE) throw new Error(`${rel} is over ${MAX_FILE / 1024 / 1024} MB`);
        total += e.size ?? 0;
        files.push({ rel, size: e.size ?? 0, path: e.path });
      }
      if (files.length > MAX_FILES) throw new Error(`it has ${files.length} files (at most ${MAX_FILES})`);
      if (total > MAX_SKILL) throw new Error(`its files are over ${MAX_SKILL / 1024 / 1024} MB`);
      // download into a fresh folder first, so a failed download changes nothing
      const tmp = ensureDir(dataPath('tmp', `install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`));
      try {
        for (const f of files) {
          const out = path.join(tmp, ...f.rel.split('/'));
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, await download(link, ref, f.path));
        }
        const md = skillFromText(fs.readFileSync(path.join(tmp, 'SKILL.md'), 'utf8'), 'x');
        if (!md.body.trim() && !md.description) throw new Error('its SKILL.md is empty');
        const origin: SkillOrigin = { url: `https://github.com/${link.owner}/${link.repo}/tree/${ref}${root ? `/${root}` : ''}`, repo: `${link.owner}/${link.repo}`, ref, path: root, installedAt: Date.now() };
        writeJSON(path.join(tmp, '.source.json'), origin);
        // the same skill from the same place: update it (old version kept); else a new one
        const same = listSkills().find((s) => s.origin && s.origin.repo.toLowerCase() === origin.repo.toLowerCase() && s.origin.path === origin.path);
        const slug = same ? same.slug : uniqueSlug(path.posix.basename(root) || md.name || link.repo);
        if (!isSkillSlug(slug)) throw new Error('no usable name');
        if (!proceed()) throw new Error('not installed: you switched projects while it downloaded');
        const before = same ? getSkill(slug) : null;
        if (before) {
          // the old version is kept with its extra files, so an update that changed only those still
          // counts, and bringing it back brings back the files it had
          const dir = skillDir(slug);
          const after: SkillVersionItem = { ...skillFromText(fs.readFileSync(path.join(tmp, 'SKILL.md'), 'utf8'), slug), filesHash: skillFilesHash(tmp) };
          const was: SkillVersionItem = { slug, name: before.name, description: before.description, body: before.body.trim(), files: skillExtraFiles(dir), filesHash: skillFilesHash(dir) };
          const v = keepVersion(skillVersionsDir(slug), was, after, { ignore: ['files'] });
          if (v && was.files?.length) copySkillFiles(dir, versionFilesDir(skillVersionsDir(slug), v.id));
        }
        fs.rmSync(skillDir(slug), { recursive: true, force: true });
        fs.renameSync(tmp, skillDir(slug));
        const s = getSkill(slug)!;
        result.installed.push({ slug, name: s.name, updated: Boolean(before), files: files.length });
        log('skill', `${before ? 'Updated' : 'Installed'} the skill "${s.name}" from ${origin.repo}`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } catch (e) {
      result.skipped.push(`${label}: ${(e as Error).message}`);
    }
  }
  if (result.installed.length) emit('skills', { installed: result.installed.map((x) => x.slug) });
  return result;
}

/** owner/repo of every GitHub link in a text (lowercase), to check a link came from the user. */
export function reposIn(text: string): Set<string> {
  const out = new Set<string>();
  // The whole host must be GitHub's: not the end of another one (notgithub.com, x.github.com), not the
  // start of one (github.com.example.com: the slash must follow), nor part of another site's path
  // (example.com/github.com/...).
  const links = /(?<![\w.@/:%\\-])(?:https?:\/\/)?(?:(?:www\.)?github\.com|raw\.githubusercontent\.com)\/([\w.-]+)\/([\w.-]+)/gi;
  for (const m of String(text || '').matchAll(links)) out.add(`${m[1]}/${m[2].replace(/\.git$/, '')}`.toLowerCase());
  return out;
}
