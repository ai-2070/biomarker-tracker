// All dashboard state lives in ./data as plain JSON files you can read, back up or edit.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DATA, HOME, dataPath, ensureDir, readJSON, writeJSON, uid, listFiles, exists } from './util.ts';
import { keepVersion } from './versions.ts';
import type { ActivityEntry, Agent, AgentQuestion, Artifact, Chat, ChatSummary, OutboxPost, Project, Routine, RoutineRun, SecretKey, SecretStatus, ServerEvent, Settings, Team } from '../shared/types.ts';

ensureDir(DATA);

// Everything that happens is broadcast to open browser tabs through this bus.
export const bus = new EventEmitter<{ event: [ServerEvent] }>();
bus.setMaxListeners(100);
export const emit = (type: string, payload: Record<string, unknown> = {}) => bus.emit('event', { type, ...payload, ts: Date.now() });

// ---------- settings (safe to show) and secrets (never sent to the browser) ----------
const SETTINGS_FILE = dataPath('settings.json');
const SECRETS_FILE = dataPath('secrets.json');

const DEFAULT_SETTINGS: Settings = {
  defaults: {
    engine: 'claude-code',
    claudeModel: 'sonnet',
    openrouterModel: 'anthropic/claude-sonnet-5.5',
    hermesProfile: '',
    autonomy: 'auto',
  },
  providers: {
    lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1' },
    ollama: { baseUrl: 'http://127.0.0.1:11434/v1' },
    custom: { baseUrl: '', label: 'Custom (OpenAI-compatible)' },
  },
  comfyui: { url: '', workflowDirs: [] },
  paths: { blender: '', photoshop: '', aftereffects: '', premiere: '', comfyui: '', maya: '', houdini: '', painter: '', designer: '', resolve: '', openscad: '', prusaslicer: '', orcaslicer: '', nvtt: '', handbrakecli: '', imagemagick: '' },
  allowedFolders: [],
  x: { clientId: '' },
  reddit: { clientId: '', username: '' },
  brain: { provider: 'claude', model: 'haiku' },
  brainApproves: true,
  brainSkills: ['self-improvement'],
  brainAnyGitHub: false,
  brainFollowsUp: true,
  look: { scale: 100, accent: 'lime', motion: 'full', chatFont: 'serif', station: 'balanced', sidebar: 'status', stationLook: 'classic', worldQuality: 'medium' },
  telegram: { chatId: '' },
  maxToolSteps: 16,
  costLimitUsdPerRun: 2,
  compaction: { auto: true, engineOwn: true, instant: true, thresholdPercent: 50, keepMessages: 10, windowTokens: 0 },
  favoriteModels: [],
  defaultWorld: '',
};

/** What saveSettings takes: any top-level setting, with its own fields optional too (they are merged in). */
export type SettingsPatch = { [K in keyof Settings]?: Settings[K] extends unknown[] ? Settings[K] : Settings[K] extends object ? Partial<Settings[K]> : Settings[K] };

function merge<T>(base: T, over: unknown): T {
  if (Array.isArray(base) || typeof base !== 'object' || base == null) return (over === undefined ? base : over) as T;
  const b = base as Record<string, unknown>;
  const out: Record<string, unknown> = { ...b };
  for (const [k, v] of Object.entries((over || {}) as Record<string, unknown>)) out[k] = k in b ? merge(b[k], v) : v;
  return out as T;
}

export function getSettings(): Settings {
  const raw = readJSON<Partial<Settings>>(SETTINGS_FILE, {});
  const s = merge(DEFAULT_SETTINGS, raw);
  // look.station was once the voxel look ("classic" or "world"); it is the map's quality now
  const old: unknown = raw.look?.station;
  if (old === 'classic' || old === 'world') s.look = { ...s.look, station: DEFAULT_SETTINGS.look.station, stationLook: raw.look?.stationLook || old };
  return s;
}

export function saveSettings(patch: SettingsPatch): Settings {
  const next = merge(getSettings(), patch);
  writeJSON(SETTINGS_FILE, next);
  emit('settings');
  return next;
}

export type Secrets = Partial<Record<SecretKey, string>>;

export function getSecrets(): Secrets {
  return readJSON<Secrets>(SECRETS_FILE, {});
}

export function setSecret(key: SecretKey, value: string | null | undefined) {
  const s = getSecrets();
  if (value == null || value === '') delete s[key];
  else s[key] = value;
  writeJSON(SECRETS_FILE, s);
  emit('settings');
}

export function secretStatus(): SecretStatus {
  const s = getSecrets();
  const out: Partial<SecretStatus> = {};
  for (const k of ['openrouterKey', 'anthropicKey', 'customKey', 'xClientSecret', 'telegramBotToken', 'discordWebhook', 'redditClientSecret'] as const) {
    const v = s[k];
    out[k] = v ? { set: true, hint: `…${String(v).slice(-4)}` } : { set: false };
  }
  return out as SecretStatus;
}

// A token the local MCP bridge uses to call back into the dashboard.
export function internalToken(): string {
  const file = dataPath('.internal-token');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const t = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(file, t);
    return t;
  }
}

// ---------- projects ----------
// A project has its own agents, branches, runs and chats (data/projects/<id>/) and a Brain:
// a real folder with the project's files, notes and (optionally) its GitHub repo.
const PROJECTS_FILE = dataPath('projects.json');
const DEFAULT_PROJECT = (): Project => ({ id: 'default', name: 'My workspace', brainPath: path.join(HOME, 'Documents', 'Blacksite', 'My workspace'), repo: '', createdAt: Date.now() });

let madeDefault = false;
export function listProjects(): Project[] {
  const list = readJSON<Project[]>(PROJECTS_FILE, null);
  if (Array.isArray(list) && list.length) return list;
  const first = [DEFAULT_PROJECT()];
  writeJSON(PROJECTS_FILE, first);
  madeDefault = true;
  return first;
}

/** Was the default project just made (a fresh data folder)? Says so once: see projectsync's adoptSavedFolder. */
export function takeNewDefaultProject(): Project | null {
  if (!madeDefault) return null;
  madeDefault = false;
  return listProjects().find((p) => p.id === DEFAULT_PROJECT().id) ?? null;
}

export function saveProjects(list: Project[]) {
  writeJSON(PROJECTS_FILE, list);
  emit('projects');
}

/**
 * The order projects are listed in (the project menu, and the Up / Down arrow keys on the Station). `ids` is the new order;
 * projects it leaves out keep their relative order after it, and ids that are not projects are ignored. Returns the list.
 */
export function reorderProjects(ids: unknown): Project[] {
  const list = listProjects();
  const want = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === 'string');
  const byId = new Map(list.map((p) => [p.id, p]));
  const first = [...new Set(want)].map((id) => byId.get(id)).filter((p): p is Project => !!p);
  const next = [...first, ...list.filter((p) => !first.includes(p))];
  if (next.some((p, i) => p !== list[i])) saveProjects(next);
  return next;
}

// Work that started in one project keeps working there (an agent run, a workflow), even if you open
// another project meanwhile. withProject() pins the project for fn and everything it starts, sync or
// async; inside it, activeProject() and projectData() mean that project instead of the open one.
const pinned = new AsyncLocalStorage<Project>();

export function withProject<T>(p: Project, fn: () => T): T {
  return pinned.run(p, fn);
}

/** The project the current work belongs to: the pinned one inside withProject(), else the one open in the dashboard. */
export function activeProject(): Project {
  const list = listProjects();
  const pin = pinned.getStore();
  // (pinned and since renamed or moved: the fresh copy; removed: the copy it started with)
  if (pin) return list.find((p) => p.id === pin.id) || pin;
  const id = readJSON<Partial<Settings>>(SETTINGS_FILE, {}).activeProject;
  return list.find((p) => p.id === id) || list[0];
}

/** The project open in the dashboard right now, even inside withProject() (to notice a switch). */
export function openProject(): Project {
  return pinned.exit(activeProject);
}

// How many times another project was opened. Work that outlives a switch can tell it happened even
// if you came back to its project since.
let switches = 0;
export const projectSwitches = (): number => switches;

export function setActiveProject(id: string): Project {
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new Error('No such project.');
  if (openProject().id !== id) switches++;
  const cur = readJSON<Partial<Settings>>(SETTINGS_FILE, {});
  writeJSON(SETTINGS_FILE, { ...cur, activeProject: id });
  emit('project', { id });
  return p;
}

// Where the active (or pinned) project keeps its dashboard data.
export const projectData = (...p: string[]): string => dataPath('projects', activeProject().id, ...p);

// Older installs kept agents etc. at the top of data/: move them into the first project once.
export function migrateLayout() {
  const target = dataPath('projects', listProjects()[0].id);
  for (const name of ['agents', 'workflows', 'runs', 'chats', 'knowledge', 'workspaces']) {
    const from = dataPath(name);
    const to = path.join(target, name);
    if (exists(from) && !exists(to)) {
      ensureDir(target);
      fs.renameSync(from, to);
    }
  }
}

// ---------- simple JSON collections: one file per item ----------
/** What every collection item has. save() fills these in. */
export interface StoredItem {
  id: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface Collection<T extends StoredItem> {
  readonly dir: string;
  /** Where an item's old versions are kept (versioned collections only). */
  versionsDir(id?: string): string | null;
  /** Fields that don't count as a change (versioned collections only). */
  readonly versionIgnore: readonly string[];
  list(): T[];
  get(id: string | null | undefined): T | null;
  /** Gives the item an id (if it has none) and timestamps, writes it and returns the same object. */
  save(item: Partial<T>): T;
  remove(id: string): void;
}

// versioned: keep the version an item had before each change and before it's deleted (see versions.ts);
// ignore: fields that change by themselves (timestamps, where it sits on the map) and aren't a new version.
export function collection<T extends StoredItem>(name: string, { global = false, versioned = false, ignore = [] }: { global?: boolean; versioned?: boolean; ignore?: string[] } = {}): Collection<T> {
  const dirOf = () => ensureDir(global ? dataPath(name) : projectData(name));
  const versionIgnore = ['updatedAt', 'createdAt', ...ignore];
  const versionsDir = (id = '') => (versioned ? (global ? dataPath('versions', name, id) : projectData('versions', name, id)) : null);
  const file = (id: string) => path.join(dirOf(), `${id}.json`);
  // ids name files: no path separators
  const okId = (id: string | null | undefined): id is string => !!id && !/[\\/]/.test(id);
  return {
    get dir() {
      return dirOf();
    },
    versionsDir,
    versionIgnore,
    list() {
      const dir = dirOf();
      return listFiles(dir, (n) => n.endsWith('.json'))
        .map((n) => readJSON<T>(path.join(dir, n)))
        .filter((x): x is T => Boolean(x));
    },
    get(id) {
      if (!okId(id)) return null;
      return readJSON<T>(file(id));
    },
    save(item) {
      const it = item as Partial<StoredItem>;
      if (!it.id) it.id = uid();
      if (!okId(it.id)) throw Object.assign(new Error('Invalid id'), { status: 400 });
      if (versioned) {
        const before = readJSON<T>(file(it.id));
        if (before) keepVersion(versionsDir(it.id)!, before, item as T, { ignore: versionIgnore });
      }
      it.updatedAt = Date.now();
      it.createdAt ??= it.updatedAt;
      writeJSON(file(it.id), item);
      emit(`${name}`, { id: it.id });
      return item as T;
    },
    remove(id) {
      if (!okId(id)) return;
      if (versioned) {
        const before = readJSON<T>(file(id));
        if (before) keepVersion(versionsDir(id)!, before, null, { deleted: true });
      }
      try {
        fs.unlinkSync(file(id));
      } catch {
        /* gone */
      }
      emit(`${name}`, { id, removed: true });
    },
  };
}

/** One step of a workflow run (old-style step workflows). */
export interface WorkflowRunStep {
  id?: string;
  label: string;
  type: string;
  status: 'waiting' | 'running' | 'needs-you' | 'done' | 'failed' | 'skipped' | string;
  output: unknown;
  agentName?: string;
  images?: string[];
  startedAt?: number;
  finishedAt?: number;
  [k: string]: unknown;
}

/** A workflow run, stored in the "runs" collection. */
export interface WorkflowRun extends StoredItem {
  workflowId: string;
  workflowName: string;
  input: string;
  trigger: string;
  status: 'running' | 'done' | 'failed' | 'stopped' | string;
  steps: WorkflowRunStep[];
  output?: unknown;
  error?: string;
  finishedAt?: number;
  [k: string]: unknown;
}

// (an agent's last model and pin, and a team's place on the map and last scheduled run, aren't versions)
export const agents = collection<Agent>('agents', { versioned: true, ignore: ['lastModel', 'lastModelAt', 'pinned'] });
export const workflows = collection<Team>('workflows', { versioned: true, ignore: ['pos', 'rot', 'angle', 'lastScheduledAt', 'state', 'last'] });
export const runs = collection<WorkflowRun>('runs');
export const routines = collection<Routine>('routines');
export const routineRuns = collection<RoutineRun>('routine-runs');
export const outbox = collection<OutboxPost>('outbox'); // each project has its own Outbox

/**
 * The Outbox used to be one for every project (data/outbox). Moves what is left there into the project
 * each post's author belongs to, or the open project when that agent is gone. Returns how many moved.
 */
export function migrateGlobalOutbox(): number {
  const dir = dataPath('outbox');
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return 0;
  }
  const projects = listProjects();
  let moved = 0;
  for (const f of files) {
    const from = path.join(dir, f);
    const post = readJSON<Partial<OutboxPost>>(from, {});
    const owner = typeof post.agentId === 'string' && /^[\w-]+$/.test(post.agentId) ? projects.find((p) => exists(dataPath('projects', p.id, 'agents', `${post.agentId}.json`))) : undefined;
    const to = path.join(ensureDir(dataPath('projects', owner?.id || activeProject().id, 'outbox')), f);
    if (exists(to)) fs.rmSync(from, { force: true });
    else fs.renameSync(from, to);
    moved++;
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    /* not empty: leave it */
  }
  if (moved) emit('outbox');
  return moved;
}
export const artifacts = collection<Artifact>('artifacts'); // what a project's teams finished
export const questions = collection<AgentQuestion>('questions'); // what agents asked you (ask_user), shown in the Outbox

// Chats are stored per agent: data/chats/<agentId>/<chatId>.json
const SAFE_ID = /^[\w-]+$/;
export const chats = {
  dir(agentId: string): string {
    if (!SAFE_ID.test(String(agentId))) throw Object.assign(new Error('Invalid agent id'), { status: 400 });
    return ensureDir(projectData('chats', agentId));
  },
  list(agentId: string): ChatSummary[] {
    const dir = this.dir(agentId);
    return listFiles(dir, (n) => n.endsWith('.json'))
      .map((n) => readJSON<Chat>(path.join(dir, n)))
      .filter((c): c is Chat => Boolean(c))
      .map(({ id, title, updatedAt, createdAt, items, teamId }) => ({ id, title, updatedAt, createdAt, count: items?.length || 0, teamId: teamId || null }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  get(agentId: string, chatId: string | null | undefined): Chat | null {
    if (!chatId || !SAFE_ID.test(chatId)) return null;
    return readJSON<Chat>(path.join(this.dir(agentId), `${chatId}.json`));
  },
  create(agentId: string, title = 'New chat', teamId: string | null = null): Chat {
    const chat: Chat = { id: uid('c'), agentId, title, items: [], llm: [], sessionId: null, ...(teamId ? { teamId } : {}), createdAt: Date.now(), updatedAt: Date.now() };
    return this.save(chat);
  },
  save(chat: Chat): Chat {
    chat.updatedAt = Date.now();
    writeJSON(path.join(this.dir(chat.agentId), `${chat.id}.json`), chat);
    // project: whose chat this is, for the auto-save (a run can outlive a project switch)
    emit('chats', { agentId: chat.agentId, chatId: chat.id, project: activeProject().id });
    return chat;
  },
  remove(agentId: string, chatId: string) {
    if (!SAFE_ID.test(String(chatId))) return;
    try {
      fs.unlinkSync(path.join(this.dir(agentId), `${chatId}.json`));
    } catch {
      /* gone */
    }
    // the images its tool calls returned (see toolimages.ts)
    fs.rmSync(projectData('tool-images', agentId, chatId), { recursive: true, force: true });
    emit('chats', { agentId, chatId, removed: true, project: activeProject().id });
  },
};

// ---------- activity log ----------
const ACTIVITY_FILE = dataPath('activity.jsonl');
const recent: ActivityEntry[] = [];
try {
  const lines = fs.readFileSync(ACTIVITY_FILE, 'utf8').trim().split('\n').slice(-300);
  for (const l of lines) {
    try {
      recent.push(JSON.parse(l) as ActivityEntry);
    } catch {
      /* skip */
    }
  }
} catch {
  /* first run */
}

export function log(kind: string, text: unknown, extra: Record<string, unknown> = {}): ActivityEntry {
  const entry: ActivityEntry = { id: uid('a'), kind, text: String(text).slice(0, 1000), ...extra, ts: Date.now() };
  recent.push(entry);
  if (recent.length > 500) recent.splice(0, recent.length - 500);
  try {
    fs.appendFileSync(ACTIVITY_FILE, JSON.stringify(entry) + '\n');
  } catch {
    /* disk full or locked: keep going */
  }
  emit('activity', { entry });
  return entry;
}

export function activity(limit = 100): ActivityEntry[] {
  return recent.slice(-limit).reverse();
}
