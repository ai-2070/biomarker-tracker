// /goal: the Brain checks each turn against your goal and follows up until it is met (agent and team
// chats, and from the Brain chat); /stop and /resume in the Brain chat. With fake models for both.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ask, clearHistory } from '../../server/overseer.ts';
import { startIrc } from '../../server/irc.ts';
import { listBriefs } from '../../server/briefs.ts';
import { goalInChat, goalInTeam, resumeBrain, stopBrain } from '../../server/commands.ts';
import { newAgent } from '../../server/library.ts';
import { activeRuns } from '../../server/engines/index.ts';
import { chats, saveSettings, workflows } from '../../server/store.ts';
import { getThread, teamState } from '../../server/teams.ts';
import { GOAL_FOLLOW_UPS } from '../../shared/commands.ts';
import type { ChatItem, Team } from '../../shared/types.ts';

// the Brain's model: verdicts on the work, answers in the Brain chat (a promise: one that takes a while)
const verdicts: string[] = [];
const answers: (string | Promise<string>)[] = [];
const checked: string[] = [];
vi.mock('../../server/brain.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/brain.ts')>()),
  brainModel: () => ({ provider: 'openrouter', model: 'mock', effort: '', fallback: false }),
  think: async (system: string, user: string) => {
    if (system.includes('Decide whether the brief is done')) {
      checked.push(user);
      return verdicts.shift() ?? '{"done":true,"summary":"Looks done."}';
    }
    return (await answers.shift()) ?? 'NOTHING';
  },
}));

// the agents' model: "Holder" answers only when the test lets it go, the rest at once
const held: (() => void)[] = [];
let server: http.Server;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body) as { messages: { content: string | { text?: string }[] }[] };
    const text = (c: string | { text?: string }[]) => (typeof c === 'string' ? c : c.map((x) => x.text || '').join(''));
    const name = /You are ([A-Z]\w+)/.exec(text(j.messages[0].content))?.[1] || '';
    if (name === 'Holder') await new Promise<void>((go) => held.push(go));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `${name} worked on it.` } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
  startIrc();
});
afterAll(() => {
  held.splice(0).forEach((go) => go());
  return new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  saveSettings({ brainFollowsUp: true });
  clearHistory();
  verdicts.length = 0;
  checked.length = 0;
});

const until = async (ok: () => boolean, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out');
};
const agent = (name: string) => newAgent({ name, engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
const items = (agentId: string, chatId: string): ChatItem[] => chats.get(agentId, chatId)?.items || [];
const users = (agentId: string, chatId: string) => items(agentId, chatId).filter((i) => i.type === 'user').map((i) => (i.type === 'user' ? `${i.from || 'you'}: ${i.text.split('\n')[0]}` : ''));
const notes = (agentId: string, chatId: string) => items(agentId, chatId).filter((i) => i.type === 'meta').map((i) => i.text);
const notDone = (followUp: string) => JSON.stringify({ done: false, followUp, summary: 'Not there yet.' });

describe('/goal in an agent chat', () => {
  it('starts the agent on it, follows up until the Brain says it is met, and says so in the chat', async () => {
    const a = agent('Worker');
    const c = chats.create(a.id);
    verdicts.push(notDone('Add the tests too.'));
    const { goal } = goalInChat(a.id, c.id, 'the login page works and has tests');
    expect(goal?.origin).toBe('chat');
    await until(() => listBriefs().find((b) => b.id === goal!.id)?.status === 'done');
    expect(users(a.id, c.id)).toEqual(['/goal: Your goal: the login page works and has tests', 'the Brain: Add the tests too.']);
    expect(checked[0]).toContain("THE USER'S GOAL");
    expect(checked[0]).toContain('the login page works and has tests');
    await until(() => notes(a.id, c.id).some((n) => n.startsWith('Goal reached.')));
    expect(listBriefs().find((b) => b.id === goal!.id)?.followUps).toBe(1);
  });

  it(`gives up after ${GOAL_FOLLOW_UPS} follow-ups and says so in the chat (even with Brain follow-ups off)`, async () => {
    saveSettings({ brainFollowsUp: false });
    const a = agent('Stubborn');
    const c = chats.create(a.id);
    for (let i = 0; i <= GOAL_FOLLOW_UPS; i++) verdicts.push(notDone(`Try again ${i}.`));
    const { goal } = goalInChat(a.id, c.id, 'ship it');
    await until(() => listBriefs().find((b) => b.id === goal!.id)?.status === 'stuck', 15000);
    expect(users(a.id, c.id).filter((u) => u.startsWith('the Brain'))).toHaveLength(GOAL_FOLLOW_UPS);
    await until(() => notes(a.id, c.id).some((n) => n.startsWith(`Goal not reached after ${GOAL_FOLLOW_UPS} follow-ups.`)));
  });

  it('/goal clear drops it: the next turn is not checked', async () => {
    const a = agent('Holder');
    const c = chats.create(a.id);
    const { goal } = goalInChat(a.id, c.id, 'something');
    await until(() => held.length > 0);
    expect(goalInChat(a.id, c.id, '').goal?.id).toBe(goal!.id);
    goalInChat(a.id, c.id, 'clear');
    expect(goalInChat(a.id, c.id, '').goal).toBeNull();
    held.shift()!();
    await until(() => !activeRuns().some((r) => r.chatId === c.id));
    await new Promise((r) => setTimeout(r, 100));
    expect(checked).toEqual([]);
    expect(listBriefs().find((b) => b.id === goal!.id)?.status).toBe('cleared');
  });

  it("a goal in one chat doesn't replace a goal in another chat with the same agent", async () => {
    const a = agent('Holder');
    const one = chats.create(a.id);
    const two = chats.create(a.id);
    const g1 = goalInChat(a.id, one.id, 'first').goal!;
    const g2 = goalInChat(a.id, two.id, 'second').goal!;
    expect(listBriefs().find((b) => b.id === g1.id)?.status).toBe('open');
    expect(listBriefs().find((b) => b.id === g2.id)?.status).toBe('open');
    goalInChat(a.id, one.id, 'clear');
    goalInChat(a.id, two.id, 'clear');
    await until(() => held.length >= 2);
    held.splice(0).forEach((go) => go());
    await until(() => !activeRuns().some((r) => r.chatId === one.id || r.chatId === two.id));
  });
});

describe('/goal in a team chat', () => {
  it('posts it for the team and checks when the team goes quiet; the result is posted in the thread', async () => {
    const lead = agent('Leader');
    const t = workflows.save({ name: `Goal team ${Date.now()}`, description: '', members: [lead.id], lead: lead.id, steps: [] } as Partial<Team>);
    verdicts.push(notDone('@Leader add the summary.'));
    const { goal } = await goalInTeam(t.id, 'a weekly report with a summary');
    await until(() => listBriefs().find((b) => b.id === goal!.id)?.status === 'done');
    const said = getThread(t.id).messages.map((m) => `${m.from === lead.id ? 'Leader' : m.from}: ${m.text}`);
    expect(said[0]).toBe('user: Goal: a weekly report with a summary');
    expect(said).toContain('brain: @Leader add the summary.');
    await until(() => getThread(t.id).messages.some((m) => m.from === 'system' && m.text.startsWith('Goal reached.')));
    await until(() => !teamState(t.id).working.length);
  });
});

describe('/stop and /resume in the Brain chat', () => {
  it('stops the work the Brain handed out, and /resume picks it up again', async () => {
    const a = agent('Holder');
    answers.push(`On it.\n\`\`\`actions\n[{"do":"delegate","to":"agent","id":"${a.id}","message":"Write the report"}]\n\`\`\``);
    const r = await ask('get the report written');
    const chatId = r.delegate!.sent!.chatId!;
    await until(() => held.length > 0);
    expect(stopBrain({}).stopped).toEqual(['Holder']);
    await until(() => !activeRuns().some((x) => x.chatId === chatId));
    const brief = listBriefs().findLast((b) => b.chatId === chatId)!;
    expect(brief.status).toBe('stopped');
    held.splice(0).forEach((go) => go());

    const back = resumeBrain({});
    expect(back.resumed).toEqual(['Holder']);
    expect(back.chats).toEqual([chatId]);
    expect(listBriefs().find((b) => b.id === brief.id)?.status).toBe('open');
    await until(() => held.length > 0);
    expect(users(a.id, chatId).at(-1)).toBe('the Brain: Continue from where you stopped.');
    held.shift()!();
    await until(() => listBriefs().find((b) => b.id === brief.id)?.status === 'done');
    expect(() => resumeBrain({})).toThrow('Nothing to resume.');
  });

  it('an answer the Brain was writing when you stopped it changes nothing', async () => {
    const a = agent('Finisher');
    let finish: (s: string) => void = () => {};
    answers.push(new Promise<string>((r) => (finish = r)));
    const pending = ask('hand this on');
    await new Promise((r) => setTimeout(r, 30));
    stopBrain({});
    finish(`Sure.\n\`\`\`actions\n[{"do":"delegate","to":"agent","id":"${a.id}","message":"Do it"}]\n\`\`\``);
    const r = await pending;
    expect(r.delegate).toBeNull();
    expect(r.done.map((d) => d.text)).toEqual(['You stopped the Brain, so nothing was changed.']);
    expect(listBriefs().some((b) => b.targetId === a.id)).toBe(false);
  });

  it('a /goal from the Brain chat is kept for its hand-off even with follow-ups off', async () => {
    saveSettings({ brainFollowsUp: false });
    const a = agent('Finisher');
    answers.push(`Handing it on.\n\`\`\`actions\n[{"do":"delegate","to":"agent","id":"${a.id}","message":"Make the site load fast"}]\n\`\`\``);
    await ask('the site loads in under a second', { goal: true });
    const b = listBriefs().findLast((x) => x.targetId === a.id)!;
    expect(b.goal).toBe('the site loads in under a second');
    await until(() => listBriefs().find((x) => x.id === b.id)?.status === 'done');
    expect(checked.at(-1)).toContain('the site loads in under a second');
  });
});
