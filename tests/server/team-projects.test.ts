// Team chats across projects and over time: a copied project's teams are their own, routing stays in
// the project it started in, a stopped routine starts nobody, @Brain after a clear is answered, and
// an agent's read mark doesn't skip what others wrote during its turn.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { activeProject, listProjects, saveProjects, saveSettings, setActiveProject, withProject, workflows } from '../../server/store.ts';
import { dataPath, readJSON } from '../../server/util.ts';
import { clearThread, getThread, postUserMessage, setBrainHandlers, stopTeam, teamState } from '../../server/teams.ts';
import { RunStopped } from '../../server/engines/index.ts';
import type { Team, TeamMessage } from '../../shared/types.ts';

// a fake model that answers only when the test lets it
let server: http.Server;
let release: () => void = () => {};
let gate = Promise.resolve();
const hold = () => (gate = new Promise<void>((r) => (release = r)));
let calls = 0;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    for await (const _ of req) void _;
    calls++;
    await gate;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Late answer.' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
});
afterAll(() => {
  release();
  server.closeAllConnections();
  return new Promise<void>((r) => server.close(() => r()));
});
const home = () => listProjects()[0];
afterEach(() => {
  release();
  setBrainHandlers(null);
  setActiveProject(home().id);
});

const agent = (name: string) => newAgent({ name, engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
const wait = async (ok: () => boolean, ms = 6000) => {
  for (let t = 0; t < ms && !ok(); t += 25) await new Promise((r) => setTimeout(r, 25));
};
const deferred = <T>() => {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const texts = (pid: string, teamId: string) => readJSON<{ messages: TeamMessage[] }>(dataPath('projects', pid, 'teamchats', `${teamId}.json`), { messages: [] }).messages.map((m) => m.text);

describe('a copied project', () => {
  it("has its own team: stopping the copy leaves the original's work going", async () => {
    const a = agent('Original worker');
    const team = workflows.save({ name: 'Copied team', members: [a.id], lead: a.id, steps: [] } as Partial<Team>);
    const src = activeProject();
    // the copy: same agents and teams, same ids
    fs.cpSync(dataPath('projects', src.id), dataPath('projects', 'copy-1'), { recursive: true });
    const copy = { ...src, id: 'copy-1', name: 'Copy' };
    saveProjects([...listProjects(), copy]);
    hold();
    const n = calls;
    await postUserMessage(team.id, 'Long work');
    await wait(() => calls > n);
    expect(teamState(team.id).working).toEqual([a.id]);
    withProject(copy, () => {
      expect(teamState(team.id).working).toEqual([]);
      stopTeam(team.id);
    });
    expect(teamState(team.id).working).toEqual([a.id]);
    release();
    await wait(() => texts(src.id, team.id).length >= 2);
    expect(texts(src.id, team.id)).toEqual(['Long work', 'Late answer.']);
    expect(texts('copy-1', team.id)).toEqual(['Stopped. Nothing new will start until you write again.']);
  });
});

describe('picking who answers', () => {
  it('stays in its project when you open another one meanwhile', async () => {
    const a = agent('Picked one');
    const b = agent('Other one');
    const team = workflows.save({ name: 'No lead team', members: [a.id, b.id], lead: null, steps: [] } as Partial<Team>);
    const src = activeProject();
    saveProjects([...listProjects(), { ...src, id: 'other-2', name: 'Other' }]);
    const picked = deferred<string>();
    const n = calls;
    const sent = postUserMessage(team.id, 'Who takes this?', { route: () => picked.promise });
    setActiveProject('other-2');
    picked.resolve(b.id);
    await sent;
    await new Promise((r) => setTimeout(r, 150));
    // nothing started in the project open now, and the work waits in its own project for /resume
    expect(calls).toBe(n);
    expect(fs.existsSync(dataPath('projects', 'other-2', 'teamchats', `${team.id}.json`))).toBe(false);
    expect(teamState(team.id)).toMatchObject({ working: [], queued: [], resumable: false });
    withProject(src, () => expect(teamState(team.id)).toMatchObject({ working: [], queued: [], resumable: true }));
  });

  it('starts nobody when a routine was stopped meanwhile', async () => {
    const a = agent('Routine one');
    const b = agent('Routine two');
    const team = workflows.save({ name: 'Routine team', members: [a.id, b.id], lead: null, steps: [] } as Partial<Team>);
    const picked = deferred<string>();
    const ac = new AbortController();
    const n = calls;
    const sent = postUserMessage(team.id, 'Routine work', { route: () => picked.promise, signal: ac.signal });
    ac.abort();
    picked.resolve(a.id);
    await expect(sent).rejects.toBeInstanceOf(RunStopped);
    await new Promise((r) => setTimeout(r, 150));
    expect(calls).toBe(n);
    expect(teamState(team.id)).toMatchObject({ working: [], queued: [] });
    expect(getThread(team.id).messages.map((m) => m.text)).toEqual(['Routine work', 'Stopped before anyone started on it.']);
  });
});

describe('@Brain', () => {
  it('answers a message written after a clear, while it still answered one from before', async () => {
    const a = agent('Brain asker');
    const team = workflows.save({ name: 'Brain team', members: [a.id], lead: a.id, steps: [] } as Partial<Team>);
    const first = deferred<string | null>();
    const asked: string[] = [];
    setBrainHandlers({
      reply: (_t, msg) => {
        asked.push(msg.text);
        return msg.text.includes('first') ? first.promise : Promise.resolve('Second answer.');
      },
      idle: () => {},
    });
    await postUserMessage(team.id, '@Brain first');
    clearThread(team.id);
    await postUserMessage(team.id, '@Brain second');
    first.resolve('First answer.');
    await wait(() => getThread(team.id).messages.length >= 2);
    expect(asked).toEqual(['@Brain first', '@Brain second']);
    expect(getThread(team.id).messages.map((m) => m.text)).toEqual(['@Brain second', 'Second answer.']);
  });
});

describe('what an agent has read', () => {
  it("doesn't count messages written during its turn as read", async () => {
    const lead = agent('Reader lead');
    const mate = agent('Reader mate');
    const team = workflows.save({ name: 'Reader team', members: [lead.id, mate.id], lead: lead.id, steps: [] } as Partial<Team>);
    hold();
    const n = calls;
    await postUserMessage(team.id, 'Start');
    await wait(() => calls > n);
    // written while the lead works: it hasn't seen this
    await postUserMessage(team.id, '@Reader mate side job');
    await wait(() => calls > n + 1);
    release();
    await wait(() => teamState(team.id).working.length === 0 && getThread(team.id).messages.length >= 4);
    const file = readJSON<{ seen: Record<string, number> }>(dataPath('projects', activeProject().id, 'teamchats', `${team.id}.json`), { seen: {} });
    expect(file.seen[lead.id]).toBe(1);
    expect(file.seen[mate.id]).toBe(2);
  });
});
