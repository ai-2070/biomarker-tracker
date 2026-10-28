// Questions agents ask you (ask_user): they wait in the Outbox with clickable choices and a box for your own
// words; the answer goes straight to an agent still waiting, else as a new message to its chat or team.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, Team } from '../../shared/types.ts';

// the engines and team chats are stood in for: the answer's way back is what's checked
const live = new Set<string>();
const queued: { agentId: string; chatId: string; text: string }[] = [];
const teamPosts: { teamId: string; text: string }[] = [];
vi.mock('../../server/engines/index.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/engines/index.ts')>()),
  runInfo: (id: string | null | undefined) => (id && live.has(id) ? { id, agentId: 'x', projectId: 'p', chatId: 'c', depth: 0, signal: new AbortController().signal } : null),
  queueMessage: (agent: Agent, chat: { id: string }, text: string) => (queued.push({ agentId: agent.id, chatId: chat.id, text }), { runId: 'r-next' }),
}));
vi.mock('../../server/teams.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/teams.ts')>()),
  postUserMessage: async (teamId: string, text: string) => (teamPosts.push({ teamId, text }), { id: 'm1' }),
}));

const { agents, chats, workflows, questions } = await import('../../server/store.ts');
const q = await import('../../server/questions.ts');
const { callTool, toolsForAgent } = await import('../../server/tools.ts');

const agent = (name = 'Designer'): Agent => agents.save({ name, engine: 'openai', toolGroups: [] } as Partial<Agent> as Agent);
/** The question ask() just put in the Outbox (once it is there). */
async function newest() {
  for (let i = 0; i < 200 && !q.waitingQuestions().length; i++) await new Promise((r) => setTimeout(r, 5));
  return q.waitingQuestions().at(-1)!;
}

beforeEach(() => {
  for (const it of questions.list()) questions.remove(it.id);
  live.clear();
  queued.length = 0;
  teamPosts.length = 0;
});

describe('ask_user', () => {
  it('is a tool every agent has, and never asks for approval', () => {
    const t = toolsForAgent({ id: 'a', name: 'A', toolGroups: [], autonomy: 'ask' }).find((x) => x.name === 'ask_user');
    expect(t?.risk).toBe('none');
    expect(t?.parameters.required).toEqual(['question']);
  });

  it('waits for your click and hands the choice back to the agent', async () => {
    const a = agent();
    live.add('r1');
    const res = callTool(a, 'ask_user', { question: 'Which style?', choices: ['Flat', '3D', 'Flat', ' '], detail: 'For the **logo**' }, { runId: 'r1' });
    const asked = await newest();
    expect(asked).toMatchObject({ question: 'Which style?', choices: ['Flat', '3D'], detail: 'For the **logo**', agentName: 'Designer', status: 'waiting', runId: 'r1' });
    expect(q.isWaiting(asked.id)).toBe(true);
    // (the run's chat comes from runInfo: here, the stand-in's)
    expect(asked.chatId).toBe('c');
    const saved = await q.answerQuestion(asked.id, { choice: '3D', text: 'with a soft shadow' });
    expect(saved).toMatchObject({ status: 'answered', choice: '3D', reply: 'with a soft shadow', delivered: 'live' });
    const r = await res;
    expect(r.isError).toBe(false);
    expect(r.text).toContain('"3D"');
    expect(r.text).toContain('with a soft shadow');
    // nothing went to the chat: the agent got it while it waited
    expect(queued).toEqual([]);
  });

  it('takes an answer in your own words, and refuses an empty one or one that is not a choice', async () => {
    const asked = q.addQuestion({ question: 'Anything else?', choices: ['No'] });
    await expect(q.answerQuestion(asked.id, {})).rejects.toThrow(/Pick an answer or write one/);
    await expect(q.answerQuestion(asked.id, { choice: 'Maybe' })).rejects.toThrow(/isn't one of the choices/);
    const saved = await q.answerQuestion(asked.id, { text: 'Use blue' });
    expect(saved).toMatchObject({ status: 'answered', reply: 'Use blue' });
    await expect(q.answerQuestion(asked.id, { text: 'again' })).rejects.toThrow(/already/);
  });

  it('a late answer goes to the chat it was asked in as a new message', async () => {
    const a = agent();
    const c = chats.create(a.id, 'Logo');
    const { question, outcome } = await q.ask({ question: 'Which style?', choices: ['Flat', '3D'], agentId: a.id, chatId: c.id, runId: 'r2' }, { waitMs: 5 });
    expect(outcome.kind).toBe('timeout');
    expect(questions.get(question.id)?.status).toBe('waiting');
    const saved = await q.answerQuestion(question.id, { choice: 'Flat' });
    expect(saved.delivered).toBe('chat');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ agentId: a.id, chatId: c.id });
    expect(queued[0].text).toContain('"Which style?"');
    expect(queued[0].text).toContain('My answer: Flat');
  });

  it('the tool tells the agent to end its turn when nobody answered in time', async () => {
    live.add('r3');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = await (async () => {
      try {
        const res = callTool(agent(), 'ask_user', { question: 'Go?' }, { runId: 'r3' });
        await vi.advanceTimersByTimeAsync(q.WAIT_MS + 1000);
        return await res;
      } finally {
        vi.useRealTimers();
      }
    })();
    expect(r.text).toMatch(/No answer yet \(waited 30 minutes\)/);
    expect(r.text).toMatch(/new message in this chat/);
    expect(r.text).toMatch(/End your turn/);
  });

  it('a late answer to a team chat goes to the team, naming the agent', async () => {
    const a = agent('Trend Scout');
    const team = workflows.save({ name: 'Social', members: [a.id], steps: [] } as Partial<Team> as Team);
    const c = chats.create(a.id, 'Team turn', team.id);
    const asked = q.addQuestion({ question: 'Post today?', choices: ['Yes', 'No'], agentId: a.id, chatId: c.id });
    expect(asked).toMatchObject({ teamId: team.id, teamName: 'Social' });
    const saved = await q.answerQuestion(asked.id, { choice: 'Yes' });
    expect(saved.delivered).toBe('team');
    expect(teamPosts).toHaveLength(1);
    expect(teamPosts[0].teamId).toBe(team.id);
    expect(teamPosts[0].text.startsWith('@Trend Scout: ')).toBe(true);
  });

  it('a late team answer names the agent as it is called now', async () => {
    const a = agent('Old Name');
    const team = workflows.save({ name: 'Renamers', members: [a.id], steps: [] } as Partial<Team> as Team);
    const c = chats.create(a.id, 'Team turn', team.id);
    const asked = q.addQuestion({ question: 'Which color?', agentId: a.id, chatId: c.id });
    agents.save({ ...agents.get(a.id)!, name: 'New Name' });
    await q.answerQuestion(asked.id, { text: 'Blue' });
    expect(teamPosts.map((p) => p.text.split(':')[0])).toEqual(['@New Name']);
  });

  it('two answers at once: only the first goes, and a dismissal meanwhile changes nothing', async () => {
    const a = agent();
    const c = chats.create(a.id, 'Twice');
    const asked = q.addQuestion({ question: 'Ship it?', choices: ['Yes', 'No'], agentId: a.id, chatId: c.id });
    const first = q.answerQuestion(asked.id, { choice: 'Yes' });
    const second = q.answerQuestion(asked.id, { choice: 'No' });
    expect(q.dismissQuestion(asked.id).status).toBe('waiting');
    await expect(second).rejects.toMatchObject({ status: 409 });
    expect(await first).toMatchObject({ status: 'answered', choice: 'Yes' });
    expect(queued).toHaveLength(1);
    expect(questions.get(asked.id)).toMatchObject({ status: 'answered', choice: 'Yes' });
  });

  it('an answer for a run that ended goes to its chat even if the wait did not notice', async () => {
    const a = agent();
    const c = chats.create(a.id, 'Logo');
    const p = q.ask({ question: 'Ok?', agentId: a.id, chatId: c.id, runId: 'gone' }, { waitMs: 60_000 });
    const saved = await q.answerQuestion((await newest()).id, { text: 'yes' });
    expect(saved.delivered).toBe('chat');
    expect(queued).toHaveLength(1);
    // the wait still ends
    expect((await p).outcome.kind).toBe('answer');
  });

  it('dismissing tells a waiting agent; stopping the run closes the question', async () => {
    const p = q.ask({ question: 'A or B?', choices: ['A', 'B'] }, { waitMs: 60_000 });
    q.dismissQuestion((await newest()).id);
    expect((await p).outcome.kind).toBe('dismissed');

    const stop = new AbortController();
    const p2 = q.ask({ question: 'C or D?' }, { signal: stop.signal, waitMs: 60_000 });
    await newest();
    stop.abort();
    const { question, outcome } = await p2;
    expect(outcome.kind).toBe('stopped');
    expect(questions.get(question.id)).toMatchObject({ status: 'closed' });
    expect(q.waitingQuestions()).toEqual([]);
  });

  it('needs a question, and keeps at most 8 short choices', () => {
    expect(() => q.addQuestion({ question: '  ' })).toThrow(/question/);
    expect(q.cleanChoices(Array.from({ length: 12 }, (_, i) => `c${i}`))).toHaveLength(q.MAX_CHOICES);
    expect(q.cleanChoices('Yes | No')).toEqual(['Yes', 'No']);
    expect(q.cleanChoices(undefined)).toEqual([]);
  });
});
