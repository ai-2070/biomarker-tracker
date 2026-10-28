// Hermes engine: one `hermes chat` run per message (stream-json), resuming the Hermes session.
// Hermes brings its own tools, memory and skills from the chosen profile.
import { which, spawnCommand, killTree, run as runCmd } from '../util.ts';
import { workspaceOf } from '../tools.ts';
import { effortFor } from '../../shared/effort.ts';
import type { Agent, EngineStatus } from '../../shared/types.ts';
import type { EngineRunArgs, EngineResult } from './index.ts';

/** A row of `hermes profile list`. */
export interface HermesProfile {
  name: string;
  model: string;
  gateway: string;
  isDefault: boolean;
}

/** One line of `hermes chat --format stream-json` (only the fields used here). */
interface HermesMsg {
  type?: string;
  session_id?: string;
  model?: string;
  text?: string;
  id?: string;
  tool_call_id?: string;
  output?: unknown;
  result?: unknown;
  error?: unknown;
  name?: string;
  tool?: string;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  input?: Record<string, unknown>;
  message?: string;
  exit_code?: number;
  tokens?: { total?: number };
}

let profilesCache: { at: number; list: HermesProfile[] } = { at: 0, list: [] };
export async function listProfiles(): Promise<HermesProfile[]> {
  if (Date.now() - profilesCache.at < 60_000) return profilesCache.list;
  if (!which('hermes')) return [];
  const r = await runCmd('hermes', ['profile', 'list'], { timeout: 60000 });
  const list: HermesProfile[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s*[◆*]?\s*([A-Za-z0-9][\w.-]*)\s+(\S+)\s+(running|stopped|\S+)/.exec(line);
    if (m && m[1] !== 'Profile') list.push({ name: m[1], model: m[2], gateway: m[3], isDefault: /^\s*◆/.test(line) });
  }
  profilesCache = { at: Date.now(), list };
  return list;
}

export function status(): EngineStatus['hermes'] {
  return { installed: !!which('hermes'), path: which('hermes') };
}

export function hermesArgs(agent: Agent, { interactive = false }: { interactive?: boolean } = {}): string[] {
  const args: string[] = [];
  if (agent.hermesProfile && agent.hermesProfile !== 'default') args.push('-p', agent.hermesProfile);
  args.push('chat');
  if (!interactive) args.push('--query-file', '-', '--format', 'stream-json');
  if (agent.model) args.push('-m', agent.model);
  const effort = effortFor('hermes', agent.effort);
  if (effort) args.push('--reasoning', effort);
  if (agent.autonomy === 'full') args.push('--yolo');
  return args;
}

export async function run({ agent, chat, text, signal, onEvent, systemPrompt }: EngineRunArgs): Promise<EngineResult> {
  if (!which('hermes')) throw new Error('Hermes is not installed (the `hermes` command was not found).');
  const args = hermesArgs(agent);
  if (chat.sessionId) args.push('--resume', chat.sessionId, '--no-restore-cwd');
  // Hermes keeps its own system prompt; our agent brief is sent with the first message.
  const query = chat.sessionId ? text : `${systemPrompt}\n\n---\n\n${text}`;
  const child = spawnCommand('hermes', args, { cwd: workspaceOf(agent), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const onAbort = () => killTree(child);
  signal.addEventListener('abort', onAbort);
  let buf = '';
  let stderr = '';
  // (cast: TypeScript can't see the callback below set it)
  let result = null as HermesMsg | null;
  let toolN = 0;

  const handle = (msg: HermesMsg) => {
    if (msg.session_id) chat.sessionId = msg.session_id;
    if (msg.type === 'system' && msg.model) onEvent({ kind: 'model', model: msg.model });
    if (msg.type === 'text' && msg.text) onEvent({ kind: 'text', text: msg.text });
    else if (msg.type === 'result') result = msg;
    else if (/tool/.test(msg.type || '')) {
      const id = msg.id || msg.tool_call_id || `h${++toolN}`;
      if (/result|output|end/.test(msg.type!)) onEvent({ kind: 'tool_result', id: msg.tool_call_id || msg.id || `h${toolN}`, text: String(msg.output ?? msg.result ?? msg.text ?? ''), isError: !!msg.error });
      else onEvent({ kind: 'tool', id, name: msg.name || msg.tool || 'tool', args: msg.args || msg.arguments || msg.input || {} });
    } else if (msg.type === 'status' || msg.type === 'progress') onEvent({ kind: 'status', text: msg.text || msg.message || '' });
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
        handle(JSON.parse(line) as HermesMsg);
      } catch {
        /* skip */
      }
    }
  });
  child.stderr!.on('data', (d: string) => {
    if (stderr.length < 200_000) stderr += d;
  });
  child.stdin!.end(query);
  const code = await new Promise<number | null>((resolve) => {
    child.on('close', resolve);
    child.on('error', (e) => {
      stderr += e.message;
      resolve(-1);
    });
  });
  const rest = buf.trim();
  if (rest.startsWith('{')) {
    try {
      handle(JSON.parse(rest) as HermesMsg);
    } catch {
      /* partial line */
    }
  }
  signal.removeEventListener('abort', onAbort);
  if (signal.aborted) throw new Error('Stopped.');
  if (!result) throw new Error(`Hermes exited (${code}) without an answer.${stderr ? `\n${stderr.trim().slice(-1500)}` : ''}`);
  if (result.exit_code && result.exit_code !== 0) throw new Error(result.text || `Hermes failed (exit ${result.exit_code}).`);
  return { text: result.text || '', tokens: result.tokens?.total || 0 };
}
