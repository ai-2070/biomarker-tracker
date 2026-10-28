// Settings > About (React): the version, the GitHub link and star button, and this PC's address.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import { AboutTab } from '../../web/views/about.tsx';
import { REPO } from '../../shared/about.ts';
import type { AboutInfo, AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

let el: HTMLElement;
let root: Root;
const asked: string[] = [];
function serve(about: AboutInfo) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(String(url));
      return new Response(JSON.stringify(String(url).startsWith('/api/about') ? about : {}), { status: 200 });
    }),
  );
}
const info = (stars: number | null): AboutInfo => ({ name: 'Blacksite', version: '1.2.3', repo: REPO.slug, url: REPO.url, license: 'MIT OR Apache-2.0', stars });

beforeEach(() => {
  asked.length = 0;
  document.body.innerHTML = '<div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  state.data = { port: 4800, dataDir: 'C:\\data' } as unknown as AppState;
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  state.data = null;
});

describe('Settings > About', () => {
  it('shows the version, the licence and links to the GitHub repo, with the star count', async () => {
    serve(info(1234));
    await act(async () => root.render(<AboutTab />));
    await settle();
    expect(asked).toEqual(['/api/about?stars=1']);
    expect(el.querySelector('.about-title')!.textContent).toContain('v1.2.3');
    expect(el.textContent).toContain('MIT or Apache-2.0');
    const star = el.querySelector<HTMLAnchorElement>('.star-btn')!;
    expect(star.href).toBe(REPO.url);
    expect(star.target).toBe('_blank');
    expect(star.textContent).toContain('1,234');
    expect([...el.querySelectorAll<HTMLAnchorElement>('a')].map((a) => a.href)).toEqual(expect.arrayContaining([`${REPO.url}/issues`, `${REPO.url}/releases`]));
    expect(el.textContent).toContain('http://localhost:4800');
  });

  it('leaves the count out when GitHub gave none (a private repo)', async () => {
    serve(info(null));
    await act(async () => root.render(<AboutTab />));
    await settle();
    expect(el.querySelector('.star-btn')!.textContent).toBe('Star on GitHub');
  });
});
