// Teams are group chats of agents. You write in the team chat; who answers: whoever you name, else the
// author of the message you replied to, else the only member with a service it needs (services.ts),
// else the lead, else the best fit. Agents hand work to each other by @mentioning a teammate, and
// everyone sees one shared thread.
// Each agent keeps its own memory of the team (its own chat session), and gets the new messages each turn.
// The Brain writes here too: it hands the team work, answers when someone writes @Brain, and looks at
// the thread when the team goes quiet (see irc.ts).
// Teams talk to each other like IRC channels: a message that names #Other Team goes to that team's chat
// too, and once that team is done, its last reply comes back here to whoever asked.
import { BUILD_ORDER, DIORAMA } from './voxel/diorama.ts';
import { workflows as teamStore, agents, chats, emit, log, activeProject, openProject, withProject } from './store.ts';
import { readJSON, writeJSON, uid, dataPath, settledWithin } from './util.ts';
import { askAgent, stopChat, stopChildren, forgetChat, RunStopped } from './engines/index.ts';
import { isStepList, teamSteps, parseTeamRefs, teamFrom, fromTeam } from '../shared/teams.ts';
import { attachmentNames, cleanAttachments } from './uploads.ts';
import { soleHolder, servicesOf } from './services.ts';
import type { Agent, LoopInfo, QueuedMessage, Team, TeamMessage, TeamRef, TeamRelay, TeamState } from '../shared/types.ts';
import type { LoopRequest } from '../shared/commands.ts';
import { queuedEdit, reorderQueued } from '../shared/queue.ts';

// No limit on turns, so long work keeps going. What pauses a team is chatter: this many turns in a row
// where agents only talk (no tool used, a short reply), like two agents thanking each other forever.
export const MAX_CHATTER = 8;
const CHATTER_CHARS = 600; // a reply this long is work in itself (a draft, a plan), even without tools
const CONTEXT_CHARS = 9000; // new group messages handed to an agent per turn
const KEEP_MESSAGES = 500;
const MAX_BRAIN_REPLIES = 4; // times the Brain answers @Brain per message you send
const MAX_RELAYS = 4; // times a team asks other teams per message you send
const MAX_RELAY_DEPTH = 3; // a team asking a team asking a team, at most
const ANSWER_CHARS = 8000; // of a team's answer, passed back to the team that asked
/** Who the Brain is in a thread (TeamMessage.from, and in TeamState.working while it answers). */
export const BRAIN = 'brain';

/** The team chat file: the shared thread, each agent's own chat session, and how far each agent has read. */
interface TeamChat {
  messages: TeamMessage[];
  sessions: Record<string, string>; // agentId -> chatId
  seen: Record<string, number>; // agentId -> messages.length when it last read
  filesSent?: Record<string, string[]>; // agentId -> the team files it has been given
}

/** A message before post() gives it an id and a time. */
interface NewMessage {
  from: string;
  text: string;
  mentions?: string[];
  replyTo?: string | null;
  attachments?: string[];
  turn?: TeamMessage['turn'];
  relay?: TeamRelay;
}

interface QueueItem {
  agentId: string;
  msgIds: string[];
  returning: boolean;
  /** extra skills for this work (a routine's), passed on with every handoff it leads to */
  skills: string[];
  /** stopped by a message you sent while it worked: it takes that up next */
  steered?: boolean;
}

interface Runtime {
  queue: QueueItem[];
  running: Set<string>;
  episode: { turns: number; chatter?: number; brain?: number; relays?: number };
  stopped?: boolean;
  epoch: number; // bumped by stop and clear: turns started before then are dropped
  /** your /queue messages, posted one by one once nobody is working; heldIn: the project they were typed in */
  held: QueuedMessage[];
  heldIn?: string;
  route?: RouteFn | null;
  /** a held message is being posted */
  releasing?: boolean;
  /** @Brain messages waiting while the Brain answers another one (epoch: the thread they were written in) */
  brainQueue?: { msg: TeamMessage; epoch: number }[];
  /** the turns going now, by agent; and the ones cut off by Stop or the turn limit (what /resume picks up) */
  current?: Map<string, QueueItem>;
  interrupted?: QueueItem[];
  /** your /loop in this team */
  loop?: TeamLoop | null;
  /** each running turn, done once it has ended (a steer waits for the ones it stopped) */
  ends?: Map<string, Promise<void>>;
  /** a message sent while the team works is stopping the turns going now: nothing new starts meanwhile */
  steering?: boolean;
  /** those messages, one after the other (a second waits for the first to be posted) */
  steers?: Promise<unknown>;
}

interface TeamLoop extends LoopInfo {
  /** the project it was started in */
  project: string;
  attachments: string[];
  route: RouteFn | null;
  due: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** one of its messages went and the team hasn't gone quiet since */
  posted: boolean;
}

/** Picks the member who should answer when nobody is named and there is no lead (brain.pickMember). */
export type RouteFn = (text: string, members: (Agent | null)[]) => Promise<string | null | undefined>;

/** What the Brain does in team chats (irc.ts sets these): answer a message that mentions @Brain
 *  (the reply text, posted here as the Brain), look at a team that went quiet, and pick who in a team
 *  answers a question from another team when nobody there is named. */
export interface BrainHandlers {
  reply(team: Team, msg: TeamMessage): Promise<string | null>;
  idle(teamId: string, opts: { stopped: boolean }): void;
  route?: RouteFn;
}
let brainHandlers: BrainHandlers | null = null;
export function setBrainHandlers(h: BrainHandlers | null): void {
  brainHandlers = h;
}

export const mentionsBrain = (text: unknown): boolean => /(^|[^\w@])@brain\b/i.test(String(text || ''));

// ---------- team records ----------
// Older teams were step lists: their agents become the members.
export function normalize<T extends Team | null | undefined>(team: T): T {
  if (!team) return team;
  if (!Array.isArray(team.members)) {
    team.members = [...new Set((team.steps || []).filter((s) => s.type === 'agent' && s.agentId).map((s) => s.agentId as string))];
  }
  team.members = team.members.filter((id) => agents.get(id));
  if (team.lead && !team.members.includes(team.lead)) team.lead = null;
  return team;
}

export function getTeam(id: string | null | undefined): Team | null {
  return normalize(teamStore.get(id));
}

export function listTeams(): Team[] {
  return teamStore.list().map(normalize);
}

export { isStepList, teamSteps };

// ---------- the shared thread ----------
// pid: the project the chat belongs to (the active one unless a turn outlived a project switch)
function chatFile(teamId: string, pid = activeProject().id): string {
  if (!teamId || /[\\/]/.test(teamId)) throw new Error('No such team.');
  return dataPath('projects', pid, 'teamchats', `${teamId}.json`);
}
function loadChat(teamId: string, pid?: string): TeamChat {
  return readJSON<TeamChat>(chatFile(teamId, pid), { messages: [], sessions: {}, seen: {} });
}
function saveChat(teamId: string, c: TeamChat, pid?: string) {
  if (c.messages.length > KEEP_MESSAGES) {
    const cut = c.messages.length - KEEP_MESSAGES;
    c.messages = c.messages.slice(cut);
    for (const k of Object.keys(c.seen)) c.seen[k] = Math.max(0, c.seen[k] - cut);
  }
  writeJSON(chatFile(teamId, pid), c);
}

// ---------- who is working ----------
// Kept per project: a copied project has the same team ids, but its teams are other teams.
const rt = new Map<string, Runtime>(); // `<project id>/<team id>` -> { queue: [{agentId, msgIds}], running: Set, episode: {turns}, stopped }
function runtime(teamId: string, pid = activeProject().id): Runtime {
  const key = `${pid}/${teamId}`;
  if (!rt.has(key)) rt.set(key, { queue: [], running: new Set(), episode: { turns: 0 }, epoch: 0, held: [] });
  return rt.get(key)!;
}
/** What a team's turns run under (Stop stops this project's ones only). */
const teamRunId = (teamId: string) => `team:${activeProject().id}/${teamId}`;
/** fn, and everything it awaits or starts, in the project it started in (not one opened meanwhile). */
const here = <T>(fn: () => T): T => withProject(activeProject(), fn);

export function teamState(teamId: string): TeamState {
  const r = runtime(teamId);
  return { working: [...r.running], queued: [...new Set(r.queue.map((q) => q.agentId))], held: [...r.held], loop: loopInfo(r.loop), resumable: !!r.interrupted?.length };
}

export function getThread(teamId: string, limit = 200): TeamState & { messages: TeamMessage[]; sessions: Record<string, string> } {
  const c = loadChat(teamId);
  // (each agent's own session for this team: where a working agent's turn streams from)
  return { messages: c.messages.slice(-limit), ...teamState(teamId), sessions: { ...c.sessions } };
}

function post(team: Team, msg: NewMessage): TeamMessage {
  const c = loadChat(team.id);
  const full: TeamMessage = { id: uid('m'), ts: Date.now(), mentions: [], ...msg };
  c.messages.push(full);
  saveChat(team.id, c);
  emit('team', { teamId: team.id, event: { kind: 'message', message: full } });
  return full;
}

const state = (team: Team) => emit('team', { teamId: team.id, event: { kind: 'state', ...teamState(team.id) } });

// @Name (exact member names, longest first), plus @everyone / @all / @team.
export function parseMentions(team: Team, text: unknown, exclude: string | null = null): string[] {
  const t = String(text || '');
  const found = new Set<string>();
  if (/(^|\s)@(everyone|all|team)\b/i.test(t)) team.members.forEach((id) => found.add(id));
  const named = team.members.map((id) => agents.get(id))
    .filter((a): a is Agent => Boolean(a))
    .sort((a, b) => b.name.length - a.name.length);
  // longest names first, and each match is taken out, so "@Trend Scout" doesn't also count as "@Trend"
  let rest = t;
  for (const a of named) {
    const esc = a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\w@])@${esc}(?![\\w])`, 'gi');
    if (re.test(rest)) {
      found.add(a.id);
      rest = rest.replace(re, '$1');
    }
  }
  if (exclude) found.delete(exclude);
  return [...found];
}

// ---------- you (or the Brain) write in the team chat ----------
interface PostOptions {
  replyTo?: string | null;
  route?: RouteFn | null;
  /** given to every member for the work this message starts (a routine's skills) */
  skills?: string[];
  attachments?: string[];
  /** who takes it when it names nobody and replies to nobody (the agents a steer stopped) */
  to?: string[];
  /** stops it before anyone starts on it (a routine that was stopped) */
  signal?: AbortSignal;
}

export function postUserMessage(teamId: string, text: string | null | undefined, opts: PostOptions = {}): Promise<TeamMessage> {
  return postAndRoute(teamId, 'user', text, opts);
}

/** The Brain hands the team work (or follows up on it), as itself. */
export function postBrainMessage(teamId: string, text: string | null | undefined, opts: PostOptions = {}): Promise<TeamMessage> {
  return postAndRoute(teamId, BRAIN, text, opts);
}

// from: you, the Brain, or another team (`team:<id>`, with relay saying who there asked)
function postAndRoute(teamId: string, from: string, text: string | null | undefined, opts: PostOptions & { relay?: TeamRelay }): Promise<TeamMessage> {
  // (picking who answers can take a while: it goes on in this project even if you open another)
  return here(() => routeMessage(teamId, from, text, opts));
}

async function routeMessage(teamId: string, from: string, text: string | null | undefined, { replyTo = null, route = null, skills = [], attachments = [], relay, to = [], signal }: PostOptions & { relay?: TeamRelay }): Promise<TeamMessage> {
  if (signal?.aborted) throw new RunStopped();
  const team = getTeam(teamId);
  if (!team) throw new Error('No such team.');
  if (!team.members.length) throw new Error('This team has no agents yet. Add some first.');
  text = String(text || '').trim();
  if (!text && !attachments.length) throw new Error('Write something first.');
  const mentions = parseMentions(team, text);
  const msg = post(team, { from, text, mentions, replyTo, ...(attachments.length ? { attachments } : {}), ...(relay ? { relay } : {}) });
  const r = runtime(team.id);
  r.episode = { turns: 0 }; // a new message from you gives the team a fresh budget
  r.stopped = false;
  r.interrupted = undefined; // (new work: what was cut off before is not picked up again)
  // you asked the Brain: it answers in the thread, and nobody else starts unless you named them
  const askBrain = from === 'user' && mentionsBrain(text);
  if (askBrain) void brainTurn(team, msg);
  // you named other teams (#Team Name): it goes to them, and here only to whoever you named
  const named = from === 'user' ? teamsNamed(team, text) : [];
  const asked = named.length ? askTeams(team, msg, named, from) : [];
  let targets = mentions;
  let why = '';
  if (!targets.length && (askBrain || asked.length || named.length)) {
    log('team', `You → ${askBrain ? 'the Brain' : asked.map((id) => `#${getTeam(id)?.name}`).join(', ') || 'other teams'} in ${team.name}: ${text.slice(0, 100)}`);
    return msg;
  }
  if (!targets.length && replyTo) {
    const parent = loadChat(team.id).messages.find((m) => m.id === replyTo);
    if (parent && team.members.includes(parent.from)) targets = [parent.from];
  }
  if (!targets.length) targets = to.filter((id) => team.members.includes(id));
  if (!targets.length && text) {
    // it needs a service only one member has (GitHub, Blender, posting on X…): that member
    const sole = soleHolder(text, team.members.map((id) => agents.get(id)).filter((a): a is Agent => Boolean(a)));
    if (sole) {
      targets = [sole.id];
      why = `the only one with ${sole.service}`;
    }
  }
  if (!targets.length && team.lead) {
    targets = [team.lead];
    why = 'the lead';
  }
  if (!targets.length) {
    // files only: route on their names
    const epoch = r.epoch;
    const pick = route ? await route(text || `(attached: ${attachmentNames(attachments)})`, team.members.map((id) => agents.get(id))).catch(() => null) : null;
    // stopped while it picked: nobody starts on it
    if (signal?.aborted) {
      post(team, { from: 'system', text: 'Stopped before anyone started on it.' });
      throw new RunStopped();
    }
    if (r.epoch !== epoch || r.stopped) return msg;
    targets = [pick && team.members.includes(pick) ? pick : team.members[0]];
    why = pick ? 'best fit' : 'first member';
  }
  for (const id of targets) enqueue(team, id, msg.id, true, false, skills);
  if (why) emit('team', { teamId: team.id, event: { kind: 'routed', to: targets, why } });
  log('team', `${relay ? `#${relay.teamName}` : from === BRAIN ? 'The Brain' : 'You'} → ${team.name}: ${(text || attachmentNames(attachments)).slice(0, 100)}`);
  return msg;
}

// ---------- #Team: asking another team ----------
// A question to another team is posted in its chat (from `team:<asker>`) and routed there like a message
// from you. When that team goes quiet, its last reply goes back to the asking team, to whoever asked.
interface Relay {
  /** the team that asked, and the one asked */
  from: string;
  to: string;
  /** who asked: an agent id, or 'user' */
  by: string;
  /** the question in the asking thread, and where it was posted in the other one */
  askId: string;
  postedId: string;
  pid: string;
  /** teams asking teams: 1 for a question from a team nobody asked */
  depth: number;
  /** the asker's turn was a handoff coming back, and the skills for its work: kept for its next turn */
  returning: boolean;
  skills: string[];
}
const relays: Relay[] = [];

const askable = (t: Team) => t.members.length > 0 && !isStepList(t);
/** The other teams this one can ask (#Team Name), for its chat. */
export function otherTeams(teamId: string): TeamRef[] {
  return listTeams()
    .filter((t) => t.id !== teamId && askable(t))
    .map((t) => ({ id: t.id, name: t.name, description: t.description || '', ...(t.color ? { color: t.color } : {}), ...(t.mark ? { mark: t.mark } : {}) }));
}
const teamsNamed = (team: Team, text: unknown) => parseTeamRefs(text, listTeams().filter(askable), team.id);
const nameOf = (id: string) => (id === 'user' ? 'the user' : id === BRAIN ? 'the Brain' : agents.get(id)?.name || 'someone');
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Ask the teams a message names. by: who wrote it. Returns the teams it went to. */
function askTeams(team: Team, msg: TeamMessage, ids: string[], by: string, { returning = false, skills = [] }: { returning?: boolean; skills?: string[] } = {}): string[] {
  const r = runtime(team.id);
  const pid = activeProject().id;
  // how deep this team's work already is in questions between teams
  const depth = 1 + Math.max(0, ...relays.filter((x) => x.pid === pid && x.to === team.id).map((x) => x.depth));
  const sent: string[] = [];
  const refused: string[] = [];
  const why: string[] = [];
  for (const id of ids) {
    const to = getTeam(id);
    if (!to) continue;
    // they asked this team: naming them is the answer, and that goes back by itself once this team is done
    if (by !== 'user' && relays.some((x) => x.pid === pid && x.from === to.id && x.to === team.id)) continue;
    // they wait (through other teams) on this one: asking them would leave both waiting for good
    if (waitsOn(pid, to.id, team.id)) {
      why.push(`Not sent to #${to.name}: it is waiting on this team's answer. Answer here instead.`);
      continue;
    }
    if (depth > MAX_RELAY_DEPTH || (r.episode.relays || 0) >= MAX_RELAYS) {
      refused.push(`#${to.name}`);
      continue;
    }
    r.episode.relays = (r.episode.relays || 0) + 1;
    sent.push(to.id);
    // (kept from now on, so this team doesn't count as done while the question is on its way;
    // a second question while the first is open joins it: one answer comes back)
    let x = relays.find((y) => y.pid === pid && y.from === team.id && y.to === to.id);
    const joins = !!x;
    if (!x) relays.push((x = { from: team.id, to: to.id, by, askId: msg.id, postedId: '', pid, depth, returning, skills: [...skills] }));
    const relay: TeamRelay = { teamId: team.id, teamName: team.name, by, byName: nameOf(by) };
    const open = x;
    postAndRoute(to.id, teamFrom(team.id), msg.text, { relay, attachments: msg.attachments || [], route: brainHandlers?.route || null })
      .then((posted) => {
        if (!joins) open.postedId = posted.id;
        log('team', `${team.name} asked ${to.name}`);
      })
      .catch((e: unknown) => {
        if (!joins && relays.includes(open)) relays.splice(relays.indexOf(open), 1);
        post(team, { from: 'system', text: `Couldn't ask #${to.name}: ${errText(e)}` });
      });
  }
  if (refused.length) {
    why.push(`Not sent to ${refused.join(', ')}: ${depth > MAX_RELAY_DEPTH ? `teams are already asking teams ${MAX_RELAY_DEPTH} deep. Answer here instead.` : `this team asked other teams ${MAX_RELAYS} times on this. Write in the chat to keep going.`}`);
  }
  for (const line of why) post(team, { from: 'system', text: line });
  return sent;
}

// Does team `a` wait for an answer from team `b` (in project pid), directly or through teams it asked?
function waitsOn(pid: string, a: string, b: string): boolean {
  const seen = new Set<string>();
  const next = [a];
  while (next.length) {
    const cur = next.pop()!;
    for (const x of relays) {
      if (x.pid !== pid || x.from !== cur || seen.has(x.to)) continue;
      if (x.to === b) return true;
      seen.add(x.to);
      next.push(x.to);
    }
  }
  return false;
}

// A team went quiet: the questions other teams asked it get its answer (its last reply since), unless it
// still waits on a team it asked itself.
function answerRelays(teamId: string, stopped: boolean) {
  // (a question still on its way there isn't in its chat yet)
  const pid = activeProject().id;
  const waiting = relays.filter((x) => x.pid === pid && x.to === teamId && x.postedId);
  if (!waiting.length || (!stopped && relays.some((x) => x.pid === pid && x.from === teamId))) return;
  const team = getTeam(teamId);
  const thread = team ? loadChat(teamId).messages : [];
  for (const x of waiting) {
    relays.splice(relays.indexOf(x), 1);
    const asker = getTeam(x.from);
    // (its project isn't open now)
    if (!team || !asker || openProject().id !== pid) continue;
    const at = thread.findIndex((m) => m.id === x.postedId);
    const answer = at < 0 ? undefined : thread.slice(at + 1).findLast((m) => m.from === BRAIN || team.members.includes(m.from));
    if (stopped || !answer) {
      post(asker, { from: 'system', text: `#${team.name} ${stopped ? 'was stopped before it answered' : 'finished without an answer'}.` });
      continue;
    }
    const text = answer.text.length > ANSWER_CHARS ? `${answer.text.slice(0, ANSWER_CHARS)}…` : answer.text;
    const out = post(asker, {
      from: teamFrom(team.id),
      text,
      replyTo: x.askId,
      ...(answer.attachments?.length ? { attachments: answer.attachments } : {}),
      relay: { teamId: team.id, teamName: team.name, by: answer.from, byName: nameOf(answer.from), answers: x.askId },
    });
    log('team', `${team.name} answered ${asker.name}`);
    // the agent that asked picks it up (you read it yourself)
    if (asker.members.includes(x.by)) enqueue(asker, x.by, out.id, false, x.returning, x.skills);
  }
}

// Questions from a team that was stopped or cleared: no answer is wanted any more. Cleared: the
// questions it was asked are gone too, and the teams that asked hear so.
function dropRelays(teamId: string, { cleared }: { cleared: boolean }) {
  const pid = activeProject().id;
  for (const x of [...relays]) {
    if (x.pid !== pid || (x.from !== teamId && !(cleared && x.to === teamId))) continue;
    relays.splice(relays.indexOf(x), 1);
    const asker = x.to === teamId ? getTeam(x.from) : null;
    if (asker) post(asker, { from: 'system', text: `#${getTeam(teamId)?.name || 'That team'}'s chat was cleared before it answered.` });
  }
}

// The Brain answers a message that mentions @Brain, in the thread. Its answer goes to whoever it names,
// else back to the agent that asked. One answer at a time; a few per message you send.
async function brainTurn(team: Team, msg: TeamMessage): Promise<void> {
  const r = runtime(team.id);
  if (!brainHandlers) return;
  if (r.running.has(BRAIN)) {
    r.brainQueue = [...(r.brainQueue || []), { msg, epoch: r.epoch }];
    return;
  }
  const n = r.episode.brain || 0;
  if (n >= MAX_BRAIN_REPLIES) {
    post(team, { from: 'system', text: `The Brain has answered ${n} times on this. Write in the chat to keep going.` });
    return;
  }
  r.episode.brain = n + 1;
  const epoch = r.epoch;
  const pid = activeProject().id;
  r.running.add(BRAIN);
  state(team);
  let reply: string | null = null;
  try {
    reply = await brainHandlers.reply(team, msg);
  } catch (e) {
    reply = `(The Brain couldn't answer: ${(e as Error).message})`;
  } finally {
    r.running.delete(BRAIN);
  }
  // stopped, cleared or another project opened meanwhile: the answer is no longer wanted here
  if (reply && r.epoch === epoch && !r.stopped && openProject().id === pid) {
    const fresh = getTeam(team.id) || team;
    const mentions = parseMentions(fresh, reply);
    const out = post(fresh, { from: BRAIN, text: reply, mentions, replyTo: msg.id });
    for (const id of mentions) enqueue(fresh, id, out.id, false, false);
    if (!mentions.length && fresh.members.includes(msg.from)) enqueue(fresh, msg.from, out.id, false, true);
  }
  state(team);
  // (this answer may be for a thread cleared meanwhile: the @Brain messages written since still go next)
  r.brainQueue = (r.brainQueue || []).filter((q) => q.epoch === r.epoch);
  const next = r.stopped ? undefined : r.brainQueue.shift();
  if (next) return brainTurn(getTeam(team.id) || team, next.msg);
  r.brainQueue = [];
  settled(team.id);
}

// Nobody works and nothing waits: the Brain may look at what the team did.
function settled(teamId: string, stopped = false) {
  const r = runtime(teamId);
  if (r.running.size || r.queue.length || r.steering) return;
  // teams that asked this one get its answer
  answerRelays(teamId, stopped || !!r.stopped);
  try {
    brainHandlers?.idle(teamId, { stopped: stopped || !!r.stopped });
  } catch {
    /* the Brain's problem is not the team's */
  }
  // your next /queue message goes now (the Brain's check of the work then waits for it), then the loop's
  releaseHeld(teamId);
  loopSettled(teamId);
}

// returning: this is a finished handoff coming back (the receiver's own reply won't bounce back again)
// skills: extra skills for the work this message is about (merged when a queued turn takes on more messages)
function enqueue(team: Team, agentId: string, msgId: string, priority = false, returning = false, skills: readonly string[] = []) {
  const r = runtime(team.id);
  const existing = r.queue.find((q) => q.agentId === agentId);
  if (existing) {
    existing.msgIds.push(msgId);
    existing.returning = existing.returning && returning;
    existing.skills = [...new Set([...existing.skills, ...skills])];
  } else if (priority) r.queue.unshift({ agentId, msgIds: [msgId], returning, skills: [...skills] });
  else r.queue.push({ agentId, msgIds: [msgId], returning, skills: [...skills] });
  state(team);
  pump(team.id);
}

// Start a turn for every queued agent that isn't already working (one turn at a time per agent).
function pump(teamId: string) {
  const r = runtime(teamId);
  if (r.stopped || r.steering) return;
  const project = activeProject();
  if (r.queue.length && openProject().id !== project.id) {
    // another project is open now: nothing new starts here (/resume picks it up once you're back)
    r.interrupted = [...(r.interrupted || []), ...r.queue];
    r.queue = [];
    return;
  }
  for (const item of [...r.queue]) {
    if (r.running.has(item.agentId)) continue;
    r.queue.splice(r.queue.indexOf(item), 1);
    const team = getTeam(teamId);
    if (!team || !team.members.includes(item.agentId)) continue;
    // stop runaway back-and-forth: agents handing it around without doing anything
    if ((r.episode.chatter || 0) >= MAX_CHATTER) {
      // (/resume picks these up again, with a fresh budget)
      r.interrupted = [item, ...r.queue];
      r.queue = [];
      post(team, { from: 'system', text: `Paused: the last ${r.episode.chatter} replies were only talk, with no work done. Reply to keep going, or mention someone to continue.` });
      state(team);
      return;
    }
    r.episode.turns++;
    r.running.add(item.agentId);
    (r.current ||= new Map()).set(item.agentId, item);
    state(team);
    // (the turn and what follows it stay in this project, even if you open another meanwhile)
    const end: Promise<void> = withProject(project, () =>
      runTurn(team, item).finally(() => {
        r.running.delete(item.agentId);
        if (r.current?.get(item.agentId) === item) r.current.delete(item.agentId);
        if (r.ends?.get(item.agentId) === end) r.ends.delete(item.agentId);
        state(team);
        pump(teamId);
        settled(teamId);
      }),
    );
    (r.ends ||= new Map()).set(item.agentId, end);
  }
}

export function briefing(team: Team, agent: Agent): string {
  const roster = team.members
    .map((id) => agents.get(id))
    .filter((a): a is Agent => Boolean(a))
    .map((a) => {
      const services = servicesOf(a);
      return `- @${a.name}${a.id === team.lead ? ' (lead)' : ''}${a.id === agent.id ? ' (you)' : ''}: ${a.specialty || a.description || ''}${services.length ? ` (has ${services.join(', ')})` : ''}`;
    })
    .join('\n');
  const others = otherTeams(team.id);
  const teamsNote = others.length
    ? `\n\nOther teams in this project:\n${others.map((t) => `- #${t.name}${t.description ? `: ${t.description}` : ''}`).join('\n')}

Talking to other teams:
- To ask another team for something that is their work, write #Team Name in your reply (exactly as above) and say precisely what you need back. Your message goes to their chat, and their answer comes back here to you once they are done.
- A message from another team (#Name asks your team) is a request: handle it like one from the user. When your team is done, its last reply goes back to them by itself.`
    : '';
  // a team that builds in the voxel world: everyone on it (not only the builders) knows what that world is
  const builds = team.members.some((id) => agents.get(id)?.toolGroups?.includes('world'));
  return `You are in the team chat "${team.name}".${team.description ? `\nTeam goal: ${team.description}` : ''}
Team members:
${roster}${teamsNote}${builds ? `\n\nThis team builds in the voxel world. ${DIORAMA}\n${BUILD_ORDER} Plan and hand out the work in that order.` : ''}

How this chat works:
- Everyone sees the whole thread. Your reply is posted to the team as a message from you.
- To hand work to a teammate, mention them exactly as @Name and say precisely what you need back. Only mention someone who needs to act now; each stage should have one owner.
- Do your own part fully before handing off. Don't redo work a teammate owns.
- A task you hand to a teammate is theirs: don't also do it yourself, and don't give the same task to two people. Work that needs something only one member has (see "has" above) goes to that member.
- Anything that needs the user's judgment or help, or that only they can unblock: ask them with ask_user (with short choices to click), not only in your reply, and don't mention a teammate for it.
- The Brain (the project's overseer) hands the team work and checks on it. To ask it something (about the project, other teams, what to do next) or to say you're stuck, write @Brain.
- Keep replies short: what you did, the result, and who acts next.${team.lead === agent.id ? '\n- You are the lead: break the request down, give each part to one owner, and when everyone is done post the combined result for the user.' : ''}`;
}

async function runTurn(team: Team, item: QueueItem) {
  const agent = agents.get(item.agentId);
  if (!agent) return;
  const pid = activeProject().id;
  const epoch = runtime(team.id).epoch;
  const c = loadChat(team.id);
  // the agent's own memory of this team: one chat session per agent per team
  let chatId = c.sessions[agent.id];
  if (!chatId || !chats.get(agent.id, chatId)) {
    chatId = chats.create(agent.id, `Team: ${team.name}`, team.id).id;
    c.sessions[agent.id] = chatId;
  }
  const first = c.seen[agent.id] == null;
  const fresh = c.messages.slice(c.seen[agent.id] || 0).filter((m) => m.from !== agent.id);
  const name = (m: TeamMessage) => {
    const id = m.from;
    if (m.relay) return m.relay.answers ? `#${m.relay.teamName} answered (${m.relay.byName} there)` : `#${m.relay.teamName} asks your team (${m.relay.byName} there)`;
    return id === 'user' ? 'You (the user)' : id === 'system' ? 'System' : id === BRAIN ? 'The Brain (overseer)' : `@${agents.get(id)?.name || 'someone'}`;
  };
  // files attached to a message: named in the line, their paths come at the end of the prompt
  const said = (m: TeamMessage) => `${name(m)}: ${String(m.text).slice(0, 2500)}${m.attachments?.length ? ` [attached: ${attachmentNames(m.attachments)}]` : ''}`;
  let digest = '';
  for (const m of fresh.slice().reverse()) {
    const line = said(m);
    if (digest.length + line.length > CONTEXT_CHARS) break;
    digest = `${line}\n\n${digest}`;
  }
  const forYou = c.messages.filter((m) => item.msgIds.includes(m.id)).map(said).join('\n\n');
  // the team's files go to the engine once per agent (so models that can't open files get them too), new ones when added;
  // plus what the user attached since this agent last read
  // (only this project's uploads: a team or thread restored from a saved folder or backup could name any file on the PC)
  const teamFiles = cleanAttachments(team.files);
  const given = new Set(c.filesSent?.[agent.id] || []);
  const newTeamFiles = teamFiles.filter((f) => !given.has(f));
  const attachments = cleanAttachments([...new Set([...newTeamFiles, ...[...fresh, ...c.messages.filter((m) => item.msgIds.includes(m.id))].flatMap((m) => m.attachments || [])])]);
  c.seen[agent.id] = c.messages.length;
  c.filesSent = { ...c.filesSent, [agent.id]: teamFiles };
  saveChat(team.id, c);
  const filesNote = newTeamFiles.length
    ? `The team's reference files from the user (${attachmentNames(newTeamFiles)}) are attached at the end.\n\n`
    : teamFiles.length ? `The team's files: ${teamFiles.join(', ')}\n\n` : '';
  const prompt = `${first ? `${briefing(team, agent)}\n\n` : ''}${filesNote}New in the team chat since you last spoke:\n\n${digest.trim() || '(nothing new)'}\n\n---\nAddressed to you:\n${forYou}\n\nDo your part now, then reply to the team.`;
  // (where this turn starts in the agent's session: the team chat shows its work, live and afterwards)
  const from = chats.get(agent.id, chatId)?.items.length ?? 0;
  emit('team', { teamId: team.id, event: { kind: 'turn', agentId: agent.id, state: 'start', chatId } });
  let text = '';
  let stopped = false;
  try {
    text = await askAgent(agent, prompt, { depth: 1, from: `team ${team.name}`, chatId, parentRunId: teamRunId(team.id), extra: { ...(team.access || {}), skills: [...new Set([...(team.skills || []), ...item.skills])] }, attachments });
  } catch (e) {
    // you stopped this agent's turn: say so in the thread, and hand nothing on
    stopped = e instanceof RunStopped;
    // (stopped by a new message from you: it picks that up next, with what it did so far)
    text = stopped ? (item.steered ? '(stopped to take your new message)' : '(stopped)') : `(I hit a problem: ${(e as Error).message})`;
  }
  const r = runtime(team.id);
  if (r.stopped || r.epoch !== epoch) {
    // stopped or cleared meanwhile: if cleared, don't let this turn bring the agent's session back
    if (loadChat(team.id, pid).sessions[agent.id] !== chatId) chats.remove(agent.id, chatId);
    return;
  }
  if (openProject().id !== pid) {
    // you switched projects while it worked: keep the reply in its own project, start nothing new there
    const back = loadChat(team.id, pid);
    const to = chats.get(agent.id, chatId)?.items.length ?? from;
    back.messages.push({ id: uid('m'), ts: Date.now(), from: agent.id, text: text || '(no answer)', mentions: [], ...(to > from ? { turn: { chatId, from, to } } : {}) });
    saveChat(team.id, back, pid);
    return;
  }
  const mentions = parseMentions(team, text, agent.id);
  const to = chats.get(agent.id, chatId)?.items.length ?? from;
  const msg = post(team, { from: agent.id, text: text || '(no answer)', mentions, ...(to > from ? { turn: { chatId, from, to } } : {}) });
  const worked = text.length >= CHATTER_CHARS || (chats.get(agent.id, chatId)?.items.slice(from, to) || []).some((i) => i.type === 'tool');
  r.episode.chatter = worked ? 0 : (r.episode.chatter || 0) + 1;
  // (its read mark stays where this turn started: what others wrote meanwhile is new to it next turn;
  // its own reply is left out of that by itself)
  emit('team', { teamId: team.id, event: { kind: 'turn', agentId: agent.id, state: 'end' } });
  if (stopped) return;
  for (const id of mentions) if (team.members.includes(id)) enqueue(team, id, msg.id, false, false, item.skills);
  // it asked the Brain: the Brain's answer comes back to it
  const askedBrain = mentionsBrain(text);
  if (askedBrain) void brainTurn(team, msg);
  // it asked other teams (#Team Name): their answers come back to it
  const named = teamsNamed(team, text);
  const askedTeams = named.length > 0 && askTeams(team, msg, named, agent.id, { returning: item.returning, skills: item.skills }).length > 0;
  // A handed-off job is done and nobody new is named: the answer goes back to the lead (or whoever asked), once.
  if (!mentions.length && !askedBrain && !askedTeams && !item.returning && agent.id !== team.lead) {
    const asked = c.messages.filter((m) => item.msgIds.includes(m.id) && m.from !== 'user' && m.from !== 'system' && m.from !== BRAIN && !fromTeam(m.from)).map((m) => m.from);
    const back = team.lead && team.lead !== agent.id ? team.lead : asked.find((id) => id !== agent.id);
    if (asked.length && back && team.members.includes(back)) enqueue(team, back, msg.id, false, true, item.skills);
  }
}

// ---------- steering: your message while the team works ----------
/** How long a steer waits for the turns it stopped to end before posting anyway. */
const STEER_WAIT_MS = 10_000;

/** A message sent while the team works changes its course: the turns going now stop, and whoever was
 *  working picks it up next (with what they did so far in their session), unless it names someone.
 *  Your /queue messages keep waiting. Nobody working: an ordinary message. */
export function steerTeam(teamId: string, text: string | null | undefined, opts: PostOptions = {}): Promise<TeamMessage> {
  return here(() => steerIn(teamId, text, opts));
}

function steerIn(teamId: string, text: string | null | undefined, opts: PostOptions): Promise<TeamMessage> {
  const team = getTeam(teamId);
  if (!team) return Promise.reject(new Error('No such team.'));
  const r = runtime(team.id);
  const mine = (r.steers || Promise.resolve()).then(() => steerNow(team, text, opts));
  const tail = mine.then(
    () => {},
    () => {},
  );
  r.steers = tail;
  void tail.then(() => r.steers === tail && (r.steers = undefined));
  return mine;
}

async function steerNow(team: Team, text: string | null | undefined, opts: PostOptions): Promise<TeamMessage> {
  const r = runtime(team.id);
  const working = [...r.running].filter((id) => team.members.includes(id));
  // (checked before anything stops: an empty message mustn't cut the work off)
  if (!working.length || (!String(text || '').trim() && !opts.attachments?.length)) return postUserMessage(team.id, text, opts);
  const sessions = loadChat(team.id).sessions;
  r.steering = true;
  try {
    for (const id of working) {
      const turn = r.current?.get(id);
      if (turn) turn.steered = true;
      if (sessions[id]) stopChat(sessions[id]);
    }
    // their "(stopped…)" replies land before your message, so the thread reads in order
    await settledWithin(
      working.map((id) => r.ends?.get(id)),
      STEER_WAIT_MS,
    );
  } finally {
    r.steering = false;
  }
  try {
    return await postAndRoute(team.id, 'user', text, { ...opts, to: working });
  } finally {
    // (whatever waited while the turns ended goes on now)
    pump(team.id);
    settled(team.id);
  }
}

// ---------- /queue: your messages that wait until the team is done ----------
const idle = (r: Runtime) => !r.running.size && !r.queue.length && !r.releasing && !r.steering;

/** Post now if nobody is working, else once the whole team is done (one held message at a time). */
export async function queueUserMessage(teamId: string, text: string | null | undefined, { replyTo = null, route = null, attachments = [] }: { replyTo?: string | null; route?: RouteFn | null; attachments?: string[] } = {}): Promise<{ message: TeamMessage } | { queued: QueuedMessage }> {
  const team = getTeam(teamId);
  if (!team) throw new Error('No such team.');
  if (!team.members.length) throw new Error('This team has no agents yet. Add some first.');
  text = String(text || '').trim();
  if (!text && !attachments.length) throw new Error('Write the message after /queue.');
  const r = runtime(team.id);
  if (idle(r) && !r.held.length) return { message: await postUserMessage(team.id, text, { replyTo, route, attachments }) };
  const queued: QueuedMessage = { id: uid('q'), text, ...(attachments.length ? { attachments } : {}), ...(replyTo ? { replyTo } : {}), ts: Date.now() };
  r.held.push(queued);
  r.heldIn = activeProject().id;
  r.route = route;
  state(team);
  return { queued };
}

/** Take back one held message (id), or all of them. Returns what was taken. */
export function unqueueTeam(teamId: string, id?: string): QueuedMessage[] {
  const r = runtime(teamId);
  const taken = id ? r.held.filter((q) => q.id === id) : r.held;
  r.held = id ? r.held.filter((q) => q.id !== id) : [];
  const team = getTeam(teamId);
  if (taken.length && team) state(team);
  return taken;
}

/** Change the text of a held message (before it is posted). null: it already went. */
export function editQueuedTeam(teamId: string, id: string, text: unknown): QueuedMessage | null {
  const team = getTeam(teamId);
  if (!team) throw new Error('No such team.');
  const r = runtime(team.id);
  const q = r.held.find((x) => x.id === id);
  if (!q) return null;
  q.text = queuedEdit(text, !!q.attachments?.length);
  state(team);
  return q;
}

/** Put the held messages in this order (ids it doesn't name keep their place after the ones it does). */
export function orderQueuedTeam(teamId: string, ids: unknown): QueuedMessage[] {
  const team = getTeam(teamId);
  if (!team) throw new Error('No such team.');
  const r = runtime(team.id);
  r.held = reorderQueued(r.held, ids);
  state(team);
  return r.held;
}

// Nobody is working any more: post the next held message.
function releaseHeld(teamId: string) {
  const r = runtime(teamId);
  if (!r.held.length || !idle(r) || r.stopped) return;
  const team = getTeam(teamId);
  // (typed in another project: that project's thread isn't open now)
  if (!team || r.heldIn !== openProject().id) {
    r.held = [];
    if (team) state(team);
    return;
  }
  const next = r.held.shift()!;
  r.releasing = true;
  here(() =>
    postUserMessage(team.id, next.text, { replyTo: next.replyTo || null, route: r.route, attachments: next.attachments || [] })
      .catch((e: unknown) => log('error', `${team.name}: a queued message couldn't be sent: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        r.releasing = false;
        state(team);
        releaseHeld(teamId);
        fireLoop(teamId);
      }),
  );
}

// ---------- /resume, /resend ----------
/** Start again the turns that Stop or the turn limit cut off (with a fresh budget). Returns how many. */
export function resumeTeam(teamId: string): number {
  const team = getTeam(teamId);
  if (!team) throw new Error('No such team.');
  const r = runtime(team.id);
  const items = (r.interrupted || []).filter((q) => team.members.includes(q.agentId));
  r.interrupted = undefined;
  if (!items.length) return 0;
  r.stopped = false;
  r.episode = { turns: 0 };
  for (const it of items) {
    const existing = r.queue.find((q) => q.agentId === it.agentId);
    if (existing) existing.msgIds = [...new Set([...existing.msgIds, ...it.msgIds])];
    else r.queue.push({ ...it, msgIds: [...it.msgIds] });
  }
  const names = [...new Set(items.map((q) => agents.get(q.agentId)?.name).filter(Boolean))];
  post(team, { from: 'system', text: `Resumed: ${names.join(', ')} pick${names.length === 1 ? 's' : ''} up where they left off.` });
  log('team', `You resumed ${team.name}`);
  state(team);
  pump(team.id);
  return items.length;
}

/** Your last message in the team chat (what /resend sends again). */
export function lastUserMessage(teamId: string): TeamMessage | null {
  return loadChat(teamId).messages.findLast((m) => m.from === 'user') || null;
}

/** A line from the dashboard in the thread (the agents see it too). */
export function postSystem(teamId: string, text: string): void {
  const team = getTeam(teamId);
  if (team) post(team, { from: 'system', text });
}

// ---------- /loop: your message posted again and again ----------
// A timed loop posts every so often (a due one waits until nobody is working); the other kind posts
// again once the team has gone quiet after the last one. Held /queue messages go first.
const loopInfo = (l: TeamLoop | null | undefined): LoopInfo | null => (l ? { text: l.text, every: l.every, times: l.times, done: l.done, next: l.next } : null);

export function startTeamLoop(teamId: string, req: LoopRequest, { attachments = [], route = null }: { attachments?: string[]; route?: RouteFn | null } = {}): LoopInfo {
  const team = getTeam(teamId);
  if (!team) throw new Error('No such team.');
  if (!team.members.length) throw new Error('This team has no agents yet. Add some first.');
  stopTeamLoop(team.id, null);
  const r = runtime(team.id);
  r.loop = { ...req, done: 0, next: null, project: activeProject().id, attachments, route, due: true, timer: null, posted: false };
  fireLoop(team.id);
  state(team);
  return loopInfo(r.loop)!;
}

/** End the team's loop. why: the line posted in the thread (null: none). */
export function stopTeamLoop(teamId: string, why: string | null): boolean {
  const r = runtime(teamId);
  const l = r.loop;
  if (!l) return false;
  if (l.timer) clearTimeout(l.timer);
  r.loop = null;
  const team = getTeam(teamId);
  if (team && why) post(team, { from: 'system', text: why });
  if (team) state(team);
  return true;
}

function fireLoop(teamId: string) {
  const r = runtime(teamId);
  const l = r.loop;
  if (!l || !l.due || !idle(r) || r.held.length) return;
  const team = getTeam(teamId);
  // (another project is open now: its threads are the ones in view)
  if (!team || l.project !== openProject().id) return void stopTeamLoop(teamId, null);
  l.due = false;
  l.done++;
  l.posted = true;
  l.next = null;
  r.releasing = true;
  postUserMessage(team.id, l.text, { route: l.route, attachments: l.attachments })
    .catch((e: unknown) => stopTeamLoop(teamId, `Loop ended: ${e instanceof Error ? e.message : String(e)}`))
    .finally(() => {
      r.releasing = false;
      state(team);
    });
  if (l.every != null && l.done < l.times) {
    l.next = Date.now() + l.every;
    const project = activeProject();
    l.timer = setTimeout(
      () =>
        withProject(project, () => {
          l.timer = null;
          l.due = true;
          fireLoop(teamId);
        }),
      l.every,
    );
    l.timer.unref?.();
  }
  state(team);
}

// The team went quiet: the loop's last message is answered. Done, or the next one (now, or when due).
function loopSettled(teamId: string) {
  const r = runtime(teamId);
  const l = r.loop;
  if (!l) return;
  if (l.posted) {
    l.posted = false;
    if (l.done >= l.times) return void stopTeamLoop(teamId, `Loop done: sent ${l.times} time${l.times > 1 ? 's' : ''}.`);
    if (l.every == null) l.due = true;
  }
  fireLoop(teamId);
}

/** Take an agent off the turns it waits for in this project's teams (it was stopped, so it doesn't start
 *  on the next one as soon as its turn ends). Returns how many it had. */
export function dropQueuedTurns(agentId: string): number {
  let n = 0;
  const prefix = `${activeProject().id}/`;
  for (const [key, r] of rt) {
    if (!key.startsWith(prefix)) continue; // another project's team
    const teamId = key.slice(prefix.length);
    const team = getTeam(teamId);
    if (!team) continue;
    const before = r.queue.length;
    r.queue = r.queue.filter((q) => q.agentId !== agentId);
    if (r.queue.length === before) continue;
    n += before - r.queue.length;
    state(team);
    settled(teamId);
  }
  return n;
}

export function stopTeam(teamId: string) {
  const team = getTeam(teamId);
  const r = runtime(teamId);
  r.stopped = true;
  r.epoch++;
  // what was going or waiting: /resume picks it up again
  const cut = [...(r.current?.values() || []), ...r.queue];
  if (cut.length) r.interrupted = cut;
  r.queue = [];
  r.held = [];
  stopTeamLoop(teamId, null);
  stopChildren(teamRunId(teamId));
  r.brainQueue = [];
  // (answers to what it asked other teams aren't wanted now; teams that asked it hear it was stopped)
  dropRelays(teamId, { cleared: false });
  if (team) post(team, { from: 'system', text: 'Stopped. Nothing new will start until you write again.' });
  if (team) state(team);
  settled(teamId, true);
  return true;
}

export function clearThread(teamId: string) {
  if (!getTeam(teamId)) throw new Error('No such team.');
  // drop queued work and turns still running, so nothing late lands in the empty thread
  const r = runtime(teamId);
  r.epoch++;
  r.queue = [];
  r.held = [];
  r.interrupted = undefined;
  stopTeamLoop(teamId, null);
  r.episode = { turns: 0 };
  stopChildren(teamRunId(teamId));
  dropRelays(teamId, { cleared: true });
  const c = loadChat(teamId);
  writeJSON(chatFile(teamId), { messages: [], sessions: {}, seen: {} });
  for (const [agentId, chatId] of Object.entries(c.sessions || {})) {
    forgetChat(chatId);
    chats.remove(agentId, chatId);
  }
  emit('team', { teamId, event: { kind: 'cleared' } });
}
