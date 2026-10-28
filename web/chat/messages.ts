// A saved chat (its items, the server's own format) as Vercel AI SDK UI messages, for the chat views.
// Each message's id says which item it came from ("m-<seq>", seq = the item's index) and so does its
// metadata, so the UI can find the item again (COMPACTED marks, dimming compacted messages).
//   user           → user message: a text part, and file parts for what was attached
//   assistant text → assistant message; the tool calls after it (in the same turn) are its
//                    dynamic-tool parts (output: { text, images })
//   error, meta, compaction → an assistant message with one data part (data-error / data-meta / data-compaction)
// A live run streams in as one assistant message (server/uistream.ts) and is replaced by the saved
// items once it ends.
import type { DynamicToolUIPart, UIMessage } from 'ai';
import type { ChatItem, CompactionItem } from '../../shared/types.ts';
import { fileUrl } from '../client/connection.ts';

export interface MessageMeta {
  /** the item it came from */
  seq?: number;
  /** a message from another agent or a team: who sent it */
  from?: string | null;
}
export interface MessageData {
  status: { text: string };
  error: Extract<ChatItem, { type: 'error' }>;
  meta: Extract<ChatItem, { type: 'meta' }>;
  compaction: CompactionItem;
  [k: string]: unknown;
}
export type ChatMessage = UIMessage<MessageMeta, MessageData>;
export type ChatPart = ChatMessage['parts'][number];

/** A tool's result (the output of its dynamic-tool part). */
export interface ToolOutput {
  text: string;
  images: string[];
}

export { fileUrl };
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv' };
export const mimeOf = (p: string): string => MIME[/\.([a-z0-9]+)$/i.exec(p)?.[1]?.toLowerCase() || ''] || 'application/octet-stream';
const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
// the path back from a file part (its url is /api/file?path=…)
const pathOf = (url: string): string | null => {
  const m = /[?&]path=([^&]+)/.exec(url);
  try {
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
};

/** A user message's parts: its text, and the attached files. */
export function userParts(text: string, attachments: readonly string[] = []): ChatPart[] {
  return [{ type: 'text', text }, ...attachments.map((p): ChatPart => ({ type: 'file', mediaType: mimeOf(p), url: fileUrl(p), filename: baseName(p) }))];
}

/** The text and attached paths of a user message. */
export function readUser(m: Pick<ChatMessage, 'parts'> | undefined): { text: string; attachments: string[] } {
  const parts = m?.parts || [];
  return {
    text: parts.map((p) => (p.type === 'text' ? p.text : '')).join(''),
    attachments: parts.flatMap((p) => (p.type === 'file' ? [pathOf(p.url)].filter((x): x is string => !!x) : [])),
  };
}

export function toolPart(it: Extract<ChatItem, { type: 'tool' }>): DynamicToolUIPart {
  const base = { type: 'dynamic-tool' as const, toolName: it.name, toolCallId: it.id, input: it.args ?? {} };
  if (it.result == null || it.status === 'running') return { ...base, state: 'input-available' };
  if (it.isError) return { ...base, state: 'output-error', errorText: it.result || 'Failed' };
  return { ...base, state: 'output-available', output: { text: it.result, images: it.images || [] } satisfies ToolOutput };
}

/** What a dynamic-tool part's output says (a result from elsewhere is its own text). */
export function readOutput(output: unknown): ToolOutput {
  if (output && typeof output === 'object' && 'text' in output) {
    const o = output as Partial<ToolOutput>;
    return { text: String(o.text ?? ''), images: Array.isArray(o.images) ? o.images.map(String) : [] };
  }
  return { text: typeof output === 'string' ? output : output == null ? '' : JSON.stringify(output, null, 2), images: [] };
}

export function toUIMessages(items: readonly ChatItem[], from = 0, to = items.length): ChatMessage[] {
  const out: ChatMessage[] = [];
  // the assistant message the next tool calls belong to (only within a turn)
  let open: ChatMessage | null = null;
  for (let seq = from; seq < to; seq++) {
    const it = items[seq];
    if (it.type === 'tool') {
      if (!open) {
        open = { id: `m-${seq}-calls`, role: 'assistant', parts: [], metadata: { seq } };
        out.push(open);
      }
      open.parts.push(toolPart(it));
      continue;
    }
    if (it.type === 'assistant') {
      open = { id: `m-${seq}`, role: 'assistant', parts: [{ type: 'text', text: it.text, state: 'done' }], metadata: { seq } };
      out.push(open);
      continue;
    }
    open = null;
    if (it.type === 'user') out.push({ id: `m-${seq}`, role: 'user', parts: userParts(it.text, it.attachments), metadata: { seq, from: it.from || null } });
    else out.push({ id: `m-${seq}`, role: 'assistant', parts: [{ type: `data-${it.type}`, data: it } as ChatPart], metadata: { seq } });
  }
  return out;
}

/** The messages before the turn a run is answering (a resume replays the turn itself). */
export function beforeTurn(messages: readonly ChatMessage[]): ChatMessage[] {
  const last = messages.findLastIndex((m) => m.role === 'user');
  return messages.slice(0, last + 1);
}
