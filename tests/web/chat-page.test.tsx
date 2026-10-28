// The agent chat page (React around the AI SDK chat): a gone agent, picking a chat, the list, memory, delete.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import * as chatPage from '../../web/views/chat.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = (ms = 40) => act(() => new Promise((r) => setTimeout(r, ms)));
class FakeSocket {
  onmessage = null;
  onclose = null;
  onopen = null;
}
let requests: { method: string; url: string }[];
let titles: string[];
let el: HTMLElement;
const agent = { id: 'a1', name: 'Writer', emoji: '✍️', engine: 'claude-code', tools: ['read_file', 'web_search'], specialty: 'Posts' };
const chats = [
  { id: 'c1', title: 'Launch post', updatedAt: Date.now(), count: 4 },
  { id: 'c2', title: 'Old', updatedAt: Date.now() - 86_400_000, count: 1 },
];

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  requests = [];
  titles = [];
  state.data = { agents: [agent], runs: [], approvals: [], settings: { defaults: {} }, engines: {} } as unknown as AppState;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    requests.push({ method, url });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/agents/a1') return json(agent);
    if (url === '/api/agents/gone') return json({ error: 'Unknown agent' }, 404);
    if (url === '/api/agents/a1/chats' && method === 'GET') return json(chats);
    if (url === '/api/agents/a1/chats/c1' && method === 'GET') return json({ id: 'c1', title: 'Launch post', items: [] });
    if (url === '/api/agents/a1/chats/c1/memory') return json({ tokens: 170_000, window: 200_000, compactAt: 160_000, percent: 85, auto: true });
    if (url.endsWith('/stream')) return new Response(null, { status: 204 });
    return json(url.includes('/commands') ? [] : { ok: true });
  });
});
afterEach(() => {
  act(() => chatPage.unmount());
  vi.unstubAllGlobals();
});

const open = async (params: string[]) => {
  await act(async () => chatPage.render(el, params, { setTitle: (t) => titles.push(t) }));
  await settle();
};

describe('the agent chat page', () => {
  it('says so when the agent no longer exists', async () => {
    await open(['gone']);
    expect(el.textContent).toBe('That agent no longer exists. Back to agents');
  });

  it('without a chat in the address, goes to the latest one', async () => {
    await open(['a1']);
    expect(location.hash).toBe('#/agents/a1/c1');
    expect(titles).toEqual(['✍️ Writer']);
  });

  it('shows the agent, its chats (this one marked), the title and how full its memory is', async () => {
    await open(['a1', 'c1']);
    await settle(80);
    expect([...el.querySelectorAll('nav[aria-label="Chats"] a')].map((a) => `${a.querySelector('.t')!.textContent}${a.getAttribute('aria-current') ? '*' : ''}`)).toEqual(['Launch post*', 'Old']);
    expect(el.querySelector('.chat-title')!.textContent).toBe('Launch post');
    const mem = el.querySelector('.pill.mem')!;
    expect(mem.textContent).toBe('Memory 85%');
    expect(mem.classList.contains('warn')).toBe(true);
    expect(el.querySelector('.chat-tools')!.textContent).toBe('read_file · web_search');
  });

  it('deletes the chat only after you confirm, then goes back to the agent', async () => {
    await open(['a1', 'c1']);
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.chat-head button')].find((b) => b.textContent === 'Delete')!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Delete')!.click());
    await settle();
    expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/agents/a1/chats/c1')).toBe(true);
    expect(location.hash).toBe('#/agents/a1');
  });
});
