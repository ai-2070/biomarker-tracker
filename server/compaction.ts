// Compaction: when an agent's memory of a chat gets full, the older part of the chat becomes one compact
// text (the checkpoint) and only the latest messages (Settings > Chat memory) stay in full.
//
// Instant compaction (the default, after github.com/TsFreddie/dsh-compaction-instant) asks no model: it
// keeps the original words and only cuts them down. Tool results are left out (a pointer stays), a tool
// call becomes one line, long messages are cut, and every entry keeps its "[seq N]": the item's index in
// chat.items, which never changes. recall_history reads any of them back in full. All the sizes grow with
// the model's context window (sizesFor), so a 1M-token model keeps far more than a 200k one.
// Summary compaction has the Brain's model write a summary instead.
//
// The chat keeps every item, so you still see the whole conversation. A "compaction" item marks the spot
// (--- COMPACTED --- in the chat) and holds the checkpoint, which you can read and edit.
import { uid } from './util.ts';
import { getSettings } from './store.ts';
import { latestCompaction, memoryStart } from '../shared/compaction.ts';
import type { Agent, Chat, ChatItem, CompactionItem, CompactionSetting, CompactionTrigger } from '../shared/types.ts';
import type { LlmMessage } from './engines/openai.ts';

type ItemOf<T extends ChatItem['type']> = Extract<ChatItem, { type: T }>;

// ---------- tokens ----------
// A rough count, no tokenizer needed: a run of letters or digits is a token per 4 characters, a CJK
// character or a symbol is one, an emoji two, spaces are free. Close enough to decide when to compact.
const isWord = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || (c >= 0xc0 && c <= 0x24f) || (c >= 0x370 && c <= 0x52f) || (c >= 0x590 && c <= 0x6ff);
const isSpace = (c: number): boolean => c <= 32 || c === 0xa0 || (c >= 0x2000 && c <= 0x200b) || c === 0x3000;
const isCjk = (c: number): boolean => (c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x20000 && c <= 0x3134f);
const isEmoji = (c: number): boolean => (c >= 0x1f000 && c <= 0x1faff) || (c >= 0x2600 && c <= 0x27bf);
// What one character adds, given how long the word it continues is so far.
const charCost = (c: number, run: number): number => (isWord(c) ? (run % 4 === 0 ? 1 : 0) : isSpace(c) ? 0 : isEmoji(c) ? 2 : 1);

export function estimateTokens(input: unknown): number {
  const s = typeof input === 'string' ? input : input == null ? '' : String(input);
  let n = 0;
  let run = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += charCost(c, run);
    run = isWord(c) ? run + 1 : 0;
  }
  return n;
}

/** The start of s that fits in budget tokens (and budget × 4 characters, so a base64 blob can't slip
 *  through as "one word"). Cuts only between characters, never inside one. */
export function cutTokens(s: string, budget: number): { text: string; cut: boolean } {
  const maxChars = Math.max(0, budget) * 4;
  if (s.length <= maxChars && estimateTokens(s) <= budget) return { text: s, cut: false };
  let n = 0;
  let run = 0;
  let i = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const cost = charCost(c, run);
    if (n + cost > budget || i + ch.length > maxChars) break;
    n += cost;
    i += ch.length;
    run = isWord(c) ? run + 1 : 0;
  }
  return { text: s.slice(0, i).trimEnd(), cut: true };
}

/** How much room an item takes in the agent's memory, word for word. */
export function itemTokens(it: ChatItem): number {
  if (it.type === 'user' || it.type === 'assistant' || it.type === 'error') return estimateTokens(it.text) + 4;
  if (it.type === 'tool') return estimateTokens(it.name) + estimateTokens(it.args == null ? '' : typeof it.args === 'string' ? it.args : JSON.stringify(it.args)) + estimateTokens(it.result || '') + 8;
  return 0; // meta and compaction markers are not sent to the agent
}

export function itemsTokens(items: ChatItem[], from = 0, to = items.length): number {
  let n = 0;
  for (let i = Math.max(0, from); i < to; i++) n += itemTokens(items[i]);
  return n;
}

// ---------- where the agent's memory of a chat starts ----------
export { latestCompaction, memoryStart } from '../shared/compaction.ts';

// ---------- how big the memory is, and how big it may get ----------
// What each engine adds on its own (its system prompt and tool list) that the chat doesn't show.
const ENGINE_OVERHEAD: Record<string, number> = { 'claude-code': 18_000, codex: 12_000, hermes: 8_000, pi: 4_000, omp: 12_000, openclaw: 10_000, openai: 1_000 };

type ModelOf = Pick<Agent, 'engine' | 'model' | 'provider'>;

/** Who measures a chat's memory: a measurement by another engine, provider or model doesn't apply. */
export const measuredBy = (agent: ModelOf): string => `${agent.engine}|${agent.engine === 'openai' ? agent.provider || 'openrouter' : ''}|${agent.model || ''}`;
const measurement = (chat: Chat | null | undefined, agent: ModelOf) => (chat?.context && chat.context.by === measuredBy(agent) ? chat.context : null);

/** How full the agent's memory of this chat is, in tokens: what the engine last said plus what came
 *  since, or else an estimate from the chat itself. */
export function memoryTokens(chat: Chat, agent: ModelOf, systemPrompt = ''): number {
  const engine = agent.engine;
  const items = chat.items;
  const c = measurement(chat, agent);
  if (c && c.tokens > 0 && c.items <= items.length) return c.tokens + itemsTokens(items, c.items);
  const start = memoryStart(items);
  const cp = latestCompaction(items);
  return estimateTokens(systemPrompt) + (ENGINE_OVERHEAD[engine] ?? 4_000) + (cp ? estimateTokens(cp.item.text) : 0) + itemsTokens(items, start);
}

const windows = new Map<string, { at: number; models: Map<string, number> }>();

/** The model's context window in tokens: what the engine reported, the model list, or a safe default. */
export async function contextWindow(agent: ModelOf, chat?: Chat | null): Promise<number> {
  const set = compactionSettings().windowTokens;
  if (set) return set;
  const reported = measurement(chat, agent)?.window;
  if (reported) return reported;
  const model = String(agent.model || '');
  if (agent.engine === 'claude-code') return /\[1m\]/i.test(model) ? 1_000_000 : 200_000;
  if (agent.engine === 'codex') return 272_000;
  if (agent.engine === 'hermes' || agent.engine === 'pi' || agent.engine === 'omp' || agent.engine === 'openclaw') return 128_000;
  const provider = String(agent.provider || 'openrouter');
  const local = provider === 'lmstudio' || provider === 'ollama';
  const id = model || getSettings().defaults.openrouterModel;
  let w = windows.get(provider);
  if (!w || Date.now() - w.at > 10 * 60_000) {
    const { listModels } = await import('./engines/openai.ts');
    const list = await listModels(provider).catch(() => []);
    w = { at: Date.now(), models: new Map(list.filter((m) => m.context).map((m) => [m.id, m.context!])) };
    // (an empty answer is retried sooner: the server may just be starting)
    if (!list.length) w.at = Date.now() - 9 * 60_000;
    windows.set(provider, w);
  }
  return w.models.get(id) || (local ? 32_000 : 128_000);
}

export const compactionSettings = (): CompactionSetting => {
  const s = getSettings().compaction || ({} as Partial<CompactionSetting>);
  return {
    auto: s.auto !== false,
    engineOwn: s.engineOwn !== false,
    instant: s.instant !== false,
    thresholdPercent: Math.min(95, Math.max(10, Number(s.thresholdPercent) || 50)),
    keepMessages: Math.min(1000, Math.max(0, Math.floor(Number(s.keepMessages ?? 10)) || 0)),
    windowTokens: Math.min(10_000_000, Math.max(0, Math.floor(Number(s.windowTokens) || 0))),
  };
};

/** The engine compacts this chat by itself, so the dashboard doesn't before a run (see compactionSettings). */
export const engineCompacts = (agent: Pick<Agent, 'engine'>, s: CompactionSetting = compactionSettings()): boolean => agent.engine !== 'openai' && s.engineOwn;

/** The memory size (tokens) that sets off an automatic compaction. */
export const compactAt = (window: number, s: CompactionSetting = compactionSettings()): number => Math.floor((window * s.thresholdPercent) / 100);

/** The model said the conversation is too long for it. */
export const isOverflowError = (e: unknown): boolean =>
  /prompt is too long|context.{0,24}(length|window|limit|size)|maximum context|too many tokens|reduce the length|input is too long|exceeds? (the )?(max(imum)? )?(context|token)|token limit|request too large/i.test((e as Error)?.message || String(e));

// ---------- the instant compiler ----------
export interface Budgets {
  /** the agent's own messages, per message */
  textTokens: number;
  /** the user's messages, per message */
  userTextTokens: number;
  /** a tool call's key argument */
  toolCallTokens: number;
  /** an excerpt of each tool result (0: left out, only the pointer stays) */
  toolResultTokens: number;
  /** each tool call's whole input (0: only its key argument, on the tool line) */
  toolInputTokens?: number;
  /** the whole compacted history */
  cap: number;
  /** the least a message is cut to when the cap is tight */
  minTextTokens: number;
}

/** The instant compiler's budgets at a 200k window (dsh-compaction-instant's defaults). */
export const INSTANT: Budgets = { textTokens: 512, userTextTokens: 1024, toolCallTokens: 128, toolResultTokens: 0, cap: 65_536, minTextTokens: 32 };

/** How big things may get for a model with this context window. Everything grows with the window, so a
 *  1M-token model keeps 5× longer messages, a far bigger compacted history and a much longer tail, and
 *  a small local model still fits. After a compaction the memory is about checkpoint + tail, which stays
 *  well under the threshold, so the next message doesn't compact again straight away. */
export function sizesFor(window: number, thresholdPercent = 50): { compile: Budgets; summarySource: Budgets; tail: number; seed: Budgets } {
  const w = Math.max(4_000, window);
  const f = Math.min(5, Math.max(0.25, w / 200_000));
  const share = Math.min(95, Math.max(10, thresholdPercent)) / 100;
  const cap = Math.floor(w * Math.min(0.15, share * 0.3));
  const tail = Math.floor(w * Math.min(0.25, share * 0.5));
  return {
    compile: { textTokens: Math.round(INSTANT.textTokens * f), userTextTokens: Math.round(INSTANT.userTextTokens * f), toolCallTokens: INSTANT.toolCallTokens, toolResultTokens: 0, cap, minTextTokens: INSTANT.minTextTokens },
    // what the summary model reads (more than the instant version keeps; it then writes much less)
    summarySource: { textTokens: Math.round(2048 * f), userTextTokens: Math.round(4096 * f), toolCallTokens: 128, toolResultTokens: Math.round(300 * f), cap: Math.min(Math.floor(w * 0.6), 400_000), minTextTokens: 64 },
    tail,
    // the kept messages, as a new engine session gets them: in full, tool results too
    seed: { textTokens: tail, userTextTokens: tail, toolCallTokens: 1_000, toolResultTokens: tail, toolInputTokens: tail, cap: tail, minTextTokens: 256 },
  };
}

export const GUIDE =
  'Earlier messages of this chat were compacted to save room. Below is that history in order, one "[seq N]" entry per message or tool call. Long messages are cut and tool results are left out; to read any entry in full, call recall_history with seq=N (or from/to for a range, or query to search).';
export const SUMMARY_GUIDE =
  'Earlier messages of this chat were compacted into the summary below to save room. "(seq N)" points at an original message or tool call; to read it in full, call recall_history with seq=N (or from/to for a range, or query to search).';
// Tools whose calls are left out of a compaction altogether.
const HIDDEN_TOOLS = new Set(['recall_history', 'TodoWrite']);
// The argument that says what a tool call was about, in the order they are looked for.
const KEY_ARGS = ['file_path', 'path', 'command', 'query', 'pattern', 'url', 'program', 'workflow', 'agent', 'subreddit', 'name', 'file', 'title', 'description', 'prompt', 'message', 'text'];

type Raw =
  | { seq: number; kind: 'text'; who: string; body: string; base: number }
  | { seq: number; kind: 'tool'; line: string }
  | { seq: number; kind: 'checkpoint'; body: string };

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const size = (s: string): string => (s.length >= 1000 ? `${(s.length / 1000).toFixed(1)}k chars` : `${s.length} chars`);

function keyArg(args: unknown): [string, string] | null {
  if (typeof args === 'string') return args.trim() ? ['input', args] : null;
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  for (const k of KEY_ARGS) if (typeof a[k] === 'string' && (a[k] as string).trim()) return [k, a[k] as string];
  if (Array.isArray(a.args) && a.args.length) return ['args', a.args.map(String).join(' ')];
  return null;
}

function toolLine(it: ItemOf<'tool'>, seq: number, b: Budgets): string {
  const full = (b.toolInputTokens ?? 0) > 0;
  const key = full ? null : keyArg(it.args);
  const arg = key ? ` ${key[0]}=${JSON.stringify(cutTokens(oneLine(key[1]), b.toolCallTokens).text)}` : '';
  const status = it.status === 'running' ? 'did not finish' : it.isError ? 'error' : 'ok';
  const extra = [it.result ? size(it.result) : '', it.images?.length ? `${it.images.length} image${it.images.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
  let line = `[seq ${seq}] tool ${it.name}${arg} → ${status}${extra ? `, ${extra}` : ''}`;
  // the whole input (a file written, a command run), not just what it was about
  if (full) {
    const input = it.args == null ? '' : typeof it.args === 'string' ? it.args : JSON.stringify(it.args, null, 2);
    if (input && input !== '{}') {
      const c = cutTokens(input, b.toolInputTokens!);
      line += `\n  input: ${c.text}${c.cut ? ` …(cut; full input: seq ${seq})` : ''}`;
    }
  }
  if (b.toolResultTokens > 0 && it.result) {
    const r = cutTokens(it.result.trim(), b.toolResultTokens);
    line += `\n  result: ${r.text}${r.cut ? ` …(cut; full result: seq ${seq})` : ''}`;
  }
  return line;
}

const stripGuide = (text: string): string => (text.startsWith(GUIDE) ? text.slice(GUIDE.length) : text.startsWith(SUMMARY_GUIDE) ? text.slice(SUMMARY_GUIDE.length) : text).trim();

function rawEntries(items: ChatItem[], seqs: number[], prior: { seq: number; text: string } | null, b: Budgets): Raw[] {
  const raws: Raw[] = [];
  if (prior) raws.push({ seq: prior.seq, kind: 'checkpoint', body: stripGuide(prior.text) });
  for (const seq of seqs) {
    const it = items[seq];
    if (it.type === 'user') raws.push({ seq, kind: 'text', who: `user${it.from ? ` (from ${it.from})` : ''}`, body: `${it.text}${it.attachments?.length ? `\n(attached: ${it.attachments.join(', ')})` : ''}`, base: b.userTextTokens });
    else if (it.type === 'assistant') {
      if (it.text.trim()) raws.push({ seq, kind: 'text', who: 'you', body: it.text, base: b.textTokens });
    } else if (it.type === 'error') raws.push({ seq, kind: 'text', who: 'error', body: it.text, base: Math.min(128, b.textTokens) });
    else if (it.type === 'tool' && !HIDDEN_TOOLS.has(it.name)) raws.push({ seq, kind: 'tool', line: toolLine(it, seq, b) });
  }
  return raws;
}

function renderRaw(r: Raw, scale: number, b: Budgets): string {
  if (r.kind === 'tool') return r.line;
  if (r.kind === 'checkpoint') return `[seq ${r.seq}] the compacted history before this one:\n${r.body}\n[end of seq ${r.seq}]`;
  const { text, cut } = cutTokens(r.body.trim(), Math.max(b.minTextTokens, Math.floor(r.base * scale)));
  return `[seq ${r.seq}] ${r.who}: ${text}${cut ? ` …(cut; full text: seq ${r.seq})` : ''}`;
}

const MARK_TOKENS = 16;

/** Compiles items (by seq) into the body of a compacted history that fits in b.cap tokens. Over the cap,
 *  the messages are cut shorter first (tool lines never are), then the oldest tool lines are left out,
 *  then the oldest entries of any kind. The newest entry always stays. */
export function compileHistory(items: ChatItem[], seqs: number[], prior: { seq: number; text: string } | null, b: Budgets): { body: string; tokens: number; dropped: number } {
  const raws = rawEntries(items, seqs, prior, b);
  if (!raws.length) return { body: '', tokens: 0, dropped: 0 };
  let lines = raws.map((r) => renderRaw(r, 1, b));
  let toks = lines.map(estimateTokens);
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
  let total = sum(toks);
  if (total > b.cap) {
    const fixed = sum(toks.filter((_, i) => raws[i].kind !== 'text'));
    const text = total - fixed;
    for (let k = 0; k < 8 && total > b.cap && text > 0; k++) {
      const scale = Math.max(0, (b.cap - fixed) / text) * 0.85 ** k;
      lines = raws.map((r) => renderRaw(r, scale, b));
      toks = lines.map(estimateTokens);
      total = sum(toks);
    }
  }
  const gone: boolean[] = raws.map(() => false);
  let kept = total;
  let runs = 0;
  const cost = () => kept + runs * MARK_TOKENS;
  const drop = (i: number) => {
    gone[i] = true;
    kept -= toks[i];
    // a gap of its own, or joining the gap next to it (or bridging two)
    const before = i > 0 && gone[i - 1];
    const after = i < raws.length - 1 && gone[i + 1];
    runs += before && after ? -1 : before || after ? 0 : 1;
  };
  for (let i = 0; i < raws.length && cost() > b.cap; i++) if (raws[i].kind === 'tool' && i < raws.length - 1) drop(i);
  for (let i = 0; i < raws.length - 1 && cost() > b.cap; i++) if (!gone[i]) drop(i);
  const out: string[] = [];
  let dropped = 0;
  for (let i = 0; i < raws.length; i++) {
    if (!gone[i]) {
      out.push(lines[i]);
      continue;
    }
    let j = i;
    while (j + 1 < raws.length && gone[j + 1]) j++;
    const run = raws.slice(i, j + 1);
    dropped += run.length;
    const a = run[0].seq;
    const z = run[run.length - 1].seq;
    const range = a === z ? `seq ${a}` : `seq ${a}–${z}`;
    const cp = run.find((r) => r.kind === 'checkpoint');
    if (cp) out.push(`[the compacted history before this one (seq ${cp.seq})${run.length > 1 ? ` and ${run.length - 1} more entr${run.length === 2 ? 'y' : 'ies'}` : ''} left out to save room: ${range}]`);
    else if (run.every((r) => r.kind === 'tool')) out.push(`[${run.length} tool call${run.length === 1 ? '' : 's'} left out to save room: ${range}]`);
    else out.push(`[${run.length} earlier entr${run.length === 1 ? 'y' : 'ies'} left out to save room: ${range}]`);
    i = j;
  }
  const body = out.join('\n');
  return { body, tokens: estimateTokens(body), dropped };
}

// ---------- which messages stay in full ----------
/** A message: something you or the agent said (tool calls belong to the message before them). */
const isMessage = (it: ChatItem): boolean => it.type === 'user' || (it.type === 'assistant' && !!it.text.trim());
const isStepStart = (items: ChatItem[], j: number): boolean => {
  const t = items[j].type;
  const prev = items[j - 1]?.type;
  return t === 'assistant' || (t === 'tool' && prev !== 'tool' && prev !== 'assistant');
};

/** Where the tail that stays in full starts: the last keepMessages messages with their tool calls (the
 *  message being answered, when current, always stays and counts as one). Past maxTokens the oldest of
 *  them go first. When the message being answered and its work are too big by themselves, only its
 *  newest steps that fit stay. */
export function planTail(items: ChatItem[], start: number, { keepMessages, maxTokens, current }: { keepMessages: number; maxTokens: number; current: boolean }): number {
  const len = items.length;
  // suffix[i]: tokens of items[i..]
  const suffix = new Array<number>(len + 1).fill(0);
  for (let i = len - 1; i >= start; i--) suffix[i] = suffix[i + 1] + itemTokens(items[i]);
  const cur = current ? items.findLastIndex((it, i) => i >= start && it.type === 'user') : -1;
  const msgs: number[] = [];
  for (let i = start; i < (cur === -1 ? len : cur); i++) if (isMessage(items[i])) msgs.push(i);
  const floor = cur === -1 ? len : cur;
  let k = Math.min(Math.max(0, keepMessages - (cur === -1 ? 0 : 1)), msgs.length);
  const at = () => (k ? msgs[msgs.length - k] : floor);
  while (k > 0 && suffix[at()] > maxTokens) k--;
  let tail = at();
  if (cur !== -1 && tail === cur && suffix[cur] > maxTokens) {
    const steps: number[] = [];
    for (let j = cur + 1; j < len; j++) if (isStepStart(items, j)) steps.push(j);
    if (steps.length) tail = steps.find((j) => suffix[j] <= maxTokens) ?? steps[steps.length - 1];
  }
  return tail;
}

// ---------- the API model's message list after a compaction ----------
/** Keeps the messages that stay in full (chat.llm is what an API-model agent sends). A tail that starts
 *  inside a turn keeps that turn's user message in front, so the list still starts with the user. */
export function rebuildLlm(llm: LlmMessage[], items: ChatItem[], upto: number): LlmMessage[] {
  const tail = items.slice(upto).filter((i) => i.type !== 'meta' && i.type !== 'compaction');
  if (!tail.length || !llm.length) return [];
  const userIdx: number[] = [];
  llm.forEach((m, i) => m.role === 'user' && userIdx.push(i));
  const n = tail.filter((i) => i.type === 'user').length;
  if (tail[0].type === 'user') return n >= userIdx.length ? llm.slice(userIdx[0] ?? 0) : llm.slice(userIdx[userIdx.length - n]);
  // the cut is inside a turn: the turn's user message, then the cut's assistant message onwards
  const u = userIdx[userIdx.length - n - 1];
  if (u == null) return n ? llm.slice(userIdx[0]) : [];
  const next = userIdx[userIdx.length - n] ?? llm.length;
  const firstUser = tail.findIndex((i) => i.type === 'user');
  const inTurn = firstUser === -1 ? tail : tail.slice(0, firstUser);
  const tool = inTurn.find((i): i is ItemOf<'tool'> => i.type === 'tool');
  let k = tool ? llm.findIndex((m, i) => i > u && i < next && m.role === 'assistant' && !!m.tool_calls?.some((c) => c.id === tool.id)) : -1;
  // a final answer with no tool call: the turn's last assistant message
  if (k === -1 && !tool) k = llm.slice(0, next).findLastIndex((m, i) => i > u && m.role === 'assistant');
  return k > u ? [llm[u], ...llm.slice(k)] : llm.slice(u);
}

/** The API model's message list made from the chat as it shows (after another engine answered here): what
 *  it remembers (after the latest compaction or Clear memory) up to the message being answered, which the
 *  engine adds itself. Another engine's tool calls aren't the API model's: only what was said goes in. */
export function llmFromItems(items: ChatItem[]): LlmMessage[] {
  const cur = items.findLastIndex((i) => i.type === 'user');
  const out: LlmMessage[] = [];
  for (let i = memoryStart(items); i < (cur === -1 ? items.length : cur); i++) {
    const it = items[i];
    if (it.type === 'user') out.push({ role: 'user', content: `${it.text}${it.attachments?.length ? `\n(attached: ${it.attachments.join(', ')})` : ''}` });
    else if (it.type === 'assistant' && it.text.trim()) {
      // (it starts with your message)
      if (!out.length) continue;
      const last = out[out.length - 1];
      if (last.role === 'assistant') last.content = `${String(last.content ?? '')}\n\n${it.text}`;
      else out.push({ role: 'assistant', content: it.text });
    }
  }
  return out;
}

// ---------- compacting ----------
export interface CompactOptions {
  trigger: CompactionTrigger;
  /** default: the setting (instant unless switched off) */
  mode?: 'instant' | 'summary';
  /** the model's context window (sets how big the compacted history and the tail may be) */
  window: number;
  /** the last user message is the one being answered right now: it always stays word for word */
  current: boolean;
  keepMessages?: number;
}

/** Compacts the chat in place: adds the compaction item (before the message being answered when that is
 *  the last item, else at the end), keeps only the tail in chat.llm and has the next engine session start
 *  from the compacted history. Returns null when there is nothing to compact, or it would not save room. */
export async function compactChat(chat: Chat, o: CompactOptions): Promise<CompactionItem | null> {
  const settings = compactionSettings();
  const items = chat.items;
  const start = memoryStart(items);
  const prior = latestCompaction(items);
  const priorRef = prior ? { seq: prior.index, text: prior.item.text } : null;
  const sizes = sizesFor(o.window || 128_000, settings.thresholdPercent);
  const tail = planTail(items, start, { keepMessages: o.keepMessages ?? settings.keepMessages, maxTokens: sizes.tail, current: o.current });
  const seqs: number[] = [];
  for (let i = start; i < tail; i++) if (['user', 'assistant', 'tool', 'error'].includes(items[i].type)) seqs.push(i);
  if (!seqs.length) return null;

  const before = (prior ? estimateTokens(prior.item.text) : 0) + itemsTokens(items, start);
  const kept = itemsTokens(items, tail);
  const instant = compileHistory(items, seqs, priorRef, sizes.compile);
  let text = `${GUIDE}\n\n${instant.body}`;
  let mode: 'instant' | 'summary' = 'instant';
  let note: string | undefined;
  const count = items.length;
  if ((o.mode ?? (settings.instant ? 'instant' : 'summary')) === 'summary') {
    try {
      const source = compileHistory(items, seqs, priorRef, sizes.summarySource);
      const summary = (await summarize(source.body)).trim();
      if (!summary) throw new Error('the model answered with nothing');
      const s = `${SUMMARY_GUIDE}\n\n${cutTokens(summary, sizes.compile.cap).text}`;
      // a summary longer than the instant version saves nothing
      if (estimateTokens(s) < estimateTokens(text)) {
        text = s;
        mode = 'summary';
      } else note = 'The summary came out longer than the instant version, so this is the instant one.';
    } catch (e) {
      note = `The summary failed (${String((e as Error).message || e).slice(0, 200)}), so this is an instant compaction.`;
    }
  }
  // the chat changed while the summary was written (Clear memory, say): what was planned no longer fits
  if (items.length !== count) return null;
  const after = estimateTokens(text) + kept;
  if (after >= before) return null;

  const cur = o.current ? items.findLastIndex((i) => i.type === 'user') : -1;
  const insertAt = o.current && cur === items.length - 1 ? cur : items.length;
  const item: CompactionItem = { type: 'compaction', id: uid('k'), text, mode, trigger: o.trigger, upto: tail >= insertAt ? tail + 1 : tail, tokensBefore: before, tokensAfter: after, ...(note ? { note } : {}), ts: Date.now() };
  items.splice(insertAt, 0, item);
  chat.llm = rebuildLlm((chat.llm || []) as LlmMessage[], items, item.upto);
  chat.sessionId = null;
  chat.reseed = true;
  delete chat.context;
  return item;
}

async function summarize(history: string): Promise<string> {
  const { think } = await import('./brain.ts');
  const system = `You compact the history of a chat between a user and an AI agent, so the agent can carry on with less memory. Write what the agent will read instead of the history.
Keep: what the user wants, and every requirement, decision and preference they stated; what has been done, with exact file paths, commands, names, ids, numbers and results; what failed and why; what is still open or was promised next.
Leave out pleasantries and anything that was later replaced. Write compact Markdown notes addressed to the agent ("you"), and keep "(seq N)" next to details the agent may need to look up again. Answer with the notes only.`;
  return think(system, history, { timeout: 180_000, maxTokens: 6_000 });
}

// ---------- what the agent gets after a compaction ----------
/** For an API-model agent: the compacted history, added to its system prompt. */
export function checkpointSection(items: ChatItem[]): string {
  const cp = latestCompaction(items);
  return cp ? `\n\n# Earlier in this chat\n<compacted-history>\n${cp.item.text}\n</compacted-history>` : '';
}

/** For a CLI engine's new session: the compacted history and the messages kept in full, then the new message. */
export function seedPrompt(items: ChatItem[], text: string, window = 200_000): string {
  const cp = latestCompaction(items);
  const cur = items.findLastIndex((i) => i.type === 'user');
  const seqs: number[] = [];
  for (let i = memoryStart(items); i < (cur === -1 ? items.length : cur); i++) if (['user', 'assistant', 'tool', 'error'].includes(items[i].type)) seqs.push(i);
  const recent = compileHistory(items, seqs, null, sizesFor(window, compactionSettings().thresholdPercent).seed).body;
  if (cp) return `<compacted-history>\n${cp.item.text}\n${recent ? `\nThe latest messages, in full:\n${recent}\n` : ''}</compacted-history>\n\nThis chat carries on from here. The new message:\n\n${text}`;
  // no compaction yet (the engine changed, or its session was lost): the chat so far, as it fits
  return recent ? `<chat-history>\n${recent}\n</chat-history>\n\nThis chat carries on from here. The new message:\n\n${text}` : text;
}

// ---------- recall_history ----------
const RECALL_TOKENS = 16_000;

function fullItem(it: ChatItem, seq: number): string {
  if (it.type === 'user') return `[seq ${seq}] user${it.from ? ` (from ${it.from})` : ''}: ${it.text}${it.attachments?.length ? `\n(attached: ${it.attachments.join(', ')})` : ''}`;
  if (it.type === 'assistant') return `[seq ${seq}] you: ${it.text}`;
  if (it.type === 'error') return `[seq ${seq}] error: ${it.text}`;
  if (it.type === 'meta') return `[seq ${seq}] note: ${it.text}`;
  if (it.type === 'compaction') return `[seq ${seq}] compacted history (${it.mode}):\n${it.text || '(the engine compacted its own memory; nothing is kept here)'}`;
  const args = it.args == null ? '' : typeof it.args === 'string' ? it.args : JSON.stringify(it.args, null, 2);
  const status = it.status === 'running' ? 'did not finish' : it.isError ? 'error' : 'ok';
  return `[seq ${seq}] tool ${it.name}\ninput: ${args || '(none)'}\nresult (${status}): ${it.result ?? '(none)'}${it.images?.length ? `\n(${it.images.length} image(s) were shown to the user)` : ''}`;
}

export interface RecallArgs {
  seq?: unknown;
  from?: unknown;
  to?: unknown;
  query?: unknown;
}

/** Reads entries of a chat back in full: one (seq), a range (from/to) or a search (query). */
export function recall(items: ChatItem[], { seq, from, to, query }: RecallArgs): { text: string; isError?: boolean } {
  const n = items.length;
  const num = (v: unknown): number | null => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.floor(Number(v)));
  const fit = (s: string) => {
    const c = cutTokens(s, RECALL_TOKENS);
    return c.cut ? `${c.text}\n…(cut at ${RECALL_TOKENS} tokens: ask for a smaller range)` : c.text;
  };
  const one = num(seq);
  if (one != null) {
    if (one < 0 || one >= n) return { text: `There is no seq ${one}. This chat has seq 0–${n - 1}.`, isError: true };
    return { text: fit(fullItem(items[one], one)) };
  }
  const a = num(from);
  const z = num(to);
  if (a != null || z != null) {
    const lo = Math.max(0, a ?? 0);
    const hi = Math.min(n - 1, z ?? lo + 19, lo + 39);
    if (lo > hi) return { text: `Nothing in seq ${lo}–${hi}. This chat has seq 0–${n - 1}.`, isError: true };
    const out: string[] = [];
    for (let i = lo; i <= hi; i++) out.push(fullItem(items[i], i));
    return { text: fit(`${out.join('\n\n')}${hi < (z ?? hi) ? `\n\n(up to 40 entries at a time: carry on from seq ${hi + 1})` : ''}`) };
  }
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const hits: string[] = [];
    for (let i = 0; i < n && hits.length < 50; i++) {
      const full = fullItem(items[i], i);
      const low = full.toLowerCase();
      if (!words.every((w) => low.includes(w))) continue;
      const at = low.indexOf(words[0]);
      const snip = oneLine(full.slice(Math.max(0, at - 120), at + 200));
      hits.push(`[seq ${i}] ${items[i].type}: …${snip}…`);
    }
    return { text: hits.length ? fit(`${hits.length}${hits.length === 50 ? '+' : ''} match${hits.length === 1 ? '' : 'es'} (read one in full with seq=N):\n${hits.join('\n')}`) : `Nothing in this chat matches "${words.join(' ')}".` };
  }
  const marks = items.flatMap((it, i) => (it.type === 'compaction' ? [`seq ${i} (${it.mode})`] : []));
  return { text: `This chat has ${n} entries (seq 0–${n - 1}).${marks.length ? ` Compacted at ${marks.join(', ')}.` : ''} Pass seq=N for one entry, from/to for a range, or query to search.` };
}
