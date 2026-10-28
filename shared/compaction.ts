// Compaction helpers the server and the page share: which compaction the agent's memory starts from.
import type { ChatItem, CompactionItem } from './types.ts';

/** "Clear memory": the agent starts fresh after it. (Older chats only have the text.) */
export const isReset = (it: ChatItem): boolean => it.type === 'meta' && (!!it.reset || /^Memory cleared/.test(it.text));
/** A compaction the dashboard made. The ones an engine did by itself (Claude Code) only mark the spot. */
export const isOwnCompaction = (it: ChatItem): it is CompactionItem => it.type === 'compaction' && it.mode !== 'engine';

/** The compaction the agent's memory starts from now (none after a Clear memory). */
export function latestCompaction(items: ChatItem[]): { item: CompactionItem; index: number } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (isReset(it)) return null;
    if (isOwnCompaction(it)) return { item: it, index: i };
  }
  return null;
}

/** Index of the first item the agent remembers word for word. */
export function memoryStart(items: ChatItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (isReset(it)) return i + 1;
    if (isOwnCompaction(it)) return Math.min(Math.max(0, it.upto), items.length);
  }
  return 0;
}

/** "about 48k" */
export const kTokens = (n: number | undefined): string => (n == null ? '?' : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
