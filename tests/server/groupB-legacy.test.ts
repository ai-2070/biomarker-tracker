// Old step-list workflows next to teams: the Brain, clones and the scheduler leave their steps alone.
// Also: the Brain's partial access updates and its model fallback.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyActions } from '../../server/overseer.ts';
import { cloneTeam } from '../../server/presets.ts';
import { brainModel } from '../../server/brain.ts';
import { startScheduler } from '../../server/workflows.ts';
import { getThread } from '../../server/teams.ts';
import { agents, runs, saveSettings, workflows } from '../../server/store.ts';
import { clearWhichCache } from '../../server/util.ts';
import { newAgent } from '../../server/library.ts';
import type { Team } from '../../shared/types.ts';

// an old "Daily X post": research, write, approve, send to the Outbox (no members field)
function stepList() {
  const r = newAgent({ name: 'Researcher' });
  const w = newAgent({ name: 'X Writer' });
  const wf = workflows.save({
    name: 'Daily X post',
    description: 'Research and post',
    steps: [
      { id: 's1', type: 'agent', agentId: r.id, prompt: 'Research {{input}}' },
      { id: 's2', type: 'agent', agentId: w.id, prompt: 'Write a post\n\n{{prev}}' },
      { id: 's3', type: 'approval', label: 'Approve the post' },
      { id: 's4', type: 'x_post', text: '{{prev}}' },
    ],
  } as Partial<Team>);
  return { r, w, wf };
}

describe('the Brain and old step lists', () => {
  it('adds a member without dropping the approval and Outbox steps', () => {
    const { r, w, wf } = stepList();
    const extra = newAgent({ name: 'Editor' });
    const { done } = applyActions([{ do: 'add_members', team: wf.id, members: [{ agent: extra.id }] }]);
    expect(done[0].kind).toBe('team');
    const saved = workflows.get(wf.id)!;
    expect(saved.members).toEqual([r.id, w.id, extra.id]);
    expect(saved.steps.map((s) => s.type)).toEqual(['agent', 'agent', 'agent', 'approval', 'x_post']);
    expect(saved.steps[0].prompt).toBe('Research {{input}}');
  });

  it('removes a member and keeps the rest of the chain', () => {
    const { r, w, wf } = stepList();
    applyActions([{ do: 'remove_members', team: wf.id, agents: [r.id] }]);
    const saved = workflows.get(wf.id)!;
    expect(saved.members).toEqual([w.id]);
    expect(saved.steps.map((s) => s.id)).toEqual(['s2', 's3', 's4']);
  });
});

describe('update_team access', () => {
  it('changes only the list that was given', () => {
    const a = newAgent({ name: 'Solo' });
    const wf = workflows.save({ name: 'Access team', members: [a.id], steps: [], access: { toolGroups: ['web'], mcpServers: ['keep-me'] } } as Partial<Team>);
    applyActions([{ do: 'update_team', team: wf.id, access: { tools: ['files'] } }]);
    expect(workflows.get(wf.id)!.access).toEqual({ toolGroups: ['files'], mcpServers: ['keep-me'] });
    applyActions([{ do: 'update_team', team: wf.id, access: { mcpServers: [] } }]);
    expect(workflows.get(wf.id)!.access).toEqual({ toolGroups: ['files'], mcpServers: [] });
  });
});

describe('cloning an old step list', () => {
  it('copies its roster and its steps', () => {
    const { r, w, wf } = stepList();
    const copy = cloneTeam(wf.id);
    expect(copy.members).toEqual([r.id, w.id]);
    expect(copy.steps.map((s) => s.type)).toEqual(['agent', 'agent', 'approval', 'x_post']);
  });

  it('points the steps at the copied agents', () => {
    const { r, wf } = stepList();
    const copy = cloneTeam(wf.id, { withAgents: true });
    expect(copy.members).toHaveLength(2);
    expect(copy.members).not.toContain(r.id);
    expect(copy.steps[0].agentId).toBe(copy.members[0]);
    expect(agents.get(copy.members[0])?.name).toBe('Researcher (copy)');
  });
});

describe('the scheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('runs a scheduled step list through its steps, and messages a scheduled team', async () => {
    const notify = workflows.save({ name: 'Ping', steps: [{ id: 'n', type: 'notify', text: 'Hello {{input}}' }], schedule: { type: 'interval', input: 'there' }, enabled: true } as Partial<Team>);
    const a = newAgent({ name: 'Scout', engine: 'openai', provider: 'nowhere', model: 'x', toolGroups: [] });
    const team = workflows.save({ name: 'Scouts', members: [a.id], lead: a.id, steps: [], schedule: { type: 'interval', input: 'Morning check' }, enabled: true } as Partial<Team>);
    vi.useFakeTimers({ toFake: ['setInterval'] });
    startScheduler();
    vi.advanceTimersByTime(30_000);
    vi.useRealTimers();
    const run = runs.list().find((x) => x.workflowId === notify.id);
    expect(run?.trigger).toBe('schedule');
    expect(run?.steps.map((s) => s.type)).toEqual(['notify']);
    expect(getThread(team.id).messages[0]).toMatchObject({ from: 'user', text: 'Morning check' });
    expect(getThread(notify.id).messages).toEqual([]);
  });
});

describe('brainModel()', () => {
  it('falls back to Hermes or Codex when they are the only ones installed', () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-bin-'));
    for (const f of ['hermes', 'hermes.cmd']) fs.writeFileSync(path.join(bin, f), '');
    const oldPath = process.env.PATH;
    process.env.PATH = bin;
    clearWhichCache();
    try {
      saveSettings({ brain: { provider: 'codex', model: 'gpt-x' } });
      expect(brainModel()).toMatchObject({ provider: 'hermes', model: '', fallback: true });
    } finally {
      process.env.PATH = oldPath;
      clearWhichCache();
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});
