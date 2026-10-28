// The Artifacts page: search across everything an artifact says about itself.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectEvents } from '../../web/core.ts';
import * as page from '../../web/views/artifacts.tsx';
import { matching } from '../../web/views/artifacts.tsx';
import type { Artifact } from '../../shared/types.ts';

const list: Artifact[] = [
  { id: 'a1', title: 'Microduck TikTok (13 s, 9:16)', kind: 'file', path: 'C:\\net\\video\\microduck_tiktok.mp4', note: 'Cream microduck waddles in, hops', agentName: 'Studio Producer', teamName: 'Video & Motion' },
  { id: 'a2', title: 'Weekly numbers', kind: 'text', text: 'Reach is up 12% on X this week', agentName: 'Analytics Reporter', teamName: 'Social' },
  { id: 'a3', title: 'Renders', kind: 'folder', path: 'C:\\net\\video\\renders', agentName: '3D Artist', teamName: 'Video & Motion' },
];
const ids = (q: string) => matching(list, q).map((a) => a.id);

describe('matching()', () => {
  it('shows everything for an empty search', () => {
    expect(ids('')).toEqual(['a1', 'a2', 'a3']);
    expect(ids('   ')).toEqual(['a1', 'a2', 'a3']);
  });

  it('finds by title, note, team, who made it, file name and the text of a result, in any case', () => {
    expect(ids('tiktok')).toEqual(['a1']);
    expect(ids('WADDLES')).toEqual(['a1']);
    expect(ids('video & motion')).toEqual(['a1', 'a3']);
    expect(ids('analytics')).toEqual(['a2']);
    expect(ids('mp4')).toEqual(['a1']);
    expect(ids('reach is up')).toEqual(['a2']);
    expect(ids('folder')).toEqual(['a3']);
  });

  it('needs every word, in any order', () => {
    expect(ids('video 3d')).toEqual(['a3']);
    expect(ids('hops cream')).toEqual(['a1']);
    expect(ids('video analytics')).toEqual([]);
  });
});

describe('the Artifacts page', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let el: HTMLElement;
  let served: Artifact[];
  let deleted: string[];
  const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
    el = document.getElementById('view')!;
    served = [list[1], list[0]].map((a) => ({ ...a, path: undefined }));
    deleted = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'DELETE') {
        deleted.push(url);
        served = served.filter((a) => !url.endsWith(a.id));
      }
      return new Response(JSON.stringify(url === '/api/artifacts' ? served : { ok: true }));
    });
  });
  afterEach(() => {
    act(() => page.unmount());
    vi.unstubAllGlobals();
  });

  const open = async () => {
    await act(async () => page.render(el));
    await settle();
  };
  const titles = () => [...el.querySelectorAll('.panel b')].map((b) => b.textContent);
  const type = (text: string) =>
    act(async () => {
      const input = el.querySelector<HTMLInputElement>('input[aria-label="Search artifacts"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('lists them, and searching shows how many match', async () => {
    await open();
    expect(titles()).toEqual(['Weekly numbers', 'Microduck TikTok (13 s, 9:16)']);
    await type('reach');
    expect(titles()).toEqual(['Weekly numbers']);
    expect(el.querySelector('.art-search .hint')!.textContent).toBe('1 of 2');
    await type('nothing like this');
    expect(el.textContent).toContain('Nothing matches "nothing like this".');
    await type('');
  });

  it('removes one only after you confirm', async () => {
    await open();
    const removeBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Remove')!;
    await act(async () => removeBtn.click());
    const sure = [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Remove')!;
    await act(async () => sure.click());
    await settle();
    expect(deleted).toEqual(['/api/artifacts/a2']);
    expect(titles()).toEqual(['Microduck TikTok (13 s, 9:16)']);
  });

  it('loads again when the server says artifacts changed', async () => {
    class FakeSocket {
      static last: FakeSocket;
      onmessage: ((m: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onopen: (() => void) | null = null;
      constructor() {
        FakeSocket.last = this;
      }
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    connectEvents();
    await open();
    served = [];
    await act(async () => FakeSocket.last.onmessage!({ data: JSON.stringify({ type: 'artifacts', ts: 0 }) }));
    await settle();
    expect(el.textContent).toContain('Nothing yet.');
  });
});
