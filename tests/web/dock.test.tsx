// The Brain chat (React): opening from the button, who a message goes to, and /queue while it works.
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectEvents, state } from '../../web/core.ts';
import { initDock } from '../../web/dock.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 40)));
// the server's events, sent by the test
class FakeSocket {
  static last: FakeSocket | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
}
const serverEvent = (ev: object) => act(async () => FakeSocket.last!.onmessage!({ data: JSON.stringify({ ts: 0, ...ev }) }));

// a Brain answer that stays on its way until the test ends it (or the page stops reading it)
let answering: ReadableStreamDefaultController<Uint8Array> | null = null;
const calls: { url: string; body: Record<string, unknown> }[] = [];
beforeAll(() => {
  document.body.append(Object.assign(document.createElement('div'), { id: 'toasts' }));
  // (no animations in happy-dom)
  Element.prototype.animate ??= function () {
    return { finished: Promise.resolve(), cancel() {}, onfinish: null, effect: null } as unknown as Animation;
  };
  Element.prototype.getAnimations ??= () => [];
  state.data = {
    runs: [],
    approvals: [],
    agents: [{ id: 'a1', name: 'Scout', emoji: '🔭', engine: 'openai', model: 'm', provider: 'custom' }],
    project: { id: 'p1', name: 'P' },
    settings: { brain: { provider: 'claude', model: 'haiku' } },
  } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : {} });
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    if (url === '/api/brain/stream')
      return new Response(
        new ReadableStream<Uint8Array>({
          start: (c) => {
            answering = c;
            init.signal?.addEventListener('abort', () => c.error(new DOMException('The operation was aborted.', 'AbortError')));
          },
        }),
        { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } },
      );
    if (url === '/api/brain/history') return json([]);
    if (url === '/api/workflows') return json([{ id: 't1', name: 'Thumbs', members: ['a1'], lead: 'a1', steps: [] }]);
    return json({});
  });
  vi.stubGlobal('WebSocket', FakeSocket);
  connectEvents();
  initDock();
});
afterAll(() => vi.unstubAllGlobals());

const panel = () => document.querySelector<HTMLElement>('.dock')!;
const launcher = () => document.querySelector<HTMLButtonElement>('.bottom-bar .dock-launcher')!;
const input = () => document.querySelector<HTMLTextAreaElement>('.dock-input')!;
const enter = () => act(async () => void input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

describe('the Brain chat', () => {
  it('opens from its button in the bottom bar, and Ctrl+K closes it', async () => {
    await settle();
    expect(panel().classList.contains('hidden')).toBe(true);
    await act(async () => launcher().click());
    expect(panel().classList.contains('hidden')).toBe(false);
    expect(launcher().classList.contains('hidden')).toBe(true);
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })));
    await settle();
    expect(launcher().classList.contains('hidden')).toBe(false);
    expect(panel().classList.contains('hidden')).toBe(true);
  });

  it('sends to the Brain, an agent or a team, and shows whose model answers', async () => {
    await act(async () => launcher().click());
    await settle();
    const sel = document.querySelector<HTMLSelectElement>('.dock-target')!;
    expect([...sel.options].map((o) => o.value)).toEqual(['auto', 'new-agent', 'new-branch', 'a:a1', 'b:t1']);
    expect(sel.value).toBe('auto');
    await act(async () => {
      sel.value = 'a:a1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(sel.value).toBe('a:a1');
    expect(document.querySelector('.dock-model .model-chip')).not.toBeNull();
    await act(async () => {
      sel.value = 'b:t1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.querySelector('.dock-model')!.textContent).toContain('★');
    await act(async () => {
      sel.value = 'auto';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  it('/queue waits while the Brain is answering, and × takes it back', async () => {
    input().value = 'plan the week';
    await enter();
    for (let i = 0; i < 50 && !answering; i++) await settle();
    expect(document.querySelector('.dock-list')!.textContent).toContain('The Brain is looking at the project…');
    expect(input().placeholder).toContain('/queue');
    input().value = '/queue then the newsletter';
    await enter();
    await settle();
    const waiting = document.querySelector('.dock-held .queued-list')!;
    expect(waiting.querySelector('.queued-head')!.textContent).toBe('Sends when everything above is done');
    expect(waiting.querySelector('.queued-text')!.textContent).toBe('then the newsletter');
    await act(async () => waiting.querySelector<HTMLButtonElement>('button[aria-label="Don\'t send this"]')!.click());
    await settle();
    expect(document.querySelector('.dock-held .queued-list')).toBeNull();
    // (the message you sent first stays at the top)
    expect(document.querySelector('.dock-msg.user')!.textContent).toBe('plan the week');
  });

  it('while the Brain answers, an empty box shows Stop; a message sent then cuts the answer off and is answered now', async () => {
    // (the answer to "plan the week" is still on its way)
    const button = (label: string) => document.querySelector(`.dock button[aria-label="${label}"]`);
    expect(button('Stop')).not.toBeNull();
    expect(button('Send')).toBeNull();
    input().value = 'actually, just Monday';
    await act(async () => void input().dispatchEvent(new Event('input', { bubbles: true })));
    await settle();
    expect(button('Stop')).toBeNull();
    expect(button('Send')).not.toBeNull();
    await enter();
    const asked = () => calls.filter((c) => c.url === '/api/brain/stream');
    for (let i = 0; i < 50 && asked().length < 2; i++) await settle();
    // the server cuts off the answer it is writing (and keeps its question); the new message is asked now
    expect(calls.find((c) => c.url === '/api/brain/steer')!.body).toEqual({});
    expect(asked().map((c) => c.body.text)).toEqual(['plan the week', 'actually, just Monday']);
    expect(document.querySelector('.dock-list')!.textContent).toContain("Stopped the Brain's answer to take your new message.");
    expect(button('Stop')).not.toBeNull();
  });

  it('an answer cut off too late to stop still shows, with what it did', async () => {
    const before = document.querySelectorAll('.dock-msg').length;
    await serverEvent({ type: 'brain-late', projectId: 'p1', goal: false, answer: { answer: 'Made the launch team.', done: [{ kind: 'team', text: 'Created the team "Launch"' }], delegate: null, model: { provider: 'claude', model: 'haiku' }, project: 'P' } });
    await settle();
    expect(document.querySelector('.dock-list')!.textContent).toContain('Made the launch team.');
    expect(document.querySelectorAll('.dock-msg').length).toBeGreaterThan(before);
    // (another project's: not here)
    await serverEvent({ type: 'brain-late', projectId: 'p2', goal: false, answer: { answer: 'Not for this project.', done: [], delegate: null, model: { provider: 'claude', model: 'haiku' }, project: 'Q' } });
    await settle();
    expect(document.querySelector('.dock-list')!.textContent).not.toContain('Not for this project.');
  });

  it('queued messages in the Brain chat: Up changes the last one, Alt+Up moves one up', async () => {
    // (the Brain is still answering, so these wait)
    for (const t of ['/queue first', '/queue second']) {
      input().value = t;
      await enter();
    }
    await settle();
    const texts = () => [...document.querySelectorAll('.dock-held .queued-text')].map((n) => n.textContent);
    expect(texts()).toEqual(['first', 'second']);
    input().value = '';
    await act(async () => void input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    await settle();
    const edit = document.querySelector<HTMLTextAreaElement>('.dock-held .queued-edit')!;
    expect(edit.value).toBe('second');
    edit.value = 'second, changed';
    await act(async () => void edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await settle();
    expect(texts()).toEqual(['first', 'second, changed']);
    expect(document.activeElement).toBe(input());
    const last = document.querySelectorAll<HTMLButtonElement>('.dock-held .queued-text')[1];
    await act(async () => void last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })));
    await settle();
    expect(texts()).toEqual(['second, changed', 'first']);
  });
});
