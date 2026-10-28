import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import { brainModelChip, openModelPicker } from '../../web/models.ts';
import { openBranchBuilder } from '../../web/builder.ts';
import type { ModelPatch } from '../../web/models.ts';
import type { AppState } from '../../shared/types.ts';

type Reply = { status?: number; body: unknown };
type Route = (method: string, path: string, body: unknown) => Reply | undefined;
const calls: { method: string; path: string; body: unknown }[] = [];

// Answer the client's fetch('/api/...') calls from a route function.
function serve(route: Route) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method || 'GET';
      const path = String(url).replace(/^\/api/, '');
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const r = route(method, path, body) || (path === '/state' ? { body: state.data } : { status: 404, body: { error: 'not found' } });
      return new Response(JSON.stringify(r.body), { status: r.status || 200 });
    }),
  );
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const buttons = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].filter((b) => b.textContent?.includes(text));

beforeEach(() => {
  calls.length = 0;
  document.body.innerHTML = '<div id="toasts"></div><div id="modal-root"></div>';
  state.data = { agents: [], toolGroups: [], engines: {}, secrets: {}, runs: [], approvals: [] } as unknown as AppState;
});
afterEach(() => {
  vi.unstubAllGlobals();
  state.data = null;
});

describe('model picker: models on this PC', () => {
  it("lists each local server's own models, so picking one never sends an empty model", async () => {
    serve((_m, path) => {
      if (path === '/models?engine=openai&provider=ollama') return { body: [{ id: 'llama3.2' }, { id: 'qwen3' }] };
      if (path.startsWith('/models?engine=openai&provider=')) return { body: [] };
    });
    const picked: ModelPatch[] = [];
    openModelPicker(document.body, { engine: 'openai', provider: 'ollama', model: 'llama3.2' }, (p) => picked.push(p));
    await settle();
    const menu = document.querySelector('.model-menu')!;
    // LM Studio has its own tab, so it isn't listed here
    expect(menu.textContent).not.toContain('LM Studio running');
    expect(menu.textContent).toContain('No models found. Is Custom server running?');
    expect(menu.querySelector('.st-menu-item.on')?.textContent).toContain('llama3.2');
    buttons(menu, 'qwen3')[0].click();
    expect(picked).toEqual([{ engine: 'openai', provider: 'ollama', model: 'qwen3', effort: '' }]);
  });

  it('can type a model id for a local server', async () => {
    serve(() => ({ body: [] }));
    const picked: ModelPatch[] = [];
    openModelPicker(document.body, { engine: 'openai', provider: 'openrouter', model: 'x/y' }, (p) => picked.push(p));
    await settle();
    [...document.querySelectorAll<HTMLButtonElement>('.model-tab')].find((b) => b.textContent === 'LM Studio')!.click();
    await settle();
    const input = [...document.querySelectorAll<HTMLInputElement>('.model-search')].find((i) => i.placeholder.includes('LM Studio'))!;
    input.value = 'my-model';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(picked).toEqual([{ engine: 'openai', provider: 'lmstudio', model: 'my-model', effort: '' }]);
  });
});

describe('model picker: LM Studio tab', () => {
  const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.model-tab')];

  it('sits next to OpenRouter and lists LM Studio models', async () => {
    serve((_m, path) => (path === '/models?engine=openai&provider=lmstudio' ? { body: [{ id: 'qwen3-coder-30b' }] } : { body: [] }));
    const picked: ModelPatch[] = [];
    openModelPicker(document.body, { engine: 'claude-code', model: 'sonnet' }, (p) => picked.push(p));
    expect(tabs().map((t) => t.textContent).slice(0, 3)).toEqual(['Claude', 'OpenRouter', 'LM Studio']);
    tabs().find((t) => t.textContent === 'LM Studio')!.click();
    await settle();
    const menu = document.querySelector('.model-menu')!;
    expect(menu.textContent).toContain('On this PC · LM Studio');
    expect(menu.textContent).not.toContain('OpenRouter key');
    buttons(menu, 'qwen3-coder-30b')[0].click();
    expect(picked).toEqual([{ engine: 'openai', provider: 'lmstudio', model: 'qwen3-coder-30b', effort: '' }]);
  });

  it('opens on the LM Studio tab, marked in use, for an agent on LM Studio', async () => {
    serve(() => ({ body: [] }));
    openModelPicker(document.body, { engine: 'openai', provider: 'lmstudio', model: 'qwen3' }, () => {});
    await settle();
    expect(document.querySelector('.model-tab.on')?.textContent).toBe('LM Studio');
    expect(document.querySelector('.model-tab.cur')?.textContent).toBe('LM Studio');
    expect(document.querySelector('.model-menu .st-menu-item.on')?.textContent).toContain('qwen3');
  });

  it('says how to start LM Studio when it lists no models', async () => {
    serve(() => ({ body: [] }));
    openModelPicker(document.body, { engine: 'claude-code', model: 'sonnet' }, () => {});
    tabs().find((t) => t.textContent === 'LM Studio')!.click();
    await settle();
    expect(document.querySelector('.model-menu')!.textContent).toContain('Is LM Studio running? (LM Studio > Developer > Start server)');
  });

  it('is not offered where models on this PC cannot be used (the Brain)', () => {
    serve(() => ({ body: [] }));
    openModelPicker(document.body, { engine: 'claude-code', model: 'sonnet' }, () => {}, { local: false });
    expect(tabs().map((t) => t.textContent)).not.toContain('LM Studio');
  });

  it("the Brain's picker offers only the engines the Brain can think with, favorites too", () => {
    serve(() => ({ body: [] }));
    (state.data as unknown as { settings: Record<string, unknown> }).settings = {
      brain: { provider: 'claude', model: 'haiku' },
      favoriteModels: [
        { engine: 'pi', model: '' },
        { engine: 'codex', model: 'gpt-5' },
      ],
    };
    document.body.append(brainModelChip());
    document.querySelector<HTMLButtonElement>('.model-chip')!.click();
    const names = tabs().map((t) => t.textContent);
    expect(names).toEqual(['Favorites', 'Claude', 'OpenRouter', '☤Hermes', 'Codex']);
    const rows = [...document.querySelectorAll('.model-body .model-row')].map((r) => r.textContent);
    expect(rows).toEqual([expect.stringContaining('gpt-5')]);
  });
});

describe('model picker: effort', () => {
  const levels = () => [...document.querySelectorAll<HTMLButtonElement>('.model-effort-level')];
  const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.model-tab')].find((b) => b.textContent === label)!;

  it("shows the engine's own levels and changes the effort of the model in use at once, staying open", () => {
    serve(() => ({ body: [] }));
    const picked: ModelPatch[] = [];
    openModelPicker(document.body, { engine: 'claude-code', model: 'opus', effort: 'high' }, (p) => picked.push(p));
    expect(levels().map((b) => b.textContent)).toEqual(['Default', 'Low', 'Med', 'High', 'X-High', 'Max']);
    expect(document.querySelector('.model-effort-level.on')?.textContent).toBe('High');
    levels().find((b) => b.textContent === 'Max')!.click();
    expect(picked).toEqual([{ engine: 'claude-code', model: 'opus', effort: 'max' }]);
    expect(document.querySelector('.model-menu')).not.toBeNull();
    expect(document.querySelector('.model-effort-level.on')?.textContent).toBe('Max');
  });

  it('carries the effort to a model on another engine, as its nearest level', async () => {
    serve(() => ({ body: [] }));
    const picked: ModelPatch[] = [];
    openModelPicker(document.body, { engine: 'claude-code', model: 'opus', effort: 'max' }, (p) => picked.push(p));
    tab('Codex').click();
    // Codex has no "max": its highest level shows, and nothing is applied yet
    expect(levels().map((b) => b.textContent)).toEqual(['Default', 'Min', 'Low', 'Med', 'High', 'X-High']);
    expect(document.querySelector('.model-effort-level.on')?.textContent).toBe('X-High');
    expect(picked).toEqual([]);
    // (no list from the server: the built-in one shows)
    await vi.waitFor(() => expect(buttons(document.querySelector('.model-menu')!, 'gpt-6-astra').length).toBe(1));
    buttons(document.querySelector('.model-menu')!, 'gpt-6-astra')[0].click();
    expect(picked).toEqual([{ engine: 'codex', model: 'gpt-6-astra', effort: 'xhigh' }]);
    expect(document.querySelector('.model-menu')).toBeNull();
  });

  it("lists the models Codex has, not a fixed few", async () => {
    serve((_m, path) =>
      path === '/models?engine=codex'
        ? { body: [{ id: '', name: "Codex's default model" }, { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', description: 'Latest workhorse model.' }, { id: 'gpt-6-luna', name: 'GPT-6-Luna' }] }
        : { body: [] },
    );
    const picked: ModelPatch[] = [];
    openModelPicker(document.body, { engine: 'codex', model: '' }, (p) => picked.push(p));
    const menu = document.querySelector('.model-menu')!;
    await vi.waitFor(() => expect(buttons(menu, 'GPT-6.1-Sol').length).toBe(1));
    expect(menu.textContent).toContain('Latest workhorse model.');
    expect(buttons(menu, 'gpt-6-astra')).toEqual([]);
    // the default shows once, from the picker itself
    expect(buttons(menu, "Codex's default model").length).toBe(1);
    buttons(menu, 'GPT-6-Luna')[0].click();
    expect(picked).toEqual([{ engine: 'codex', model: 'gpt-6-luna', effort: '' }]);
  });

  it('goes back to the old level when saving the new one fails', async () => {
    serve(() => ({ body: [] }));
    openModelPicker(document.body, { engine: 'claude-code', model: 'opus', effort: 'low' }, async () => false);
    levels().find((b) => b.textContent === 'High')!.click();
    expect(document.querySelector('.model-effort-level.on')?.textContent).toBe('High');
    await settle();
    expect(document.querySelector('.model-effort-level.on')?.textContent).toBe('Low');
    // picking a model afterwards uses the level that is really set
    const picked: ModelPatch[] = [];
    openModelPicker(document.body, { engine: 'claude-code', model: 'opus', effort: 'low' }, (p) => (picked.push(p), false));
    levels().find((b) => b.textContent === 'High')!.click();
    await settle();
    buttons(document.querySelector('.model-menu')!, 'Sonnet (latest)')[0].click();
    expect(picked.at(-1)).toMatchObject({ model: 'sonnet', effort: 'low' });
  });

  it('"Default" sends no effort', () => {
    serve(() => ({ body: [] }));
    const picked: ModelPatch[] = [];
    openModelPicker(document.body, { engine: 'codex', model: '', effort: 'low' }, (p) => picked.push(p));
    levels()[0].click();
    expect(picked).toEqual([{ engine: 'codex', model: '', effort: '' }]);
  });
});

describe('model picker: favorites', () => {
  const settings = () => state.data!.settings;
  beforeEach(() => {
    state.data!.settings = { favoriteModels: [] } as unknown as AppState['settings'];
  });

  it('stars a model, saves it in the settings, and opens on a Favorites tab next time', async () => {
    serve((method, path, body) => (method === 'PUT' && path === '/settings' ? { body: { ...settings(), ...(body as object) } } : undefined));
    openModelPicker(document.body, { engine: 'claude-code', model: 'sonnet' }, () => {});
    expect([...document.querySelectorAll('.model-tab')].map((t) => t.textContent)).not.toContain('Favorites');
    const opusRow = [...document.querySelectorAll('.model-row')].find((r) => r.textContent?.includes('Opus (latest)'))!;
    const star = opusRow.querySelector<HTMLButtonElement>('.model-fav')!;
    expect(star.getAttribute('aria-pressed')).toBe('false');
    star.click();
    await settle();
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(calls.find((c) => c.method === 'PUT' && c.path === '/settings')?.body).toEqual({ favoriteModels: [{ engine: 'claude-code', model: 'opus' }] });
    // the menu is still open, now with a Favorites tab
    expect(document.querySelector('.model-tab')?.textContent).toBe('Favorites');

    const picked: ModelPatch[] = [];
    openModelPicker(document.body, { engine: 'claude-code', model: 'sonnet', effort: 'high' }, (p) => picked.push(p));
    expect(document.querySelector('.model-tab.on')?.textContent).toBe('Favorites');
    const rows = [...document.querySelectorAll('.model-body .model-row')];
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Claude Opus 5.5')]);
    rows[0].querySelector<HTMLButtonElement>('.st-menu-item')!.click();
    expect(picked).toEqual([{ engine: 'claude-code', model: 'opus', effort: 'high' }]);
  });

  it('unstarring the last favorite goes back to the engine in use', async () => {
    settings().favoriteModels = [{ engine: 'openai', provider: 'ollama', model: 'llama3.2' }];
    serve((method, path, body) => (method === 'PUT' && path === '/settings' ? { body: { ...settings(), ...(body as object) } } : { body: [] }));
    openModelPicker(document.body, { engine: 'codex', model: '' }, () => {});
    expect(document.querySelector('.model-body')?.textContent).toContain('llama3.2');
    expect(document.querySelector('.model-body')?.textContent).toContain('Ollama');
    document.querySelector<HTMLButtonElement>('.model-body .model-fav')!.click();
    await settle();
    expect(settings().favoriteModels).toEqual([]);
    expect(document.querySelector('.model-tab.on')?.textContent).toBe('Codex');
    expect([...document.querySelectorAll('.model-tab')].map((t) => t.textContent)).not.toContain('Favorites');
  });

  it("leaves out favorites on this PC's servers where they can't be used (the Brain)", () => {
    settings().favoriteModels = [
      { engine: 'openai', provider: 'ollama', model: 'llama3.2' },
      { engine: 'openai', provider: 'openrouter', model: 'x/y' },
    ];
    serve(() => ({ body: [] }));
    openModelPicker(document.body, { engine: 'claude-code', model: 'haiku' }, () => {}, { local: false });
    const rows = [...document.querySelectorAll('.model-body .model-row')].map((r) => r.textContent);
    expect(rows).toEqual([expect.stringContaining('OpenRouter')]);
    // with only a local favorite there is no Favorites tab at all
    settings().favoriteModels = [{ engine: 'openai', provider: 'ollama', model: 'llama3.2' }];
    openModelPicker(document.body, { engine: 'claude-code', model: 'haiku' }, () => {}, { local: false });
    expect([...document.querySelectorAll('.model-tab')].map((t) => t.textContent)).not.toContain('Favorites');
    // an agent's picker does show it
    openModelPicker(document.body, { engine: 'claude-code', model: 'haiku' }, () => {});
    expect(document.querySelector('.model-body')!.textContent).toContain('llama3.2');
  });

  it('puts the star back when saving fails', async () => {
    serve((method, path) => (method === 'PUT' && path === '/settings' ? { status: 500, body: { error: 'disk full' } } : undefined));
    openModelPicker(document.body, { engine: 'claude-code', model: 'sonnet' }, () => {});
    const star = document.querySelector<HTMLButtonElement>('.model-fav')!;
    star.click();
    await settle();
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(settings().favoriteModels).toEqual([]);
  });
});

describe('team builder: saving', () => {
  const draft = (name: string) => ({ newAgent: { name, emoji: '🤖', specialty: '', systemPrompt: '', toolGroups: [], mcpServers: [], engine: 'claude-code' as const } });
  let failHire: string | null = null;
  let failTeam = false;
  beforeEach(() => {
    failHire = null;
    failTeam = false;
    let n = 0;
    serve((method, path, body) => {
      if (path === '/mcp') return { body: { servers: {} } };
      if (method === 'POST' && path === '/agents') {
        const name = (body as { name: string }).name;
        return name === failHire ? { status: 500, body: { error: 'nope' } } : { body: { id: `id-${name}-${++n}`, name } };
      }
      if (method === 'POST' && path === '/workflows') return failTeam ? { status: 500, body: { error: 'nope' } } : { body: { id: 'team1', ...(body as object) } };
    });
  });
  const hires = () => calls.filter((c) => c.method === 'POST' && c.path === '/agents').map((c) => (c.body as { name: string }).name);
  const teamBody = () => calls.find((c) => c.method === 'POST' && c.path === '/workflows')?.body as { members: string[]; lead: string | null } | undefined;
  const saveBtn = () => buttons(document, 'Create team')[0];

  it('keeps a new-agent lead after removing a member above it', async () => {
    await openBranchBuilder({ prefill: { name: 'Crew', members: [draft('A'), draft('B'), draft('C')], leadIndex: 1 } });
    buttons(document, '✕').filter((b) => b.title === 'Remove')[0].click();
    saveBtn().click();
    await settle();
    expect(hires()).toEqual(['B', 'C']);
    const body = teamBody()!;
    expect(body.lead).toMatch(/^id-B-/);
    expect(body.members[0]).toBe(body.lead);
  });

  it('a double click saves once', async () => {
    await openBranchBuilder({ prefill: { name: 'Crew', members: [draft('A'), draft('B')], leadIndex: -1 } });
    saveBtn().click();
    saveBtn().click();
    await settle();
    expect(hires()).toEqual(['A', 'B']);
    expect(calls.filter((c) => c.path === '/workflows')).toHaveLength(1);
  });

  it('a retry after a failed hire does not hire the earlier agents again', async () => {
    await openBranchBuilder({ prefill: { name: 'Crew', members: [draft('A'), draft('B')], leadIndex: 0 } });
    failHire = 'B';
    saveBtn().click();
    await settle();
    expect(teamBody()).toBeUndefined();
    failHire = null;
    saveBtn().click();
    await settle();
    expect(hires()).toEqual(['A', 'B', 'B']);
    const body = teamBody()!;
    expect(body.members).toHaveLength(2);
    expect(body.lead).toMatch(/^id-A-/);
  });

  it('a retry after a failed team save reuses the hired agents', async () => {
    await openBranchBuilder({ prefill: { name: 'Crew', members: [draft('A')], leadIndex: 0 } });
    failTeam = true;
    saveBtn().click();
    await settle();
    failTeam = false;
    saveBtn().click();
    await settle();
    expect(hires()).toEqual(['A']);
    const posts = calls.filter((c) => c.path === '/workflows');
    expect(posts).toHaveLength(2);
    expect((posts[1].body as { lead: string }).lead).toMatch(/^id-A-/);
  });

  it("editing a step list keeps its approval and post steps (the Station's stepList)", async () => {
    state.data!.agents = [{ id: 'a1', name: 'Writer' }, { id: 'a2', name: 'Editor' }] as AppState['agents'];
    serve((method, path, body) => {
      if (path === '/mcp') return { body: { servers: {} } };
      if (method === 'PUT' && path === '/workflows/w1') return { body: body };
    });
    const stepList = [{ type: 'agent', agentId: 'a1' }, { type: 'approval' }, { type: 'agent', agentId: 'a2' }, { type: 'x_post' }];
    const wf = { id: 'w1', name: 'Posting', members: ['a1', 'a2'], steps: [{ type: 'agent', agentId: 'a1' }, { type: 'agent', agentId: 'a2' }], stepList };
    await openBranchBuilder({ wf: wf as never });
    buttons(document, '✕').filter((b) => b.title === 'Remove')[1].click();
    buttons(document, 'Save team')[0].click();
    await settle();
    const put = calls.find((c) => c.method === 'PUT')!.body as { steps: { type: string; agentId?: string }[]; stepList?: unknown };
    expect(put.steps.map((x) => x.agentId || x.type)).toEqual(['a1', 'approval', 'x_post']);
    expect(put.stepList).toBeUndefined();
  });
});
