// Rich answers: the agent's instructions carry OpenUI's component prompt only in your own chats with it.
import { describe, expect, it, vi } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { agents, chats } from '../../server/store.ts';
import { askAgent, memoryOf, startRun } from '../../server/engines/index.ts';
import { richFor, richSection } from '../../server/richanswers.ts';
import type { Chat } from '../../shared/types.ts';

// a fake Claude Code: records the instructions it was given
const seen = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('../../server/engines/claude.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/engines/claude.ts')>()),
  run: async ({ systemPrompt, chat }: { systemPrompt: string; chat: Chat }) => {
    seen.prompts.push(systemPrompt);
    chat.sessionId = 's';
    return { text: 'ok' };
  },
}));

describe('richFor()', () => {
  it('only for an agent with it on, in a chat of your own', () => {
    expect(richFor({ richAnswers: true }, {}, 0)).toBe(true);
    expect(richFor({ richAnswers: false }, {}, 0)).toBe(false);
    expect(richFor({}, {}, 0)).toBe(false);
    // a team chat, or asked by another agent / a routine
    expect(richFor({ richAnswers: true }, { teamId: 't1' }, 0)).toBe(false);
    expect(richFor({ richAnswers: true }, {}, 1)).toBe(false);
  });
});

describe('richSection()', () => {
  it("is OpenUI's component prompt, built from the library the chat renders with", async () => {
    const s = await richSection({ richAnswers: true }, {}, 0);
    expect(s).toContain('Rich answers');
    expect(s).toContain('openui-lang');
    expect(s).toContain('root = Card(');
    expect(await richSection({ richAnswers: false }, {}, 0)).toBe('');
  }, 30_000);
});

describe('in a run', () => {
  it('your chat with the agent gets it; the same agent asked by another does not', async () => {
    const a = newAgent({ name: 'Analyst', engine: 'claude-code', toolGroups: [] });
    agents.save({ ...agents.get(a.id)!, richAnswers: true });
    const fresh = agents.get(a.id)!;
    await startRun(fresh, chats.create(a.id), 'compare A and B').promise;
    expect(seen.prompts.at(-1)).toContain('openui-lang');
    await askAgent(fresh, 'compare A and B', { depth: 1, from: 'Planner' });
    expect(seen.prompts.at(-1)).not.toContain('openui-lang');
    // and with it off, never
    agents.save({ ...fresh, richAnswers: false });
    await startRun(agents.get(a.id)!, chats.create(a.id), 'again').promise;
    expect(seen.prompts.at(-1)).not.toContain('openui-lang');
  }, 30_000);

  it("the memory meter counts Rich answers' instructions only for the chats that get them", async () => {
    const a = newAgent({ name: 'Metered', engine: 'claude-code', toolGroups: [] });
    agents.save({ ...agents.get(a.id)!, richAnswers: true });
    const fresh = agents.get(a.id)!;
    const mine = chats.create(a.id);
    await startRun(fresh, mine, 'compare A and B').promise;
    await askAgent(fresh, 'compare A and B', { depth: 1, from: 'Planner' });
    const handed = chats.list(a.id).find((c) => c.title === 'Asked by Planner')!;
    const direct = (await memoryOf(fresh, mine.id)).tokens;
    const other = (await memoryOf(fresh, handed.id)).tokens;
    // (OpenUI's prompt is about 13k tokens)
    expect(direct - other).toBeGreaterThan(10_000);
    expect(chats.get(a.id, handed.id)!.rich).toBe(false);
    expect(chats.get(a.id, mine.id)!.rich).toBe(true);
  }, 30_000);
});
