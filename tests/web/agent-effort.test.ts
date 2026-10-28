// The agent editor's Effort field: what it shows is what gets saved, also after switching engines.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import { render, unmount } from '../../web/views/agents.tsx';
import type { Agent, AppState } from '../../shared/types.ts';

const agent = { id: 'a1', name: 'Thinker', emoji: '🤖', color: '#fff', specialty: '', description: '', systemPrompt: '', engine: 'claude-code', model: 'opus', provider: 'openrouter', claudeAuth: 'login', hermesProfile: '', autonomy: 'auto', toolGroups: [], mcpServers: [], knowledge: { folders: [] }, workspace: '', temperature: '', effort: 'max', alwaysAllow: [], skills: [], source: { type: 'custom' }, pinned: false } as Agent;
let saved: Partial<Agent> | null = null;

beforeEach(() => {
  saved = null;
  document.body.innerHTML = '<div id="toasts"></div><div id="modal-root"></div><div id="view"></div>';
  state.data = {
    agents: [agent],
    toolGroups: [],
    mcpServers: [],
    runs: [],
    approvals: [],
    terminals: [],
    engines: { 'claude-code': { installed: true }, codex: { installed: true, loggedIn: true }, hermes: { installed: true }, openai: {} },
    engineList: [
      { id: 'claude-code', label: 'Claude Code' },
      { id: 'openai', label: 'API model' },
      { id: 'hermes', label: 'Hermes' },
      { id: 'codex', label: 'Codex' },
    ],
    secrets: { anthropicKey: { set: false }, openrouterKey: { set: true } },
    settings: { defaults: { claudeModel: 'sonnet', openrouterModel: 'x/y' } },
  } as unknown as AppState;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = String(url).replace(/^\/api/, '');
      if (init.method === 'PUT' && path === '/agents/a1') saved = JSON.parse(String(init.body));
      const body = path === '/agents/a1' ? { ...agent, knowledgeFiles: [], workspacePath: '/tmp', tools: [] } : path === '/mcp' ? { servers: {} } : [];
      return new Response(JSON.stringify(saved && init.method === 'PUT' ? saved : body), { status: 200 });
    }),
  );
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

afterEach(() => {
  act(() => unmount());
  vi.unstubAllGlobals();
  state.data = null;
});

const effortSelect = () => [...document.querySelectorAll<HTMLLabelElement>('label.field')].find((l) => l.textContent?.startsWith('Effort'))!.querySelector('select')!;

describe('agent editor: effort', () => {
  it("shows the engine's levels and saves the nearest one after switching engines", async () => {
    const el = document.getElementById('view')!;
    await act(async () => render(el, ['a1', 'edit']));
    await settle();
    expect(effortSelect().value).toBe('max');
    expect([...effortSelect().options].map((o) => o.value)).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);
    // Codex has no "max"
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Codex')!.click());
    expect(effortSelect().value).toBe('xhigh');
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Save')!.click());
    await settle();
    expect(saved).toMatchObject({ engine: 'codex', effort: 'xhigh' });
  });
});
