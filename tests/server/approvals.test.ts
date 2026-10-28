// The Brain approves: it answers agents' permission requests and passes the unclear ones on to you.
import { describe, it, expect, afterEach } from 'vitest';
import { requestApproval, setReviewer, listApprovals, decide, cancelForRun } from '../../server/approvals.ts';
import { saveSettings, getSettings } from '../../server/store.ts';
import type { BrainVerdict } from '../../server/approvals.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  setReviewer(null);
  saveSettings({ brainApproves: true });
  for (const a of listApprovals()) decide(a.id, { approved: false });
});

describe('the Brain approves', () => {
  it('is on by default', () => {
    expect(getSettings().brainApproves).toBe(true);
  });

  it('allows a request the Brain approves, without showing it to you', async () => {
    let seen = '';
    setReviewer(async (item) => ((seen = item.title), { approve: true, reason: 'routine' }));
    const d = await requestApproval({ title: 'Coder wants to use Read', agentId: 'a1', agentName: 'Coder' });
    expect(d.approved).toBe(true);
    expect(seen).toBe('Coder wants to use Read');
    expect(listApprovals()).toHaveLength(0);
  });

  it('never decides a setting: an agent asking to change one goes to you', async () => {
    let asked = false;
    setReviewer(async () => ((asked = true), { approve: true, reason: 'fine' }));
    const p = requestApproval({ kind: 'setting', title: 'Mira wants to see the voxel world', agentId: 'a1', agentName: 'Mira' });
    await tick();
    expect(asked).toBe(false);
    const [a] = listApprovals();
    expect(a.kind).toBe('setting');
    decide(a.id, { approved: true });
    expect((await p).approved).toBe(true);
  });

  it('passes a request it does not approve on to you, with its reason', async () => {
    setReviewer(async () => ({ approve: false, reason: 'pushes to GitHub' }));
    const p = requestApproval({ title: 'Coder wants to use Bash', detail: 'git push', agentId: 'a1', agentName: 'Coder' });
    await tick();
    const [a] = listApprovals();
    expect(a.brainNote).toBe('pushes to GitHub');
    decide(a.id, { approved: false, message: 'not yet' });
    expect((await p).approved).toBe(false);
  });

  it('hides a request while the Brain checks it, and lets you answer first', async () => {
    let release: (v: BrainVerdict) => void = () => {};
    setReviewer(() => new Promise((r) => (release = r)));
    const p = requestApproval({ title: 'Slow check', agentId: 'a1', data: { runId: 'r1' } });
    expect(listApprovals()).toHaveLength(0);
    cancelForRun('r1');
    expect((await p).approved).toBe(false);
    release({ approve: true, reason: '' });
    await tick();
    expect(listApprovals()).toHaveLength(0);
  });

  it('asks you when the Brain fails', async () => {
    setReviewer(async () => {
      throw new Error('no model');
    });
    requestApproval({ title: 'Broken check', agentId: 'a1' });
    await tick();
    expect(listApprovals()[0].brainNote).toMatch(/no model/);
  });

  it('asks you when the Brain fails with something that is not an Error', async () => {
    setReviewer(() => Promise.reject('offline'));
    requestApproval({ title: 'Odd failure', agentId: 'a1' });
    await tick();
    expect(listApprovals()[0].brainNote).toMatch(/offline/);
  });

  it('never checks workflow checkpoints or outside MCP clients', async () => {
    let calls = 0;
    setReviewer(async () => (calls++, { approve: true, reason: '' }));
    requestApproval({ kind: 'workflow', title: 'Approve the post' });
    requestApproval({ title: 'External wants a tool', agentId: '_external' });
    await tick();
    expect(calls).toBe(0);
    expect(listApprovals()).toHaveLength(2);
  });

  it('asks you about everything when turned off', async () => {
    let calls = 0;
    setReviewer(async () => (calls++, { approve: true, reason: '' }));
    saveSettings({ brainApproves: false });
    requestApproval({ title: 'Coder wants to use Write', agentId: 'a1' });
    await tick();
    expect(calls).toBe(0);
    expect(listApprovals()).toHaveLength(1);
  });
});
