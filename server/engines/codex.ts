// OpenAI Codex engine: runs `codex exec --json` (your ChatGPT login via `codex login`, or an API key),
// resuming the same Codex thread so the conversation continues. The dashboard tools come in as an MCP server.
import fs from 'node:fs';
import path from 'node:path';
import { which, spawnCommand, killTree, run as runCmd, BRIDGE_SCRIPT, PORT, HOME, dataPath, ensureDir } from '../util.ts';
import { internalToken, emit } from '../store.ts';
import { listServers } from '../mcp.ts';
import { workspaceOf } from '../tools.ts';
import { effortFor } from '../../shared/effort.ts';
import { splitContent } from '../toolimages.ts';
import type { Agent } from '../../shared/types.ts';
import type { EngineRunArgs, EngineResult } from './index.ts';

/** EngineStatus['codex'] plus the first line of `codex login status` and where codex is. */
export interface CodexStatus {
  installed: boolean;
  loggedIn: boolean;
  version: string | null;
  how?: string;
}

/** An item in `codex exec --json` events (only the fields used here). */
interface CodexItem {
  id: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string | null;
  exit_code?: number | null;
  server?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  status?: string;
  changes?: { path: string }[];
  query?: string;
  message?: string;
}

interface CodexUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/** One line of `codex exec --json`. */
interface CodexEvent {
  type?: string;
  thread_id?: string;
  usage?: CodexUsage | null;
  error?: { message?: string };
  message?: string;
  item?: CodexItem;
}

// checking: the `codex login status` under way (until it ends, value is the last answer, or "not signed in" at first)
let statusCache: { at: number; value: CodexStatus; checking: Promise<void> | null } = { at: 0, value: { installed: false, loggedIn: false, version: null }, checking: null };
export function status(): CodexStatus & { path: string | null } {
  const exe = which('codex');
  if (Date.now() - statusCache.at > 60_000) {
    statusCache.at = Date.now();
    if (exe) {
      const checking = Promise.all([runCmd('codex', ['--version'], { timeout: 20000 }), runCmd('codex', ['login', 'status'], { timeout: 20000 })])
        .then(([v, l]) => {
          const out = `${l.stdout}\n${l.stderr}`;
          const was = statusCache.value;
          statusCache.value = { installed: true, version: v.stdout.trim().replace(/^codex-cli\s*/, ''), loggedIn: /logged in/i.test(out) && !/not logged in/i.test(out), how: out.trim().split('\n')[0] };
          // open pages ask for the state again, so they don't keep showing "sign in" from before the check
          if (was.loggedIn !== statusCache.value.loggedIn || was.version !== statusCache.value.version) emit('engines');
        })
        .catch(() => {})
        .finally(() => statusCache.checking === checking && (statusCache.checking = null));
      statusCache.checking = checking;
    } else statusCache.value = { installed: false, loggedIn: false, version: null };
  }
  return { ...statusCache.value, installed: !!exe, path: exe };
}
/** status(), once a check that is under way has finished: right after the server starts, status() alone
 *  still says "not signed in" for a second or two. */
export async function checkedStatus(): Promise<CodexStatus & { path: string | null }> {
  status();
  if (statusCache.checking) await statusCache.checking;
  return status();
}
export const refreshStatus = () => (statusCache.at = 0);

// ---------- models ----------
export interface CodexModel {
  id: string;
  name: string;
  description?: string;
}
// Used when Codex can't say what it has (not installed, or too old for `codex debug models`).
export const FALLBACK_MODELS: CodexModel[] = [{ id: 'gpt-6-astra', name: 'GPT-6-Astra', description: 'Frontier intelligence for the most demanding work.' }];

/** The models in Codex's catalog (what `codex debug models` prints, or its models_cache.json), in Codex's own order.
 *  Hidden ones (internal helpers like the auto-review model) are left out. */
export function parseModels(text: string): CodexModel[] {
  let j: unknown;
  try {
    j = JSON.parse(text.slice(Math.max(0, text.indexOf('{'))));
  } catch {
    return [];
  }
  const rows = j && typeof j === 'object' && Array.isArray((j as { models?: unknown }).models) ? ((j as { models: unknown[] }).models as Record<string, unknown>[]) : [];
  return rows
    .filter((m) => m && typeof m === 'object' && typeof m.slug === 'string' && m.slug && m.visibility !== 'hide')
    .map((m, i) => ({ m, i, p: typeof m.priority === 'number' ? m.priority : Infinity }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map(({ m }) => ({
      id: String(m.slug),
      name: typeof m.display_name === 'string' && m.display_name ? m.display_name : String(m.slug),
      ...(typeof m.description === 'string' && m.description ? { description: m.description } : {}),
    }));
}

let modelsCache: { at: number; list: CodexModel[] } = { at: 0, list: [] };
/** The models Codex can use with this login, newest first. Falls back to a short built-in list. */
export async function listModels(): Promise<CodexModel[]> {
  if (modelsCache.list.length && Date.now() - modelsCache.at < 5 * 60_000) return modelsCache.list;
  let list: CodexModel[] = [];
  if (which('codex')) list = parseModels((await runCmd('codex', ['debug', 'models'], { timeout: 30000, maxBytes: 20_000_000 }).catch(() => ({ stdout: '' }))).stdout);
  if (!list.length) {
    // an older Codex without `debug models` still keeps the catalog it fetched
    const file = path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'models_cache.json');
    try {
      list = parseModels(fs.readFileSync(file, 'utf8'));
    } catch {
      /* no cache */
    }
  }
  if (list.length) modelsCache = { at: Date.now(), list };
  return list.length ? list : FALLBACK_MODELS;
}
export const clearModelsCache = (): void => void (modelsCache = { at: 0, list: [] });

// TOML values for -c overrides (Codex parses the value part as TOML).
const tstr = (s: unknown): string => JSON.stringify(String(s).replace(/\\/g, '/'));
const ttable = (o: Record<string, unknown>): string => `{${Object.entries(o).map(([k, v]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k)}=${JSON.stringify(String(v))}`).join(',')}}`;

// The interactive terminal has no first message to carry the agent brief (see run()), so it goes
// in a file and Codex's developer instructions point there. Only a short path goes on the command line.
export function terminalPromptFile(agent: Agent, systemPrompt: string): string {
  const file = path.join(ensureDir(dataPath('runtime', agent.id)), 'terminal-codex-instructions.md');
  fs.writeFileSync(file, systemPrompt);
  return file;
}

export function codexArgs(agent: Agent, { runId = '', interactive = false, promptFile = '' }: { runId?: string; interactive?: boolean; promptFile?: string } = {}): string[] {
  const args: string[] = interactive ? [] : ['exec', '--json', '--skip-git-repo-check'];
  args.push('-C', workspaceOf(agent));
  if (agent.model) args.push('-m', agent.model);
  const effort = effortFor('codex', agent.effort);
  if (effort) args.push('-c', `model_reasoning_effort=${tstr(effort)}`);
  if (promptFile) args.push('-c', `developer_instructions=${tstr(`Your agent instructions are in ${promptFile}. Read that file before anything else and follow it for this whole session.`)}`);
  // the dashboard's own tools, plus the agent's MCP servers
  const bridge = { DASH_PORT: String(PORT), DASH_TOKEN: internalToken(), DASH_AGENT: agent.id, ...(runId ? { DASH_RUN: runId } : {}) };
  args.push('-c', `mcp_servers.dashboard.command=${tstr(process.execPath)}`);
  args.push('-c', `mcp_servers.dashboard.args=[${tstr(BRIDGE_SCRIPT)}]`);
  args.push('-c', `mcp_servers.dashboard.env=${ttable(bridge)}`);
  args.push('-c', 'mcp_servers.dashboard.tool_timeout_sec=3600');
  const servers = listServers();
  for (const name of agent.mcpServers || []) {
    const cfg = servers[name];
    if (!cfg || cfg.enabled === false || !/^[\w-]+$/.test(name)) continue;
    if (cfg.type === 'stdio') {
      args.push('-c', `mcp_servers.${name}.command=${tstr(cfg.command)}`);
      args.push('-c', `mcp_servers.${name}.args=[${(cfg.args || []).map(tstr).join(',')}]`);
      if (Object.keys(cfg.env || {}).length) args.push('-c', `mcp_servers.${name}.env=${ttable(cfg.env)}`);
    } else {
      args.push('-c', `mcp_servers.${name}.url=${tstr(cfg.url)}`);
      if (Object.keys(cfg.headers || {}).length) args.push('-c', `mcp_servers.${name}.http_headers=${ttable(cfg.headers)}`);
    }
  }
  // autonomy → Codex sandbox
  const mode = agent.autonomy || 'auto';
  if (mode === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');
  // --approve-for-me already means the workspace-write sandbox, and Codex refuses it alongside -s
  else if (mode === 'auto') args.push(...(interactive ? ['-s', 'workspace-write'] : ['--approve-for-me']));
  else args.push('-s', 'read-only');
  return args;
}

export async function run({ agent, chat, text, signal, onEvent, systemPrompt, runId }: EngineRunArgs): Promise<EngineResult> {
  if (!which('codex')) throw new Error('OpenAI Codex is not installed. Install it in Settings > General (or run: npm install -g @openai/codex), then sign in with "codex login".');
  const args = codexArgs(agent, { runId });
  if (chat.sessionId) args.push('resume', chat.sessionId, '-');
  else args.push('-');
  // Codex keeps its own system prompt; the agent brief goes with the first message.
  const prompt = chat.sessionId ? text : `<agent-instructions>\n${systemPrompt}\n</agent-instructions>\n\n${text}`;
  const child = spawnCommand('codex', args, { cwd: workspaceOf(agent), stdio: ['pipe', 'pipe', 'pipe'] });
  const onAbort = () => killTree(child);
  signal.addEventListener('abort', onAbort);
  let buf = '';
  let stderr = '';
  let answer = '';
  let lastError = '';
  let turnFailed = false;
  // (cast: TypeScript can't see the callback below set it)
  let usage = null as CodexUsage | null;

  const handle = (ev: CodexEvent) => {
    if (ev.type === 'thread.started' && ev.thread_id) chat.sessionId = ev.thread_id;
    else if (ev.type === 'turn.completed') usage = ev.usage || null;
    else if (ev.type === 'turn.failed') {
      turnFailed = true;
      lastError = ev.error?.message || 'Codex failed.';
    }
    else if (ev.type === 'error') {
      lastError = ev.message || lastError;
      if (/Reconnecting/.test(ev.message || '')) onEvent({ kind: 'status', text: ev.message!.slice(0, 120) });
    } else if (ev.type === 'item.started' || ev.type === 'item.completed') {
      const it = ev.item || ({} as CodexItem);
      const done = ev.type === 'item.completed';
      if (it.type === 'agent_message' && done) {
        const t = it.text || '';
        onEvent({ kind: 'text', text: (answer ? '\n\n' : '') + t });
        answer += (answer ? '\n\n' : '') + t;
      } else if (it.type === 'reasoning' && done) onEvent({ kind: 'status', text: 'Thinking…' });
      else if (it.type === 'command_execution') {
        if (!done) onEvent({ kind: 'tool', id: it.id, name: 'Bash', args: { command: it.command } });
        else onEvent({ kind: 'tool_result', id: it.id, text: String(it.aggregated_output ?? '').slice(0, 20000), isError: it.exit_code != null && it.exit_code !== 0 });
      } else if (it.type === 'mcp_tool_call') {
        const name = (it.server === 'dashboard' ? it.tool : `${it.server}__${it.tool}`) as string;
        if (!done) onEvent({ kind: 'tool', id: it.id, name, args: it.arguments || {} });
        else {
          // an MCP result ({ content: [...] }): its text, and its images shown under the tool call
          const content = (it.result as { content?: unknown } | null)?.content;
          const { text, images } = Array.isArray(content) ? splitContent(content) : { text: JSON.stringify(it.result ?? it.error ?? ''), images: [] };
          onEvent({ kind: 'tool_result', id: it.id, text: text.slice(0, 20000), isError: !!it.error || it.status === 'failed', ...(images.length ? { images } : {}) });
        }
      } else if (it.type === 'file_change') {
        const files = (it.changes || []).map((c) => c.path).join(', ');
        if (!done) onEvent({ kind: 'tool', id: it.id, name: 'Edit', args: { file_path: files } });
        else onEvent({ kind: 'tool_result', id: it.id, text: `Changed: ${files}` });
      } else if (it.type === 'web_search') {
        if (!done) onEvent({ kind: 'tool', id: it.id, name: 'WebSearch', args: { query: it.query } });
        else onEvent({ kind: 'tool_result', id: it.id, text: it.query || '' });
      } else if (it.type === 'error' && done) onEvent({ kind: 'status', text: String(it.message || '').slice(0, 140) });
    }
  };

  // stdio is all 'pipe' above, so these streams exist.
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  child.stdin!.on('error', () => {});
  child.stdout!.on('data', (d: string) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('{')) continue;
      try {
        handle(JSON.parse(line) as CodexEvent);
      } catch {
        /* skip */
      }
    }
  });
  child.stderr!.on('data', (d: string) => {
    if (stderr.length < 100_000) stderr += d;
  });
  child.stdin!.end(prompt);
  const code = await new Promise<number | null>((resolve) => {
    child.on('close', resolve);
    child.on('error', (e) => {
      stderr += e.message;
      resolve(-1);
    });
  });
  if (buf.trim().startsWith('{')) {
    try {
      handle(JSON.parse(buf.trim()) as CodexEvent);
    } catch {
      /* partial */
    }
  }
  signal.removeEventListener('abort', onAbort);
  if (signal.aborted) throw new Error('Stopped.');
  // A failed turn is a failure even when it said something first ("I'll look at the files"): that is not its answer.
  if (!answer || turnFailed || code !== 0) {
    if (/401|Unauthorized|not logged in|login/i.test(lastError + stderr)) throw new Error('Codex is not signed in. Open Settings > General > OpenAI Codex > Sign in (runs "codex login").');
    throw new Error(lastError || `Codex exited (${code}) ${answer ? 'before it finished' : 'without an answer'}.${stderr ? `\n${stderr.trim().slice(-1200)}` : ''}`);
  }
  return { text: answer, tokens: usage ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : 0 };
}
