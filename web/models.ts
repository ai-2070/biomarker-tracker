// Model names with versions, and one picker used everywhere a model can be switched
// (agents, the Brain chat, Settings): tabs for your favorites, Claude Code, OpenRouter, LM Studio, Hermes, Codex, pi,
// oh-my-pi and OpenClaw,
// and how hard the model thinks (effort).
import { h, mount, state, GET, PUT, attempt, refreshSoon, toast, navigate } from './core.ts';
import { icon, logo } from './icons.ts';
import { appIcon } from './appicons.ts';
import { uiZoom } from './look.ts';
import { EFFORT_NAMES, effortFor, effortLevels } from '../shared/effort.ts';
import type { Agent, BrainSetting, Effort, EngineId, EngineStatus, FavoriteModel } from '../shared/types.ts';
import type { Child } from './core.ts';

/** What modelInfo() needs: an agent, or the Brain dressed up as one (brainAsAgent). */
export interface ModelTarget {
  engine: EngineId;
  model?: string;
  provider?: string;
  claudeAuth?: string;
  hermesProfile?: string;
  openclawAgent?: string;
  effort?: Effort | '';
}
/** A model in the picker: its engine and model (and provider for API models). */
export interface ModelChoice {
  engine: EngineId;
  model?: string;
  provider?: string;
}
/** What the picker hands to apply(): the model, and the effort for it ('' = the model's default). */
export interface ModelPatch extends ModelChoice {
  effort: Effort | '';
}
export interface ModelInfo {
  name: string;
  short: string;
  latest: boolean;
  brand: string | null;
  where: string;
}
/** One entry of GET /api/models (engine=openai, codex, pi…). */
export interface ModelListing {
  id: string;
  name?: string;
  context?: number | null;
  tools?: boolean;
  price?: { in: number; out: number } | null;
  /** Codex: what the model is for */
  description?: string;
}
/** A picker tab: an engine, Favorites, or LM Studio (API models on this PC, with a tab of their own). */
type PickerTab = EngineId | 'fav' | 'lmstudio';
interface ModelTab {
  engine: PickerTab;
  label: string;
  brand: string | null;
  glyph?: string;
}
/** The tab a model belongs on: LM Studio models run on the API-model engine but get their own tab. */
export const tabOf = (t: { engine: EngineId; provider?: string }): EngineId | 'lmstudio' => (t.engine === 'openai' && t.provider === 'lmstudio' ? 'lmstudio' : t.engine);

// What Claude Code's short names point to today.
const CLAUDE = [
  { id: 'claude-opus-5-5', alias: 'opus', family: 'Opus', version: '5.5', note: 'most capable' },
  { id: 'claude-sonnet-5-5', alias: 'sonnet', family: 'Sonnet', version: '5.5', note: 'fast and smart' },
  { id: 'claude-haiku-5-5', alias: 'haiku', family: 'Haiku', version: '5.5', note: 'fastest, cheapest' },
  { id: 'claude-fable-5-1', alias: 'fable', family: 'Fable', version: '5.1', note: 'creative writing' },
];
const OPENROUTER_PICKS = ['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5'];
// shown when the server can't be reached; normally Codex's own list comes from GET /models?engine=codex
const CODEX_PICKS: ModelListing[] = [{ id: 'gpt-6-astra', name: 'GPT-6-Astra', description: 'Frontier intelligence for the most demanding work.' }];

const TABS: ModelTab[] = [
  { engine: 'claude-code', label: 'Claude', brand: 'claude' },
  { engine: 'openai', label: 'OpenRouter', brand: 'openrouter', glyph: '◇' },
  { engine: 'lmstudio', label: 'LM Studio', brand: null, glyph: 'LM' },
  { engine: 'hermes', label: 'Hermes', brand: null, glyph: '☤' },
  { engine: 'codex', label: 'Codex', brand: 'openai' },
  { engine: 'pi', label: 'pi', brand: null, glyph: 'π' },
  { engine: 'omp', label: 'OMP', brand: null, glyph: 'Ω' },
  { engine: 'openclaw', label: 'OpenClaw', brand: null, glyph: '🦞' },
];
// The CLI engines with their own model lists (GET /models?engine=…): what an empty model means, and where to set them up.
const CLI_TABS: Partial<Record<EngineId, { name: string; own: string; find: string }>> = {
  pi: { name: 'pi', own: "pi's default model", find: 'pi coding agent' },
  omp: { name: 'oh-my-pi', own: "oh-my-pi's default model", find: 'oh-my-pi' },
  openclaw: { name: 'OpenClaw', own: "the OpenClaw agent's own model", find: 'OpenClaw' },
};
const GLYPH: Partial<Record<string, string>> = { hermes: '☤', pi: 'π', omp: 'Ω', openclaw: '🦞' };

// { name: "Claude Sonnet 5.5", short: "Sonnet 5.5", latest: true/false, brand: "claude" | null, where: "Claude Code · Claude login" }
export function modelInfo(a: ModelTarget): ModelInfo {
  const m = String(a.model || '');
  if (a.engine === 'claude-code') {
    const key = m.replace(/^anthropic\//, '').replace(/\./g, '-').toLowerCase() || 'sonnet';
    const c = CLAUDE.find((x) => x.alias === key || x.id === key || key.startsWith(x.id));
    const auth = ({ login: 'Claude login', anthropic: 'Anthropic API key', openrouter: 'OpenRouter' } as Record<string, string | undefined>)[a.claudeAuth || 'login'];
    if (c) return { name: `Claude ${c.family} ${c.version}`, short: `${c.family} ${c.version}`, latest: key === c.alias, brand: 'claude', where: `Claude Code · ${auth}` };
    return { name: m, short: m.split('/').pop()!, latest: false, brand: 'claude', where: `Claude Code · ${auth}` };
  }
  if (a.engine === 'codex') return { name: m || 'Codex default model', short: m || 'Codex', latest: !m, brand: 'openai', where: 'OpenAI Codex · ChatGPT login' };
  if (a.engine === 'hermes') return { name: m || `Hermes profile "${a.hermesProfile || 'default'}"`, short: m ? m.split('/').pop()! : 'Hermes', latest: false, brand: null, where: `Hermes · ${a.hermesProfile || 'default'}` };
  if (a.engine === 'openclaw') return { name: m || `OpenClaw agent "${a.openclawAgent || 'default'}"`, short: m ? m.split('/').pop()! : 'OpenClaw', latest: false, brand: /claude|anthropic/.test(m) ? 'claude' : null, where: `OpenClaw · ${a.openclawAgent || 'default agent'}` };
  if (a.engine === 'pi' || a.engine === 'omp') {
    const label = a.engine === 'pi' ? 'pi' : 'oh-my-pi';
    return { name: m || `${label} default model`, short: m ? m.split('/').pop()! : label, latest: false, brand: /claude|anthropic/.test(m) ? 'claude' : null, where: `${label}${m.includes('/') ? ` · ${m.split('/')[0]}` : ''}` };
  }
  const where = ({ lmstudio: 'LM Studio', ollama: 'Ollama', custom: 'Custom server' } as Record<string, string | undefined>)[a.provider as string] || 'OpenRouter';
  const id = m.split('/').pop() || 'model';
  const c = CLAUDE.find((x) => id.replace(/\./g, '-').startsWith(x.id));
  return { name: c ? `Claude ${c.family} ${c.version}` : id, short: c ? `${c.family} ${c.version}` : id, latest: false, brand: /claude|anthropic/.test(m) ? 'claude' : /llama|ollama/.test(m) ? 'ollama' : where === 'OpenRouter' ? 'openrouter' : null, where };
}

// the model chip; model-chip stays as a marker (the Brain chat and the Station panel style it from outside)
const CHIP = 'inline-flex items-center gap-1.5 py-1 px-2.25 border border-line-2 rounded-full bg-[rgba(7,8,7,0.6)] text-ink font-sans text-[12px] font-semibold leading-[normal] cursor-pointer [transition:border-color_0.18s,background-color_0.18s] hover:border-accent-dim hover:bg-accent/7 [&_.ico-svg]:text-dim';
// the search box over a list (the skill picker has one too)
export const SEARCH = 'model-search mt-1 mb-1.5 px-2.25 py-1.75 text-[13px]';
const chipIcon = (mi: ModelInfo, engine: string): SVGSVGElement | HTMLSpanElement => (mi.brand && logo(mi.brand, 13)) || (GLYPH[engine] ? h('span', { class: 'text-[13px] leading-[13px]' }, GLYPH[engine]) : icon('cpu', 13));

/** The effort a target runs at, as its engine takes it ('' = the model's default). */
export const effortOf = (a: ModelTarget): Effort | '' => effortFor(a.engine, a.effort, a.provider);
const effortTag = (a: ModelTarget) => {
  const e = effortOf(a);
  return e ? h('span', { class: 'font-sans text-[10px] font-semibold leading-[15px] text-accent border border-accent-dim rounded-full px-1.5', title: `Effort: ${EFFORT_NAMES[e]}` }, EFFORT_NAMES[e]) : null;
};
/** "Claude Opus 5.5" or "Claude Opus 5.5 (high effort)" */
const withEffort = (a: ModelTarget) => {
  const e = effortOf(a);
  return `${modelInfo(a).name}${e ? ` (${EFFORT_NAMES[e].toLowerCase()} effort)` : ''}`;
};
const sameModel = (a: ModelChoice, b: ModelChoice) => a.engine === b.engine && String(a.model || '') === String(b.model || '') && (a.engine !== 'openai' || (a.provider || 'openrouter') === (b.provider || 'openrouter'));

// ---------- favorites (Settings: favoriteModels) ----------
const ENGINES: EngineId[] = ['claude-code', 'openai', 'hermes', 'codex', 'pi', 'omp', 'openclaw'];
export function favoriteModels(): FavoriteModel[] {
  const list = state.data?.settings?.favoriteModels;
  return Array.isArray(list) ? list.filter((f) => f && ENGINES.includes(f.engine) && typeof f.model === 'string') : [];
}
export const isFavorite = (m: ModelChoice) => favoriteModels().some((f) => sameModel(f, m));
/** Star or unstar a model. Saved in Settings, so every picker shows it. */
export async function toggleFavorite(m: ModelChoice): Promise<boolean> {
  const before = favoriteModels();
  const on = !before.some((f) => sameModel(f, m));
  const fav: FavoriteModel = { engine: m.engine, model: m.model || '', ...(m.engine === 'openai' ? { provider: m.provider || 'openrouter' } : {}) };
  const list = on ? [...before, fav] : before.filter((f) => !sameModel(f, m));
  if (state.data?.settings) state.data.settings.favoriteModels = list;
  const r = await attempt(() => PUT('/settings', { favoriteModels: list }));
  if (!r && state.data?.settings) state.data.settings.favoriteModels = before;
  return r ? on : !on;
}

// A chip showing an agent's model; click it to switch (model or what it runs on).
export function modelChip(agent: Agent, { onChange, compact = false }: { onChange?: (agent: Agent) => void; compact?: boolean } = {}): HTMLButtonElement {
  const chip = h('button.model-chip', { class: CHIP, type: 'button', title: 'Switch model' });
  const draw = () => {
    const mi = modelInfo(agent);
    mount(chip, chipIcon(mi, agent.engine), h('span', mi.short), effortTag(agent), mi.latest && !compact ? h('span.model-latest', 'latest') : null, icon('chevron-down', 12));
  };
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    openModelPicker(chip, agent, async (patch) => {
      const sameOne = sameModel(agent, patch);
      const r = await attempt(() => PUT<Agent>(`/agents/${agent.id}`, patch));
      if (!r) return false;
      Object.assign(agent, patch);
      draw();
      refreshSoon(0);
      const e = effortOf(agent);
      toast(sameOne ? `${agent.name} now thinks at ${e ? `${EFFORT_NAMES[e].toLowerCase()} effort` : "the model's default effort"}` : `${agent.name} now uses ${withEffort(agent)}`);
      onChange?.(agent);
      return true;
    }, { title: agent.name, local: true });
  });
  draw();
  return chip;
}

// ---------- the Brain's own model ----------
// settings.brain = { provider: 'claude' | 'openrouter' | 'hermes' | 'codex', model }
const BRAIN_ENGINE: Record<string, EngineId | undefined> = { claude: 'claude-code', openrouter: 'openai', hermes: 'hermes', codex: 'codex' };
const BRAIN_PROVIDER: Record<string, BrainSetting['provider'] | undefined> = { 'claude-code': 'claude', openai: 'openrouter', hermes: 'hermes', codex: 'codex' };
/** The engines the Brain can think with (its picker offers only these). */
const BRAIN_ENGINES: readonly EngineId[] = ['claude-code', 'openai', 'hermes', 'codex'];
export function brainAsAgent(b: { provider?: string; model?: string; effort?: Effort | '' } | null | undefined = state.data?.settings?.brain): ModelTarget & { model: string; provider: string } {
  const p = b?.provider || 'claude';
  return { engine: BRAIN_ENGINE[p] || 'claude-code', model: b?.model ?? 'haiku', provider: 'openrouter', effort: b?.effort || '' };
}
export function brainModelChip({ onChange, prefix = 'Brain · ' }: { onChange?: (brain: BrainSetting) => void; prefix?: string } = {}): HTMLButtonElement {
  const chip = h('button.model-chip', { class: CHIP, type: 'button', title: "The Brain's model: answers about the project, builds teams and agents, hands out work" });
  const draw = () => {
    const a = brainAsAgent();
    const mi = modelInfo(a);
    mount(chip, chipIcon(mi, a.engine), h('span', `${prefix}${mi.short}`), effortTag(a), icon('chevron-down', 12));
  };
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    openModelPicker(chip, brainAsAgent(), async (patch) => {
      const sameOne = sameModel(brainAsAgent(), patch);
      // (an engine the Brain can't think with is not offered; never quietly swap in Claude for one)
      const provider = BRAIN_PROVIDER[patch.engine];
      if (!provider) {
        toast("The Brain can't use that engine. Pick Claude, OpenRouter, Hermes or Codex.", 'error');
        return false;
      }
      const brain: BrainSetting = { provider, model: patch.model ?? '', effort: patch.effort };
      const r = await attempt(() => PUT('/settings', { brain }));
      if (!r) return false;
      if (state.data?.settings) state.data.settings.brain = brain;
      draw();
      refreshSoon(0);
      const e = effortOf(brainAsAgent(brain));
      toast(sameOne ? `The Brain now thinks at ${e ? `${EFFORT_NAMES[e].toLowerCase()} effort` : "the model's default effort"}` : `The Brain now thinks with ${withEffort(brainAsAgent(brain))}`);
      onChange?.(brain);
      return true;
    }, { title: "The Brain's model", local: false, engines: BRAIN_ENGINES });
  });
  draw();
  return chip;
}

// ---------- the picker ----------
// cur: { engine, model, provider, effort }. apply(patch) gets { engine, model, provider?, effort }.
// Picking a model closes the picker; changing the effort of the model in use applies it at once and keeps it open
// (apply returns, or resolves to, false when that failed: the row goes back to what it was).
// local: offer models on this PC (LM Studio, Ollama, a custom server); the Brain can't use them.
// engines: only these engines' tabs and favorites (the Brain's picker); all when left out.
export function openModelPicker(anchor: Element, cur: ModelTarget, apply: (patch: ModelPatch) => unknown, { title = 'Model', local = true, engines }: { title?: string; local?: boolean; engines?: readonly EngineId[] } = {}): void {
  const usable = (e: EngineId) => !engines || engines.includes(e);
  document.querySelector('.model-menu')?.remove();
  const r = anchor.getBoundingClientRect();
  const menu = h('div.st-menu.model-menu');
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: PointerEvent) => !menu.contains(e.target as Node | null) && close();
  // the effort asked for (kept as asked: each engine sends its nearest level)
  let effort: Effort | '' = effortOf(cur);
  // favorites this picker can use (without local servers, only OpenRouter's API models)
  const favs = () => favoriteModels().filter((f) => usable(f.engine) && (local || f.engine !== 'openai' || (f.provider || 'openrouter') === 'openrouter'));
  // LM Studio's tab only where models on this PC can be used (not for the Brain)
  const myTabs = TABS.filter((t) => (local || t.engine !== 'lmstudio') && (t.engine === 'fav' || t.engine === 'lmstudio' || usable(t.engine)));
  const curTab = tabOf(cur);
  const homeTab = (): PickerTab => (myTabs.some((t) => t.engine === curTab) ? curTab : 'claude-code');
  let tab: PickerTab = favs().length ? 'fav' : homeTab();
  // the engine the effort row is for: on Favorites, the one in use
  const tabEngine = (): EngineId => (tab === 'fav' ? cur.engine : tab === 'lmstudio' ? 'openai' : tab);
  const body = h('div.model-body', { class: 'max-h-95 overflow-y-auto' });
  const effortBox = h('div', { class: 'px-1.5 pb-2 border-b border-line mb-1' });
  const pick = (choice: ModelChoice) => (close(), apply({ ...choice, effort: effortFor(choice.engine, effort, choice.provider) }));
  const star = (choice: ModelChoice) => {
    const btn = h('button.model-fav', { class: 'flex-none grid place-items-center size-7 mr-0.5 rounded-[6px] text-faint cursor-pointer opacity-0 [transition:opacity_.15s,color_.15s,background_.15s] group-hover:opacity-100 focus-visible:opacity-100 hover:text-accent hover:bg-panel-2 [&.on]:opacity-100 [&.on]:text-accent [&.on_.ico-svg]:fill-current [@media(hover:none)]:opacity-100', type: 'button' });
    const draw = (on: boolean) => {
      btn.classList.toggle('on', on);
      btn.title = on ? 'Remove from favorites' : 'Add to favorites';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', String(on));
      mount(btn, icon('star', 14));
    };
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const on = await toggleFavorite(choice);
      draw(on);
      drawTabs();
      // on Favorites the list itself changes (and with none left, back to the engine in use)
      if (tab === 'fav') {
        if (!favs().length) tab = homeTab();
        drawTabs();
        drawEffort();
        drawBody();
      }
    });
    draw(isFavorite(choice));
    return btn;
  };
  const row = (label: string, sub: string | null, active: boolean, choice: ModelChoice, brand: string | null = null) =>
    h(
      'div.model-row',
      { class: 'group flex items-center gap-0.5' },
      h(`button.st-menu-item${active ? '.on' : ''}`, { class: 'flex-1 min-w-0', type: 'button', onclick: () => pick(choice) }, active ? icon('check', 15) : (brand && logo(brand, 14)) || icon('cpu', 15), h('span', { class: 'flex-1 min-w-0' }, label, sub ? h('span.model-sub', sub) : null)),
      star(choice),
    );
  const free = (placeholder: string, toChoice: (model: string) => ModelChoice) => {
    const input = h('input', { class: SEARCH, placeholder });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.value.trim() && pick(toChoice(input.value.trim())));
    return input;
  };
  const missing = (text: string, settingsFind: string) =>
    h('div', { class: 'flex items-center gap-2 mx-1.5 mb-1.5 px-2.25 py-1.75 rounded-[8px] text-[12px] text-amber bg-amber/10' }, icon('triangle-alert', 14), h('span', { class: 'flex-1 min-w-0' }, text), h('button.btn.tiny', { onclick: () => (close(), navigate(`#/settings?tab=general&find=${encodeURIComponent(settingsFind)}`)) }, 'Set up'));
  const same = (engine: EngineId, model: string) => cur.engine === engine && String(cur.model || '') === model;
  // The models a server on this PC offers (LM Studio, Ollama, a custom one). It needs one of its own model ids:
  // an empty model would fall back to the OpenRouter default.
  const localModels = (p: string, label: string, howToStart = ''): Child[] => {
    const on = (id: string) => cur.engine === 'openai' && cur.provider === p && cur.model === id;
    const box = h('div.model-list', h('div.model-sub', { class: 'px-2.5 py-1' }, 'Looking for models…'));
    const fillLocal = (ms: ModelListing[]) => {
      const ids = ms.map((m) => m.id);
      if (cur.engine === 'openai' && cur.provider === p && cur.model && !ids.includes(cur.model)) ids.unshift(cur.model);
      mount(box, ids.length ? ids.map((id) => row(id, null, on(id), { engine: 'openai', provider: p, model: id }, p === 'ollama' ? 'ollama' : null)) : h('div.model-sub', { class: 'px-2.5 py-1' }, `No models found. Is ${label} running?${howToStart ? ` (${howToStart})` : ''}`));
    };
    GET<ModelListing[]>(`/models?engine=openai&provider=${p}`).then(fillLocal, () => fillLocal([]));
    return [h('div.st-menu-head', `On this PC · ${label}`), box, free(`or type a ${label} model id and press Enter`, (m) => ({ engine: 'openai', provider: p, model: m }))];
  };

  // Effort: the levels the tab's engine takes, and the model's own default.
  const SHORT: Record<Effort, string> = { minimal: 'Min', low: 'Low', medium: 'Med', high: 'High', xhigh: 'X-High', max: 'Max' };
  const drawEffort = () => {
    const engine = tabEngine();
    // the provider the effort row is for: the one in use on Favorites or its own tab, else the tab's own
    const live = tab === 'fav' || tab === curTab;
    const provider = engine !== 'openai' ? undefined : live ? cur.provider : tab === 'lmstudio' ? 'lmstudio' : 'openrouter';
    const shown = effortFor(engine, effort, provider);
    const level = (value: Effort | '') =>
      h(
        `button.model-effort-level${shown === value ? '.on' : ''}`,
        {
          class: 'flex-1 min-w-0 py-1.25 px-0.5 border border-line rounded-ctl text-dim font-sans text-[11px] font-medium leading-[normal] cursor-pointer whitespace-nowrap [transition:border-color_.15s,color_.15s,background_.15s] hover:text-ink hover:border-line-2 [&.on]:border-accent [&.on]:text-ink [&.on]:bg-accent/10',
          type: 'button',
          title: value ? `${EFFORT_NAMES[value]} effort` : "The model's own default",
          'aria-pressed': String(shown === value),
          onclick: async (e: MouseEvent) => {
            e.stopPropagation();
            const before = effort;
            effort = value;
            drawEffort();
            if (!live) return;
            // the model in use: change its effort now (the picker stays open); not saved: back to what it was
            const ok = await apply({ engine: cur.engine, model: cur.model ?? '', ...(cur.engine === 'openai' ? { provider: cur.provider } : {}), effort: effortFor(cur.engine, value, cur.provider) });
            if (ok === false && effort === value) {
              effort = before;
              drawEffort();
            }
          },
        },
        value ? SHORT[value] : 'Default',
      );
    mount(
      effortBox,
      h('div', { class: 'flex items-center gap-1.5 px-1 pb-1.25 font-sans text-[11px] font-semibold leading-[normal] text-dim' }, icon('gauge', 13), h('span', 'Effort'), h('span', { class: 'ml-auto font-normal text-faint' }, live ? 'how hard it thinks' : 'for the model you pick here')),
      h('div', { class: 'flex gap-0.75', role: 'group', 'aria-label': 'Effort' }, level(''), effortLevels(engine, provider).map(level)),
    );
  };

  const drawBody = () => {
    const eng: Partial<EngineStatus> = state.data?.engines || {};
    const items: Child[] = [];
    if (tab === 'fav') {
      items.push(h('div.st-menu-head', 'Favorites'));
      for (const f of favs()) {
        const mi = modelInfo(f);
        items.push(row(mi.name || f.model, mi.where, sameModel(cur, f), f, mi.brand));
      }
    } else if (tab === 'claude-code') {
      if (eng['claude-code'] && !eng['claude-code'].installed) items.push(missing('Claude Code is not installed on this PC.', 'Claude Code'));
      items.push(h('div.st-menu-head', 'Always the newest'));
      for (const c of CLAUDE) items.push(row(`${c.family} (latest)`, `now ${c.version} · ${c.note}`, same('claude-code', c.alias), { engine: 'claude-code', model: c.alias }, 'claude'));
      items.push(h('div.st-menu-head', 'Pinned version'));
      for (const c of CLAUDE) items.push(row(`${c.family} ${c.version}`, c.id, same('claude-code', c.id), { engine: 'claude-code', model: c.id }, 'claude'));
    } else if (tab === 'openai') {
      const hasKey = !!state.data?.secrets?.openrouterKey?.set;
      if (!hasKey) items.push(missing('Add your OpenRouter key first.', 'OpenRouter key'));
      const search = h('input', { class: SEARCH, placeholder: 'Search 300+ models (gpt, gemini, llama, deepseek…)' });
      const list = h('div.model-list');
      let all: ModelListing[] = [];
      const fill = () => {
        const q = search.value.toLowerCase();
        const pool: ModelListing[] = all.length ? all : OPENROUTER_PICKS.map((id) => ({ id, name: id }));
        const shown = (q ? pool.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(q)) : pool.filter((m) => OPENROUTER_PICKS.includes(m.id) || m.id === cur.model).concat(pool.filter((m) => !OPENROUTER_PICKS.includes(m.id)).slice(0, 25))).slice(0, 60);
        mount(list, shown.map((m) => row(m.name || m.id, m.price ? `$${m.price.in.toFixed(2)} / $${m.price.out.toFixed(2)} per M tokens` : m.id, cur.engine === 'openai' && (cur.provider || 'openrouter') === 'openrouter' && m.id === cur.model, { engine: 'openai', provider: 'openrouter', model: m.id }, /claude|anthropic/.test(m.id) ? 'claude' : null)));
      };
      search.addEventListener('input', fill);
      search.addEventListener('keydown', (e) => e.key === 'Enter' && search.value.trim() && pick({ engine: 'openai', provider: 'openrouter', model: search.value.trim() }));
      items.push(h('div.st-menu-head', 'OpenRouter'), search, list);
      if (hasKey)
        GET<ModelListing[]>('/models?engine=openai&provider=openrouter')
          .then((ms) => {
            all = ms;
            fill();
          })
          .catch(() => {});
      fill();
      if (local) {
        // a local server needs one of its own model ids (an empty model would fall back to the OpenRouter default)
        // (LM Studio has its own tab)
        items.push(...localModels('ollama', 'Ollama'), ...localModels('custom', 'Custom server'));
      }
      setTimeout(() => search.focus(), 30);
    } else if (tab === 'lmstudio') {
      items.push(...localModels('lmstudio', 'LM Studio', 'LM Studio > Developer > Start server'));
    } else if (tab === 'hermes') {
      if (eng.hermes && !eng.hermes.installed) items.push(missing('Hermes is not installed on this PC.', 'Hermes'));
      items.push(h('div.st-menu-head', 'Hermes'), row("The profile's own model", 'whatever your Hermes profile uses', same('hermes', ''), { engine: 'hermes', model: '' }));
      for (const id of OPENROUTER_PICKS.slice(1)) items.push(row(id.split('/').pop()!, id, same('hermes', id), { engine: 'hermes', model: id }, 'claude'));
      items.push(free('or type a model id and press Enter', (m) => ({ engine: 'hermes', model: m })));
    } else if (CLI_TABS[tab]) {
      const engine: EngineId = tab;
      const t = CLI_TABS[engine]!;
      const st: Partial<{ installed: boolean }> = (eng as Partial<Record<string, { installed: boolean }>>)[engine] || {};
      if (eng[engine] && !st.installed) items.push(missing(`${t.name} is not installed on this PC.`, t.find));
      const search = h('input', { class: SEARCH, placeholder: 'Search its models, or type a provider/model id and press Enter' });
      const list = h('div.model-list', h('div.model-sub', { class: 'px-2.5 py-1' }, 'Looking for models…'));
      let all: ModelListing[] = [];
      const fill = () => {
        const q = search.value.toLowerCase();
        const shown = (q ? all.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(q)) : all).slice(0, 60);
        mount(list, all.length ? shown.map((m) => row(m.name || m.id, m.id, same(engine, m.id), { engine, model: m.id }, /claude|anthropic/.test(m.id) ? 'claude' : null)) : h('div.model-sub', { class: 'px-2.5 py-1' }, `No models listed. Sign ${t.name} in to a provider, or type a model id.`));
      };
      search.addEventListener('input', fill);
      search.addEventListener('keydown', (e) => e.key === 'Enter' && search.value.trim() && pick({ engine, model: search.value.trim() }));
      items.push(h('div.st-menu-head', t.name), row(t.own, 'whatever it is set to use', same(engine, ''), { engine, model: '' }), search, list);
      GET<ModelListing[]>(`/models?engine=${engine}`)
        .then((ms) => {
          all = ms;
          fill();
        })
        .catch(() => fill());
    } else {
      const cx: Partial<EngineStatus['codex']> = eng.codex || {};
      if (!cx.installed) items.push(missing('Codex is not installed yet.', 'OpenAI Codex'));
      else if (!cx.loggedIn) items.push(missing('Codex is installed but not signed in.', 'OpenAI Codex'));
      items.push(h('div.st-menu-head', 'OpenAI Codex · your ChatGPT login'), row("Codex's default model", 'whatever Codex picks', same('codex', ''), { engine: 'codex', model: '' }, 'openai'));
      const list = h('div.model-list', h('div.model-sub', { class: 'px-2.5 py-1' }, 'Looking for models…'));
      const fillCodex = (ms: ModelListing[]) =>
        mount(
          list,
          ms.filter((m) => m.id).map((m) => row(m.name || m.id, m.description ? `${m.id} · ${m.description}` : m.id, same('codex', m.id), { engine: 'codex', model: m.id }, 'openai')),
        );
      items.push(list, free('or type a model id and press Enter', (m) => ({ engine: 'codex', model: m })));
      GET<ModelListing[]>('/models?engine=codex').then(
        (ms) => fillCodex(ms.some((m) => m.id) ? ms : CODEX_PICKS),
        () => fillCodex(CODEX_PICKS),
      );
    }
    mount(body, items);
  };

  const tabs = h('div', { class: 'grid grid-cols-[repeat(auto-fill,minmax(66px,1fr))] gap-1 pt-1 px-1.5 pb-2' });
  const drawTabs = (): HTMLDivElement => {
    const shown: ModelTab[] = favs().length ? [{ engine: 'fav', label: 'Favorites', brand: null }, ...myTabs] : myTabs;
    return mount(
      tabs,
      shown.map((t) =>
        h(
          `button.model-tab${tab === t.engine ? '.on' : ''}${curTab === t.engine ? '.cur' : ''}`,
          {
            class: "flex flex-col items-center gap-0.75 py-1.75 px-0.5 border border-line rounded-[8px] text-dim font-sans text-[10.5px] font-medium leading-[normal] cursor-pointer [transition:border-color_.15s,color_.15s,background_.15s] hover:text-ink [&.on]:border-accent [&.on]:text-ink [&.on]:bg-accent/10 [&.cur]:after:content-[''] [&.cur]:after:size-1.25 [&.cur]:after:rounded-full [&.cur]:after:bg-accent",
            type: 'button',
            title: curTab === t.engine ? `${t.label} (in use)` : t.label,
            onclick: (e: MouseEvent) => (e.stopPropagation(), (tab = t.engine), drawTabs(), drawEffort(), drawBody()),
          },
          t.engine === 'fav' ? icon('star', 13) : (t.brand && logo(t.brand, 13)) || appIcon(t.engine, 13) || h('span', { class: 'text-[13px] leading-[13px]' }, t.glyph || '•'),
          h('span', t.label),
        ),
      ),
    );
  };
  drawTabs();
  drawEffort();
  drawBody();
  mount(menu, h('div.st-menu-head', title), tabs, effortBox, body);
  document.body.append(menu);
  const z = uiZoom();
  const W = window.innerWidth / z;
  const H = window.innerHeight / z;
  const R = { left: r.left / z, top: r.top / z, bottom: r.bottom / z };
  const height = Math.min(600, menu.offsetHeight || 480);
  const below = R.bottom + 6 + height < H - 10;
  Object.assign(menu.style, { position: 'fixed', left: `${Math.max(10, Math.min(R.left, W - 330))}px`, top: `${below ? R.bottom + 6 : Math.max(10, R.top - 6 - height)}px`, transform: 'none', zIndex: 95 });
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}
