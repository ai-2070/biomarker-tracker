// How an agent's autonomy maps to Claude Code's permission mode.
import { describe, expect, it } from 'vitest';
import { claudeArgs } from '../../server/engines/claude.ts';
import { newAgent } from '../../server/library.ts';
import type { Agent } from '../../shared/types.ts';

const files = { promptFile: 'prompt.md', mcpFile: 'mcp.json' };
const modeOf = (args: string[]) => args[args.indexOf('--permission-mode') + 1];
const agent = (autonomy: Agent['autonomy']) => newAgent({ name: `Claude ${autonomy}`, engine: 'claude-code', autonomy });

describe('claudeArgs() permission mode', () => {
  it('"Ask first" never auto-accepts edits: it uses the default mode and routes prompts to the dashboard', () => {
    const args = claudeArgs(agent('ask'), files);
    expect(modeOf(args)).toBe('default');
    expect(args).not.toContain('acceptEdits');
    expect(args[args.indexOf('--permission-prompt-tool') + 1]).toBe('mcp__dashboard__permission_prompt');
  });

  it('"Ask first" in a terminal asks there (no prompt tool)', () => {
    const args = claudeArgs(agent('ask'), { ...files, interactive: true });
    expect(modeOf(args)).toBe('default');
    expect(args).not.toContain('--permission-prompt-tool');
  });

  it('auto and full keep their modes', () => {
    expect(modeOf(claudeArgs(agent('auto'), files))).toBe('auto');
    expect(modeOf(claudeArgs(agent('full'), files))).toBe('bypassPermissions');
  });
});

describe('claudeArgs() questions', () => {
  it("turns off Claude's own question box in dashboard runs: it asks with ask_user (the Outbox)", () => {
    const args = claudeArgs(agent('auto'), files);
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('AskUserQuestion');
    expect(claudeArgs(agent('full'), files)).toContain('--disallowedTools');
  });

  it('keeps it in a terminal, where you are there to answer', () => {
    expect(claudeArgs(agent('auto'), { ...files, interactive: true })).not.toContain('--disallowedTools');
  });
});
