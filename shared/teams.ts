// Team helpers the server and the page share.
import type { Team, TeamStep } from './types.ts';

// An old step list with tools, approvals, posts or notices runs as a workflow, not as a team chat.
export function isStepList(team: Pick<Team, 'steps'> | null | undefined): boolean {
  return (team?.steps || []).some((s) => s.type !== 'agent');
}

// The steps a team keeps when its members change: one per member, or, for a step list,
// its own steps minus agents that left, with new members added after the last agent step.
export function teamSteps(team: Pick<Team, 'steps' | 'members'>): TeamStep[] {
  const bare = (agentId: string): TeamStep => ({ type: 'agent', agentId });
  if (!isStepList(team)) return team.members.map(bare);
  const kept = team.steps.filter((s) => s.type !== 'agent' || team.members.includes(s.agentId as string));
  const have = new Set(kept.map((s) => s.agentId));
  const added = team.members.filter((id) => !have.has(id)).map(bare);
  const at = kept.findLastIndex((s) => s.type === 'agent') + 1;
  return [...kept.slice(0, at), ...added, ...kept.slice(at)];
}

// ---------- #Team: one team asks another ----------
// A message from another team is posted with from = `team:<its id>`: a question it asked here, or its
// answer to a question asked from here (TeamMessage.relay says which).
const TEAM_FROM = 'team:';
export const teamFrom = (teamId: string): string => `${TEAM_FROM}${teamId}`;
/** The team a message came from, when another team wrote it. */
export const fromTeam = (from: unknown): string | null => (typeof from === 'string' && from.startsWith(TEAM_FROM) ? from.slice(TEAM_FROM.length) || null : null);

// (code is not a message to anyone: `#include` or a `#heading` in a snippet names no team)
const outsideCode = (text: string) => text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The teams a message names as #Team Name (exact names, longest first, any case), minus `self`. */
export function parseTeamRefs(text: unknown, teams: readonly Pick<Team, 'id' | 'name'>[], self: string | null = null): string[] {
  let rest = outsideCode(String(text || ''));
  const found: string[] = [];
  // longest names first, each match taken out, so "#Design Ops" doesn't also count as "#Design"
  for (const t of [...teams].filter((x) => x.name.trim()).sort((a, b) => b.name.length - a.name.length)) {
    // (not in a link's #anchor or an &#39; entity, and not part of a longer word)
    const re = new RegExp(`(^|[^\\w#&/])#${escape(t.name.trim())}(?![\\w-])`, 'gi');
    if (!re.test(rest)) continue;
    rest = rest.replace(re, '$1');
    if (t.id !== self && !found.includes(t.id)) found.push(t.id);
  }
  return found;
}
