// The Brain chat follows a team it handed work to: replies that came before it started following
// (loaded from the team chat) and live ones are merged, each once and in order.
import { describe, expect, it } from 'vitest';
import { mergeTeamMessages } from '../../web/dock.tsx';
import type { TeamMessage } from '../../shared/types.ts';

const msg = (id: string, from: string, ts: number): TeamMessage => ({ id, from, ts, text: id, mentions: [] });

describe('mergeTeamMessages()', () => {
  it('keeps replies since the brief, not yours or the brief itself, each once, in order', () => {
    const it = { since: 100, briefId: 'brief', messages: [] as TeamMessage[] };
    // a live reply arrived first
    mergeTeamMessages(it, [msg('m3', 'agent-b', 130)]);
    // then the team chat as loaded: older, the brief, your own message, and the same live reply again
    mergeTeamMessages(it, [msg('old', 'agent-a', 50), msg('brief', 'brain', 100), msg('m1', 'agent-a', 110), msg('you', 'user', 115), msg('m2', 'brain', 120), msg('m3', 'agent-b', 130)]);
    expect(it.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});
