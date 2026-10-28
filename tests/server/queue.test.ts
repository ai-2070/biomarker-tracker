// /queue: a message typed while an agent (or a team) works waits, then goes once it is done.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { chats, saveSettings, workflows } from '../../server/store.ts';
import { activeRuns, askAgent, editQueued, loopOf, orderQueued, queueMessage, queuedMessages, startLoop, steerChat, stopChat, unqueue } from '../../server/engines/index.ts';
import { getThread, queueUserMessage, stopTeam, teamState, unqueueTeam } from '../../server/teams.ts';
import { queuedText } from '../../shared/queue.ts';
import type { Team } from '../../shared/types.ts';

// A fake model: each request waits until the test releases it, then answers "re: <last message>".
let server: http.Server;
const waiting: { last: string; release: () => void }[] = [];
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body) as { messages: { content: string }[] };
    const last = String(j.messages.at(-1)?.content || '');
    await new Promise<void>((release) => waiting.push({ last, release }));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `re: ${last.slice(-40)}` } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
});
afterAll(() => {
  for (const w of waiting.splice(0)) w.release();
  return new Promise<void>((r) => server.close(() => r()));
});

const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};
// let the model answer the next request; returns the message it was answering
const release = async () => {
  await until(() => waiting.length > 0);
  const w = waiting.shift()!;
  w.release();
  return w.last;
};
const agent = (name: string) => newAgent({ name, engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
const userTexts = (agentId: string, chatId: string) => (chats.get(agentId, chatId)?.items || []).filter((i) => i.type === 'user').map((i) => i.text);
const running = (chatId: string) => activeRuns().some((r) => r.chatId === chatId);

describe('queuedText()', () => {
  it('reads "/queue <message>" and nothing else', () => {
    expect(queuedText('/queue then write the tests')).toBe('then write the tests');
    expect(queuedText('  /QUEUE  two\nlines ')).toBe('two\nlines');
    expect(queuedText('/queue')).toBe('');
    expect(queuedText('/queued up')).toBeNull();
    expect(queuedText('please /queue this')).toBeNull();
  });
});

describe('/queue in an agent chat', () => {
  it('goes now when the agent is free', async () => {
    const a = agent('Free');
    const c = chats.create(a.id);
    const r = queueMessage(a, c, 'hello');
    expect('runId' in r).toBe(true);
    await release();
    await until(() => !running(c.id));
    expect(userTexts(a.id, c.id)).toEqual(['hello']);
    expect(queuedMessages(c.id)).toEqual([]);
  });

  it('waits while the agent works, then sends each one in order as its own message', async () => {
    const a = agent('Busy');
    const c = chats.create(a.id);
    queueMessage(a, c, 'first');
    await until(() => waiting.length > 0);
    const second = queueMessage(a, c, 'second');
    const third = queueMessage(a, c, 'third', ['C:/files/notes.txt']);
    expect('queued' in second && 'queued' in third).toBe(true);
    expect(queuedMessages(c.id).map((q) => q.text)).toEqual(['second', 'third']);
    expect(userTexts(a.id, c.id)).toEqual(['first']);

    expect(await release()).toContain('first');
    await until(() => userTexts(a.id, c.id).length === 2);
    expect(queuedMessages(c.id).map((q) => q.text)).toEqual(['third']);
    expect(await release()).toContain('second');
    await until(() => userTexts(a.id, c.id).length === 3);
    const sent = chats.get(a.id, c.id)!.items.findLast((i) => i.type === 'user');
    expect(sent?.type === 'user' && sent.attachments).toEqual(['C:/files/notes.txt']);
    await release();
    await until(() => !running(c.id));
    expect(queuedMessages(c.id)).toEqual([]);
  });

  it('takes one back, and Stop takes back the rest instead of sending them', async () => {
    const a = agent('Stopper');
    const c = chats.create(a.id);
    queueMessage(a, c, 'work');
    await until(() => waiting.length > 0);
    const keep = queueMessage(a, c, 'keep');
    const drop = queueMessage(a, c, 'drop');
    if (!('queued' in drop) || !('queued' in keep)) throw new Error('should wait');
    expect(unqueue(c.id, drop.queued.id).map((q) => q.text)).toEqual(['drop']);
    expect(queuedMessages(c.id).map((q) => q.text)).toEqual(['keep']);
    // what the chat's Stop button does
    expect(unqueue(c.id).map((q) => q.text)).toEqual(['keep']);
    stopChat(c.id);
    await until(() => !running(c.id));
    await new Promise((r) => setTimeout(r, 50));
    expect(running(c.id)).toBe(false);
    expect(userTexts(a.id, c.id)).toEqual(['work']);
    waiting.splice(0).forEach((w) => w.release());
  });

  it('a run stopped from elsewhere drops what was queued behind it', async () => {
    const a = agent('Elsewhere');
    const c = chats.create(a.id);
    queueMessage(a, c, 'work');
    await until(() => waiting.length > 0);
    queueMessage(a, c, 'later');
    stopChat(c.id);
    await until(() => !running(c.id));
    expect(queuedMessages(c.id)).toEqual([]);
    expect(userTexts(a.id, c.id)).toEqual(['work']);
    waiting.splice(0).forEach((w) => w.release());
  });
});

describe('/queue in a team chat', () => {
  const team = () => {
    const solo = agent('Solo');
    return workflows.save({ name: `Q ${Math.random()}`, description: '', members: [solo.id], lead: solo.id, steps: [] } as Partial<Team>);
  };

  it('posts now when nobody is working, else once the team is done', async () => {
    const t = team();
    const now = await queueUserMessage(t.id, 'start');
    expect('message' in now).toBe(true);
    await until(() => teamState(t.id).working.length > 0);
    const later = await queueUserMessage(t.id, 'and then this');
    expect('queued' in later).toBe(true);
    expect(teamState(t.id).held?.map((q) => q.text)).toEqual(['and then this']);
    expect(getThread(t.id).messages.filter((m) => m.from === 'user').map((m) => m.text)).toEqual(['start']);

    await release();
    await until(() => getThread(t.id).messages.filter((m) => m.from === 'user').length === 2);
    expect(teamState(t.id).held).toEqual([]);
    await release();
    await until(() => !teamState(t.id).working.length && !teamState(t.id).queued.length);
    expect(getThread(t.id).messages.map((m) => m.from === 'user' ? `you: ${m.text}` : 'agent')).toEqual(['you: start', 'agent', 'you: and then this', 'agent']);
  });

  it('Stop hands the held messages back and posts none of them', async () => {
    const t = team();
    await queueUserMessage(t.id, 'start');
    await until(() => teamState(t.id).working.length > 0);
    await queueUserMessage(t.id, 'one');
    await queueUserMessage(t.id, 'two');
    expect(unqueueTeam(t.id).map((q) => q.text)).toEqual(['one', 'two']);
    stopTeam(t.id);
    waiting.splice(0).forEach((w) => w.release());
    await until(() => !teamState(t.id).working.length);
    await new Promise((r) => setTimeout(r, 50));
    expect(getThread(t.id).messages.filter((m) => m.from === 'user').map((m) => m.text)).toEqual(['start']);
  });

  it('refuses an empty /queue', async () => {
    const t = team();
    await expect(queueUserMessage(t.id, '  ')).rejects.toThrow('Write the message after /queue.');
  });
});

describe('steering an agent chat: a message while it works', () => {
  it('stops the run going now and goes next; queued messages still wait and go after it', async () => {
    const a = agent('Steered');
    const c = chats.create(a.id);
    queueMessage(a, c, 'the long job');
    await until(() => waiting.length > 0);
    // (the long job's request: stopped before it answers)
    const cut = waiting.shift()!;
    queueMessage(a, c, 'then tidy up');
    expect(queuedMessages(c.id).map((q) => q.text)).toEqual(['then tidy up']);
    await steerChat(a, c, 'change of plan');
    expect(queuedMessages(c.id).map((q) => q.text)).toEqual(['then tidy up']);
    expect(running(c.id)).toBe(true);
    expect(chats.get(a.id, c.id)!.items.some((i) => i.type === 'error' && i.text === 'Stopped to take your new message.')).toBe(true);
    expect(await release()).toContain('change of plan');
    expect(await release()).toContain('then tidy up');
    await until(() => !running(c.id));
    expect(userTexts(a.id, c.id)).toEqual(['the long job', 'change of plan', 'then tidy up']);
    cut.release();
  });

  it('a run slow to stop: the message goes first in the queue, and nothing queued or looping is lost', async () => {
    const a = agent('Slow stop');
    const c = chats.create(a.id);
    queueMessage(a, c, 'the long job');
    await until(() => waiting.length > 0);
    const cut = waiting.shift()!;
    queueMessage(a, c, 'then tidy up');
    // (gives up waiting at once, as if the run took too long to end)
    const { runId } = await steerChat(a, c, 'change of plan', { waitMs: 0 });
    expect(typeof runId).not.toBe('string');
    // the stopped run ended by itself later: your message went first, the queued one still waits
    const started = await runId;
    expect(typeof started).toBe('string');
    expect(chats.get(a.id, c.id)!.items.some((i) => i.type === 'error' && i.text === 'Stopped to take your new message.')).toBe(true);
    expect(await release()).toContain('change of plan');
    expect(await release()).toContain('then tidy up');
    await until(() => !running(c.id));
    expect(userTexts(a.id, c.id)).toEqual(['the long job', 'change of plan', 'then tidy up']);
    cut.release();
  });

  it('a /loop carries on after a message that changed its course', async () => {
    const a = agent('Looper');
    const c = chats.create(a.id);
    startLoop(a, c, { text: 'improve the tests', every: null, times: 2 });
    await until(() => waiting.length > 0);
    const cut = waiting.shift()!;
    await steerChat(a, c, 'focus on the parser');
    expect(await release()).toContain('focus on the parser');
    // (the cut turn counts as the first: the second goes once your message is answered)
    expect(await release()).toContain('improve the tests');
    await until(() => !running(c.id) && !loopOf(c.id));
    expect(userTexts(a.id, c.id)).toEqual(['improve the tests', 'focus on the parser', 'improve the tests']);
    expect(chats.get(a.id, c.id)!.items.some((i) => i.type === 'meta' && i.text.startsWith('Loop done'))).toBe(true);
    cut.release();
  });

  it('two messages sent quickly while it works both go, in the order sent', async () => {
    const a = agent('Twice');
    const c = chats.create(a.id);
    queueMessage(a, c, 'the long job');
    await until(() => waiting.length > 0);
    const cut = waiting.shift()!;
    const first = steerChat(a, c, 'no, red');
    const second = steerChat(a, c, 'and bigger');
    await expect(first).resolves.toHaveProperty('runId');
    await expect(second).resolves.toHaveProperty('runId');
    // (the first one's turn was stopped by the second, maybe before it asked the model)
    await until(() => waiting.some((w) => w.last.includes('and bigger')));
    for (const w of waiting.splice(0)) w.release();
    await until(() => !running(c.id));
    expect(userTexts(a.id, c.id)).toEqual(['the long job', 'no, red', 'and bigger']);
    cut.release();
  });

  it('not while it works for a team or another agent: they wait on its answer', async () => {
    const a = agent('Helper');
    const c = chats.create(a.id);
    const job = askAgent(a, 'a job for the team', { chatId: c.id, depth: 1 }).catch(() => '');
    await until(() => waiting.length > 0);
    await expect(steerChat(a, c, 'something else')).rejects.toMatchObject({ status: 409 });
    expect(running(c.id)).toBe(true);
    await release();
    await job;
    expect(userTexts(a.id, c.id)).toEqual(['a job for the team']);
  });

  it('with nothing going, it is an ordinary message', async () => {
    const a = agent('Idle');
    const c = chats.create(a.id);
    await steerChat(a, c, 'hello');
    expect(await release()).toContain('hello');
    await until(() => !running(c.id));
    expect(userTexts(a.id, c.id)).toEqual(['hello']);
  });

  it('a queued message can be changed, and the queue put in another order', async () => {
    const a = agent('Reorder');
    const c = chats.create(a.id);
    queueMessage(a, c, 'working');
    await until(() => waiting.length > 0);
    const ids = ['one', 'two', 'three'].map((t) => {
      const r = queueMessage(a, c, t);
      return 'queued' in r ? r.queued.id : '';
    });
    expect(editQueued(c.id, ids[1], ' two, changed ')).toMatchObject({ text: 'two, changed' });
    expect(() => editQueued(c.id, ids[1], '')).toThrow();
    // (already sent: nothing to change, and not an error)
    expect(editQueued(c.id, 'nope', 'x')).toBeNull();
    expect(orderQueued(c.id, [ids[2], ids[0]]).map((q) => q.text)).toEqual(['three', 'one', 'two, changed']);
    unqueue(c.id);
    stopChat(c.id);
    await until(() => !running(c.id));
    waiting.shift();
  });
});
