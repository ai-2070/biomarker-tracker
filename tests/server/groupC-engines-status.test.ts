import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../shared/types.ts';
import { newAgent } from '../../server/library.ts';
import { saveServer } from '../../server/mcp.ts';
import { codexArgs, terminalPromptFile } from '../../server/engines/codex.ts';
import { turnActivity } from '../../server/engines/index.ts';
import { codexWindow } from '../../server/status.ts';

// the values passed with -c, e.g. 'mcp_servers.gh.url="..."'
const overrides = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === '-c' ? [a] : []));

describe('codex args', () => {
  it('passes headers of HTTP MCP servers on as http_headers', () => {
    saveServer('gh', { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'k"1' } });
    saveServer('plain', { type: 'http', url: 'https://example.com/other' });
    const c = overrides(codexArgs(newAgent({ name: 'Coder', engine: 'codex', mcpServers: ['gh', 'plain'] })));
    expect(c).toContain('mcp_servers.gh.url="https://example.com/mcp"');
    expect(c).toContain('mcp_servers.gh.http_headers={Authorization="Bearer abc",X-Api-Key="k\\"1"}');
    // no empty table for a server without headers
    expect(c.some((x) => x.startsWith('mcp_servers.plain.http_headers'))).toBe(false);
  });

  it('points the interactive terminal at a file with the agent instructions', () => {
    const agent = newAgent({ name: 'Coder', engine: 'codex' });
    const file = terminalPromptFile(agent, 'You are Coder.\nAlways write tests.');
    expect(fs.readFileSync(file, 'utf8')).toBe('You are Coder.\nAlways write tests.');
    const c = overrides(codexArgs(agent, { interactive: true, promptFile: file }));
    const dev = c.find((x) => x.startsWith('developer_instructions='));
    expect(dev).toContain(file.replace(/\\/g, '/'));
    // headless runs send the instructions with the first message instead
    expect(overrides(codexArgs(agent)).some((x) => x.startsWith('developer_instructions='))).toBe(false);
  });
});

describe('turnActivity', () => {
  it("only reports the current turn's tool and text", () => {
    const items: ChatItem[] = [
      { type: 'user', text: 'old task' },
      { type: 'tool', id: 't1', name: 'old_tool', status: 'done' },
      { type: 'assistant', text: 'old answer' },
      { type: 'user', text: 'new task', from: 'Brain' },
    ];
    expect(turnActivity(items)).toEqual({ task: 'new task', from: 'Brain', tool: null, saying: '' });
    items.push({ type: 'tool', id: 't2', name: 'new_tool', args: { a: 1 }, status: 'running' }, { type: 'assistant', text: 'working on it' });
    expect(turnActivity(items)).toEqual({ task: 'new task', from: 'Brain', tool: { name: 'new_tool', status: 'running', args: '{"a":1}' }, saying: 'working on it' });
  });

  it('copes with a chat that has no user message', () => {
    expect(turnActivity([])).toEqual({ task: '', from: null, tool: null, saying: '' });
  });
});

describe('codexWindow', () => {
  const now = Date.UTC(2026, 0, 1, 12);
  it('keeps a window that has not reset yet', () => {
    expect(codexWindow({ used_percent: 41.6, resets_at: now / 1000 + 600 }, now - 1000, now)).toEqual({ percent: 42, resetsAt: now + 600_000 });
    expect(codexWindow({ used_percent: 10, resets_in_seconds: 60 }, now - 30_000, now)).toEqual({ percent: 10, resetsAt: now + 30_000 });
    expect(codexWindow({ used_percent: 5 }, now, now)).toEqual({ percent: 5, resetsAt: null });
  });

  it('drops a window whose reset time has passed', () => {
    expect(codexWindow({ used_percent: 90, resets_at: now - 1 }, now - 3_600_000, now)).toBeNull();
    expect(codexWindow({ used_percent: 90, resets_in_seconds: 60 }, now - 120_000, now)).toBeNull();
  });

  it('ignores windows without a percent', () => {
    expect(codexWindow(null, now, now)).toBeNull();
    expect(codexWindow({ used_percent: '50' }, now, now)).toBeNull();
  });
});
