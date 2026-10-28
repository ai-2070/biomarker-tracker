// Types shared by the server (server/) and the browser app (web/).
// The server stores these as JSON files; the browser gets them from the API.
import type { Effort } from './effort.ts';
export type { Effort } from './effort.ts';

export type EngineId = 'claude-code' | 'openai' | 'hermes' | 'codex' | 'pi' | 'omp' | 'openclaw';
export type Autonomy = 'ask' | 'auto' | 'full';
export type ProviderId = 'openrouter' | 'lmstudio' | 'ollama' | 'custom';
export type ClaudeAuth = 'login' | 'anthropic' | 'openrouter';

// ---------- agents ----------
export interface AgentSource {
  type: 'custom' | 'agency' | 'starter' | 'hermes' | 'openclaw' | 'claude' | 'brain' | 'preset' | string;
  slug?: string;
  division?: string;
  preset?: string;
  profile?: string;
}

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  specialty: string;
  description: string;
  systemPrompt: string;
  engine: EngineId;
  model: string;
  provider: ProviderId | string;
  claudeAuth: ClaudeAuth | string;
  hermesProfile: string;
  /** OpenClaw engine: which of your OpenClaw agents answers ('' = its default agent). */
  openclawAgent?: string;
  autonomy: Autonomy;
  toolGroups: string[];
  mcpServers: string[];
  knowledge: { folders: string[] };
  workspace: string;
  temperature: number | '';
  /** How hard the model thinks (see shared/effort.ts). '' or missing = the model's default. */
  effort?: Effort | '';
  alwaysAllow: string[];
  skills: string[];
  /** Rich answers: in your own chats it answers in OpenUI Lang, shown as live components (cards, tables, charts, forms). */
  richAnswers?: boolean;
  source: AgentSource;
  pinned: boolean;
  lastModel?: string;
  lastModelAt?: number;
  createdAt?: number;
  updatedAt?: number;
  /** Set only while an agent works for a team: that team's skills. Never saved. */
  _teamSkills?: string[];
}

// ---------- teams (stored in the "workflows" collection) ----------
export interface TeamAccess {
  toolGroups: string[];
  mcpServers: string[];
}

export interface Schedule {
  type: 'none' | 'daily' | 'interval' | string;
  /** daily: 'HH:MM' */
  time?: string;
  /** interval: every N minutes */
  minutes?: number;
  /** daily: which weekdays (0 = Sunday); empty = every day */
  days?: number[];
  input?: string;
}

/** Old teams were step lists; teams now are group chats with members. Steps mirror the members. */
export interface TeamStep {
  id?: string;
  type: 'agent' | 'tool' | 'approval' | string;
  agentId?: string;
  prompt?: string;
  label?: string;
  tool?: string;
  [k: string]: unknown;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  color?: string;
  /** The symbol in the middle of the team's pod on the map: an emoji ('' or unset = the default 💬). */
  mark?: string;
  /** A picture or 3D model shown there instead of the emoji (a file the server keeps; set by the server, not by saving the team). */
  markFile?: { kind: 'image' | 'model'; ext: string; at: number } | null;
  members: string[];
  lead: string | null;
  access?: TeamAccess;
  skills?: string[];
  /** Reference files the user gave the team (paths in the project's uploads/ folder). */
  files?: string[];
  steps: TeamStep[];
  schedule?: Schedule;
  enabled?: boolean;
  /** Where it sits on the Station map, and its spin. Null = next to the Brain. */
  pos?: { x: number; z: number } | null;
  rot?: number | null;
  angle?: number | null;
  createdBy?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface TeamState {
  working: string[];
  queued: string[];
  /** your /queue messages, posted one by one once nobody is working */
  held?: QueuedMessage[];
  /** your /loop, while it goes */
  loop?: LoopInfo | null;
  /** /resume would pick something up (the team was stopped or paused) */
  resumable?: boolean;
}

/** A /loop going in a chat: the message sent again every so often (every, in ms) or after each answer. */
export interface LoopInfo {
  text: string;
  every: number | null;
  times: number;
  /** how many were sent so far */
  done: number;
  /** when the next one is due (timed loops), if known */
  next: number | null;
}

/** A message typed with /queue: it waits until the agent or team is done, then goes as usual. */
export interface QueuedMessage {
  id: string;
  text: string;
  attachments?: string[];
  /** (team chats) the message it answers */
  replyTo?: string | null;
  /** who it is from when not you (e.g. the Brain following up on a goal) */
  from?: string;
  ts: number;
}

/** A team as GET /api/workflows returns it: with who is working and its latest message. */
export interface TeamListing extends Team {
  state?: TeamState;
  last?: TeamMessage | null;
}

export interface TeamMessage {
  id: string;
  ts: number;
  from: string; // 'user' | 'system' | 'brain' | agent id | 'team:<id>' (another team)
  text: string;
  /** From another team (#Team Name): who there wrote it, and, for that team's answer to a question
   *  asked from here, the message that asked. Names are kept so it reads right after renames. */
  relay?: TeamRelay;
  mentions: string[];
  replyTo?: string | null;
  handedTo?: string[];
  /** An agent's reply: where its turn is in the agent's own session for this team (its steps and tool
   *  calls are items from..to of that chat), so the team chat can show the work behind it. */
  turn?: { chatId: string; from: number; to: number };
  /** Files and folders attached to the message (paths in the project's uploads/ folder). */
  attachments?: string[];
  [k: string]: unknown;
}

export interface TeamRelay {
  teamId: string;
  teamName: string;
  /** who wrote it there: an agent id, 'user' or 'brain' */
  by: string;
  byName: string;
  /** set on an answer: the message here that asked */
  answers?: string;
}

/** Another team, as a team's chat lists them (for #Team Name). */
export interface TeamRef {
  id: string;
  name: string;
  color?: string;
  mark?: string;
  description: string;
}

// ---------- routines ----------
export type RoutineMentionKind = 'agent' | 'team' | 'skill';

/** Something a routine's text names with @Name. id is a skill's slug for skills. */
export interface RoutineMention {
  kind: RoutineMentionKind;
  id: string;
  name: string;
  /** Set on the way out when the agent, team or skill no longer exists. Never saved. */
  missing?: boolean;
}

/** Saved instructions you run by hand or on a schedule. The @mentioned agents and teams do them,
 *  with the @mentioned skills. */
export interface Routine {
  id: string;
  name: string;
  description?: string;
  text: string;
  mentions: RoutineMention[];
  schedule?: Schedule;
  enabled?: boolean;
  lastScheduledAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface RoutineRunTarget {
  kind: 'agent' | 'team';
  id: string;
  name: string;
  /** sent: posted in the team chat, where the team carries on */
  status: 'running' | 'done' | 'sent' | 'failed' | 'stopped';
  chatId?: string | null;
  output?: string;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  trigger: 'manual' | 'schedule' | string;
  status: 'running' | 'done' | 'failed' | 'stopped';
  skills: string[];
  targets: RoutineRunTarget[];
  error?: string | null;
  createdAt?: number;
  updatedAt?: number;
  finishedAt?: number;
}

/** A routine as GET /api/routines returns it: with its latest run. */
export interface RoutineListing extends Routine {
  lastRun?: RoutineRun | null;
}

// ---------- projects ----------
export interface Project {
  id: string;
  name: string;
  description?: string;
  brainPath: string;
  repo: string;
  skills?: string[];
  createdAt: number;
  openedAt?: number;
  /** When its logo (.dashboard/logo.*) last changed; null = no logo. Added by the server when it sends projects. */
  logoAt?: number | null;
  /** The 3D model that replaces the logo inside the Brain's globe (.dashboard/brain-model.*): when it last changed and its file type; null = none. */
  modelAt?: number | null;
  modelExt?: string | null;
  /** Which voxel world it uses (missing: none of its own yet, see ProjectWorldLink). */
  world?: ProjectWorldLink;
}

// ---------- chats ----------
export type ChatItem =
  | { type: 'user'; text: string; from?: string | null; attachments?: string[]; ts?: number }
  | { type: 'assistant'; text: string; ts?: number }
  | { type: 'tool'; id: string; name: string; args?: unknown; result?: string | null; status: 'running' | 'done' | 'error'; isError?: boolean; images?: string[]; ts?: number }
  | { type: 'error'; text: string; ts?: number }
  /** reset: "Clear memory" (the agent starts fresh after it) */
  | { type: 'meta'; text: string; ts?: number; reset?: boolean }
  | CompactionItem;

/** How a compaction was made. instant: the original words, cut to fit (no model call). summary: a model
 *  wrote a summary. engine: the engine compacted its own memory (Claude Code), so there is no text here. */
export type CompactionMode = 'instant' | 'summary' | 'engine';
/** auto: the chat got full. manual: you asked (button or /compact). overflow: the model said it was too long. */
export type CompactionTrigger = 'auto' | 'manual' | 'overflow';

/** The "--- COMPACTED ---" marker in a chat. From here on the agent remembers the items before it as text
 *  (the checkpoint), plus the items from upto on word for word. */
export interface CompactionItem {
  type: 'compaction';
  id: string;
  /** The compacted history the agent sees (you can edit it). Empty for mode "engine". */
  text: string;
  mode: CompactionMode;
  trigger: CompactionTrigger;
  /** Index of the first item kept word for word (the items before it are in text). */
  upto: number;
  /** Rough size of the agent's memory before and after, in tokens. */
  tokensBefore?: number;
  tokensAfter?: number;
  /** Set when you changed text by hand. */
  editedAt?: number;
  /** Why it is not what you asked for (e.g. the summary failed, so it is instant). */
  note?: string;
  ts?: number;
}

/** How full the agent's memory of a chat is, as the engine last said (or as estimated). */
export interface ChatContext {
  tokens: number;
  /** the model's context window, when the engine says it */
  window?: number;
  /** chat.items.length when this was measured: items after it are not counted yet */
  items: number;
  at: number;
  /** which engine, provider and model measured it ("engine|provider|model"): another one ignores it */
  by?: string;
}

export interface Chat {
  id: string;
  agentId: string;
  title: string;
  items: ChatItem[];
  llm: unknown[];
  sessionId: string | null;
  /** The engine that answered here last (and made sessionId): another engine can't resume it, so it
   *  starts from the chat so far (a new session, or for the API model a new chat.llm). */
  sessionEngine?: EngineId;
  /** Set when this is the agent's session for a team chat. */
  teamId?: string | null;
  /** Set after a compaction: the next run starts a new engine session that gets the compacted history first. */
  reseed?: boolean;
  /** How full the agent's memory is (see ChatContext). Cleared by a compaction or Clear memory. */
  context?: ChatContext;
  /** Its last run had Rich answers' instructions (a chat of your own, not a handoff or a team's). */
  rich?: boolean;
  /** When the agent's MEMORY.md had last changed as of its last run here (see engines/index.ts). */
  memoryAt?: number;
  createdAt: number;
  updatedAt: number;
  _deleted?: boolean;
  /** Your /queue messages for when the current run is done (kept in memory; GET adds them, never saved). */
  queued?: QueuedMessage[];
  /** Your /loop here, while it goes (GET adds it). */
  loop?: LoopInfo | null;
  /** Your /goal here, while the Brain follows it (GET adds it). */
  goal?: BrainBrief | null;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  count: number;
  teamId?: string | null;
}

// ---------- runs and live events ----------
export type RunEvent =
  | { kind: 'start'; text: string; from?: string | null; attachments?: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; args?: Record<string, unknown> }
  | { kind: 'tool_result'; id: string; text?: string; isError?: boolean; images?: string[] }
  | { kind: 'status'; text: string }
  | { kind: 'model'; model: string }
  | { kind: 'done'; text: string; cost?: number; seconds?: number }
  /** the engine compacted its own memory (Claude Code): marked in the chat, never sent on as a run event */
  | { kind: 'compacted'; trigger?: string; tokensBefore?: number }
  | { kind: 'error'; text: string };

export interface ActiveRun {
  id: string;
  agentId: string;
  chatId: string;
  /** the project it runs in (a cloned project's chats have the same ids) */
  projectId?: string;
  startedAt: number;
  agentName: string;
  parentRunId: string | null;
  /** above 0: it works for a team or another agent, which waits on its answer */
  depth?: number;
}

/** Everything the server pushes over the /ws socket. Extra fields depend on the type. */
export interface ServerEvent {
  type: string;
  ts: number;
  [k: string]: unknown;
}

// ---------- approvals, outbox, activity ----------
export interface Approval {
  id: string;
  kind: string;
  title: string;
  detail: string;
  agentId: string | null;
  agentName: string;
  data: Record<string, unknown>;
  editable: unknown;
  createdAt: number;
  /** Why the Brain passed this on to you instead of allowing it (Settings > The Brain approves). */
  brainNote?: string;
}

/** A question an agent asked you with ask_user: a choice to make, something only you know, a place it is stuck.
 *  It waits in the Outbox with its choices as buttons and a box for an answer in your own words. */
export interface AgentQuestion {
  id: string;
  question: string;
  /** what you need to know to answer (Markdown) */
  detail?: string;
  /** the answers you can click (none: an open question) */
  choices: string[];
  /** waiting: not answered yet. closed: the run that asked was stopped. */
  status: 'waiting' | 'answered' | 'dismissed' | 'closed';
  agentId?: string | null;
  agentName?: string;
  /** the chat it was asked in, and the run (while it waits there for the answer) */
  chatId?: string | null;
  runId?: string | null;
  /** asked in a team chat: a late answer goes there */
  teamId?: string | null;
  teamName?: string;
  /** what you clicked, and what you wrote */
  choice?: string;
  reply?: string;
  answeredAt?: number;
  /** how the answer reached the agent: while it waited, or as a new message in its chat or team chat */
  delivered?: 'live' | 'chat' | 'team' | 'nowhere';
  /** why it couldn't be delivered, or why it closed */
  note?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** Something a team finished that isn't an outgoing post: a written result, a file or a folder. */
export interface Artifact {
  id: string;
  title: string;
  kind: 'text' | 'file' | 'folder';
  /** file / folder: the full path, inside the project's folders */
  path?: string;
  /** text: the result itself (Markdown) */
  text?: string;
  note?: string;
  agentId?: string | null;
  agentName?: string;
  /** The team it was done for, named at the time (a renamed team keeps its old name here). */
  teamId?: string | null;
  teamName?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface OutboxPost {
  id: string;
  platform: 'x' | 'x_dm' | 'reddit' | 'telegram' | 'discord' | string;
  accountId?: string | null;
  accountLabel?: string;
  parts: string[];
  /** Image files (full paths inside the project's folders) that go with the first part. X only. */
  images?: string[];
  status: 'pending' | 'posting' | 'posted' | 'failed' | 'rejected' | 'returned' | string;
  agentId?: string | null;
  /** The team the draft was written for (named at the time); where Send back to the team goes. */
  teamId?: string | null;
  teamName?: string;
  /** X: ids of the parts already posted (a thread can be finished later), and what it replies to */
  postIds?: string[];
  replyTo?: string | null;
  postedAt?: number;
  error?: string | null;
  reason?: string;
  agentName?: string;
  note?: string;
  url?: string;
  to?: string;
  reddit?: { kind: 'post' | 'comment'; subreddit?: string; title?: string; link?: string; parent?: string };
  createdAt?: number;
  updatedAt?: number;
  [k: string]: unknown;
}

export interface ActivityEntry {
  id: string;
  kind: string;
  text: string;
  ts: number;
  agentId?: string;
  chatId?: string;
  [k: string]: unknown;
}

// ---------- settings ----------
export interface BrainSetting {
  provider: 'claude' | 'openrouter' | 'hermes' | 'codex';
  model: string;
  /** How hard it thinks. '' or missing = the model's default. */
  effort?: Effort | '';
}

/** A model you starred in the model picker. provider: for API models (OpenRouter or a server on this PC). */
export interface FavoriteModel {
  engine: EngineId;
  model: string;
  provider?: string;
}

/** Settings > Chat memory: compacting long chats so the agent never runs out of room. */
export interface CompactionSetting {
  /** Compact a chat by itself when the agent's memory of it gets full. */
  auto: boolean;
  /** Claude Code, Codex, Hermes, pi, oh-my-pi and OpenClaw compact their own sessions: automatic compaction
   *  then only covers API-model agents (and a CLI run that fails because the chat is too long). */
  engineOwn: boolean;
  /** Instant compaction: keeps the original words (cut to fit) and needs no model call. Off: the Brain's model writes a summary. */
  instant: boolean;
  /** Compact when the memory reaches this share of the model's context window (10-95). */
  thresholdPercent: number;
  /** How many of the latest messages (yours and the agent's) stay in full, with their tool calls.
   *  The message being answered always does. The rest is compacted. */
  keepMessages: number;
  /** The context window in tokens, for every agent. 0: as the engine or model list says (else a safe default). */
  windowTokens: number;
}

export interface LookSetting {
  scale: number;
  accent: string;
  motion: 'full' | 'reduced';
  /** The font chat messages are in (an id from CHAT_FONTS in shared/look.ts). */
  chatFont: string;
  /** How hard the Station's 3D map works: frame rate and sharpness (see STATION_QUALITY in shared/look.ts). */
  station: StationQuality;
  /** What the bottom of the sidebar shows: what's set up, or how much of your Claude and Codex plans is used. */
  sidebar: SidebarPanel;
  /** The Station's look: the classic map, or the voxel world's light (sky, sun and shadows, glow). */
  stationLook: StationLook;
  /** How much the voxel world draws: shadows, glow and the miniature blur cost graphics power. */
  worldQuality: WorldQuality;
}
export type StationLook = 'classic' | 'world';
export type WorldQuality = 'low' | 'medium' | 'high';

export type StationQuality = 'smooth' | 'balanced' | 'saver';
export type SidebarPanel = 'status' | 'limits';

export interface Settings {
  defaults: { engine: EngineId; claudeModel: string; openrouterModel: string; hermesProfile: string; autonomy: Autonomy };
  providers: { lmstudio: { baseUrl: string }; ollama: { baseUrl: string }; custom: { baseUrl: string; label: string } };
  comfyui: { url: string; workflowDirs: string[] };
  paths: Record<string, string>;
  allowedFolders: string[];
  x: { clientId: string };
  reddit: { clientId: string; username: string };
  brain: BrainSetting;
  /** The Brain answers agents' and teams' permission requests, and only asks you about the risky or unclear ones. */
  brainApproves: boolean;
  /** Skills the Brain itself follows (slugs). With "self-improvement" it also learns from finished work. */
  brainSkills: string[];
  /** The Brain may install skills from any GitHub link, not only from repos you named in the chat. */
  brainAnyGitHub: boolean;
  /** The Brain checks the work it handed out when it's finished, follows up when something is missing, and tells you how it went. */
  brainFollowsUp: boolean;
  look: LookSetting;
  telegram: { chatId: string };
  maxToolSteps: number;
  costLimitUsdPerRun: number;
  compaction: CompactionSetting;
  /** Models starred in the model picker: they get their own tab at the front. */
  favoriteModels: FavoriteModel[];
  activeProject?: string;
  /** The voxel world projects without a built world of their own show ('' = the most recently built one). */
  defaultWorld: string;
}

export type SecretKey = 'openrouterKey' | 'anthropicKey' | 'customKey' | 'xClientSecret' | 'telegramBotToken' | 'discordWebhook' | 'redditClientSecret';
export type SecretStatus = Record<SecretKey, { set: boolean; hint?: string }>;

// ---------- engines ----------
export interface EngineStatus {
  'claude-code': { installed: boolean; path: string | null; loggedIn: boolean; version: string | null };
  openai: { openrouter: boolean; custom: boolean };
  hermes: { installed: boolean; path: string | null };
  codex: { installed: boolean; loggedIn: boolean; version: string | null; path?: string | null; how?: string };
  pi: { installed: boolean; path: string | null; version: string | null };
  omp: { installed: boolean; path: string | null; version: string | null };
  openclaw: { installed: boolean; path: string | null; version: string | null };
}

export interface EngineInfo {
  id: EngineId;
  label: string;
  description?: string;
}

export interface ToolGroup {
  id: string;
  label: string;
  description: string;
}

// ---------- accounts ----------
export interface XAccount {
  id: string;
  username: string;
  name: string;
  autopost: boolean;
  connectedAt: number;
  avatar?: string;
}

export interface RedditAccount {
  id: string;
  username: string;
  autopost: boolean;
  connectedAt: number;
  icon?: string;
}

export interface Accounts {
  x: XAccount[];
  xAppConfigured: boolean;
  telegram: { configured: boolean };
  discord: { configured: boolean };
  reddit: RedditAccount[];
  redditAppConfigured: boolean;
}

export interface Terminal {
  id: string;
  title: string;
  agentId: string | null;
  createdAt: number;
  exited: boolean;
  exitCode: number | null;
  command: string;
}

/** GET /api/state: everything the browser needs to draw. */
export interface AppState {
  agents: Agent[];
  mcpServers: string[];
  /** each MCP server's label, service and "use for" (an older server leaves it out) */
  mcpInfo?: Record<string, McpServerInfo>;
  project: Project;
  projectSaved: { at: number; error?: string; agents?: number; teams?: number } | null;
  projects: Project[];
  approvals: Approval[];
  outboxPending: number;
  /** questions from agents waiting for your answer (in the Outbox) */
  questions: AgentQuestion[];
  runs: ActiveRun[];
  engines: EngineStatus;
  engineList: EngineInfo[];
  toolGroups: ToolGroup[];
  settings: Settings;
  secrets: SecretStatus;
  accounts: Accounts;
  terminals: Terminal[];
  port: number;
  home: string;
  dataDir: string;
}

// ---------- skills and presets ----------
export interface SkillFile {
  path: string;
  size: number;
}

export interface Skill {
  slug: string;
  name: string;
  description: string;
  body: string;
  source: 'library' | 'claude';
  files: SkillFile[];
  updatedAt: number;
  /** Where it was installed from (GitHub), if it was. */
  origin?: SkillOrigin;
}

/** A skill installed from GitHub: where from (<skill>/.source.json). */
export interface SkillOrigin {
  url: string;
  /** owner/repo */
  repo: string;
  ref: string;
  /** the skill's folder in the repo ('' = the repo itself) */
  path: string;
  installedAt: number;
}

/** POST /api/skills/install: what installing from a GitHub link did. */
export interface SkillInstallResult {
  installed: { slug: string; name: string; updated: boolean; files: number }[];
  /** skills found but not installed, and why */
  skipped: string[];
}

export interface SkillListing extends Omit<Skill, 'body'> {
  preview: string;
}

export interface ClaudeSkill {
  slug: string;
  name: string;
  description: string;
  files: number;
  inLibrary: boolean;
}

export interface PresetListing {
  id: string;
  kind: 'agent' | 'team';
  name: string;
  description: string;
  emoji: string | null;
  color: string | null;
  members: { name: string; emoji: string }[] | null;
  lead: string | null;
  skills: string[];
  savedAt: number;
}

// ---------- versions (skills, agents, teams) ----------
export type VersionKind = 'skill' | 'agent' | 'team' | 'memory';
/** Who replaced a version: you, the Brain, or an agent (its own MEMORY.md). */
export type VersionAuthor = 'you' | 'brain' | 'agent';
/** One kept version, as GET /api/versions/:kind/:id lists it. */
export interface VersionEntry {
  id: string;
  /** when it was replaced or deleted */
  at: number;
  /** who replaced it */
  by: VersionAuthor;
  deleted?: boolean;
  note?: string;
  /** what the next version (or the current one) changed in it */
  changes: string[];
}
/** GET /api/versions/:kind/:id */
export interface VersionHistory {
  kind: VersionKind;
  id: string;
  name: string;
  /** the current one as text, or null when it's deleted */
  current: string | null;
  versions: VersionEntry[];
}
/** GET /api/versions/:kind/:id/:vid: one version as text. */
export interface VersionDetail extends VersionEntry {
  name: string;
  text: string;
}
/** GET /api/versions/:kind: what was deleted and can come back. */
export interface DeletedItem {
  kind: VersionKind;
  id: string;
  name: string;
  at: number;
  by: VersionAuthor;
}

// ---------- MEMORY.md ----------
/** GET /api/memory/:owner: an agent's MEMORY.md (owner: its id), or the Brain's (owner "brain"). */
export interface MemoryInfo {
  owner: string;
  /** whose it is: the agent's name, or "The Brain" */
  name: string;
  text: string;
  /** when it last changed (0: never written) */
  updatedAt: number;
  /** the most it may hold, in characters */
  max: number;
}

// ---------- the Brain ----------
export type BrainDone = { kind: 'team' | 'hired' | 'file' | 'routine' | 'skill' | 'model' | 'mcp' | 'stop' | 'memory' | 'world' | 'error' | 'note'; text: string; teamId?: string; agentId?: string; routineId?: string; skillId?: string; file?: string; /** whose MEMORY.md it changed (an agent id, or "brain") */ memory?: string };
export interface BrainDelegate {
  kind: 'agent' | 'branch';
  id: string;
  name: string;
  message: string;
  /** The files you attached for the Brain, handed on with the work. */
  attachments?: string[];
  /** Set once the server handed it on: the Brain's message in the team chat, or the agent chat it started. */
  sent?: { messageId?: string; ts?: number; chatId?: string; runId?: string };
}

/** Work the Brain handed to a team or an agent, and how its follow-up went (data/projects/<id>/brain-briefs.json). */
export interface BrainBrief {
  id: string;
  kind: 'team' | 'agent';
  /** the team or agent id */
  targetId: string;
  name: string;
  /** what the Brain asked for */
  text: string;
  ts: number;
  /** a team: the Brain's message in the thread; an agent: the chat it works in */
  messageId?: string;
  chatId?: string;
  followUps: number;
  /** open: working on it. done: finished (or needs you). stuck: not done after the follow-ups. stopped: you stopped it. replaced: a newer brief went to the same team or agent. cleared: you dropped the goal. */
  status: 'open' | 'done' | 'stuck' | 'stopped' | 'replaced' | 'cleared';
  /** your /goal: the Brain judges the work against it, and follows up more times */
  goal?: string;
  /** chat: set with /goal in the agent's or team's own chat (the Brain reports there, not in the Brain chat) */
  origin?: 'chat';
  /** the Brain's last word on it, for you */
  summary?: string;
  updatedAt?: number;
}

/** One file or folder saved by POST /api/uploads/:batch. top: the file itself, or the dropped folder it is in. */
export interface UploadedFile {
  path: string;
  top: string;
  kind: 'file' | 'folder';
  name: string;
  size: number;
}
export interface BrainAnswer {
  answer: string;
  done: BrainDone[];
  delegate: BrainDelegate | null;
  model: { provider: string; model: string; fallback?: boolean };
  project: string;
}

// ---------- usage meters in the header ----------
export interface UsageMeter {
  label: string;
  percent?: number | null;
  resetsAt?: number | null;
  text?: string | null;
}
export interface ProviderUsage {
  id: 'claude' | 'openrouter' | 'codex';
  name: string;
  meters: UsageMeter[];
}

/** One usage limit of a plan: how much of it is used and when it starts again (ms). */
export interface LimitWindow {
  /** "5h", "Week" */
  label: string;
  percent: number;
  resetsAt: number | null;
}
/** A plan's limits, for the sidebar. ready: false when it isn't installed or signed in (why says which). */
export interface ProviderLimits {
  ready: boolean;
  why?: string;
  /** e.g. "pro", "plus" (Codex says) */
  plan?: string | null;
  windows: LimitWindow[];
  /** Codex says you can't use the plan's own usage right now */
  blocked?: boolean;
}
/** Free Codex limit resets on your account; credits: the ones Codex listed, the one that runs out first first. */
export interface CodexResets {
  available: number;
  credits: { id: string; expiresAt: number | null; title: string | null }[];
}
/** GET /api/usage-limits */
export interface UsageLimits {
  claude: ProviderLimits;
  codex: ProviderLimits & { resets: CodexResets | null };
}
/** POST /api/codex/reset */
export interface CodexResetResult {
  outcome: 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed';
  limits: UsageLimits;
}

/** GET /api/about: which Blacksite this is and where it lives on GitHub. */
export interface AboutInfo {
  name: string;
  version: string;
  /** "owner/name" on GitHub */
  repo: string;
  url: string;
  license: string;
  /** GitHub stars, when asked for (?stars=1) and GitHub answered; null otherwise (e.g. a private repo) */
  stars: number | null;
}

/** An MCP server as the page shows it: a service can be added more than once (several accounts), each copy with a label. */
export interface McpServerInfo {
  /** "OOMOL: Work" for a copy with a label, else the server's name */
  title: string;
  label: string;
  /** the service it is (a ready-made server's name, or its own name) */
  kind: string;
  /** the service for people ("OOMOL") */
  service: string;
  /** when to pick this copy over the service's other ones */
  useFor: string;
  /** how many servers of this service there are (1: added once) */
  copies: number;
}

/** A ready-made MCP server worth adding on this PC (GET /api/mcp "suggested"): never added on its own. */
export interface McpSuggestion {
  name: string;
  title: string;
  description: string;
  /** why: "Blender is installed", or "useful to most agents, no key or setup" */
  reason: string;
  /** what it needs from you first (a key, a setup step in the program), '' when nothing */
  needs: string;
  /** the Programs page id of the program it drives, null for the basics */
  program: string | null;
}

// ---------- the voxel world (docs/internal/plans/VOXEL_WORLD_PLAN.md) ----------
/** How a voxel material is drawn: solid ones block light and hide what is behind them, glass and water don't. */
export type VoxelMaterialKind = 'solid' | 'glass' | 'water' | 'emissive' | 'metal' | 'leaf' | 'snow';

/** One entry of a world's palette. A voxel's value v (1..255) is palette[v - 1]; 0 is empty. */
export interface VoxelMaterial {
  name: string;
  /** #rrggbb */
  color: string;
  /** extra shades (#rrggbb) a voxel may take instead of color, picked per voxel */
  ramp?: string[];
  /** 0..0.3: how much each voxel's brightness varies */
  jitter?: number;
  kind: VoxelMaterialKind;
  /** emissive: how bright it glows, 0..8 */
  emissive?: number;
  /** glass and water: 0..1 */
  opacity?: number;
  roughness?: number;
}

export type WorldEnvPreset = 'station' | 'day' | 'golden' | 'dusk' | 'night' | 'overcast' | 'snow';

/** Where a light or an effect is: pinned like an object (anchor), or to an object (it moves and turns with it). */
interface WorldPlaced {
  id: string;
  name: string;
  by: WorldBuilder;
  anchor: WorldAnchor;
  /** an object's id: then position is from that object's origin, and it turns with it */
  object?: string;
  /** map units */
  position: Vec3;
}

/** A light a builder put up. */
export interface WorldLight extends WorldPlaced {
  kind: 'point' | 'spot';
  color: string;
  /** 0..10: 1 is a lantern, 4 a street lamp, 10 a floodlight */
  intensity: number;
  /** how far it reaches, map units */
  range: number;
  /** spot: the point it shines at (same frame as position) and the cone's angle in degrees */
  target?: Vec3;
  angle?: number;
  /** 0..1: how much it flickers (a flame, a failing neon) */
  flicker?: number;
}

export type WorldEffectKind = 'petals' | 'leaves' | 'snow' | 'rain' | 'fireflies' | 'embers' | 'sparks' | 'smoke' | 'steam' | 'mist' | 'dust' | 'birds';

/** Particles in an area. */
export interface WorldEffect extends WorldPlaced {
  kind: WorldEffectKind;
  /** the area's size around position (w, h, d map units); position is its bottom centre */
  size: Vec3;
  /** 0..1: how many */
  amount: number;
  /** colours to pick from (#rrggbb); each kind has its own when left out */
  colors?: string[];
  /** which way and how hard it blows (map units a second) */
  wind?: Vec3;
}

/** Sky, fog, sun and the finishing touches of a world's look. Colors are #rrggbb, angles in degrees. */
export interface WorldEnvironment {
  preset: WorldEnvPreset;
  sky: { top: string; horizon: string; bottom: string };
  /** density 0..1 (0: no fog) */
  fog: { color: string; density: number };
  sun: { color: string; intensity: number; azimuth: number; elevation: number };
  ambient: { sky: string; ground: string; intensity: number };
  /** 0..2 glow around bright things */
  bloom: number;
  /** 0..1 miniature blur at the top and bottom of the view */
  tiltShift: number;
  exposure: number;
  /** weather over the whole map (besides effects in areas) */
  weather?: 'none' | 'snow' | 'rain' | 'petals' | 'leaves' | 'dust';
  /** wind for leaves, petals, snow and the sway of leaves (map units a second) */
  wind?: Vec3;
}

export type Vec3 = [number, number, number];

/** What an object is pinned to. It moves with that thing (a team dragged across the map). */
export type WorldAnchor = { to: 'world' } | { to: 'brain' } | { to: 'team'; id: string } | { to: 'agent'; id: string };

/** Who built or last changed something in a world. */
export interface WorldBuilder {
  kind: 'brain' | 'agent' | 'user';
  id?: string;
  name: string;
}

/** One grid of an object: all its voxels have one size. Voxel (x, y, z) sits at object origin + (x, y, z) × voxelSize. */
export interface VoxelVolumeMeta {
  id: string;
  voxelSize: number;
  /** voxels in it */
  count: number;
  /** the voxels it spans, inclusive (null when empty) */
  min: Vec3 | null;
  max: Vec3 | null;
}

export interface VoxelObjectMeta {
  id: string;
  name: string;
  by: WorldBuilder;
  /** who changed it last (may differ from who built it) */
  lastBy?: WorldBuilder;
  anchor: WorldAnchor;
  /** map units, from its anchor */
  position: Vec3;
  /** degrees, around the vertical */
  rotation: number;
  scale: number;
  volumes: VoxelVolumeMeta[];
  hidden?: boolean;
  /** where it last stood on the map: used when its anchor isn't in the project showing it */
  lastWorldPos?: Vec3;
  createdAt: number;
  updatedAt: number;
  /** when its voxels last changed (a move doesn't count): the page meshes it again */
  voxelsAt?: number;
  /** how many prefab copies are placed in it */
  instances?: number;
}

/** A prefab copy placed in an object (or in another prefab). Not voxels: the page repeats the prefab's mesh. */
export interface PrefabInstance {
  /** the prefab's id */
  prefab: string;
  /** where its pivot (bottom centre) stands, in map units from the object's origin */
  p: Vec3;
  /** degrees around the vertical, any angle */
  turn?: number;
  /** quarter turns around x (tilt) and z (roll): 0, 90, 180 or 270 */
  tilt?: number;
  roll?: number;
  scale?: number;
  /** mirrored left to right (across its own x) */
  mirror?: boolean;
  /** materials swapped in this copy: { "shirt": "cloth red" } */
  swap?: Record<string, string>;
  /** a part's name inside a character ("left arm"): animations move it by this name */
  name?: string;
}

/** One moment of a part in an animation. Turns are degrees around the part's own pivot (x, y, z); moves are map units. */
export interface AnimKey {
  /** when, from 0 (start) to 1 (end of the clip) */
  t: number;
  turn?: Vec3;
  move?: Vec3;
  scale?: number;
  /** how it gets here from the key before */
  ease?: 'linear' | 'smooth' | 'step' | 'bounce';
}

/** An animation a builder designed for a character prefab: keys per part ("self" moves the whole character). */
export interface AnimationClip {
  /** seconds */
  duration: number;
  loop: boolean;
  tracks: Record<string, AnimKey[]>;
}

/** An object's or a prefab's voxels (…/objects/<id>.json, …/prefabs/<id>.json): chunks run-length encoded
 *  (shared/voxel.ts), and the prefab copies placed in it. */
export interface VoxelObjectData {
  volumes: { id: string; voxelSize: number; chunks: Record<string, string> }[];
  instances?: PrefabInstance[];
}

/** A small model an agent made to place many times (a palm, a person, a taxi). Its voxels use the world's palette. */
export interface VoxelPrefabMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  by: WorldBuilder;
  lastBy?: WorldBuilder;
  volumes: VoxelVolumeMeta[];
  /** prefab copies placed inside it */
  instances?: number;
  /** map units from its voxels' origin to the point that stands on the spot it is placed at (bottom centre,
   *  unless the builder chose another: a top pivot for an arm that hangs from a shoulder) */
  pivot: Vec3;
  /** the pivot the builder chose; missing = bottom centre */
  pivotAt?: 'bottom' | 'top' | 'center' | Vec3;
  /** animations its builder designed (for characters made of named parts) */
  animations?: Record<string, AnimationClip>;
  /** how big it is, map units */
  size: Vec3;
  createdAt: number;
  updatedAt: number;
  voxelsAt?: number;
}

/** A voxel world (data/worlds/<id>/world.json). Projects point at one (ProjectWorldLink). */
export interface VoxelWorld {
  format: 1;
  id: string;
  name: string;
  /** the project it was first made for */
  homeProject: string;
  /** false until something is built in it: an unbuilt world can be replaced by a carried-over one */
  built: boolean;
  /** the voxel size new objects start with, in map units (a desk is 2.6 wide) */
  voxelSize: number;
  palette: VoxelMaterial[];
  objects: VoxelObjectMeta[];
  /** the prefabs its builders made */
  prefabs: VoxelPrefabMeta[];
  /** lights builders put up (glowing voxels light their surroundings by themselves too) */
  lights: WorldLight[];
  /** particles: falling petals, snow, fireflies, smoke… */
  effects: WorldEffect[];
  /** how the Brain, the team platforms and the agents look in this world (voxel look only) */
  skins: WorldSkins;
  environment: WorldEnvironment;
  createdAt: number;
  updatedAt: number;
}

/** Which world a project uses. */
export interface ProjectWorldLink {
  id: string;
  /** own: made for this project. shared: another project's world; changes show in both. */
  mode: 'own' | 'shared';
  /** the user picked it: carry-over never replaces their choice */
  chosen?: boolean;
}

/** The world a project shows (GET /api/world), and why. */
export interface ShownWorld {
  world: VoxelWorld | null;
  /** own, shared, carried over from another project, or none built anywhere */
  how: 'own' | 'shared' | 'carried' | 'none';
  /** for a carried-over or shared world: the project it was made for */
  fromProject?: string;
}

/** A world in the list of worlds (GET /api/worlds). */
export interface WorldListing {
  id: string;
  name: string;
  homeProject: string;
  built: boolean;
  objects: number;
  voxels: number;
  /** projects that use it */
  usedBy: string[];
  isDefault: boolean;
  updatedAt: number;
}

/** A world's WORLD.md (GET /api/world/md). */
export interface WorldMdInfo {
  worldId: string;
  text: string;
  updatedAt: number;
  max: number;
}

/** The fields every skin has: where its model sits from the classic one, turned and scaled. */
interface SkinPlacement {
  /** map units from where the classic model stands */
  offset?: Vec3;
  /** degrees around the vertical */
  turn?: number;
  scale?: number;
  /** take it off the map (the Station still works: click its name, or use the side panel) */
  hidden?: boolean;
  /** false: no name label on the map either */
  label?: boolean;
  /** who dressed it last */
  by?: WorldBuilder;
}

/** An agent in the voxel world: its character, its desk, and which animation plays when. */
export interface AgentSkin extends SkinPlacement {
  /** a prefab (id) made of named parts; it takes the classic person's place */
  character?: string;
  /** a prefab (id) that takes the classic desk's place (the monitor's screen stays) */
  desk?: string;
  /** the character's animation for each state (default: clips named idle, working, needs) */
  states?: { idle?: string; working?: string; needs?: string };
}

/** A team's platform and the hub in its middle. */
export interface TeamSkin extends SkinPlacement {
  platform?: string;
  hub?: string;
}

/** The Brain: a shell around (or instead of) the globe. */
export interface BrainSkin extends SkinPlacement {
  shell?: string;
  /** keep the particle globe, the beam and the halo (default true) */
  globe?: boolean;
}

export interface WorldSkins {
  brain?: BrainSkin;
  /** by team id */
  teams: Record<string, TeamSkin>;
  /** by agent id */
  agents: Record<string, AgentSkin>;
}

/** What a world_look picture shows (the 'world-look' event the Station answers). */
export interface WorldLookView {
  /** the whole world, or one thing in it */
  target: 'overview' | 'brain' | 'team' | 'agent' | 'object' | 'prefab';
  /** the team's, agent's, object's or prefab's id */
  id?: string;
  /** degrees; the Station's own view is azimuth 45, elevation 35 */
  azimuth?: number;
  elevation?: number;
  /** 1 fits the target; 2 is twice as close */
  zoom?: number;
  width: number;
  height: number;
}
