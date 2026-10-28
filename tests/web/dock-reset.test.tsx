// The Brain chat after a new conversation, and who a message goes to: what /stop cut off is not
// resumed into the next conversation, a late agent design does not land in it, and a message goes
// to whoever was picked when it was sent.
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectEvents, state } from '../../web/core.ts';
import { initDock } from '../../web/dock.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 40)));
class FakeSocket {
  static last: FakeSocket | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
}

const serverEvent = (ev: object) => act(async () => FakeSocket.last!.onmessage!({ data: JSON.stringify({ ts: 0, ...ev }) }));
// Scout's chat, as saved
let scout: { type: string; text: string }[] = [{ type: 'user', text: 'hello Scout' }];
const calls: { url: string; body: Record<string, unknown> }[] = [];
// requests the test lets through when it wants to
const held = new Map<string, () => void>();
const hold = (url: string) => new Promise<void>((r) => held.set(url, r));
let holding = new Set<string>();
// the Brain's answer being written (the server ends it on /stop)
let answer: ReadableStreamDefaultController<Uint8Array> | null = null;
beforeAll(() => {
  document.body.append(Object.assign(document.createElement('div'), { id: 'toasts' }));
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
    if (holding.has(url)) await hold(url);
    if (url === '/api/brain/stream')
      return new Response(
        new ReadableStream<Uint8Array>({
          start: (c) => {
            answer = c;
            init.signal?.addEventListener('abort', () => c.error(new DOMException('The operation was aborted.', 'AbortError')));
          },
        }),
        { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } },
      );
    if (url === '/api/brain/history') return json([]);
    if (url === '/api/workflows') return json([]);
    if (url === '/api/brain/stop') {
      answer?.close();
      return json({ stopped: [] });
    }
    if (url === '/api/brain/resume') return json({ resumed: [], chats: [] });
    if (url === '/api/assist/agent') return json({ name: 'Old design', instructions: 'x' });
    if (url === '/api/agents/a1/chats') return json({ id: 'c9', agentId: 'a1', items: [] });
    if (url === '/api/agents/a1/chats/c9/stream') return new Response(null, { status: 204 });
    if (url === '/api/agents/a1/chats/c9') return json({ id: 'c9', agentId: 'a1', items: scout });
    return json({});
  });
  vi.stubGlobal('WebSocket', FakeSocket);
  connectEvents();
  initDock();
});
afterAll(() => vi.unstubAllGlobals());

const launcher = () => document.querySelector<HTMLButtonElement>('.bottom-bar .dock-launcher')!;
const input = () => document.querySelector<HTMLTextAreaElement>('.dock-input')!;
const list = () => document.querySelector('.dock-list')!.textContent || '';
const say = async (text: string) => {
  input().value = text;
  await act(async () => void input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
};
const pick = (value: string) =>
  act(async () => {
    const sel = document.querySelector<HTMLSelectElement>('.dock-target')!;
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
const newConversation = async () => {
  await act(async () => document.querySelector<HTMLButtonElement>('.dock button[aria-label="New conversation"]')!.click());
  await settle();
};
const asked = () => calls.filter((c) => c.url === '/api/brain/stream').map((c) => c.body.text);

describe('the Brain chat after a new conversation', () => {
  it('/resume does not ask again what /stop cut off in the conversation before', async () => {
    await act(async () => launcher().click());
    await settle();
    await say('plan the week');
    for (let i = 0; i < 50 && !asked().length; i++) await settle();
    await say('/stop');
    await settle();
    await newConversation();
    await say('/resume');
    await settle();
    expect(asked()).toEqual(['plan the week']);
    expect(calls.findLast((c) => c.url === '/api/brain/resume')!.body).toEqual({});
  });

  it('an agent designed for the conversation before does not show up in the new one', async () => {
    holding = new Set(['/api/assist/agent']);
    await pick('new-agent');
    await say('a researcher');
    for (let i = 0; i < 50 && !held.has('/api/assist/agent'); i++) await settle();
    expect(list()).toContain('Designing an agent for this…');
    await newConversation();
    await pick('a:a1');
    await say('hello Scout');
    await settle();
    expect(list()).toContain('hello Scout');
    await act(async () => held.get('/api/assist/agent')!());
    await settle();
    // the new conversation's messages stay, and the old design is not added
    expect(list()).toContain('hello Scout');
    expect(list()).not.toContain('designed from your message');
    expect(document.querySelectorAll('.dock-msg').length).toBe(2);
    holding = new Set();
  });

  it('an agent card follows the turn a /resume starts in its chat', async () => {
    await newConversation();
    await pick('a:a1');
    scout = [{ type: 'user', text: 'look into it' }];
    await say('look into it');
    await settle();
    await serverEvent({ type: 'run', agentId: 'a1', chatId: 'c9', event: { kind: 'done' } });
    scout = [...scout, { type: 'assistant', text: 'Stopped halfway.' }];
    await settle();
    // (the stopped turn, as saved)
    scout = [...scout, { type: 'user', text: 'go on' }, { type: 'assistant', text: 'All done now.' }];
    await serverEvent({ type: 'run', agentId: 'a1', chatId: 'c9', event: { kind: 'start' } });
    for (let i = 0; i < 50 && !list().includes('All done now.'); i++) await settle();
    expect(list()).toContain('All done now.');
  });

  it('a message to the Brain goes to the Brain, even if another recipient is picked while its answer stops', async () => {
    await newConversation();
    await pick('auto');
    await say('first question');
    for (let i = 0; i < 50 && asked().at(-1) !== 'first question'; i++) await settle();
    holding = new Set(['/api/brain/steer']);
    const before = calls.filter((c) => c.url === '/api/agents/a1/chats').length;
    await say('second question');
    for (let i = 0; i < 50 && !held.has('/api/brain/steer'); i++) await settle();
    await pick('a:a1');
    await act(async () => held.get('/api/brain/steer')!());
    for (let i = 0; i < 50 && asked().at(-1) !== 'second question'; i++) await settle();
    expect(asked().at(-1)).toBe('second question');
    expect(calls.filter((c) => c.url === '/api/agents/a1/chats').length).toBe(before);
    holding = new Set();
  });
});
