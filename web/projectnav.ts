// Projects are floors: they have an order, and the Up / Down arrow keys on the Station move between them.
// The small pure parts of that live here so they can be tested without a page.

/** Where an arrow key takes you from floor `from` in a list of `length` (it stops at the ends instead of wrapping). */
export function stepIndex(length: number, from: number, dir: 1 | -1): number {
  if (length < 1) return from;
  return Math.max(0, Math.min(length - 1, from + dir));
}

/** The names shown above and below the project at `idx` (null where there is no floor there). */
export function neighbours<T extends { name: string }>(list: readonly T[], idx: number): { above: T | null; below: T | null } {
  return { above: idx > 0 ? list[idx - 1] ?? null : null, below: idx >= 0 && idx < list.length - 1 ? list[idx + 1] ?? null : null };
}

/** Which way the view moves when going from one floor to another: 1 = down the list, -1 = up it, 0 = not in the list. */
export function floorDirection(ids: readonly string[], fromId: string | null | undefined, toId: string | null | undefined): 1 | -1 | 0 {
  const a = ids.indexOf(fromId ?? '');
  const b = ids.indexOf(toId ?? '');
  return a < 0 || b < 0 || a === b ? 0 : b > a ? 1 : -1;
}

/** The ids with `id` moved to position `to` (the others keep their order). Unknown ids change nothing. */
export function moveId(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const out = ids.filter((x) => x !== id);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, id);
  return out;
}

/** A project's name as the top-left button shows it: at most `max` characters, a longer one cut short with "…" as the last of them. */
export function shortName(name: string, max = 13): string {
  const chars = [...String(name ?? '')];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}
