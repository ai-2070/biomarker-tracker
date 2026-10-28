// The Agents page's overview: what kinds of agents the project has and which models they run on.
import { ENGINE_LABEL } from './core.ts';
import type { Agent, Settings } from '../shared/types.ts';

/** One slice of a chart: a category or a model, how many agents, and its colour (categories only). */
export interface Slice {
  id: string;
  label: string;
  /** what's under the label (a model's engine) */
  sub?: string;
  count: number;
  color?: string;
  /** "Other": the slices it stands for */
  rest?: Slice[];
}

// The app's own hues (lime, rose, ice, amber, violet, mint), stepped darker so they read as fills on the dark
// panels, in an order where neighbours stay apart for colour-blind eyes too (checked with the data-viz
// palette validator). A seventh category and beyond fold into Other, in grey.
export const CATEGORY_COLORS = ['#7ca605', '#bf4064', '#0ba2c3', '#aa7401', '#765ab7', '#0dae8d'];
export const OTHER_COLOR = '#4a5347';

const UPPER = new Set(['gis', 'ai', 'ui', 'ux', 'qa', 'seo', 'xr', 'vr', 'ar']);
/** "game-development" → "Game Development", "gis" → "GIS". */
export const divisionLabel = (id: string): string =>
  id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (UPPER.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');

const FROM: Record<string, string> = { brain: 'Made by the Brain', hermes: 'From Hermes', openclaw: 'From OpenClaw', claude: 'From Claude Code', starter: 'Blacksite agents', preset: 'Ready-made teams' };

/** An agent's category: its Library division, else where it came from ("Your own" when you made it). */
export function agentCategory(a: Pick<Agent, 'source'>): { id: string; label: string } {
  const div = a.source?.division;
  if (div) return { id: `division:${div}`, label: divisionLabel(div) };
  const type = a.source?.type || 'custom';
  return { id: `source:${FROM[type] ? type : 'custom'}`, label: FROM[type] || 'Your own' };
}

const ALIAS = new Set(['sonnet', 'opus', 'haiku', 'fable', 'default', 'best']);
/** The model an agent runs on, as you'd name it: "Sonnet", "gpt-5.5" (without the provider part). */
export function agentModel(a: Pick<Agent, 'engine' | 'model'>, defaults?: Partial<Settings['defaults']>): { id: string; label: string; sub: string } {
  const sub = ENGINE_LABEL[a.engine] || a.engine;
  let model = (a.model || '').trim();
  if (!model && a.engine === 'claude-code') model = defaults?.claudeModel || 'sonnet';
  if (!model && a.engine === 'openai') model = defaults?.openrouterModel || '';
  const label = !model ? (a.engine === 'hermes' ? "its profile's model" : `${sub}'s default`) : ALIAS.has(model.toLowerCase()) ? model[0].toUpperCase() + model.slice(1).toLowerCase() : model.split('/').pop() || model;
  return { id: `${a.engine}|${label.toLowerCase()}`, label, sub };
}

/** Counts into slices, biggest first; past `keep` they fold into one "Other". */
export function slices<T>(items: T[], key: (x: T) => { id: string; label: string; sub?: string }, keep: number): Slice[] {
  const by = new Map<string, Slice>();
  for (const x of items) {
    const k = key(x);
    const s = by.get(k.id) || { id: k.id, label: k.label, sub: k.sub, count: 0 };
    s.count++;
    by.set(k.id, s);
  }
  const all = [...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (all.length <= keep + 1) return all;
  const rest = all.slice(keep);
  return [...all.slice(0, keep), { id: 'other', label: 'Other', count: rest.reduce((n, s) => n + s.count, 0), rest }];
}

/** The categories, coloured in order, Other in grey. */
export function categorySlices(agents: Pick<Agent, 'source'>[]): Slice[] {
  return slices(agents, agentCategory, CATEGORY_COLORS.length).map((s, i) => ({ ...s, color: s.id === 'other' ? OTHER_COLOR : CATEGORY_COLORS[i] }));
}

export const modelSlices = (agents: Pick<Agent, 'engine' | 'model'>[], defaults?: Partial<Settings['defaults']>): Slice[] => slices(agents, (a) => agentModel(a, defaults), 5);

/** The engine tiles at the Station's top right, by key: an API-model agent is on LM Studio or OpenRouter. */
export const ENGINE_NAMES: Record<string, string> = { 'claude-code': 'Claude Code', openrouter: 'OpenRouter', lmstudio: 'LM Studio', hermes: 'Hermes', codex: 'OpenAI Codex', pi: 'pi', omp: 'oh-my-pi', openclaw: 'OpenClaw' };
export const engineKey = (a: Pick<Agent, 'engine' | 'provider'>): string => (a.engine === 'openai' ? (a.provider === 'lmstudio' ? 'lmstudio' : 'openrouter') : a.engine);

/** Does an agent belong to a slice (an Other slice: to any it stands for)? */
export const inSlice = (s: Slice, id: string): boolean => s.id === id || !!s.rest?.some((r) => r.id === id);
