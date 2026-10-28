// What the Station's map and its panels share: the connections a team or agent can reach (services,
// programs, MCP servers, connectors on your Claude account), teams as the map draws them, and what a
// click on the map points at.
import { state } from '../core.ts';
import { logo } from '../icons.ts';
import { craftIcon, craftColor } from '../crafticons.ts';
import { appIcon } from '../appicons.ts';
import type { Agent, AppState, ProviderUsage, Team, TeamListing, TeamStep } from '../../shared/types.ts';

/** A connection a step can reach: a service, a program, an MCP server ('mcp:x') or a Claude account connector ('cc:x'). */
export interface Integration {
  id: string;
  label: string;
  glyph: string;
  color: string;
  mcp?: boolean;
}
/** One entry of GET /api/programs. */
export interface Program {
  id: string;
  name: string;
  category?: string;
  icon?: string;
  installed: boolean;
  optional?: boolean;
  exe: string | null;
  shortcut: string | null;
  version: string | null;
  versions?: string[] | null;
  cli: boolean;
  running: boolean;
  serviceUrl: string | null;
  actions?: unknown;
}
/** An integration this project has: is it up, and the program behind it. */
export interface AvailableIntegration extends Integration {
  live: boolean;
  program?: Program;
  missing?: boolean;
}
/** A connector on your Claude account (GET /api/headbar). */
export interface Connector {
  id: string;
  name: string;
  status: 'connected' | 'needs-auth' | 'failed' | 'off';
  detail: string;
}
/** GET /api/headbar: usage meters and Claude account connectors. */
export interface Headbar {
  usage?: unknown;
  usages: ProviderUsage[];
  connectors: Connector[];
}
/** A team as the map draws it: members, and one agent step per member. */
/** A team as the map draws it: steps are one per member; stepList keeps its saved steps. */
export type TeamView = TeamListing & { stepList?: TeamStep[] };
/** What a click on the map (or a label) points at. */
export type MapPick =
  | { type: 'agent'; id: string; wf?: string; step?: number }
  | { type: 'branch' | 'int'; id: string; wf?: undefined; step?: number }
  | { type: 'bench' | 'brain' | 'world'; id?: undefined; wf?: undefined; step?: undefined };

export const PALETTE = ['#3d58c0', '#b0508a', '#c07a34', '#3a8a7a', '#7350c8', '#b8a03a', '#4f7fa8', '#5a9a3a', '#a84a5a', '#2f8fa0'];
export const wfColor = (wf: Pick<Team, 'color'>, i: number): string => (/^#[0-9a-f]{6}$/i.test(wf.color || '') ? wf.color! : PALETTE[i % PALETTE.length]);

// ---------- connections ----------
// The connectors on your Claude account (from the header's GET /api/headbar), once the Station has them.
let claudeConnectors: Connector[] = [];
export const setClaudeConnectors = (list: Connector[]): void => void (claudeConnectors = list);

export const INTEGRATIONS: Integration[] = [
  { id: 'claude', label: 'Claude Code', glyph: '✳', color: '#d97757' },
  { id: 'hermes', label: 'Hermes', glyph: '☤', color: '#d8c25a' },
  { id: 'codex', label: 'OpenAI Codex', glyph: '◎', color: '#e6e8e0' },
  { id: 'reddit', label: 'Reddit', glyph: 'r/', color: '#ff4500' },
  { id: 'openrouter', label: 'OpenRouter', glyph: '⇄', color: '#94a3b8' },
  { id: 'lmstudio', label: 'LM Studio', glyph: 'LM', color: '#6a72ed' },
  { id: 'ollama', label: 'Ollama', glyph: 'OL', color: '#e6e8e0' },
  { id: 'x', label: 'X', glyph: '𝕏', color: '#e6e8e0' },
  { id: 'telegram', label: 'Telegram', glyph: '✈', color: '#4fb3f6' },
  { id: 'discord', label: 'Discord', glyph: 'D', color: '#7d86ff' },
  { id: 'comfyui', label: 'ComfyUI', glyph: '🧩', color: '#f2ff59' },
  { id: 'blender', label: 'Blender', glyph: 'B', color: '#f5792a' },
  { id: 'premiere', label: 'Premiere Pro', glyph: 'Pr', color: '#9a9aff' },
  { id: 'photoshop', label: 'Photoshop', glyph: 'Ps', color: '#31a8ff' },
  { id: 'aftereffects', label: 'After Effects', glyph: 'Ae', color: '#d291ff' },
  { id: 'ffmpeg', label: 'FFmpeg', glyph: '▶', color: '#5fe3a0' },
  { id: 'maya', label: 'Maya', glyph: 'M', color: '#37a5cc' },
  { id: 'houdini', label: 'Houdini', glyph: 'H', color: '#ff4713' },
  { id: 'substance', label: 'Substance 3D', glyph: 'Sb', color: '#ff6b4a' },
  { id: 'cad', label: 'CAD and 3D printing', glyph: '⚙', color: '#f9d72f' },
  { id: 'nvidia', label: 'NVIDIA', glyph: 'NV', color: '#76b900' },
  { id: 'assets', label: 'Free asset libraries', glyph: '▦', color: '#9fd8ff' },
  { id: 'orca', label: 'Orca', glyph: '🐋', color: '#7ab8ff' },
  { id: 'browser', label: 'Browser', glyph: '🌐', color: '#a9d3e2' },
];
const BRAND_OF: Record<string, string> = { codex: 'openai', reddit: 'reddit', claude: 'claude', x: 'x', telegram: 'telegram', discord: 'discord', blender: 'blender', maya: 'maya', houdini: 'houdini', cad: 'openscad', nvidia: 'nvidia', premiere: 'premiere', photoshop: 'photoshop', aftereffects: 'aftereffects', ffmpeg: 'ffmpeg', browser: 'chrome', ollama: 'ollama' };
// A brand logo, a Craft app's own icon (PhotoCraft…), or a program's own icon (ComfyUI), for a connector or MCP server name.
export const appLogo = (name: string, size: number): SVGSVGElement | HTMLImageElement | null => logo(name, size) || craftIcon(name, size) || appIcon(name, size);
// The brand logo for an integration (or connector name), falling back to its glyph.
export function mark(id: string, size = 14): SVGSVGElement | HTMLImageElement | string {
  const key = id.startsWith('mcp:') ? id.slice(4) : id.startsWith('cc:') ? id.slice(3) : BRAND_OF[id] || id;
  return appLogo(key, size) || intInfo(id)?.glyph || String(key).slice(0, 2).toUpperCase();
}
export const intInfo = (id: string): Integration | undefined => id.startsWith('cc:') ? { id, label: id.slice(3), glyph: connectorLook(id.slice(3)).glyph, color: connectorLook(id.slice(3)).color } : (id.startsWith('mcp:') ? { id, label: id.slice(4), glyph: '⌁', color: craftColor(id.slice(4)) || '#a9d3e2', mcp: true } : INTEGRATIONS.find((x) => x.id === id));

export function availableIntegrations(d: AppState, progs: Program[]): AvailableIntegration[] {
  const P = (id: string) => progs.find((p) => p.id === id);
  const avail: Record<string, boolean> = {
    claude: d.engines['claude-code'].installed,
    hermes: d.engines.hermes.installed,
    codex: !!d.engines.codex?.installed,
    reddit: (d.accounts.reddit || []).length > 0,
    openrouter: d.secrets.openrouterKey.set,
    lmstudio: !!P('lmstudio')?.installed,
    ollama: !!P('ollama')?.installed,
    x: d.accounts.x.length > 0,
    telegram: d.accounts.telegram.configured,
    discord: d.accounts.discord.configured,
    browser: true,
  };
  for (const id of ['comfyui', 'blender', 'maya', 'houdini', 'premiere', 'photoshop', 'aftereffects', 'ffmpeg', 'orca']) avail[id] = !!P(id)?.installed;
  avail.substance = ['painter', 'designer', 'sampler'].some((id) => P(id)?.installed);
  avail.cad = ['openscad', 'prusaslicer'].some((id) => P(id)?.installed);
  avail.nvidia = ['nvidiasmi', 'nvtt'].some((id) => P(id)?.installed);
  avail.assets = true;
  const list = INTEGRATIONS.filter((i) => avail[i.id]).map((i): AvailableIntegration => {
    const p = P(i.id);
    const live = p ? (p.cli ? true : !!p.running) : true;
    return { ...i, live, program: p };
  });
  for (const m of d.mcpServers || []) list.push({ ...intInfo(`mcp:${m}`)!, live: true });
  return list;
}

/** What agentLinks reads: an agent, or a team's extra access. */
export type LinkSource = Partial<Pick<Agent, 'engine' | 'claudeAuth' | 'provider' | 'toolGroups' | 'mcpServers'>>;
export function agentLinks(a: LinkSource | null | undefined): Set<string> {
  const s = new Set<string>();
  if (!a) return s;
  if (a.engine === 'claude-code') s.add(a.claudeAuth === 'openrouter' ? 'openrouter' : 'claude');
  if (a.engine === 'hermes') s.add('hermes');
  if (a.engine === 'codex') s.add('codex');
  if (a.engine === 'openai') s.add(a.provider === 'custom' ? 'openrouter' : a.provider!);
  const g = new Set(a.toolGroups || []);
  if (g.has('social')) ['x', 'reddit', 'telegram', 'discord'].forEach((x) => s.add(x));
  if (g.has('comfyui')) s.add('comfyui');
  if (g.has('blender')) s.add('blender');
  if (g.has('adobe')) ['premiere', 'photoshop', 'aftereffects'].forEach((x) => s.add(x));
  if (g.has('media')) s.add('ffmpeg');
  for (const id of ['maya', 'houdini', 'substance', 'cad', 'nvidia', 'assets']) if (g.has(id)) s.add(id);
  if (g.has('orca')) s.add('orca');
  if (g.has('browser')) s.add('browser');
  for (const m of a.mcpServers || []) s.add(`mcp:${m}`);
  if (a.engine === 'claude-code' && (a.claudeAuth || 'login') === 'login') for (const c of claudeConnectors || []) if (c.status === 'connected') s.add(`cc:${c.name}`);
  return s;
}

export function toolIntegration(name: unknown): string | null {
  const n = String(name || '');
  const map: [RegExp, string][] = [
    [/^blender_/, 'blender'],
    [/^comfyui_/, 'comfyui'],
    [/^photoshop_/, 'photoshop'],
    [/^aftereffects_/, 'aftereffects'],
    [/^premiere_/, 'premiere'],
    [/^(ff(mpeg|probe)|handbrake_encode|imagemagick)$/, 'ffmpeg'],
    [/^maya_/, 'maya'],
    [/^houdini_/, 'houdini'],
    [/^substance_/, 'substance'],
    [/^(openscad_render|slice_model)$/, 'cad'],
    [/^nvidia_/, 'nvidia'],
    [/^asset_/, 'assets'],
    [/^(x_|social_)/, 'x'],
    [/^telegram_/, 'telegram'],
    [/^reddit_/, 'reddit'],
    [/^discord_/, 'discord'],
    [/^orca$/, 'orca'],
    [/^hermes_ask$/, 'hermes'],
    [/^(open_url|fetch_url|WebFetch|WebSearch)$/, 'browser'],
  ];
  for (const [re, id] of map) if (re.test(n)) return id;
  const m = /^mcp__(.+?)__/.exec(n);
  if (m && /^claude_ai_/.test(m[1])) {
    const name = m[1].replace(/^claude_ai_/, '').replace(/_/g, ' ').toLowerCase();
    const c = (claudeConnectors || []).find((x) => x.name.toLowerCase() === name);
    if (c) return `cc:${c.name}`;
  }
  if (m) return `mcp:${m[1]}`;
  const srv = (state.data?.mcpServers || []).find((s) => n.startsWith(`${s}__`));
  if (srv) return `mcp:${srv}`;
  if (/^(Bash|Read|Write|Edit|Glob|Grep|Task|ToolSearch)$/.test(n)) return 'claude';
  return null;
}

// What a workflow step can reach.
export function stepLinks(step: TeamStep, agentsById: Map<string, Agent>, wf: TeamView | null = null): Set<string> {
  if (step.type === 'agent') {
    const links = agentLinks(agentsById.get(step.agentId!));
    if (wf?.access) agentLinks({ toolGroups: wf.access.toolGroups, mcpServers: wf.access.mcpServers }).forEach((l) => links.add(l));
    return links;
  }
  if (step.type === 'tool') {
    const i = toolIntegration(step.tool);
    return new Set<string>(i ? [i] : []);
  }
  if (step.type === 'x_post') return new Set(['x']);
  if (step.type === 'notify' && step.telegram) return new Set(['telegram']);
  return new Set<string>();
}

// Brand-ish tiles for connectors on your Claude account (no logos bundled: letters in brand colors).
export function connectorLook(name: string): { glyph: string; color: string } {
  const n = name.toLowerCase();
  const map: [RegExp, string, string][] = [
    [/gmail/, 'M', '#ea4335'],
    [/calendar/, '31', '#4285f4'],
    [/drive/, '▲', '#34a853'],
    [/notion/, 'N', '#e6e8e0'],
    [/higgsfield/, 'H', '#c4ff3d'],
    [/claude docs|docs/, 'CD', '#d97757'],
    [/slack/, '#', '#e01e5a'],
    [/linear/, 'L', '#5e6ad2'],
    [/atlassian|jira|confluence/, 'A', '#2684ff'],
    [/intercom/, 'I', '#1f8ded'],
    [/figma/, 'F', '#f24e1e'],
    [/github/, 'GH', '#e6e8e0'],
    [/stripe/, 'S', '#635bff'],
    [/canva/, 'C', '#00c4cc'],
  ];
  for (const [re, glyph, color] of map) if (re.test(n)) return { glyph, color };
  const craft = craftColor(name);
  return { color: craft || '#a9d3e2', glyph: name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '⌁' };
}
