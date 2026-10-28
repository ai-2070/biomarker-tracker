// The Brain on Codex, streamed: a tool step starts once (item.started), however often Codex says it is
// still going (item.updated), and its result comes once (item.completed).
import { describe, expect, it, vi } from 'vitest';
import { saveSettings } from '../../server/store.ts';
import type { ThinkPart } from '../../server/brain.ts';

// a fake codex: its JSON lines, handed over one by one
const lines = vi.hoisted(() => [] as string[]);
vi.mock('../../server/util.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/util.ts')>()),
  which: (cmd: string) => (cmd === 'codex' ? '/usr/bin/codex' : null),
  run: async (_cmd: string, _args: string[], o: { onLine?: (l: string) => void }) => {
    for (const l of lines) o.onLine?.(l);
    return { code: 0, stdout: lines.join('\n'), stderr: '' };
  },
}));

describe('think() on Codex with onPart', () => {
  it('each tool step once, then its result, then the answer', async () => {
    saveSettings({ brain: { provider: 'codex', model: '' } });
    const ev = (type: string, item: object) => JSON.stringify({ type, item });
    lines.push(
      ev('item.started', { id: 'c1', type: 'command_execution', command: 'ls notes' }),
      ev('item.updated', { id: 'c1', type: 'command_execution', command: 'ls notes' }),
      ev('item.updated', { id: 'c1', type: 'command_execution', command: 'ls notes' }),
      ev('item.completed', { id: 'c1', type: 'command_execution', command: 'ls notes', aggregated_output: 'plan.md', exit_code: 0 }),
      ev('item.completed', { id: 'm1', type: 'agent_message', text: 'Your notes have a plan.' }),
    );
    const { think } = await import('../../server/brain.ts');
    const parts: ThinkPart[] = [];
    const answer = await think('system', 'user', { onPart: (p) => parts.push(p) });
    expect(answer).toBe('Your notes have a plan.');
    expect(parts).toEqual([
      { kind: 'tool', id: 'c1', name: 'Bash', args: { command: 'ls notes' } },
      { kind: 'tool_result', id: 'c1', text: 'plan.md', isError: false },
      { kind: 'text', text: 'Your notes have a plan.' },
    ]);
  });
});
