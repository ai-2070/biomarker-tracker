// The Brain sets the model and effort of agents, several agents or whole teams, and looks up
// which models a provider has.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyActions, ask, clearHistory, effortAsked, history, prepareModels, snapshot } from '../../server/overseer.ts';
import type { BrainAction } from '../../server/overseer.ts';
import { availableModels, checkModel, clearModelCache, findModels, matchModels, modelProvider, providerOfAgent } from '../../server/models.ts';
import { agents, saveSettings, setSecret, workflows } from '../../server/store.ts';
import { newAgent } from '../../server/library.ts';
import { listVersions } from '../../server/versions.ts';

const answers: string[] = [];
const asked: { system: string; user: string }[] = [];
vi.mock('../../server/brain.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/brain.ts')>()),
  brainModel: () => ({ provider: 'openrouter', model: 'mock', fallback: false }),
  think: async (system: string, user: string) => {
    asked.push({ system, user });
    return answers.shift() ?? 'NOTHING';
  },
}));

// OpenRouter's model list, as its /models answers
const OPENROUTER = [
  { id: 'anthropic/claude-opus-5.5', name: 'Anthropic: Claude Opus 5.5', context_length: 1000000, supported_parameters: ['tools'], pricing: { prompt: '0.000005', completion: '0.000025' } },
  { id: 'google/gemini-3-flash', name: 'Google: Gemini 3 Flash', context_length: 1000000, supported_parameters: ['tools'], pricing: { prompt: '0.0000003', completion: '0.0000025' } },
  { id: 'google/gemini-3-pro', name: 'Google: Gemini 3 Pro', context_length: 1000000, supported_parameters: ['tools'], pricing: { prompt: '0.000002', completion: '0.000012' } },
];

beforeEach(() => {
  clearModelCache();
  setSecret('openrouterKey', 'sk-or-test');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('https://openrouter.ai/api/v1/models')) return new Response(JSON.stringify({ data: OPENROUTER }));
      throw new Error('offline');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSecret('openrouterKey', null);
});

const team = (name: string, members: string[]) => workflows.save({ name, members, steps: members.map((agentId) => ({ type: 'agent' as const, agentId })), schedule: { type: 'none' }, enabled: false });

describe('providers and model lists', () => {
  it('knows providers by their names and other common names', () => {
    expect(modelProvider('openrouter')).toBe('openrouter');
    expect(modelProvider('Claude-Code')).toBe('claude');
    expect(modelProvider('anthropic')).toBe('claude');
    expect(modelProvider('LM Studio')).toBe('lmstudio');
    expect(modelProvider('nope')).toBeNull();
    // (built-in object keys aren't providers)
    expect(['constructor', 'toString', '__proto__', 'hasOwnProperty'].map(modelProvider)).toEqual([null, null, null, null]);
    expect(providerOfAgent({ engine: 'openai', provider: 'ollama' })).toBe('ollama');
    expect(providerOfAgent({ engine: 'claude-code', provider: 'openrouter' })).toBe('claude');
    expect(modelProvider('oh-my-pi')).toBe('omp');
    for (const e of ['pi', 'omp', 'openclaw'] as const) expect(providerOfAgent({ engine: e, provider: 'openrouter' })).toBe(e);
  });

  it('pi, oh-my-pi and OpenClaw take any model id, or none (their own default)', async () => {
    for (const p of ['pi', 'omp', 'openclaw'] as const) {
      expect(await checkModel(p, '')).toBeNull();
      expect(await checkModel(p, 'anthropic/claude-sonnet-5-5')).toBeNull();
    }
  });

  it('matches every word of a query in the id or name', () => {
    const list = [
      { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash' },
      { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro' },
    ];
    expect(matchModels(list, 'gemini flash').map((m) => m.id)).toEqual(['google/gemini-3-flash']);
    expect(matchModels(list, '')).toHaveLength(2);
  });

  it("lists a provider's models matching a query, with prices", async () => {
    const text = await findModels('openrouter', 'gemini');
    expect(text).toContain('2 of 3 models match "gemini"');
    expect(text).toContain('google/gemini-3-flash');
    expect(text).toMatch(/\$0\.30 in \/ \$2\.50 out per M tokens/);
    expect(text).not.toContain('claude-opus');
    expect(await findModels('claude', 'opus')).toContain('claude-opus-5-5');
    expect(await findModels('who', '')).toContain('No provider "who"');
    expect(await findModels('constructor', '')).toContain('No provider "constructor"');
  });

  it("keeps each address's own list: a server on this PC moved elsewhere lists its own models", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const id = String(url).startsWith('http://first.local') ? 'model-a' : String(url).startsWith('http://second.local') ? 'model-b' : null;
        if (!id) throw new Error('offline');
        return new Response(JSON.stringify({ data: [{ id }] }));
      }),
    );
    saveSettings({ providers: { lmstudio: { baseUrl: 'http://first.local/v1' } } });
    expect((await availableModels('lmstudio')).map((m) => m.id)).toEqual(['model-a']);
    saveSettings({ providers: { lmstudio: { baseUrl: 'http://second.local/v1' } } });
    expect((await availableModels('lmstudio')).map((m) => m.id)).toEqual(['model-b']);
    expect(await checkModel('lmstudio', 'model-a')).toMatch(/has no model "model-a"/);
    saveSettings({ providers: { lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1' } } });
  });

  it('checks a model id against the provider, with close matches when it is wrong', async () => {
    expect(await checkModel('openrouter', 'google/gemini-3-pro')).toBeNull();
    expect(await checkModel('openrouter', 'google/gemini-3-flsh')).toMatch(/no model "google\/gemini-3-flsh".*close: .*gemini-3-flash/);
    expect(await checkModel('claude', 'opus')).toBeNull();
    expect(await checkModel('claude', 'claude-sonnet-5-5')).toBeNull();
    expect(await checkModel('claude', 'gpt-6')).toMatch(/isn't a Claude Code model/);
    // a list that can't be fetched: the id is taken as given
    expect(await checkModel('lmstudio', 'qwen-local')).toBeNull();
  });

  it('reads effort the way people write it', () => {
    expect(effortAsked(undefined)).toBeUndefined();
    expect(effortAsked('default')).toBe('');
    expect(effortAsked('Extra high')).toBe('xhigh');
    expect(effortAsked('HIGH')).toBe('high');
    expect(() => effortAsked('turbo')).toThrow(/effort is one of/);
  });
});

describe('set_model', () => {
  it("changes one agent's model and keeps the old version", () => {
    const a = newAgent({ name: 'Writer', engine: 'claude-code', model: 'sonnet' });
    const r = applyActions([{ do: 'set_model', to: 'agent', id: a.id, model: 'opus' }]);
    expect(r.done).toEqual([expect.objectContaining({ kind: 'model', agentId: a.id, text: expect.stringContaining('Writer now runs on Claude Code · opus') })]);
    expect(agents.get(a.id)).toMatchObject({ engine: 'claude-code', model: 'opus' });
    expect(listVersions<{ model: string }>(agents.versionsDir!(a.id)!)[0]).toMatchObject({ by: 'brain', item: { model: 'sonnet' } });
  });

  it('changes only the effort, and the nearest level a provider has', () => {
    const a = newAgent({ name: 'Analyst', engine: 'openai', provider: 'openrouter', model: 'google/gemini-3-pro' });
    const r = applyActions([{ do: 'set_model', to: 'agent', id: 'Analyst', effort: 'max' }]);
    // OpenRouter goes up to extra high
    expect(agents.get(a.id)).toMatchObject({ model: 'google/gemini-3-pro', effort: 'xhigh' });
    expect(r.done[0].text).toMatch(/extra high effort.*nearest one/);
    applyActions([{ do: 'set_model', to: 'agent', id: a.id, effort: 'default' }]);
    expect(agents.get(a.id)?.effort).toBe('');
  });

  it('sets every agent on a team, and several targets at once', () => {
    const a = newAgent({ name: 'Cutter', engine: 'claude-code', model: 'sonnet' });
    const b = newAgent({ name: 'Colorist', engine: 'claude-code', model: 'haiku' });
    const c = newAgent({ name: 'Planner', engine: 'claude-code', model: 'sonnet' });
    const t = team('Video crew', [a.id, b.id]);
    const r = applyActions([{ do: 'set_model', to: 'team', id: t.id, model: 'opus', effort: 'high' }]);
    expect(r.done[0]).toMatchObject({ kind: 'model', teamId: t.id, text: expect.stringContaining('Cutter, Colorist now run on Claude Code · opus, high effort') });
    expect([agents.get(a.id), agents.get(b.id)].map((x) => [x?.model, x?.effort])).toEqual([['opus', 'high'], ['opus', 'high']]);
    expect(agents.get(c.id)?.model).toBe('sonnet');

    const two = applyActions([{ do: 'set_model', targets: [{ to: 'agent', id: c.id }, { to: 'team', id: 'Video crew' }], effort: 'low' }]);
    expect(two.done.map((d) => d.kind)).toEqual(['model', 'model']);
    expect([a, b, c].map((x) => agents.get(x.id)?.effort)).toEqual(['low', 'low', 'low']);
  });

  it('moves agents to another provider, with its default model when none is named', () => {
    const a = newAgent({ name: 'Scout', engine: 'claude-code', model: 'sonnet' });
    applyActions([{ do: 'set_model', to: 'agent', id: a.id, provider: 'openrouter' }]);
    expect(agents.get(a.id)).toMatchObject({ engine: 'openai', provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' });
    applyActions([{ do: 'set_model', to: 'agent', id: a.id, provider: 'openrouter', model: 'google/gemini-3-flash' }]);
    expect(agents.get(a.id)?.model).toBe('google/gemini-3-flash');
  });

  it("says what's wrong instead of guessing", () => {
    const a = newAgent({ name: 'Solo', engine: 'claude-code', model: 'sonnet' });
    const r = applyActions([
      { do: 'set_model', to: 'agent', id: a.id },
      { do: 'set_model', to: 'agent', id: a.id, effort: 'turbo' },
      { do: 'set_model', to: 'agent', id: a.id, provider: 'skynet', model: 'x' },
      { do: 'set_model', to: 'agent', id: 'nobody', model: 'opus' },
      { do: 'set_model', to: 'agent', id: a.id, provider: 'lmstudio' },
    ]);
    expect(r.done.map((d) => d.kind)).toEqual(['error', 'error', 'error', 'error', 'error']);
    expect(r.done[0].text).toContain('say the model, the effort or both');
    expect(r.done[2].text).toContain('no provider "skynet"');
    expect(r.done[3].text).toContain('no agent "nobody"');
    expect(r.done[4].text).toContain('say which LM Studio model');
    expect(agents.get(a.id)?.model).toBe('sonnet');
  });

  it('checks the model for an agent made earlier in the same answer', () => {
    const r = applyActions([
      { do: 'hire', members: [{ new: { name: 'Fresh hire', specialty: 'new' } }] },
      { do: 'set_model', to: 'agent', id: 'new', model: 'gpt-6' },
      { do: 'set_model', to: 'agent', id: 'new', model: 'opus' },
    ]);
    const hired = agents.list().find((a) => a.name === 'Fresh hire')!;
    expect(r.done.map((d) => d.kind)).toEqual(['hired', 'error', 'model']);
    expect(r.done[1].text).toContain("Fresh hire: \"gpt-6\" isn't a Claude Code model");
    expect(agents.get(hired.id)?.model).toBe('opus');
  });

  it('checks the model for a team made earlier in the same answer, against the fetched list', async () => {
    const a = newAgent({ name: 'Router', engine: 'openai', provider: 'openrouter', model: 'google/gemini-3-pro' });
    const acts: BrainAction[] = [
      { do: 'create_team', name: 'Fresh team', members: [{ agent: a.id }] },
      { do: 'set_model', to: 'team', id: 'new', model: 'google/gemini-3-flsh' },
      { do: 'set_model', to: 'team', id: 'new', model: 'google/gemini-3-flash' },
    ];
    await prepareModels(acts);
    const r = applyActions(acts);
    expect(r.done.map((d) => d.kind)).toEqual(['team', 'error', 'model']);
    expect(r.done[1].text).toMatch(/Router: OpenRouter has no model "google\/gemini-3-flsh".*close: .*gemini-3-flash/);
    expect(agents.get(a.id)?.model).toBe('google/gemini-3-flash');
  });

  it('checks a model against the provider an earlier action in the same answer moved the agent to', async () => {
    const a = newAgent({ name: 'Mover', engine: 'claude-code', model: 'sonnet' });
    const acts: BrainAction[] = [
      { do: 'set_model', to: 'agent', id: a.id, provider: 'openrouter' },
      { do: 'set_model', to: 'agent', id: a.id, model: 'google/gemini-3-flsh' },
      { do: 'set_model', to: 'agent', id: a.id, model: 'google/gemini-3-flash' },
    ];
    await prepareModels(acts);
    const r = applyActions(acts);
    expect(r.done.map((d) => d.kind)).toEqual(['model', 'error', 'model']);
    expect(r.done[1].text).toMatch(/Mover: OpenRouter has no model "google\/gemini-3-flsh"/);
    expect(agents.get(a.id)).toMatchObject({ engine: 'openai', provider: 'openrouter', model: 'google/gemini-3-flash' });
  });

  it('a model the provider does not have is refused before anything changes', async () => {
    const a = newAgent({ name: 'Researcher', engine: 'openai', provider: 'openrouter', model: 'google/gemini-3-pro' });
    const acts: BrainAction[] = [{ do: 'set_model', to: 'agent', id: a.id, model: 'opus' }];
    await prepareModels(acts);
    const r = applyActions(acts);
    expect(r.done[0]).toMatchObject({ kind: 'error', text: expect.stringContaining('Researcher runs on OpenRouter (give "provider" to move them)') });
    expect(agents.get(a.id)?.model).toBe('google/gemini-3-pro');
  });
});

describe('what the Brain sees', () => {
  it("shows every agent's provider, model and effort", async () => {
    // (the full id the engine reported on its last run)
    agents.save({ ...newAgent({ name: 'Deep thinker', engine: 'claude-code', model: 'opus', effort: 'max' }), lastModel: 'claude-opus-5-5' });
    newAgent({ name: 'Plain one', engine: 'codex', model: '' });
    const snap = await snapshot({ fileBudget: 0 });
    expect(snap).toMatch(/Deep thinker .*\| provider: claude \| model: opus \(last ran as claude-opus-5-5\) \| effort: max \|/);
    expect(snap).toMatch(/Plain one .*\| provider: codex \| model: Codex's default model \| effort: default \(the model's own\) \|/);
  });
});

describe('in the Brain chat', () => {
  it('looks up models, answers again with the list, then sets one', async () => {
    const a = newAgent({ name: 'Summarizer', engine: 'openai', provider: 'openrouter', model: 'anthropic/claude-opus-5.5' });
    clearHistory();
    asked.length = 0;
    answers.push('Let me check.\n```actions\n[{"do":"find_models","provider":"openrouter","query":"gemini flash"}]\n```');
    answers.push(`Switched.\n\`\`\`actions\n[{"do":"set_model","to":"agent","id":"${a.id}","model":"google/gemini-3-flash","effort":"low"}]\n\`\`\``);
    const r = await ask('put the summarizer on a cheap gemini');
    expect(asked).toHaveLength(2);
    expect(asked[0].system).toContain('"do":"set_model"');
    expect(asked[0].user).toContain('provider: openrouter | model: anthropic/claude-opus-5.5 | effort: default');
    const looked = asked[1].user.split('MODELS YOU LOOKED UP')[1] || '';
    expect(looked).toContain('google/gemini-3-flash');
    expect(looked).not.toContain('google/gemini-3-pro');
    expect(r.answer).toBe('Switched.');
    expect(r.done).toEqual([expect.objectContaining({ kind: 'model' })]);
    expect(agents.get(a.id)).toMatchObject({ model: 'google/gemini-3-flash', effort: 'low' });
  });

  it('a new conversation started while model lists are fetched changes nothing and keeps nothing', async () => {
    const a = newAgent({ name: 'Cleared one', engine: 'openai', provider: 'openrouter', model: 'google/gemini-3-pro' });
    clearHistory();
    let fetched!: () => void;
    const gate = new Promise<void>((r) => (fetched = r));
    let calledFetch = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calledFetch = true;
        await gate;
        return new Response(JSON.stringify({ data: OPENROUTER }));
      }),
    );
    answers.push(`Switched.\n\`\`\`actions\n[{"do":"set_model","to":"agent","id":"${a.id}","model":"google/gemini-3-flash"}]\n\`\`\``);
    const n = asked.length;
    const going = ask('put it on flash');
    // (the answer is in: the model list for its set_model is being fetched)
    for (let i = 0; i < 200 && !(calledFetch && asked.length > n); i++) await new Promise((r) => setTimeout(r, 5));
    expect(calledFetch && asked.length > n).toBe(true);
    clearHistory();
    fetched();
    const r = await going;
    expect(r.done).toEqual([expect.objectContaining({ kind: 'error', text: expect.stringContaining('You started a new conversation') })]);
    expect(agents.get(a.id)?.model).toBe('google/gemini-3-pro');
    expect(history()).toEqual([]);
  });

  it('refuses a misspelled model id', async () => {
    const a = newAgent({ name: 'Typist', engine: 'openai', provider: 'openrouter', model: 'google/gemini-3-pro' });
    clearHistory();
    answers.push(`On it.\n\`\`\`actions\n[{"do":"set_model","to":"agent","id":"${a.id}","model":"google/gemini-3-flsh"}]\n\`\`\``);
    const r = await ask('use gemini flash for the typist');
    expect(r.done[0]).toMatchObject({ kind: 'error', text: expect.stringContaining('close: google/gemini-3-flash') });
    expect(agents.get(a.id)?.model).toBe('google/gemini-3-pro');
  });
});

describe('the Station look', () => {
  it('the Brain switches it when you ask, never from a review; the snapshot says which it is', async () => {
    const { getSettings } = await import('../../server/store.ts');
    saveSettings({ look: { stationLook: 'classic' } });
    expect(await snapshot()).toMatch(/Station look: classic \(the Station does NOT draw the voxel world/);
    expect(applyActions([{ do: 'station_look', look: 'world' }], undefined, { auto: true }).done[0]).toMatchObject({ kind: 'error' });
    expect(getSettings().look.stationLook).toBe('classic');
    expect(applyActions([{ do: 'station_look', look: 'world' }]).done).toEqual([{ kind: 'note', text: 'Turned on the voxel look (Settings › Look › Station look)' }]);
    expect(getSettings().look.stationLook).toBe('world');
    expect(await snapshot()).toMatch(/Station look: voxel world/);
    expect(applyActions([{ do: 'station_look', look: 'purple' }]).done[0]).toMatchObject({ kind: 'error' });
  });
});
