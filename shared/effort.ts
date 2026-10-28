// Effort: how hard a model thinks before it answers. Each engine knows its own levels;
// '' means the model's own default (nothing is sent).
import type { EngineId } from './types.ts';

export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Every level, least effort first. */
export const EFFORTS: readonly Effort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const EFFORT_NAMES: Record<Effort, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

export const isEffort = (x: unknown): x is Effort => typeof x === 'string' && (EFFORTS as readonly string[]).includes(x);

/** The levels an engine takes (always a run of EFFORTS, in order).
 *  provider: for API models, OpenRouter or a server on this PC. */
export function effortLevels(engine: EngineId, provider?: string): Effort[] {
  const from = (a: Effort, b: Effort) => EFFORTS.slice(EFFORTS.indexOf(a), EFFORTS.indexOf(b) + 1);
  if (engine === 'claude-code') return from('low', 'max'); // claude --effort
  if (engine === 'codex') return from('minimal', 'xhigh'); // model_reasoning_effort
  if (engine === 'hermes') return from('minimal', 'max'); // hermes chat --reasoning
  if (engine === 'pi' || engine === 'omp' || engine === 'openclaw') return from('minimal', 'max'); // --thinking
  // OpenRouter's reasoning.effort; OpenAI-compatible servers take reasoning_effort low/medium/high
  return (provider || 'openrouter') === 'openrouter' ? from('minimal', 'xhigh') : from('low', 'high');
}

/** The level to send for an engine: the one asked for, or the nearest one the engine has. '' = the default. */
export function effortFor(engine: EngineId, effort: unknown, provider?: string): Effort | '' {
  if (!isEffort(effort)) return '';
  const levels = effortLevels(engine, provider);
  if (levels.includes(effort)) return effort;
  return EFFORTS.indexOf(effort) < EFFORTS.indexOf(levels[0]) ? levels[0] : levels[levels.length - 1];
}
