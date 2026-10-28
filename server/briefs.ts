// Work the Brain handed to teams and agents, per project, so it can follow up and see what is open.
import { activeProject, emit } from './store.ts';
import { readJSON, writeJSON, dataPath, uid } from './util.ts';
import type { BrainBrief } from '../shared/types.ts';

// finished briefs kept (open ones are always kept: they are still followed up)
const KEEP = 40;
const file = (pid: string) => dataPath('projects', pid, 'brain-briefs.json');

export function listBriefs(pid = activeProject().id): BrainBrief[] {
  return readJSON<{ briefs: BrainBrief[] }>(file(pid), { briefs: [] }).briefs;
}

function save(pid: string, list: BrainBrief[]) {
  const closed = list.filter((b) => b.status !== 'open');
  const drop = new Set(closed.slice(0, Math.max(0, closed.length - KEEP)));
  writeJSON(file(pid), { briefs: list.filter((b) => !drop.has(b)) });
}

// Open chats show a goal (and its follow-ups) as it changes.
const told = (b: BrainBrief, pid: string) => emit('brief', { projectId: pid, brief: b });

// An agent's goal belongs to one chat: only the same chat's brief (or, without goals, any older one to it) gives way.
const sameWork = (x: BrainBrief, b: Omit<BrainBrief, 'id' | 'followUps' | 'status'>) =>
  x.kind === b.kind && x.targetId === b.targetId && (b.kind === 'team' || x.chatId === b.chatId || (!x.goal && !b.goal));

/** A new brief. Older open ones to the same team or agent are replaced by it. */
export function addBrief(b: Omit<BrainBrief, 'id' | 'followUps' | 'status'>, pid = activeProject().id): BrainBrief {
  const replaced: BrainBrief[] = [];
  const list = listBriefs(pid).map((x) => {
    if (x.status !== 'open' || !sameWork(x, b)) return x;
    const y = { ...x, status: 'replaced' as const, updatedAt: Date.now() };
    replaced.push(y);
    return y;
  });
  const brief: BrainBrief = { ...b, id: uid('bf'), followUps: 0, status: 'open' };
  save(pid, [...list, brief]);
  for (const x of replaced) told(x, pid);
  told(brief, pid);
  return brief;
}

export function updateBrief(id: string, patch: Partial<BrainBrief>, pid = activeProject().id): BrainBrief | null {
  const list = listBriefs(pid);
  const at = list.findIndex((x) => x.id === id);
  if (at === -1) return null;
  list[at] = { ...list[at], ...patch, id, updatedAt: Date.now() };
  save(pid, list);
  told(list[at], pid);
  return list[at];
}

/** Your open /goal in an agent's chat, or a team's. */
export const openGoal = (kind: BrainBrief['kind'], targetId: string, chatId: string | null = null, pid = activeProject().id): BrainBrief | null =>
  listBriefs(pid).findLast((x) => x.status === 'open' && !!x.goal && x.kind === kind && x.targetId === targetId && (kind === 'team' || x.chatId === chatId)) || null;

/** The open brief to a team or an agent (the newest). */
export const openBrief = (kind: BrainBrief['kind'], targetId: string, pid = activeProject().id): BrainBrief | null =>
  listBriefs(pid).findLast((x) => x.status === 'open' && x.kind === kind && x.targetId === targetId) || null;
