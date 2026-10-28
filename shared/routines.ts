// Routine helpers the server and the page share: finding @mentions in a routine's text.
import type { RoutineMention, Schedule } from './types.ts';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A letter, mark, digit or _ in any script, so "@Café" doesn't match the start of "@Caféé".
const WORD = '[\\p{L}\\p{M}\\p{N}_]';
// @Name, not inside a word or right after another @, and not followed by more of a word
const mentionRe = (name: string) => new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_@])@${esc(name)}(?!${WORD})`, 'giu');
const wordOrAt = new RegExp(`${WORD}|@`, 'u');

/** The candidates the text mentions, in the order they first appear. Longest names are matched first
 *  and taken out, so "@Trend Scout" doesn't also count as "@Trend". On a name clash the earlier
 *  candidate wins (pass agents, then teams, then skills). */
export function findMentions(text: string, candidates: readonly RoutineMention[]): RoutineMention[] {
  let rest = String(text || '');
  const found: { at: number; m: RoutineMention }[] = [];
  const seen = new Set<string>();
  const byLength = candidates
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.name.trim())
    .sort((a, b) => b.m.name.length - a.m.name.length || a.i - b.i);
  for (const { m } of byLength) {
    const re = mentionRe(m.name);
    let at = -1;
    rest = rest.replace(re, (all, lead: string, offset: number) => {
      if (at < 0) at = offset + lead.length;
      // keep the length, so positions of later matches stay right
      return lead + ' '.repeat(all.length - lead.length);
    });
    const key = `${m.kind}:${m.id}`;
    if (at >= 0 && !seen.has(key)) {
      seen.add(key);
      found.push({ at, m: { kind: m.kind, id: m.id, name: m.name } });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.m);
}

/** Rewrites @OldName to @NewName for mentions whose agent, team or skill was renamed since.
 *  rename maps "kind:id" to the current name. */
export function renameMentions(text: string, stored: readonly RoutineMention[], rename: ReadonlyMap<string, string>): string {
  let out = String(text || '');
  const changed = stored.filter((m) => {
    const now = rename.get(`${m.kind}:${m.id}`);
    return now && now !== m.name;
  });
  if (!changed.length) return out;
  // every stored name, longest first, swapped for a marker, then the markers for the current names
  const all = [...stored].sort((a, b) => b.name.length - a.name.length);
  const marks: string[] = [];
  for (const m of all) {
    const now = rename.get(`${m.kind}:${m.id}`) || m.name;
    out = out.replace(mentionRe(m.name), (_all, lead: string) => {
      marks.push(`@${now}`);
      return `${lead}\u0000${marks.length - 1}\u0000`;
    });
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_x, i: string) => marks[Number(i)]);
}

/** What the text after the caret's "@" is, if the caret is in a mention being typed. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && wordOrAt.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s\s/.test(query)) return null;
  return { start: at, query };
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A schedule in a few words: "manual", "every 60 min", "daily 09:00 Mon Wed". */
export function scheduleText(s: Schedule | undefined): string {
  if (!s || s.type === 'none') return 'manual';
  if (s.type === 'interval') return `every ${s.minutes || 60} min`;
  const days = s.days?.length && s.days.length < 7 ? ` ${s.days.map((d) => DAY_NAMES[d]).join(' ')}` : '';
  return `daily ${s.time || '09:00'}${days}`;
}

/** A schedule from loose input (the Brain's actions): unknown fields dropped, values kept in range. */
export function cleanSchedule(raw: unknown): Schedule {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const type = r.type === 'interval' || r.type === 'daily' ? r.type : 'none';
  const out: Schedule = { type };
  const input = typeof r.input === 'string' ? r.input.trim().slice(0, 2000) : '';
  if (type === 'interval') out.minutes = Math.max(5, Math.min(7 * 24 * 60, Math.round(Number(r.minutes) || 60)));
  if (type === 'daily') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(r.time || '').trim());
    out.time = m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : '09:00';
    const days = (Array.isArray(r.days) ? r.days : [])
      .map((d) => (typeof d === 'number' ? d : DAY_NAMES.findIndex((n) => String(d).toLowerCase().startsWith(n.toLowerCase()))))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    // count each day once: seven "Mon"s are Mondays, not every day
    const unique = [...new Set(days)].sort((a, b) => a - b);
    if (unique.length && unique.length < 7) out.days = unique;
  }
  if (type !== 'none' && input) out.input = input;
  return out;
}
