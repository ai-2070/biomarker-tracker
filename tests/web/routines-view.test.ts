// The Routines page: a load that finishes after you left the page must not draw over the next one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import type { AppState } from '../../shared/types.ts';

// fetch answers only when we say so
const pending: { path: string; answer: (body: unknown) => void }[] = [];
vi.stubGlobal('fetch', (url: string) =>
  new Promise((resolve) => pending.push({ path: String(url), answer: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })) })),
);
const answerAll = async (by: (path: string) => unknown) => {
  for (let i = 0; i < 5; i++) {
    for (const p of pending.splice(0)) p.answer(by(p.path));
    await new Promise((r) => setTimeout(r, 0));
  }
};
const reply = (path: string) => (path.includes('/skills') ? { skills: [], claude: [] } : []);

afterEach(() => (pending.length = 0));

describe('the Routines page', () => {
  it("draws nothing once you've moved on to another page", async () => {
    state.data = { agents: [] } as unknown as AppState;
    const view = await import('../../web/views/routines.tsx');
    const el = document.createElement('section');
    document.body.append(el);
    const loading = view.render(el, []);
    // you leave before the routines arrive; the next page draws into the same element
    view.unmount();
    el.innerHTML = '<p id="next-page">Agents</p>';
    await answerAll(reply);
    await loading;
    expect(el.innerHTML).toBe('<p id="next-page">Agents</p>');
  });

  it('draws the list when you stay', async () => {
    const view = await import('../../web/views/routines.tsx');
    const el = document.createElement('section');
    document.body.append(el);
    const loading = view.render(el, []);
    await answerAll(reply);
    await loading;
    await answerAll(reply);
    expect(el.textContent).toContain('No routines yet.');
    view.unmount();
  });
});
