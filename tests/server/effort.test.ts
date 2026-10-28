// Effort: each engine gets the level it takes, on its own flag, and nothing when it's the model's default.
import { describe, expect, it } from 'vitest';
import { EFFORTS, effortFor, effortLevels } from '../../shared/effort.ts';
import { claudeArgs } from '../../server/engines/claude.ts';
import { codexArgs } from '../../server/engines/codex.ts';
import { hermesArgs } from '../../server/engines/hermes.ts';
import { newAgent } from '../../server/library.ts';
import { cleanAgentVersion } from '../../server/versions.ts';
import { asText } from '../../server/history.ts';
import type { Agent } from '../../shared/types.ts';

const after = (args: string[], flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const files = { promptFile: 'prompt.md', mcpFile: 'mcp.json' };

describe('effort levels', () => {
  it('lists each engine’s own levels, least effort first', () => {
    expect(effortLevels('claude-code')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortLevels('codex')).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
    expect(effortLevels('hermes')).toEqual([...EFFORTS]);
    for (const e of ['pi', 'omp', 'openclaw'] as const) expect(effortLevels(e)).toEqual([...EFFORTS]);
    expect(effortLevels('openai', 'openrouter')).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh']);
    expect(effortLevels('openai', 'ollama')).toEqual(['low', 'medium', 'high']);
  });

  it('sends the nearest level an engine has, and nothing for the default or junk', () => {
    expect(effortFor('codex', 'max')).toBe('xhigh');
    expect(effortFor('claude-code', 'minimal')).toBe('low');
    expect(effortFor('openai', 'xhigh', 'lmstudio')).toBe('high');
    expect(effortFor('claude-code', 'high')).toBe('high');
    expect(effortFor('claude-code', '')).toBe('');
    expect(effortFor('claude-code', 'ultra')).toBe('');
    expect(effortFor('claude-code', undefined)).toBe('');
  });
});

describe('effort on the command line', () => {
  const agent = (engine: Agent['engine'], effort: Agent['effort']) => newAgent({ name: `Effort ${engine}`, engine, effort });

  it('Claude Code: --effort', () => {
    expect(after(claudeArgs(agent('claude-code', 'xhigh'), files), '--effort')).toBe('xhigh');
    expect(after(claudeArgs(agent('claude-code', 'minimal'), { ...files, interactive: true }), '--effort')).toBe('low');
    expect(claudeArgs(agent('claude-code', ''), files)).not.toContain('--effort');
  });

  it('Codex: model_reasoning_effort', () => {
    const overrides = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === '-c' ? [a] : []));
    expect(overrides(codexArgs(agent('codex', 'high')))).toContain('model_reasoning_effort="high"');
    expect(overrides(codexArgs(agent('codex', 'max')))).toContain('model_reasoning_effort="xhigh"');
    expect(overrides(codexArgs(agent('codex', ''))).some((c) => c.startsWith('model_reasoning_effort'))).toBe(false);
  });

  it('Hermes: --reasoning on the chat command', () => {
    const args = hermesArgs(agent('hermes', 'max'));
    expect(after(args, '--reasoning')).toBe('max');
    expect(args.indexOf('--reasoning')).toBeGreaterThan(args.indexOf('chat'));
    expect(hermesArgs(agent('hermes', ''))).not.toContain('--reasoning');
  });
});

describe('effort on the agent', () => {
  it('a new agent keeps a real level and drops anything else', () => {
    expect(newAgent({ name: 'E1', effort: 'medium' }).effort).toBe('medium');
    expect(newAgent({ name: 'E2', effort: 'hot' as Agent['effort'] }).effort).toBe('');
    expect(newAgent({ name: 'E3' }).effort).toBe('');
  });

  it('shows in an agent version and survives one made elsewhere only when it is a level', () => {
    expect(asText('agent', { ...newAgent({ name: 'E4' }), effort: 'high' })).toContain('Effort: high');
    expect(cleanAgentVersion({ name: 'V', effort: 'low' }, 'v')?.effort).toBe('low');
    expect(cleanAgentVersion({ name: 'V', effort: 'ludicrous' }, 'v')).not.toHaveProperty('effort');
    expect(cleanAgentVersion({ name: 'V', effort: { evil: true } }, 'v')).not.toHaveProperty('effort');
  });
});
