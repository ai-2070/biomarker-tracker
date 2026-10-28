// OpenClaw: the command line, its JSON reply, its own session per chat, and answering here (--local)
// when its Gateway isn't running.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { Chat, RunEvent } from '../../shared/types.ts';

// a fake openclaw: answers each call with the next reply, and remembers the message file it was given
const fake = vi.hoisted(() => ({ replies: [] as string[], calls: [] as { args: string[]; message: string }[] }));
vi.mock('../../server/util.ts', async (orig) => {
  const real = await orig<typeof import('../../server/util.ts')>();
  return {
    ...real,
    which: (cmd: string) => (cmd === 'openclaw' ? '/usr/bin/openclaw' : null),
    spawnCommand: (_cmd: string, args: string[]) => {
      const child = new EventEmitter() as ChildProcess & EventEmitter;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      Object.assign(child, { stdout, stderr, stdin: null, exitCode: null, pid: 0 });
      fake.calls.push({ args, message: fs.readFileSync(args[args.indexOf('--message-file') + 1], 'utf8') });
      const reply = fake.replies.shift() ?? '';
      setImmediate(() => {
        stdout.end(reply);
        stderr.end();
      });
      stdout.on('end', () => setImmediate(() => child.emit('close', 0)));
      return child;
    },
  };
});

const { openclawArgs, readReply, parseReply, run } = await import('../../server/engines/openclaw.ts');
const { newAgent } = await import('../../server/library.ts');

const chatOf = () => ({ id: 'c1', items: [], sessionId: null }) as unknown as Chat;
const args = (chat: Chat, text: string, events: RunEvent[] = []) => ({
  agent: newAgent({ name: 'Claw', engine: 'openclaw', openclawAgent: 'ops' }),
  chat,
  text,
  signal: new AbortController().signal,
  onEvent: (e: RunEvent) => events.push(e),
  depth: 0,
  runId: `r${Math.random().toString(36).slice(2)}`,
  systemPrompt: 'You are Claw.',
  attachments: [],
});
const ok = (text: string) => JSON.stringify({ payloads: [{ text, mediaUrl: null }], meta: { durationMs: 900, agentMeta: { sessionId: 'x', provider: 'openai', model: 'gpt-5.6-sol', usage: { input: 100, output: 20, cacheRead: 50, total: 120 }, costUsd: 0.004 }, toolSummary: { calls: 1, tools: ['read'] } } });

beforeEach(() => {
  fake.replies = [];
  fake.calls = [];
});

describe('openclawArgs', () => {
  it('the agent, the chat’s session, the message file, JSON, and model and thinking when set', () => {
    const a = newAgent({ name: 'Claw', engine: 'openclaw', openclawAgent: 'ops', model: 'openai/gpt-5.4', effort: 'high' });
    expect(openclawArgs(a, { sessionKey: 'dashboard-c1', messageFile: 'm.md' })).toEqual(['agent', '--agent', 'ops', '--session-key', 'dashboard-c1', '--message-file', 'm.md', '--json', '--timeout', '0', '--model', 'openai/gpt-5.4', '--thinking', 'high']);
    expect(openclawArgs(newAgent({ name: 'Claw', engine: 'openclaw' }), { sessionKey: 'k', messageFile: 'm.md', local: true })).toEqual(['agent', '--session-key', 'k', '--message-file', 'm.md', '--json', '--timeout', '0', '--local']);
  });
  it('leaves out an agent id that is not plain', () => {
    expect(openclawArgs(newAgent({ name: 'Claw', engine: 'openclaw', openclawAgent: 'a b"c' }), { sessionKey: 'k', messageFile: 'm' })).not.toContain('--agent');
  });
});

describe('readReply', () => {
  it('the answer, usage, cost and model', () => {
    expect(readReply(parseReply(ok('Done.'))!)).toEqual({ text: 'Done.', tokens: 120, cached: 50, cost: 0.004, model: 'openai/gpt-5.6-sol', tools: ['read'] });
  });
  it('a Gateway reply wrapped in result', () => {
    expect(readReply({ runId: 'r', status: 'ok', result: { payloads: [{ text: 'A' }, { text: 'B' }] } }).text).toBe('A\n\nB');
  });
  it('errors: the CLI envelope, the run’s own error, and a turn still going', () => {
    expect(() => readReply({ ok: false, error: { type: 'cli_error', message: 'No agent "x"' } })).toThrow('No agent "x"');
    expect(() => readReply({ payloads: [], meta: { error: { kind: 'context_overflow', message: 'context window exceeded' } } })).toThrow('context window exceeded');
    expect(() => readReply({ status: 'in_flight' })).toThrow(/still answering/);
  });
  it('JSON after log lines, or none', () => {
    expect(parseReply('warming up\n{"payloads":[]}')).toEqual({ payloads: [] });
    expect(parseReply('nothing here')).toBeNull();
  });
});

describe('an OpenClaw run', () => {
  it("answers here when the Gateway isn't running, keeps the chat's session, and cleans up", async () => {
    fake.replies = [JSON.stringify({ ok: false, error: { type: 'cli_error', message: 'Gateway not reachable at ws://127.0.0.1:18789 (ECONNREFUSED).' } }), ok('Hello.')];
    const chat = chatOf();
    const events: RunEvent[] = [];
    const res = await run(args(chat, 'hi', events));
    expect(res).toMatchObject({ text: 'Hello.', tokens: 120, cost: 0.004 });
    expect(fake.calls.map((c) => c.args.includes('--local'))).toEqual([false, true]);
    // the first message of a session carries the agent brief
    expect(fake.calls[0].message).toMatch(/^<agent-instructions>\nYou are Claw\.\n<\/agent-instructions>\n\nhi$/);
    expect(fs.existsSync(fake.calls[0].args[fake.calls[0].args.indexOf('--message-file') + 1])).toBe(false);
    const key = fake.calls[0].args[fake.calls[0].args.indexOf('--session-key') + 1];
    expect(key).toMatch(/^dashboard-c1-/);
    expect(chat.sessionId).toBe(key);
    expect(events).toContainEqual({ kind: 'model', model: 'openai/gpt-5.6-sol' });
    expect(events).toContainEqual({ kind: 'text', text: 'Hello.' });
    // the next message: same session, no brief again
    fake.replies = [ok('Again.')];
    await run(args(chat, 'more'));
    expect(fake.calls[2].args[fake.calls[2].args.indexOf('--session-key') + 1]).toBe(key);
    expect(fake.calls[2].message).toBe('more');
  });
  it('a failed run keeps no session, and says why', async () => {
    fake.replies = [JSON.stringify({ ok: false, error: { type: 'cli_error', message: 'Unknown agent "ops"' } })];
    const chat = chatOf();
    await expect(run(args(chat, 'hi'))).rejects.toThrow('Unknown agent "ops"');
    expect(fake.calls).toHaveLength(1);
    expect(chat.sessionId).toBeNull();
  });
});
