// pi and oh-my-pi: the command line, reading their JSON events into the chat, the session a chat
// keeps, model lists, and adding the dashboard bridge to their mcp.json.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { Chat, RunEvent } from '../../shared/types.ts';

// a fake pi / omp: prints its lines, remembers what it was started with and sent
const fake = vi.hoisted(() => ({ lines: [] as string[], stderr: '', code: 0, calls: [] as { cmd: string; args: string[]; env: NodeJS.ProcessEnv; input: string; instructions: string }[] }));
vi.mock('../../server/util.ts', async (orig) => {
  const real = await orig<typeof import('../../server/util.ts')>();
  return {
    ...real,
    which: (cmd: string) => (cmd === 'pi' || cmd === 'omp' ? `/usr/bin/${cmd}` : null),
    spawnCommand: (cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
      const child = new EventEmitter() as ChildProcess & EventEmitter;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      Object.assign(child, { stdout, stderr, stdin, exitCode: null, pid: 0 });
      const at = args.indexOf('--append-system-prompt');
      const call = { cmd, args, env: opts.env || {}, input: '', instructions: at === -1 ? '' : fs.readFileSync(args[at + 1], 'utf8') };
      fake.calls.push(call);
      stdin.on('data', (d: Buffer) => (call.input += String(d)));
      stdin.on('finish', () => {
        for (const l of fake.lines) stdout.write(`${l}\n`);
        stdout.end();
        stderr.end(fake.stderr);
      });
      stdout.on('end', () => setImmediate(() => child.emit('close', fake.code)));
      return child;
    },
  };
});

const { piArgs, piReader, parseModelTable, addBridge, mcpFile, toolText, pi, omp } = await import('../../server/engines/pi.ts');
const { newAgent } = await import('../../server/library.ts');
const { HOME } = await import('../../server/util.ts');

const ev = (o: object) => JSON.stringify(o);
const chatOf = (sessionId: string | null = null) => ({ id: 'c1', items: [], sessionId }) as unknown as Chat;
const runArgs = (engine: 'pi' | 'omp', chat: Chat, events: RunEvent[]) => ({
  agent: newAgent({ name: 'Coder', engine }),
  chat,
  text: 'fix the test',
  signal: new AbortController().signal,
  onEvent: (e: RunEvent) => events.push(e),
  depth: 0,
  runId: 'r1',
  systemPrompt: 'You are Coder.',
  attachments: [],
});

beforeEach(() => {
  fake.lines = [];
  fake.stderr = '';
  fake.code = 0;
  fake.calls = [];
});

describe('piArgs', () => {
  it('pi: JSON events, its exact session id, the brief as a file, the effort as --thinking', () => {
    const a = newAgent({ name: 'Coder', engine: 'pi', model: 'anthropic/claude-sonnet-5-5', effort: 'high' });
    expect(piArgs('pi', a, { sessionId: 's1', instructions: 'brief.md' })).toEqual(['--mode', 'json', '--model', 'anthropic/claude-sonnet-5-5', '--thinking', 'high', '--append-system-prompt', 'brief.md', '--session-id', 's1']);
  });
  it('oh-my-pi: resumes only a session it named, and never stops to ask about a tool', () => {
    const a = newAgent({ name: 'Coder', engine: 'omp', autonomy: 'ask' });
    expect(piArgs('omp', a, { sessionId: '', resume: false })).toEqual(['--mode', 'json', '--approval-mode', 'yolo']);
    expect(piArgs('omp', a, { sessionId: 'abc', resume: true })).toEqual(['--mode', 'json', '--resume', 'abc', '--approval-mode', 'yolo']);
  });
  it('the terminal: interactive, no JSON', () => {
    expect(piArgs('pi', newAgent({ name: 'Coder', engine: 'pi' }), { interactive: true })).toEqual([]);
  });
});

describe('piReader', () => {
  it('streams text, tool calls and their results, and adds up usage', () => {
    const events: RunEvent[] = [];
    let session = '';
    const r = piReader((e) => events.push(e), (id) => (session = id));
    const lines = [
      ev({ type: 'session', version: 3, id: 'abc', cwd: '/w' }),
      ev({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Look' } }),
      ev({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'ing.' } }),
      ev({ type: 'message_end', message: { role: 'assistant', provider: 'anthropic', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Looking.' }], stopReason: 'toolUse', usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0, totalTokens: 115, cost: { total: 0.01 } } } }),
      ev({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } }),
      ev({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: { content: [{ type: 'text', text: 'a.ts' }] }, isError: false }),
      // a message without deltas: its text comes whole, after a gap
      ev({ type: 'message_end', message: { role: 'assistant', provider: 'anthropic', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Done.' }], stopReason: 'stop', usage: { input: 20, output: 2, cacheRead: 110, cacheWrite: 0, totalTokens: 132, cost: { total: 0.02 } } } }),
      'not json at all',
      ev({ type: 'some_new_event', x: 1 }),
      ev({ type: 'agent_end', messages: [] }),
    ];
    for (const l of lines) {
      try {
        r.line(l);
      } catch {
        /* pipeLines skips a bad line */
      }
    }
    expect(session).toBe('abc');
    expect(events).toEqual([
      { kind: 'text', text: 'Look' },
      { kind: 'text', text: 'ing.' },
      { kind: 'model', model: 'anthropic/claude-sonnet-5-5' },
      { kind: 'tool', id: 't1', name: 'bash', args: { command: 'ls' } },
      { kind: 'tool_result', id: 't1', text: 'a.ts', isError: false },
      { kind: 'text', text: '\n\nDone.' },
    ]);
    expect(r.result()).toMatchObject({ answer: 'Looking.\n\nDone.', tokens: 247, cached: 210, context: 132, lastError: '', ended: true });
    expect(r.result().cost).toBeCloseTo(0.03);
  });
  it('a turn that ends in an error says why', () => {
    const r = piReader(() => {}, () => {});
    r.line(ev({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'No API key for anthropic' } }));
    expect(r.result().lastError).toBe('No API key for anthropic');
  });
  it('marks a compaction pi did on its own', () => {
    const events: RunEvent[] = [];
    const r = piReader((e) => events.push(e), () => {});
    r.line(ev({ type: 'compaction_end', reason: 'threshold', result: { summary: '…', tokensBefore: 150000 }, aborted: false, willRetry: false }));
    expect(events).toEqual([{ kind: 'compacted', trigger: 'auto', tokensBefore: 150000 }]);
  });
  it('a tool that returns a picture (read on a PNG): the images go with its result', () => {
    const events: RunEvent[] = [];
    const r = piReader((e) => events.push(e), () => {});
    r.line(ev({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', result: { content: [{ type: 'text', text: 'Read image file [image/png]' }, { type: 'image', data: 'iVBORw0K', mimeType: 'image/png' }] }, isError: false }));
    expect(events).toEqual([{ kind: 'tool_result', id: 't1', text: 'Read image file [image/png]\n[image]', isError: false, images: ['data:image/png;base64,iVBORw0K'] }]);
  });
  it('tool results: text parts, images as a marker, anything else as JSON', () => {
    expect(toolText({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }] })).toBe('a\n[image]');
    expect(toolText('plain')).toBe('plain');
    expect(toolText({ ok: true })).toBe('{"ok":true}');
  });
});

describe('a pi run', () => {
  it('sends the message on stdin, starts and keeps its own session, and cleans up the brief', async () => {
    fake.lines = [ev({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Fixed.' } }), ev({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed.' }], stopReason: 'stop', usage: { input: 3, output: 2, totalTokens: 5, cost: { total: 0.001 } } } })];
    const chat = chatOf();
    const events: RunEvent[] = [];
    const res = await pi.run(runArgs('pi', chat, events));
    expect(res).toMatchObject({ text: 'Fixed.', tokens: 5, cost: 0.001 });
    const call = fake.calls[0];
    expect(call.input).toBe('fix the test');
    expect(call.instructions).toBe('You are Coder.');
    expect(fs.existsSync(call.args[call.args.indexOf('--append-system-prompt') + 1])).toBe(false);
    // its own session id, made here and kept for the next message
    const sid = call.args[call.args.indexOf('--session-id') + 1];
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(chat.sessionId).toBe(sid);
    // the dashboard bridge in its mcp.json learns which agent and run calls it
    expect(call.env).toMatchObject({ DASH_RUN: 'r1', DASH_AGENT: expect.any(String) });
    await pi.run(runArgs('pi', chat, []));
    expect(fake.calls[1].args[fake.calls[1].args.indexOf('--session-id') + 1]).toBe(sid);
  });
  it('fails with the model’s error', async () => {
    fake.lines = [ev({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'rate limited' } })];
    await expect(pi.run(runArgs('pi', chatOf(), []))).rejects.toThrow('rate limited');
  });
  it('oh-my-pi: takes the session it names, then resumes it', async () => {
    fake.lines = [ev({ type: 'session', id: 'omp-1' }), ev({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi.' }], stopReason: 'stop' } })];
    const chat = chatOf();
    await omp.run(runArgs('omp', chat, []));
    expect(fake.calls[0].args).not.toContain('--resume');
    expect(chat.sessionId).toBe('omp-1');
    await omp.run(runArgs('omp', chat, []));
    expect(fake.calls[1].args.slice(fake.calls[1].args.indexOf('--resume'), fake.calls[1].args.indexOf('--resume') + 2)).toEqual(['--resume', 'omp-1']);
  });
});

describe('a session oh-my-pi does not have', () => {
  it('clears it and asks for a new session with the chat so far', async () => {
    const { SessionGone } = await import('../../server/engines/cli.ts');
    fake.code = 1;
    fake.stderr = 'Error: Session "5bc68a5e-de26-4882-8c34-5a0a2257ed0e" not found. Run `omp --resume` without an argument to pick from recent sessions, or `omp` to start a new one.';
    const chat = chatOf('5bc68a5e-de26-4882-8c34-5a0a2257ed0e');
    const err = await omp.run(runArgs('omp', chat, [])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionGone);
    expect((err as Error).message).toContain('not found');
    expect(chat.sessionId).toBeNull();
    expect(chat.reseed).toBe(true);
  });
  it('any other failure keeps the session', async () => {
    const { SessionGone } = await import('../../server/engines/cli.ts');
    fake.code = 1;
    fake.stderr = 'Error: no API key';
    const chat = chatOf('omp-1');
    const err = await omp.run(runArgs('omp', chat, [])).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SessionGone);
    expect(chat.sessionId).toBe('omp-1');
  });
});

describe('models', () => {
  it("reads pi's --list-models table", () => {
    const out = 'provider   model                context  max-out  thinking  images\nanthropic  claude-sonnet-5-5    1M       64K      yes       yes\nopenai     gpt-5.6-sol          272K     128K     yes       yes\n';
    expect(parseModelTable(out)).toEqual([
      { id: 'anthropic/claude-sonnet-5-5', name: 'claude-sonnet-5-5', context: 1_000_000 },
      { id: 'openai/gpt-5.6-sol', name: 'gpt-5.6-sol', context: 272_000 },
    ]);
    expect(parseModelTable('No models available. Use /login to log into a provider.')).toEqual([]);
  });
});

describe('addBridge', () => {
  it("adds the dashboard to pi's mcp.json and keeps what is there", () => {
    const file = mcpFile('pi');
    expect(path.resolve(file).startsWith(path.resolve(HOME))).toBe(true);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `﻿${JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } }, other: 1 })}`);
    addBridge('pi');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as { mcpServers: Record<string, { command: string; args?: string[]; env?: object; timeout?: number }>; other: number };
    expect(cfg.other).toBe(1);
    expect(cfg.mcpServers.github).toEqual({ command: 'gh-mcp' });
    expect(cfg.mcpServers.dashboard.args?.[0]).toMatch(/mcp-bridge\.ts$/);
    // no agent of its own there: each run says which (an env here would win over the run's)
    expect(cfg.mcpServers.dashboard.env).toBeUndefined();
    expect(cfg.mcpServers.dashboard.timeout).toBe(3600);
  });
  it("oh-my-pi's file, in milliseconds", () => {
    const file = addBridge('omp');
    expect(file).toBe(mcpFile('omp'));
    expect((JSON.parse(fs.readFileSync(file, 'utf8')) as { mcpServers: { dashboard: { timeout: number } } }).mcpServers.dashboard.timeout).toBe(3_600_000);
  });
  it("never replaces a file it can't read", () => {
    const file = mcpFile('omp');
    fs.writeFileSync(file, '{ "mcpServers": { // a comment');
    expect(() => addBridge('omp')).toThrow(/isn't valid JSON/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ "mcpServers": { // a comment');
  });
});

describe('the bridge before a run', () => {
  const done = [ev({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stopReason: 'stop' } })];
  const dashboard = () => (JSON.parse(fs.readFileSync(mcpFile('omp'), 'utf8')) as { mcpServers: Record<string, { command: string; args: string[] }> }).mcpServers.dashboard;

  it("adds the dashboard to its mcp.json when it isn't there, once", async () => {
    fs.rmSync(mcpFile('omp'), { force: true });
    fake.lines = done;
    const events: RunEvent[] = [];
    await omp.run(runArgs('omp', chatOf(), events));
    expect(dashboard().args[0]).toMatch(/mcp-bridge\.ts$/);
    expect(events).toContainEqual({ kind: 'status', text: 'Gave oh-my-pi the dashboard tools' });
    expect(fake.calls[0].instructions).toBe('You are Coder.');
    const again: RunEvent[] = [];
    await omp.run(runArgs('omp', chatOf(), again));
    expect(again.some((e) => e.kind === 'status')).toBe(false);
  });

  it('puts right an entry whose program is gone (the app moved), and keeps one that works', async () => {
    fake.lines = done;
    fs.writeFileSync(mcpFile('omp'), JSON.stringify({ mcpServers: { dashboard: { command: '/nowhere/bun', args: ['/nowhere/mcp-bridge.js'] } } }));
    await omp.run(runArgs('omp', chatOf(), []));
    expect(dashboard().command).toBe(process.execPath);
    // a hand-made one that names a program on the PATH stays as it is
    fs.writeFileSync(mcpFile('omp'), JSON.stringify({ mcpServers: { dashboard: { command: 'omp', args: ['bridge'] } } }));
    await omp.run(runArgs('omp', chatOf(), []));
    expect(dashboard()).toEqual({ command: 'omp', args: ['bridge'] });
  });

  it("leaves a file it can't read alone, and tells the agent and you", async () => {
    fake.lines = done;
    fs.writeFileSync(mcpFile('omp'), '{ "mcpServers": { // a comment');
    await omp.run(runArgs('omp', chatOf(), []));
    expect(fs.readFileSync(mcpFile('omp'), 'utf8')).toBe('{ "mcpServers": { // a comment');
    expect(fake.calls[0].instructions).toMatch(/^You are Coder\.\n\n\(The dashboard's own tools can't be used in this run: .*isn't valid JSON/);
  });
});
