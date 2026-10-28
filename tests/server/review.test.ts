// The Brain's check of a permission request: what it reads, and when it leaves the call to you.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Approval } from '../../shared/types.ts';

const brain = vi.hoisted(() => ({ prompts: [] as string[], answer: '{"approve":true,"reason":"routine edit"}' }));
const runs = vi.hoisted(() => ({ projectId: '' }));

vi.mock('../../server/brain.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/brain.ts')>()),
  think: async (_system: string, user: string) => (brain.prompts.push(user), brain.answer),
}));
vi.mock('../../server/engines/index.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/engines/index.ts')>()),
  runInfo: (id: string | null | undefined) => (id === 'r1' && runs.projectId ? { id, agentId: 'a1', projectId: runs.projectId, chatId: 'c1', depth: 0, signal: new AbortController().signal } : null),
}));

const { reviewApproval, REVIEW_MAX } = await import('../../server/overseer.ts');
const { activeProject, withProject } = await import('../../server/store.ts');

const request = (over: Partial<Approval> = {}): Approval => ({
  id: 'ap1', kind: 'tool', title: 'Coder wants to use write_file', detail: 'notes.md', agentId: 'a1', agentName: 'Coder',
  data: { tool: 'write_file', args: { path: 'notes.md', content: 'hello' } }, editable: null, createdAt: Date.now(), ...over,
});

beforeEach(() => {
  brain.prompts = [];
  brain.answer = '{"approve":true,"reason":"routine edit"}';
  runs.projectId = '';
});

describe('the Brain reviews a request', () => {
  it('returns its verdict', async () => {
    expect(await reviewApproval(request())).toEqual({ approve: true, reason: 'routine edit' });
    brain.answer = 'Hmm. {"approve":false,"reason":"pushes"}';
    expect(await reviewApproval(request())).toEqual({ approve: false, reason: 'pushes' });
  });

  it('only approves on a plain true', async () => {
    brain.answer = '{"approve":"yes"}';
    expect((await reviewApproval(request())).approve).toBe(false);
  });

  it('fails when the answer is not JSON (so you get asked)', async () => {
    brain.answer = 'sure, go ahead';
    await expect(reviewApproval(request())).rejects.toThrow(/JSON/);
  });

  it('reads the whole call, not the shortened card text', async () => {
    const content = `${'a'.repeat(3000)}\nrm -rf ~`;
    await reviewApproval(request({ detail: content.slice(0, 1500), data: { tool: 'write_file', args: { path: 'x.sh', content } } }));
    expect(brain.prompts[0]).toContain('rm -rf ~');
  });

  it('leaves a request too long to read in full to you, without asking the model', async () => {
    const v = await reviewApproval(request({ data: { tool: 'run_command', args: { command: `echo ${'x'.repeat(REVIEW_MAX)}` } } }));
    expect(v.approve).toBe(false);
    expect(v.reason).toMatch(/too long/);
    expect(brain.prompts).toHaveLength(0);
  });

  it('leaves it to you when you switched projects while the agent worked', async () => {
    runs.projectId = 'some-other-project';
    const v = await reviewApproval(request({ data: { runId: 'r1', args: {} } }));
    expect(v.approve).toBe(false);
    expect(brain.prompts).toHaveLength(0);
    runs.projectId = activeProject().id;
    expect((await reviewApproval(request({ data: { runId: 'r1', args: {} } }))).approve).toBe(true);
  });

  it('leaves it to you when the request comes from a run still working in a project you left', async () => {
    // the run is pinned to its own project, so compare with the one open in the dashboard
    const left = { ...activeProject(), id: 'left-behind', name: 'Left behind' };
    runs.projectId = left.id;
    const v = await withProject(left, () => reviewApproval(request({ data: { runId: 'r1', args: {} } })));
    expect(v.approve).toBe(false);
    expect(brain.prompts).toHaveLength(0);
  });
});
