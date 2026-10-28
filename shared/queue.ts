// "/queue <message>": send the message once the agent (or the team, or the Brain) is done with what
// it is doing now, instead of being turned away while it works.

/** The message after /queue ('' when nothing follows it), or null when the text isn't a /queue. */
export function queuedText(text: string): string | null {
  const m = /^\/queue(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? (m[1] || '').trim() : null;
}

/** The new text for a queued message (trimmed). Throws when that would leave it with nothing to send. */
export function queuedEdit(text: unknown, hasFiles: boolean): string {
  const next = String(text ?? '').trim();
  if (!next && !hasFiles) throw new Error('Write something, or take it off the list with ×.');
  return next;
}

/** Queued messages in a new order: the ones ids names first, in that order, then the rest in theirs. */
export function reorderQueued<T extends { id: string }>(items: readonly T[], ids: unknown): T[] {
  const want = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  const named = want.map((id) => items.find((q) => q.id === id)).filter((q): q is T => !!q);
  return [...new Set([...named, ...items])];
}
