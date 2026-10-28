// Handing work to another agent without waiting (ask_agent): the work starts at once and the asker gets
// a handle back; await_agent collects the answer, however long it takes. So a long job never outlives the
// tool call that asked for it (an MCP call from Claude Code, Codex or pi gives up after an hour), and an
// agent can hand out several tasks at once. Stopping the asker's run stops what it handed out (stopRun).
import { uid } from './util.ts';
import { activeProject, chats } from './store.ts';
import type { Agent, Chat } from '../shared/types.ts';

export interface Handoff {
  id: string;
  /** the agent that asked, and its project (a cloned project's agents have the same ids) */
  from: string;
  projectId: string;
  to: string;
  toName: string;
  /** the chat the work happens in (the agent's "Asked by …" chat) */
  chatId: string;
  task: string;
  startedAt: number;
  endedAt?: number;
  answer?: string;
  error?: string;
  /** settles when the work ends, either way */
  done: Promise<void>;
}

const handoffs = new Map<string, Handoff>();
/** Finished ones are kept this long for await_agent (a later turn of the asker can still collect them). */
const KEEP_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_WAIT_S = 600;
export const MAX_WAIT_S = 1800;

function prune() {
  for (const [id, h] of handoffs) if (h.endedAt && Date.now() - h.endedAt > KEEP_MS) handoffs.delete(id);
}

/** Starts the task in a new chat with the target and returns at once. */
export async function startHandoff(from: Pick<Agent, 'id' | 'name'>, target: Agent, task: string, { depth, parentRunId, signal }: { depth: number; parentRunId?: string | null; signal?: AbortSignal }): Promise<Handoff> {
  prune();
  const { askAgent, RunStopped } = await import('./engines/index.ts');
  const chat = chats.create(target.id, `Asked by ${from.name}`);
  const h = { id: uid('h'), from: from.id, projectId: activeProject().id, to: target.id, toName: target.name, chatId: chat.id, task, startedAt: Date.now() } as Handoff;
  h.done = askAgent(target, task, { depth, from: from.name, chatId: chat.id, parentRunId, signal }).then(
    (answer) => {
      h.answer = answer;
      h.endedAt = Date.now();
    },
    (e: unknown) => {
      h.error = e instanceof RunStopped ? 'it was stopped' : (e as Error).message || String(e);
      h.endedAt = Date.now();
    },
  );
  handoffs.set(h.id, h);
  return h;
}

const minutes = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

/** Its latest words while it works (its live chat), for "still working" answers. */
function soFar(h: Handoff, live: Chat | null): string {
  const items = (live || chats.get(h.to, h.chatId))?.items || [];
  const last = items.findLast((i) => i.type === 'assistant' && i.text.trim());
  const tools = items.filter((i) => i.type === 'tool').length;
  const words = last && last.type === 'assistant' ? last.text.trim().slice(-400) : '';
  return `${tools ? ` ${tools} tool call${tools === 1 ? '' : 's'} so far.` : ''}${words ? `\nLatest from ${h.toName}: ${words}` : ''}`;
}

/** Waits up to waitS seconds for a handoff's answer: the answer, its error, or that it is still going. */
export async function awaitHandoff(id: string, askerId: string, waitS = DEFAULT_WAIT_S, signal?: AbortSignal): Promise<{ text: string; isError?: boolean }> {
  const found = handoffs.get(String(id || '').trim());
  // (another project's handoff isn't there for this one)
  const h = found && found.projectId === activeProject().id ? found : undefined;
  if (!h) return { text: `No handoff with handle ${id}. (Finished ones are kept for 6 hours; call await_agent without a handle to list yours.)`, isError: true };
  if (h.from !== askerId) return { text: 'That handle belongs to another agent.', isError: true };
  if (!h.endedAt && !signal?.aborted) {
    const wait = Math.min(MAX_WAIT_S, Math.max(1, Number(waitS) || DEFAULT_WAIT_S)) * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    await Promise.race([
      h.done,
      new Promise<void>((r) => (timer = setTimeout(r, wait))),
      new Promise<void>((r) => {
        onAbort = () => r();
        signal?.addEventListener('abort', onAbort);
      }),
    ]);
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted && !h.endedAt) return { text: 'Stopped.', isError: true };
  if (h.error) return { text: `${h.toName} couldn't finish: ${h.error}`, isError: true };
  if (h.endedAt) return { text: `${h.toName} says:\n${h.answer || '(no answer)'}` };
  const { liveChat } = await import('./engines/index.ts');
  return { text: `${h.toName} is still working on it (${minutes(Date.now() - h.startedAt)} so far).${soFar(h, liveChat(h.chatId, h.projectId))}\nCall await_agent again with handle ${h.id}.` };
}

/** The asker's handoffs, newest first (await_agent without a handle). */
export function listHandoffs(askerId: string): string {
  prune();
  const projectId = activeProject().id;
  const mine = [...handoffs.values()].filter((h) => h.from === askerId && h.projectId === projectId).sort((a, b) => b.startedAt - a.startedAt);
  if (!mine.length) return 'You have no handoffs. Give a task to a teammate with ask_agent.';
  return mine
    .map((h) => `- ${h.id} → ${h.toName}: "${h.task.replace(/\s+/g, ' ').slice(0, 80)}" — ${h.error ? `failed (${h.error.slice(0, 80)})` : h.endedAt ? 'done, answer ready' : `working, ${minutes(Date.now() - h.startedAt)}`}`)
    .join('\n');
}
