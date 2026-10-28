// The floating window's agent tab: focus asked for before its chat has loaded is given once it has.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import { renderAgentChat } from '../../web/agentchat.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 40)));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('renderAgentChat()', () => {
  it('focus asked for right away lands in the message box once the chat is there', async () => {
    state.data = { runs: [], approvals: [], agents: [{ id: 'a1', name: 'Scout', engine: 'openai', model: 'm', provider: 'custom' }], settings: {} } as unknown as AppState;
    vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url === '/api/agents/a1/chats' ? [] : {}), { headers: { 'content-type': 'application/json' } }));
    const el = document.createElement('div');
    document.body.append(el);
    const tab = renderAgentChat(el, 'a1');
    // (what chatwin.ts does a moment after opening a tab: the chat is still loading)
    tab.focus();
    for (let i = 0; i < 100 && document.activeElement?.tagName !== 'TEXTAREA'; i++) await settle();
    expect(document.activeElement).toBe(el.querySelector('textarea'));
    tab.destroy();
  });
});

describe('the agent tab', () => {
  it('New chat clicked before the latest chat was found stays on the new chat', async () => {
    state.data = { runs: [], approvals: [], agents: [{ id: 'a1', name: 'Scout', engine: 'openai', model: 'm', provider: 'custom' }], settings: {} } as unknown as AppState;
    let found!: () => void;
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      // (the list of chats is slow to come)
      if (url === '/api/agents/a1/chats' && init.method !== 'POST') return new Promise<Response>((r) => (found = () => r(json([{ id: 'c7', title: 'Mine' }]))));
      if (url === '/api/agents/a1/chats') return json({ id: 'c8', title: 'New chat', items: [] });
      if (/\/chats\/c\d$/.test(url)) return json({ id: url.split('/').pop(), title: 'Chat', items: [] });
      return json(url.endsWith('/commands') ? [] : {});
    });
    const el = document.createElement('div');
    document.body.append(el);
    const tab = renderAgentChat(el, 'a1');
    await settle();
    const full = () => el.querySelector<HTMLAnchorElement>('a[title="Open the full chat page"]')!.getAttribute('href');
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('New chat'))!.click());
    await settle();
    expect(full()).toBe('#/agents/a1/c8');
    await act(async () => found());
    await settle();
    expect(full()).toBe('#/agents/a1/c8');
    act(() => tab.destroy());
  });


  it('opens its latest own chat (not a team session), and New chat starts a fresh one', async () => {
    state.data = { runs: [], approvals: [], agents: [{ id: 'a1', name: 'Scout', engine: 'openai', model: 'm', provider: 'custom' }], settings: {} } as unknown as AppState;
    const posts: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') posts.push(url);
      const body =
        url === '/api/agents/a1/chats' && init.method !== 'POST'
          ? [{ id: 'team1', title: 'Team: Social', teamId: 't1' }, { id: 'c7', title: 'Mine' }]
          : url === '/api/agents/a1/chats'
            ? { id: 'c8', title: 'New chat', items: [] }
            : /\/chats\/c\d$/.test(url)
              ? { id: url.split('/').pop(), title: 'Chat', items: [] }
              : url.endsWith('/commands')
                ? []
                : {};
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    const el = document.createElement('div');
    document.body.append(el);
    const tab = renderAgentChat(el, 'a1');
    await settle();
    await settle();
    const full = () => el.querySelector<HTMLAnchorElement>('a[title="Open the full chat page"]')!.getAttribute('href');
    expect(full()).toBe('#/agents/a1/c7');
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('New chat'))!.click());
    await settle();
    expect(posts).toEqual(['/api/agents/a1/chats']);
    expect(full()).toBe('#/agents/a1/c8');
    act(() => tab.destroy());
    expect(el.innerHTML).toBe('');
  });
});
