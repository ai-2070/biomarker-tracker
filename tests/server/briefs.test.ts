// The Brain's list of handed-out work keeps every open brief, however many finished ones pile up.
import { describe, expect, it } from 'vitest';
import { addBrief, listBriefs, openBrief, updateBrief } from '../../server/briefs.ts';

const brief = (n: number) => addBrief({ kind: 'agent', targetId: `agent-${n}`, name: `Agent ${n}`, text: `job ${n}`, ts: n });

describe('briefs', () => {
  it('a new brief to the same agent replaces the open one', () => {
    const a = addBrief({ kind: 'team', targetId: 't1', name: 'T', text: 'one', ts: 1 });
    const b = addBrief({ kind: 'team', targetId: 't1', name: 'T', text: 'two', ts: 2 });
    expect(listBriefs().find((x) => x.id === a.id)?.status).toBe('replaced');
    expect(openBrief('team', 't1')?.id).toBe(b.id);
  });

  it('keeps every open brief and only the last 40 finished ones', () => {
    const open = Array.from({ length: 45 }, (_, i) => brief(i));
    expect(listBriefs().filter((b) => b.status === 'open' && b.kind === 'agent').length).toBe(45);
    for (const b of open.slice(0, 44)) updateBrief(b.id, { status: 'done' });
    const list = listBriefs();
    // the last one is still open after 44 finished ones, and the oldest finished ones went
    expect(list.find((b) => b.id === open[44].id)?.status).toBe('open');
    expect(list.filter((b) => b.status !== 'open').length).toBe(40);
    expect(list.some((b) => b.id === open[0].id)).toBe(false);
    // and 50 more open ones don't push any open brief out
    for (let i = 100; i < 150; i++) brief(i);
    expect(listBriefs().filter((b) => b.status === 'open' && b.kind === 'agent').length).toBe(51);
  });
});
