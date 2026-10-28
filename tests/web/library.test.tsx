// The Library page (React, Base UI): tabs, search and division, hiring, presets, and leaving it early.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import * as library from '../../web/views/library.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agency = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    slug: `a${i}`,
    name: i === 0 ? 'Brand Guardian' : `Agent ${i}`,
    description: i === 0 ? 'protects the brand' : 'does things',
    emoji: '🤖',
    color: '',
    vibe: '',
    division: i % 2 ? 'design' : 'engineering',
    divisionLabel: i % 2 ? 'Design' : 'Engineering',
  }));
let lib: Record<string, unknown>;
let presets: Record<string, unknown>[];
let requests: { method: string; url: string; body: unknown }[];
let slowLibrary: Promise<void> | null;
let el: HTMLElement;

const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
const buttons = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === text);
const click = (b: HTMLElement) => act(async () => b.click());

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  location.hash = '#/library';
  lib = { agency: { agents: agency(3) }, hermes: [], claude: [], starters: [{ name: 'Writer', emoji: '✍️', specialty: 'Writes' }] };
  presets = [];
  requests = [];
  slowLibrary = null;
  library.resetLibrary();
  state.data = {
    agents: [],
    engines: { hermes: { installed: false } },
    engineList: [
      { id: 'claude-code', label: 'Claude Code' },
      { id: 'codex', label: 'Codex' },
    ],
    settings: { defaults: { engine: 'claude-code', claudeModel: 'sonnet', openrouterModel: '' } },
  } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url === '/api/library') {
      if (slowLibrary) await slowLibrary;
      return json(lib);
    }
    if (url === '/api/presets') return json(presets);
    if (url === '/api/state') return json(state.data);
    if (url === '/api/library/hire') return json({ id: 'new-1', name: 'Hired' });
    if (url.startsWith('/api/presets/') && method === 'DELETE') return json({ ok: true });
    return json({});
  });
});
afterEach(() => {
  act(() => library.unmount());
  vi.unstubAllGlobals();
});

const open = async () => {
  await act(async () => library.render(el));
  await settle();
};

describe('Library page', () => {
  it('opens on The Agency with labelled tabs, and remembers the tab you picked', async () => {
    await open();
    const tabs = [...el.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Blacksite (1)', 'The Agency (3)', 'Hermes profiles (0)', 'Claude Code subagents (0)', 'Your presets (0)']);
    expect(el.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Agent library');
    expect(tabs[1].classList.contains('on')).toBe(true);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    await click(tabs[0]);
    expect(el.querySelector('.card-title')!.textContent).toBe('Writer');
    act(() => library.unmount());
    await open();
    expect(el.querySelector('[role="tab"].on')!.textContent).toBe('Blacksite (1)');
  });

  it('opens on Your presets from a ?tab=presets link', async () => {
    location.hash = '#/library?tab=presets';
    await open();
    expect(el.querySelector('[role="tab"].on')!.textContent).toBe('Your presets (0)');
    expect(el.textContent).toContain('No presets yet.');
  });

  it('narrows The Agency by search and by division', async () => {
    await open();
    const titles = () => [...el.querySelectorAll('.card-title')].map((t) => t.textContent);
    expect(titles()).toEqual(['Brand Guardian', 'Agent 1', 'Agent 2']);
    const search = el.querySelector<HTMLInputElement>('input[aria-label="Search the specialists"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(search, 'brand');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(titles()).toEqual(['Brand Guardian']);
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttons('Design')[0]);
    expect(titles()).toEqual(['Agent 1']);
    expect(buttons('Design')[0].classList.contains('on')).toBe(true);
    await click(buttons('All')[0]);
    expect(titles()).toHaveLength(3);
  });

  it('caps The Agency at 240 cards and says how many there are', async () => {
    lib.agency = { agents: agency(250) };
    await open();
    expect(el.querySelectorAll('.card')).toHaveLength(240);
    expect(el.textContent).toContain('Showing 240 of 250. Search to narrow down.');
  });

  it('hires on the engine picked under "Runs on", then offers Chat and Edit', async () => {
    await open();
    await click(buttons('Codex')[0]);
    await click(el.querySelector<HTMLButtonElement>('.card .btn.small')!);
    await settle();
    const hireCall = requests.find((r) => r.url === '/api/library/hire')!;
    expect(hireCall.body).toEqual({ source: 'agency', slug: 'a0', overrides: { engine: 'codex', model: '' } });
    const foot = el.querySelector('.card .card-foot')!;
    expect([...foot.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Chat', 'Edit']);
    expect(document.getElementById('toasts')!.textContent).toContain('Brand Guardian joined your team');
  });

  it('deletes a preset only after you confirm', async () => {
    presets = [{ id: 'p1', kind: 'agent', name: 'Helper', emoji: '🙂' }];
    location.hash = '#/library?tab=presets';
    await open();
    await click(el.querySelector<HTMLButtonElement>('[aria-label="Delete the preset Helper"]')!);
    const sure = [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Delete')!;
    presets = [];
    await click(sure);
    await settle();
    expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/presets/p1')).toBe(true);
    expect(el.textContent).toContain('No presets yet.');
  });

  it('says so when the library cannot load', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'disk on fire' }), { status: 500 }));
    await open();
    expect(el.textContent).toBe('Something went wrong: disk on fire');
  });

  it('draws nothing after you leave while it is still loading', async () => {
    let finish!: () => void;
    slowLibrary = new Promise((r) => (finish = r));
    await open();
    expect(el.textContent).toBe('Loading library…');
    act(() => library.unmount());
    finish();
    await settle();
    expect(el.textContent).toBe('');
  });
});
