// Questions agents ask you (the ask_user tool): a choice to make, something only you know or can do,
// a place they are stuck. Each waits in the Outbox with its choices as buttons and a box for an answer
// in your own words. The agent waits a while for it; answered later, the answer goes to its chat (or
// its team chat) as a new message, so nothing you answer is lost.
import { agents, chats, questions, workflows, log, activeProject, withProject } from './store.ts';
import { uid } from './util.ts';
import type { AgentQuestion } from '../shared/types.ts';

export const MAX_CHOICES = 8;
/** How long ask_user waits for your answer before the agent ends its turn (approvals wait as long). */
export const WAIT_MS = 30 * 60_000;

export interface UserAnswer {
  choice?: string;
  text?: string;
}

/** How the wait ended. */
export type AskOutcome = { kind: 'answer'; choice: string; text: string } | { kind: 'dismissed' } | { kind: 'timeout' } | { kind: 'stopped' };

export interface AskInput {
  question: string;
  detail?: string;
  choices?: unknown;
  agentId?: string | null;
  chatId?: string | null;
  runId?: string | null;
}

// questions an agent is waiting on right now, by id (in memory: after a restart nobody waits, and answers go as messages)
const waiting = new Map<string, { runId: string | null; resolve: (o: AskOutcome) => void }>();

const clean = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);

/** The choices as the agent gave them: short, no blanks, no repeats. */
export function cleanChoices(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw.trim() ? raw.split(/\n|\s*\|\s*/) : [];
  return [...new Set(list.map((c) => clean(c, 200)).filter(Boolean))].slice(0, MAX_CHOICES);
}

/** Puts a question in the Outbox. (ask() also waits for the answer.) */
export function addQuestion({ question, detail, choices, agentId = null, chatId = null, runId = null }: AskInput): AgentQuestion {
  const text = clean(question, 2000);
  if (!text) throw new Error('Say what you want to ask the user (question).');
  const agent = agentId ? agents.get(agentId) : null;
  // a team's chat: a late answer goes to the team, so the others see it too
  const teamId = agentId && chatId ? chats.get(agentId, chatId)?.teamId || null : null;
  const team = teamId ? workflows.get(teamId) : null;
  const q = questions.save({
    id: uid('qn'),
    question: text,
    ...(clean(detail, 8000) ? { detail: clean(detail, 8000) } : {}),
    choices: cleanChoices(choices),
    status: 'waiting',
    agentId,
    agentName: agent?.name || '',
    chatId,
    runId,
    teamId: team?.id || null,
    teamName: team?.name || '',
  });
  // (an approval's line: the Needs you count and the activity feed show it)
  log('approval', `${q.agentName || 'An agent'} is asking you: ${text.slice(0, 160)}`, { agentId });
  return q;
}

/** Asks you and waits for your answer: until you answer or dismiss it, the run is stopped, or waitMs runs out. */
export async function ask(input: AskInput, { signal, waitMs = WAIT_MS }: { signal?: AbortSignal; waitMs?: number } = {}): Promise<{ question: AgentQuestion; outcome: AskOutcome }> {
  const q = addQuestion(input);
  if (signal?.aborted) return { question: close(q.id, 'The run was stopped.'), outcome: { kind: 'stopped' } };
  const outcome = await new Promise<AskOutcome>((resolve) => {
    const done = (o: AskOutcome) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      waiting.delete(q.id);
      resolve(o);
    };
    const timer = setTimeout(() => done({ kind: 'timeout' }), waitMs);
    const onAbort = () => done({ kind: 'stopped' });
    signal?.addEventListener('abort', onAbort);
    waiting.set(q.id, { runId: q.runId || null, resolve: done });
  });
  // stopped: you said stop, so the question goes too
  if (outcome.kind === 'stopped') return { question: close(q.id, 'The run was stopped before you answered.'), outcome };
  return { question: questions.get(q.id) || q, outcome };
}

function close(id: string, note: string): AgentQuestion {
  const q = questions.get(id);
  if (!q) throw new Error('No such question.');
  if (q.status !== 'waiting') return q;
  return questions.save({ ...q, status: 'closed', note });
}

/** The message an answer becomes when the agent isn't waiting for it any more. */
export function answerMessage(q: Pick<AgentQuestion, 'question' | 'agentName'>, { choice, text }: { choice: string; text: string }, team = false): string {
  const said = [choice ? `My answer: ${choice}` : '', text ? (choice ? `And: ${text}` : `My answer: ${text}`) : ''].filter(Boolean).join('\n');
  return `${team && q.agentName ? `@${q.agentName}: ` : ''}You asked me in the Outbox: "${q.question}"\n\n${said}`;
}

/** What the agent hears (ask_user's result) when the answer reaches it while it waits. */
export function answerResult({ choice, text }: { choice: string; text: string }): string {
  if (choice && text) return `The user answered: "${choice}"\nThey also wrote: ${text}`;
  if (choice) return `The user answered: "${choice}"`;
  return `The user answered in their own words: ${text}`;
}

/**
 * Your answer: a choice you clicked, what you wrote, or both. Goes straight to the agent while it waits;
 * otherwise as a new message in its chat (a team's chat: to the team, naming the agent).
 */
export function answerQuestion(id: string, answer: UserAnswer): Promise<AgentQuestion> {
  // (delivering it can take a moment: it is saved in the question's own project all the same)
  return withProject(activeProject(), () => answerNow(id, answer));
}

// questions an answer is on its way to (`<project id>/<question id>`): a second answer or a dismissal waits its turn
const answering = new Set<string>();
const claimOf = (id: string) => `${activeProject().id}/${id}`;

async function answerNow(id: string, { choice, text }: UserAnswer): Promise<AgentQuestion> {
  const q = questions.get(id);
  if (!q) throw Object.assign(new Error('No such question.'), { status: 404 });
  const answered = () => Object.assign(new Error('This question was answered or closed already.'), { status: 409 });
  if (q.status !== 'waiting' || answering.has(claimOf(q.id))) throw answered();
  const picked = clean(choice, 200);
  const wrote = clean(text, 8000);
  if (!picked && !wrote) throw Object.assign(new Error('Pick an answer or write one first.'), { status: 400 });
  if (picked && q.choices.length && !q.choices.includes(picked)) throw Object.assign(new Error("That isn't one of the choices."), { status: 400 });
  // taken before anything is awaited, so two answers at once (two tabs, the Outbox and the chat) can't both go
  const claim = claimOf(q.id);
  answering.add(claim);
  try {
    return await deliver(q, { choice: picked, text: wrote });
  } finally {
    answering.delete(claim);
  }
}

async function deliver(q: AgentQuestion, answer: { choice: string; text: string }): Promise<AgentQuestion> {
  const { choice: picked, text: wrote } = answer;
  // (loaded here: the engines import the tools, which import this file)
  const engines = await import('./engines/index.ts');
  const w = waiting.get(q.id);
  // (its run may have ended without the wait noticing, e.g. the CLI quit: then it goes as a message)
  const live = !!w && (!w.runId || !!engines.runInfo(w.runId));
  let delivered: AgentQuestion['delivered'] = 'nowhere';
  let note = '';
  if (live) {
    delivered = 'live';
  } else {
    const agent = q.agentId ? agents.get(q.agentId) : null;
    const teams = q.teamId ? await import('./teams.ts') : null;
    const team = teams ? teams.getTeam(q.teamId) : null;
    if (teams && team && agent && team.members.includes(agent.id)) {
      // (named as it is called now: renamed since it asked, the old name would reach nobody)
      await teams.postUserMessage(team.id, answerMessage({ ...q, agentName: agent.name }, answer, true));
      delivered = 'team';
    } else {
      const chat = agent && q.chatId ? chats.get(agent.id, q.chatId) : null;
      if (agent && chat) {
        engines.queueMessage(agent, chat, answerMessage(q, answer));
        delivered = 'chat';
      } else note = q.agentId ? 'The chat it was asked in is gone, so the answer went nowhere.' : '';
    }
  }
  const saved = questions.save({ ...q, status: 'answered', ...(picked ? { choice: picked } : {}), ...(wrote ? { reply: wrote } : {}), answeredAt: Date.now(), delivered, ...(note ? { note } : {}) });
  log('approval', `You answered ${q.agentName || 'an agent'}: ${(picked || wrote).slice(0, 120)}`, { agentId: q.agentId });
  // (a wait whose run is gone ends too: nobody reads it, but it isn't kept)
  w?.resolve({ kind: 'answer', ...answer });
  return saved;
}

/** You don't want to answer: an agent still waiting hears so. */
export function dismissQuestion(id: string): AgentQuestion {
  const q = questions.get(id);
  if (!q) throw Object.assign(new Error('No such question.'), { status: 404 });
  // (an answer on its way wins: it would only be written over)
  if (q.status !== 'waiting' || answering.has(claimOf(q.id))) return q;
  const saved = questions.save({ ...q, status: 'dismissed' });
  waiting.get(id)?.resolve({ kind: 'dismissed' });
  return saved;
}

export function removeQuestion(id: string): void {
  dismissQuestion(id);
  questions.remove(id);
}

/** The questions waiting for you in the open project, oldest first. */
export function waitingQuestions(): AgentQuestion[] {
  return questions
    .list()
    .filter((q) => q.status === 'waiting')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** Is an agent waiting on this question right now? (for tests) */
export const isWaiting = (id: string): boolean => waiting.has(id);
