// @ in an agent chat: which other agents fit what is typed after the "@", and putting the picked name in.
import { mentionQuery } from '../../shared/routines.ts';
import type { Agent } from '../../shared/types.ts';

export type MentionAgent = Pick<Agent, 'id' | 'name'> & Partial<Pick<Agent, 'emoji' | 'color' | 'specialty'>>;

export interface AgentMentions {
  /** where the "@" is */
  start: number;
  options: MentionAgent[];
}

/** The agents to offer for an "@…" just before the caret (not the one you are talking to), best fit
 *  first: names that start with it, then a word in the name that does, then any name containing it.
 *  null when the caret isn't in an "@…" or nobody fits. */
export function agentMentions(text: string, caret: number, agents: readonly MentionAgent[], selfId: string, max = 8): AgentMentions | null {
  const q = mentionQuery(text, caret);
  if (!q) return null;
  const query = q.query.toLowerCase();
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (n.startsWith(query)) return 0;
    if (n.split(/\s+/).some((w) => w.startsWith(query))) return 1;
    return n.includes(query) ? 2 : -1;
  };
  const options = agents
    .filter((a) => a.id !== selfId && a.name.trim())
    .map((a, i) => ({ a, i, r: rank(a.name) }))
    .filter((x) => x.r >= 0)
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .slice(0, max)
    .map((x) => x.a);
  return options.length ? { start: q.start, options } : null;
}

/** The text with "@name " in place of the "@…" being typed (start is the "@"), and where the caret goes.
 *  With the caret partway through, what follows it is taken too while it still spells the name, then
 *  the rest of that word; punctuation and later words stay. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const typed = text.slice(start + 1, caret).toLowerCase();
  const want = name.toLowerCase();
  let rest = text.slice(caret);
  let k = 0;
  while (k < rest.length && want.startsWith(typed + rest.slice(0, k + 1).toLowerCase())) k++;
  rest = rest.slice(k).replace(/^[\p{L}\p{M}\p{N}_]+/u, '');
  // a space after the name, unless one or punctuation already follows
  const put = `@${name}${/^[\s.,;:!?)\]}'"…]/u.test(rest) ? '' : ' '}`;
  return { text: text.slice(0, start) + put + rest, caret: start + put.length + (/^\s/.test(rest) ? 1 : 0) };
}
