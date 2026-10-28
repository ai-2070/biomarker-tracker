// Team chats: unsafe ids, clearing or switching projects while a turn runs, and old step lists.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { activeProject, chats, listProjects, saveProjects, saveSettings, setActiveProject, workflows } from '../../server/store.ts';
import { dataPath, readJSON } from '../../server/util.ts';
import { clearThread, getThread, isStepList, postUserMessage, teamSteps, teamState } from '../../server/teams.ts';
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

const agent = (name: string) => newAgent({ name, engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
const wait = async (ok: () => boolean, ms = 6000) => {
  for (let t = 0; t < ms && !ok(); t += 50) await new Promise((r) => setTimeout(r, 50));
};

describe('team ids', () => {
  it('rejects ids that would leave the team chat folder', () => {
    const settings = dataPath('settings.json');
    const before = fs.readFileSync(settings, 'utf8');
    expect(() => clearThread('../../../settings')).toThrow(/No such team/);
    expect(() => clearThread('..\\..\\..\\settings')).toThrow(/No such team/);
    expect(() => getThread('../../../settings')).toThrow(/No such team/);
    expect(fs.readFileSync(settings, 'utf8')).toBe(before);
  });
});

describe('a running turn', () => {
  it('is dropped when the thread is cleared, and does not bring its session back', async () => {
    const a = agent('Solo');
    const team = workflows.save({ name: 'Solo team', members: [a.id], lead: a.id, steps: [] } as Partial<Team>);
    hold();
    const n = calls;
    await postUserMessage(team.id, 'Start something long');
    await wait(() => calls > n);
    expect(teamState(team.id).working).toEqual([a.id]);
    clearThread(team.id);
    release();
    await wait(() => teamState(team.id).working.length === 0);
    await new Promise((r) => setTimeout(r, 200));
    expect(getThread(team.id).messages).toEqual([]);
    expect(chats.list(a.id).filter((c) => c.title === 'Team: Solo team')).toEqual([]);
  });

  it('keeps its reply in its own project when you switch projects meanwhile', async () => {
    const home = activeProject();
    const a = agent('Worker');
    const team = workflows.save({ name: 'Home team', members: [a.id], lead: a.id, steps: [] } as Partial<Team>);
    saveProjects([...listProjects(), { ...home, id: 'other-1', name: 'Other' }]);
    hold();
    const n = calls;
    await postUserMessage(team.id, 'Do the thing');
    await wait(() => calls > n);
    setActiveProject('other-1');
    try {
      release();
      const file = (pid: string) => dataPath('projects', pid, 'teamchats', `${team.id}.json`);
      const msgs = (pid: string) => readJSON<{ messages: TeamMessage[] }>(file(pid), { messages: [] }).messages;
      await wait(() => msgs(home.id).length >= 2);
      expect(msgs(home.id).map((m) => m.text)).toEqual(['Do the thing', 'Late answer.']);
      expect(fs.existsSync(file('other-1'))).toBe(false);
    } finally {
      setActiveProject(home.id);
    }
  });
});

describe('old step lists', () => {
  it('tells step lists (tools, approvals, posts) from teams', () => {
    expect(isStepList({ steps: [{ type: 'agent', agentId: 'a' }] })).toBe(false);
    expect(isStepList({ steps: [{ type: 'agent', agentId: 'a' }, { type: 'approval' }] })).toBe(true);
    expect(isStepList(null)).toBe(false);
  });

  it('keeps the other steps when members change', () => {
    const steps = [
      { id: '1', type: 'agent', agentId: 'a', prompt: 'research {{input}}' },
      { id: '2', type: 'agent', agentId: 'b' },
      { id: '3', type: 'approval' },
      { id: '4', type: 'x_post' },
    ];
    expect(teamSteps({ steps, members: ['a', 'c'] }).map((s) => s.id || s.agentId)).toEqual(['1', 'c', '3', '4']);
    // a team's steps just mirror its members
    expect(teamSteps({ steps: [{ type: 'agent', agentId: 'a' }], members: ['b'] })).toEqual([{ type: 'agent', agentId: 'b' }]);
  });
});
