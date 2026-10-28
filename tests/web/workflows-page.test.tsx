// The Team editor / workflows (React): steps you reorder and fill in, saving, running.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import * as workflows from '../../web/views/workflows.tsx';
import { moveStep } from '../../web/views/workflows.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = (ms = 30) => act(() => new Promise((r) => setTimeout(r, ms)));
let requests: { method: string; url: string; body: unknown }[];
let el: HTMLElement;
const wf = { id: 'w1', name: 'Daily post', description: '', members: [], schedule: { type: 'none' }, enabled: false, steps: [
  { id: 's1', type: 'agent', agentId: 'a1', prompt: '{{input}}', label: 'Research' },
  { id: 's2', type: 'approval', label: 'Check' },
] };

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  requests = [];
  state.data = { agents: [{ id: 'a1', name: 'Writer', emoji: '✍️' }], accounts: { x: [] } } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url === '/api/workflows/w1' && method === 'GET') return json(wf);
    if (url === '/api/tools') return json({ tools: [{ name: 'comfy_run', group: 'programs', risk: 'low', description: 'Runs a ComfyUI workflow' }] });
    if (url.startsWith('/api/workflow-runs')) return json([]);
    return json({ ok: true });
  });
});
afterEach(() => {
  act(() => workflows.unmount());
  vi.unstubAllGlobals();
});

const open = async () => {
  await act(async () => workflows.render(el, ['w1']));
  await settle(200);
};
const btn = (label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) || [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
const labels = () => [...el.querySelectorAll<HTMLInputElement>('.wf-label')].map((i) => i.value);

describe('moveStep()', () => {
  it('swaps a step with its neighbour, and leaves the ends alone', () => {
    expect(moveStep(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveStep(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('the workflow editor', () => {
  it('moves and removes steps, and Save sends the new order', async () => {
    await open();
    expect(labels()).toEqual(['Research', 'Check']);
    expect(btn('Move step 1 up').disabled).toBe(true);
    await act(async () => btn('Move step 2 up').click());
    expect(labels()).toEqual(['Check', 'Research']);
    await act(async () => btn('+ Notify me').click());
    expect(labels()).toHaveLength(3);
    await act(async () => btn('Remove step 3').click());
    await act(async () => btn('Save').click());
    await settle();
    const put = requests.find((r) => r.method === 'PUT')!.body as { steps: { id: string }[] };
    expect(put.steps.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it("shows a step's fields for its type", async () => {
    await open();
    const type = el.querySelector<HTMLSelectElement>('select[aria-label="Step 2: what it does"]')!;
    await act(async () => {
      type.value = 'tool';
      type.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const step = el.querySelectorAll('.step')[1];
    expect([...step.querySelectorAll('label.field > span:first-child')].map((s) => s.textContent)).toEqual(['Tool', 'Arguments (JSON)']);
  });

  it('Run now saves your changes first', async () => {
    await open();
    await act(async () => btn('Remove step 2').click());
    await act(async () => btn('Run now').click());
    await settle();
    expect(requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`)).toEqual(['PUT /api/workflows/w1', 'POST /api/workflows/w1/run']);
  });
});
