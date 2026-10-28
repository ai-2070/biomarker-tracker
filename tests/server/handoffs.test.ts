// Handing work to another agent without waiting: ask_agent returns a handle at once, await_agent
// collects the answer (again and again while the work goes on), and only the asker can collect it.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { saveSettings } from '../../server/store.ts';
import { callTool } from '../../server/tools.ts';

// a fake model: answers "Done: <task>" after `delay` ms
let delay = 0;
let server: http.Server;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body) as { messages: { content: string }[] };
    const task = String(j.messages.at(-1)!.content).split('\n').at(-1);
    await new Promise((r) => setTimeout(r, delay));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `Done: ${task}` } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const agent = (name: string, toolGroups: string[] = []) => newAgent({ name, engine: 'openai', provider: 'custom', model: 'mock', toolGroups });
const handleOf = (text: string) => /handle (h\w+)/.exec(text)![1];

describe('ask_agent and await_agent', () => {
  it('returns a handle at once; await_agent waits for the answer', async () => {
    delay = 300;
    const boss = agent('Boss', ['agents']);
    const helper = agent('Helper');
    const sent = await callTool(boss, 'ask_agent', { agent: helper.name, message: 'count the files' }, { depth: 0 });
    expect(sent.isError).toBe(false);
    expect(sent.text).toMatch(/^Sent to Helper \(handle h\w+\)/);
    // back before the work is done
    expect((await callTool(boss, 'await_agent', {}, { depth: 0 })).text).toMatch(/→ Helper: "count the files" — working/);
    const got = await callTool(boss, 'await_agent', { handle: handleOf(sent.text) }, { depth: 0 });
    expect(got).toMatchObject({ text: 'Helper says:\nDone: count the files', isError: false });
    // (still there for a later look)
    expect((await callTool(boss, 'await_agent', {}, { depth: 0 })).text).toMatch(/→ Helper: "count the files" — done, answer ready/);
  });

  it('several at once run in parallel; a short wait says it is still going, and again collects it', async () => {
    delay = 1500;
    const boss = agent('Boss 2', ['agents']);
    const a = agent('Helper A');
    const b = agent('Helper B');
    const t0 = Date.now();
    const ha = handleOf((await callTool(boss, 'ask_agent', { agent: a.name, message: 'part one' }, { depth: 0 })).text);
    const hb = handleOf((await callTool(boss, 'ask_agent', { agent: b.name, message: 'part two' }, { depth: 0 })).text);
    const early = await callTool(boss, 'await_agent', { handle: ha, wait_seconds: 1 }, { depth: 0 });
    expect(early.isError).toBe(false);
    expect(early.text).toMatch(/^Helper A is still working on it \(.+ so far\)\.[\s\S]*Call await_agent again with handle h/);
    expect((await callTool(boss, 'await_agent', { handle: ha }, { depth: 0 })).text).toBe('Helper A says:\nDone: part one');
    expect((await callTool(boss, 'await_agent', { handle: hb }, { depth: 0 })).text).toBe('Helper B says:\nDone: part two');
    // both took ~1.5 s side by side, not one after the other
    expect(Date.now() - t0).toBeLessThan(2800);
  });

  it("only the asker collects it; a wrong handle says so; too deep is refused", async () => {
    delay = 0;
    const boss = agent('Boss 3', ['agents']);
    const other = agent('Other', ['agents']);
    const helper = agent('Helper C');
    const h = handleOf((await callTool(boss, 'ask_agent', { agent: helper.name, message: 'x' }, { depth: 0 })).text);
    expect(await callTool(other, 'await_agent', { handle: h }, { depth: 0 })).toMatchObject({ isError: true, text: 'That handle belongs to another agent.' });
    expect((await callTool(boss, 'await_agent', { handle: 'h-nope' }, { depth: 0 })).isError).toBe(true);
    expect((await callTool(boss, 'ask_agent', { agent: helper.name, message: 'x' }, { depth: 3 })).text).toMatch(/Too many agents deep/);
    await callTool(boss, 'await_agent', { handle: h }, { depth: 0 });
  });

  it('stopping the asker stops what it handed out', async () => {
    delay = 5000;
    const boss = agent('Boss 4', ['agents']);
    const helper = agent('Helper D');
    const ctl = new AbortController();
    const h = handleOf((await callTool(boss, 'ask_agent', { agent: helper.name, message: 'slow' }, { depth: 0, signal: ctl.signal })).text);
    ctl.abort();
    const got = await callTool(boss, 'await_agent', { handle: h }, { depth: 0 });
    expect(got).toMatchObject({ isError: true, text: "Helper D couldn't finish: it was stopped" });
  });
});
