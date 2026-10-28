// The Brain's model, streamed: think() hands its text over as it is written (OpenRouter's SSE here),
// and run() reads a program's output line by line as it comes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveSettings, setSecret } from '../../server/store.ts';
import { think } from '../../server/brain.ts';
import type { ThinkPart } from '../../server/brain.ts';
import { run } from '../../server/util.ts';

afterEach(() => vi.unstubAllGlobals());

describe('think() with onPart', () => {
  it('OpenRouter: asks for a stream and hands each piece over as it comes', async () => {
    setSecret('openrouterKey', 'sk-or-test');
    saveSettings({ brain: { provider: 'openrouter', model: 'mock' } });
    let asked: Record<string, unknown> = {};
    // the server sends a piece, then waits: the first piece must arrive before the answer is over
    let release = () => {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      asked = JSON.parse(String(init.body));
      const enc = new TextEncoder();
      const piece = (d: string) => enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`);
      return new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(piece('Plan'));
            await new Promise<void>((r) => (release = r));
            c.enqueue(piece(' ready.'));
            c.enqueue(enc.encode('data: [DONE]\n\n'));
            c.close();
          },
        }),
        { status: 200 },
      );
    });
    const parts: ThinkPart[] = [];
    let ended = false;
    const thinking = think('system', 'user', { onPart: (p) => parts.push(p) }).finally(() => (ended = true));
    for (let i = 0; i < 100 && !parts.length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(parts).toEqual([{ kind: 'text', text: 'Plan' }]);
    expect(ended).toBe(false);
    release();
    const text = await thinking;
    expect(asked.stream).toBe(true);
    expect(text).toBe('Plan ready.');
    expect(parts).toEqual([
      { kind: 'text', text: 'Plan' },
      { kind: 'text', text: ' ready.' },
    ]);
  });

  it('streamed too, an answer cut off at the length limit is no answer', async () => {
    setSecret('openrouterKey', 'sk-or-test');
    saveSettings({ brain: { provider: 'openrouter', model: 'mock' } });
    vi.stubGlobal('fetch', async () => {
      const enc = new TextEncoder();
      const body = `data: ${JSON.stringify({ choices: [{ delta: { content: '{"half": ' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`;
      return new Response(new ReadableStream({ start: (c) => (c.enqueue(enc.encode(body)), c.close()) }), { status: 200 });
    });
    await expect(think('system', 'user', { onPart: () => {} })).rejects.toThrow(/cut off/);
  });

  it('without onPart nothing changes: one answer, not a stream', async () => {
    setSecret('openrouterKey', 'sk-or-test');
    saveSettings({ brain: { provider: 'openrouter', model: 'mock' } });
    let asked: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      asked = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Whole answer.' } }] }), { status: 200 });
    });
    expect(await think('system', 'user')).toBe('Whole answer.');
    expect(asked.stream).toBeUndefined();
  });
});

describe('run() with onLine', () => {
  it("gets each line of a program's output as it comes, the last one too", async () => {
    const lines: string[] = [];
    const r = await run(process.execPath, ['-e', "process.stdout.write('one\\ntwo\\nthree')"], { onLine: (l) => lines.push(l) });
    expect(r.code).toBe(0);
    expect(lines).toEqual(['one', 'two', 'three']);
  });

  it('a line longer than maxBytes is dropped, not kept growing; the lines after it still come', async () => {
    const lines: string[] = [];
    const script = "process.stdout.write('a\\n' + 'x'.repeat(5000) + '\\nb\\n')";
    await run(process.execPath, ['-e', script], { onLine: (l) => lines.push(l), maxBytes: 1000 });
    expect(lines).toEqual(['a', 'b']);
  });
});
