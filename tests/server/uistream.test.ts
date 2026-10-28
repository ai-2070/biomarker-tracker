// A run as a Vercel AI SDK UI message stream, read back with the AI SDK itself (its HTTP transport and
// stream reader): text as written, tool calls with input and result, status lines, a replay.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DefaultChatTransport, readUIMessageStream } from 'ai';
import type { UIMessage, UIMessageChunk } from 'ai';
import { emit } from '../../server/store.ts';
import { TurnChunks, readable, streamBrain, streamRun } from '../../server/uistream.ts';
import type { BrainStreamPart } from '../../server/uistream.ts';
import type { ChatItem, RunEvent } from '../../shared/types.ts';

let server: http.Server;
let base = '';
// what the next request streams: the items already there (a replay)
let replayItems: ChatItem[] = [];
// ?later: the run isn't known yet (a message waiting for the run before it to end); the test says which it is
let startLater: ((runId: string | null) => void) | null = null;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const runId = url.searchParams.get('run') || 'r1';
    const later = url.searchParams.has('later') ? new Promise<string | null>((r) => (startLater = r)) : null;
    void streamRun(res, { chatId: 'c1', runId: later ?? runId, items: replayItems, keepAliveMs: 20, waiting: 'Waiting for it to stop…' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const run = (event: RunEvent, runId = 'r1', chatId = 'c1') => emit('run', { runId, agentId: 'a1', chatId, event });
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

async function read(runId = 'r1', drive: () => Promise<void>): Promise<{ last: UIMessage; data: unknown[] }> {
  const data: unknown[] = [];
  const transport = new DefaultChatTransport({ api: `${base}/?run=${runId}`, prepareReconnectToStreamRequest: () => ({ api: `${base}/?run=${runId}` }) });
  const stream = (await transport.reconnectToStream({ chatId: 'c1' }))!;
  // (transient data parts, the status lines, come through the stream but don't stay in the message)
  const [a, b] = stream.tee();
  const collecting = (async () => {
    for await (const c of b as unknown as AsyncIterable<UIMessageChunk>) if (c.type.startsWith('data-')) data.push(c);
  })();
  const reading = (async () => {
    let last: UIMessage | null = null;
    for await (const m of readUIMessageStream({ stream: a })) last = structuredClone(m);
    return last!;
  })();
  await tick(30);
  await drive();
  const last = await reading;
  await collecting;
  return { last, data };
}

describe('streamRun()', () => {
  it('a live run: text, a tool call with its result, a status line, then the end', async () => {
    replayItems = [];
    const { last, data } = await read('r1', async () => {
      run({ kind: 'text', text: 'Rendering ' });
      run({ kind: 'text', text: 'now.' });
      run({ kind: 'status', text: 'Using blender…' });
      run({ kind: 'tool', id: 't1', name: 'blender_run_python', args: { code: 'x' } });
      // another run, another chat: not this one
      run({ kind: 'text', text: 'NOT MINE' }, 'r-other');
      run({ kind: 'text', text: 'NOT MINE' }, 'r1', 'c2');
      await tick(40);
      run({ kind: 'tool_result', id: 't1', text: 'done', images: ['/a.png'] });
      run({ kind: 'tool', id: 't2', name: 'ffmpeg', args: {} });
      run({ kind: 'tool_result', id: 't2', text: 'boom', isError: true });
      run({ kind: 'text', text: 'Saved.' });
      run({ kind: 'done', text: '' });
    });
    expect(last.role).toBe('assistant');
    expect(last.id).toBe('run-r1');
    const parts = last.parts.filter((p) => p.type !== 'step-start');
    expect(parts.map((p) => p.type)).toEqual(['text', 'dynamic-tool', 'dynamic-tool', 'text']);
    expect(parts[0]).toMatchObject({ type: 'text', text: 'Rendering now.', state: 'done' });
    expect(parts[1]).toMatchObject({ toolName: 'blender_run_python', state: 'output-available', input: { code: 'x' }, output: { text: 'done', images: ['/a.png'] } });
    expect(parts[2]).toMatchObject({ toolName: 'ffmpeg', state: 'output-error', errorText: 'boom' });
    expect(parts[3]).toMatchObject({ text: 'Saved.' });
    expect(data).toEqual([expect.objectContaining({ type: 'data-status', data: { text: 'Using blender…' }, transient: true })]);
  });

  it('opening while it runs: the turn so far first, then the rest', async () => {
    replayItems = [
      { type: 'user', text: 'go' },
      { type: 'assistant', text: 'Reading the brief. ' },
      { type: 'tool', id: 'r', name: 'read_file', args: { path: 'brief.md' }, result: 'the brief', status: 'done' },
      { type: 'tool', id: 'w', name: 'write_file', args: { path: 'out.md' }, result: null, status: 'running' },
    ];
    const { last } = await read('r2', async () => {
      run({ kind: 'tool_result', id: 'w', text: 'written' }, 'r2');
      run({ kind: 'text', text: 'All done.' }, 'r2');
      run({ kind: 'error', text: 'Stopped.' }, 'r2');
    });
    const parts = last.parts.filter((p) => p.type !== 'step-start');
    expect(parts.map((p) => (p.type === 'text' ? p.text : (p as { toolName: string }).toolName))).toEqual(['Reading the brief. ', 'read_file', 'write_file', 'All done.']);
    expect(parts[1]).toMatchObject({ state: 'output-available', output: { text: 'the brief', images: [] } });
    expect(parts[2]).toMatchObject({ state: 'output-available', output: { text: 'written', images: [] } });
  });
});

describe('streamRun() for a run that starts later', () => {
  it('says it is waiting, then streams that run once it starts (nothing from before)', async () => {
    replayItems = [];
    const { last, data } = await read('r20&later', async () => {
      run({ kind: 'text', text: 'NOT MINE: the run before it' }, 'r19');
      startLater!('r20');
      await tick(10);
      run({ kind: 'text', text: 'On the new plan.' }, 'r20');
      run({ kind: 'done', text: '' }, 'r20');
    });
    const parts = last.parts.filter((p) => p.type !== 'step-start');
    expect(parts).toEqual([expect.objectContaining({ type: 'text', text: 'On the new plan.' })]);
    expect(data).toEqual([expect.objectContaining({ type: 'data-status', data: { text: 'Waiting for it to stop…' } })]);
  });

  it('ends, with nothing in it, when that run never starts (it was taken back)', async () => {
    replayItems = [];
    const { last } = await read('r21&later', async () => {
      startLater!(null);
    });
    expect(last.parts.filter((p) => p.type !== 'step-start')).toEqual([]);
  });
});

describe('streamRun() when the run fails', () => {
  it("ends with the AI SDK's error (so the chat can say so); being stopped is no error", async () => {
    replayItems = [];
    const errors: string[] = [];
    const transport = new DefaultChatTransport({ api: `${base}/?run=r9`, prepareReconnectToStreamRequest: () => ({ api: `${base}/?run=r9` }) });
    const stream = (await transport.reconnectToStream({ chatId: 'c1' }))!;
    const reading = (async () => {
      for await (const _m of readUIMessageStream({ stream, onError: (e) => errors.push(String((e as Error).message)) }));
    })();
    await tick(30);
    run({ kind: 'text', text: 'Trying' }, 'r9');
    run({ kind: 'error', text: 'Claude Code exited (1) without an answer.' }, 'r9');
    await reading;
    expect(errors).toEqual(['Claude Code exited (1) without an answer.']);

    const errors2: string[] = [];
    const t2 = new DefaultChatTransport({ api: `${base}/?run=r10`, prepareReconnectToStreamRequest: () => ({ api: `${base}/?run=r10` }) });
    const s2 = (await t2.reconnectToStream({ chatId: 'c1' }))!;
    const r2 = (async () => {
      for await (const _m of readUIMessageStream({ stream: s2, onError: (e) => errors2.push(String(e)) }));
    })();
    await tick(30);
    run({ kind: 'error', text: 'Stopped to take your new message.' }, 'r10');
    await r2;
    expect(errors2).toEqual([]);
  });
});

describe('TurnChunks', () => {
  it('opens and closes text around tool calls, and finishes once', () => {
    const out: UIMessageChunk[] = [];
    const w = new TurnChunks((c) => out.push(c));
    w.start('m');
    w.text('a');
    w.tool('t', 'x', null);
    w.text('b');
    w.finish();
    w.finish();
    expect(out.map((c) => c.type)).toEqual(['start', 'start-step', 'text-start', 'text-delta', 'text-end', 'tool-input-available', 'text-start', 'text-delta', 'text-end', 'finish-step', 'finish']);
    expect(out[5]).toMatchObject({ input: {}, dynamic: true });
  });
});

describe('streamBrain()', () => {
  let brainServer: http.Server;
  let brainBase = '';
  let script: (onPart: (p: BrainStreamPart) => void) => Promise<unknown> = async () => ({});
  beforeAll(async () => {
    brainServer = http.createServer((_req, res) => void streamBrain(res, (onPart) => script(onPart)));
    await new Promise<void>((r) => brainServer.listen(0, '127.0.0.1', () => r()));
    brainBase = `http://127.0.0.1:${(brainServer.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => brainServer.close(() => r())));

  async function ask(): Promise<{ last: UIMessage; errors: string[] }> {
    const transport = new DefaultChatTransport({ api: brainBase, prepareSendMessagesRequest: () => ({ body: { text: 'hi' } }) });
    const stream = await transport.sendMessages({ chatId: 'brain', messages: [], trigger: 'submit-message', messageId: undefined, abortSignal: undefined });
    const errors: string[] = [];
    let last: UIMessage | null = null;
    for await (const m of readUIMessageStream({ stream, onError: (e) => errors.push(String((e as Error).message || e)) })) last = structuredClone(m);
    return { last: last!, errors };
  }
  const text = (m: UIMessage) => {
    const at = m.parts.findLastIndex((p) => p.type === 'data-restart');
    return m.parts.slice(at + 1).map((p) => (p.type === 'text' ? p.text : '')).join('');
  };

  it('the answer as it is written, never its actions block (even split across pieces), then the whole answer', async () => {
    script = async (onPart) => {
      for (const t of ['I made the ', 'team.\n\n`', '``act', 'ions\n[{"do":"create_team"}]\n```']) onPart({ kind: 'text', text: t });
      return { answer: 'I made the team.', done: [{ kind: 'team', text: 'Made "Thumbs"' }], delegate: null };
    };
    const { last } = await ask();
    expect(text(last)).toBe('I made the team.\n\n');
    expect(text(last)).not.toContain('`');
    expect(last.parts.find((p) => p.type === 'data-answer')).toMatchObject({ data: { answer: 'I made the team.', done: [{ kind: 'team' }] } });
  });

  it('the files it reads show as tool calls; answering again replaces what it wrote', async () => {
    script = async (onPart) => {
      onPart({ kind: 'text', text: 'Let me open that skill.' });
      onPart({ kind: 'restart' });
      onPart({ kind: 'tool', id: 'g', name: 'Read', args: { file_path: 'BRAIN.md' } });
      onPart({ kind: 'tool_result', id: 'g', text: '# Brain' });
      onPart({ kind: 'text', text: 'Here is the plan.' });
      return { answer: 'Here is the plan.', done: [], delegate: null };
    };
    const { last } = await ask();
    expect(text(last)).toBe('Here is the plan.');
    expect(last.parts.find((p) => p.type === 'dynamic-tool')).toMatchObject({ toolName: 'Read', state: 'output-available', output: { text: '# Brain' } });
  });

  it('an answer ending in `code` keeps its closing backtick; an ACTIONS fence in any case stays hidden', async () => {
    script = async (onPart) => {
      for (const t of ['Run ', '`npm test`']) onPart({ kind: 'text', text: t });
      return { answer: 'Run `npm test`', done: [], delegate: null };
    };
    expect(text((await ask()).last)).toBe('Run `npm test`');
    script = async (onPart) => {
      for (const t of ['Done.\n', '```ACTIONS\n[{"do":"x"}]\n```']) onPart({ kind: 'text', text: t });
      return { answer: 'Done.', done: [], delegate: null };
    };
    expect(text((await ask()).last)).toBe('Done.\n');
  });

  it('a Brain that fails says why', async () => {
    script = async () => {
      throw new Error('Codex is not signed in.');
    };
    const { last, errors } = await ask();
    expect(errors.join(' ')).toContain('Codex is not signed in.');
    expect(last.parts.some((p) => p.type === 'data-answer')).toBe(false);
  });
});

describe('readable()', () => {
  it('cuts at the actions block, and holds back the start of its fence', () => {
    expect(readable('Done.\n```actions\n[]\n```')).toBe('Done.\n');
    expect(readable('Done.\n``')).toBe('Done.\n');
    expect(readable('Done.\n```acti')).toBe('Done.\n');
    expect(readable('Use `npm test` to check')).toBe('Use `npm test` to check');
    expect(readable('Done.\n```Actions\n[]')).toBe('Done.\n');
    expect(readable('Done.\n```AC')).toBe('Done.\n');
    // at the end, only the fence itself is cut
    expect(readable('Run `npm test`', true)).toBe('Run `npm test`');
  });
});
