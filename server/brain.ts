// The Brain's own thinking: pick the right agent or branch for a message, design a new agent, or build a branch.
// Runs on the model you pick for it: Claude Code, OpenRouter, Hermes or Codex.
import fs from 'node:fs';
import { agents, workflows, getSecrets, getSettings } from './store.ts';
import { TOOL_GROUPS } from './tools.ts';
import { listServers, serversForPrompt } from './mcp.ts';
import { run, which, tmpFile } from './util.ts';
import { describeAttachments } from './uploads.ts';
import { brainSession, systemMessage } from './promptcache.ts';
import { effortFor } from '../shared/effort.ts';
import type { Agent, BrainSetting, Effort, EngineId, Team, TeamAccess } from '../shared/types.ts';

// ---------- what the models send back (JSON boundaries) ----------
interface OpenRouterChat {
  error?: { message?: string };
  choices?: { message?: { content?: string }; finish_reason?: string }[];
}
interface CodexLine {
  type?: string;
  item?: { type?: string; text?: string };
  error?: { message?: string };
  message?: string;
}
interface HermesLine {
  type?: string;
  text?: string;
}
interface ClaudeResult {
  is_error?: boolean;
  result?: string;
}
/** An agent as the model describes it (any field may be missing or the wrong shape). */
interface AgentAnswer {
  name?: unknown;
  emoji?: unknown;
  specialty?: unknown;
  instructions?: unknown;
  systemPrompt?: unknown;
  tools?: string[];
  toolGroups?: string[];
  mcpServers?: string[];
}
interface RouteAnswer {
  kind?: string;
  id?: string;
  reason?: string;
}
interface BranchAnswer {
  name?: unknown;
  description?: unknown;
  lead?: unknown;
  access?: { tools?: string[]; mcpServers?: string[] };
  members?: { agentId?: string; newAgent?: AgentAnswer }[];
  steps?: { agentId?: string; newAgent?: AgentAnswer }[];
}

// ---------- what this file returns ----------
export interface BrainModel {
  provider: BrainSetting['provider'];
  model: string;
  /** for this provider ('' = the model's default) */
  effort: Effort | '';
  fallback: boolean;
}
export type BrainRoute = { kind: 'none'; reason: string } | { kind: 'agent' | 'branch'; id: string; name: string; reason: string };
/** A new agent the Brain designed (not saved yet). */
export type AgentDraft = Pick<Agent, 'name' | 'emoji' | 'specialty' | 'systemPrompt' | 'toolGroups' | 'mcpServers' | 'engine'>;
export type BranchMember = { agentId: string; newAgent?: undefined } | { newAgent: AgentDraft; agentId?: undefined };
/** A team the Brain designed. leadIndex points into members (-1 = no lead). */
export interface BranchDesign {
  name: string;
  description: string;
  access: TeamAccess;
  members: BranchMember[];
  leadIndex: number;
}
export interface ThinkOptions {
  tools?: string;
  cwd?: string;
  timeout?: number;
  maxTokens?: number;
  /** what it does while it thinks, as it happens (see ThinkPart) */
  onPart?: (part: ThinkPart) => void;
}

const GROUP_IDS = TOOL_GROUPS.map((g) => g.id);

// Which model the Brain uses (Settings > General > The Brain's model, or the chip in the Brain chat).
// Claude Code, OpenRouter, Hermes or Codex. Falls back to whatever is available.
export function brainModel(): BrainModel {
  const b: Partial<BrainSetting> = getSettings().brain || {};
  const key = !!getSecrets().openrouterKey;
  const ok: Record<BrainSetting['provider'], boolean> = { claude: !!which('claude'), openrouter: key, hermes: !!which('hermes'), codex: !!which('codex') };
  const p: BrainSetting['provider'] = ok[b.provider as BrainSetting['provider']] ? (b.provider as BrainSetting['provider']) : (['claude', 'openrouter', 'hermes', 'codex'] as const).find((x) => ok[x]) || b.provider || 'claude';
  const model = p === b.provider ? b.model ?? '' : '';
  const dflt = { claude: 'haiku', openrouter: 'anthropic/claude-haiku-5.5', hermes: '', codex: '' }[p];
  const engine = ({ claude: 'claude-code', openrouter: 'openai', hermes: 'hermes', codex: 'codex' } as const satisfies Record<BrainSetting['provider'], EngineId>)[p];
  const effort = p === b.provider ? effortFor(engine, b.effort) : '';
  return { provider: p, model: model || dflt, effort, fallback: p !== (b.provider || 'claude') };
}

/** What the Brain's model does while it thinks, as it happens (ThinkOptions.onPart): its text as it is
 *  written, and the tools it uses (reading the project's files) with their results. */
export type ThinkPart = { kind: 'text'; text: string } | { kind: 'tool'; id: string; name: string; args?: unknown } | { kind: 'tool_result'; id: string; text: string; isError?: boolean };

/** One line of `claude -p --output-format stream-json` (the fields used here). */
interface ClaudeLine {
  type?: string;
  parent_tool_use_id?: string | null;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  message?: { content?: { type: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean; text?: string }[] };
  is_error?: boolean;
  result?: string;
}
/** One line of `codex exec --json`, for its steps. */
interface CodexStep {
  type?: string;
  item?: { id?: string; type?: string; text?: string; command?: string; aggregated_output?: string | null; exit_code?: number | null; server?: string; tool?: string; arguments?: unknown; result?: unknown; error?: unknown };
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join('\n') : v == null ? '' : JSON.stringify(v));

// tools: read-only Claude Code tools (e.g. "Read,Glob,Grep") the Brain may use inside cwd.
// Codex reads the folder in a read-only sandbox instead.
// onPart: the answer as it is written and the tools it uses, while it thinks (the Brain chat streams them).
export async function think(system: string, user: string, { tools = '', cwd, timeout = 90000, maxTokens = 2500, onPart }: ThinkOptions = {}): Promise<string> {
  const key = getSecrets().openrouterKey;
  const bm = brainModel();
  const part = (p: ThinkPart) => {
    try {
      onPart?.(p);
    } catch {
      /* a listener's problem is not the answer's */
    }
  };
  if (bm.provider === 'openrouter' && key) {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'X-Title': 'Blacksite' },
      body: JSON.stringify({ model: bm.model, messages: [systemMessage(bm.model, system), { role: 'user', content: user }], session_id: brainSession(system), max_tokens: maxTokens, ...(bm.effort ? { reasoning: { effort: bm.effort } } : {}), ...(onPart ? { stream: true } : {}) }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!onPart || !r.ok || !r.body) {
      const j = (await r.json()) as OpenRouterChat;
      if (!r.ok) throw new Error(j.error?.message || `OpenRouter said ${r.status}`);
      // stopped at max_tokens: half an answer (half a JSON object) is no answer
      if (j.choices?.[0]?.finish_reason === 'length') throw new Error('The answer was cut off: it ran past the length limit.');
      return j.choices?.[0]?.message?.content || '';
    }
    // streamed: the text as it comes
    let text = '';
    let buf = '';
    const dec = new TextDecoder();
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
        try {
          const j = JSON.parse(line.slice(5)) as { error?: { message?: string }; choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
          if (j.error) throw new Error(j.error.message || 'OpenRouter failed.');
          // (streamed too: stopped at max_tokens is no answer)
          if (j.choices?.[0]?.finish_reason === 'length') throw new Error('The answer was cut off: it ran past the length limit.');
          const d = j.choices?.[0]?.delta?.content;
          if (d) {
            text += d;
            part({ kind: 'text', text: d });
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    return text;
  }
  if (bm.provider === 'codex') {
    const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', ...(cwd ? ['-C', cwd] : []), ...(bm.model ? ['-m', bm.model] : []), ...(bm.effort ? ['-c', `model_reasoning_effort="${bm.effort}"`] : []), '-'];
    let said = false;
    const onLine = onPart
      ? (line: string) => {
          if (!line.trim().startsWith('{')) return;
          let ev: CodexStep;
          try {
            ev = JSON.parse(line) as CodexStep;
          } catch {
            return;
          }
          const it = ev.item || {};
          const done = ev.type === 'item.completed';
          // (a tool starts once, on item.started; item.updated says it is still going)
          const started = ev.type === 'item.started';
          if (it.type === 'agent_message' && done && it.text) {
            part({ kind: 'text', text: (said ? '\n\n' : '') + it.text });
            said = true;
          } else if (it.type === 'command_execution' && it.id) {
            if (started) part({ kind: 'tool', id: it.id, name: 'Bash', args: { command: it.command } });
            else if (done) part({ kind: 'tool_result', id: it.id, text: String(it.aggregated_output ?? '').slice(0, 20000), isError: it.exit_code != null && it.exit_code !== 0 });
          } else if (it.type === 'mcp_tool_call' && it.id) {
            if (started) part({ kind: 'tool', id: it.id, name: `${it.server}__${it.tool}`, args: it.arguments ?? {} });
            else if (done) part({ kind: 'tool_result', id: it.id, text: asText(it.result ?? it.error).slice(0, 20000), isError: !!it.error });
          }
        }
      : undefined;
    const r = await run('codex', args, { input: `<instructions>\n${system}\n</instructions>\n\n${user}`, timeout, cwd, onLine });
    let answer = '';
    let err = '';
    for (const line of r.stdout.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const ev = JSON.parse(line) as CodexLine;
        if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') answer += (answer ? '\n\n' : '') + (ev.item.text || '');
        else if (ev.type === 'turn.failed') err = ev.error?.message || 'Codex failed.';
        else if (ev.type === 'error' && !/Reconnecting/.test(ev.message || '')) err = ev.message || err;
      } catch {
        /* not JSON */
      }
    }
    if (!answer) throw new Error(/login|auth|401/i.test(err + r.stderr) ? 'Codex is not signed in (Settings > General > OpenAI Codex > Sign in).' : `Codex didn't answer (${(err || r.stderr || '').trim().slice(-300)})`);
    return answer;
  }
  if (bm.provider === 'hermes') {
    const onLine = onPart
      ? (line: string) => {
          if (!line.trim().startsWith('{')) return;
          try {
            const m = JSON.parse(line) as HermesLine;
            if (m.type === 'text' && m.text) part({ kind: 'text', text: m.text });
          } catch {
            /* not JSON */
          }
        }
      : undefined;
    const r = await run('hermes', ['chat', '--query-file', '-', '--format', 'stream-json', ...(bm.model ? ['-m', bm.model] : []), ...(bm.effort ? ['--reasoning', bm.effort] : [])], { input: `${system}\n\n---\n\n${user}`, timeout, cwd, env: { PYTHONIOENCODING: 'utf-8' }, onLine });
    let text = '';
    let result: HermesLine | null = null;
    for (const line of r.stdout.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const m = JSON.parse(line) as HermesLine;
        if (m.type === 'text' && m.text) text += m.text;
        else if (m.type === 'result') result = m;
      } catch {
        /* not JSON */
      }
    }
    const out = result?.text || text;
    if (!out) throw new Error(`Hermes didn't answer (${(r.stderr || '').trim().slice(-300)})`);
    return out;
  }
  if (!which('claude')) throw new Error('The Brain needs Claude Code, an OpenRouter key, Hermes or Codex.');
  const promptFile = tmpFile('brain-system.md');
  fs.writeFileSync(promptFile, system);
  // streamed (onPart): stream-json, with the text as it is written and the files it reads
  const format = onPart ? ['--output-format', 'stream-json', '--verbose', '--include-partial-messages'] : ['--output-format', 'json'];
  let final: ClaudeLine | null = null;
  const onLine = onPart
    ? (line: string) => {
        if (!line.trim().startsWith('{')) return;
        let m: ClaudeLine;
        try {
          m = JSON.parse(line) as ClaudeLine;
        } catch {
          return;
        }
        if (m.parent_tool_use_id) return;
        if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta' && m.event.delta.text) part({ kind: 'text', text: m.event.delta.text });
        else if (m.type === 'assistant') for (const b of m.message?.content || []) b.type === 'tool_use' && b.id && part({ kind: 'tool', id: b.id, name: b.name || 'tool', args: b.input });
        else if (m.type === 'user') for (const b of m.message?.content || []) b.type === 'tool_result' && b.tool_use_id && part({ kind: 'tool_result', id: b.tool_use_id, text: asText(b.content).slice(0, 20000), isError: !!b.is_error });
        else if (m.type === 'result') final = m;
      }
    : undefined;
  const r = await run(
    'claude',
    ['-p', '--model', bm.model, ...(bm.effort ? ['--effort', bm.effort] : []), ...format, '--no-session-persistence', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', tools, ...(tools ? ['--allowedTools', ...tools.split(',')] : []), '--system-prompt-file', promptFile],
    { input: user, timeout, cwd, onLine },
  );
  fs.rm(promptFile, { force: true }, () => {});
  let out: ClaudeResult;
  try {
    out = onPart ? ((final as ClaudeLine | null) ?? (JSON.parse(r.stdout) as ClaudeResult)) : (JSON.parse(r.stdout) as ClaudeResult);
  } catch {
    throw new Error(`Claude Code didn't answer (${(r.stderr || r.stdout).trim().slice(-300)})`);
  }
  if (out.is_error) throw new Error(out.result || 'Claude Code reported an error');
  return out.result || '';
}

export function parseJSON<T>(text: unknown): T {
  const m = /\{[\s\S]*\}/.exec(String(text));
  if (!m) throw new Error('The answer was not JSON.');
  return JSON.parse(m[0]) as T;
}

const agentLine = (a: Agent) => `- id=${a.id} | ${a.name} | ${a.specialty || a.description || ''} | tools: ${(a.toolGroups || []).join(',')} | brain: ${a.engine}`;
const teamMembers = (w: Team): string[] => (Array.isArray(w.members) ? w.members : [...new Set((w.steps || []).filter((s) => s.type === 'agent').map((s) => s.agentId as string))]);
const branchLine = (w: Team, byId: Map<string, Agent>) =>
  `- id=${w.id} | ${w.name} | ${w.description || ''} | members: ${teamMembers(w).map((id) => `${byId.get(id)?.name || '?'}${w.lead === id ? ' (lead)' : ''}`).join(', ')}`;

const TOOLS_TEXT = TOOL_GROUPS.map((g) => `${g.id}: ${g.description}`).join('\n');

// ---------- Auto: who should handle this? ----------
export async function route(text: string): Promise<BrainRoute> {
  const all = agents.list();
  const wfs = workflows.list().filter((w) => teamMembers(w).length);
  if (!all.length) return { kind: 'none', reason: 'You have no agents yet.' };
  const byId = new Map(all.map((a) => [a.id, a]));
  const system = `You route a user's request to ONE of their existing agents or teams (a team is a group chat of agents with a shared goal; in the JSON a team is kind "branch").
Pick a team only when the request clearly matches what the whole team does; otherwise pick the single best agent.
If nothing fits at all, answer kind "none".
Answer with JSON only: {"kind":"agent"|"branch"|"none","id":"<id>","reason":"<max 12 words>"}`;
  const user = `Agents:\n${all.map(agentLine).join('\n')}\n\nTeams (kind "branch"):\n${wfs.map((w) => branchLine(w, byId)).join('\n') || '(none)'}\n\nRequest:\n${text}`;
  const j = parseJSON<RouteAnswer>(await think(system, user));
  if (j.kind === 'agent' && byId.has(j.id as string)) return { kind: 'agent', id: j.id as string, name: byId.get(j.id as string)!.name, reason: j.reason || '' };
  if (j.kind === 'branch' && wfs.some((w) => w.id === j.id)) return { kind: 'branch', id: j.id as string, name: wfs.find((w) => w.id === j.id)!.name, reason: j.reason || '' };
  return { kind: 'none', reason: j.reason || 'No good match.' };
}

// ---------- New agent ----------
function cleanAgent(j: AgentAnswer): AgentDraft {
  return {
    name: String(j.name || 'New agent').slice(0, 40),
    emoji: String(j.emoji || '🤖').slice(0, 4),
    specialty: String(j.specialty || '').slice(0, 140),
    systemPrompt: String(j.instructions || j.systemPrompt || '').slice(0, 8000),
    toolGroups: (Array.isArray(j.tools) ? j.tools : j.toolGroups || []).filter((t) => GROUP_IDS.includes(t)),
    mcpServers: (Array.isArray(j.mcpServers) ? j.mcpServers : []).filter((m) => m in listServers()),
    engine: 'claude-code',
  };
}

const AGENT_SCHEMA = `{"name":"short role name","emoji":"one emoji","specialty":"one line: what it is good at","instructions":"how it works: process, rules, what good output looks like (5-12 sentences, second person)","tools":["tool group ids"],"mcpServers":["names"]}`;

// Files you attached: where they are, and the start of small text files (the design model can't open files).
const filesFor = (attachments: string[] | undefined) => (attachments?.length ? `\n\n${describeAttachments(attachments, { inline: 12000 })}` : '');

export async function designAgent(text: string, { attachments = [] }: { attachments?: string[] } = {}): Promise<AgentDraft> {
  const system = `You design one AI agent for the user's personal dashboard from their description.
Available tool groups (use only these ids, only what the job needs):
${TOOLS_TEXT}
Available MCP servers: ${serversForPrompt() || '(none)'}
Rules: posts and DMs always wait for the user's approval; never invent facts or numbers.
Answer with JSON only: ${AGENT_SCHEMA}`;
  return cleanAgent(parseJSON<AgentAnswer>(await think(system, `${text || 'Design the agent from the attached files: what they are about is what it should be good at.'}${filesFor(attachments)}`)));
}

// ---------- New branch ----------
// A team is a group chat of agents: pick members (existing first) and a lead who coordinates.
export async function designBranch(text: string, { allowNew = true, attachments = [] }: { allowNew?: boolean; attachments?: string[] } = {}): Promise<BranchDesign> {
  const all = agents.list();
  const byId = new Map(all.map((a) => [a.id, a]));
  const system = `You put together a team for the user's personal dashboard. A team is a group chat of 2-6 AI agents who share one goal: the user writes in the chat, a lead coordinates, and agents hand work to each other by @mentioning a teammate.
Use the user's existing agents wherever they fit.${allowNew ? ' If an essential role is missing, add a new agent for it (at most 2 new agents).' : ' Use ONLY existing agents.'}
Pick a lead only when 3 or more agents need coordinating (a planner/chief-of-staff type if available).
Tool groups for the team's "access" (ids only): ${GROUP_IDS.join(', ')}
MCP servers: ${serversForPrompt() || '(none)'}
Answer with JSON only:
{"name":"short name","description":"one sentence: the team's shared goal","lead":"<existing agent id, or the 'name' of a new agent, or empty>","access":{"tools":["ids"],"mcpServers":["names"]},
 "members":[{"agentId":"<existing id>"} | {"newAgent":${AGENT_SCHEMA}}]}`;
  const user = `Existing agents:\n${all.map(agentLine).join('\n') || '(none)'}\n\nWhat the team should do:\n${text || '(see the attached files)'}${filesFor(attachments)}`;
  const j = parseJSON<BranchAnswer>(await think(system, user));
  const members: BranchMember[] = [];
  for (const m of j.members || j.steps || []) {
    if (m.agentId && byId.has(m.agentId) && !members.some((x) => x.agentId === m.agentId)) members.push({ agentId: m.agentId });
    else if (m.newAgent && allowNew) members.push({ newAgent: cleanAgent(m.newAgent) });
  }
  const leadKey = String(j.lead || '');
  const leadIndex = members.findIndex((m) => m.agentId === leadKey || (m.newAgent && m.newAgent.name.toLowerCase() === leadKey.toLowerCase()));
  return {
    name: String(j.name || 'New team').slice(0, 50),
    description: String(j.description || '').slice(0, 300),
    access: { toolGroups: (j.access?.tools || []).filter((t) => GROUP_IDS.includes(t)), mcpServers: (j.access?.mcpServers || []).filter((m) => m in listServers()) },
    members,
    leadIndex,
  };
}

// In a team without a lead: which member should answer this message?
export async function pickMember(text: string, members: (Agent | null | undefined)[]): Promise<string | null> {
  const list = members.filter((a): a is Agent => Boolean(a));
  if (list.length <= 1) return list[0]?.id || null;
  const system = 'Pick the ONE team member best suited to handle the message. Answer with JSON only: {"id":"<member id>"}';
  const user = `Members:\n${list.map(agentLine).join('\n')}\n\nMessage:\n${text}`;
  const j = parseJSON<{ id?: string }>(await think(system, user));
  return list.some((a) => a.id === j.id) ? (j.id as string) : null;
}

// ---------- Skills from plain words ----------
/** A skill the Brain wrote or changed from your words (not saved: you look it over first). */
export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  /** One sentence: what it wrote or changed */
  note: string;
}
/** The skill as it is in the editor now (changes not saved yet included). */
export interface SkillText {
  name: string;
  description: string;
  body: string;
}
interface SkillAnswer {
  name?: unknown;
  description?: unknown;
  body?: unknown;
  note?: unknown;
}
export interface DraftSkillOptions {
  /** Editing: the skill as it is now. Without it a new skill is written. */
  current?: SkillText | null;
  /** Its extra files (names only), so the instructions can point at them */
  files?: string[];
  /** Other skills in the library, so it doesn't write one that is already there */
  others?: { slug: string; name: string; description: string }[];
  attachments?: string[];
  /** The model call (tests pass their own). maxTokens: room for the whole answer. */
  ask?: (system: string, user: string, opts: { maxTokens: number }) => Promise<string>;
}

const SKILL_NAME_MAX = 80;
const SKILL_DESC_MAX = 1000;
const SKILL_TEXT_MAX = 60000;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Room for the answer: an edit sends the whole skill back, so a long skill needs more (about 3 characters a token). */
export function skillAnswerBudget(current: SkillText | null): number {
  const chars = current ? current.name.length + current.description.length + current.body.length : 0;
  return Math.min(32000, Math.max(4000, Math.ceil(chars / 3) + 3000));
}

const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
/** The library for the prompt: the skills most like the request with what they're for, then every other one's name. */
export function libraryForPrompt(others: { name: string; description: string }[], about: string, { detailed = 40, names = 400 } = {}): string {
  if (!others.length) return '';
  const want = words(about);
  const scored = others.map((o, i) => {
    const have = words(`${o.name} ${o.description}`);
    let n = 0;
    for (const w of want) if (have.has(w)) n++;
    return { o, n, i };
  });
  scored.sort((a, b) => b.n - a.n || a.i - b.i);
  const top = scored.slice(0, detailed).map(({ o }) => `- ${o.name}: ${o.description.replace(/\s+/g, ' ').slice(0, 160)}`);
  const rest = scored.slice(detailed).map(({ o }) => o.name.slice(0, 60));
  const more = rest.length > names ? ` …and ${rest.length - names} more` : '';
  return `${top.join('\n')}${rest.length ? `\nAlso in the library (names only): ${rest.slice(0, names).join(', ')}${more}` : ''}`;
}

// Write a new skill from a description, or change one as asked (the whole skill comes back, every field).
export async function draftSkill(request: string, { current = null, files = [], others = [], attachments = [], ask = (s, u, o) => think(s, u, { timeout: 180_000, maxTokens: o.maxTokens }) }: DraftSkillOptions = {}): Promise<SkillDraft> {
  const editing = !!current;
  const library = libraryForPrompt(
    others.filter((o) => o.name !== current?.name),
    `${request} ${current?.name || ''} ${current?.description || ''}`,
  );
  const system = `You write skills for the user's AI agents. A skill is reusable know-how in Claude Code's SKILL.md format:
- name: short, plain (2-5 words)
- description: one or two sentences saying WHEN to use it. Agents decide from this line alone whether the skill fits a task, so name the kinds of work it covers.
- body: the instructions in markdown: steps, rules, examples, what good output looks like, pitfalls.
${editing ? 'Change the CURRENT skill the way the user asks. Keep everything they did not ask to change exactly as it is, word for word. Return the whole skill, every field in full, not only the parts that changed.' : "Write a new skill from the user's request."}
Write the instructions for an AI agent, in the second person, concrete and specific, without filler. Don't invent facts about the user's business, products or numbers: where one is needed and not given, write a placeholder like [your product name].
Never put secrets (API keys, passwords, tokens) in a skill: if the request includes one, leave it out and say so in "note".
${library ? `Skills already in the library, the most related first (don't write a copy of one; if the request is the same as one, say so in "note"):\n${library}\n` : ''}Answer with JSON only: {"name":"…","description":"…","body":"the instructions in markdown","note":"one sentence: what you wrote or changed"}`;
  const cur = current ? `CURRENT skill:\nname: ${current.name}\ndescription: ${current.description}\n${files.length ? `extra files with it: ${files.slice(0, 40).join(', ')}\n` : ''}body:\n${current.body.trim() || '(empty)'}\n\n` : '';
  const what = request.trim() || (editing ? 'Improve it using the attached files.' : 'Write a skill from the attached files: the way of working they show.');
  const user = `${cur}${editing ? 'What to change' : 'The skill to write'}:\n${what}${filesFor(attachments)}`;
  const CUT = "The Brain's answer was cut off before the end (the skill is long). Ask for a smaller change, or edit that part by hand.";
  let raw: string;
  try {
    raw = await ask(system, user, { maxTokens: skillAnswerBudget(current) });
  } catch (e) {
    if (/cut off|length limit|max_tokens|maximum.*tokens/i.test((e as Error).message)) throw new Error(CUT);
    throw e;
  }
  let j: SkillAnswer;
  try {
    j = parseJSON<SkillAnswer>(raw);
  } catch {
    // an object that starts but never ends ran out of room
    const t = String(raw).trim();
    if (t.includes('{') && !t.endsWith('}') && !/\}\s*`{3}$/.test(t)) throw new Error(CUT);
    throw new Error("The Brain's answer wasn't a skill. Try again, or say it differently.");
  }
  // a field left out (or emptied) while editing stays as it was
  const pick = (v: unknown, was: string | undefined, max: number) => (str(v).trim() ? str(v).trim() : (was ?? '').trim()).slice(0, max);
  const draft: SkillDraft = {
    name: pick(j.name, current?.name, SKILL_NAME_MAX),
    description: pick(j.description, current?.description, SKILL_DESC_MAX).replace(/\s+/g, ' '),
    body: pick(j.body, current?.body, SKILL_TEXT_MAX),
    note: str(j.note).trim().slice(0, 300),
  };
  if (!draft.name || !draft.description || !draft.body) throw new Error("The Brain's answer was missing the skill's name, description or instructions. Try again.");
  return draft;
}
