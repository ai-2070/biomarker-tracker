// Models by provider: which engine runs each provider's models, whether it is set up on this PC,
// and the models it has (for the Brain's find_models and set_model, and the model picker).
import { getSecrets, getSettings } from './store.ts';
import { which } from './util.ts';
import { CLAUDE_MODELS } from './engines/claude.ts';
import { listModels } from './engines/openai.ts';
import { listProfiles } from './engines/hermes.ts';
import { listModels as piModels } from './engines/pi.ts';
import { listModels as openclawModels } from './engines/openclaw.ts';
import { listModels as codexModels } from './engines/codex.ts';
import type { Agent, EngineId, ProviderId } from '../shared/types.ts';

export type ModelProvider = 'claude' | 'openrouter' | 'lmstudio' | 'ollama' | 'custom' | 'codex' | 'hermes' | 'pi' | 'omp' | 'openclaw';

interface ProviderInfo {
  label: string;
  engine: EngineId;
  /** API models only: which server */
  provider?: ProviderId;
}

export const MODEL_PROVIDERS: Record<ModelProvider, ProviderInfo> = {
  claude: { label: 'Claude Code', engine: 'claude-code' },
  openrouter: { label: 'OpenRouter', engine: 'openai', provider: 'openrouter' },
  lmstudio: { label: 'LM Studio', engine: 'openai', provider: 'lmstudio' },
  ollama: { label: 'Ollama', engine: 'openai', provider: 'ollama' },
  custom: { label: 'Custom server', engine: 'openai', provider: 'custom' },
  codex: { label: 'OpenAI Codex', engine: 'codex' },
  hermes: { label: 'Hermes', engine: 'hermes' },
  pi: { label: 'pi', engine: 'pi' },
  omp: { label: 'oh-my-pi', engine: 'omp' },
  openclaw: { label: 'OpenClaw', engine: 'openclaw' },
};
export const PROVIDER_IDS = Object.keys(MODEL_PROVIDERS) as ModelProvider[];

// CLIs that pick a model themselves when none is named, and take any id they know (no fixed list to check against)
const OWN_DEFAULT = new Set<ModelProvider>(['codex', 'hermes', 'pi', 'omp', 'openclaw']);

/** Codex's models for the picker: its default first, then the ones Codex lists. */
export async function codexModelList(): Promise<{ id: string; name: string; description?: string }[]> {
  return [{ id: '', name: "Codex's default model" }, ...(await codexModels())];
}

const ALIASES: Record<string, ModelProvider> = {
  'claude-code': 'claude',
  anthropic: 'claude',
  'lm-studio': 'lmstudio',
  'lm studio': 'lmstudio',
  'openai-codex': 'codex',
  'oh-my-pi': 'omp',
};

/** A provider as the Brain names it ('' or unknown: null). */
export function modelProvider(name: unknown): ModelProvider | null {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return null;
  // own keys only: "constructor" or "toString" isn't a provider
  if (Object.hasOwn(MODEL_PROVIDERS, n)) return n as ModelProvider;
  return Object.hasOwn(ALIASES, n) ? ALIASES[n] : null;
}

/** The provider an agent runs on now. */
export function providerOfAgent(a: Pick<Agent, 'engine' | 'provider'>): ModelProvider {
  if (a.engine === 'claude-code') return 'claude';
  if (a.engine === 'codex') return 'codex';
  if (a.engine === 'hermes') return 'hermes';
  if (a.engine === 'pi' || a.engine === 'omp' || a.engine === 'openclaw') return a.engine;
  return modelProvider(a.provider) || 'openrouter';
}

/** Why a provider can't be used on this PC right now (null: it can). */
export function providerProblem(p: ModelProvider): string | null {
  if (p === 'claude') return which('claude') ? null : 'Claude Code is not installed on this PC';
  if (p === 'codex') return which('codex') ? null : 'OpenAI Codex is not installed on this PC';
  if (p === 'hermes') return which('hermes') ? null : 'Hermes is not installed on this PC';
  if (p === 'pi' || p === 'omp' || p === 'openclaw') return which(p) ? null : `${MODEL_PROVIDERS[p].label} is not installed on this PC`;
  if (p === 'openrouter') return getSecrets().openrouterKey ? null : 'there is no OpenRouter key (Settings)';
  const base = getSettings().providers?.[p]?.baseUrl;
  return base ? null : `${MODEL_PROVIDERS[p].label} has no address (Settings)`;
}

export const readyProviders = (): ModelProvider[] => PROVIDER_IDS.filter((p) => !providerProblem(p));

/** The model an agent gets when it moves to a provider and no model was named ('' = the engine's default). */
export function defaultModelFor(p: ModelProvider): string | null {
  const d = getSettings().defaults;
  if (p === 'claude') return d.claudeModel || 'sonnet';
  if (p === 'openrouter') return d.openrouterModel || null;
  if (OWN_DEFAULT.has(p)) return '';
  // a server on this PC: there is no sensible default, a model has to be named
  return null;
}

export interface FoundModel {
  id: string;
  name: string;
  /** price, context, tool use… */
  note?: string;
}

// The lists are fetched over the network for API providers: kept for a few minutes.
const CACHE_MS = 5 * 60_000;
// keyed by provider and address: a server on this PC moved to another address lists its own models
const cache = new Map<string, { at: number; list: FoundModel[] }>();
const cacheKey = (p: ModelProvider) => {
  const srv = MODEL_PROVIDERS[p].provider;
  return srv === 'lmstudio' || srv === 'ollama' || srv === 'custom' ? `${p}|${getSettings().providers?.[srv]?.baseUrl || ''}` : p;
};
export const clearModelCache = (): void => cache.clear();

/** Every model a provider has. [] when it can't be listed (not set up, server not running). */
export async function availableModels(p: ModelProvider): Promise<FoundModel[]> {
  const key = cacheKey(p);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  let list: FoundModel[] = [];
  if (p === 'claude') list = CLAUDE_MODELS.map((m) => ({ id: m.id, name: m.name }));
  else if (p === 'codex') list = (await codexModels().catch(() => [])).map((m) => ({ id: m.id, name: m.name, ...(m.description ? { note: m.description } : {}) }));
  else if (p === 'hermes') {
    const seen = new Set<string>();
    for (const pr of await listProfiles().catch(() => [])) {
      if (!pr.model || seen.has(pr.model)) continue;
      seen.add(pr.model);
      list.push({ id: pr.model, name: pr.model, note: `the model of Hermes profile "${pr.name}"` });
    }
  } else if (p === 'pi' || p === 'omp') list = (await piModels(p).catch(() => [])).map((m) => ({ id: m.id, name: m.name, ...(m.context ? { note: `${Math.round(m.context / 1000)}k context` } : {}) }));
  else if (p === 'openclaw') list = (await openclawModels().catch(() => [])).map((m) => ({ id: m.id, name: m.name }));
  else if (!providerProblem(p)) {
    list = (await listModels(MODEL_PROVIDERS[p].provider!)).map((m) => ({
      id: m.id,
      name: m.name,
      note: [m.price ? `$${m.price.in.toFixed(2)} in / $${m.price.out.toFixed(2)} out per M tokens` : '', m.context ? `${Math.round(m.context / 1000)}k context` : '', p === 'openrouter' && !m.tools ? 'no tool use' : ''].filter(Boolean).join(', ') || undefined,
    }));
  }
  // an empty list may be a server that isn't running yet: ask again next time
  if (list.length) cache.set(key, { at: Date.now(), list });
  return list;
}

/** Models whose id or name has every word of the query (no query: all of them). */
export function matchModels(list: FoundModel[], query: string): FoundModel[] {
  const words = String(query || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((m) => {
    const hay = `${m.id} ${m.name}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Up to 5 models most like an id (a typo, or the right name at the wrong vendor): the most words in common first. */
export function closeModels(list: FoundModel[], id: string): FoundModel[] {
  const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const want = new Set(words(id));
  return list
    .map((m) => ({ m, n: words(m.id).filter((w) => want.has(w)).length }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.n - x.n)
    .slice(0, 5)
    .map((x) => x.m);
}

const line = (m: FoundModel) => `- ${m.id}${m.name && m.name !== m.id ? ` | ${m.name}` : ''}${m.note ? ` | ${m.note}` : ''}`;

/** The models matching a query, as text for the Brain. No provider: every provider that is set up. */
export async function findModels(providerName: unknown, query: unknown, { limit = 40 }: { limit?: number } = {}): Promise<string> {
  const q = String(query ?? '').trim();
  const asked = String(providerName ?? '').trim();
  const one = modelProvider(asked);
  if (asked && !one) return `No provider "${asked}". Providers: ${PROVIDER_IDS.join(', ')}.`;
  const list = one ? [one] : readyProviders();
  if (!list.length) return 'No model provider is set up on this PC.';
  const per = one ? limit : Math.max(10, Math.floor(limit / list.length));
  const parts: string[] = [];
  for (const p of list) {
    const label = `${MODEL_PROVIDERS[p].label} (provider "${p}")`;
    const why = providerProblem(p);
    const all = await availableModels(p);
    const hits = matchModels(all, q);
    const extra =
      p === 'codex' ? '\n(Codex takes any model id your ChatGPT plan has; an empty model means Codex picks.)' : p === 'hermes' ? '\n(an empty model means the profile\'s own model)' : p === 'pi' || p === 'omp' ? '\n(ids are provider/model; an empty model means its own default)' : p === 'openclaw' ? "\n(an empty model means the OpenClaw agent's own model)" : p === 'claude' ? '\n(the short names always point to the latest version)' : '';
    if (!all.length) {
      parts.push(`${label}: ${why ? `not usable: ${why}.` : OWN_DEFAULT.has(p) ? 'no list of models.' : "couldn't list its models (is it running?)."}${extra}`);
      continue;
    }
    const shown = hits.slice(0, per);
    parts.push(`${label}${why ? ` (not usable right now: ${why})` : ''}: ${hits.length} of ${all.length} models match${q ? ` "${q}"` : ''}${hits.length > shown.length ? `, the first ${shown.length} shown (search with more words to narrow it)` : ''}\n${shown.map(line).join('\n') || '(none)'}${extra}`);
  }
  return parts.join('\n\n');
}

/** Is this a model the provider has? null when it is (or the provider can't say). Else why not. */
export async function checkModel(p: ModelProvider, model: string): Promise<string | null> {
  if (p !== 'claude' && !OWN_DEFAULT.has(p)) await availableModels(p);
  return checkModelNow(p, model);
}

/** The same check, without fetching: an API provider's list only when it is fetched already (else the
 *  id is taken as given). For actions that run after the lists were fetched (prepareModels). */
export function checkModelNow(p: ModelProvider, model: string): string | null {
  const id = model.trim();
  if (!id) return OWN_DEFAULT.has(p) ? null : `${MODEL_PROVIDERS[p].label} needs a model id`;
  if (p === 'claude') {
    if (CLAUDE_MODELS.some((m) => m.id === id) || /^claude-[a-z0-9][a-z0-9.-]*(\[1m\])?$/i.test(id)) return null;
    return `"${id}" isn't a Claude Code model (opus, sonnet, haiku, fable or a full claude-… id)`;
  }
  if (OWN_DEFAULT.has(p)) return null;
  const hit = cache.get(cacheKey(p));
  const all = hit && Date.now() - hit.at < CACHE_MS ? hit.list : [];
  // can't list them (server not running): take the id as given
  if (!all.length || all.some((m) => m.id === id)) return null;
  const like = closeModels(all, id);
  return `${MODEL_PROVIDERS[p].label} has no model "${id}"${like.length ? ` (close: ${like.map((m) => m.id).join(', ')})` : ''}`;
}
