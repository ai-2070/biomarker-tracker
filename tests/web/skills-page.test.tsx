// The Skills page (React): who has each skill, "Give to…" as a menu of checkboxes, search, delete, links to a skill.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import * as skills from '../../web/views/skills.tsx';
import { flip } from '../../web/views/skills.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 40)));

const skill = (slug: string, name: string) => ({ slug, name, description: `${name} rules`, files: [], origin: null });
let requests: { method: string; url: string; body: unknown }[];
let el: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  requests = [];
  state.data = {
    project: { id: 'p1', name: 'Site', skills: ['voice'] },
    settings: { brainSkills: [] },
    agents: [
      { id: 'a1', name: 'Writer', emoji: '✍️', skills: [] },
      { id: 'a2', name: 'Coder', emoji: '🧑‍💻', skills: ['voice'] },
    ],
  } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url === '/api/skills' && method === 'GET') return json({ skills: [skill('voice', 'Brand voice'), skill('notes', 'Release notes')], claude: [] });
    if (url === '/api/workflows') return json([{ id: 't1', name: 'Social', color: '#f0b04a', skills: [] }]);
    if (url === '/api/skills/voice' && method === 'GET') return json({ ...skill('voice', 'Brand voice'), body: 'Be kind.' });
    if (url === '/api/state') return json(state.data);
    return json({ ok: true });
  });
});
afterEach(() => {
  act(() => skills.unmount());
  vi.unstubAllGlobals();
});

const open = async (params: string[] = []) => {
  await act(async () => skills.render(el, params));
  await settle();
};
const card = (name: string) => [...el.querySelectorAll('.skill-card')].find((c) => c.querySelector('.skill-name')?.textContent === name)!;

describe('flip()', () => {
  it('adds a skill, or takes it out when it is there', () => {
    expect(flip(['a'], 'b', false)).toEqual(['a', 'b']);
    expect(flip(['a', 'b'], 'b', true)).toEqual(['a']);
  });
});

describe('the Skills page', () => {
  it('shows who has each skill', async () => {
    await open();
    expect([...card('Brand voice').querySelectorAll('.skill-use')].map((u) => u.textContent!.trim())).toEqual(['Project', '🧑‍💻 Coder']);
    expect(card('Release notes').querySelector('.skill-uses')!.textContent).toBe('Not given to anyone yet');
  });

  it('"Give to…" is a menu of checkboxes; ticking an agent gives it the skill', async () => {
    await open();
    await act(async () => card('Release notes').querySelector<HTMLButtonElement>('.skill-foot .btn.small')!.click());
    await settle();
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
    expect(items.map((i) => `${i.textContent!.trim()}=${i.getAttribute('aria-checked')}`)).toEqual(['The Brain=false', 'This project (Site)=false', 'Social=false', '✍️Writer=false', '🧑‍💻Coder=false']);
    await act(async () => items.find((i) => i.textContent!.includes('Writer'))!.click());
    await settle();
    expect(requests.find((r) => r.method === 'PUT' && r.url === '/api/agents/a1')!.body).toEqual({ skills: ['notes'] });
  });

  it('searches the library', async () => {
    await open();
    const search = el.querySelector<HTMLInputElement>('input[aria-label="Search skills"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'release');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect([...el.querySelectorAll('.skill-name')].map((n) => n.textContent)).toEqual(['Release notes']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  it('deletes a skill only after you confirm', async () => {
    await open();
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Delete the skill Release notes"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Delete')!.click());
    await settle();
    expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/skills/notes')).toBe(true);
  });

  it('#/skills/<slug> opens that skill in the editor', async () => {
    await open(['voice']);
    await settle();
    expect(document.querySelector('#modal-root .modal h2')!.textContent).toBe('Edit skill · Brand voice');
  });
});
