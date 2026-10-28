// Backups: one file with everything in a project (agents, teams, routines, layout, chats, knowledge
// files, MEMORY.md files, logo, PROJECT.md and notes, its voxel world, and the kept versions of its agents, teams and memories) plus every skill in
// the library with its versions, every saved preset and the prefab library. Written
// to <home>/Blacksite Backups on Windows, macOS and Linux. Drop one into "New project > From
// backup" to get it all back as a new project, here or on another PC. Keys and tokens are never in it.
//
// The file: a first line naming the format, a second line with a short JSON summary (so the page can
// show what's inside without reading it all), then the full backup as gzipped JSON.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { HOME, IS_WIN, dataPath, ensureDir, exists, insideRoots, isPlainDir, readJSON, readPlain, realTarget, slugify, writeJSON } from './util.ts';
import { listProjects, emit, log } from './store.ts';
import { createProject, projectsRoot, removeProject, setLogo, updateProject } from './projects.ts';
import { isSkillSlug, skillsLibrary, skillDir, skillVersionsDir, skillVersionItem } from './skills.ts';
import { checkVersion, listVersions, pruneVersions, versionFilesDir, cleanAgentVersion, cleanTeamVersion } from './versions.ts';
import type { Version } from './versions.ts';
import { cleanMemoryVersion, isMemoryOwner, putMemory } from './memory.ts';
import type { Preset } from './presets.ts';
import { getWorld, newWorld, worldDir } from './voxel/store.ts';
import { setLink } from './voxel/link.ts';
import { libraryEntries, putLibraryEntry } from './voxel/prefabs.ts';
import type { LibraryPrefab } from './voxel/prefabs.ts';
import type { Agent, Chat, Project, Routine, Team, VoxelWorld } from '../shared/types.ts';

export const BACKUP_EXT = '.dashbackup';
const MAGIC = 'MY-DASHBOARD-BACKUP';
const FORMAT = 1;
const HEAD_MAX = 64 * 1024; // the two header lines fit in this
const UNPACKED_MAX = 512 * 1024 * 1024; // the most a backup may unpack to (about the largest string JSON can read)
/** The biggest backup file accepted (it is gzipped, so never bigger than what it unpacks to). */
export const BACKUP_MAX = UNPACKED_MAX;

// How much of each kind is packed at most (the same limits as the auto-save into the project folder).
// A file that doesn't fit any more is left out and counted (BackupSummary.omitted). Keep docs/guide.md in step.
const CAP = { knowledge: 50 * 1024 * 1024, chats: 200 * 1024 * 1024, brain: 20 * 1024 * 1024, memory: 20 * 1024 * 1024, skills: 50 * 1024 * 1024, versions: 50 * 1024 * 1024, world: 300 * 1024 * 1024, library: 100 * 1024 * 1024, marks: 100 * 1024 * 1024 };
// A kept version in a backup: <kind>/<item id>/<version id>.json, and a skill version's files under
// skills/<slug>/files-<version id>/. Agents and teams are the project's; skills are the library's
// (deleted ones too, so Recently deleted comes back).
const VERSION_FILE = /^(agents|teams|memory|skills)\/[^/]+\/[\w-]+\.json$/;
// A file of the voxel world in a backup: its meta, WORLD.md, an object's voxels or a WORLD.md version
const WORLD_FILE = /^(world\.json|WORLD\.md|(objects|prefabs)\/[\w-]+\.json|versions\/world-md\/[\w-]+\.json)$/;
// the folders those are in
const WORLD_DIR = /^(objects|prefabs|versions|versions\/world-md)$/;
// A MEMORY.md in a backup: <agent id or "brain">/MEMORY.md
const MEMORY_PATH = /^([^/]+)\/MEMORY\.md$/;
// Files from the project folder that go in: the brief and the notes, not the whole folder (it can be a big repo)
const BRAIN_FILES = ['PROJECT.md', 'BRAIN.md'];
const BRAIN_DIRS = ['notes'];
const LOGO_RE = /^logo\.(png|jpg|webp|gif)$/;
const ID_RE = /^[\w.-]+$/;
const CHAT_ID_RE = /^[\w-]+$/;
const PRESET_RE = /^p[at][\w-]+$/;
// A team's picture or 3D model: team-marks/<team id>.<ext> (see teammark.ts)
const MARK_RE = /^([\w.-]+)\.(png|jpg|jpeg|webp|gif|glb|gltf|obj|stl|ply|fbx)$/;

/** Where backups are written: a folder in your home folder. */
export const backupsRoot = (): string => {
  const dir = path.join(HOME, 'Blacksite Backups');
  if (!movedOld) {
    movedOld = true;
    // Backups made before the app was called Blacksite: bring the whole folder along, once
    const old = path.join(HOME, 'My Dashboard Backups');
    try {
      if (exists(old) && !exists(dir)) fs.renameSync(old, dir);
    } catch {
      /* in use or not allowed: new backups still go to the new folder */
    }
  }
  return dir;
};
let movedOld = false;

/** A file inside the backup, its bytes as base64. path uses "/" on every OS. */
export interface PackedFile {
  path: string;
  data: string;
}

/** What the second line of a backup file says: shown before restoring. */
export interface BackupSummary {
  app: string;
  format: number;
  createdAt: number;
  name: string;
  description: string;
  agents: number;
  teams: number;
  routines: number;
  chats: number;
  skills: number;
  presets: number;
  /** prefabs in the prefab library, shared by every project (older backups: missing) */
  libraryPrefabs?: number;
  knowledgeFiles: number;
  /** MEMORY.md files of agents and the Brain (older backups: missing) */
  memories?: number;
  /** Kept versions of agents, teams and skills (older backups: missing) */
  versions?: number;
  /** The first few agents, to recognise the backup by */
  agentList: { name: string; emoji: string }[];
  /** Files left out because their kind's size limit was reached */
  omitted: number;
}

/** The whole backup (the gzipped part). */
export interface BackupData {
  app: string;
  kind: 'workspace-backup';
  format: number;
  createdAt: number;
  project: { name: string; description: string; repo: string; skills: string[]; brainPath: string };
  agents: Agent[];
  teams: Team[];
  routines: Routine[];
  layout: unknown;
  brainChat: unknown;
  teamChats: { name: string; data: unknown }[];
  chats: { agentId: string; chat: Chat }[];
  knowledge: PackedFile[];
  /** MEMORY.md files (see MEMORY_PATH). Older backups: empty. */
  memory: PackedFile[];
  brain: PackedFile[];
  logo: PackedFile | null;
  skills: { slug: string; files: PackedFile[] }[];
  /** Kept versions (see VERSION_FILE). Older backups: empty. */
  versions: PackedFile[];
  presets: Preset[];
  /** The voxel world the project uses (WORLD_FILE paths). Older backups: null. */
  world: { name: string; files: PackedFile[] } | null;
  /** The teams' pictures and 3D models (MARK_RE names). Older backups: missing. */
  teamMarks?: PackedFile[];
  /** The prefab library (every project's), like the presets. Older backups: empty. */
  prefabLibrary: LibraryPrefab[];
  /** Files left out because their kind's size limit was reached (see CAP) */
  omitted: number;
}

/** A backup file in the backups folder. */
export interface BackupListing {
  name: string;
  size: number;
  modifiedAt: number;
  summary: BackupSummary | null;
}

export interface BackupResult {
  file: string;
  name: string;
  size: number;
  summary: BackupSummary;
}

export interface BackupRestoreResult {
  agents: number;
  teams: number;
  routines: number;
  chats: number;
  knowledgeFiles: number;
  /** MEMORY.md files brought back */
  memories: number;
  brainFiles: number;
  /** skills added to the library; already there and the same; already there but different, so added under a new id */
  skills: { added: number; same: number; renamed: { from: string; to: string }[] };
  presets: { added: number; same: number };
  /** prefab library entries added; already there */
  libraryPrefabs: { added: number; same: number };
  /** kept versions brought back (agents, teams and skills) */
  versions: number;
  /** routines and teams that ran on a schedule: paused, so a copy doesn't run them twice */
  paused: number;
  logo: boolean;
}

// ---------- packing ----------
const projectDir = (id: string, ...p: string[]) => dataPath('projects', id, ...p);
// Plain .json files only: a link could point at data/secrets.json or anything else on the PC
// (and only in a folder that isn't a link itself: that would list a folder elsewhere)
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

/** Every plain file under dir (links are skipped), until budget bytes are used. */
/** What is left of a kind's size limit, and how many files didn't fit. */
interface Budget {
  left: number;
  omitted: number;
}
const budget = (left: number): Budget => ({ left, omitted: 0 });

/** `keep`: which files and folders (paths from `dir`) go in; the rest isn't read or counted. */
function packTree(dir: string, budget: Budget, prefix = '', keep?: (rel: string, isDir: boolean) => boolean): PackedFile[] {
  const out: PackedFile[] = [];
  // a linked folder is left out like a linked file (below the top, readdir's entries already say so)
  if (!isPlainDir(dir)) return out;
  const walk = (d: string, rel: string) => {
    let list: fs.Dirent[] = [];
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(d, e.name);
      if (keep && !keep(r, e.isDirectory())) continue;
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          continue;
        }
        if (size > budget.left) {
          budget.omitted++;
          continue;
        }
        budget.left -= size;
        out.push({ path: prefix + r, data: fs.readFileSync(full).toString('base64') });
      }
    }
  };
  walk(dir, '');
  return out;
}

function packChats(id: string, budget: Budget): BackupData['chats'] {
  const out: BackupData['chats'] = [];
  const root = projectDir(id, 'chats');
  if (!isPlainDir(root)) return out;
  let agentDirs: fs.Dirent[] = [];
  try {
    agentDirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && CHAT_ID_RE.test(e.name));
  } catch {
    return out;
  }
  for (const a of agentDirs) {
    for (const n of jsonFiles(path.join(root, a.name))) {
      const file = path.join(root, a.name, n);
      let size = 0;
      try {
        const st = fs.lstatSync(file);
        if (!st.isFile()) continue;
        size = st.size;
      } catch {
        continue;
      }
      if (size > budget.left) {
        budget.omitted++;
        continue;
      }
      const chat = readJSON<Chat>(file);
      if (!chat || !Array.isArray(chat.items)) continue;
      budget.left -= size;
      out.push({ agentId: a.name, chat });
    }
  }
  return out;
}

function summarize(b: BackupData): BackupSummary {
  return {
    app: 'my-dashboard',
    format: FORMAT,
    createdAt: b.createdAt,
    name: b.project.name,
    description: b.project.description.slice(0, 1000),
    agents: b.agents.length,
    teams: b.teams.length,
    routines: b.routines.length,
    chats: b.chats.length,
    skills: b.skills.length,
    presets: b.presets.length,
    libraryPrefabs: b.prefabLibrary.length,
    knowledgeFiles: b.knowledge.length,
    memories: b.memory.length,
    versions: b.versions.filter((f) => VERSION_FILE.test(f.path)).length,
    omitted: b.omitted,
    agentList: b.agents.slice(0, 12).map((a) => ({ name: String(a.name || '').slice(0, 80), emoji: String(a.emoji || '🤖').slice(0, 8) })),
  };
}

/** Everything in the project, the skill library and the saved presets, as one object. */
export function packProject(p: Project): BackupData {
  const id = p.id;
  const brainBudget = budget(CAP.brain);
  const brain: PackedFile[] = [];
  for (const f of BRAIN_FILES) {
    const full = path.join(p.brainPath, f);
    try {
      const st = fs.lstatSync(full);
      if (st.isFile() && st.size > brainBudget.left) brainBudget.omitted++;
      else if (st.isFile()) {
        brainBudget.left -= st.size;
        brain.push({ path: f, data: fs.readFileSync(full).toString('base64') });
      }
    } catch {
      /* not there */
    }
  }
  for (const d of BRAIN_DIRS) {
    const full = path.join(p.brainPath, d);
    try {
      if (fs.lstatSync(full).isDirectory()) brain.push(...packTree(full, brainBudget, `${d}/`));
    } catch {
      /* not there */
    }
  }
  let logo: PackedFile | null = null;
  for (const ext of ['png', 'jpg', 'webp', 'gif']) {
    const f = path.join(p.brainPath, '.dashboard', `logo.${ext}`);
    try {
      if (fs.lstatSync(f).isFile()) {
        logo = { path: `logo.${ext}`, data: fs.readFileSync(f).toString('base64') };
        break;
      }
    } catch {
      /* none */
    }
  }
  const skillBudget = budget(CAP.skills);
  const skills: BackupData['skills'] = [];
  for (const e of fs.readdirSync(skillsLibrary(), { withFileTypes: true })) {
    if (!e.isDirectory() || !isSkillSlug(e.name)) continue;
    const files = packTree(path.join(skillsLibrary(), e.name), skillBudget);
    if (files.some((f) => f.path === 'SKILL.md')) skills.push({ slug: e.name, files });
  }
  // the kept versions: the project's agents and teams, and every skill's
  const versionBudget = budget(CAP.versions);
  const versions = [
    ...packTree(projectDir(id, 'versions', 'agents'), versionBudget, 'agents/'),
    ...packTree(projectDir(id, 'versions', 'workflows'), versionBudget, 'teams/'),
    ...packTree(projectDir(id, 'versions', 'memory'), versionBudget, 'memory/'),
    ...packTree(skillVersionsDir(), versionBudget, 'skills/'),
  ];
  const chatBudget = budget(CAP.chats);
  const knowledgeBudget = budget(CAP.knowledge);
  const chats = packChats(id, chatBudget);
  const knowledge = packTree(projectDir(id, 'knowledge'), knowledgeBudget);
  const memoryBudget = budget(CAP.memory);
  const memory = packTree(projectDir(id, 'memory'), memoryBudget).filter((f) => MEMORY_PATH.test(f.path));
  // the voxel world (not its undo history)
  const worldBudget = budget(CAP.world);
  const w = p.world ? getWorld(p.world.id) : null;
  // world.json and WORLD.md first, so big voxels can't crowd them out; the undo history isn't read at all
  const top = (r: string) => r === 'world.json' || r === 'WORLD.md';
  const world = w
    ? {
        name: w.name,
        files: [...packTree(worldDir(w.id), worldBudget, '', (r, dir) => !dir && top(r)), ...packTree(worldDir(w.id), worldBudget, '', (r, dir) => (dir ? WORLD_DIR.test(r) : WORLD_FILE.test(r) && !top(r)))],
      }
    : null;
  // the prefab library: shared by every project, so every backup carries it (like the presets), up to its cap
  let libraryLeft = CAP.library;
  let libraryOmitted = 0;
  const prefabLibrary = libraryEntries().filter((e) => {
    const size = JSON.stringify(e).length;
    if (size > libraryLeft) return (libraryOmitted++, false);
    libraryLeft -= size;
    return true;
  });
  const marksBudget = budget(CAP.marks);
  const teamMarks = packTree(projectDir(id, 'team-marks'), marksBudget, '', (r, dir) => !dir && MARK_RE.test(r));
  const presets = jsonFiles(dataPath('presets'))
    .map((n) => readJSON<Preset>(dataPath('presets', n)))
    .filter((x): x is Preset => !!x && PRESET_RE.test(String(x.id)));
  return {
    app: 'my-dashboard',
    kind: 'workspace-backup',
    format: FORMAT,
    createdAt: Date.now(),
    project: { name: p.name, description: p.description || '', repo: p.repo || '', skills: p.skills || [], brainPath: p.brainPath },
    agents: readAll<Agent>(projectDir(id, 'agents')),
    teams: readAll<Team>(projectDir(id, 'workflows')),
    routines: readAll<Routine>(projectDir(id, 'routines')),
    layout: readPlain<unknown>(projectDir(id, 'layout.json'), {}),
    brainChat: readPlain<unknown>(projectDir(id, 'brain-chat.json'), { messages: [] }),
    teamChats: jsonFiles(projectDir(id, 'teamchats')).map((name) => ({ name, data: readJSON<unknown>(projectDir(id, 'teamchats', name)) })).filter((x) => x.data != null),
    chats,
    knowledge,
    memory,
    brain,
    logo,
    skills,
    versions,
    presets,
    world,
    prefabLibrary,
    teamMarks,
    omitted: brainBudget.omitted + skillBudget.omitted + chatBudget.omitted + knowledgeBudget.omitted + memoryBudget.omitted + versionBudget.omitted + worldBudget.omitted + libraryOmitted + marksBudget.omitted,
  };
}

/** The bytes of a backup file. */
export function encodeBackup(b: BackupData): Buffer {
  const head = `${MAGIC} ${FORMAT}\n${JSON.stringify(summarize(b))}\n`;
  return Buffer.concat([Buffer.from(head, 'utf8'), zlib.gzipSync(JSON.stringify(b))]);
}

const stamp = (t: number) => {
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
};

/** Back up a project into the backups folder. */
export function createBackup(id: string): BackupResult {
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new Error('No such project.');
  const b = packProject(p);
  const bytes = encodeBackup(b);
  const dir = ensureDir(backupsRoot());
  const base = `${slugify(p.name)}-${stamp(b.createdAt)}`;
  let name = `${base}${BACKUP_EXT}`;
  for (let i = 2; exists(path.join(dir, name)); i++) name = `${base}-${i}${BACKUP_EXT}`;
  const file = path.join(dir, name);
  // write next to it first, so a full disk never leaves half a backup with the real name
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
  const summary = summarize(b);
  log('project', `Backed up "${p.name}" (${summary.agents} agents, ${summary.teams} teams, ${summary.skills} skills) to ${file}`);
  return { file, name, size: bytes.length, summary };
}

/**
 * Checks a backup that was just written before anything is deleted because of it: the file is there, is not empty, is the size that was
 * written, reads back completely, and is of this project. Throws (saying nothing was deleted) when any of that is not so.
 */
export function verifyBackup(made: BackupResult, p: Pick<Project, 'name'>): void {
  let size: number;
  try {
    size = fs.statSync(made.file).size;
  } catch {
    throw new Error('The backup was not written, so nothing was deleted.');
  }
  if (size < 100 || size !== made.size) throw new Error('The backup is empty or incomplete, so nothing was deleted.');
  let data: BackupData;
  try {
    data = decodeBackup(fs.readFileSync(made.file));
  } catch (e) {
    throw new Error(`The backup could not be read back (${(e as Error).message}), so nothing was deleted.`);
  }
  if (data.project?.name !== p.name) throw new Error('The backup is not of this project, so nothing was deleted.');
}

/** The project's data in the dashboard (agents, teams, chats, Outbox, artifacts…) is moved here, not erased: data/_removed-<day>/. */
function setAsideProjectData(id: string): string {
  const from = dataPath('projects', id);
  if (!isPlainDir(from)) return '';
  const day = new Date().toISOString().slice(0, 10);
  const dir = ensureDir(dataPath(`_removed-${day}`));
  let to = path.join(dir, `project-${id}`);
  for (let i = 2; exists(to); i++) to = path.join(dir, `project-${id}-${i}`);
  fs.renameSync(from, to);
  return to;
}

/**
 * Delete a project, safely: back it up, check the backup, and only then remove it from the dashboard. Its dashboard data is set
 * aside (not erased) and its Brain folder on the PC is never touched. Returns the backup and where the data went.
 */
export function backupAndDeleteProject(id: string): { backup: BackupResult; setAside: string } {
  const list = listProjects();
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error('No such project.');
  if (list.length <= 1) throw new Error('Keep at least one project.');
  const made = createBackup(id);
  verifyBackup(made, p);
  removeProject(id);
  const setAside = setAsideProjectData(id);
  log('project', `Deleted the project "${p.name}" (backup ${made.file}${setAside ? `, its data set aside in ${setAside}` : ''})`);
  return { backup: made, setAside };
}

/** A copy of a project (its agents, teams, routines, notes, skills and chats; schedules start paused) as a new project. */
export async function cloneProject(id: string, name?: string): Promise<{ project: Project; restored: BackupRestoreResult }> {
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new Error('No such project.');
  const bytes = encodeBackup(packProject(p));
  return restoreBackup(bytes, { name: String(name || '').trim() || `${p.name} (copy)` });
}

// ---------- reading ----------
function splitHead(buf: Buffer): { summary: BackupSummary | null; body: number } | null {
  const end1 = buf.indexOf(0x0a);
  if (end1 < 0 || end1 > 100) return null;
  const m = new RegExp(`^${MAGIC} (\\d+)$`).exec(buf.toString('utf8', 0, end1).trim());
  if (!m) return null;
  if (Number(m[1]) > FORMAT) throw new Error('This backup was made by a newer version of the dashboard. Update it first.');
  const end2 = buf.indexOf(0x0a, end1 + 1);
  if (end2 < 0) return null;
  let summary: BackupSummary | null = null;
  try {
    summary = JSON.parse(buf.toString('utf8', end1 + 1, end2)) as BackupSummary;
  } catch {
    /* the summary is only for show */
  }
  return { summary, body: end2 + 1 };
}

/** What a backup holds, from its first lines only. */
export function readSummary(buf: Buffer): BackupSummary | null {
  try {
    return splitHead(buf)?.summary ?? null;
  } catch {
    return null;
  }
}

/** Unpack and check a backup. Throws with a plain message when it isn't one. */
export function decodeBackup(buf: Buffer): BackupData {
  const head = splitHead(buf);
  if (!head) throw new Error("That file isn't a dashboard backup.");
  let json: string;
  try {
    json = zlib.gunzipSync(buf.subarray(head.body), { maxOutputLength: UNPACKED_MAX }).toString('utf8');
  } catch (e) {
    throw new Error(/maxOutputLength|buffer|size/i.test(String((e as Error).message)) ? 'That backup is too big to open.' : 'That backup is damaged (it could not be unpacked).');
  }
  let b: Partial<BackupData>;
  try {
    b = JSON.parse(json) as Partial<BackupData>;
  } catch {
    throw new Error('That backup is damaged (it is not valid JSON inside).');
  }
  if (!b || b.app !== 'my-dashboard' || b.kind !== 'workspace-backup' || typeof b.project !== 'object' || !b.project) throw new Error("That file isn't a dashboard backup.");
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const files = (v: unknown): PackedFile[] => arr<PackedFile>(v).filter((f) => f && typeof f.path === 'string' && typeof f.data === 'string');
  const pr = b.project as Partial<BackupData['project']>;
  return {
    app: 'my-dashboard',
    kind: 'workspace-backup',
    format: Number(b.format) || FORMAT,
    createdAt: Number(b.createdAt) || 0,
    project: { name: String(pr.name || ''), description: String(pr.description || ''), repo: String(pr.repo || ''), skills: arr<unknown>(pr.skills).map(String), brainPath: String(pr.brainPath || '') },
    agents: arr<Agent>(b.agents).filter((a) => a && typeof a === 'object' && typeof a.id === 'string' && ID_RE.test(a.id)),
    teams: arr<Team>(b.teams).filter((t) => t && typeof t === 'object' && typeof t.id === 'string' && ID_RE.test(t.id)),
    routines: arr<Routine>(b.routines).filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && ID_RE.test(r.id)),
    layout: b.layout && typeof b.layout === 'object' ? b.layout : {},
    brainChat: b.brainChat && typeof b.brainChat === 'object' ? b.brainChat : { messages: [] },
    teamChats: arr<BackupData['teamChats'][number]>(b.teamChats).filter((c) => c && typeof c.name === 'string' && /^[\w.-]+\.json$/.test(c.name) && c.data != null),
    chats: arr<BackupData['chats'][number]>(b.chats).filter((c) => c && typeof c.agentId === 'string' && CHAT_ID_RE.test(c.agentId) && c.chat && typeof c.chat.id === 'string' && CHAT_ID_RE.test(c.chat.id) && Array.isArray(c.chat.items)),
    knowledge: files(b.knowledge),
    memory: files(b.memory).filter((f) => isMemoryOwner(MEMORY_PATH.exec(f.path)?.[1])),
    brain: files(b.brain),
    logo: b.logo && typeof b.logo.path === 'string' && LOGO_RE.test(b.logo.path) && typeof b.logo.data === 'string' ? b.logo : null,
    skills: arr<BackupData['skills'][number]>(b.skills)
      .filter((s) => s && isSkillSlug(s.slug))
      .map((s) => ({ slug: s.slug, files: files(s.files) }))
      .filter((s) => s.files.some((f) => f.path === 'SKILL.md')),
    versions: files(b.versions),
    presets: arr<Preset>(b.presets).filter((p) => p && typeof p === 'object' && PRESET_RE.test(String(p.id)) && (p.kind === 'agent' || p.kind === 'team')),
    prefabLibrary: arr<LibraryPrefab>(b.prefabLibrary).filter((e) => e && typeof e === 'object'),
    world: b.world && typeof b.world === 'object' && Array.isArray(b.world.files) ? { name: String(b.world.name || 'World').slice(0, 80), files: files(b.world.files).filter((f) => WORLD_FILE.test(f.path)) } : null,
    teamMarks: files(b.teamMarks).filter((f) => MARK_RE.test(f.path)),
    omitted: Number(b.omitted) || 0,
  };
}

/** The backups in the backups folder, newest first. */
export function listBackups(): BackupListing[] {
  const dir = backupsRoot();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(BACKUP_EXT));
  } catch {
    return [];
  }
  const out: BackupListing[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) continue;
      const fd = fs.openSync(file, 'r');
      const head = Buffer.alloc(Math.min(HEAD_MAX, st.size));
      try {
        fs.readSync(fd, head, 0, head.length, 0);
      } finally {
        fs.closeSync(fd);
      }
      out.push({ name, size: st.size, modifiedAt: st.mtimeMs, summary: readSummary(head) });
    } catch {
      /* unreadable: leave it out */
    }
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 50);
}

/** A backup in the backups folder, by file name only. */
export function readBackupFile(name: string): Buffer {
  const base = path.basename(String(name || ''));
  if (base !== name || !base.endsWith(BACKUP_EXT)) throw new Error('No such backup.');
  const file = insideRoots(path.join(backupsRoot(), base), [backupsRoot()]);
  if (!file || !exists(file)) throw new Error('No such backup.');
  if (fs.statSync(file).size > BACKUP_MAX) throw new Error('That backup is too big to open.');
  return fs.readFileSync(file);
}

// ---------- restoring ----------
/** root joined with a "/" path from a backup, or null when it would leave root (.., absolute, a link). */
function safeJoin(root: string, rel: string): string | null {
  if (!rel || rel.length > 500 || rel.includes('\0') || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) return null;
  const parts = rel.split(/[\\/]/);
  if (parts.some((x) => !x || x === '.' || x === '..')) return null;
  const out = path.join(root, ...parts);
  return insideRoots(out, [root]) ? out : null;
}

function writePacked(root: string, f: PackedFile, { overwrite = true } = {}): boolean {
  const dest = safeJoin(root, f.path);
  if (!dest) return false;
  if (!overwrite && (exists(dest) || isLink(dest))) return false;
  try {
    ensureDir(path.dirname(dest));
    // check again now the folders exist: one of them could be a link that was already there
    if (!insideRoots(dest, [root])) return false;
    fs.writeFileSync(dest, Buffer.from(f.data, 'base64'));
    return true;
  } catch {
    return false;
  }
}

const isLink = (f: string): boolean => {
  try {
    return fs.lstatSync(f).isSymbolicLink();
  } catch {
    return false;
  }
};

/** The same path under a new folder, if p was inside the old one (works across Windows and Unix paths). */
export function rebase(p: string, from: string, to: string): string | null {
  if (!p || !from) return null;
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = norm(p);
  const b = norm(from);
  const fold = /^[a-z]:\//i.test(b) ? (s: string) => s.toLowerCase() : (s: string) => s;
  if (fold(a) === fold(b)) return to;
  if (a.length > b.length && fold(a.slice(0, b.length)) === fold(b) && a[b.length] === '/') return path.join(to, ...a.slice(b.length + 1).split('/'));
  return null;
}

/** The plain files under dir, as "/" paths (links are left out, as packTree does). */
function treeFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    let list: fs.Dirent[] = [];
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(dir, '');
  return out;
}

// The same skill: exactly the same files (none more, none less) with the same bytes
export function sameFiles(dir: string, files: PackedFile[]): boolean {
  const here = treeFiles(dir).sort();
  const there = files.map((f) => f.path).sort();
  if (here.length !== there.length || here.some((p, i) => p !== there[i])) return false;
  return files.every((f) => {
    const p = safeJoin(dir, f.path);
    try {
      return !!p && fs.readFileSync(p).equals(Buffer.from(f.data, 'base64'));
    } catch {
      return false;
    }
  });
}

// Two paths are the same folder: links followed, and case ignored only on Windows
function sameFolder(a: string, b: string): boolean {
  const ra = realTarget(a);
  const rb = realTarget(b);
  const fold = (x: string) => (IS_WIN ? x.toLowerCase() : x);
  return !!ra && !!rb && fold(ra) === fold(rb);
}

function restoreSkills(list: BackupData['skills']): { added: number; same: number; renamed: { from: string; to: string }[]; map: Map<string, string> } {
  const lib = skillsLibrary();
  const map = new Map<string, string>();
  const renamed: { from: string; to: string }[] = [];
  let added = 0;
  let same = 0;
  for (const s of list) {
    const dir = path.join(lib, s.slug);
    if (exists(dir)) {
      if (sameFiles(dir, s.files)) {
        same++;
        continue;
      }
      // a different skill with the same id: keep yours, add this one next to it
      let slug = `${s.slug.slice(0, 54)}-restored`;
      for (let i = 2; exists(path.join(lib, slug)); i++) slug = `${s.slug.slice(0, 54)}-restored-${i}`;
      map.set(s.slug, slug);
      renamed.push({ from: s.slug, to: slug });
    }
    const target = ensureDir(path.join(lib, map.get(s.slug) || s.slug));
    for (const f of s.files) writePacked(target, f);
    if (!map.has(s.slug)) added++;
  }
  return { added, same, renamed, map };
}

export interface RestoreOptions {
  name?: string;
  folder?: string;
  description?: string;
}

/** Make a new project from a backup. Its folder is new, or one you have (nothing in it is overwritten). */
export async function restoreBackup(buf: Buffer, opts: RestoreOptions = {}): Promise<{ project: Project; restored: BackupRestoreResult }> {
  // read and check all of it before anything is created
  const b = decodeBackup(buf);
  const name = String(opts.name || '').trim() || b.project.name || 'Restored project';
  const owner = (dir: string) => listProjects().find((p) => sameFolder(p.brainPath, dir));
  let folder = String(opts.folder || '').trim().replace(/^"|"$/g, '');
  if (folder) {
    const taken = owner(folder);
    if (taken) throw new Error(`That folder belongs to the project "${taken.name}". Pick another folder for the restored copy.`);
  } else {
    // a new folder in the projects folder that no project uses yet (the original may still be on this PC)
    const base = path.join(projectsRoot(), slugify(name));
    folder = base;
    for (let i = 2; owner(folder) || (exists(folder) && fs.readdirSync(folder).length); i++) folder = `${base}-${i}`;
  }
  // a BRAIN.md already there is yours: only the one the new project starts with is replaced by the saved one
  const hadBrainMd = exists(path.join(folder, 'BRAIN.md')) || isLink(path.join(folder, 'BRAIN.md'));
  const created = await createProject({ name, mode: 'new', folder, description: String(opts.description || '').trim() || b.project.description });
  const id = created.id;
  const oldBrain = b.project.brainPath;
  const newBrain = created.brainPath;

  // the brief and notes first, so the agents' knowledge folders in them are there when they are checked
  // (only into a file that isn't there yet: the folder may be one you have)
  const brainFiles = b.brain.filter((f) => {
    if (!BRAIN_FILES.includes(f.path) && !BRAIN_DIRS.some((d) => f.path.startsWith(`${d}/`))) return false;
    return writePacked(newBrain, f, { overwrite: f.path === 'BRAIN.md' && !hadBrainMd });
  }).length;

  const skills = restoreSkills(b.skills);
  const swap = (list: unknown): string[] => (Array.isArray(list) ? list.map((s) => skills.map.get(String(s)) || String(s)) : []);
  const known = (list: string[]) => list.filter((s) => isSkillSlug(s) && exists(path.join(skillsLibrary(), s)));

  let paused = 0;
  // count: false for a team's old versions (they don't run; restoring one later starts it paused too)
  const pause = <T extends { enabled?: boolean; schedule?: { type?: string } }>(x: T, count = true): T => {
    if (x.enabled && x.schedule && x.schedule.type && x.schedule.type !== 'none') {
      if (count) paused++;
      return { ...x, enabled: false };
    }
    return x;
  };

  // an agent (or one of its versions) as it fits here: skills renamed, folders moved with the project
  const fixAgent = (a: Agent): Agent => {
    const agent: Agent = { ...a, skills: swap(a.skills) };
    // folders inside the old project folder move with it; folders that aren't on this PC are dropped
    if (typeof agent.workspace === 'string' && agent.workspace) {
      const moved = rebase(agent.workspace, oldBrain, newBrain);
      agent.workspace = moved ?? (path.isAbsolute(agent.workspace) && exists(agent.workspace) ? agent.workspace : '');
    }
    if (agent.knowledge && Array.isArray(agent.knowledge.folders)) {
      agent.knowledge = { ...agent.knowledge, folders: agent.knowledge.folders.map((f) => rebase(String(f), oldBrain, newBrain) ?? String(f)).filter((f) => path.isAbsolute(f) && exists(f)) };
    }
    return agent;
  };
  for (const a of b.agents) writeJSON(projectDir(id, 'agents', `${a.id}.json`), fixAgent(a));
  for (const t of b.teams) writeJSON(projectDir(id, 'workflows', `${t.id}.json`), pause({ ...t, skills: swap(t.skills) }));
  const versions = restoreVersions(b, id, skills.map, {
    agent: (a) => fixAgent(a),
    team: (t) => pause({ ...t, skills: swap(t.skills) }, false),
  });
  for (const r of b.routines) {
    const mentions = (Array.isArray(r.mentions) ? r.mentions : []).map((m) => (m && m.kind === 'skill' ? { ...m, id: skills.map.get(m.id) || m.id } : m));
    writeJSON(projectDir(id, 'routines', `${r.id}.json`), pause({ ...r, mentions }));
  }
  writeJSON(projectDir(id, 'layout.json'), b.layout);
  writeJSON(projectDir(id, 'brain-chat.json'), b.brainChat);
  for (const c of b.teamChats) writeJSON(projectDir(id, 'teamchats', c.name), c.data);
  // chats go back under the agent and id they were saved as (whatever the chat itself claims)
  const agentIds = new Set(b.agents.map((a) => a.id));
  let chats = 0;
  for (const { agentId, chat } of b.chats) {
    if (!agentIds.has(agentId)) continue;
    const { _deleted, ...rest } = chat;
    // an engine's session (Claude Code, Codex, Hermes, OpenClaw…) stays the original's: the copy starts a
    // new one from the chat so far, so the two don't carry on in one conversation
    const session = rest.sessionId ? { sessionId: null, reseed: true } : {};
    writeJSON(projectDir(id, 'chats', agentId, `${chat.id}.json`), { ...rest, ...session, agentId });
    chats++;
  }
  // the teams' pictures and models, beside their teams
  const teamIds = new Set(b.teams.map((t) => t.id));
  for (const f of b.teamMarks || []) if (teamIds.has(MARK_RE.exec(f.path)![1])) writePacked(ensureDir(projectDir(id, 'team-marks')), f);
  const kRoot = ensureDir(projectDir(id, 'knowledge'));
  const knowledgeFiles = b.knowledge.filter((f) => writePacked(kRoot, f)).length;
  // MEMORY.md files go back under the agent (or the Brain) they were saved for
  const memories = b.memory.filter((f) => putMemory(id, MEMORY_PATH.exec(f.path)![1], Buffer.from(f.data, 'base64').toString('utf8'))).length;
  // the voxel world: always a new world of this project's own (a clone mustn't build in the original's)
  if (b.world?.files.some((f) => f.path === 'world.json')) {
    const fresh = newWorld(id, b.world.name);
    for (const f of b.world.files) if (f.path !== 'world.json') writePacked(worldDir(fresh.id), f);
    let saved: Partial<VoxelWorld> = {};
    try {
      saved = JSON.parse(Buffer.from(b.world.files.find((f) => f.path === 'world.json')!.data, 'base64').toString('utf8')) as Partial<VoxelWorld>;
    } catch {
      /* the voxels came back; the world starts plain */
    }
    writeJSON(worldDir(fresh.id, 'world.json'), { ...fresh, ...saved, format: 1, id: fresh.id, homeProject: id, name: fresh.name });
    setLink(id, { id: fresh.id, mode: 'own' });
  }

  let logo = false;
  if (b.logo) {
    try {
      const ext = b.logo.path.slice(5);
      setLogo(id, `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b.logo.data}`);
      logo = true;
    } catch {
      /* not a picture after all: no logo */
    }
  }

  // saved presets: added when not there yet (their ids are unique, so the same id is the same preset)
  let presetsAdded = 0;
  let presetsSame = 0;
  for (const pr of b.presets) {
    const file = dataPath('presets', `${pr.id}.json`);
    if (exists(file)) {
      presetsSame++;
      continue;
    }
    const copy = structuredClone(pr);
    if (copy.kind === 'agent' && copy.agent) copy.agent.skills = swap(copy.agent.skills);
    if (copy.kind === 'team') {
      if (copy.team) copy.team.skills = swap(copy.team.skills);
      copy.members = (copy.members || []).map((m) => ({ ...m, skills: swap(m.skills) }));
    }
    writeJSON(file, copy);
    presetsAdded++;
  }

  // the prefab library: added when not there yet (by id), like the presets
  let libraryAdded = 0;
  let librarySame = 0;
  for (const e of b.prefabLibrary) {
    const r = putLibraryEntry(e);
    if (r === 'added') libraryAdded++;
    else if (r === 'same') librarySame++;
  }

  let project = created;
  const projSkills = known(swap(b.project.skills));
  if (projSkills.length) project = updateProject(id, { skills: projSkills });
  emit('project', { id });
  emit('skills');
  log('project', `Restored "${project.name}" from a backup: ${b.agents.length} agents, ${b.teams.length} teams, ${b.routines.length} routines, ${chats} chats, ${skills.added} new skills`);
  return {
    project,
    restored: {
      agents: b.agents.length,
      teams: b.teams.length,
      routines: b.routines.length,
      chats,
      knowledgeFiles,
      memories,
      brainFiles,
      skills: { added: skills.added, same: skills.same, renamed: skills.renamed },
      presets: { added: presetsAdded, same: presetsSame },
      libraryPrefabs: { added: libraryAdded, same: librarySame },
      versions,
      paused,
      logo,
    },
  };
}

// The kept versions in a backup. Agents' and teams' go into the new project (deleted ones too: they
// show in Recently deleted). A skill's follow the skill: under its new id when it was added as
// <id>-restored, merged with the history here when it's the same skill, and left out when a skill here
// with that id isn't the backup's (two histories never mix). Each version is checked field by field and
// put back under the item and id it was saved as; the newest 50 of each are kept.
function restoreVersions(b: BackupData, id: string, skillMap: Map<string, string>, fix: { agent: (a: Agent) => Agent; team: (t: Team) => Team }): number {
  interface Group {
    kind: 'agents' | 'teams' | 'memory' | 'skills';
    itemId: string;
    versions: Map<string, unknown>;
    files: Map<string, PackedFile[]>;
  }
  const groups = new Map<string, Group>();
  for (const f of b.versions) {
    const parts = f.path.split('/');
    if (parts.length < 3) continue;
    const [kind, itemId, name, ...rest] = parts;
    if (kind !== 'agents' && kind !== 'teams' && kind !== 'memory' && kind !== 'skills') continue;
    if (kind === 'skills' ? !isSkillSlug(itemId) : kind === 'memory' ? !isMemoryOwner(itemId) : !ID_RE.test(itemId) || itemId.startsWith('.')) continue;
    const key = `${kind}/${itemId}`;
    const g = groups.get(key) || { kind, itemId, versions: new Map(), files: new Map() };
    groups.set(key, g);
    if (!rest.length && /^[\w-]+\.json$/.test(name)) {
      try {
        g.versions.set(name.slice(0, -'.json'.length), JSON.parse(Buffer.from(f.data, 'base64').toString('utf8')));
      } catch {
        /* not JSON: left out */
      }
    } else if (kind === 'skills' && /^files-[\w-]+$/.test(name) && rest.length) {
      const vid = name.slice('files-'.length);
      g.files.set(vid, [...(g.files.get(vid) || []), { path: rest.join('/'), data: f.data }]);
    }
  }
  const inBackup = new Set(b.skills.map((s) => s.slug));
  let n = 0;
  for (const g of groups.values()) {
    let dir: string;
    let check: (item: Record<string, unknown>) => unknown;
    if (g.kind === 'agents') {
      dir = projectDir(id, 'versions', 'agents', g.itemId);
      check = (item) => {
        const a = cleanAgentVersion(item, g.itemId);
        return a ? fix.agent(a as unknown as Agent) : null;
      };
    } else if (g.kind === 'teams') {
      dir = projectDir(id, 'versions', 'workflows', g.itemId);
      check = (item) => {
        const t = cleanTeamVersion(item, g.itemId);
        return t ? fix.team(t as unknown as Team) : null;
      };
    } else if (g.kind === 'memory') {
      dir = projectDir(id, 'versions', 'memory', g.itemId);
      check = (item) => cleanMemoryVersion(item, g.itemId);
    } else {
      const slug = skillMap.get(g.itemId) || g.itemId;
      // a deleted skill in the backup whose id a skill here has: not the same skill, so not its history
      if (!inBackup.has(g.itemId) && exists(skillDir(slug))) continue;
      dir = skillVersionsDir(slug);
      check = skillVersionItem(slug);
    }
    const have = new Set(listVersions(dir).map((v) => v.id));
    const fresh = [...g.versions.entries()]
      .map(([vid, raw]) => checkVersion(raw, vid, check))
      .filter((v): v is Version<unknown> => v !== null && !have.has(v.id));
    for (const v of fresh) writeJSON(path.join(ensureDir(dir), `${v.id}.json`), v);
    pruneVersions(dir);
    // the files kept with the versions that stayed
    const kept = new Set(listVersions(dir).map((v) => v.id));
    for (const v of fresh) {
      if (!kept.has(v.id)) continue;
      n++;
      const files = g.files.get(v.id);
      if (files) for (const f of files) writePacked(ensureDir(versionFilesDir(dir, v.id)), f);
    }
  }
  return n;
}
