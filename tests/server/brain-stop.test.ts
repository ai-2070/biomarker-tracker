// The Brain stops an agent, a team, or everything running in the project.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyActions } from '../../server/overseer.ts';
import { newAgent } from '../../server/library.ts';
import { runs, saveSettings, workflows } from '../../server/store.ts';
import { startWorkflow } from '../../server/workflows.ts';
import { getThread, postUserMessage, teamState } from '../../server/teams.ts';
import { activeRuns, askAgent } from '../../server/engines/index.ts';
import type { Team } from '../../shared/types.ts';

// a fake model that never answers: it holds every request open until the client goes away
let server: http.Server;
let asked = 0;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    asked++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    req.on('close', () => res.end());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
});
// (a request a failed test left open would keep close() waiting: drop them all)
afterAll(() => new Promise<void>((r) => {
  server.close(() => r());
  server.closeAllConnections();
}));

const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};
const slow = (name: string) => newAgent({ name, engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
const running = (agentId: string) => activeRuns().some((r) => r.agentId === agentId);
const team = (name: string, members: string[]) => workflows.save({ name, members, lead: members[0], steps: members.map((agentId) => ({ type: 'agent' as const, agentId })), schedule: { type: 'none' }, enabled: false } as Partial<Team>);

describe('the Brain stops work', () => {
  it('stops an agent, and says so when it was not working', async () => {
    const a = slow('Busy bee');
    void askAgent(a, 'go').catch(() => {});
    await until(() => running(a.id));
    const r = applyActions([{ do: 'stop', to: 'agent', id: 'Busy bee' }]);
    expect(r.done).toEqual([expect.objectContaining({ kind: 'stop', agentId: a.id, text: 'Stopped Busy bee' })]);
    await until(() => !running(a.id));
    expect(applyActions([{ do: 'stop', to: 'agent', id: a.id }]).done[0]).toMatchObject({ kind: 'note', text: "Busy bee wasn't working" });
  });

  it('stopping an agent also takes it off the team turns it waits for', async () => {
    const a = slow('Queued one');
    const lead = slow('Room lead');
    const t = team('Two jobs', [lead.id, a.id]);
    await postUserMessage(t.id, '@Queued one first job');
    await until(() => teamState(t.id).working.includes(a.id));
    // a second job for it while it works: it waits in the queue
    await postUserMessage(t.id, '@Queued one second job');
    expect(teamState(t.id).queued).toEqual([a.id]);
    const r = applyActions([{ do: 'stop', to: 'agent', id: a.id }]);
    expect(r.done[0]).toMatchObject({ kind: 'stop', text: 'Stopped Queued one (and took it off 1 waiting team turn)' });
    await until(() => !running(a.id) && !teamState(t.id).working.length);
    // and it doesn't start on the second job once the first one is stopped
    await new Promise((res) => setTimeout(res, 150));
    expect(running(a.id)).toBe(false);
    expect(teamState(t.id).queued).toEqual([]);
    expect(getThread(t.id).messages.filter((m) => m.from === a.id).map((m) => m.text)).toEqual(['(stopped)']);
  });

  it('stops a team and its queue', async () => {
    const a = slow('Lead writer');
    const t = team('Writers room', [a.id]);
    await postUserMessage(t.id, 'write something');
    await until(() => teamState(t.id).working.length > 0);
    const r = applyActions([{ do: 'stop', to: 'team', id: 'Writers room' }]);
    expect(r.done[0]).toMatchObject({ kind: 'stop', teamId: t.id });
    await until(() => !teamState(t.id).working.length && !running(a.id));
    expect(teamState(t.id).queued).toEqual([]);
    expect(applyActions([{ do: 'stop', to: 'team', id: t.id }]).done[0]).toMatchObject({ kind: 'note' });
  });

  it('stops everything running in the project at once', async () => {
    const solo = slow('Solo runner');
    const member = slow('Crew member');
    const stepper = slow('Step agent');
    const t = team('Night crew', [member.id]);
    const wf = workflows.save({ name: 'Nightly', steps: [{ id: 's1', type: 'agent', agentId: stepper.id, label: 'Think', prompt: '{{input}}' }] } as Partial<Team>);
    void askAgent(solo, 'go').catch(() => {});
    await postUserMessage(t.id, 'go');
    const before = asked;
    const run = await startWorkflow(wf.id, 'go');
    await until(() => running(solo.id) && running(member.id) && running(stepper.id) && asked > before);

    const r = applyActions([{ do: 'stop', to: 'all' }]);
    expect(r.done).toHaveLength(1);
    expect(r.done[0].kind).toBe('stop');
    expect(r.done[0].text).toContain('teams Night crew');
    expect(r.done[0].text).toContain('Solo runner');
    expect(r.done[0].text).toContain('workflows Nightly');
    await until(() => ![solo, member, stepper].some((a) => running(a.id)));
    await until(() => runs.get(run.id)?.status !== 'running');
    expect(runs.get(run.id)?.status).toBe('stopped');

    expect(applyActions([{ do: 'stop', to: 'all' }]).done[0]).toMatchObject({ kind: 'note', text: expect.stringContaining('Nothing was running') });
  });

  it('says what it could not find', () => {
    const r = applyActions([{ do: 'stop', to: 'agent', id: 'ghost' }, { do: 'stop', to: 'team', id: 'nope' }, { do: 'stop' }]);
    expect(r.done.map((d) => d.kind)).toEqual(['error', 'error', 'error']);
    expect(r.done[2].text).toContain('"to" is agent, team or all');
  });
});
