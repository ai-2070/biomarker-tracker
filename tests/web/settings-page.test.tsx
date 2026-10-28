// The Settings page (React shell on Base UI) and ViewHost, which runs the plain-DOM tabs inside it.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import * as settings from '../../web/views/setup.tsx';
import { searchSettings } from '../../web/views/setup.tsx';
import { ViewHost, mountReact } from '../../web/ui/react.tsx';
import type { PlainView } from '../../web/ui/react.tsx';
import type { AppState, ServerEvent } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  state.data = { settings: { look: {} } } as unknown as AppState;
  vi.stubGlobal('fetch', async () => new Response('{}'));
});
afterEach(() => {
  act(() => settings.unmount());
  vi.unstubAllGlobals();
});

describe('searchSettings()', () => {
  it('finds by label, the text on the page and extra words, best match first', () => {
    expect(searchSettings('accent')[0].label).toBe('Accent colour');
    expect(searchSettings('zoom').map((h) => h.label)).toEqual(['UI scale']);
    expect(searchSettings('codex')[0].label).toBe('OpenAI Codex');
    expect(searchSettings('nothing like this')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
  });
});

describe('the Settings page', () => {
  const open = async (hash: string) => {
    location.hash = hash;
    await act(async () => settings.render(el));
    await settle();
  };

  it('opens the tab a link names, with labelled tabs', async () => {
    await open('#/settings?tab=look');
    const on = el.querySelector('[role="tab"].on')!;
    expect(on.textContent).toBe('Look');
    expect(el.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Settings');
    expect(el.textContent).toContain('Accent colour');
  });

  it('search lists matching settings and jumps to the one picked', async () => {
    await open('#/settings?tab=look');
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'accent');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    const hits = [...document.querySelectorAll<HTMLElement>('.settings-search-hit')];
    expect(hits.map((h) => h.textContent!.trim())).toEqual(['Accent colourLook']);
    expect(input.getAttribute('role')).toBe('combobox');
    await act(async () => hits[0].click());
    await settle();
    expect(el.querySelector('.flash-find')).not.toBeNull();
  });

  it('a hit in another part of the open tab switches to that part', async () => {
    state.data = { settings: { look: {} }, outboxPending: 0, accounts: { x: [], reddit: [] } } as unknown as AppState;
    const replies: Record<string, unknown> = {
      '/api/outbox': [],
      '/api/accounts': { x: [], reddit: [], xAppConfigured: false, redditAppConfigured: false },
      '/api/settings': { settings: { x: {}, reddit: {}, telegram: { chatId: '' } }, secrets: { xClientSecret: { set: false }, redditClientSecret: { set: false }, telegramBotToken: { set: false }, discordWebhook: { set: false } } },
    };
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(replies[url] ?? {})));
    await open('#/settings?tab=connections&sub=accounts');
    const sub = () => [...el.querySelectorAll('[role="tab"].on')].map((t) => t.textContent);
    expect(sub()).toContain('Accounts');
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'outbox');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    const hit = [...document.querySelectorAll<HTMLElement>('.settings-search-hit')].find((h) => h.textContent!.includes('Outbox (posts waiting for you)'))!;
    await act(async () => hit.click());
    await settle();
    expect(sub().some((t) => t?.startsWith('Outbox'))).toBe(true);
    expect(location.hash).toContain('sub=outbox');
  });
});

describe('ViewHost', () => {
  it('draws a plain-DOM page and unmounts it when React moves on', async () => {
    const seen: string[] = [];
    const view: PlainView = {
      render: (box) => void ((box.textContent = 'plain page'), seen.push('render')),
      unmount: () => void seen.push('unmount'),
      onEvent: (ev: ServerEvent) => void seen.push(ev.type),
    };
    const host = document.createElement('div');
    document.body.append(host);
    let page!: { unmount: () => void };
    await act(async () => void (page = mountReact(host, <ViewHost view={view} />)));
    expect(host.textContent).toBe('plain page');
    await act(async () => page.unmount());
    expect(host.textContent).toBe('');
    // (tests run React's development build, which mounts twice on purpose: each render has its unmount)
    expect(seen.filter((s) => s === 'render').length).toBe(seen.filter((s) => s === 'unmount').length);
    expect(seen.at(-1)).toBe('unmount');
  });

  it('shows the error when the page fails to draw', async () => {
    const host = document.createElement('div');
    let page!: { unmount: () => void };
    await act(async () => void (page = mountReact(host, <ViewHost view={{ render: async () => Promise.reject(new Error('no data')) }} />)));
    await settle();
    expect(host.textContent).toBe('Something went wrong: no data');
    await act(async () => page.unmount());
  });
});

describe('the Look tab', () => {
  it('picks an accent from labelled radios, applies it at once and saves it a moment later', async () => {
    const puts: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return new Response('{}');
    });
    location.hash = '#/settings?tab=look';
    await act(async () => settings.render(el));
    await settle();
    const group = el.querySelector('[role="radiogroup"][aria-labelledby="look-accent"]')!;
    expect(group.getAttribute('aria-labelledby')).toBe('look-accent');
    const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.length).toBeGreaterThan(3);
    const rose = radios.find((r) => r.textContent === 'Rose')!;
    await act(async () => rose.click());
    expect(rose.getAttribute('aria-checked')).toBe('true');
    expect(rose.classList.contains('on')).toBe(true);
    expect(puts).toEqual([]);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(puts).toEqual([{ look: { scale: 100, accent: 'rose', motion: 'full', chatFont: 'serif', station: 'balanced', sidebar: 'status', stationLook: 'classic', worldQuality: 'medium' } }]);
  });

  it('a change made just before leaving the tab is still saved', async () => {
    const puts: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return new Response('{}');
    });
    location.hash = '#/settings?tab=look';
    await act(async () => settings.render(el));
    await settle();
    const rose = [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((r) => r.textContent === 'Rose')!;
    await act(async () => rose.click());
    // (off to another page at once, before the save was due)
    act(() => settings.unmount());
    await settle();
    expect(puts).toEqual([{ look: { scale: 100, accent: 'rose', motion: 'full', chatFont: 'serif', station: 'balanced', sidebar: 'status', stationLook: 'classic', worldQuality: 'medium' } }]);
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(puts).toHaveLength(1);
  });

  it('the Station look switches to the voxel world, and only then offers its quality', async () => {
    const puts: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return new Response('{}');
    });
    location.hash = '#/settings?tab=look';
    await act(async () => settings.render(el));
    await settle();
    const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);
    expect(button('High')).toBeUndefined();
    await act(async () => button('Voxel world')!.click());
    await act(async () => button('High')!.click());
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(puts).toEqual([{ look: { scale: 100, accent: 'lime', motion: 'full', chatFont: 'serif', station: 'balanced', sidebar: 'status', stationLook: 'world', worldQuality: 'high' } }]);
  });

  it('has a UI scale slider screen readers read as a percentage, and preset sizes', async () => {
    location.hash = '#/settings?tab=look';
    await act(async () => settings.render(el));
    await settle();
    const slider = el.querySelector<HTMLInputElement>('input[type="range"][aria-label="UI scale"]')!;
    expect(slider.getAttribute('aria-valuetext')).toBe('100%');
    const big = [...el.querySelectorAll<HTMLButtonElement>('.look-presets button')].find((b) => b.textContent === '125%')!;
    await act(async () => big.click());
    expect(big.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.look-pct')!.textContent).toBe('125%');
  });
});
