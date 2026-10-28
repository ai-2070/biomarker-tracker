// Routines: saved instructions you run by hand or on a schedule. In the text you @mention who does
// it (one or more agents and teams) and which skills they use for it. Each mentioned agent gets the
// routine in its own chat; each mentioned team gets it in its team chat (where @mentioned members
// pick it up). An agent that is in a mentioned team is reached through the team, not twice.
import { routines, routineRuns, agents, chats, emit, log, activeProject, withProject, listProjects } from './store.ts';
import { uid } from './util.ts';
import { askAgent, stopChildren, RunStopped } from './engines/index.ts';
import { getTeam, listTeams, postUserMessage } from './teams.ts';
import { getSkill, listSkills } from './skills.ts';
import { pickMember } from './brain.ts';
import { due } from './workflows.ts';
import { cleanSchedule, findMentions, renameMentions } from '../shared/routines.ts';
import type { Agent, Routine, RoutineMention, RoutineRun, RoutineRunTarget, Team } from '../shared/types.ts';

const MAX_TEXT = 20000;
const MAX_OUTPUT = 4000;
const KEEP_RUNS = 30; // per routine

const active = new Map<string, AbortController>(); // runId -> its stop switch

// An error the page shows as is (not a server fault).
const oops = (message: string, status = 400) => Object.assign(new Error(message), { status });

// Everything a routine can mention, agents first (they win a name clash), then teams, then skills.
function candidates(): RoutineMention[] {
  return [
    ...agents.list().map((a): RoutineMention => ({ kind: 'agent', id: a.id, name: a.name })),
    ...listTeams().map((t): RoutineMention => ({ kind: 'team', id: t.id, name: t.name })),
    ...listSkills().map((s): RoutineMention => ({ kind: 'skill', id: s.slug, name: s.name })),
  ];
}

function currentName(m: Pick<RoutineMention, 'kind' | 'id'>): string | null {
  if (m.kind === 'agent') return agents.get(m.id)?.name ?? null;
  if (m.kind === 'team') return getTeam(m.id)?.name ?? null;
  return getSkill(m.id)?.name ?? null;
}

const key = (m: Pick<RoutineMention, 'kind' | 'id'>) => `${m.kind}:${m.id}`;

/** A routine's text and mentions as they read now. rename: @OldName becomes @NewName for an agent,
 *  team or skill renamed since (off for text someone just wrote). Deleted ones stay listed while
 *  their @name is still in the text, so the page can warn about them; missing says which. */
function refresh(text: string, stored: readonly RoutineMention[], rename: boolean): { text: string; mentions: RoutineMention[] } {
  const names = new Map<string, string>();
  for (const m of stored) {
    const now = currentName(m);
    if (now) names.set(key(m), now);
  }
  const out = rename ? renameMentions(text, stored, names) : text;
  const found = findMentions(out, candidates());
  const have = new Set(found.map(key));
  const taken = new Set(found.map((m) => m.name.toLowerCase()));
  const gone = stored
    .filter((m) => !names.has(key(m)) && !have.has(key(m)) && !taken.has(m.name.toLowerCase()) && findMentions(out, [m]).length)
    .map(({ kind, id, name }): RoutineMention => ({ kind, id, name, missing: true }));
  return { text: out, mentions: [...found, ...gone] };
}

/** The routine with its text and mentions brought up to date (see refresh). */
export function resolveRoutine(r: Routine): Routine {
  return { ...r, ...refresh(r.text || '', r.mentions || [], true) };
}

export function getRoutine(id: string): Routine | null {
  const r = routines.get(id);
  return r ? resolveRoutine(r) : null;
}

export function listRoutines(): (Routine & { lastRun: RoutineRun | null })[] {
  const runs = routineRuns.list().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return routines
    .list()
    .map(resolveRoutine)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ ...r, lastRun: runs.find((x) => x.routineId === r.id) || null }));
}

/** Creates (no id) or updates a routine. Only the fields you can edit are taken from patch. */
export function saveRoutine(patch: Partial<Routine>, id?: string): Routine {
  const old = id ? routines.get(id) : null;
  if (id && !old) throw oops('No such routine.', 404);
  const next: Partial<Routine> = { ...(old || { schedule: { type: 'none' }, enabled: false }) };
  if (patch.name !== undefined) next.name = String(patch.name).trim().slice(0, 120);
  if (patch.description !== undefined) next.description = String(patch.description || '').trim().slice(0, 500);
  if (patch.text !== undefined) next.text = String(patch.text || '').slice(0, MAX_TEXT);
  if (patch.schedule !== undefined) next.schedule = cleanSchedule(patch.schedule);
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  next.name ||= 'New routine';
  next.text ??= '';
  // the mentions are worked out from the text. Text kept as it was is brought up to date first
  // (renames), so saving only the name or schedule doesn't lose who the routine is for.
  const fresh = refresh(next.text, old?.mentions || [], patch.text === undefined);
  next.text = fresh.text;
  next.mentions = fresh.mentions.map(({ kind, id, name }) => ({ kind, id, name })); // missing is worked out when read
  // turning a schedule on (or changing it) shouldn't fire at once for a time that already passed today
  const schedChanged = patch.schedule !== undefined && JSON.stringify(next.schedule) !== JSON.stringify(old?.schedule);
  if (schedChanged || (next.enabled && !old?.enabled)) next.lastScheduledAt = Date.now();
  return routines.save(next);
}

export function deleteRoutine(id: string) {
  const r = routines.get(id);
  if (!r) return;
  routines.remove(r.id);
  for (const run of routineRuns.list()) if (run.routineId === r.id && run.status !== 'running') routineRuns.remove(run.id);
  log('routine', `Deleted routine "${r.name}"`);
}

/** Who a routine goes to: the mentioned teams, and the mentioned agents that aren't in one of them. */
export function routineTargets(r: Routine): { teams: Team[]; agents: Agent[]; skills: string[] } {
  const live = (r.mentions || []).filter((m) => !m.missing);
  const teams = live.filter((m) => m.kind === 'team').map((m) => getTeam(m.id)).filter((t): t is Team => Boolean(t));
  const inTeams = new Set(teams.flatMap((t) => t.members));
  const solo = live
    .filter((m) => m.kind === 'agent' && !inTeams.has(m.id))
    .map((m) => agents.get(m.id))
    .filter((a): a is Agent => Boolean(a));
  const skills = live.filter((m) => m.kind === 'skill' && getSkill(m.id)).map((m) => m.id);
  return { teams, agents: solo, skills };
}

// What each agent or team is sent.
export function routineMessage(r: Routine, { skills, others, input = '' }: { skills: string[]; others: string[]; input?: string }): string {
  const parts = [`Routine "${r.name}":`, r.text.trim()];
  if (input.trim()) parts.push(`Input for this run:\n${input.trim()}`);
  const list = skills.map((slug) => getSkill(slug)).filter((s): s is NonNullable<typeof s> => s !== null);
  if (list.length) parts.push(`Skills for this routine. Open each with read_skill before you start, and follow it:\n${list.map((s) => `- ${s.name} [id: ${s.slug}]`).join('\n')}`);
  if (others.length) parts.push(`This routine also went to: ${others.join(', ')}.`);
  return parts.join('\n\n');
}

const summary = (text: string) => (text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}…` : text);

export async function startRoutine(id: string, { trigger = 'manual', input = '' }: { trigger?: string; input?: string } = {}): Promise<RoutineRun> {
  const r = getRoutine(id);
  if (!r) throw oops('No such routine.', 404);
  if (!r.text.trim()) throw oops('Write what the routine should do first.');
  const { teams, agents: solo, skills } = routineTargets(r);
  if (!teams.length && !solo.length) throw oops('Mention at least one agent or team with @ so the routine knows who does it.');
  const targets: RoutineRunTarget[] = [
    ...teams.map((t): RoutineRunTarget => ({ kind: 'team', id: t.id, name: t.name, status: 'running' })),
    ...solo.map((a): RoutineRunTarget => ({ kind: 'agent', id: a.id, name: a.name, status: 'running' })),
  ];
  const run = routineRuns.save({ id: uid('rr'), routineId: r.id, routineName: r.name, trigger, status: 'running', skills, targets, error: null });
  const ac = new AbortController();
  active.set(run.id, ac);
  log('routine', `Started routine "${r.name}" (${trigger}) for ${targets.map((t) => t.name).join(', ')}`);
  const save = () => {
    routineRuns.save(run);
    emit('routine-run', { id: run.id, routineId: r.id, run });
  };
  save();
  const label = (t: RoutineRunTarget) => `@${t.name}${t.kind === 'team' ? ' (team)' : ''}`;
  // the run stays in this project (its record and agents) if you open another one meanwhile
  const project = activeProject();
  const jobs = withProject(project, () => targets.map(async (t) => {
    const message = routineMessage(r, { skills, input, others: targets.filter((x) => x !== t).map(label) });
    try {
      if (t.kind === 'team') {
        // (Stop reaches it while it still picks who answers: then nobody starts on it)
        await postUserMessage(t.id, message, { route: pickMember, skills, signal: ac.signal });
        t.status = 'sent';
        t.output = 'Posted in the team chat.';
      } else {
        const agent = agents.get(t.id);
        if (!agent) throw new Error('This agent no longer exists.');
        const title = `Routine: ${r.name}`;
        // ask in a chat made here, so the run can link to it
        const chat = chats.create(agent.id, title);
        t.chatId = chat.id;
        save();
        const text = await askAgent(agent, message, { depth: 1, from: `routine "${r.name}"`, chatId: chat.id, parentRunId: run.id, signal: ac.signal, extra: { skills } });
        t.status = ac.signal.aborted ? 'stopped' : 'done';
        t.output = summary(text);
      }
    } catch (e) {
      // stopped: the whole routine, or this agent's own run (its Stop button)
      t.status = ac.signal.aborted || e instanceof RunStopped ? 'stopped' : 'failed';
      t.output = (e as Error).message;
    }
    save();
  }));
  void withProject(project, () =>
    Promise.all(jobs).then(() => {
    active.delete(run.id);
    run.status = ac.signal.aborted || targets.every((t) => t.status === 'stopped') ? 'stopped' : targets.every((t) => t.status === 'failed') ? 'failed' : 'done';
    const failed = targets.filter((t) => t.status === 'failed');
    run.error = failed.length ? failed.map((t) => `${t.name}: ${t.output}`).join('\n') : null;
    run.finishedAt = Date.now();
    save();
    prune(r.id);
    log(run.status === 'failed' ? 'error' : 'routine', `Routine "${r.name}" ${run.status}`);
    }),
  );
  return run;
}

/** The ids of routine runs going right now (every project's). */
export const runningRoutineRuns = (): string[] => [...active.keys()];

export function stopRoutineRun(runId: string): boolean {
  const ac = active.get(runId);
  ac?.abort();
  stopChildren(runId);
  return !!ac;
}

export function listRuns(routineId?: string): RoutineRun[] {
  return routineRuns
    .list()
    .filter((x) => !routineId || x.routineId === routineId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 50);
}

// keep the latest runs of a routine
function prune(routineId: string) {
  for (const old of listRuns(routineId).slice(KEEP_RUNS)) if (old.status !== 'running') routineRuns.remove(old.id);
}

// Runs that were going when the dashboard stopped can't continue (in every project, not only the open one).
export function markInterruptedRoutines() {
  for (const p of listProjects()) {
    withProject(p, () => {
      for (const run of routineRuns.list()) {
        if (run.status !== 'running') continue;
        run.status = 'stopped';
        run.error = 'The dashboard was closed while this ran.';
        for (const t of run.targets) if (t.status === 'running') t.status = 'stopped';
        routineRuns.save(run);
      }
    });
  }
}

export function checkRoutineSchedules(now = Date.now()) {
  for (const r of routines.list()) {
    if (!due(r, now)) continue;
    r.lastScheduledAt = now;
    routines.save(r);
    startRoutine(r.id, { trigger: 'schedule', input: r.schedule?.input || '' }).catch((e: unknown) => log('error', `Scheduled routine "${r.name}": ${(e as Error).message}`));
  }
}

export function startRoutineScheduler() {
  setInterval(() => checkRoutineSchedules(), 30_000).unref();
}
