// Sending a draft back to its team: your note goes to the author in the team chat, and the draft leaves the Outbox.
import { describe, expect, it, vi } from 'vitest';
import type { OutboxItem } from '../../server/social.ts';

const items = new Map<string, OutboxItem>();
vi.mock('../../server/store.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/store.ts')>()),
  outbox: { get: (id: string) => items.get(id) ?? null, save: (x: OutboxItem) => (items.set(x.id, x), x) },
  log: () => ({}),
  emit: () => {},
}));
vi.mock('../../server/artifacts.ts', () => ({ teamOf: (agentId: string) => (agentId === 'solo' ? { id: 't9', name: 'Solo team' } : null) }));

const { returnPost } = await import('../../server/social.ts');

const draft = (over: Partial<OutboxItem> = {}): OutboxItem => {
  const it: OutboxItem = { id: 'p1', platform: 'x', accountLabel: '@me', parts: ['First line\nsecond line', 'Part two'], images: ['C:\proj\hero.png'], status: 'pending', agentId: 'a1', agentName: 'Social Writer', teamId: 't1', teamName: 'Social', ...over };
  items.set(it.id, it);
  return it;
};

describe('returnPost', () => {
  it('posts your note to the draft\'s team, addressed to its author, and marks the draft sent back', async () => {
    draft();
    const send = vi.fn(async () => undefined);
    const r = await returnPost('p1', 'Make it shorter', send);
    expect(send).toHaveBeenCalledOnce();
    const [teamId, text] = send.mock.calls[0] as unknown as [string, string];
    expect(teamId).toBe('t1');
    expect(text).toContain('@Social Writer');
    expect(text).toContain('> First line\n> second line');
    expect(text).toContain('hero.png');
    expect(text).toContain('Make it shorter');
    expect(r.status).toBe('returned');
    expect(r.reason).toBe('Make it shorter');
  });

  it('needs a note, a waiting draft and a team', async () => {
    const send = vi.fn(async () => undefined);
    draft();
    await expect(returnPost('p1', '  ', send)).rejects.toThrow(/what should change/);
    draft({ status: 'posted' });
    await expect(returnPost('p1', 'x', send)).rejects.toThrow(/waiting/);
    draft({ teamId: null, agentId: 'nobody' });
    await expect(returnPost('p1', 'x', send)).rejects.toThrow(/isn't linked to a team/);
    expect(send).not.toHaveBeenCalled();
  });

  it('finds the team of an agent that is on exactly one when the draft has none', async () => {
    draft({ teamId: undefined, teamName: undefined, agentId: 'solo' });
    const send = vi.fn(async () => undefined);
    await returnPost('p1', 'ok', send);
    expect((send.mock.calls[0] as unknown as [string])[0]).toBe('t9');
  });

  it('leaves the draft waiting if the team chat refuses the message', async () => {
    const it = draft();
    await expect(returnPost('p1', 'Shorter', async () => { throw new Error('This team has no agents yet.'); })).rejects.toThrow(/no agents/);
    expect(items.get('p1')?.status).toBe('pending');
    expect(it.status).toBe('pending');
  });
});
