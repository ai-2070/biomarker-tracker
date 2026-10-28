// Blacksite: a local, login-free command center for agents, tools, programs, MCP servers and social accounts.
// Listens on 127.0.0.1 only. Run: node server/index.js [--port 4800] [--no-open]
import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { ROOT, PORT as DEFAULT_PORT, setPort, dataPath, exists, openWithShell, run, ensureDir, HOME, readJSON, writeJSON, insideRoots } from './util.ts';
import * as store from './store.ts';
import { agents, chats, outbox, artifacts as artifactStore, workflows, runs, bus, getSettings, saveSettings, setSecret, secretStatus, internalToken, activity, log } from './store.ts';
import { listApprovals, decide, requestApproval, setReviewer } from './approvals.ts';
import * as engines from './engines/index.ts';
import { PROVIDERS, listModels } from './engines/openai.ts';
import { CLAUDE_MODELS } from './engines/claude.ts';
import { codexModelList } from './models.ts';
import { listProfiles } from './engines/hermes.ts';
import * as codexEngine from './engines/codex.ts';
import * as piEngine from './engines/pi.ts';
import * as openclawEngine from './engines/openclaw.ts';
import { clearWhichCache, which } from './util.ts';
import { aboutInfo } from './about.ts';
import * as tools from './tools.ts';
import { inlineToolImages } from './toolimages.ts';
import * as programs from './programs.ts';
import * as comfy from './comfyui.ts';
import * as mcp from './mcp.ts';
import * as social from './social.ts';
import { addArtifact, removeArtifact } from './artifacts.ts';
import * as teamMarks from './teammark.ts';
import * as library from './library.ts';
import { isEffort } from '../shared/effort.ts';
import { queuedText } from '../shared/queue.ts';
import * as commands from './commands.ts';
import { openGoal } from './briefs.ts';
import * as kb from './knowledge.ts';
import * as memory from './memory.ts';
import * as wfs from './workflows.ts';
import * as worldLink from './voxel/link.ts';
import * as worldBuild from './voxel/build.ts';
import * as worldStore from './voxel/store.ts';
import * as worldMd from './voxel/worldmd.ts';
import * as worldScene from './voxel/scene.ts';
import * as worldLook from './voxel/look.ts';
import * as worldExchange from './voxel/exchange.ts';
import * as worldPrefabs from './voxel/prefabs.ts';
import * as worldCharacters from './voxel/characters.ts';
import { listVersions, getVersion, withActor } from './versions.ts';
import * as terms from './terminals.ts';
import * as status from './status.ts';
import * as codexLimits from './codexlimits.ts';
import * as brain from './brain.ts';
import * as irc from './irc.ts';
import * as projects from './projects.ts';
import * as teams from './teams.ts';
import * as questions from './questions.ts';
import * as reddit from './reddit.ts';
import * as overseer from './overseer.ts';
import * as projectSync from './projectsync.ts';
import * as skills from './skills.ts';
import * as learning from './learning.ts';
import * as history from './history.ts';
import * as skillInstall from './skillinstall.ts';
import * as presets from './presets.ts';
import * as uploads from './uploads.ts';
import * as files from './files.ts';
import * as uistream from './uistream.ts';
import * as routinesMod from './routines.ts';
import * as backup from './backup.ts';
import type { RestoreResult } from './projectsync.ts';
import type { Agent, AppState, Chat, Project, ProviderUsage, Routine, SecretKey, Team, UsageLimits, VersionKind, WorldBuilder } from '../shared/types.ts';

// If the dashboard was started from inside a Claude Code session, don't let agents inherit that session's markers.
for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_SESSION_ID']) delete process.env[k];

const argv = process.argv.slice(2);
const PORT = (argv.includes('--port') && Number(argv[argv.indexOf('--port') + 1])) || DEFAULT_PORT;
setPort(PORT);
const OPEN = !argv.includes('--no-open') && !process.env.DASH_NO_OPEN;
const PUBLIC = path.join(ROOT, 'public');
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);

// Only the terminal's stylesheet comes straight from node_modules; the scripts are bundled into public/dist.
const VENDOR: Record<string, string> = {
  'xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
};
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

// ---------- tiny router ----------
/** :name parts of the path. */
type Params = Record<string, string>;
/** The query string (?a=1&b=2). */
type Query = Record<string, string>;
/** The JSON body as sent ({} for GET, DELETE and empty bodies). Each route says what it reads by typing B. */
type Body = Record<string, unknown>;
type Handler<B = Body> = (params: Params, body: B, query: Query, res: http.ServerResponse) => Promise<unknown>;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler<unknown>;
  /** The body is a file, not JSON: it is streamed to a temporary file, and the handler gets its path. */
  raw?: boolean;
}

const routes: Route[] = [];
// B is the body shape the handler expects: the JSON is trusted to match it here (the HTTP boundary).
const route = <B>(method: string, pattern: string, handler: Handler<B>, raw = false) => {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler: handler as Handler<unknown>, raw });
};
const get = <B = Body>(p: string, h: Handler<B>) => route('GET', p, h);
const post = <B = Body>(p: string, h: Handler<B>) => route('POST', p, h);
/** A POST whose body is a file, e.g. a backup: the handler gets the path of a temporary copy (removed afterwards). */
const postFile = (p: string, h: Handler<string>) => route('POST', p, h, true);
const put = <B = Body>(p: string, h: Handler<B>) => route('PUT', p, h);
const del = <B = Body>(p: string, h: Handler<B>) => route('DELETE', p, h);

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}
const need = <T>(v: T, msg = 'Not found'): NonNullable<T> => {
  if (!v) throw new HttpError(404, msg);
  return v as NonNullable<T>;
};

// ---------- external agent for MCP clients that are not dashboard agents (e.g. Hermes, Claude Desktop) ----------
/** Not a saved agent: only the fields the tools look at. */
type ExternalAgent = Pick<Agent, 'id' | 'name' | 'toolGroups' | 'autonomy' | 'knowledge'> & Partial<Agent>;
const EXTERNAL: ExternalAgent = { id: '_external', name: 'External MCP client', toolGroups: tools.TOOL_GROUPS.map((g) => g.id).filter((g) => g !== 'shell'), autonomy: 'ask', knowledge: { folders: [] } };
const agentFor = (id: string | null | undefined): Agent | ExternalAgent => (id ? agents.get(id) : null) || EXTERNAL;

// ---------- about (version, GitHub) ----------
get('/api/about', async (_p, _b, q) => aboutInfo({ withStars: q.stars === '1' }));

// ---------- state ----------
// the MCP servers' names and each one's label, service and "use for" (mcp.json read once)
const mcpState = () => {
  const servers = mcp.listServers();
  return { mcpServers: Object.keys(servers), mcpInfo: mcp.serverInfo(servers) };
};
get('/api/state', async (): Promise<AppState> => ({
  agents: agents.list().sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || a.name.localeCompare(b.name)),
  ...mcpState(),
  project: projects.withLogo(store.activeProject()),
  projectSaved: projectSync.saveStatus(),
  projects: store.listProjects().map(projects.withLogo),
  approvals: listApprovals(),
  outboxPending: outbox.list().filter((p) => p.status === 'pending').length,
  questions: questions.waitingQuestions(),
  runs: engines.activeRuns(),
  engines: engines.engineStatus(),
  engineList: engines.ENGINE_LIST,
  toolGroups: tools.TOOL_GROUPS,
  settings: getSettings(),
  secrets: secretStatus(),
  accounts: social.listAccounts(),
  terminals: terms.listTerminals(),
  port: PORT,
  home: HOME,
  dataDir: dataPath(),
}));

get('/api/activity', async () => activity(200));
// ---------- projects ----------
get('/api/projects', async () => ({ active: projects.withLogo(store.activeProject()), projects: store.listProjects().map(projects.withLogo), root: projects.projectsRoot() }));
// The order projects are listed in: the project menu, and the Up / Down keys on the Station.
post<{ ids?: unknown }>('/api/projects/order', async (_p, body) => ({ projects: store.reorderProjects(body.ids).map(projects.withLogo) }));
// The project's logo: shown on the start screen, in the project menu and inside the Brain.
get('/api/projects/:id/logo', async ({ id }, _b, _q, res) => {
  const p = need(store.listProjects().find((x) => x.id === id));
  const f = projects.logoFile(p);
  if (!f) throw new HttpError(404, 'No logo');
  sendFileSafely(res, f);
  return undefined;
});
post<{ data?: unknown }>('/api/projects/:id/logo', async ({ id }, body) => {
  const p = projects.setLogo(id, body.data);
  store.emit('project-logo', { id });
  return p;
});
del('/api/projects/:id/logo', async ({ id }) => {
  const p = projects.removeLogo(id);
  store.emit('project-logo', { id });
  return p;
});
// The 3D model that replaces the logo inside the Brain's globe.
get('/api/projects/:id/model', async ({ id }, _b, _q, res) => {
  const p = need(store.listProjects().find((x) => x.id === id));
  const f = projects.modelFile(p);
  if (!f) throw new HttpError(404, 'No 3D model');
  sendFileSafely(res, f);
  return undefined;
});
post<{ name?: unknown; data?: unknown }>('/api/projects/:id/model', async ({ id }, body) => {
  const p = projects.setModel(id, body.name, body.data);
  store.emit('project-logo', { id });
  return p;
});
del('/api/projects/:id/model', async ({ id }) => {
  const p = projects.removeModel(id);
  store.emit('project-logo', { id });
  return p;
});
post<Parameters<typeof projects.createProject>[0] | null>('/api/projects', async (_p, body) => {
  let p: Project & { restored?: RestoreResult | null } = await projects.createProject(body || {});
  // a folder saved by the dashboard before: load its agents, teams and chats
  const restored = projectSync.restoreInto(p.id, p.brainPath);
  if (restored && !p.description && restored.project.description) p = projects.updateProject(p.id, { description: restored.project.description });
  if (restored?.project.skills?.length) p = projects.updateProject(p.id, { skills: restored.project.skills });
  if (restored) store.emit('project', { id: p.id });
  p = { ...(skills.enableOrcaSkill(p.id) || p), restored };
  projects.touch(p.id);
  launcherPending = false;
  return p;
});
// The start screen: shown once each time the dashboard starts, until you pick or create a project.
let launcherPending = true;
get('/api/projects/overview', async () => ({ ...projects.overview(projectSync.peek), showLauncher: launcherPending }));
post('/api/projects/save', async () => projectSync.saveProject(store.activeProject().id));
// The start screen closed; picking the project that is open already lands here too.
post('/api/projects/launcher-done', async () => {
  launcherPending = false;
  skills.enableOrcaSkill(store.activeProject().id);
  return { ok: true };
});
post('/api/projects/:id/activate', async ({ id }) => {
  const p = store.setActiveProject(id);
  skills.enableOrcaSkill(id);
  projects.touch(id);
  launcherPending = false;
  log('project', `Switched to project "${p.name}"`);
  return p;
});
put<projects.ProjectPatch | null>('/api/projects/:id', async ({ id }, body) => projects.updateProject(id, body || {}));
// ---------- backups: a project with its agents, chats and knowledge, plus every skill and preset ----------
post('/api/projects/:id/backup', async ({ id }) => backup.createBackup(id));
get('/api/backups', async () => ({ dir: backup.backupsRoot(), backups: backup.listBackups() }));
post('/api/backups/open', async () => {
  openWithShell(ensureDir(backup.backupsRoot()));
  return { ok: true };
});
// A new project from a backup: the file as the body, or ?file=<name> for one in the backups folder.
// One at a time: a restore holds the whole unpacked backup in memory.
let restoring = false;
postFile('/api/backups/restore', async (_p, upload, q) => {
  if (restoring) throw new HttpError(409, 'Another backup is being restored. Try again when it is done.');
  restoring = true;
  let r: Awaited<ReturnType<typeof backup.restoreBackup>>;
  try {
    const bytes = q.file ? backup.readBackupFile(q.file) : fs.readFileSync(upload);
    if (!bytes.length) throw new Error('Drop a backup file first.');
    r = await backup.restoreBackup(bytes, { name: q.name, folder: q.folder, description: q.description });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  } finally {
    restoring = false;
  }
  projects.touch(r.project.id);
  launcherPending = false;
  return { ...projects.withLogo(skills.enableOrcaSkill(r.project.id) || r.project), restored: r.restored };
});
del('/api/projects/:id', async ({ id }) => projects.removeProject(id));
// A copy of a project as a new one. Shares the restore's lock: both hold a whole unpacked project in memory.
post<{ name?: string }>('/api/projects/:id/clone', async ({ id }, body) => {
  if (restoring) throw new HttpError(409, 'Another project is being copied or restored. Try again when it is done.');
  restoring = true;
  let r: Awaited<ReturnType<typeof backup.cloneProject>>;
  try {
    r = await backup.cloneProject(id, body.name);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  } finally {
    restoring = false;
  }
  projects.touch(r.project.id);
  return { ...projects.withLogo(skills.enableOrcaSkill(r.project.id) || r.project), restored: r.restored };
});
// Delete a project: back it up, check the backup, then remove it. Not while an agent is working in it.
post('/api/projects/:id/delete', async ({ id }) => {
  if (engines.activeRuns().some((run) => engines.runInfo(run.id)?.projectId === id)) throw new HttpError(409, 'An agent is still working in this project. Stop it first, then delete the project.');
  try {
    return backup.backupAndDeleteProject(id);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
get('/api/brain', async () => projects.brainInfo());
// Where things sit on the Station map (per project), e.g. { bench: { x, z } }.
get('/api/layout', async () => readJSON<Record<string, unknown>>(store.projectData('layout.json'), {}));
put<Body | null>('/api/layout', async (_p, body) => {
  writeJSON(store.projectData('layout.json'), { ...readJSON<Record<string, unknown>>(store.projectData('layout.json'), {}), ...(body || {}) });
  store.emit('layout');
  return { ok: true };
});
post<{ name?: unknown; content?: unknown }>('/api/brain/note', async (_p, body) => ({ file: projects.addNote(body.name, body.content) }));
post('/api/brain/pull', async () => ({ message: await projects.gitPull() }));
post<{ app?: string }>('/api/brain/open', async (_p, body) => {
  const dir = projects.ensureBrain();
  if (body.app === 'vscode') {
    const msg = await programs.launchProgram('vscode', { file: dir });
    return { message: msg };
  }
  openWithShell(dir);
  return { ok: true };
});

// The Brain: pick who handles a message, design a new agent, build a branch.
post<{ text?: unknown }>('/api/assist/route', async (_p, body) => brain.route(String(body.text || '')));
get('/api/assist/model', async () => brain.brainModel());
// The Brain as overseer: ask it anything about the project; it answers or hands the work on.
// The Brain answers agents' and teams' permission requests (Settings > The Brain approves).
setReviewer(overseer.reviewApproval);
post<{ text?: unknown; project?: unknown; attachments?: unknown }>('/api/brain/ask', async (_p, body) => {
  const attachments = uploads.cleanAttachments(body.attachments);
  const text = String(body.text || '').trim().slice(0, 20000);
  if (!text && !attachments.length) throw new HttpError(400, 'Type a message first.');
  return overseer.ask(text, { project: typeof body.project === 'string' ? body.project : null, attachments });
});
// The same, streamed (Vercel AI SDK UI message stream): the answer as it is written, the files the
// Brain reads, then the whole answer (data-answer). The Brain chat reads it with the AI SDK.
post<{ text?: unknown; project?: unknown; attachments?: unknown; goal?: unknown }>('/api/brain/stream', async (_p, body, _q, res) => {
  const attachments = uploads.cleanAttachments(body.attachments);
  const text = String(body.text || '').trim().slice(0, 20000);
  if (!text && !attachments.length) throw new HttpError(400, 'Type a message first.');
  const project = typeof body.project === 'string' ? body.project : null;
  // (refused before the stream starts, so it comes back as an error the chat can show)
  overseer.checkProject(project);
  await uistream.streamBrain(res, (onPart) => overseer.ask(text, { project, attachments, onPart, goal: body.goal === true }));
  return undefined;
});
// a new message while the Brain answers: that answer changes nothing, and what it was answering stays in its history
post('/api/brain/steer', async () => (overseer.steerAsks(), { ok: true }));
// /stop and /resume in the Brain chat (with the agent chats and teams it shows working)
post<commands.BrainWork>('/api/brain/stop', async (_p, body) => commands.stopBrain(body));
post<commands.BrainWork>('/api/brain/resume', async (_p, body) => commands.resumeBrain(body));
get('/api/brain/history', async () => overseer.history());
post('/api/brain/clear', async () => (overseer.clearHistory(), { ok: true }));
get('/api/brain/snapshot', async () => ({ text: await overseer.snapshot() }));
get('/api/brain/pulse', async () => overseer.pulse());
post<{ text?: unknown; attachments?: unknown }>('/api/assist/agent', async (_p, body) => brain.designAgent(String(body.text || ''), { attachments: uploads.cleanAttachments(body.attachments) }));
post<{ text?: unknown; allowNew?: unknown; attachments?: unknown }>('/api/assist/branch', async (_p, body) => brain.designBranch(String(body.text || ''), { allowNew: body.allowNew !== false, attachments: uploads.cleanAttachments(body.attachments) }));
get('/api/headbar', async () => {
  const eng = engines.engineStatus();
  // Codex: asked live, like the sidebar (its session logs can be old or missing; they're only the fallback)
  const ox = await codexEngine.checkedStatus();
  const [usage, connectors, or, cxLimits] = await Promise.all([status.claudeUsage(), status.claudeConnectors().catch(() => []), status.openrouterUsage(store.getSecrets().openrouterKey), ox?.installed && ox.loggedIn ? codexLimits.codexLimits() : null]);

  // One entry per connected provider that reports usage; the header cycles through them.
  const usages = ([
    // Claude Code is always shown when you're signed in; "–" until Anthropic sends numbers
    eng['claude-code'].installed && (usage || eng['claude-code'].loggedIn) && { id: 'claude', name: 'Claude Code', meters: [{ label: 'SESSION', ...(usage?.session || {}) }, { label: 'WEEK', ...(usage?.week || {}) }] },
    or && { id: 'openrouter', name: 'OpenRouter', meters: [or.percent != null ? { label: 'CREDITS', percent: or.percent, text: or.left != null ? `$${or.left.toFixed(2)} left` : null } : null, or.today != null ? { label: 'TODAY', text: `$${or.today.toFixed(2)}` } : null].filter(Boolean) },
    cxLimits && { id: 'codex', name: 'OpenAI Codex', meters: codexLimits.headbarMeters(cxLimits) },
  ] as (ProviderUsage | false | null | undefined)[]).filter((x): x is ProviderUsage => Boolean(x && x.meters.length));
  return { usage, usages, connectors };
});
// The sidebar's usage view: your Claude and Codex plan limits, and Codex's free limit resets.
async function usageLimits(cx: codexLimits.CodexLimits | null = null): Promise<UsageLimits> {
  const eng = engines.engineStatus();
  const cc = eng['claude-code'];
  // (waits for the login check, so a fresh start doesn't say "not signed in" first)
  const ox = await codexEngine.checkedStatus();
  const why = (e: { installed: boolean; loggedIn: boolean }) => (!e.installed ? 'not installed' : !e.loggedIn ? 'not signed in' : undefined);
  const [usage, codex] = await Promise.all([cc.installed ? status.claudeUsage() : null, cx || (ox?.installed && ox.loggedIn ? codexLimits.codexLimits() : null)]);
  const claudeWindows = [usage?.session && { label: '5h', ...usage.session }, usage?.week && { label: 'Week', ...usage.week }].filter((w) => !!w);
  return {
    // signed in through an API key or not at all, Claude Code has no plan limits to show
    claude: { ready: cc.installed && (cc.loggedIn || !!usage), why: why(cc), windows: claudeWindows },
    codex: { ready: !!(ox?.installed && ox.loggedIn), why: ox ? why(ox) : 'not installed', plan: codex?.plan ?? null, windows: codex?.windows || [], blocked: codex?.blocked, resets: codex?.resets ?? null },
  };
}
get('/api/usage-limits', async () => usageLimits());
// Uses one free Codex limit reset (the one that runs out first unless one is named). You click for it.
post<{ creditId?: unknown }>('/api/codex/reset', async (_p, body) => {
  const r = await codexLimits.useCodexReset(typeof body.creditId === 'string' ? body.creditId : null);
  log('codex', r.outcome === 'reset' ? 'Used a free Codex limit reset' : `Codex limit reset not used (${r.outcome})`);
  return { outcome: r.outcome, limits: await usageLimits(r.limits) };
});

// ---------- agents ----------
get('/api/agents', async () => agents.list());
post<Partial<Agent> | null>('/api/agents', async (_p, body) => {
  const { id, ...fields } = body || {};
  return library.newAgent(fields);
});
get('/api/agents/:id', async ({ id }) => {
  const a = need(agents.get(id));
  return { ...a, knowledgeFiles: kb.knowledgeFiles(a).map(({ label, size, own }) => ({ label, size, own })), workspacePath: tools.workspaceOf(a), tools: tools.toolsForAgent(a).map((t) => t.name) };
});
put<Partial<Agent>>('/api/agents/:id', async ({ id }, body) => {
  const a = need(agents.get(id));
  const allowed: (keyof Agent)[] = ['name', 'emoji', 'color', 'specialty', 'description', 'systemPrompt', 'engine', 'model', 'provider', 'claudeAuth', 'hermesProfile', 'openclawAgent', 'autonomy', 'toolGroups', 'mcpServers', 'knowledge', 'workspace', 'temperature', 'effort', 'pinned', 'alwaysAllow', 'skills', 'richAnswers'];
  for (const k of allowed) if (k in body) (a as Record<keyof Agent, unknown>)[k] = body[k];
  if ('effort' in body) a.effort = isEffort(body.effort) ? body.effort : '';
  return agents.save(a);
});
del('/api/agents/:id', async ({ id }) => {
  const gone = need(agents.get(id));
  agents.remove(id);
  log('agent', `Deleted agent ${gone.name}`, { agentId: id });
  // and take it off every branch it was on
  for (const wf of workflows.list()) {
    const steps = (wf.steps || []).filter((s) => !(s.type === 'agent' && s.agentId === id));
    const members = teams.normalize({ ...wf }).members; // without the deleted agent (old step lists too)
    if (steps.length !== (wf.steps || []).length || members.length !== (wf.members || []).length) workflows.save({ ...wf, steps, members, lead: wf.lead === id ? null : wf.lead });
  }
  return { ok: true };
});
post('/api/agents/:id/duplicate', async ({ id }) => {
  const a = need(agents.get(id));
  const { id: _i, createdAt, updatedAt, ...rest } = a;
  return library.newAgent({ ...rest, name: `${a.name} (copy)` });
});
post('/api/agents/:id/export-claude', async ({ id }) => ({ file: library.exportToClaude(need(agents.get(id))) }));
post('/api/agents/:id/open-workspace', async ({ id }) => {
  openWithShell(tools.workspaceOf(need(agents.get(id))));
  return { ok: true };
});

// knowledge
post<{ folder?: string; url?: string; name?: string; content?: string }>('/api/agents/:id/knowledge', async ({ id }, body) => {
  need(agents.get(id));
  if (body.folder) {
    const a = agents.get(id)!;
    if (!exists(body.folder)) throw new HttpError(400, `${body.folder} does not exist.`);
    a.knowledge = { folders: [...new Set([...(a.knowledge?.folders || []), body.folder])] };
    agents.save(a);
    return { ok: true };
  }
  if (body.url) {
    const url = body.url;
    // (the download takes a while: the file goes to this project's agent, whichever project is open by then)
    return store.withProject(store.activeProject(), async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      const name = body.name || new URL(url).hostname + new URL(url).pathname.replace(/\W+/g, '_') + '.md';
      return { file: kb.addKnowledgeFile(id, name, `Source: ${url}\n\n${/html/.test(res.headers.get('content-type') || '') ? text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ') : text}`) };
    });
  }
  return { file: kb.addKnowledgeFile(id, body.name, body.content || '') };
});
del('/api/agents/:id/knowledge', async ({ id }, _b, q) => {
  const a = need(agents.get(id));
  if (q.folder) {
    a.knowledge = { folders: (a.knowledge?.folders || []).filter((f) => f !== q.folder) };
    agents.save(a);
  } else kb.removeKnowledgeFile(id, q.label);
  return { ok: true };
});

// chats
get('/api/agents/:id/chats', async ({ id }) => chats.list(id));
post('/api/agents/:id/chats', async ({ id }) => chats.create(need(agents.get(id)).id));
// (with your /queue messages still waiting, and your /loop and /goal there)
get('/api/agents/:id/chats/:cid', async ({ id, cid }) => ({ ...need(chats.get(id, cid)), queued: engines.queuedMessages(cid), loop: engines.loopOf(cid), goal: openGoal('agent', id, cid) }));
del('/api/agents/:id/chats/:cid', async ({ id, cid }) => {
  engines.forgetChat(cid);
  chats.remove(id, cid);
  return { ok: true };
});
put<{ title?: unknown; reset?: unknown }>('/api/agents/:id/chats/:cid', async ({ id, cid }, body) => {
  // While a run is going, change the copy it is writing so the edit sticks.
  const c = engines.liveChat(cid) || need(chats.get(id, cid));
  if (body.title) c.title = String(body.title).slice(0, 120);
  if (body.reset) engines.resetMemory(c);
  return chats.save(c);
});
post<{ text?: unknown; attachments?: unknown }>('/api/agents/:id/chats/:cid/messages', async ({ id, cid }, body) => {
  const a = need(agents.get(id));
  const c = need(chats.get(id, cid));
  const text = String(body.text || '').trim();
  const attachments = uploads.cleanAttachments(body.attachments);
  if (!text && !attachments.length) throw new HttpError(400, 'Type a message first.');
  // "/compact" (or "/compact summary", "/compact instant") compacts the chat instead of sending a message
  const cmd = attachments.length ? null : /^\/compact(?:\s+(instant|summary))?\s*$/i.exec(text);
  if (cmd) return compactResult(await engines.compactNow(a, c.id, cmd[1]?.toLowerCase() as 'instant' | 'summary' | undefined));
  // "/queue …" waits until the agent is done here (or goes now)
  const queued = queuedText(text);
  if (queued != null) return queueIn(a, c, queued, attachments);
  const { runId } = engines.startRun(a, c, text, { attachments });
  return { runId };
});
// /queue: a message that goes once the agent is done in this chat (now, if it isn't working)
function queueIn(a: Agent, c: Chat, text: string, attachments: string[]) {
  if (!text && !attachments.length) throw new HttpError(400, 'Write the message after /queue.');
  return engines.queueMessage(a, c, text, attachments);
}
post<{ text?: unknown; attachments?: unknown }>('/api/agents/:id/chats/:cid/queue', async ({ id, cid }, body) =>
  queueIn(need(agents.get(id)), need(chats.get(id, cid)), String(body.text || '').trim(), uploads.cleanAttachments(body.attachments)),
);
del('/api/agents/:id/chats/:cid/queue/:qid', async ({ cid, qid }) => ({ unqueued: engines.unqueue(cid, qid) }));
// a queued message: its text changed, or the order they go in
// (queued: null when it already went)
put<{ text?: unknown }>('/api/agents/:id/chats/:cid/queue/:qid', async ({ cid, qid }, body) => ({ queued: engines.editQueued(cid, qid, body.text) }));
post<{ ids?: unknown }>('/api/agents/:id/chats/:cid/queue/order', async ({ cid }, body) => ({ queued: engines.orderQueued(cid, body.ids) }));
// the other / commands (server/commands.ts)
post('/api/agents/:id/chats/:cid/resend', async ({ id, cid }) => commands.resendInChat(id, cid));
post('/api/agents/:id/chats/:cid/resume', async ({ id, cid }) => commands.resumeInChat(id, cid));
post<{ text?: unknown; attachments?: unknown }>('/api/agents/:id/chats/:cid/loop', async ({ id, cid }, body) => commands.loopInChat(id, cid, String(body.text ?? ''), uploads.cleanAttachments(body.attachments)));
del('/api/agents/:id/chats/:cid/loop', async ({ cid }) => ({ ok: engines.stopLoop(cid, 'Loop stopped.') }));
post<{ text?: unknown }>('/api/agents/:id/chats/:cid/goal', async ({ id, cid }, body) => commands.goalInChat(id, cid, String(body.text ?? '').trim().slice(0, 4000)));
del('/api/agents/:id/chats/:cid/goal', async ({ id, cid }) => commands.goalInChat(id, cid, 'clear'));
// the harness's own / commands (a Claude Code agent's), for the / menu
get('/api/agents/:id/commands', async ({ id }) => commands.harnessCommands(need(agents.get(id)).id));
// The chat views (Vercel AI SDK useChat): send a message and stream its run as a UI message stream,
// or pick up the run going in a chat (the turn so far, then the rest; 204 when nothing runs).
// steer: sent while it works, it stops the run going now and goes next (its /queue messages still wait).
post<{ text?: unknown; attachments?: unknown; steer?: unknown }>('/api/agents/:id/chats/:cid/stream', async ({ id, cid }, body, _q, res) => {
  const a = need(agents.get(id));
  const c = need(chats.get(id, cid));
  const text = String(body.text || '').trim();
  const attachments = uploads.cleanAttachments(body.attachments);
  if (!text && !attachments.length) throw new HttpError(400, 'Type a message first.');
  const { runId } = body.steer === true ? await engines.steerChat(a, c, text, { attachments }) : engines.startRun(a, c, text, { attachments });
  await uistream.streamRun(res, { chatId: c.id, runId, waiting: `Waiting for ${a.name} to stop…` });
  return undefined;
});
get('/api/agents/:id/chats/:cid/stream', async ({ id, cid }, _b, _q, res) => {
  const runId = engines.chatRunId(id, cid);
  if (!runId) {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return undefined;
  }
  await uistream.streamRun(res, { chatId: cid, runId, items: engines.liveChat(cid)?.items || [] });
  return undefined;
});
// Compaction: the Compact button, the memory meter, and editing the compacted history
const compactResult = ({ item }: Awaited<ReturnType<typeof engines.compactNow>>) => ({ compacted: !!item, item, ...(item ? {} : { message: 'Nothing to compact yet: the chat is short enough to keep in full.' }) });
post<{ mode?: unknown }>('/api/agents/:id/chats/:cid/compact', async ({ id, cid }, body) =>
  compactResult(await engines.compactNow(need(agents.get(id)), cid, body.mode === 'summary' || body.mode === 'instant' ? body.mode : undefined)),
);
get('/api/agents/:id/chats/:cid/memory', async ({ id, cid }) => engines.memoryOf(need(agents.get(id)), cid));
put<{ text?: unknown }>('/api/agents/:id/chats/:cid/compactions/:kid', async ({ id, cid, kid }, body) => engines.editCompaction(id, cid, kid, String(body.text ?? '')));
post('/api/agents/:id/chats/:cid/stop', async ({ cid }) => {
  // the /queue messages come back to you (they'd otherwise start as soon as it stopped); a loop ends
  const unqueued = engines.unqueue(cid);
  engines.stopLoop(cid, 'Loop stopped.');
  engines.stopChat(cid);
  return { ok: true, unqueued };
});
get('/api/runs', async () => engines.activeRuns());
post('/api/runs/:id/stop', async ({ id }) => ({ ok: engines.stopRun(id) }));

// ---------- approvals ----------
get('/api/approvals', async () => listApprovals());
post<Parameters<typeof decide>[1] | null>('/api/approvals/:id', async ({ id }, body) => ({ ok: decide(id, body || {}) }));

// ---------- skills ----------
get('/api/skills', async () => ({ skills: skills.listSkills(), claude: skills.claudeSkills() }));
get('/api/skills/:slug', async ({ slug }) => need(skills.getSkill(slug)));
post<Parameters<typeof skills.saveSkill>[0] | null>('/api/skills', async (_p, body) => {
  const s = skills.saveSkill(body || {});
  log('skill', `Saved the skill "${s!.name}"`);
  return s;
});
put<Parameters<typeof skills.saveSkill>[0] | null>('/api/skills/:slug', async ({ slug }, body) => skills.saveSkill({ ...(body || {}), slug }));
del('/api/skills/:slug', async ({ slug }) => {
  // and take it off every agent, team and project that had it, and the Brain
  skills.deleteSkillEverywhere(slug);
  return { ok: true };
});
// The Brain's own skills (part of its instructions; Self-improvement also has it learn from finished work)
// A skill written or changed from plain words: a draft for the editor, saved only when you press Save.
// slug: the skill being edited (for its files); current: what the editor holds now (unsaved changes too).
post<{ text?: unknown; slug?: unknown; current?: unknown; attachments?: unknown }>('/api/assist/skill', async (_p, body) => {
  const text = String(body.text || '').trim().slice(0, 8000);
  const attachments = uploads.cleanAttachments(body.attachments);
  if (!text && !attachments.length) throw new HttpError(400, 'Say what the skill should do, or what to change.');
  const c = (body.current && typeof body.current === 'object' ? body.current : null) as Record<string, unknown> | null;
  const saved = typeof body.slug === 'string' ? skills.getSkill(body.slug) : null;
  const field = (k: 'name' | 'description' | 'body', max: number) => (typeof c?.[k] === 'string' ? (c[k] as string) : saved?.[k] || '').slice(0, max);
  const now = { name: field('name', 80), description: field('description', 1000), body: field('body', 60000) };
  // nothing written yet (a new skill's empty editor): a new skill, not an edit of an empty one
  const current = now.name.trim() || now.description.trim() || now.body.trim() ? now : null;
  return brain.draftSkill(text, {
    current,
    files: saved?.files.map((f) => f.path) || [],
    others: skills.listSkills().filter((s) => s.slug !== saved?.slug),
    attachments,
  });
});
get('/api/brain/skills', async () => ({ skills: skills.brainSkillSlugs() }));
put<{ skills?: unknown }>('/api/brain/skills', async (_p, body) => ({ skills: skills.setBrainSkills(body?.skills) }));
post<{ name: string }>('/api/skills/import', async (_p, body) => skills.importClaudeSkill(body.name));
post<{ url?: unknown }>('/api/skills/install', async (_p, body) => skillInstall.installFromGitHub(String(body.url || '')));

// ---------- MEMORY.md: each agent's and the Brain's ("brain") ----------
const memoryOwner = (owner: string): string => {
  if (owner !== memory.BRAIN && !agents.get(owner)) throw new HttpError(404, 'No agent by that id.');
  return owner;
};
get('/api/memory/:owner', async ({ owner }) => memory.memoryInfo(memoryOwner(owner)));
put<{ text?: unknown } | null>('/api/memory/:owner', async ({ owner }, body) => {
  if (typeof body?.text !== 'string') throw new HttpError(400, 'Send the whole MEMORY.md as text.');
  const before = memory.memoryStamp(memoryOwner(owner));
  const m = memory.writeMemory(owner, body.text);
  if (m.updatedAt !== Math.round(before)) log('memory', `You edited ${memory.memoryTitle(owner)}`, owner === memory.BRAIN ? {} : { agentId: owner });
  return m;
});

// ---------- the voxel world (server/voxel, docs/internal/plans/VOXEL_WORLD_PLAN.md) ----------
const you: WorldBuilder = { kind: 'user', name: 'You' };
const projectName = (id?: string) => (id ? store.listProjects().find((p) => p.id === id)?.name : undefined);
get('/api/world', async () => {
  const s = worldLink.shownWorld();
  return { ...s, fromProjectName: projectName(s.fromProject) };
});
get('/api/worlds/:wid/objects/:oid', async ({ wid, oid }) => {
  const data = worldStore.readObject(wid, oid);
  if (!data) throw new HttpError(404, 'No such object.');
  return data;
});
get('/api/worlds/:wid/prefabs/:pid', async ({ wid, pid }) => {
  const data = worldStore.readPrefab(wid, pid);
  if (!data) throw new HttpError(404, 'No such prefab.');
  return data;
});
put<Record<string, unknown> | null>('/api/world/objects/:oid', async ({ oid }, body) => worldBuild.changeObject({ ...(body || {}), delete: false, duplicate: false, object: oid, by: you }).object);
del('/api/world/objects/:oid', async ({ oid }) => (worldBuild.changeObject({ object: oid, delete: true, by: you }), { ok: true }));
post<{ anyone?: unknown } | null>('/api/world/undo', async (_p, body) => worldBuild.undo(you, { anyone: body?.anyone !== false }));
get('/api/world/md', async () => {
  const w = worldLink.shownWorld().world;
  if (!w) throw new HttpError(404, 'No world yet.');
  return worldMd.worldMdInfo(w.id);
});
put<{ text?: unknown } | null>('/api/world/md', async (_p, body) => {
  if (typeof body?.text !== 'string') throw new HttpError(400, 'Send the whole WORLD.md as text.');
  // (a carried-over world becomes this project's own first: you are changing it)
  const w = worldLink.worldForBuild();
  const m = worldMd.writeWorldMd(w.id, body.text);
  log('world', 'You edited WORLD.md');
  return m;
});
put<Record<string, unknown> | null>('/api/world/environment', async (_p, body) => worldScene.setEnvironment({ by: you, fields: body || {} }).world);
// a picture an open Station made for world_look
post<{ image?: unknown; error?: unknown } | null>('/api/world/snapshot/:request', async ({ request }, body) => ({ ok: worldLook.deliverLook(request, body || {}) }));
// WORLD.md's earlier versions
const shownWorldId = () => {
  const w = worldLink.shownWorld().world;
  if (!w) throw new HttpError(404, 'No world yet.');
  return w.id;
};
get('/api/world/md/versions', async () => listVersions<{ text: string }>(worldMd.worldMdVersionsDir(shownWorldId())).map((v) => ({ id: v.id, at: v.at, by: v.by, note: v.note, chars: v.item.text.length })));
get('/api/world/md/versions/:vid', async ({ vid }) => {
  const v = getVersion<{ text: string }>(worldMd.worldMdVersionsDir(shownWorldId()), vid);
  if (!v) throw new HttpError(404, 'No such version.');
  return v;
});
post('/api/world/md/versions/:vid/restore', async ({ vid }) => {
  const v = getVersion<{ text: string }>(worldMd.worldMdVersionsDir(shownWorldId()), vid);
  if (!v) throw new HttpError(404, 'No such version.');
  const m = withActor('you', () => worldMd.writeWorldMd(worldLink.worldForBuild().id, v.item.text), { note: `restored the version from ${new Date(v.at).toLocaleString()}`, force: true });
  log('world', 'You restored an earlier WORLD.md');
  return m;
});
get('/api/world/changes', async () => worldBuild.recentChanges(shownWorldId(), 50));
get('/api/world/prefabs', async () => {
  const w = worldLink.shownWorld().world;
  if (!w) return [];
  const uses = worldPrefabs.prefabUses(w);
  return w.prefabs.map((p) => ({ ...p, uses: uses.get(p.id) || null }));
});
put<Record<string, unknown> | null>('/api/world/prefabs/:pid', async ({ pid }, body) => worldPrefabs.changePrefab({ by: you, prefab: pid, name: body?.name, description: body?.description, tags: body?.tags }).prefab);
del('/api/world/prefabs/:pid', async ({ pid }) => ({ text: worldPrefabs.deletePrefab({ by: you, prefab: pid }) }));
put<Record<string, unknown> | null>('/api/world/lights/:lid', async ({ lid }, body) => worldScene.setLight({ by: you, action: 'change', light: lid, fields: body || {} }).light);
del('/api/world/lights/:lid', async ({ lid }) => (worldScene.setLight({ by: you, action: 'remove', light: lid }), { ok: true }));
put<Record<string, unknown> | null>('/api/world/effects/:eid', async ({ eid }, body) => worldScene.setEffect({ by: you, action: 'change', effect: eid, fields: body || {} }).effect);
del('/api/world/effects/:eid', async ({ eid }) => (worldScene.setEffect({ by: you, action: 'remove', effect: eid }), { ok: true }));
// files out of the world (to Artifacts and the project folder's exports/), and pictures from the page
const exportsDir = () => path.join(projects.ensureBrain(), 'exports');
post<{ what?: unknown; id?: unknown; format?: unknown } | null>('/api/world/export', async (_p, body) => {
  const w = worldLink.shownWorld().world;
  if (!w) throw new HttpError(404, 'No world yet.');
  const what = String(body?.what || '');
  if (what !== 'object' && what !== 'prefab' && what !== 'world') throw new HttpError(400, 'what is object, prefab or world.');
  const out = worldExchange.exportFiles(w, what, typeof body?.id === 'string' ? body.id : undefined, body?.format === 'vox' ? 'vox' : 'glb');
  const paths = worldExchange.writeFiles(exportsDir(), out.files);
  const made = paths.map((p) => addArtifact({ title: out.files.length > 1 ? `${out.title}: ${path.basename(p)}` : out.title, path: p, note: out.note || 'Made from the voxel world', by: 'You' }));
  return { paths, artifacts: made.map((a) => a.id), note: out.note };
});
post<{ image?: unknown; name?: unknown } | null>('/api/world/picture', async (_p, body) => {
  const w = worldLink.shownWorld().world;
  const file = worldExchange.writePicture(exportsDir(), String(body?.name || w?.name || 'world'), String(body?.image || ''));
  const a = addArtifact({ title: `${w?.name || 'The world'}: a picture`, path: file, note: 'A picture of the voxel world', by: 'You' });
  return { path: file, artifact: a.id };
});
get('/api/prefab-library', async (_p, _b, q) => worldPrefabs.libraryItems(String(q.q || '')));
post<{ name?: unknown; as?: unknown } | null>('/api/world/prefabs/import', async (_p, body) => worldPrefabs.importPrefab({ by: you, name: String(body?.name || ''), as: body?.as }).prefab);
post('/api/world/prefabs/:pid/publish', async ({ pid }) => ({ text: worldPrefabs.publishPrefab({ by: you, prefab: pid }) }));
// how the Brain, a team or an agent looks (e.g. put a hidden agent back on the map)
put<{ to?: unknown; id?: unknown; fields?: unknown } | null>('/api/world/skins', async (_p, body) => {
  const to = String(body?.to || '');
  if (to !== 'agent' && to !== 'team' && to !== 'brain') throw new HttpError(400, 'to is agent, team or brain.');
  return worldCharacters.setSkin({ by: you, to, id: typeof body?.id === 'string' ? body.id : undefined, fields: body?.fields && typeof body.fields === 'object' ? (body.fields as Record<string, unknown>) : {} }).world.skins;
});
get('/api/worlds', async () => worldLink.listWorldsFor());
put<{ worldId?: unknown; mode?: unknown } | null>('/api/project-world', async (_p, body) => {
  const mode = String(body?.mode || '');
  if (!['share', 'copy', 'new', 'auto'].includes(mode)) throw new HttpError(400, 'mode is share, copy, new or auto.');
  return worldLink.chooseWorld(store.activeProject().id, mode as worldLink.WorldChoice, typeof body?.worldId === 'string' ? body.worldId : null);
});
put<{ worldId?: unknown } | null>('/api/worlds/default', async (_p, body) => (worldLink.setDefaultWorld(typeof body?.worldId === 'string' && body.worldId ? body.worldId : null), { ok: true }));
put<{ name?: unknown } | null>('/api/worlds/:wid', async ({ wid }, body) => worldLink.renameWorld(wid, body?.name));
del('/api/worlds/:wid', async ({ wid }) => (worldLink.deleteUnusedWorld(wid), { ok: true }));

// ---------- versions of skills, agents, teams and MEMORY.md files ----------
const versionKind = (k: string): VersionKind => {
  if (!history.isVersionKind(k)) throw new HttpError(404, 'Versions are kept for skills, agents, teams and MEMORY.md files.');
  return k;
};
get('/api/versions/:kind', async ({ kind }) => history.deletedItems(versionKind(kind)));
post('/api/versions/:kind/:id/undelete', async ({ kind, id }) => history.undelete(versionKind(kind), id));
get('/api/versions/:kind/:id', async ({ kind, id }) => history.historyOf(versionKind(kind), id));
get('/api/versions/:kind/:id/:vid', async ({ kind, id, vid }) => history.versionOf(versionKind(kind), id, vid));
post('/api/versions/:kind/:id/:vid/restore', async ({ kind, id, vid }) => history.restoreVersion(versionKind(kind), id, vid));

// ---------- presets & clones ----------
get('/api/presets', async () => presets.listPresets());
post<Parameters<typeof presets.saveAgentPreset>[1] | null>('/api/presets/agent/:id', async ({ id }, body) => presets.saveAgentPreset(id, body || {}));
post<Parameters<typeof presets.saveTeamPreset>[1] | null>('/api/presets/team/:id', async ({ id }, body) => presets.saveTeamPreset(id, body || {}));
post('/api/presets/:id/use', async ({ id }) => presets.usePreset(id));
del('/api/presets/:id', async ({ id }) => (presets.deletePreset(id), { ok: true }));
post<{ withAgents?: unknown } | null>('/api/workflows/:id/clone', async ({ id }, body) => presets.cloneTeam(id, { withAgents: !!body?.withAgents }));

// ---------- library ----------
get('/api/library', async () => ({ ...(await library.libraryIndex()), starters: library.STARTERS.map(({ name, emoji, specialty }) => ({ name, emoji, specialty })) }));
get('/api/library/agency/:slug', async ({ slug }) => {
  const a = need(library.agencyAgents().find((x) => x.slug === slug));
  return { ...a, body: fs.readFileSync(a.file, 'utf8') };
});
post<{ source?: string; slug: string; profile: string; name: string; overrides?: Partial<Agent> }>('/api/library/hire', async (_p, body) => {
  const o = body.overrides || {};
  if (body.source === 'agency') return library.hireFromAgency(body.slug, o);
  if (body.source === 'hermes') return library.hireHermesProfile(body.profile, o);
  if (body.source === 'claude') return library.importClaudeSubagent(body.slug);
  if (body.source === 'starter') return library.createStarter(body.name, o);
  throw new HttpError(400, 'Unknown library source');
});

// ---------- models ----------
get('/api/models', async (_p, _b, q) => {
  if (q.engine === 'claude-code') return CLAUDE_MODELS;
  if (q.engine === 'hermes') return [];
  if (q.engine === 'codex') return codexModelList();
  if (q.engine === 'pi' || q.engine === 'omp') return piEngine.listModels(q.engine).catch(() => []);
  if (q.engine === 'openclaw') return openclawEngine.listModels().catch(() => []);
  return listModels(q.provider || 'openrouter');
});
get('/api/providers', async () => Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label })));
get('/api/hermes/profiles', async () => listProfiles());
get('/api/openclaw/agents', async () => openclawEngine.listAgents().catch(() => []));
// OpenAI Codex: install the CLI (npm) and check its sign-in.
post('/api/codex/install', async () => {
  const r = await run('npm', ['install', '-g', '@openai/codex'], { timeout: 10 * 60_000 });
  clearWhichCache();
  codexEngine.refreshStatus();
  if (r.code !== 0) throw new HttpError(500, (r.stderr || r.stdout).trim().slice(-600) || 'npm install failed');
  log('system', 'Installed OpenAI Codex CLI');
  return { message: 'Codex installed. Now sign in.' };
});
post('/api/codex/refresh', async () => {
  clearWhichCache();
  codexEngine.refreshStatus();
  codexEngine.status();
  await new Promise((r) => setTimeout(r, 3500));
  return codexEngine.status();
});

// ---------- tools & programs ----------
get('/api/tools', async () => ({ groups: tools.TOOL_GROUPS, tools: tools.allTools() }));
get('/api/programs', async (_p, _b, q) => programs.discoverPrograms(!!q.force));
get('/api/programs/all', async () => programs.startMenuApps(true));
post<{ program: string; file?: string }>('/api/programs/launch', async (_p, body) => {
  const msg = await programs.launchProgram(body.program, { file: body.file });
  log('program', msg);
  return { message: msg };
});
post<{ target: string }>('/api/programs/open', async (_p, body) => {
  openWithShell(body.target);
  return { ok: true };
});

// ComfyUI
get('/api/comfyui', async () => ({ status: await comfy.queueStatus(), workflows: comfy.listWorkflows().map(({ name, dir }) => ({ name, dir })) }));
get('/api/comfyui/describe', async (_p, _b, q) => comfy.describeWorkflow(q.workflow));
post<{ workflow: string; prompt?: string; negative?: string; inputs?: Record<string, unknown> }>('/api/comfyui/run', async (_p, body) => comfy.runWorkflow({ workflow: body.workflow, prompt: body.prompt || undefined, negative: body.negative || undefined, inputs: body.inputs || {} }));
post('/api/comfyui/start', async () => ({ message: await comfy.startComfy() }));
post<{ name: string; json: unknown }>('/api/comfyui/workflows', async (_p, body) => ({ file: comfy.saveApiWorkflow(body.name, body.json) }));

// ---------- attached files (saved in the Brain folder's uploads/) ----------
// One folder per drop; then each file is sent raw to POST /api/uploads/<batch>?path=<relative path> (handled below the router).
post('/api/uploads', async () => uploads.newBatch());
del('/api/uploads', async (_p, _b, q) => ({ ok: uploads.removeUpload(q.path) }));

// Files the browser may show: workspaces, outputs, knowledge, ComfyUI outputs, allowed folders.
get('/api/file', async (_p, _b, q, res) => {
  // links are followed before checking, so a link in a workspace can't serve files from elsewhere
  const p = insideRoots(path.resolve(String(q.path || '')), files.viewRoots());
  if (!p) throw new HttpError(403, 'That file is outside the dashboard folders.');
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    throw new HttpError(404, 'File not found');
  }
  if (!st.isFile()) throw new HttpError(400, 'That is a folder, not a file.');
  sendFileSafely(res, p);
  return undefined;
});

// Files a chat mentions: whether each is there and what it is (for its preview), and Show in Explorer / Finder.
post<{ paths?: unknown }>('/api/files/info', async (_p, body) => files.fileInfo(body.paths));
post<{ path?: unknown }>('/api/files/reveal', async (_p, body) => {
  files.reveal(body.path);
  return { ok: true };
});

// Agent-made files are shown, never run: only media display inline; everything else downloads, sandboxed.
function sendFileSafely(res: http.ServerResponse, p: string, type = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream') {
  const inline = /^(image\/(png|jpeg|webp|gif)|video\/|audio\/)/.test(type);
  res.writeHead(200, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox; default-src none',
    ...(inline ? {} : { 'content-disposition': `attachment; filename="${path.basename(p).replace(/[^\w.\- ]/g, '_')}"` }),
  });
  const stream = fs.createReadStream(p);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// ---------- MCP ----------
get('/api/mcp', async () => {
  const servers = mcp.listServers();
  // (keys, logins and the bridge's token stay hidden here: POST /api/mcp-bridge gives the bridge config to copy)
  const bridge = mcp.bridgeServerConfig('');
  return {
    servers: mcp.hiddenServers(servers),
    info: mcp.serverInfo(servers),
    presets: mcp.presetAvailability(servers),
    suggested: mcp.suggestPresets(await programs.discoverPrograms(), servers),
    importable: mcp.importableServers().map((s) => mcp.hideSecrets(s)),
    bridge: { ...bridge, env: { ...bridge.env, DASH_TOKEN: mcp.HIDDEN } },
  };
});
post('/api/mcp-bridge', async () => mcp.bridgeServerConfig(''));
post<Parameters<typeof mcp.saveServer>[1] & { name: string }>('/api/mcp', async (_p, body) => mcp.saveServer(body.name, body));
del('/api/mcp/:name', async ({ name }) => {
  // (and off every agent and team that had it)
  mcp.removeServerEverywhere(name);
  return { ok: true };
});
post('/api/mcp/:name/test', async ({ name }) => ({ tools: await mcp.testServer(name) }));
// another copy of a service needs a label; "others" sets the label and "use for" of the copies already there
post<{ name?: string; label?: string; useFor?: string; others?: Record<string, { label?: string; useFor?: string }> }>('/api/mcp-preset', async (_p, body) => {
  const pr = need(mcp.PRESETS.find((x) => x.name === body.name), 'Unknown preset');
  const made = mcp.addPreset(pr.name, { label: body.label, useFor: body.useFor });
  // (only label and "use for" change: the copies' connections stay open, and an unchanged one isn't saved)
  const servers = mcp.listServers();
  for (const [name, notes] of Object.entries(body.others || {})) if (name !== made.name && servers[name]) mcp.describeCopy(name, { label: notes?.label, useFor: notes?.useFor });
  return made;
});
post<{ name?: string; source?: string }>('/api/mcp-import', async (_p, body) => {
  const it = need(mcp.importableServers().find((x) => x.name === body.name && x.source === body.source), 'Not found');
  return mcp.saveServer(it.name, it);
});
post('/api/hermes/add-bridge', async () => {
  const cfg = mcp.bridgeServerConfig('');
  const r = await run('hermes', ['mcp', 'add', 'dashboard', '--command', cfg.command, '--env', `DASH_PORT=${PORT}`, `DASH_TOKEN=${internalToken()}`, '--args', ...cfg.args], { timeout: 120000, input: 'y\n' });
  if (r.code !== 0) throw new HttpError(500, (r.stderr || r.stdout).trim().slice(-800) || 'hermes mcp add failed');
  log('mcp', 'Gave Hermes the dashboard tools (hermes mcp add dashboard)');
  return { message: (r.stdout || 'Added.').trim().slice(-800) };
});
// pi and oh-my-pi: the bridge goes in their own mcp.json (neither takes MCP servers per run)
post<{ flavor?: string }>('/api/pi/add-bridge', async (_p, body) => {
  const flavors: piEngine.PiFlavor[] = body.flavor === 'pi' || body.flavor === 'omp' ? [body.flavor] : (['pi', 'omp'] as const).filter((f) => which(f));
  if (!flavors.length) throw new HttpError(400, 'Neither pi nor oh-my-pi is installed on this PC.');
  const files: string[] = [];
  for (const f of flavors) {
    try {
      files.push(piEngine.addBridge(f));
    } catch (e) {
      throw new HttpError(500, (e as Error).message);
    }
  }
  log('mcp', `Gave ${flavors.map((f) => (f === 'pi' ? 'pi' : 'oh-my-pi')).join(' and ')} the dashboard tools (${files.join(', ')})`);
  return { message: `Added to ${files.join(' and ')}. New ${flavors.includes('pi') ? 'pi' : 'oh-my-pi'} sessions have the dashboard tools.`, files };
});

// ---------- settings ----------
get('/api/settings', async () => ({ settings: getSettings(), secrets: secretStatus() }));
put<Parameters<typeof saveSettings>[0] | null>('/api/settings', async (_p, body) => saveSettings(body || {}));
post<{ key: string; value?: unknown }>('/api/secrets', async (_p, body) => {
  const okKeys: string[] = ['openrouterKey', 'anthropicKey', 'customKey', 'xClientSecret', 'telegramBotToken', 'discordWebhook', 'redditClientSecret'];
  if (!okKeys.includes(body.key)) throw new HttpError(400, 'Unknown key');
  setSecret(body.key as SecretKey, String(body.value || '').trim());
  return secretStatus();
});
post('/api/settings/test-openrouter', async () => {
  const key = store.getSecrets().openrouterKey;
  if (!key) throw new HttpError(400, 'No OpenRouter key saved.');
  const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` } });
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string }; data?: unknown };
  if (!r.ok) throw new HttpError(400, j.error?.message || `OpenRouter said ${r.status}`);
  return j.data || j;
});

// ---------- social ----------
get('/api/accounts', async () => social.listAccounts());
post<{ autopost?: boolean }>('/api/accounts/x/:id', async ({ id }, body) => {
  if ('autopost' in body) social.setAutopost(id, body.autopost);
  return social.listAccounts();
});
del('/api/accounts/x/:id', async ({ id }) => {
  social.disconnectX(id);
  return social.listAccounts();
});
get('/api/accounts/x/:id/posts', async ({ id }) => social.xRecentPosts(id, 10));
post<{ autopost?: boolean }>('/api/accounts/reddit/:id', async ({ id }, body) => {
  if ('autopost' in body) reddit.setRedditAutopost(id, body.autopost);
  return social.listAccounts();
});
del('/api/accounts/reddit/:id', async ({ id }) => {
  reddit.disconnectReddit(id);
  return social.listAccounts();
});
post<{ platform?: string }>('/api/social/test', async (_p, body) => ({ message: body.platform === 'discord' ? await social.sendDiscord('Test from Blacksite ✅') : await social.sendTelegram('Test from Blacksite ✅') }));

get('/api/artifacts', async () => artifactStore.list().sort((a, b) => b.createdAt! - a.createdAt!));
del('/api/artifacts/:id', async ({ id }) => {
  removeArtifact(id);
  return { ok: true };
});
get('/api/outbox', async () => outbox.list().sort((a, b) => b.createdAt! - a.createdAt!));
post<Parameters<typeof social.draftPost>[0]>('/api/outbox', async (_p, body) => social.draftPost({ platform: body.platform || 'x', account: body.account, text: body.text, thread: body.thread, images: body.images, to: body.to, agentName: 'You' }));
post<Parameters<typeof social.approvePost>[1]>('/api/outbox/:id/approve', async ({ id }, body) => social.approvePost(id, body));
post<{ text?: string }>('/api/outbox/:id/discuss', async ({ id }, body) => social.returnPost(id, String(body.text || ''), (teamId, text) => teams.postUserMessage(teamId, text, { route: brain.pickMember })));
post<{ reason?: string }>('/api/outbox/:id/reject', async ({ id }, body) => social.rejectPost(id, body.reason));
put<{ parts?: string[]; images?: string[]; title?: string }>('/api/outbox/:id', async ({ id }, body) => {
  const it = need(outbox.get(id));
  if (body.parts) it.parts = body.parts;
  // images can be taken off a draft here, not added (adding goes through the checks in draftPost)
  if (body.images && it.images) it.images = it.images.filter((p) => body.images!.includes(p));
  if (body.title != null && it.reddit) it.reddit.title = String(body.title).trim();
  return outbox.save(it);
});
// questions agents asked you (ask_user): answer with a choice, your own words, or both
get('/api/questions', async () => store.questions.list().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 100));
post<{ choice?: string; text?: string }>('/api/questions/:id/answer', async ({ id }, body) => questions.answerQuestion(id, { choice: body.choice, text: body.text }));
post('/api/questions/:id/dismiss', async ({ id }) => questions.dismissQuestion(id));
del('/api/questions/:id', async ({ id }) => {
  questions.removeQuestion(id);
  return { ok: true };
});
del('/api/outbox/:id', async ({ id }) => {
  outbox.remove(id);
  return { ok: true };
});

// ---------- workflows ----------
get('/api/workflows', async () =>
  teams
    .listTeams()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ ...t, state: teams.teamState(t.id), last: teams.getThread(t.id, 1).messages[0] || null })),
);
// a team's files: only uploads of this project
const teamFiles = (body: Partial<Team>): Partial<Team> => ('files' in body ? { ...body, files: uploads.cleanAttachments(body.files) } : body);
// a team's symbol: only an emoji comes in through here (a picture or model has its own route, so saving a team can't point it at another file)
const teamMark = (body: Partial<Team>): Partial<Team> => {
  const { markFile: _ignored, ...rest } = body;
  return 'mark' in rest ? { ...rest, mark: teamMarks.cleanMark(rest.mark) } : rest;
};
post<Partial<Team>>('/api/workflows', async (_p, body) => workflows.save({ name: 'New workflow', steps: [], schedule: { type: 'none' }, enabled: false, ...teamMark(teamFiles(body)), id: undefined }));
get('/api/workflows/:id', async ({ id }) => need(teams.getTeam(id)));
put<Partial<Team>>('/api/workflows/:id', async ({ id }, body) => workflows.save({ ...need(workflows.get(id)), ...teamMark(teamFiles(body)), id }));
// the picture or 3D model in the middle of a team's pod, instead of its emoji
get('/api/workflows/:id/mark', async ({ id }, _b, _q, res) => {
  const f = teamMarks.markFile(need(workflows.get(id)));
  if (!f) throw new HttpError(404, 'No picture or model');
  sendFileSafely(res, f);
  return undefined;
});
post<{ name?: unknown; data?: unknown }>('/api/workflows/:id/mark', async ({ id }, body) => teamMarks.setMarkFile(id, body.name, body.data));
del('/api/workflows/:id/mark', async ({ id }) => teamMarks.removeMarkFile(id));
del('/api/workflows/:id', async ({ id }) => {
  const gone = workflows.get(id);
  if (!gone) return { ok: true };
  workflows.remove(gone.id);
  teamMarks.dropMarkFiles(gone.id);
  log('team', `Deleted team ${gone.name}`);
  return { ok: true };
});
// "Run": a step list runs its steps; a team gets the input in its chat.
post<{ input?: string }>('/api/workflows/:id/run', async ({ id }, body) =>
  teams.isStepList(need(workflows.get(id))) ? wfs.startWorkflow(id, body.input || '') : teams.postUserMessage(id, body.input || 'Go ahead.', { route: brain.pickMember }),
);
// ---------- team chats ----------
get('/api/teams/:id/chat', async ({ id }) => ({ team: need(teams.getTeam(id)), ...teams.getThread(id), goal: openGoal('team', id), others: teams.otherTeams(id) }));
post<{ text?: string; replyTo?: string | null; attachments?: unknown }>('/api/teams/:id/messages', async ({ id }, body) => teams.postUserMessage(id, body.text, { replyTo: body.replyTo || null, route: brain.pickMember, attachments: uploads.cleanAttachments(body.attachments) }));
// /queue: posted once nobody in the team is working (now, if nobody is)
post<{ text?: string; replyTo?: string | null; attachments?: unknown }>('/api/teams/:id/queue', async ({ id }, body) => teams.queueUserMessage(id, body.text, { replyTo: body.replyTo || null, route: brain.pickMember, attachments: uploads.cleanAttachments(body.attachments) }));
del('/api/teams/:id/queue/:qid', async ({ id, qid }) => ({ unqueued: teams.unqueueTeam(need(teams.getTeam(id)).id, qid) }));
// a held message: its text changed, or the order they go in
// (queued: null when it already went)
put<{ text?: unknown }>('/api/teams/:id/queue/:qid', async ({ id, qid }, body) => ({ queued: teams.editQueuedTeam(need(teams.getTeam(id)).id, qid, body.text) }));
post<{ ids?: unknown }>('/api/teams/:id/queue/order', async ({ id }, body) => ({ held: teams.orderQueuedTeam(need(teams.getTeam(id)).id, body.ids) }));
// a message while the team works: whoever is working stops and takes it up now
post<{ text?: string; replyTo?: string | null; attachments?: unknown }>('/api/teams/:id/steer', async ({ id }, body) => teams.steerTeam(id, body.text, { replyTo: body.replyTo || null, route: brain.pickMember, attachments: uploads.cleanAttachments(body.attachments) }));
post('/api/teams/:id/resend', async ({ id }) => commands.resendInTeam(id));
post('/api/teams/:id/resume', async ({ id }) => commands.resumeInTeam(id));
post<{ text?: unknown; attachments?: unknown }>('/api/teams/:id/loop', async ({ id }, body) => commands.loopInTeam(id, String(body.text ?? ''), uploads.cleanAttachments(body.attachments)));
del('/api/teams/:id/loop', async ({ id }) => ({ ok: teams.stopTeamLoop(need(teams.getTeam(id)).id, 'Loop stopped.') }));
post<{ text?: unknown }>('/api/teams/:id/goal', async ({ id }, body) => commands.goalInTeam(id, String(body.text ?? '').trim().slice(0, 4000)));
del('/api/teams/:id/goal', async ({ id }) => commands.goalInTeam(id, 'clear'));
post('/api/teams/:id/stop', async ({ id }) => {
  const teamId = need(teams.getTeam(id)).id;
  // the held /queue messages come back to you
  const unqueued = teams.unqueueTeam(teamId);
  return { ok: teams.stopTeam(teamId), unqueued };
});
post('/api/teams/:id/clear', async ({ id }) => {
  teams.clearThread(need(teams.getTeam(id)).id);
  return { ok: true };
});
get('/api/workflow-templates', async () => wfs.TEMPLATES.map(({ name, description, needs }) => ({ name, description, needs })));
get('/api/workflow-active', async () => runs.list().filter((r) => r.status === 'running').map(wfs.runSummary));
post<{ name: string }>('/api/workflow-templates', async (_p, body) => wfs.createFromTemplate(body.name));
get('/api/workflow-runs', async (_p, _b, q) =>
  runs
    .list()
    .filter((r) => !q.workflowId || r.workflowId === q.workflowId)
    .sort((a, b) => b.createdAt! - a.createdAt!)
    .slice(0, 50),
);
post('/api/workflow-runs/:id/stop', async ({ id }) => ({ ok: wfs.stopWorkflowRun(id) }));

// ---------- terminals ----------
get('/api/terminals', async () => terms.listTerminals());
post<Omit<Parameters<typeof terms.createTerminal>[0], 'agent'> & { agentId?: string }>('/api/terminals', async (_p, body) => terms.createTerminal({ ...body, agent: body.agentId ? need(agents.get(body.agentId)) : null }));
del('/api/terminals/:id', async ({ id }) => ({ ok: terms.closeTerminal(id) }));

// ---------- internal: the MCP bridge calls these ----------
// A bridge that belongs to a run works in the run's project (its agent, workspace and data), even
// after you open another one. Without a run (an outside MCP client) it's the project open now.
const inRunProject = <T>(run: engines.RunInfo | null, fn: () => T): T => (run ? store.withProject(run.project, fn) : fn());
// The agent as its run has it: what a team gave it for this work (tools, MCP servers, skills) counts too.
// Its saved settings (autonomy, "always allow") are read fresh.
const bridgeAgent = (run: engines.RunInfo | null, id: string | null | undefined): Agent | ExternalAgent => {
  const agent = agentFor(id);
  if (!run || !id || run.agentId !== id || agent === EXTERNAL) return agent;
  return { ...agent, toolGroups: run.agent.toolGroups, mcpServers: run.agent.mcpServers, _teamSkills: run.agent._teamSkills };
};
get('/api/internal/tools', async (_p, _b, q) => {
  const run = engines.runInfo(q.run);
  return inRunProject(run, () => {
    const agent = bridgeAgent(run, q.agent);
    const list = tools.toolDefs(agent);
    if (agent.engine === 'claude-code')
      list.push({
        name: 'permission_prompt',
        description: 'Internal: Claude Code uses this to ask the user for permission. Never call it yourself.',
        parameters: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name'] },
      });
    return { tools: list };
  });
});
post<{ agent?: string; run?: string; name: string; args?: Record<string, unknown> }>('/api/internal/tools/call', async (_p, body) => {
  // The bridge says which run it belongs to; that gives the right project, approvals, Stop button and delegation depth.
  const run = engines.runInfo(body.run);
  return inRunProject(run, async () => {
    const agent = bridgeAgent(run, body.agent);
    const ctx = run ? { runId: run.id, depth: run.depth, signal: run.signal } : { runId: null, depth: 1 };
    if (body.name === 'permission_prompt') return { text: JSON.stringify(await claudePermission(agent, (body.args || {}) as unknown as PermissionRequest, ctx.runId)) };
    const r = await tools.callTool(agent, body.name, body.args || {}, ctx);
    // MCP takes pictures as data only: ComfyUI's result links are read here, so the agent sees them too
    return r.images?.length ? { ...r, images: await inlineToolImages(r.images) } : r;
  });
});

/** What Claude Code sends to permission_prompt. */
interface PermissionRequest {
  tool_name: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

async function claudePermission(agent: Agent | ExternalAgent, { tool_name, input = {} }: PermissionRequest, runId: string | null) {
  if ((agent.alwaysAllow || []).includes(tool_name)) return { behavior: 'allow', updatedInput: input };
  const detail = input.command || input.file_path || input.url || input.pattern || JSON.stringify(input, null, 2);
  const account = mcp.accountOfTool(tool_name);
  const d = await requestApproval({ kind: 'claude', title: `${agent.name} wants to use ${tool_name}${account ? ` on ${account}` : ''}`, detail: String(detail).slice(0, 4000), agentId: agent.id, agentName: agent.name, data: { tool: tool_name, args: input, runId } });
  if (d.approved && d.always) {
    const fresh = agents.get(agent.id);
    if (fresh) {
      fresh.alwaysAllow = [...new Set([...(fresh.alwaysAllow || []), tool_name])];
      agents.save(fresh);
    }
  }
  return d.approved ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: d.message || 'The user declined this. Ask them how to proceed.' };
}

// ---------- OAuth (plain GET pages) ----------
async function handleOAuth(url: URL, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  if (url.pathname === '/oauth/x/start') {
    try {
      const target = social.xAuthStart(`http://${req.headers.host}`);
      res.writeHead(302, { location: target });
      res.end();
    } catch (e) {
      page(res, 400, 'Could not start X sign-in', (e as Error).message);
    }
    return true;
  }
  if (url.pathname === '/oauth/reddit/start') {
    try {
      res.writeHead(302, { location: reddit.redditAuthStart(`http://${req.headers.host}`) });
      res.end();
    } catch (e) {
      page(res, 400, 'Could not start Reddit sign-in', (e as Error).message);
    }
    return true;
  }
  if (url.pathname === '/oauth/reddit/callback') {
    try {
      const acc = await reddit.redditAuthCallback(Object.fromEntries(url.searchParams));
      page(res, 200, `Connected u/${acc.username}`, 'You can close this tab and go back to the dashboard.', true);
    } catch (e) {
      page(res, 400, 'Reddit sign-in failed', (e as Error).message);
    }
    return true;
  }
  if (url.pathname === '/oauth/x/callback') {
    try {
      const acc = await social.xAuthCallback(Object.fromEntries(url.searchParams));
      page(res, 200, `Connected @${acc.username}`, 'You can close this tab and go back to the dashboard.', true);
    } catch (e) {
      page(res, 400, 'X sign-in failed', (e as Error).message);
    }
    return true;
  }
  return false;
}

function page(res: http.ServerResponse, status: number, title: string, text: string, close = false) {
  const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="background:#0b0c0b;color:#e6e8e0;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:520px;padding:24px"><h2 style="color:#c4ff3d">${esc(title)}</h2><p>${esc(text)}</p><p><a style="color:#c4ff3d" href="/#/settings?tab=connections">Back to the dashboard</a></p></div>${close ? '<script>setTimeout(()=>{location.href="/#/settings?tab=connections"},1500)</script>' : ''}`,
  );
}

// ---------- server ----------
function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const buf = await readRaw(req, 25 * 1024 * 1024);
  if (!buf.length) return {};
  let v: unknown;
  try {
    v = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
  // routes read fields from the body: null or a bare number/string would crash them
  if (v === null || typeof v !== 'object') throw new HttpError(400, 'Body must be a JSON object');
  return v;
}
// A file sent as the body (a backup), streamed to disk: never more than a backup may be
const FILE_LIMIT = backup.BACKUP_MAX;
const RECEIVED = () => ensureDir(dataPath('tmp', 'received'));

function receiveFile(req: http.IncomingMessage, limit: number): Promise<string> {
  const file = path.join(RECEIVED(), `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.part`);
  return new Promise<string>((resolve, reject) => {
    const out = fs.createWriteStream(file, { flags: 'wx' });
    let size = 0;
    let failed = false;
    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(file, { force: true }, () => reject(e));
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new HttpError(413, 'That file is too big for a backup.'));
        req.destroy();
      }
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new HttpError(400, 'The upload was cut off.')));
    out.on('error', fail);
    out.on('finish', () => !failed && resolve(file));
    req.pipe(out);
  });
}

function serveStatic(url: URL, res: http.ServerResponse): boolean {
  let rel = decodeURIComponent(url.pathname);
  if (rel.startsWith('/vendor/')) {
    const v = VENDOR[rel.slice(8)];
    if (!v) return false;
    const file = path.join(ROOT, v);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'text/javascript', 'cache-control': 'max-age=86400' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return true;
  }
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep) || !exists(file) || !fs.statSync(file).isFile()) return false;
  const headers: Record<string, string> = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
  // Agent output is shown as markdown: no outside scripts, and images only from here (nothing leaks out).
  if (file.endsWith('.html'))
    headers['content-security-policy'] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob: https://pbs.twimg.com https://abs.twimg.com",
      `connect-src 'self' ws://localhost:${PORT} ws://127.0.0.1:${PORT}`,
      "frame-ancestors 'none'",
    ].join('; ');
  res.writeHead(200, headers);
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  // Only answer requests addressed to this machine (stops DNS-rebinding tricks).
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    res.writeHead(421);
    return res.end('Wrong host');
  }
  const url = new URL(req.url!, `http://${req.headers.host}`);
  // Browsers label requests from other websites (an <img> or link pointing here). Only the X callback may arrive that way.
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none' && !['/oauth/x/callback', '/oauth/reddit/callback'].includes(url.pathname) && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/'))) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Requests from other websites are not allowed.' }));
  }
  try {
    if (url.pathname.startsWith('/oauth/') && (await handleOAuth(url, req, res))) return;
    if (url.pathname.startsWith('/api/')) {
      const internal = url.pathname.startsWith('/api/internal/');
      if (internal) {
        if (req.headers['x-dash-internal'] !== internalToken()) throw new HttpError(403, 'Bad internal token');
      } else if (req.method !== 'GET' && req.headers['x-dash'] !== '1') {
        // Other websites can't add this header without a CORS preflight, which we never allow.
        throw new HttpError(403, 'Missing x-dash header');
      }
      // A change made for the project the page shows, after another one was opened (in this tab or another):
      // refused, so it can't land in the wrong project. Project routes name their project themselves.
      const pageProject = req.headers['x-dash-project'];
      if (!internal && req.method !== 'GET' && typeof pageProject === 'string' && pageProject && !url.pathname.startsWith('/api/projects') && pageProject !== store.activeProject().id) {
        throw new HttpError(409, 'Another project was opened meanwhile. Nothing was changed; try again.');
      }
      if (url.pathname === '/api/comfyui/view') return await comfy.proxyView(Object.fromEntries(url.searchParams), res);
      // an attached file: the raw bytes, streamed to disk (the router only reads JSON bodies)
      const upload = req.method === 'POST' && /^\/api\/uploads\/([\w-]+)$/.exec(url.pathname);
      if (upload) {
        const saved = await uploads.receive(req, upload[1], url.searchParams.get('path') || '');
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(JSON.stringify(saved));
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        let out: unknown;
        if (r.raw) {
          const file = await receiveFile(req, FILE_LIMIT);
          try {
            out = await r.handler(params, file, Object.fromEntries(url.searchParams), res);
          } finally {
            fs.rmSync(file, { force: true });
          }
        } else {
          const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
          out = await r.handler(params, body, Object.fromEntries(url.searchParams), res);
        }
        if (out === undefined && res.headersSent) return;
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(JSON.stringify(out ?? null));
      }
      throw new HttpError(404, `No API route ${req.method} ${url.pathname}`);
    }
    if (req.method === 'GET' && serveStatic(url, res)) return;
    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || String(e) }));
    } else res.end();
  }
});

// ---------- websockets: live events + terminals ----------
const wss = new WebSocketServer({ noServer: true });
const eventClients = new Set<WebSocket>();
// world_look answers in words at once when no page is open to draw a picture
worldLook.setOpenPages(() => [...eventClients].filter((ws) => ws.readyState === 1).length);
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin || '';
  const okOrigin = [...ALLOWED_HOSTS].some((h) => origin === `http://${h}`);
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase()) || !okOrigin) {
    socket.destroy();
    return;
  }
  const url = new URL(req.url!, `http://${req.headers.host}`);
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.pathname === '/ws/term') return terms.attachTerminal(url.searchParams.get('id'), ws);
    if (url.pathname !== '/ws') return ws.close();
    eventClients.add(ws);
    ws.on('close', () => eventClients.delete(ws));
  });
});
bus.on('event', (ev) => {
  const msg = JSON.stringify(ev);
  for (const ws of eventClients) if (ws.readyState === 1) ws.send(msg);
});

// ---------- routines ----------
get('/api/routines', async () => routinesMod.listRoutines());
post<Partial<Routine> | null>('/api/routines', async (_p, body) => routinesMod.saveRoutine(body || {}));
get('/api/routines/:id', async ({ id }) => need(routinesMod.getRoutine(id)));
put<Partial<Routine> | null>('/api/routines/:id', async ({ id }, body) => routinesMod.saveRoutine(body || {}, need(store.routines.get(id)).id));
del('/api/routines/:id', async ({ id }) => (routinesMod.deleteRoutine(id), { ok: true }));
post<{ input?: unknown } | null>('/api/routines/:id/run', async ({ id }, body) => routinesMod.startRoutine(need(store.routines.get(id)).id, { input: String(body?.input || '').slice(0, 20000) }));
get('/api/routine-runs', async (_p, _b, q) => routinesMod.listRuns(q.routineId || undefined));
post('/api/routine-runs/:id/stop', async ({ id }) => ({ ok: routinesMod.stopRoutineRun(id) }));

// ---------- start ----------
// The page is bundled into public/dist. Started without `bun run start` on a fresh checkout: build it now.
const pageReady = exists(path.join(PUBLIC, 'dist', 'app.js'))
  ? Promise.resolve()
  : new Promise<void>((done) => {
      console.log('  Building the page (public/dist)…');
      const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'build-web.ts')], { cwd: ROOT, stdio: 'inherit' });
      child.on('exit', (code) => {
        if (code) console.error('  Could not build the page. Run: bun run build');
        done();
      });
      child.on('error', () => done());
    });
ensureDir(dataPath('outputs'));
fs.rmSync(dataPath('tmp', 'received'), { recursive: true, force: true }); // uploads cut off by a crash
internalToken();
store.migrateLayout();
wfs.markInterruptedRuns();
wfs.startScheduler();
skills.ensureBuiltinSkills();
learning.startLearning();
irc.startIrc();
routinesMod.markInterruptedRoutines();
routinesMod.startRoutineScheduler();
projectSync.startAutoSave();
programs.startProgramScan();
programs.startRunningWatch();

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Blacksite is already running at http://localhost:${PORT}`);
    if (OPEN) openWithShell(`http://localhost:${PORT}`);
    process.exit(0);
  }
  throw e;
});

store.migrateGlobalOutbox();
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Blacksite is running at ${url}\n  Data folder: ${dataPath()}\n  Press Ctrl+C to stop.\n`);
  log('system', 'Dashboard started');
  if (OPEN) void pageReady.then(() => openWithShell(url));
});

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  terms.closeAll();
  // agents' CLIs are stopped too: they would go on writing into the project with no dashboard to see it
  void engines.stopAllRuns().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// The desktop app holds our stdin open. It closes when the app quits or crashes: stop with it.
if (process.env.DASH_DESKTOP) {
  process.stdin.on('end', shutdown);
  process.stdin.on('error', shutdown);
  process.stdin.resume();
}
process.on('unhandledRejection', (e) => console.error('Unhandled:', e));
