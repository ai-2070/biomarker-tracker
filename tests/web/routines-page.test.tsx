// The routine editor (React around the plain-DOM @ menu): mentioning, saving, running, the runs list.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import * as routines from '../../web/views/routines.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = (ms = 30) => act(() => new Promise((r) => setTimeout(r, ms)));

let requests: { method: string; url: string; body: unknown }[];
let el: HTMLElement;
const routine = { id: 'r1', name: 'Morning news', description: '', text: 'Find news.', schedule: { type: 'none' }, enabled: false, mentions: [] };
const run = { id: 'run1', routineId: 'r1', status: 'done', trigger: 'manual', createdAt: Date.now(), skills: [], targets: [{ kind: 'agent', id: 'a1', name: 'Writer', status: 'done', chatId: 'c1', output: 'Three stories.' }] };

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  requests = [];
  state.data = { agents: [{ id: 'a1', name: 'Writer', emoji: '✍️', specialty: 'Posts' }] } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method, url, body });
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url === '/api/routines/r1' && method === 'GET') return json(routine);
    if (url === '/api/routines/r1' && method === 'PUT') return json({ ...routine, ...body, mentions: [] });
    if (url.startsWith('/api/routine-runs')) return json([run]);
    if (url.startsWith('/api/skills')) return json({ skills: [], claude: [] });
    return json(url.includes('/workflows') ? [] : { ok: true });
  });
});
afterEach(() => {
  act(() => routines.unmount());
  vi.unstubAllGlobals();
  document.querySelectorAll('.rt-menu').forEach((m) => m.remove());
});

const open = async () => {
  await act(async () => routines.render(el, ['r1']));
  await settle(200);
};
const btn = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
const typeInto = (ta: HTMLTextAreaElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, text);
    ta.setSelectionRange(text.length, text.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('the routine editor', () => {
  it('@ offers agents to mention; picking one puts it in the text and under "Who does it"', async () => {
    await open();
    const ta = el.querySelector<HTMLTextAreaElement>('textarea[aria-label="What to do"]')!;
    ta.focus();
    await typeInto(ta, 'Ask @Wr');
    const menu = document.querySelector('.rt-menu')!;
    expect([...menu.querySelectorAll('.rt-menu-item')].map((b) => b.textContent)).toEqual(['✍️WriterPosts']);
    await act(async () => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(ta.value).toBe('Ask @Writer ');
    expect(el.querySelector('.rt-who')!.textContent).toContain('Writer');
    expect(btn('Save').disabled).toBe(false);
  });

  it('saves what you changed, and Run now saves first', async () => {
    await open();
    const name = [...el.querySelectorAll('label.field')].find((f) => f.textContent?.startsWith('Name'))!.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Evening news');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => btn('Run now').click());
    await settle();
    const calls = requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`);
    expect(calls).toEqual(['PUT /api/routines/r1', 'POST /api/routines/r1/run']);
    expect(requests.find((r) => r.method === 'PUT')!.body).toMatchObject({ name: 'Evening news', text: 'Find news.', schedule: { type: 'none' } });
  });

  it('lists its runs, the newest open, with what each agent did', async () => {
    await open();
    const details = el.querySelector<HTMLDetailsElement>('details')!;
    expect(details.open).toBe(true);
    expect(details.textContent).toContain('Three stories.');
    expect(details.querySelector('a[href="#/agents/a1/c1"]')).not.toBeNull();
  });
});
