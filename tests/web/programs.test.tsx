// Settings > Programs (React): cards by category, Start until it is seen running, Start Menu search, ComfyUI.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectEvents } from '../../web/core.ts';
import * as programs from '../../web/views/programs.tsx';
import { progState } from '../../web/views/programs.tsx';

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
const prog = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), category: 'creative', icon: '🎨', installed: true, optional: false, exe: 'x.exe', shortcut: null, version: '4.2', versions: null, cli: false, running: false, serviceUrl: null, actions: ['launch'], ...over });
let progs: ReturnType<typeof prog>[];
let requests: { method: string; url: string; body: unknown }[];
let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  progs = [prog('blender'), prog('ffmpeg', { category: 'dev', cli: true, version: null, exe: null, actions: [] }), prog('premiere', { installed: false })];
  requests = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url.startsWith('/api/programs/all')) return json([{ name: 'Notepad', shortcut: 'n.lnk', folder: 'Accessories' }, { name: 'Paint', shortcut: 'p.lnk', folder: '' }]);
    if (url.startsWith('/api/programs/launch')) return json({ message: 'Starting it' });
    if (url.startsWith('/api/programs')) return json(progs);
    if (url === '/api/comfyui') return json({ status: { running: true, url: 'http://127.0.0.1:8188' }, workflows: [{ name: 'portrait', dir: 'x' }, { name: 'landscape', dir: 'x' }] });
    if (url === '/api/comfyui/run') return json({ promptId: 'p', workflow: 'landscape', files: [{ kind: 'images', url: '/api/comfyui/view?f=1.png', filename: '1.png' }], seconds: 3 });
    return json({});
  });
  connectEvents();
});
afterEach(() => {
  act(() => programs.unmount());
  vi.unstubAllGlobals();
});

const open = async () => {
  await act(async () => programs.render(el));
  await settle();
};
const btn = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;

describe('progState()', () => {
  it('says the version or how it runs, and whether it runs or is starting', () => {
    expect(progState({ version: '4.2', cli: false, running: true })).toBe('v4.2 · running');
    expect(progState({ version: null, cli: true, running: false })).toBe('command line');
    expect(progState({ version: null, cli: true, running: false }, true)).toBe('installed · starting…');
  });
});

describe('the Programs tab', () => {
  it('groups what was found and lists what was not', async () => {
    await open();
    expect([...el.querySelectorAll('h2.section')].map((h) => h.textContent)).toEqual(['Images and design', 'Developer', 'Not found', 'All apps (Start Menu)']);
    expect(el.textContent).toContain('Premiere Set custom paths in Settings.');
  });

  it('shows "starting…" after Start until the server says it is running', async () => {
    await open();
    const card = el.querySelector('[data-prog="blender"]')!;
    await act(async () => btn(card, 'Start').click());
    await settle();
    expect(card.querySelector('.prog-state')!.textContent).toBe('v4.2 · starting…');
    expect(card.querySelector('.dot')!.classList.contains('busy')).toBe(true);
    progs = [prog('blender', { running: true }), ...progs.slice(1)];
    await act(async () => FakeSocket.last.onmessage!({ data: JSON.stringify({ type: 'programs', ts: 0 }) }));
    await settle();
    expect(card.querySelector('.prog-state')!.textContent).toBe('v4.2 · running');
    expect(card.querySelector('.dot')!.classList.contains('on')).toBe(true);
  });

  it('searches the Start Menu apps and starts one', async () => {
    await open();
    const search = el.querySelector<HTMLInputElement>('input[aria-label="Search the Start Menu apps"]')!;
    expect(search.placeholder).toBe('Search 2 apps');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'access');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect([...el.querySelectorAll('.prog-app-name')].map((n) => n.textContent)).toEqual(['Notepad']);
    await act(async () => btn(el.querySelector('.prog-apps')!, 'Start').click());
    await settle();
    expect(requests.find((r) => r.url === '/api/programs/launch')!.body).toEqual({ program: 'Notepad' });
  });

  it('runs a ComfyUI workflow with a prompt and shows the images as buttons', async () => {
    await open();
    const select = el.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      select.value = 'landscape';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const prompt = el.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, 'a red fox');
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => btn(el, 'Run').click());
    await settle();
    expect(requests.find((r) => r.url === '/api/comfyui/run')!.body).toEqual({ workflow: 'landscape', prompt: 'a red fox' });
    expect(el.querySelector('.img-button img')!.getAttribute('src')).toBe('/api/comfyui/view?f=1.png');
  });
});
