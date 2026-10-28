// Auto-save: every project keeps a copy of its agents, teams, routines, layout, team chats, Brain chat,
// agent chats (with each chat's engine session), agent knowledge files, the MEMORY.md of each agent and
// the Brain, the skills it uses and the kept versions of its agents, teams, memories and those skills inside its own folder (<project folder>/.dashboard). A few seconds after
// any change it is saved again. Opening that folder as a project (here or on another PC) restores it.
// Keys and tokens are never written there.
import fs from 'node:fs';
import path from 'node:path';
import { bus, listProjects, activeProject, log, takeNewDefaultProject } from './store.ts';
import { updateProject } from './projects.ts';
import { dataPath, ensureDir, exists, isPlainDir, readJSON, readPlain, writeJSON, realTarget, uid } from './util.ts';
import { VERSIONS_KEPT, keepVersion, withActor, canonical, versionFilesDir, checkVersion, cleanAgentVersion, cleanTeamVersion } from './versions.ts';
import { getSkill, isSkillSlug, skillDir, skillVersionsDir, skillFromText, skillExtraFiles, skillFilesHash, copySkillFiles, skillVersionItem, SKILL_BODY_MAX } from './skills.ts';
import type { SkillVersionItem } from './skills.ts';
import { cleanMemoryVersion, isMemoryOwner, putMemory, MEMORY_FILE, MEMORY_MAX } from './memory.ts';
import type { Version } from './versions.ts';
import { getWorld, worldDir, WORLD_ID } from './voxel/store.ts';
import { setLink, usedBy } from './voxel/link.ts';
import { WORLD_MD_MAX } from './voxel/worldmd.ts';
import { rebase } from './backup.ts';
import type { Agent, Chat, Project, Routine, Team, VoxelWorld } from '../shared/types.ts';

/** The last auto-save of a project (AppState.projectSaved). */
export interface SaveStatus {
  at: number;
  error?: string;
  agents?: number;
  teams?: number;
}

/** <project folder>/.dashboard/project.json */
export interface SavedProjectFile {
  format: number;
  app: string;
  savedAt: number;
  /** brainPath: the folder it was saved from, so folders inside it move with a copy (older saves: missing) */
  project: { name?: string; description?: string; repo?: string; skills?: string[]; brainPath?: string };
  agents: Agent[];
  teams: Team[];
  routines?: Routine[];
  layout: unknown;
  brainChat: unknown;
}

/** What a folder holds, if the dashboard saved a project in it. */
export interface ProjectPeek {
  name: string;
  description: string;
  agents: number;
  teams: number;
  savedAt: number;
}

export interface RestoreResult {
  agents: number;
  teams: number;
  chats?: number;
  /** kept versions of agents and teams (deleted ones included) */
  versions?: number;
  /** skills added to the library from the folder, and ones the library had already (by name) */
  skills?: { added: string[]; kept: string[] };
  project: SavedProjectFile['project'];
}

const FORMAT = 1;
const DIR = '.dashboard';
const KNOWLEDGE_CAP = 50 * 1024 * 1024; // don't copy more than 50 MB of knowledge files
const CHATS_CAP = 200 * 1024 * 1024; // nor more than 200 MB of agent chats
const VERSIONS_CAP = 50 * 1024 * 1024; // nor more than 50 MB of agent and team versions
const SKILLS_CAP = 50 * 1024 * 1024; // nor more than 50 MB of skills (with their files and versions)
const MEMORY_CAP = 20 * 1024 * 1024; // nor more than 20 MB of MEMORY.md files
const WORLD_CAP = 300 * 1024 * 1024; // nor more than 300 MB of voxel world
const MARKS_CAP = 100 * 1024 * 1024; // nor more than 100 MB of team pictures and models
// The versioned collections (data/projects/<id>/versions/<kind>/<item id>/<version id>.json)
const VERSIONED = ['agents', 'workflows', 'memory'] as const;
const saved = new Map<string, SaveStatus>(); // projectId -> { at, error }
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const projectDir = (id: string, ...p: string[]) => dataPath('projects', id, ...p);
// Plain .json files only: a link (agents/x.json -> data/secrets.json, or anywhere on the PC) would be
// read through and land in the project folder, which may be shared or pushed to GitHub.
// The folder itself too: agents/ as a link to a folder elsewhere would list that folder's files.
const jsonFiles = (dir: string): string[] => {
  if (!isPlainDir(dir)) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name);
  } catch {
    return [];
  }
};
const readAll = <T>(dir: string): T[] => jsonFiles(dir).map((n) => readJSON<T>(path.join(dir, n))).filter((x): x is T => Boolean(x));


// Refuse to write through a link anywhere from base down to target (a crafted project folder could
// point .dashboard/... at another file).
function noLinks(base: string, target: string) {
  let p = base;
  for (const part of ['', ...path.relative(base, target).split(path.sep)]) {
    p = path.join(p, part);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return; // not there yet, so nothing below it is a link either
    }
    if (st.isSymbolicLink()) throw new Error(`${p} is a link; not saving through it.`);
  }
}

// Remove what's in dir but no longer in keep (deleted at the source). With base, refuse when dir or a
// folder above it (up to base) is a link: pruning would delete files wherever it points.
function prune(dir: string, keep: Set<string>, base?: string) {
  if (base) noLinks(base, dir);
  let list: string[] = [];
  try {
    list = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of list) if (!keep.has(n)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
}

function copyTree(from: string, to: string, budget: number, { base, mirror = false }: { base?: string; mirror?: boolean } = {}): number {
  let used = 0;
  const walk = (src: string, dst: string) => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(src);
    } catch {
      return;
    }
    // A linked folder is left out like a linked file (below the top, readdir's entries already say so):
    // it could point anywhere on the PC. Mirrored, so a copy saved before it was a link goes too.
    let list: fs.Dirent[] = [];
    if (!st.isSymbolicLink()) {
      try {
        list = fs.readdirSync(src, { withFileTypes: true });
      } catch {
        return;
      }
    }
    if (base) noLinks(base, dst);
    if (mirror) prune(dst, new Set(list.map((e) => e.name)), base);
    for (const e of list) {
      const a = path.join(src, e.name);
      const b = path.join(dst, e.name);
      if (e.isDirectory()) walk(a, b);
      else if (e.isFile()) {
        const st = fs.statSync(a);
        if (used + st.size > budget) continue;
        used += st.size;
        // skip files that haven't changed
        try {
          const old = fs.statSync(b);
          if (old.size === st.size && old.mtimeMs >= st.mtimeMs) continue;
        } catch {
          /* new file */
        }
        if (base) noLinks(base, b);
        ensureDir(path.dirname(b));
        fs.copyFileSync(a, b);
      }
    }
  };
  walk(from, to);
  return used;
}

// Write the project's copy into its folder now.
export function saveProject(id: string): SaveStatus | null {
  const p = listProjects().find((x) => x.id === id);
  if (!p || !exists(p.brainPath)) return null;
  try {
    const out = path.join(p.brainPath, DIR);
    noLinks(out, out);
    ensureDir(out);
    const agents = readAll<Agent>(projectDir(id, 'agents'));
    const teams = readAll<Team>(projectDir(id, 'workflows'));
    const routines = readAll<Routine>(projectDir(id, 'routines'));
    const file = path.join(out, 'project.json');
    noLinks(out, file);
    // Fewer agents, teams or routines than last time: keep the old copy as a backup first (last 10 kept).
    const prev = readJSON<Partial<SavedProjectFile>>(file, null);
    if (prev && ((prev.agents || []).length > agents.length || (prev.teams || []).length > teams.length || (prev.routines || []).length > routines.length)) {
      const bdir = path.join(out, 'backups');
      const bfile = path.join(bdir, `project-${new Date(prev.savedAt || Date.now()).toISOString().replace(/[:.]/g, '-')}.json`);
      noLinks(out, bfile);
      ensureDir(bdir);
      fs.copyFileSync(file, bfile);
      const old = fs.readdirSync(bdir).filter((n) => n.endsWith('.json')).sort();
      for (const n of old.slice(0, Math.max(0, old.length - 10))) fs.rmSync(path.join(bdir, n), { force: true });
    }
    writeJSON<SavedProjectFile>(file, {
      format: FORMAT,
      app: 'my-dashboard',
      savedAt: Date.now(),
      project: { name: p.name, description: p.description || '', repo: p.repo || '', skills: p.skills || [], brainPath: p.brainPath },
      agents,
      teams,
      routines,
      layout: readPlain<unknown>(projectDir(id, 'layout.json'), {}),
      brainChat: readPlain<unknown>(projectDir(id, 'brain-chat.json'), { messages: [] }),
    });
    // team chat threads and the files you gave agents as knowledge (mirrored: what's deleted here goes there too)
    copyTree(projectDir(id, 'teamchats'), path.join(out, 'teamchats'), Infinity, { base: out, mirror: true });
    // agent chats: chats/<agent id>/<chat id>.json, the visible history plus the engine's memory (sessionId, llm)
    copyTree(projectDir(id, 'chats'), path.join(out, 'chats'), CHATS_CAP, { base: out, mirror: true });
    copyTree(projectDir(id, 'knowledge'), path.join(out, 'knowledge'), KNOWLEDGE_CAP, { base: out, mirror: true });
    // the teams' pictures and 3D models (team-marks/<team id>.<ext>)
    copyTree(projectDir(id, 'team-marks'), path.join(out, 'team-marks'), MARKS_CAP, { base: out, mirror: true });
    // memory/<agent id or "brain">/MEMORY.md
    copyTree(projectDir(id, 'memory'), path.join(out, 'memory'), MEMORY_CAP, { base: out, mirror: true });
    // the kept versions of agents, teams and memories (and of deleted ones, so they can be brought back there too)
    let left = VERSIONS_CAP;
    for (const kind of VERSIONED) left -= copyTree(projectDir(id, 'versions', kind), path.join(out, 'versions', kind), left, { base: out, mirror: true });
    if (exists(path.join(out, 'versions'))) prune(path.join(out, 'versions'), new Set(VERSIONED), out);
    // the skills the project uses, with their files and versions (skills it stopped using are dropped)
    const used = skillsUsed(id);
    let skillBudget = SKILLS_CAP;
    for (const slug of used) {
      skillBudget -= copyTree(skillDir(slug), path.join(out, 'skills', slug), skillBudget, { base: out, mirror: true });
      skillBudget -= copyTree(skillVersionsDir(slug), path.join(out, 'skill-versions', slug), skillBudget, { base: out, mirror: true });
    }
    for (const sub of ['skills', 'skill-versions']) if (exists(path.join(out, sub))) prune(path.join(out, sub), new Set(used), out);
    saveWorldCopy(p, out);
    noLinks(out, path.join(out, 'README.txt'));
    fs.writeFileSync(
      path.join(out, 'README.txt'),
      'Blacksite keeps this project\'s agents, teams, chats, knowledge, memories (MEMORY.md), the skills it uses and their earlier versions here (auto-saved).\nOpen this folder as a project in the dashboard ("Open a folder…") to load them again.\nNo keys or passwords are stored here.\n',
    );
    saved.set(id, { at: Date.now(), agents: agents.length, teams: teams.length });
    return saved.get(id) ?? null;
  } catch (e) {
    saved.set(id, { at: Date.now(), error: (e as Error).message });
    return saved.get(id) ?? null;
  }
}

const firstAsk = new Map<string, number>();
export function saveSoon(id: string = activeProject().id, ms = 2500) {
  // keep pushing the save back while things change, but never more than 15 s
  if (!firstAsk.has(id)) firstAsk.set(id, Date.now());
  const wait = Math.max(0, Math.min(ms, firstAsk.get(id)! + 15_000 - Date.now()));
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      firstAsk.delete(id);
      saveProject(id);
    }, wait),
  );
}

export function saveStatus(id: string = activeProject().id): SaveStatus | null {
  return saved.get(id) || null;
}

// Saved data is only read from inside <folder>/.dashboard itself. A link anywhere on the way (the
// .dashboard folder, chats/, an agent's folder or a file) could point at files elsewhere on the PC, so
// this gives the real location when it is inside, else null.
function savedPath(folder: string, ...parts: string[]): string | null {
  const base = realTarget(folder);
  if (!base) return null;
  const dash = path.join(base, DIR);
  const real = realTarget(path.join(folder, DIR, ...parts));
  return real && (real === dash || real.startsWith(dash + path.sep)) ? real : null;
}

function readSaved(folder: string): Partial<SavedProjectFile> | null {
  const f = savedPath(folder, 'project.json');
  const j = f && exists(f) ? readJSON<Partial<SavedProjectFile>>(f, null) : null;
  return j && j.app === 'my-dashboard' ? j : null;
}

// What a folder holds, if it was saved by the dashboard.
export function peek(folder: string): ProjectPeek | null {
  const j = readSaved(folder);
  if (!j) return null;
  return { name: j.project?.name || '', description: j.project?.description || '', agents: (j.agents || []).length, teams: (j.teams || []).length, savedAt: j.savedAt || 0 };
}

// Load a saved copy into a project that has no agents yet (a folder you just opened).
export function restoreInto(id: string, folder: string): RestoreResult | null {
  const j = readSaved(folder);
  if (!j) return null;
  if (jsonFiles(projectDir(id, 'agents')).length) return null; // never overwrite a project that has agents
  const safe = (x: { id?: unknown } | null | undefined) => typeof x?.id === 'string' && /^[\w.-]+$/.test(x.id);
  // folders inside the folder it was saved from are this folder's now (a copy mustn't work in the original)
  const move = movedAgent(j.project?.brainPath, folder);
  for (const a of (j.agents || []).filter(safe)) writeJSON(projectDir(id, 'agents', `${a.id}.json`), move(a));
  for (const t of (j.teams || []).filter(safe)) writeJSON(projectDir(id, 'workflows', `${t.id}.json`), t);
  for (const r of (j.routines || []).filter(safe)) writeJSON(projectDir(id, 'routines', `${r.id}.json`), r);
  if (j.layout) writeJSON(projectDir(id, 'layout.json'), j.layout);
  if (j.brainChat) writeJSON(projectDir(id, 'brain-chat.json'), j.brainChat);
  for (const n of jsonFiles(savedPath(folder, 'teamchats') || '')) {
    const src = savedPath(folder, 'teamchats', n);
    if (!src || !fs.lstatSync(src).isFile()) continue;
    ensureDir(projectDir(id, 'teamchats'));
    fs.copyFileSync(src, projectDir(id, 'teamchats', n));
  }
  // (copyTree skips links below this folder: a linked file or folder isn't a plain file or folder)
  const knowledge = savedPath(folder, 'knowledge');
  if (knowledge) copyTree(knowledge, projectDir(id, 'knowledge'), KNOWLEDGE_CAP * 4);
  const marks = savedPath(folder, 'team-marks');
  if (marks) copyTree(marks, projectDir(id, 'team-marks'), MARKS_CAP * 2);
  restoreMemory(folder, id);
  const chatCount = restoreChats(folder, id, (j.agents || []).filter(safe).map((a) => a.id as string));
  const versionCount = restoreVersions(folder, id, move);
  const skills = restoreSkills(folder, j.project?.name || path.basename(folder));
  restoreWorld(folder, id);
  log('project', `Loaded ${(j.agents || []).length} agents, ${(j.teams || []).length} teams, ${chatCount} chats, ${skills.added.length} skills and ${versionCount} earlier versions from ${folder}`);
  return { agents: (j.agents || []).length, teams: (j.teams || []).length, chats: chatCount, versions: versionCount, skills, project: j.project || {} };
}

// An agent's workspace and knowledge folders inside the folder it was saved from (from), moved to the same
// place in this one (to). Folders elsewhere stay as they are.
function movedAgent(from: string | undefined, to: string): (a: Agent) => Agent {
  if (!from) return (a) => a;
  const move = (p: unknown) => (typeof p === 'string' && p ? (rebase(p, from, to) ?? p) : p);
  return (a) => {
    const out: Agent = { ...a };
    if (typeof out.workspace === 'string' && out.workspace) out.workspace = String(move(out.workspace));
    if (out.knowledge && Array.isArray(out.knowledge.folders)) out.knowledge = { ...out.knowledge, folders: out.knowledge.folders.map((f) => String(move(f))) };
    return out;
  };
}

// A fresh data folder (a new install, or the desktop app next to the browser version) makes a default project
// in the same "My workspace" folder an earlier one may have saved into. Load that copy first: the first auto-save
// would otherwise write the empty project over it and drop its skills and world.
export function adoptSavedFolder(id: string): RestoreResult | null {
  const p = listProjects().find((x) => x.id === id);
  const restored = p ? restoreInto(id, p.brainPath) : null;
  if (!restored) return null;
  const { description, skills } = restored.project;
  updateProject(id, {
    ...(!p?.description && typeof description === 'string' && description ? { description } : {}),
    ...(Array.isArray(skills) && skills.length ? { skills } : {}),
  });
  return restored;
}

// Versions saved in <folder>/.dashboard/<parts>/<item id>/: each checked to be a plain file inside the
// folder and a version (item checked by `check`), put back under the item and id it was saved as
// (whatever the file itself claims). Newest first, at most VERSIONS_KEPT.
function savedVersions<T>(folder: string, parts: string[], itemId: string, check: (item: Record<string, unknown>) => T | null): Version<T>[] {
  const dir = savedPath(folder, ...parts, itemId);
  if (!dir) return [];
  const out: Version<T>[] = [];
  for (const name of jsonFiles(dir)) {
    const vid = name.slice(0, -'.json'.length);
    const file = savedPath(folder, ...parts, itemId, name);
    if (!/^[\w-]+$/.test(vid) || !file || !fs.lstatSync(file).isFile()) continue;
    const v = checkVersion(readJSON<unknown>(file, null), vid, check);
    if (v) out.push(v);
  }
  return out.sort((a, b) => b.at - a.at).slice(0, VERSIONS_KEPT);
}

// Folder names in <folder>/.dashboard/<parts> that are real folders inside it.
function savedDirs(folder: string, parts: string[], ok: (name: string) => boolean): string[] {
  const root = savedPath(folder, ...parts);
  if (!root) return [];
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && ok(e.name) && savedPath(folder, ...parts, e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// The kept versions of agents and teams. Versions of agents and teams that were deleted come back too:
// they show in Recently deleted.
function restoreVersions(folder: string, id: string, move: (a: Agent) => Agent): number {
  let n = 0;
  for (const kind of VERSIONED) {
    for (const itemId of savedDirs(folder, ['versions', kind], (x) => /^[\w.-]+$/.test(x) && !x.startsWith('.'))) {
      const agentVersion = (item: Record<string, unknown>) => {
        const a = cleanAgentVersion(item, itemId);
        return a ? move(a as unknown as Agent) : null;
      };
      const check = (item: Record<string, unknown>) => (kind === 'agents' ? agentVersion(item) : kind === 'workflows' ? cleanTeamVersion(item, itemId) : isMemoryOwner(itemId) ? cleanMemoryVersion(item, itemId) : null);
      for (const v of savedVersions<unknown>(folder, ['versions', kind], itemId, check)) {
        writeJSON(projectDir(id, 'versions', kind, itemId, `${v.id}.json`), v);
        n++;
      }
    }
  }
  return n;
}

// Each saved MEMORY.md (the Brain's and every agent's): a plain file inside the folder, put back under
// the owner it was saved as.
function restoreMemory(folder: string, id: string): number {
  let n = 0;
  for (const owner of savedDirs(folder, ['memory'], isMemoryOwner)) {
    const file = savedPath(folder, 'memory', owner, MEMORY_FILE);
    if (!file || !exists(file)) continue;
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MEMORY_MAX * 4) continue;
    if (putMemory(id, owner, fs.readFileSync(file, 'utf8'))) n++;
  }
  return n;
}

// ---------- skills ----------
// Skills live in one library for every project, so a project folder carries the ones its project uses:
// given to the project, a team or an agent, or mentioned in a routine.
function skillsUsed(id: string): string[] {
  return skillRefs(id).filter((slug) => getSkill(slug));
}
// Every skill the project names (whether or not it still exists).
function skillRefs(id: string): string[] {
  const p = listProjects().find((x) => x.id === id);
  const slugs = [
    ...(p?.skills || []),
    ...readAll<Agent>(projectDir(id, 'agents')).flatMap((a) => a.skills || []),
    ...readAll<Team>(projectDir(id, 'workflows')).flatMap((t) => t.skills || []),
    ...readAll<Routine>(projectDir(id, 'routines')).flatMap((r) => (r.mentions || []).filter((m) => m.kind === 'skill').map((m) => m.id)),
  ];
  return [...new Set(slugs)].filter((slug) => isSkillSlug(slug));
}

// A skill changed (or several, or was deleted): every project that uses it, or has a copy of it in its
// folder, saves again, not only the open one (skills are shared by all projects).
export function projectsWithSkills(slugs: string[]): string[] {
  return listProjects()
    .filter((p) => {
      const refs = skillRefs(p.id);
      return slugs.some((slug) => refs.includes(slug) || exists(path.join(p.brainPath, DIR, 'skills', slug)));
    })
    .map((p) => p.id);
}

// Skills the library doesn't have yet are added (with their files and versions). One it has is never
// changed: when the folder's copy is different, that copy is kept as one of its versions, to restore by hand.
function restoreSkills(folder: string, projectName: string): { added: string[]; kept: string[] } {
  const added: string[] = [];
  const kept: string[] = [];
  let budget = SKILLS_CAP * 4;
  for (const slug of savedDirs(folder, ['skills'], isSkillSlug)) {
    const src = savedPath(folder, 'skills', slug);
    const md = savedPath(folder, 'skills', slug, 'SKILL.md');
    if (!src || !md || !exists(md) || !fs.lstatSync(md).isFile()) continue;
    const have = getSkill(slug);
    if (have) {
      // the same when its SKILL.md and its extra files are (links in the folder's copy are skipped)
      const theirs: SkillVersionItem = { ...skillFromText(fs.readFileSync(md, 'utf8').slice(0, SKILL_BODY_MAX * 2), slug), files: skillExtraFiles(src), filesHash: skillFilesHash(src) };
      const ours: SkillVersionItem = { slug, name: have.name, description: have.description, body: have.body.trim(), files: skillExtraFiles(skillDir(slug)), filesHash: skillFilesHash(skillDir(slug)) };
      if (canonical(theirs, ['files']) === canonical(ours, ['files'])) continue;
      const v = withActor('you', () => keepVersion(skillVersionsDir(slug), theirs, ours), { force: true, note: `the copy saved in the project "${projectName}"` });
      // its files go with it, so restoring it brings them
      if (v && theirs.files?.length) copySkillFiles(src, versionFilesDir(skillVersionsDir(slug), v.id));
      kept.push(have.name);
      continue;
    }
    // (copyTree skips links below the skill's folder)
    budget -= copyTree(src, skillDir(slug), budget);
    if (!getSkill(slug)) {
      fs.rmSync(skillDir(slug), { recursive: true, force: true });
      continue;
    }
    for (const v of savedVersions(folder, ['skill-versions'], slug, skillVersionItem(slug))) {
      writeJSON(path.join(skillVersionsDir(slug), `${v.id}.json`), v);
      // and the files kept with it (a deleted version's)
      const files = savedPath(folder, 'skill-versions', slug, `files-${v.id}`);
      if (files && exists(files) && fs.lstatSync(files).isDirectory()) budget -= copyTree(files, versionFilesDir(skillVersionsDir(slug), v.id), budget);
    }
    added.push(getSkill(slug)!.name);
  }
  if (added.length) log('skill', `Added ${added.length} skill${added.length === 1 ? '' : 's'} from the project folder: ${added.join(', ')}`);
  return { added, kept };
}

// The saved chats of the restored agents. Each is checked to be a plain file inside the folder and a
// chat, and is put back under the agent and id it was saved as (whatever the file itself claims).
function restoreChats(folder: string, id: string, agentIds: string[]): number {
  let n = 0;
  for (const agentId of agentIds) {
    if (!/^[\w-]+$/.test(agentId)) continue;
    const dir = savedPath(folder, 'chats', agentId);
    if (!dir) continue;
    for (const name of jsonFiles(dir)) {
      const chatId = name.slice(0, -'.json'.length);
      const file = savedPath(folder, 'chats', agentId, name);
      if (!/^[\w-]+$/.test(chatId) || !file || !fs.lstatSync(file).isFile()) continue;
      const c = readJSON<Partial<Chat>>(file, null);
      if (!c || !Array.isArray(c.items)) continue;
      const { _deleted, ...chat } = c;
      writeJSON(projectDir(id, 'chats', agentId, name), { ...chat, id: chatId, agentId });
      n++;
    }
  }
  return n;
}

// ---------- the voxel world ----------
// <folder>/.dashboard/world/: the world the project uses (its voxels, WORLD.md and its versions; the undo
// history stays in the data folder), and link.json saying how the project uses it.
const WORLD_PARTS = ['world.json', 'WORLD.md', 'objects', 'prefabs', 'versions', 'link.json'];
function saveWorldCopy(p: Project, out: string): void {
  const dst = path.join(out, 'world');
  const w = p.world ? getWorld(p.world.id) : null;
  noLinks(out, dst);
  if (!w || !p.world) {
    fs.rmSync(dst, { recursive: true, force: true });
    return;
  }
  ensureDir(dst);
  let left = WORLD_CAP;
  for (const sub of ['objects', 'prefabs', path.join('versions', 'world-md')]) left -= copyTree(worldDir(w.id, sub), path.join(dst, sub), left, { base: out, mirror: true });
  for (const f of ['world.json', 'WORLD.md']) {
    const src = worldDir(w.id, f);
    const to = path.join(dst, f);
    noLinks(out, to);
    if (fs.existsSync(src) && fs.lstatSync(src).isFile()) fs.copyFileSync(src, to);
    else fs.rmSync(to, { force: true });
  }
  noLinks(out, path.join(dst, 'link.json'));
  writeJSON(path.join(dst, 'link.json'), { id: w.id, mode: p.world.mode, name: w.name });
  prune(dst, new Set(WORLD_PARTS), out);
}

/** The world saved in a folder: linked again when this PC has it, else made again from the files. */
function restoreWorld(folder: string, id: string): boolean {
  const file = savedPath(folder, 'world', 'world.json');
  const saved = file ? readPlain<Partial<VoxelWorld> | null>(file, null) : null;
  if (!saved || typeof saved.id !== 'string' || !WORLD_ID.test(saved.id)) return false;
  const fromFiles = (wid: string) => {
    for (const sub of ['objects', 'prefabs']) {
      const from = savedPath(folder, 'world', sub);
      if (from) copyTree(from, worldDir(wid, sub), WORLD_CAP * 2);
    }
    const versions = savedPath(folder, 'world', 'versions', 'world-md');
    if (versions) copyTree(versions, worldDir(wid, 'versions', 'world-md'), WORLD_CAP);
    const md = savedPath(folder, 'world', 'WORLD.md');
    if (md && fs.lstatSync(md).isFile() && fs.statSync(md).size <= WORLD_MD_MAX * 2) fs.copyFileSync(md, worldDir(wid, 'WORLD.md'));
    writeJSON(worldDir(wid, 'world.json'), { ...saved, id: wid, homeProject: id });
  };
  const linkFile = savedPath(folder, 'world', 'link.json');
  const wasShared = (linkFile ? readPlain<{ mode?: unknown } | null>(linkFile, null) : null)?.mode === 'shared';
  const wid = saved.id;
  if (!getWorld(wid)) {
    fromFiles(wid);
    setLink(id, { id: wid, mode: 'own' });
  } else if (!usedBy(wid).some((x) => x !== id)) setLink(id, { id: wid, mode: 'own' });
  else if (wasShared) setLink(id, { id: wid, mode: 'shared' });
  else {
    // another project here builds in that world, and this one had it as its own (the same folder opened
    // twice, or a copy of it): it gets its own world from the files, so the two don't build in each other's
    const fresh = uid('w');
    fromFiles(fresh);
    setLink(id, { id: fresh, mode: 'own' });
  }
  return true;
}

// Save after anything in the project changes.
const WATCH = new Set(['agents', 'workflows', 'routines', 'layout', 'team', 'knowledge', 'memory', 'brain-chat', 'chats', 'skills']);
export function startAutoSave() {
  const fresh = takeNewDefaultProject();
  if (fresh) adoptSavedFolder(fresh.id);
  bus.on('event', (ev) => {
    // an event that names its project (an agent chat) saves that one, even if another is open now
    if ((ev.type === 'world' || ev.type === 'world-md') && typeof ev.world === 'string') {
      // a world can be shared: every project using it saves
      for (const id of new Set([activeProject().id, ...usedBy(ev.world)])) saveSoon(id);
    } else if (ev.type === 'skills') {
      const slugs = [ev.slug, ...(Array.isArray(ev.installed) ? ev.installed : [])].filter((x): x is string => typeof x === 'string');
      for (const id of new Set([activeProject().id, ...projectsWithSkills(slugs)])) saveSoon(id);
    } else if (WATCH.has(ev.type)) saveSoon(typeof ev.project === 'string' ? ev.project : activeProject().id);
    else if (ev.type === 'project') saveSoon(activeProject().id, 500);
  });
  // and every 5 minutes, for anything that changed without an event (e.g. knowledge files)
  setInterval(() => saveProject(activeProject().id), 5 * 60_000).unref?.();
  // first save for every project, so each folder has its copy
  setTimeout(() => {
    for (const p of listProjects()) saveProject(p.id);
  }, 4000);
}
