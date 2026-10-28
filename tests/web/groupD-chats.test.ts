import { describe, expect, it } from 'vitest';
import { mergeSnapshot } from '../../web/teamchat.tsx';
import { isTeamSession } from '../../web/agentchat.tsx';
import type { TeamMessage } from '../../shared/types.ts';

const msg = (id: string, ts: number): TeamMessage => ({ id, ts, from: 'user', text: id, mentions: [] });

describe('mergeSnapshot()', () => {
  it('keeps messages that arrived live while the first load was on its way', () => {
    const merged = mergeSnapshot([msg('a', 1), msg('b', 2)], [msg('b', 2), msg('c', 3)], false);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores a snapshot from before a clear', () => {
    expect(mergeSnapshot([msg('a', 1)], [msg('c', 3)], true).map((m) => m.id)).toEqual(['c']);
  });
});

describe('isTeamSession()', () => {
  const chat = { id: 'c1', title: 'Hello', updatedAt: 0, createdAt: 0, count: 0 };
  it('uses the teamId when the chat has one, even after a rename', () => {
    expect(isTeamSession({ ...chat, teamId: 't1' })).toBe(true);
    expect(isTeamSession(chat)).toBe(false);
  });
  it('falls back to the title for older sessions', () => {
    expect(isTeamSession({ ...chat, title: 'Team: Social' })).toBe(true);
  });
});
