// The Overview page (React): stats as links, the quick task, live activity, getting started.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectEvents, state } from '../../web/core.ts';
import * as home from '../../web/views/home.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));
class FakeSocket {
  static last: FakeSocket;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
}
let requests: { method: string; url: string; body: unknown }[];
let el: HTMLElement;
const base = {
  approvals: [],
  outboxPending: 2,
  runs: [{ id: 'r1', agentId: 'a1', chatId: 'c1', startedAt: Date.now(), agentName: 'Writer', parentRunId: null }],
  accounts: { x: [] },
  engines: { 'claude-code': { installed: true } },
  secrets: { openrouterKey: { set: false } },
};

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><div id="drawer" class="hidden"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  requests = [];
  state.data = { ...base, agents: [{ id: 'a1', name: 'Writer', emoji: '✍️', specialty: 'Posts' }, { id: 'a2', name: 'Coder', emoji: '💻' }] } as unknown as AppState;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url === '/api/activity') return json([{ ts: Date.now(), kind: 'run', text: 'Writer finished' }]);
    if (url === '/api/programs') return json([{ id: 'comfyui', name: 'ComfyUI', icon: '🧩', installed: true, running: true, serviceUrl: 'http://127.0.0.1:8188', version: null }]);
    if (url === '/api/agents/a2/chats' && method === 'POST') return json({ id: 'c9' });
    return json({ ok: true });
  });
  connectEvents();
});
afterEach(() => {
  act(() => home.unmount());
  vi.unstubAllGlobals();
});

const open = async () => {
  await act(async () => home.render(el));
  await settle();
};

describe('the Overview page', () => {
  it('stats are links or a button to where each number lives', async () => {
    await open();
    const stats = [...el.querySelectorAll<HTMLElement>('.stats .stat')];
    expect(stats.map((s) => `${s.tagName}:${s.querySelector('.label')!.textContent}=${s.querySelector('.num')!.textContent}`)).toEqual(['A:Agents=2', 'DIV:Working now=1', 'BUTTON:Needs you=2', 'A:X accounts=0']);
    await act(async () => stats[2].click());
    expect(document.getElementById('drawer')!.classList.contains('hidden')).toBe(false);
  });

  it('gives the picked agent a task in a new chat with Ctrl+Enter', async () => {
    await open();
    const select = el.querySelector<HTMLSelectElement>('select[aria-label="Agent"]')!;
    await act(async () => {
      select.value = 'a2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const box = el.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Fix the build');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    await settle();
    expect(requests.find((r) => r.url === '/api/agents/a2/chats/c9/messages')!.body).toEqual({ text: 'Fix the build' });
    expect(location.hash).toBe('#/agents/a2/c9');
  });

  it('shows programs and activity, adding new activity as it happens', async () => {
    await open();
    expect(el.textContent).toContain('running · http://127.0.0.1:8188');
    await act(async () => FakeSocket.last.onmessage!({ data: JSON.stringify({ type: 'activity', ts: 0, entry: { ts: Date.now(), kind: 'error', text: 'Coder failed' } }) }));
    expect([...el.querySelectorAll('.home-activity')].map((a) => a.textContent)).toEqual(['Coder failed', 'Writer finished']);
  });

  it('with no agents, shows the steps to get started', async () => {
    state.data = { ...base, runs: [], agents: [] } as unknown as AppState;
    await open();
    expect([...el.querySelectorAll('.home-steps li .btn.ghost')].map((a) => a.textContent)).toEqual(['Settings', 'Open library', 'Connections', 'Tools & MCP']);
    expect(el.querySelector('.home-steps [aria-label="done"]')).not.toBeNull();
  });
});
