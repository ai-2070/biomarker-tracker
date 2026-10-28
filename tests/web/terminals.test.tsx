// The Terminals page (React): which terminal shows, tabs as links with their own close button, the launcher.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import * as terminals from '../../web/views/terminals.tsx';
import { pickTerminal } from '../../web/views/terminals.tsx';
import type { AppState } from '../../shared/types.ts';

// (no real terminal in happy-dom: an open terminal is just its host element here)
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
    write() {}
    onData() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
let requests: { method: string; url: string; body: unknown }[];
let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  location.hash = '#/terminals';
  requests = [];
  state.data = {
    terminals: [],
    agents: [{ id: 'a1', name: 'Coder', emoji: '🧑‍💻', engine: 'claude-code' }, { id: 'a2', name: 'Api', engine: 'openai' }],
    engines: { 'claude-code': { installed: true }, hermes: { installed: false } },
  } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    if (url === '/api/terminals' && method === 'POST') return new Response(JSON.stringify({ id: 't9', title: 'PowerShell' }));
    return new Response(JSON.stringify(url === '/api/terminals' ? [] : { ok: true }));
  });
});
afterEach(() => {
  act(() => terminals.unmount());
  vi.unstubAllGlobals();
});

describe('pickTerminal()', () => {
  it('shows the one asked for, the launcher for "new", else the first', () => {
    const list = [{ id: 't1' }, { id: 't2' }];
    expect(pickTerminal('t2', list)).toBe('t2');
    expect(pickTerminal('new', list)).toBeNull();
    expect(pickTerminal('gone', list)).toBe('t1');
    expect(pickTerminal(undefined, [])).toBeNull();
  });
});

describe('the Terminals page', () => {
  it('with none open shows the launcher: buttons for each program and agents that can run in a terminal', async () => {
    await act(async () => terminals.render(el, []));
    await settle();
    expect([...el.querySelectorAll('button.term-card .card-title')].map((t) => t.textContent)).toEqual(['PowerShell', 'Claude Code', 'Orca']);
    expect([...el.querySelectorAll('select[aria-label="Agent"] option')].map((o) => o.textContent)).toEqual(['🧑‍💻 Coder']);
    expect(el.querySelector('nav[aria-label="Terminals"] a[aria-current="page"]')!.textContent).toBe('+ New');
    await act(async () => el.querySelector<HTMLButtonElement>('button.term-card')!.click());
    await settle();
    expect(requests.find((r) => r.method === 'POST')!.body).toEqual({ kind: 'shell' });
    expect(location.hash).toBe('#/terminals/t9');
  });

  it('closing the terminal that shows falls back to the next one (the page stays the same)', async () => {
    class FakeSocket {
      readyState = 0;
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const open = [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }];
    state.data = { ...state.data!, terminals: open } as unknown as AppState;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      requests.push({ method: init.method || 'GET', url, body: null });
      return new Response(JSON.stringify(url === '/api/terminals' ? open : { ok: true }));
    });
    await act(async () => terminals.render(el, []));
    await settle();
    const current = () => el.querySelector('nav[aria-label="Terminals"] a[aria-current="page"]')!.textContent;
    expect(current()).toContain('One');
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Close One"]')!.click());
    await settle();
    // the app state hears it is gone
    await act(async () => {
      state.data = { ...state.data!, terminals: [open[1]] } as unknown as AppState;
      for (const fn of state.listeners) fn(state.data);
    });
    await settle();
    expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/terminals/t1')).toBe(true);
    expect(current()).toContain('Two');
  });
});
