// Settings > General & keys (React): what Save sends, switches that save at once, keys.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import * as general from '../../web/views/settings.tsx';
import { setPath } from '../../web/views/settings.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

const settings = {
  brainApproves: true,
  brainFollowsUp: true,
  brainAnyGitHub: false,
  brain: { provider: 'claude', model: 'haiku' },
  defaults: { engine: 'claude-code', claudeModel: 'sonnet', openrouterModel: 'x/y', autonomy: 'ask' },
  maxToolSteps: 20,
  costLimitUsdPerRun: 1,
  compaction: { auto: true, engineOwn: true, instant: true, keepMessages: 20, thresholdPercent: 80, windowTokens: 0 },
  providers: { lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1' }, ollama: { baseUrl: 'http://127.0.0.1:11434/v1' }, custom: { baseUrl: '' } },
  comfyui: { url: '', workflowDirs: [] },
  paths: {},
  allowedFolders: [],
};
const secrets = { openrouterKey: { set: false }, anthropicKey: { set: false }, customKey: { set: false } };
let requests: { method: string; url: string; body: unknown }[];
let refuse: string | null;
let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  requests = [];
  refuse = null;
  state.data = {
    port: 4800,
    dataDir: 'C:\\data',
    engines: { 'claude-code': { installed: true, version: '2.1' }, codex: { installed: true, loggedIn: true }, hermes: { installed: false } },
    engineList: [
      { id: 'claude-code', label: 'Claude Code' },
      { id: 'codex', label: 'Codex' },
    ],
    settings,
  } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    if (refuse && url.endsWith(refuse) && method !== 'GET') return new Response(JSON.stringify({ error: 'nope' }), { status: 500 });
    if (url === '/api/settings') return new Response(JSON.stringify(method === 'GET' ? { settings, secrets } : { ok: true }));
    if (url === '/api/state') return new Response(JSON.stringify(state.data));
    return new Response('{}');
  });
});
afterEach(() => {
  act(() => general.unmount());
  vi.unstubAllGlobals();
});

const open = async () => {
  await act(async () => general.render(el));
  await settle();
};
const type = (input: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const fieldInput = (label: string) => [...el.querySelectorAll('label.field')].find((f) => f.querySelector('span')?.textContent === label)!.querySelector<HTMLInputElement>('input, textarea')!;
const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
const switchFor = (text: string) => [...el.querySelectorAll('label.switch-row')].find((l) => l.textContent === text)!;

describe('setPath()', () => {
  it('puts a value at a dotted path, keeping what is already there', () => {
    const p: Record<string, unknown> = {};
    setPath(p, 'defaults.engine', 'codex');
    setPath(p, 'defaults.autonomy', 'auto');
    setPath(p, 'maxToolSteps', 5);
    expect(p).toEqual({ defaults: { engine: 'codex', autonomy: 'auto' }, maxToolSteps: 5 });
  });
});

describe('General & keys', () => {
  it('Save settings sends only what you changed', async () => {
    await open();
    await type(fieldInput('Max tool steps per message'), '7');
    await type(fieldInput('Extra ComfyUI workflow folders'), 'C:\\flows\n\n D:\\more ');
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.seg button')].find((b) => b.textContent === 'Codex')!.click());
    await act(async () => button('Save settings').click());
    await settle();
    const put = requests.find((r) => r.method === 'PUT' && r.url === '/api/settings')!;
    expect(put.body).toEqual({ maxToolSteps: 7, comfyui: { workflowDirs: ['C:\\flows', 'D:\\more'] }, defaults: { engine: 'codex' } });
  });

  it('a Brain switch saves at once, and shows the real setting again when saving fails', async () => {
    await open();
    const row = switchFor('The Brain follows up');
    const sw = row.querySelector<HTMLElement>('[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    // clicking its text flips it too
    await act(async () => row.querySelector<HTMLElement>('.toggle-text')!.click());
    await settle();
    expect(requests.filter((r) => r.method === 'PUT').map((r) => r.body)).toEqual([{ brainFollowsUp: false }]);
    expect(row.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
    refuse = '/api/settings';
    await act(async () => switchFor('The Brain approves').querySelector<HTMLElement>('[role="switch"]')!.click());
    await settle();
    expect(switchFor('The Brain approves').querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('toasts')!.textContent).toContain('nope');
  });

  it('saves a key, then clears the box; Save waits until a key is typed', async () => {
    await open();
    // the key's row: found by its label, with its own Save button
    const row = () => [...el.querySelectorAll('.ai-key')].find((r) => r.querySelector('label')?.textContent === 'OpenRouter key')!;
    const key = () => row().querySelector<HTMLInputElement>('input')!;
    const save = () => [...row().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Save')!;
    expect(row().querySelector('label')!.htmlFor).toBe(key().id);
    expect(key().type).toBe('password');
    expect(save().disabled).toBe(true);
    await type(key(), ' sk-or-123 ');
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    await settle();
    expect(requests.find((r) => r.url === '/api/secrets')!.body).toEqual({ key: 'openrouterKey', value: 'sk-or-123' });
    expect(key().value).toBe('');
  });

  it('shows each engine with its logo and status, and copies an install command', async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } });
    await open();
    const names = [...el.querySelectorAll('.ai-row .ai-name')].map((n) => n.textContent);
    expect(names).toEqual(expect.arrayContaining(['Claude Code', 'OpenAI Codex', 'Hermes', 'pi coding agent', 'oh-my-pi', 'OpenClaw', 'OpenRouter key', 'Anthropic API key']));
    // every engine and key row has a mark (a logo or its glyph)
    for (const r of el.querySelectorAll('.ai-list .ai-row')) expect(r.querySelector('.ai-mark')!.childNodes.length).toBeGreaterThan(0);
    // pi isn't in this state, so it shows its install command
    const copy = el.querySelector<HTMLButtonElement>('.ai-cmd button')!;
    await act(async () => copy.click());
    await settle();
    expect(copied).toEqual(['npm install -g @earendil-works/pi-coding-agent']);
  });
});
