// The / commands in agent and team chats: /loop, /resume, /resend, the suggestions, and the harness's
// own commands for the / menu. With a fake model that answers only when the test lets it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { chats, saveSettings, workflows } from '../../server/store.ts';
import { HOME } from '../../server/util.ts';
import { workspaceOf } from '../../server/tools.ts';
import { activeRuns, loopOf, queueMessage, stopChat, stopLoop } from '../../server/engines/index.ts';
import { getThread, postUserMessage, stopTeam, teamState } from '../../server/teams.ts';
import { cutOff, harnessCommands, loopInChat, loopInTeam, resendInChat, resendInTeam, resumeInChat, resumeInTeam } from '../../server/commands.ts';
import { loopPace, parseCommand, parseLoop, slashSuggestions } from '../../shared/commands.ts';
import type { ChatItem, EngineId, Team } from '../../shared/types.ts';

const waiting: { last: string; release: () => void }[] = [];
let server: http.Server;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body) as { messages: { content: string }[] };
    const last = String(j.messages.at(-1)?.content || '');
    await new Promise<void>((release) => waiting.push({ last, release }));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
});
afterAll(() => {
  waiting.splice(0).forEach((w) => w.release());
  return new Promise<void>((r) => server.close(() => r()));
});

const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};
const release = async () => {
  await until(() => waiting.length > 0);
  waiting.shift()!.release();
};
const agent = (name: string, engine: EngineId = 'openai') => newAgent({ name, engine, provider: 'custom', model: 'mock', toolGroups: [] });
const items = (agentId: string, chatId: string): ChatItem[] => chats.get(agentId, chatId)?.items || [];
const users = (agentId: string, chatId: string) => items(agentId, chatId).flatMap((i) => (i.type === 'user' ? [`${i.from || 'you'}: ${i.text}`] : []));
const running = (chatId: string) => activeRuns().some((r) => r.chatId === chatId);

describe('reading commands', () => {
  it('knows its commands, and which chats have them', () => {
    expect(parseCommand('/loop 5m check')).toEqual({ name: 'loop', rest: '5m check' });
    expect(parseCommand('/STOP')).toEqual({ name: 'stop', rest: '' });
    expect(parseCommand('/compact', 'team')).toBeNull();
    expect(parseCommand('/review this PR', 'agent')).toBeNull(); // not ours: it goes to the agent as typed
    expect(parseCommand('hello /stop')).toBeNull();
  });

  it('suggests commands while you type "/", ours first, then the harness ones', () => {
    expect(slashSuggestions('/', 'team').map((c) => c.name)).toEqual(['queue', 'stop', 'resume', 'resend', 'loop', 'goal', 'clear']);
    expect(slashSuggestions('/re', 'agent').map((c) => c.name)).toEqual(['resume', 'resend']);
    expect(slashSuggestions('/c', 'agent', [{ name: 'commit', about: 'Make a commit' }]).map((c) => [c.name, !!c.harness])).toEqual([['compact', false], ['commit', true]]);
    expect(slashSuggestions('/stop', 'agent')).toEqual([]);
    expect(slashSuggestions('/loop 5m', 'agent')).toEqual([]);
    expect(slashSuggestions('hi', 'agent')).toEqual([]);
  });

  it('reads /loop: an interval and a count in either order, then the message', () => {
    expect(parseLoop('15m check the build')).toEqual({ text: 'check the build', every: 15 * 60_000, times: 10 });
    expect(parseLoop('5x 2h tidy up')).toEqual({ text: 'tidy up', every: 2 * 3600_000, times: 5 });
    expect(parseLoop('3x improve the tests')).toEqual({ text: 'improve the tests', every: null, times: 3 });
    expect(parseLoop('keep going')).toEqual({ text: 'keep going', every: null, times: 10 });
    expect(parseLoop('10s too fast')).toEqual({ error: 'Loop at most once a minute.' });
    expect(parseLoop('500x way too many')).toEqual({ error: 'Loop between 1 and 100 times.' });
    expect(parseLoop('15m')).toHaveProperty('error');
    expect(loopPace(15 * 60_000)).toBe('every 15m');
    expect(loopPace(null)).toBe('after each answer');
  });
});

describe('/loop in an agent chat', () => {
  it('sends the message again after each answer, the set number of times, then says it is done', async () => {
    const a = agent('Looper');
    const c = chats.create(a.id);
    const { loop } = loopInChat(a.id, c.id, '3x improve the tests');
    expect(loop).toMatchObject({ text: 'improve the tests', every: null, times: 3, done: 1 });
    for (let i = 0; i < 3; i++) await release();
    await until(() => !loopOf(c.id) && !running(c.id));
    expect(users(a.id, c.id)).toEqual(['/loop 1 of 3: improve the tests', '/loop 2 of 3: improve the tests', '/loop 3 of 3: improve the tests']);
    expect(items(a.id, c.id).filter((i) => i.type === 'meta').map((i) => i.text)).toContain('Loop done: sent 3 times.');
  });

  it('a queued message goes before the loop’s next one', async () => {
    const a = agent('Order');
    const c = chats.create(a.id);
    loopInChat(a.id, c.id, '2x again');
    await until(() => waiting.length > 0);
    queueMessage(a, c, 'my question');
    await release(); // loop 1
    await release(); // your queued message
    await release(); // loop 2
    await until(() => !loopOf(c.id) && !running(c.id));
    expect(users(a.id, c.id)).toEqual(['/loop 1 of 2: again', 'you: my question', '/loop 2 of 2: again']);
  });

  it('a timed loop says when the next one goes; Stop ends the loop', async () => {
    const a = agent('Timer');
    const c = chats.create(a.id);
    const { loop } = loopInChat(a.id, c.id, '15m 4x check the build');
    expect(loop!.next).toBeGreaterThan(Date.now() + 14 * 60_000);
    await until(() => waiting.length > 0);
    stopChat(c.id);
    await until(() => !running(c.id));
    expect(loopOf(c.id)).toBeNull();
    expect(items(a.id, c.id).filter((i) => i.type === 'meta').map((i) => i.text)).toContain('Loop stopped.');
    waiting.splice(0).forEach((w) => w.release());
  });

  it('/loop off ends it; a message that can not be read is refused', async () => {
    const a = agent('Offer');
    const c = chats.create(a.id);
    expect(() => loopInChat(a.id, c.id, '10s nope')).toThrow('Loop at most once a minute.');
    expect(() => loopInChat(a.id, c.id, 'off')).toThrow('No loop is going here.');
    loopInChat(a.id, c.id, '1h ping');
    expect(loopInChat(a.id, c.id, 'off').loop).toBeNull();
    expect(stopLoop(c.id, null)).toBe(false);
    await release();
    await until(() => !running(c.id));
  });
});

describe('/resume and /resend in an agent chat', () => {
  it('/resume carries on after a stopped turn; not when the last turn finished', async () => {
    const a = agent('Resumer');
    const c = chats.create(a.id);
    queueMessage(a, c, 'write the report');
    await until(() => waiting.length > 0);
    expect(() => resumeInChat(a.id, c.id)).toThrow('It is still working.');
    stopChat(c.id);
    await until(() => !running(c.id));
    waiting.splice(0).forEach((w) => w.release());
    expect(cutOff(chats.get(a.id, c.id)!)).toBe(true);
    resumeInChat(a.id, c.id);
    expect(users(a.id, c.id).at(-1)).toBe('/resume: Continue from where you stopped.');
    await release();
    await until(() => !running(c.id));
    expect(() => resumeInChat(a.id, c.id)).toThrow('Nothing to resume: the last turn finished.');
  });

  it('/resend sends your last message again with its files, not one a loop or the Brain sent', async () => {
    const a = agent('Resender');
    const c = chats.create(a.id);
    expect(() => resendInChat(a.id, c.id)).toThrow('Nothing to send again yet.');
    queueMessage(a, c, 'make the chart', ['C:/data/sales.csv']);
    await release();
    await until(() => !running(c.id));
    queueMessage(a, c, 'from the Brain', [], { from: 'the Brain' });
    await release();
    await until(() => !running(c.id));
    resendInChat(a.id, c.id);
    const last = items(a.id, c.id).findLast((i) => i.type === 'user');
    expect(last).toMatchObject({ type: 'user', text: 'make the chart', attachments: ['C:/data/sales.csv'] });
    expect(last?.type === 'user' && last.from).toBeFalsy();
    await release();
    await until(() => !running(c.id));
  });
});

describe('team chats', () => {
  const makeTeam = () => {
    const solo = agent('Solo');
    return workflows.save({ name: `T ${Math.random()}`, description: '', members: [solo.id], lead: solo.id, steps: [] } as Partial<Team>);
  };
  const userPosts = (teamId: string) => getThread(teamId).messages.filter((m) => m.from === 'user').map((m) => m.text);
  const quiet = (teamId: string) => {
    const s = teamState(teamId);
    return !s.working.length && !s.queued.length;
  };

  it('/resume starts the turns Stop cut off; with nothing cut off it says so', async () => {
    const t = makeTeam();
    expect(() => resumeInTeam(t.id)).toThrow("Nothing to resume: the team wasn't stopped or paused.");
    await postUserMessage(t.id, 'plan the launch');
    await until(() => teamState(t.id).working.length > 0);
    stopTeam(t.id);
    waiting.splice(0).forEach((w) => w.release());
    await until(() => quiet(t.id));
    expect(teamState(t.id).resumable).toBe(true);
    resumeInTeam(t.id);
    expect(getThread(t.id).messages.at(-1)?.text).toMatch(/^Resumed: Solo picks up where they left off\.$/);
    await until(() => teamState(t.id).working.length > 0);
    await release();
    await until(() => quiet(t.id));
    expect(teamState(t.id).resumable).toBe(false);
  });

  it('/resend posts your last message again', async () => {
    const t = makeTeam();
    await postUserMessage(t.id, 'first');
    await release();
    await until(() => quiet(t.id));
    await resendInTeam(t.id);
    expect(userPosts(t.id)).toEqual(['first', 'first']);
    await release();
    await until(() => quiet(t.id));
  });

  it('/loop posts again once the team is quiet, the set number of times', async () => {
    const t = makeTeam();
    const { loop } = loopInTeam(t.id, '2x status update please');
    expect(loop).toMatchObject({ times: 2, every: null });
    await release();
    await until(() => userPosts(t.id).length === 2);
    await release();
    await until(() => !teamState(t.id).loop && quiet(t.id));
    expect(userPosts(t.id)).toEqual(['status update please', 'status update please']);
    expect(getThread(t.id).messages.at(-1)?.text).toBe('Loop done: sent 2 times.');
  });
});

describe("the harness's own commands", () => {
  it("lists a Claude Code agent's commands and skills (yours and its folder's), not other agents'", () => {
    const cc = agent('Coder', 'claude-code');
    const mine = path.join(HOME, '.claude');
    fs.mkdirSync(path.join(mine, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(mine, 'commands', 'review.md'), '---\ndescription: Review the changes\n---\nLook at the diff.');
    fs.writeFileSync(path.join(mine, 'commands', 'stop.md'), 'ours wins');
    const ws = path.join(workspaceOf(cc), '.claude', 'skills', 'deploy');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'SKILL.md'), '---\nname: deploy\ndescription: "Ship it to staging"\n---\n');
    expect(harnessCommands(cc.id)).toEqual([
      { name: 'deploy', about: 'Ship it to staging' },
      { name: 'review', about: 'Review the changes' },
    ]);
    expect(harnessCommands(agent('Api').id)).toEqual([]);
  });
});
