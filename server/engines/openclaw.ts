// OpenClaw engine: one `openclaw agent --json` turn per message, sent to one of your OpenClaw agents
// through its Gateway (or run here with --local when the Gateway isn't running). Each chat keeps its
// own OpenClaw session. OpenClaw brings its own tools, memory, skills and model settings.
import fs from 'node:fs';
import path from 'node:path';
import { which, spawnCommand, run as runCmd, dataPath, ensureDir } from '../util.ts';
import { workspaceOf } from '../tools.ts';
import { effortFor } from '../../shared/effort.ts';
import { cliStatus, pipeLines, tail } from './cli.ts';
import type { CliStatus } from './cli.ts';
import type { Agent } from '../../shared/types.ts';
import type { EngineRunArgs, EngineResult } from './index.ts';

/** A row of `openclaw agents list --json`. */
export interface OpenClawAgent {
  id: string;
  model: string;
  workspace: string;
  isDefault: boolean;
}

let agentsCache: { at: number; list: OpenClawAgent[] } = { at: 0, list: [] };
export async function listAgents(): Promise<OpenClawAgent[]> {
  if (Date.now() - agentsCache.at < 60_000) return agentsCache.list;
  if (!which('openclaw')) return [];
  const r = await runCmd('openclaw', ['agents', 'list', '--json'], { timeout: 60000 });
  let list: OpenClawAgent[] = [];
  try {
    const rows = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))) as unknown;
    if (Array.isArray(rows))
      list = rows
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string')
        .map((x) => ({ id: String(x.id), model: typeof x.model === 'string' ? x.model : '', workspace: typeof x.workspace === 'string' ? x.workspace : '', isDefault: x.isDefault === true }));
  } catch {
    /* not JSON: none */
  }
  agentsCache = { at: Date.now(), list };
  return list;
}

/** The models OpenClaw is set up for (`openclaw models list --json`). */
let modelsCache: { at: number; list: { id: string; name: string; context?: number }[] } = { at: 0, list: [] };
export async function listModels(): Promise<{ id: string; name: string; context?: number }[]> {
  if (Date.now() - modelsCache.at < 5 * 60_000) return modelsCache.list;
  if (!which('openclaw')) return [];
  const r = await runCmd('openclaw', ['models', 'list', '--json'], { timeout: 60000 });
  const reply = parseReply(r.stdout) as { models?: unknown } | null;
  const rows = Array.isArray(reply?.models) ? (reply.models as Record<string, unknown>[]) : [];
  const list = rows
    .filter((m) => m && typeof m.key === 'string' && m.available !== false)
    .map((m) => ({ id: String(m.key), name: typeof m.name === 'string' ? m.name : String(m.key), ...(typeof m.contextWindow === 'number' ? { context: m.contextWindow } : {}) }));
  if (list.length) modelsCache = { at: Date.now(), list };
  return list;
}

export function status(): CliStatus {
  return cliStatus('openclaw', (s) => /OpenClaw\s+(\S+)/.exec(s)?.[1] || s.trim().split('\n')[0]);
}

/** What `openclaw agent --json` prints (only the fields used here). */
interface OpenClawUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  total?: number;
}
interface OpenClawMeta {
  aborted?: boolean;
  finalAssistantVisibleText?: string;
  error?: { kind?: string; message?: string };
  toolSummary?: { calls?: number; tools?: string[] };
  agentMeta?: { sessionId?: string; provider?: string; model?: string; usage?: OpenClawUsage; costUsd?: number; promptTokens?: number; contextTokens?: number };
}
interface OpenClawReply {
  ok?: boolean;
  runId?: string;
  status?: string;
  error?: { type?: string; message?: string } | string;
  payloads?: { text?: string | null }[];
  meta?: OpenClawMeta;
  result?: { payloads?: { text?: string | null }[]; meta?: OpenClawMeta };
}

// Agent ids and session keys go on the command line: keep them to plain characters.
const safeId = (s: string) => /^[\w.:-]{1,120}$/.test(s);

export function openclawArgs(agent: Agent, { sessionKey, messageFile, local = false }: { sessionKey: string; messageFile: string; local?: boolean }): string[] {
  const args = ['agent'];
  if (agent.openclawAgent && safeId(agent.openclawAgent)) args.push('--agent', agent.openclawAgent);
  args.push('--session-key', sessionKey, '--message-file', messageFile, '--json', '--timeout', '0');
  if (agent.model) args.push('--model', agent.model);
  const effort = effortFor('openclaw', agent.effort);
  if (effort) args.push('--thinking', effort);
  if (local) args.push('--local');
  return args;
}

/** The interactive terminal: OpenClaw's own chat screen, on the agent's main session. */
export function openclawTerminalArgs(agent: Agent): string[] {
  const args = ['tui'];
  if (agent.openclawAgent && safeId(agent.openclawAgent)) args.push(`agent:${agent.openclawAgent}:main`);
  const effort = effortFor('openclaw', agent.effort);
  if (effort) args.push('--thinking', effort);
  return args;
}

/** The JSON OpenClaw printed (it reserves stdout for it), or null. */
export function parseReply(stdout: string): OpenClawReply | null {
  const start = stdout.indexOf('{');
  if (start === -1) return null;
  try {
    const j = JSON.parse(stdout.slice(start)) as unknown;
    return j && typeof j === 'object' ? (j as OpenClawReply) : null;
  } catch {
    return null;
  }
}

/** Turns OpenClaw's reply into the answer, or throws its error. */
export function readReply(reply: OpenClawReply): EngineResult & { model?: string; tools?: string[] } {
  if (reply.ok === false || (reply.error && !reply.payloads && !reply.result)) {
    const e = reply.error;
    throw new Error(typeof e === 'string' ? e : e?.message || 'OpenClaw failed.');
  }
  if (reply.status === 'in_flight') throw new Error('OpenClaw is still answering an earlier message in this chat. Try again in a moment.');
  const body = reply.result && (reply.result.payloads || reply.result.meta) ? reply.result : reply;
  const meta = body.meta || {};
  const text = (body.payloads || []).map((p) => p?.text || '').filter(Boolean).join('\n\n') || meta.finalAssistantVisibleText || '';
  if (meta.error?.message && !text) throw new Error(meta.error.message);
  if (meta.aborted && !text) throw new Error('OpenClaw stopped before it answered.');
  const am = meta.agentMeta || {};
  const u = am.usage || {};
  const tokens = u.total || (u.input || 0) + (u.output || 0);
  return {
    text,
    ...(tokens ? { tokens } : {}),
    ...(u.cacheRead ? { cached: u.cacheRead } : {}),
    ...(typeof am.costUsd === 'number' && am.costUsd > 0 ? { cost: am.costUsd } : {}),
    ...(am.promptTokens ? { context: am.promptTokens } : {}),
    ...(am.contextTokens && am.contextTokens > (am.promptTokens || 0) ? { window: am.contextTokens } : {}),
    ...(am.model ? { model: am.provider ? `${am.provider}/${am.model}` : am.model } : {}),
    ...(meta.toolSummary?.tools?.length ? { tools: meta.toolSummary.tools } : {}),
  };
}

const gatewayDown = (r: OpenClawReply | null) => !!r && r.ok === false && !r.runId && /gateway not reachable|ECONNREFUSED|gateway.{0,40}(closed|not running|unavailable)/i.test(typeof r.error === 'string' ? r.error : r.error?.message || '');

export async function run({ agent, chat, text, signal, onEvent, systemPrompt, runId }: EngineRunArgs): Promise<EngineResult> {
  if (!which('openclaw')) throw new Error('OpenClaw is not installed (the `openclaw` command was not found). Install it with: npm install -g openclaw');
  // A chat's session: its own key under the OpenClaw agent. A compaction starts a new one (sessionId is cleared).
  const sessionKey = chat.sessionId && safeId(chat.sessionId) ? chat.sessionId : `dashboard-${chat.id}-${Date.now().toString(36)}`.replace(/[^\w.:-]/g, '');
  const fresh = sessionKey !== chat.sessionId;
  // OpenClaw keeps its own system prompt; our agent brief goes with a session's first message.
  const message = fresh ? `<agent-instructions>\n${systemPrompt}\n</agent-instructions>\n\n${text}` : text;
  const dir = ensureDir(dataPath('runtime', agent.id));
  const messageFile = path.join(dir, `openclaw-${runId || Date.now().toString(36)}.md`);
  fs.writeFileSync(messageFile, message);
  const once = async (local: boolean) => {
    const child = spawnCommand('openclaw', openclawArgs(agent, { sessionKey, messageFile, local }), { cwd: workspaceOf(agent), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const end = await pipeLines(child, { signal, onLine: (l) => (out += `${l}\n`) });
    return { reply: parseReply(out), ...end };
  };
  try {
    onEvent({ kind: 'status', text: 'OpenClaw is working…' });
    let r = await once(false);
    if (!signal.aborted && gatewayDown(r.reply)) {
      onEvent({ kind: 'status', text: "OpenClaw's Gateway isn't running: answering here instead…" });
      r = await once(true);
    }
    if (signal.aborted) throw new Error('Stopped.');
    if (!r.reply) throw new Error(`OpenClaw exited (${r.code}) without an answer.${tail(r.stderr)}`);
    const res = readReply(r.reply);
    if (res.model) onEvent({ kind: 'model', model: res.model });
    if (res.tools?.length) onEvent({ kind: 'status', text: `Used ${res.tools.join(', ')}` });
    if (!res.text) throw new Error(`OpenClaw finished without an answer.${tail(r.stderr, 600)}`);
    chat.sessionId = sessionKey;
    onEvent({ kind: 'text', text: res.text });
    return { text: res.text, ...(res.tokens ? { tokens: res.tokens } : {}), ...(res.cached ? { cached: res.cached } : {}), ...(res.cost ? { cost: res.cost } : {}), ...(res.context ? { context: res.context } : {}), ...(res.window ? { window: res.window } : {}) };
  } finally {
    fs.rmSync(messageFile, { force: true });
  }
}
