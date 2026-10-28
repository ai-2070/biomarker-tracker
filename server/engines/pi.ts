// pi and oh-my-pi engines: one `pi --mode json` (or `omp --mode json`) run per message, continuing the
// chat's own session. The two share one event stream (oh-my-pi is built on pi), so one engine serves both.
// They bring their own tools (read, bash, edit, write…), run them without asking, and get the dashboard
// tools once the bridge is added to their mcp.json (addBridge: Tools & MCP page).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { which, spawnCommand, run as runCmd, BRIDGE_SCRIPT, PORT, DATA, HOME, dataPath, ensureDir, writeJSON } from '../util.ts';
import { emit, internalToken, log } from '../store.ts';
import { toolDefs, workspaceOf } from '../tools.ts';
import { effortFor } from '../../shared/effort.ts';
import { cliStatus, pipeLines, tail, SessionGone } from './cli.ts';
import { splitContent } from '../toolimages.ts';
import type { CliStatus } from './cli.ts';
import type { Agent, RunEvent } from '../../shared/types.ts';
import type { Engine, EngineRunArgs, EngineResult } from './index.ts';

export type PiFlavor = 'pi' | 'omp';
const LABEL: Record<PiFlavor, string> = { pi: 'pi', omp: 'oh-my-pi' };
const INSTALL: Record<PiFlavor, string> = { pi: 'npm install -g @earendil-works/pi-coding-agent', omp: 'bun install -g @oh-my-pi/pi-coding-agent' };

// ---------- the event stream (only the fields used here) ----------
interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
}
interface PiContent {
  type?: string;
  text?: string;
}
interface PiMessage {
  role?: string;
  content?: PiContent[] | string;
  provider?: string;
  model?: string;
  usage?: PiUsage;
  stopReason?: string;
  errorMessage?: string;
}
/** One line of `pi --mode json` / `omp --mode json`. */
export interface PiEvent {
  type?: string;
  /** the session header (first line) */
  id?: string;
  message?: PiMessage;
  assistantMessageEvent?: { type?: string; delta?: string };
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  attempt?: number;
  maxAttempts?: number;
  errorMessage?: string;
  reason?: string;
  level?: string;
  aborted?: boolean;
  compactionResult?: unknown;
}

/** The images in a tool result ({ content: [{ type: 'image', data, mimeType }] }), as data: URIs. */
export function toolImages(result: unknown): string[] {
  const content = (result as { content?: unknown } | null)?.content;
  return Array.isArray(content) ? splitContent(content).images : [];
}

/** The text in a tool result ({ content: [{ type: 'text', text }] }, or anything else). */
export function toolText(result: unknown): string {
  if (typeof result === 'string') return result;
  const content = (result as { content?: unknown } | null)?.content;
  if (Array.isArray(content))
    return content
      .map((c: PiContent) => (c?.type === 'text' ? c.text || '' : c?.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  return result == null ? '' : JSON.stringify(result);
}

const messageText = (m: PiMessage | undefined): string => (typeof m?.content === 'string' ? m.content : (m?.content || []).filter((c) => c?.type === 'text').map((c) => c.text || '').join(''));

/** Reads the event stream into chat events and the run's answer, usage and session. */
export function piReader(onEvent: (ev: RunEvent) => void, onSession: (id: string) => void) {
  let answer = '';
  // text of the assistant message being streamed (a new one after a tool or another message starts a new block)
  let streamed = '';
  let lastError = '';
  let model = '';
  let tokens = 0;
  let cached = 0;
  let cost = 0;
  let context = 0;
  let ended = false;
  const handle = (ev: PiEvent) => {
    const t = ev.type || '';
    if (t === 'session' && ev.id) onSession(ev.id);
    else if (t === 'message_update') {
      const a = ev.assistantMessageEvent || {};
      if (a.type === 'text_delta' && a.delta) {
        if (!streamed && answer) {
          onEvent({ kind: 'text', text: '\n\n' });
          answer += '\n\n';
        }
        streamed += a.delta;
        answer += a.delta;
        onEvent({ kind: 'text', text: a.delta });
      } else if (a.type === 'thinking_start') onEvent({ kind: 'status', text: 'Thinking…' });
    } else if (t === 'message_end' && ev.message?.role === 'assistant') {
      const m = ev.message;
      // a message that came without deltas (some providers): its whole text now
      const full = messageText(m);
      if (full && !streamed) {
        const sep = answer ? '\n\n' : '';
        onEvent({ kind: 'text', text: sep + full });
        answer += sep + full;
      }
      streamed = '';
      if (m.model && !model) {
        model = m.provider ? `${m.provider}/${m.model}` : m.model;
        onEvent({ kind: 'model', model });
      }
      const u = m.usage || {};
      tokens += u.totalTokens || (u.input || 0) + (u.output || 0);
      cached += u.cacheRead || 0;
      cost += u.cost?.total || 0;
      const ctx = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0) + (u.output || 0);
      if (ctx) context = ctx;
      lastError = m.stopReason === 'error' || m.stopReason === 'aborted' ? m.errorMessage || `The model stopped (${m.stopReason}).` : '';
    } else if (t === 'tool_execution_start' && ev.toolCallId) {
      streamed = '';
      onEvent({ kind: 'tool', id: ev.toolCallId, name: ev.toolName || 'tool', args: ev.args && typeof ev.args === 'object' ? ev.args : {} });
    } else if (t === 'tool_execution_end' && ev.toolCallId) {
      // (a picture it read, a screenshot: shown under the tool call)
      const images = toolImages(ev.result);
      onEvent({ kind: 'tool_result', id: ev.toolCallId, text: toolText(ev.result).slice(0, 20000), isError: !!ev.isError, ...(images.length ? { images } : {}) });
    } else if (t === 'auto_retry_start') onEvent({ kind: 'status', text: `Trying again (${ev.attempt || 1}/${ev.maxAttempts || '?'})${ev.errorMessage ? `: ${ev.errorMessage.slice(0, 100)}` : ''}` });
    else if (t === 'compaction_start' || t === 'auto_compaction_start') onEvent({ kind: 'status', text: 'Compacting its memory…' });
    else if ((t === 'compaction_end' || t === 'auto_compaction_end') && !ev.aborted) {
      const r = (ev as { result?: { tokensBefore?: number } }).result;
      if (r) onEvent({ kind: 'compacted', trigger: ev.reason === 'manual' ? 'manual' : 'auto', ...(r.tokensBefore ? { tokensBefore: r.tokensBefore } : {}) });
    } else if (t === 'notice' && ev.level !== 'info') {
      // (oh-my-pi: its warnings, as { level, message: string })
      const msg: unknown = ev.message;
      if (typeof msg === 'string') onEvent({ kind: 'status', text: msg.slice(0, 140) });
    } else if (t === 'agent_end') ended = true;
  };
  return {
    line: (l: string) => {
      if (l.startsWith('{')) handle(JSON.parse(l) as PiEvent);
    },
    handle,
    result: () => ({ answer, lastError, model, tokens, cached, cost, context, ended }),
  };
}

// ---------- command line ----------
// The agent brief goes in a file (only a short path on the command line): both read the file's text.
function promptFile(agent: Agent, name: string, systemPrompt: string): string {
  const file = path.join(ensureDir(dataPath('runtime', agent.id)), name);
  fs.writeFileSync(file, systemPrompt);
  return file;
}

export function piArgs(flavor: PiFlavor, agent: Agent, { sessionId = '', resume = false, instructions = '', interactive = false }: { sessionId?: string; resume?: boolean; instructions?: string; interactive?: boolean } = {}): string[] {
  const args: string[] = interactive ? [] : ['--mode', 'json'];
  if (agent.model) args.push('--model', agent.model);
  const effort = effortFor(flavor, agent.effort);
  if (effort) args.push('--thinking', effort);
  if (instructions) args.push('--append-system-prompt', instructions);
  // pi picks the session by exact id (made here for a new chat); oh-my-pi resumes the one it named
  if (sessionId && flavor === 'pi') args.push('--session-id', sessionId);
  if (sessionId && flavor === 'omp' && resume) args.push('--resume', sessionId);
  // oh-my-pi: never stop to ask about a tool (it can't ask from here, and these agents run on their own)
  if (flavor === 'omp') args.push('--approval-mode', 'yolo');
  return args;
}

/** Tells the dashboard bridge in their mcp.json which agent and run is calling. */
export function bridgeEnv(agentId: string, runId = ''): Record<string, string> {
  // (the bridge reads the token from the data folder, so it never sits in their environment: made now if it isn't yet)
  internalToken();
  return { DASH_PORT: String(PORT), DASH_DATA: DATA, DASH_AGENT: agentId, ...(runId ? { DASH_RUN: runId } : {}) };
}

export function status(flavor: PiFlavor): CliStatus {
  return cliStatus(flavor, (s) => s.trim().replace(/^omp\//, '').split(/\s/)[0]);
}

/** What oh-my-pi says when --resume names a session it doesn't have. */
const SESSION_NOT_FOUND = /Session "[^"]*" not found/i;

async function run(flavor: PiFlavor, { agent, chat, text, signal, onEvent, systemPrompt, runId }: EngineRunArgs): Promise<EngineResult> {
  if (!which(flavor)) throw new Error(`${LABEL[flavor]} is not installed (the \`${flavor}\` command was not found). Install it with: ${INSTALL[flavor]}`);
  // pi: a new chat gets its own session id now; oh-my-pi names a new session itself (in its first line)
  const resume = !!chat.sessionId;
  const sessionId = chat.sessionId || (flavor === 'pi' ? crypto.randomUUID() : '');
  // the dashboard tools reach it only through the bridge in its mcp.json: put it there now if it's missing,
  // so the agent is never told about tools it doesn't have
  let brief = systemPrompt;
  const bridge = toolDefs(agent).length ? ensureBridge(flavor) : null;
  if (bridge && 'added' in bridge) {
    log('mcp', `Gave ${LABEL[flavor]} the dashboard tools (${bridge.added})`);
    onEvent({ kind: 'status', text: `Gave ${LABEL[flavor]} the dashboard tools` });
  } else if (bridge) {
    log('mcp', `${LABEL[flavor]} has no dashboard tools: ${bridge.problem}`);
    emit('toast', { text: `${agent.name} can't use the dashboard tools: ${bridge.problem}` });
    brief += `\n\n(The dashboard's own tools can't be used in this run: ${bridge.problem} Use only your built-in tools, and tell the user this when a task needs the dashboard's tools.)`;
  }
  const instructions = promptFile(agent, `${flavor}-${runId || Date.now().toString(36)}.md`, brief);
  const child = spawnCommand(flavor, piArgs(flavor, agent, { sessionId, resume, instructions }), { cwd: workspaceOf(agent), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...bridgeEnv(agent.id, runId) } });
  // (pi makes the session with that id even if its first line goes missing)
  if (sessionId) chat.sessionId = sessionId;
  const reader = piReader(onEvent, (id) => (chat.sessionId = id));
  try {
    const end = await pipeLines(child, { input: text, signal, onLine: reader.line });
    if (signal.aborted) throw new Error('Stopped.');
    const r = reader.result();
    if (r.lastError) throw new Error(r.lastError);
    if (!r.answer) {
      const msg = `${LABEL[flavor]} exited (${end.code}) without an answer.${tail(end.stderr)}`;
      // oh-my-pi: a session it no longer has (deleted, or made by another engine): a new one, with the chat so far
      if (resume && SESSION_NOT_FOUND.test(end.stderr)) {
        chat.sessionId = null;
        chat.reseed = true;
        throw new SessionGone(msg);
      }
      throw new Error(msg);
    }
    return { text: r.answer, ...(r.tokens ? { tokens: r.tokens } : {}), ...(r.cached ? { cached: r.cached } : {}), ...(r.cost ? { cost: r.cost } : {}), ...(r.context ? { context: r.context } : {}) };
  } finally {
    fs.rmSync(instructions, { force: true });
  }
}

/** The interactive terminal: the agent brief stays in a file for the whole session. */
export function terminalArgs(flavor: PiFlavor, agent: Agent, systemPrompt: string): string[] {
  return piArgs(flavor, agent, { interactive: true, instructions: promptFile(agent, `terminal-${flavor}-instructions.md`, systemPrompt) });
}

export const pi: Engine<CliStatus> = { run: (a) => run('pi', a), status: () => status('pi') };
export const omp: Engine<CliStatus> = { run: (a) => run('omp', a), status: () => status('omp') };

// ---------- models ----------
export interface PiModel {
  id: string;
  name: string;
  context?: number;
}

/** pi's `--list-models` table: provider, model, context (200K, 1M), … */
export function parseModelTable(out: string): PiModel[] {
  const list: PiModel[] = [];
  const size = (s: string) => {
    const m = /^([\d.]+)([KM]?)$/i.exec(s);
    return m ? Math.round(Number(m[1]) * (m[2].toUpperCase() === 'M' ? 1e6 : m[2] ? 1e3 : 1)) : 0;
  };
  for (const line of out.split(/\r?\n/)) {
    const [provider, model, ctx] = line.trim().split(/\s{2,}|\t/);
    if (!provider || !model || /^provider$/i.test(provider) || /\s/.test(provider) || /\s/.test(model)) continue;
    const context = size(ctx || '');
    list.push({ id: `${provider}/${model}`, name: model, ...(context ? { context } : {}) });
  }
  return list;
}

const modelCache = new Map<PiFlavor, { at: number; list: PiModel[] }>();
/** The models it has a login or key for. */
export async function listModels(flavor: PiFlavor): Promise<PiModel[]> {
  const hit = modelCache.get(flavor);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.list;
  if (!which(flavor)) return [];
  let list: PiModel[] = [];
  if (flavor === 'pi') list = parseModelTable((await runCmd('pi', ['--list-models'], { timeout: 60000 })).stdout);
  else {
    const r = await runCmd('omp', ['models', '--json'], { timeout: 60000, maxBytes: 20_000_000 });
    try {
      const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) as { models?: { selector?: string; provider?: string; id?: string; name?: string; contextWindow?: number; kind?: string }[] };
      list = (j.models || [])
        .filter((m) => (m.kind || 'chat') === 'chat' && (m.selector || m.id))
        .map((m) => ({ id: m.selector || `${m.provider}/${m.id}`, name: m.name || m.id || '', ...(m.contextWindow ? { context: m.contextWindow } : {}) }));
    } catch {
      /* not JSON */
    }
  }
  if (list.length) modelCache.set(flavor, { at: Date.now(), list });
  return list;
}

// ---------- the dashboard tools ----------
/** Where each keeps its MCP servers. */
export function mcpFile(flavor: PiFlavor): string {
  if (flavor === 'pi') return path.join(process.env.PI_CODING_AGENT_DIR || path.join(HOME, '.pi', 'agent'), 'mcp.json');
  return path.join(HOME, '.omp', 'agent', 'mcp.json');
}

/** Adds the dashboard bridge to pi's or oh-my-pi's mcp.json (the rest of the file stays as it is).
 *  It has no agent of its own there: runs from the dashboard tell it theirs (bridgeEnv), and the
 *  bridge finds the port and token by itself when you use pi on your own. */
export function addBridge(flavor: PiFlavor): string {
  const file = mcpFile(flavor);
  let cfg: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    // a file we can't read is left alone, never replaced
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch {
      throw new Error(`${file} isn't valid JSON, so it was left as it is. Fix it (or add the dashboard there yourself) and try again.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} isn't an MCP config (a JSON object), so it was left as it is.`);
    cfg = parsed as typeof cfg;
  }
  const servers = cfg.mcpServers && typeof cfg.mcpServers === 'object' && !Array.isArray(cfg.mcpServers) ? cfg.mcpServers : {};
  // a call can wait while you decide on an approval: pi counts seconds, oh-my-pi milliseconds
  servers.dashboard = { command: process.execPath, args: [BRIDGE_SCRIPT], timeout: flavor === 'pi' ? 3600 : 3_600_000 };
  ensureDir(path.dirname(file));
  writeJSON(file, { ...cfg, mcpServers: servers });
  return file;
}

/** Is the dashboard bridge in their mcp.json, naming programs that are there? If not it is added (or put
 *  right: the app was moved or reinstalled). A file it can't read is left alone and says why. Null: it was fine. */
export function ensureBridge(flavor: PiFlavor): { added: string } | { problem: string } | null {
  const file = mcpFile(flavor);
  let entry: { command?: unknown; args?: unknown } | undefined;
  if (fs.existsSync(file)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as { mcpServers?: Record<string, typeof entry> } | null;
      entry = cfg?.mcpServers?.dashboard;
    } catch {
      return { problem: `${file} isn't valid JSON, so the dashboard wasn't added to it. Fix it, then use Tools & MCP to add the dashboard.` };
    }
  }
  // a program by name is found on the PATH; one by path must be there (a hand-made entry is kept when it works)
  const there = (p: unknown) => typeof p === 'string' && (path.isAbsolute(p) ? fs.existsSync(p) : !!which(p));
  const script = Array.isArray(entry?.args) ? entry.args[0] : undefined;
  if (entry && there(entry.command) && (typeof script !== 'string' || !path.isAbsolute(script) || fs.existsSync(script))) return null;
  try {
    return { added: addBridge(flavor) };
  } catch (e) {
    return { problem: e instanceof Error ? e.message : String(e) };
  }
}
