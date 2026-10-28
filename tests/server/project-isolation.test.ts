// Work that outlives an await stays in the project that started it, and what is kept in memory for a chat
// (its run, queue, loop, steer, compaction) is by project: a cloned project has the same chat ids.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeProject, agents, chats, outbox, routineRuns, runs, saveSettings, setActiveProject, setSecret, withProject } from '../../server/store.ts';
import { createProject } from '../../server/projects.ts';
import { newAgent } from '../../server/library.ts';
import { cloneProject } from '../../server/backup.ts';
import { activeRuns, compactNow, forgetChat, isChatBusy, liveChat, queueMessage, resetMemory, runInfo, startRun, steerChat, stopChat } from '../../server/engines/index.ts';
import { awaitHandoff, listHandoffs, startHandoff } from '../../server/handoffs.ts';
import { approvePost } from '../../server/social.ts';
import { markInterruptedRuns } from '../../server/workflows.ts';
import { markInterruptedRoutines } from '../../server/routines.ts';
import type { WorkflowRun } from '../../server/store.ts';
import type { Chat, ChatItem, OutboxPost, RoutineRun } from '../../shared/types.ts';

// A fake model and webhook. Each chat request waits until the test releases it and answers "re: <last>".
// The requests' messages are kept (sent); /models waits too while holdModels is on.
let server: http.Server;
let base = '';
const held: { release: () => void }[] = [];
const sent: { role: string; content: unknown }[][] = [];
let holdModels = false;
const modelWaits: (() => void)[] = [];
let hooks = 0;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) {
      if (holdModels) await new Promise<void>((r) => modelWaits.push(r));
      return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    }
    let body = '';
    for await (const c of req) body += c;
    await new Promise<void>((release) => held.push({ release }));
    if (req.url?.startsWith('/hook')) {
      hooks++;
      res.writeHead(204);
      return res.end();
    }
    const j = JSON.parse(body) as { messages: { role: string; content: unknown }[] };
    sent.push(j.messages);
    const last = String(j.messages.at(-1)?.content || '');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `re: ${last.slice(-30)}` } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  saveSettings({ providers: { custom: { baseUrl: `${base}/v1`, label: 'Fake model' } } });
});
afterAll(() => {
  for (const h of held.splice(0)) h.release();
  for (const r of modelWaits.splice(0)) r();
  return new Promise<void>((r) => server.close(() => r()));
});

const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};
// let every held request go until ok() (stopped runs leave theirs behind)
const releaseUntil = (ok: () => boolean) =>
  until(() => {
    for (const h of held.splice(0)) h.release();
    return ok();
  });
const settled = (chatId: string) => releaseUntil(() => !activeRuns().some((r) => r.chatId === chatId));
const folder = (name: string) => path.join(os.homedir(), 'isolation', name);
const apiAgent = (name: string) => newAgent({ name, engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
const said = (role: string, text: string): ChatItem => (role === 'user' ? { type: 'user', text, ts: 1 } : { type: 'assistant', text, ts: 1 });

describe('manual compaction', () => {
  // (first in this file: the model list isn't cached yet, so the compaction waits for it)
  it('saves the chat in its own project when another is opened meanwhile', async () => {
    const a = await createProject({ name: 'Compact A', mode: 'new', folder: folder('compact-a') });
    const agent = apiAgent('Compacter');
    const chat = chats.create(agent.id);
    for (let i = 0; i < 30; i++) chat.items.push(said(i % 2 ? 'assistant' : 'user', `message ${i} ${'words '.repeat(200)}`));
    chats.save(chat);
    holdModels = true;
    const going = compactNow(agent, chat.id, 'instant');
    const b = await createProject({ name: 'Compact B', mode: 'new', folder: folder('compact-b') });
    expect(activeProject().id).toBe(b.id);
    await until(() => modelWaits.length > 0);
    holdModels = false;
    modelWaits.shift()!();
    const { item } = await going;
    expect(item).not.toBeNull();
    withProject(a, () => expect(chats.get(agent.id, chat.id)?.items.some((i) => i.type === 'compaction')).toBe(true));
    expect(chats.get(agent.id, chat.id)).toBeNull();
  });
});

describe('a cloned chat', () => {
  it("has its own run, live copy, queue and stop: the original's work isn't the clone's", async () => {
    const a = await createProject({ name: 'Live A', mode: 'new', folder: folder('live-a') });
    const agent = apiAgent('Twin');
    const chat = chats.create(agent.id);
    const b = (await cloneProject(a.id, 'Live B')).project;
    setActiveProject(a.id);
    const ra = startRun(agent, chat, 'A private message after the clone');
    await until(() => held.length > 0);
    setActiveProject(b.id);
    // the clone's copy of the chat is free, and the original's live chat isn't its
    expect(isChatBusy(chat.id)).toBe(false);
    expect(liveChat(chat.id)).toBeNull();
    const copy = chats.get(agent.id, chat.id)!;
    const rb = queueMessage(agents.get(agent.id)!, copy, 'B works too');
    expect('runId' in rb).toBe(true);
    // Clear memory in the clone leaves the original's run alone
    const live = liveChat(chat.id)!;
    resetMemory(live);
    expect(live.items.some((i) => i.type === 'user' && i.text.includes('A private message'))).toBe(false);
    expect(liveChat(chat.id, a.id)!.items.some((i) => 'reset' in i && i.reset)).toBe(false);
    // stopping the clone's chat stops only its run
    stopChat(chat.id);
    await until(() => !activeRuns().some((r) => r.projectId === b.id));
    expect(runInfo(ra.runId)?.projectId).toBe(a.id);
    await settled(chat.id);
    await ra.promise;
    withProject(a, () => expect(chats.get(agent.id, chat.id)!.items.filter((i) => i.type === 'assistant')).toHaveLength(1));
  });
});

describe('Clear memory while the agent answers', () => {
  it("drops the answer it was writing from the agent's memory", async () => {
    await createProject({ name: 'Reset mid-run', mode: 'new', folder: folder('reset') });
    const agent = apiAgent('Forgetful');
    const chat = chats.create(agent.id);
    const { promise } = startRun(agent, chat, 'old topic');
    await until(() => held.length > 0);
    resetMemory(liveChat(chat.id)!);
    await settled(chat.id);
    await promise;
    const saved = chats.get(agent.id, chat.id)!;
    expect(saved.llm).toEqual([]);
    // the answer still shows
    expect(saved.items.some((i) => i.type === 'assistant')).toBe(true);
  });
});

describe('switching between a CLI engine and the API model', () => {
  it('sends what another engine said, and what was said in between', async () => {
    await createProject({ name: 'Engines', mode: 'new', folder: folder('engines') });
    const agent = apiAgent('Switcher');
    const chat: Chat = { ...chats.create(agent.id), sessionId: 'cli-session', sessionEngine: 'claude-code' };
    chat.items.push(said('user', 'Remember the code ORCHID'), said('assistant', 'Noted: ORCHID.'));
    chats.save(chat);
    const first = startRun(agent, chat, 'What is the project code?');
    await settled(chat.id);
    await first.promise;
    const one = JSON.stringify(sent.at(-1));
    expect(one).toContain('Remember the code ORCHID');
    expect(one).toContain('Noted: ORCHID.');
    // a CLI exchange in between, then the API model again
    const now = chats.get(agent.id, chat.id)!;
    now.items.push(said('user', 'The code is CEDAR now'), said('assistant', 'Noted: CEDAR.'));
    now.sessionEngine = 'codex';
    now.sessionId = 'codex-session';
    chats.save(now);
    const second = startRun(agent, now, 'And now?');
    await settled(chat.id);
    await second.promise;
    const two = JSON.stringify(sent.at(-1));
    expect(two).toContain('The code is CEDAR now');
    expect(two).toContain('Remember the code ORCHID');
    expect(chats.get(agent.id, chat.id)!.sessionEngine).toBe('openai');
  });
});

describe('a message sent while the agent works (steer)', () => {
  it('starts its run in the project it was sent in', async () => {
    const a = await createProject({ name: 'Steer A', mode: 'new', folder: folder('steer-a') });
    const agent = apiAgent('Steered');
    const chat = chats.create(agent.id);
    startRun(agent, chat, 'first');
    await until(() => held.length > 0);
    const steering = steerChat(agent, chat, 'change of plan');
    await createProject({ name: 'Steer B', mode: 'new', folder: folder('steer-b') });
    const { runId } = await steering;
    expect(typeof runId).toBe('string');
    expect(runInfo(runId as string)?.projectId).toBe(a.id);
    await settled(chat.id);
  });

  it('never brings back a chat deleted while it waited', async () => {
    await createProject({ name: 'Steer gone', mode: 'new', folder: folder('steer-gone') });
    const agent = apiAgent('Deleted');
    const chat = chats.create(agent.id);
    startRun(agent, chat, 'first');
    await until(() => held.length > 0);
    // the /stream route hands in its own copy of the chat
    const steering = steerChat(agent, chats.get(agent.id, chat.id)!, 'second');
    forgetChat(chat.id);
    chats.remove(agent.id, chat.id);
    await expect(steering).rejects.toThrow(/deleted/);
    await settled(chat.id);
    expect(chats.get(agent.id, chat.id)).toBeNull();
  });
});

describe('handoffs', () => {
  it("are the project's: a clone's agent with the same id can't list or collect them", async () => {
    const a = await createProject({ name: 'Hand A', mode: 'new', folder: folder('hand-a') });
    const helper = apiAgent('Helper');
    const h = await startHandoff({ id: 'boss-1', name: 'Boss' }, helper, 'count', { depth: 1 });
    await createProject({ name: 'Hand B', mode: 'new', folder: folder('hand-b') });
    expect(listHandoffs('boss-1')).toMatch(/no handoffs/);
    expect((await awaitHandoff(h.id, 'boss-1', 1)).text).toMatch(/^No handoff/);
    await releaseUntil(() => !!h.endedAt);
    await h.done;
    withProject(a, () => expect(listHandoffs('boss-1')).toMatch(/done, answer ready/));
  });
});

describe('the Outbox', () => {
  it('saves a post being published in its own project when another is opened meanwhile', async () => {
    const a = await createProject({ name: 'Post A', mode: 'new', folder: folder('post-a') });
    setSecret('discordWebhook', `${base}/hook`);
    outbox.save({ id: 'pd1', platform: 'discord', parts: ['hello'], status: 'pending' } as OutboxPost);
    const going = approvePost('pd1');
    const b = await createProject({ name: 'Post B', mode: 'new', folder: folder('post-b') });
    await releaseUntil(() => hooks === 1);
    const done = await going;
    expect(done.status).toBe('posted');
    expect(hooks).toBe(1);
    withProject(a, () => expect(outbox.get('pd1')?.status).toBe('posted'));
    expect(activeProject().id).toBe(b.id);
    expect(outbox.get('pd1')).toBeNull();
  });
});

describe('startup recovery', () => {
  it('stops runs left going in every project, not only the open one', async () => {
    const a = await createProject({ name: 'Crash A', mode: 'new', folder: folder('crash-a') });
    const b = await createProject({ name: 'Crash B', mode: 'new', folder: folder('crash-b') });
    for (const p of [a, b])
      withProject(p, () => {
        runs.save({ id: `wr-${p.id}`, workflowId: 'w', workflowName: 'W', input: '', trigger: 'manual', status: 'running', steps: [{ label: 's', type: 'agent', status: 'running', output: null }] } as WorkflowRun);
        routineRuns.save({ id: `rr-${p.id}`, routineId: 'r', routineName: 'R', trigger: 'manual', status: 'running', skills: [], targets: [] } as RoutineRun);
      });
    markInterruptedRuns();
    markInterruptedRoutines();
    for (const p of [a, b])
      withProject(p, () => {
        expect(runs.get(`wr-${p.id}`)?.status).toBe('stopped');
        expect(routineRuns.get(`rr-${p.id}`)?.status).toBe('stopped');
      });
  });
});
