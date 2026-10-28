// The floating chat window (React shell, Base UI tabs): opening chats as tabs, closing, minimizing, remembering.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import { closeChatsForProject, openChat } from '../../web/chatwin.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 40)));

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><div class="bottom-bar"></div>';
  localStorage.clear();
  state.data = {
    runs: [],
    approvals: [],
    settings: {},
    agents: [
      { id: 'a1', name: 'Scout', emoji: '🔭', engine: 'openai', model: 'm', provider: 'custom' },
      { id: 'a2', name: 'Writer', emoji: '✍️', engine: 'openai', model: 'm', provider: 'custom' },
    ],
  } as unknown as AppState;
  window.__teams = [];
  vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url.endsWith('/chats') ? [] : url.endsWith('/commands') ? [] : {}), { headers: { 'content-type': 'application/json' } }));
  // (no animations in happy-dom)
  Element.prototype.animate ??= function () {
    return { finished: Promise.resolve(), cancel() {}, onfinish: null } as unknown as Animation;
  };
  Element.prototype.getAnimations ??= () => [];
});
afterEach(async () => {
  await act(async () => closeChatsForProject());
  vi.unstubAllGlobals();
});

const tabs = () => [...document.querySelectorAll<HTMLElement>('.cw [role="tab"]')];
const win = () => document.querySelector<HTMLElement>('.cw')!;

describe('the chat window', () => {
  it('opens a chat as a labelled tab, and a second one as a second tab', async () => {
    await act(async () => void openChat('agent', 'a1'));
    await settle();
    expect(win().classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.cw [role="tablist"]')!.getAttribute('aria-label')).toBe('Open chats');
    expect(tabs().map((t) => t.textContent)).toEqual(['🔭Scout']);
    await act(async () => void openChat('agent', 'a2'));
    await settle();
    expect(tabs().map((t) => `${t.textContent}${t.getAttribute('aria-selected') === 'true' ? '*' : ''}`)).toEqual(['🔭Scout', '✍️Writer*']);
    // the tab you are on shows its pane
    const panes = [...document.querySelectorAll<HTMLElement>('.cw-pane')];
    expect(panes.map((p) => p.classList.contains('hidden'))).toEqual([true, false]);
  });

  it('closes a tab with its own close button (beside the tab, not inside it)', async () => {
    await act(async () => void openChat('agent', 'a1'));
    await act(async () => void openChat('agent', 'a2'));
    await settle();
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close Writer"]')!;
    expect(close.closest('[role="tab"]')).toBeNull();
    await act(async () => close.click());
    expect(tabs().map((t) => t.textContent)).toEqual(['🔭Scout']);
    expect(JSON.parse(localStorage.getItem('dash-chatwin')!).tabs).toEqual(['agent:a1']);
  });

  it('minimizes to a pill in the bottom bar, and opens again from it', async () => {
    await act(async () => void openChat('agent', 'a1'));
    await settle();
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Minimize the chats"]')!.click());
    await settle();
    const pill = document.querySelector<HTMLButtonElement>('.bottom-bar .cw-pill')!;
    expect(pill.classList.contains('hidden')).toBe(false);
    expect(pill.textContent).toBe('1 chat');
    expect(win().classList.contains('hidden')).toBe(true);
    await act(async () => pill.click());
    await settle();
    expect(win().classList.contains('hidden')).toBe(false);
    expect(pill.classList.contains('hidden')).toBe(true);
  });
});
