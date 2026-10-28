// Projects: create, switch, and look inside a project's Brain folder (files, notes, GitHub).
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ensureDir, exists, insideRoots, isPlainDir, run, slugify, uid, which, dataPath } from './util.ts';
import { listProjects, saveProjects, activeProject, setActiveProject, log } from './store.ts';
import type { Project } from '../shared/types.ts';
import type { ProjectPeek } from './projectsync.ts';

const PROJECTS_ROOT = path.join(HOME, 'Documents', 'Blacksite');
// Where projects went before the app was called Blacksite. They stay there (each project knows its
// own folder); this is only searched for project folders the dashboard doesn't know yet.
const OLD_PROJECTS_ROOT = path.join(HOME, 'Documents', 'My Dashboard');
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.venv', '__pycache__', '.cache']);

export function projectsRoot(): string {
  return PROJECTS_ROOT;
}

function brainReadme(name: string, extra = ''): string {
  return `# ${name}

This folder is the project's Brain. Every agent in the project works here and reads it for context.

Put anything the agents should know in here: briefs, notes, brand and style guides, docs, assets.
Agents save what they make into this folder too.
${extra}
`;
}

export interface CreateProjectInput {
  name?: string;
  mode?: 'new' | 'existing' | 'github' | string;
  folder?: string;
  repo?: string;
  description?: string;
}

// mode: "new" (fresh folder), "existing" (a folder you already have), "github" (clone a repo into a folder)
export async function createProject({ name, mode = 'new', folder = '', repo = '', description = '' }: CreateProjectInput): Promise<Project> {
  name = String(name || '').trim();
  if (!name) throw new Error('Give the project a name.');
  let brainPath = String(folder || '').trim().replace(/^"|"$/g, '');
  repo = String(repo || '').trim();
  if (mode === 'existing') {
    if (!brainPath || !exists(brainPath) || !fs.statSync(brainPath).isDirectory()) throw new Error(`${brainPath || 'That folder'} doesn't exist.`);
  } else {
    brainPath ||= path.join(PROJECTS_ROOT, slugify(name));
    if (mode === 'github') {
      if (!repo) throw new Error('Which GitHub repo? Use owner/name or a URL.');
      if (exists(brainPath) && fs.readdirSync(brainPath).length) throw new Error(`${brainPath} already has files in it. Pick an empty or new folder.`);
      ensureDir(path.dirname(brainPath));
      const short = /^[\w.-]+\/[\w.-]+$/.test(repo);
      const r = which('gh') && short ? await run('gh', ['repo', 'clone', repo, brainPath], { timeout: 15 * 60_000 }) : await run('git', ['clone', short ? `https://github.com/${repo}.git` : repo, brainPath], { timeout: 15 * 60_000 });
      if (r.code !== 0) throw new Error(`Couldn't clone ${repo}: ${(r.stderr || r.stdout).trim().slice(-500)}`);
    } else {
      ensureDir(brainPath);
      const readme = path.join(brainPath, 'BRAIN.md');
      if (!exists(readme)) fs.writeFileSync(readme, brainReadme(name));
      ensureDir(path.join(brainPath, 'notes'));
    }
  }
  const list = listProjects();
  const id = `${slugify(name)}-${uid().slice(-4)}`;
  const project: Project = { id, name, description: String(description || '').trim().slice(0, 6000), brainPath: path.resolve(brainPath), repo, createdAt: Date.now() };
  saveProjects([...list, project]);
  setActiveProject(id);
  log('project', `Created project "${name}" (${mode === 'github' ? `cloned ${repo}` : brainPath})`);
  return project;
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'description' | 'skills' | 'brainPath'>>;

export function updateProject(id: string, patch: ProjectPatch): Project {
  const list = listProjects();
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error('No such project.');
  if (patch.name !== undefined) {
    const name = String(patch.name).trim().slice(0, 80);
    if (!name) throw new Error('Give the project a name.');
    if (name !== p.name) log('project', `Renamed the project "${p.name}" to "${name}"`);
    p.name = name;
  }
  if (typeof patch.description === 'string') p.description = patch.description.trim().slice(0, 6000);
  // skills every agent in the project gets
  if (Array.isArray(patch.skills)) p.skills = [...new Set(patch.skills.map(String))].slice(0, 100);
  if (patch.brainPath) {
    if (!exists(patch.brainPath)) throw new Error(`${patch.brainPath} doesn't exist.`);
    p.brainPath = path.resolve(patch.brainPath);
  }
  saveProjects(list);
  return p;
}

// Removes the project from the dashboard. Its Brain folder and files on disk stay where they are.
export function removeProject(id: string): Project[] {
  const list = listProjects();
  if (list.length <= 1) throw new Error('Keep at least one project.');
  const rest = list.filter((x) => x.id !== id);
  saveProjects(rest);
  if (activeProject().id === id || !rest.some((x) => x.id === activeProject().id)) setActiveProject(rest[0].id);
  return rest;
}

export function ensureBrain(p: Project = activeProject()): string {
  if (!exists(p.brainPath)) {
    ensureDir(p.brainPath);
    fs.writeFileSync(path.join(p.brainPath, 'BRAIN.md'), brainReadme(p.name));
  }
  return p.brainPath;
}

export interface BrainEntry {
  name: string;
  dir: boolean;
  path: string;
}

export interface BrainGit {
  branch: string;
  remote: string;
  url: string;
  last: string;
  changes: number;
}

export interface BrainInfo {
  project: Project;
  entries: BrainEntry[];
  files: number;
  sizeMB: number;
  git: BrainGit | null;
  summary: ReturnType<typeof projectSummary>;
}

// A look inside the Brain: top files and folders, size, and Git status.
export async function brainInfo(p: Project = activeProject()): Promise<BrainInfo> {
  ensureBrain(p);
  const entries: BrainEntry[] = [];
  let files = 0;
  let bytes = 0;
  const walk = (dir: string, depth: number) => {
    let list: fs.Dirent[] = [];
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth === 0) entries.push({ name: e.name, dir: true, path: full });
        if (files < 5000) walk(full, depth + 1);
      } else {
        files++;
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* gone */
        }
        if (depth === 0) entries.push({ name: e.name, dir: false, path: full });
      }
    }
  };
  walk(p.brainPath, 0);
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  let git: BrainGit | null = null;
  if (exists(path.join(p.brainPath, '.git'))) {
    const g = (...args: string[]) => run('git', ['-C', p.brainPath, ...args], { timeout: 15000 }).then((r) => r.stdout.trim());
    const [branch, remote, last, status] = await Promise.all([g('rev-parse', '--abbrev-ref', 'HEAD'), g('remote', 'get-url', 'origin'), g('log', '-1', '--format=%s · %cr'), g('status', '--porcelain')]);
    git = { branch, remote, url: remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, ''), last, changes: status ? status.split('\n').length : 0 };
  }
  return { project: withLogo(p), entries: entries.slice(0, 60), files, sizeMB: +(bytes / 1e6).toFixed(1), git, summary: projectSummary(p) };
}

export function addNote(name: unknown, content: unknown, p: Project = activeProject()): string {
  ensureBrain(p);
  const dir = ensureDir(path.join(p.brainPath, 'notes'));
  const safe = String(name || 'note').replace(/[^\w.\- ]+/g, '_').replace(/\.md$/i, '') + '.md';
  const file = path.join(dir, safe);
  // a notes/ folder or a note that links out of the Brain folder (planted in a project folder) would write over a file elsewhere
  const real = insideRoots(file, [p.brainPath]);
  if (!real) throw new Error('That note is a link out of the Brain folder; not writing through it.');
  fs.writeFileSync(real, String(content || ''));
  return file;
}

export async function gitPull(p: Project = activeProject()): Promise<string> {
  const r = await run('git', ['-C', p.brainPath, 'pull', '--ff-only'], { timeout: 5 * 60_000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().slice(-500));
  return r.stdout.trim() || 'Up to date.';
}

/** A project on the start screen. */
export type ProjectOverviewItem = Project & { agents: number; teams: number; hasProjectMd: boolean; saved: ProjectPeek | null };

/** A folder in the projects folder that isn't a project yet. */
export interface FoundFolder {
  name: string;
  folder: string;
  /** PROJECT.md or BRAIN.md, when it has one */
  brief: string | undefined;
  saved: ProjectPeek | null;
}

export interface ProjectsOverview {
  active: string;
  root: string;
  projects: ProjectOverviewItem[];
  found: FoundFolder[];
}

// For the start screen: every project with how many agents and teams it has, plus project
// folders on this PC (in the projects folder) that aren't on the list yet.
export function overview(peek: (folder: string) => ProjectPeek | null = () => null): ProjectsOverview {
  const list = listProjects();
  const count = (id: string, what: string) => {
    try {
      return fs.readdirSync(dataPath('projects', id, what)).filter((n) => n.endsWith('.json')).length;
    } catch {
      return 0;
    }
  };
  const known = new Set(list.map((p) => path.resolve(p.brainPath).toLowerCase()));
  const found: FoundFolder[] = [];
  for (const root of [PROJECTS_ROOT, OLD_PROJECTS_ROOT]) {
    try {
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const dir = path.join(root, e.name);
        if (known.has(path.resolve(dir).toLowerCase())) continue;
        const saved = peek(dir);
        const hasBrief = ['PROJECT.md', 'BRAIN.md'].find((f) => exists(path.join(dir, f)));
        if (saved || hasBrief) found.push({ name: saved?.name || e.name, folder: dir, brief: hasBrief, saved });
      }
    } catch {
      /* no projects folder there */
    }
  }
  return {
    active: activeProject().id,
    root: PROJECTS_ROOT,
    projects: list
      .map((p) => ({ ...withLogo(p), agents: count(p.id, 'agents'), teams: count(p.id, 'workflows'), hasProjectMd: exists(path.join(p.brainPath, 'PROJECT.md')), saved: peek(p.brainPath) }))
      .sort((a, b) => (b.openedAt || b.createdAt || 0) - (a.openedAt || a.createdAt || 0)),
    found,
  };
}

// Remember when a project was last opened (for the start screen order).
export function touch(id: string) {
  const list = listProjects();
  const p = list.find((x) => x.id === id);
  if (p) {
    p.openedAt = Date.now();
    saveProjects(list);
  }
}

// ---------- the project's logo ----------
// Kept in the project folder (.dashboard/logo.<ext>), so it travels with the folder like the
// auto-saved agents and teams. PNG, JPG, WebP or GIF only: an SVG could carry scripts.
const LOGO_EXT = ['png', 'jpg', 'webp', 'gif'] as const;
const LOGO_MAX = 3 * 1024 * 1024;

// .dashboard/<name> only when it is a plain file in a plain .dashboard folder: a link planted in the
// project folder could point at any file on the PC, and these are served to the page.
function mediaFile(p: Project, name: string): string | null {
  const dir = path.join(p.brainPath, '.dashboard');
  if (!isPlainDir(dir)) return null;
  const f = path.join(dir, name);
  try {
    return fs.lstatSync(f).isFile() ? f : null;
  } catch {
    return null;
  }
}

export function logoFile(p: Project): string | null {
  for (const ext of LOGO_EXT) {
    const f = mediaFile(p, `logo.${ext}`);
    if (f) return f;
  }
  return null;
}

/** The project plus when its logo and its 3D model last changed (the page adds it to their URLs so a new one shows at once). */
export function withLogo(p: Project): Project & { logoAt: number | null; modelAt: number | null; modelExt: string | null } {
  const f = logoFile(p);
  let logoAt: number | null = null;
  if (f) {
    try {
      logoAt = Math.round(fs.statSync(f).mtimeMs);
    } catch {
      /* just removed */
    }
  }
  const m = modelFile(p);
  let modelAt: number | null = null;
  if (m) {
    try {
      modelAt = Math.round(fs.statSync(m).mtimeMs);
    } catch {
      /* just removed */
    }
  }
  return { ...p, logoAt, modelAt, modelExt: m && modelAt ? path.extname(m).slice(1) : null };
}

// What the bytes really are (the data URL's type is only what the browser says).
export function sniffImage(buf: Buffer): (typeof LOGO_EXT)[number] | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function logoDir(p: Project): string {
  const dir = ensureDir(path.join(p.brainPath, '.dashboard'));
  // never write through a link someone planted in the project folder
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error("The project's .dashboard folder is a link; not writing a logo there.");
  return dir;
}

export function setLogo(id: string, dataUrl: unknown): Project & { logoAt: number | null } {
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new Error('No such project.');
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error('Pick a PNG, JPG, WebP or GIF image.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > LOGO_MAX) throw new Error('That image is too big (3 MB at most).');
  const ext = sniffImage(buf);
  if (!ext) throw new Error('Pick a PNG, JPG, WebP or GIF image.');
  const dir = logoDir(p);
  for (const e of LOGO_EXT) {
    const old = path.join(dir, `logo.${e}`);
    if (fs.existsSync(old) || isLink(old)) fs.rmSync(old, { force: true });
  }
  fs.writeFileSync(path.join(dir, `logo.${ext}`), buf);
  log('project', `New logo for "${p.name}"`);
  return withLogo(p);
}

export function removeLogo(id: string): Project & { logoAt: number | null } {
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new Error('No such project.');
  const dir = path.join(p.brainPath, '.dashboard');
  // (not through a .dashboard that links elsewhere: that would delete files there)
  if (isPlainDir(dir)) for (const e of LOGO_EXT) fs.rmSync(path.join(dir, `logo.${e}`), { force: true });
  return withLogo(p);
}

// ---------- the project's 3D model ----------
// Replaces the logo inside the Brain's globe. Kept next to the logo (.dashboard/brain-model.<ext>). Only the formats the page can
// draw, and each file must really be one (its first bytes are checked).
export const MODEL_EXT = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx'] as const;
export const MODEL_MAX = 15 * 1024 * 1024;

export function modelFile(p: Project): string | null {
  for (const ext of MODEL_EXT) {
    const f = mediaFile(p, `brain-model.${ext}`);
    if (f) return f;
  }
  return null;
}

/** Is this buffer really a model of the type its name says? */
export function looksLikeModel(ext: string, buf: Buffer): boolean {
  const head = buf.toString('latin1', 0, 4096);
  switch (ext) {
    case 'glb':
      return buf.length > 12 && buf.toString('ascii', 0, 4) === 'glTF';
    case 'gltf':
      try {
        return typeof (JSON.parse(buf.toString('utf8')) as { asset?: unknown }).asset === 'object';
      } catch {
        return false;
      }
    case 'ply':
      return head.startsWith('ply');
    case 'fbx':
      return head.startsWith('Kaydara FBX Binary') || head.startsWith('; FBX');
    case 'stl':
      // ASCII starts with "solid"; binary is an 80-byte header, a triangle count and 50 bytes per triangle
      return head.trimStart().startsWith('solid') || (buf.length > 84 && buf.length === 84 + 50 * buf.readUInt32LE(80));
    case 'obj':
      return /^\s*(#|mtllib|o |g |v |vn |vt |f )/m.test(head) && /^\s*v\s/m.test(head);
    default:
      return false;
  }
}

export function setModel(id: string, name: unknown, dataUrl: unknown): Project & { logoAt: number | null; modelAt: number | null; modelExt: string | null } {
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new Error('No such project.');
  const ext = path.extname(String(name || '')).slice(1).toLowerCase();
  if (!(MODEL_EXT as readonly string[]).includes(ext)) throw new Error(`Pick a 3D model file: ${MODEL_EXT.map((e) => `.${e}`).join(', ')}.`);
  const m = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error("Couldn't read that file.");
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MODEL_MAX) throw new Error(`That model is too big (${MODEL_MAX / 1048576} MB at most).`);
  if (!looksLikeModel(ext, buf)) throw new Error(`That file isn't a real .${ext} model.`);
  const dir = logoDir(p);
  for (const e of MODEL_EXT) {
    const old = path.join(dir, `brain-model.${e}`);
    if (fs.existsSync(old) || isLink(old)) fs.rmSync(old, { force: true });
  }
  fs.writeFileSync(path.join(dir, `brain-model.${ext}`), buf);
  log('project', `New 3D model for "${p.name}"`);
  return withLogo(p);
}

export function removeModel(id: string): Project & { logoAt: number | null; modelAt: number | null; modelExt: string | null } {
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new Error('No such project.');
  const dir = path.join(p.brainPath, '.dashboard');
  if (isPlainDir(dir)) for (const e of MODEL_EXT) fs.rmSync(path.join(dir, `brain-model.${e}`), { force: true });
  return withLogo(p);
}

const isLink = (f: string): boolean => {
  try {
    return fs.lstatSync(f).isSymbolicLink();
  } catch {
    return false;
  }
};

// ---------- a short description for the Brain panel ----------
// What the user said the project is, or else the first real paragraph of PROJECT.md / README.
export function projectSummary(p: Project = activeProject()): { text: string; from: 'description' | 'PROJECT.md' | 'README.md' | null } {
  if (p.description?.trim()) return { text: p.description.trim(), from: 'description' };
  for (const name of ['PROJECT.md', 'README.md'] as const) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(p.brainPath, name), 'utf8');
    } catch {
      continue;
    }
    const para = text
      .split(/\r?\n\s*\r?\n/)
      .map((b) => b.trim())
      .find((b) => b && !b.startsWith('#') && !b.startsWith('<') && !b.startsWith('![') && !b.startsWith('|') && !b.startsWith('```'));
    if (para) return { text: para.replace(/\s+/g, ' ').slice(0, 500), from: name };
  }
  return { text: '', from: null };
}
