// The World panel (voxel look): WORLD.md and its history, what is built, the look, and which world the
// project shows, against a stand-in server.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import { mountReact } from '../../web/ui/react.tsx';
import { WorldPanel, openWorldPicker } from '../../web/views/worldpanel.tsx';
import { setPictureSource } from '../../web/voxel/picture.ts';
import { envPreset } from '../../shared/worldenv.ts';
import type { AppState, VoxelWorld, WorldListing } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

const mira = { kind: 'agent' as const, id: 'a1', name: 'Mira' };
const world = (over: Partial<VoxelWorld> = {}): VoxelWorld => ({
  format: 1,
  id: 'w1',
  name: 'Garden world',
  homeProject: 'p1',
  built: true,
  voxelSize: 0.25,
  palette: [],
  objects: [
    { id: 'o1', name: 'Sky island', by: mira, anchor: { to: 'brain' }, position: [0, 0, 0], rotation: 0, scale: 1, volumes: [{ id: 'v', voxelSize: 0.5, count: 1200, min: null, max: null }], createdAt: 1, updatedAt: Date.now() },
    { id: 'o2', name: 'Lamps', by: { kind: 'agent', id: 'a2', name: 'Kenji' }, anchor: { to: 'world' }, position: [0, 0, 0], rotation: 0, scale: 1, volumes: [], instances: 12, hidden: true, createdAt: 1, updatedAt: Date.now() },
  ],
  prefabs: [],
  lights: [{ id: 'l1', name: 'Doorway', by: mira, kind: 'spot', color: '#ffb860', intensity: 4, range: 10, anchor: { to: 'world' }, position: [0, 2, 0] }],
  effects: [{ id: 'e1', name: 'Pond lights', by: mira, kind: 'fireflies', size: [4, 2, 4], amount: 0.5, anchor: { to: 'world' }, position: [0, 0, 0] }],
  skins: { teams: {}, agents: { a1: { hidden: true, label: false } } },
  environment: envPreset('golden'),
  createdAt: 1,
  updatedAt: Date.now(),
  ...over,
});

let calls: { method: string; url: string; body?: unknown }[];
let mdText: string;
let mdWorld: string;
let listing: WorldListing[];
let el: HTMLElement;
let view: { unmount: () => void } | null = null;

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><div id="host"></div>';
  el = document.getElementById('host')!;
  calls = [];
  mdText = '# Garden world\n\n## Theme and meaning\nA calm garden.';
  mdWorld = 'w1';
  listing = [
    { id: 'w1', name: 'Garden world', homeProject: 'p1', built: true, objects: 2, voxels: 1200, usedBy: ['p1'], isDefault: false, updatedAt: Date.now() },
    { id: 'w2', name: 'Old city', homeProject: 'p2', built: true, objects: 9, voxels: 50000, usedBy: [], isDefault: true, updatedAt: Date.now() - 86_400_000 },
  ];
  state.data = { agents: [{ id: 'a1', name: 'Mira' }], projects: [{ id: 'p1', name: 'Launch' }, { id: 'p2', name: 'City' }], project: { id: 'p1', name: 'Launch' }, settings: { look: { stationLook: 'world' } } } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    if (url === '/api/world') return json({ world: world(), how: 'own' });
    if (url === '/api/world/md' && method === 'PUT') return json({ worldId: 'w1', text: (mdText = (body as { text: string }).text), updatedAt: Date.now(), max: 50000 });
    if (url === '/api/world/md') return json({ worldId: mdWorld, text: mdText, updatedAt: Date.now() - 60_000, max: 50000 });
    if (url === '/api/world/md/versions') return json([{ id: 'v1', at: Date.now() - 3_600_000, by: 'agent', chars: 30 }]);
    if (url === '/api/world/md/versions/v1/restore') return json({ worldId: 'w1', text: (mdText = '# Back'), updatedAt: Date.now(), max: 50000 });
    if (url === '/api/world/prefabs') return json([{ id: 'p1', name: 'Lamp post', description: 'an iron lamp', tags: [], by: mira, volumes: [], pivot: [0, 0, 0], size: [0.25, 2.25, 0.25], createdAt: 1, updatedAt: 1, uses: { in: ['"Lamps"'], copies: 12 } }]);
    if (url === '/api/world/changes') return json([{ at: Date.now() - 30_000, by: 'Mira', what: 'built Sky island' }]);
    if (url === '/api/world/undo') return json({ text: 'Undid: Mira built Sky island.' });
    if (url === '/api/worlds') return json(listing);
    if (url.startsWith('/api/prefab-library')) return json([{ id: 'lp1', name: 'Palm', description: 'a date palm', tags: [], by: 'Imhotep', fromWorld: 'Nile', size: [2, 3.5, 2], voxels: 85, createdAt: 1 }]);
    if (url === '/api/world/prefabs/import') return json({ id: 'p9', name: 'Palm 2' });
    if (url === '/api/world/prefabs/p1/publish') return json({ text: 'Published "Lamp post" in the prefab library.' });
    if (url === '/api/world/export') return json({ paths: ['/x/lamps.glb'], artifacts: ['a1'], note: '' });
    if (url === '/api/world/picture') return json({ path: '/x/pic.jpg', artifact: 'a2' });
    return json({ ok: true });
  });
});
afterEach(() => {
  act(() => view?.unmount());
  view = null;
  vi.unstubAllGlobals();
});

const open = async () => {
  await act(async () => void (view = mountReact(el, <WorldPanel onClose={() => {}} />)));
  await settle();
};
const button = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === text)!;
const tab = async (name: string) => {
  await act(async () => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === name)!.click());
  await settle();
};
const sure = async (label: string) => {
  await settle();
  await act(async () => button(document.querySelector('.modal-foot')!, label).click());
  await settle();
};

describe('the World panel', () => {
  it('shows WORLD.md, edits it and saves the whole text', async () => {
    await open();
    expect(el.querySelector('.st-panel-title')!.textContent).toBe('Garden world');
    expect(el.textContent).toContain('This project’s own world.');
    expect(el.querySelector('.world-md h2')!.textContent).toBe('Theme and meaning');
    await act(async () => button(el, 'Edit').click());
    const area = el.querySelector('textarea')!;
    expect(area.value).toBe(mdText);
    expect(button(el, 'Save').disabled).toBe(true);
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(area, '# Garden world\n\nNew text.');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button(el, 'Save').click());
    await settle();
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/world/md')!.body).toEqual({ text: '# Garden world\n\nNew text.' });
    expect(el.querySelector('textarea')).toBeNull();
  });

  it("never saves a draft over another world's WORLD.md", async () => {
    await open();
    await act(async () => button(el, 'Edit').click());
    const area = el.querySelector('textarea')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(area, 'Garden notes.');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // another world is shown now (the project menu's picker)
    mdWorld = 'w2';
    await act(async () => button(el, 'Save').click());
    await settle();
    expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/world/md')).toBe(false);
    expect(document.getElementById('toasts')!.textContent).toContain('for another world');
    expect(el.querySelector('textarea')!.value).toBe('Garden notes.');
    expect(button(el, 'Save').disabled).toBe(true);
  });

  it('lists earlier WORLD.md versions and brings one back', async () => {
    await open();
    await act(async () => button(el, 'History').click());
    await settle();
    expect(el.textContent).toContain('by an agent · 30 characters');
    await act(async () => button(el, 'Restore').click());
    await sure('Bring it back');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/world/md/versions/v1/restore')).toBe(true);
  });

  it('Built: objects by builder, hiding and showing, prefabs, recent changes and undo', async () => {
    await open();
    await tab('Built');
    const text = el.textContent!;
    expect(text).toContain('Built by Mira');
    expect(text).toContain('Built by Kenji');
    expect(text).toContain('1,200 voxels');
    expect(text).toContain('12 copies');
    expect(text).toContain('12 copies in "Lamps"');
    expect(text).toContain('Mira built Sky island');
    await act(async () => button(el, 'Show').click());
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/world/objects/o2')!.body).toEqual({ hidden: false });
    // a prefab that is placed can't be deleted here
    expect(el.querySelector('button[aria-label="Delete Lamp post"]')).toBeNull();
    await act(async () => button(el, 'Undo the last change').click());
    await settle();
    expect(calls.find((c) => c.url === '/api/world/undo')!.body).toEqual({ anyone: true });
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Delete Sky island"]')!.click());
    await sure('Delete');
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/world/objects/o1')).toBe(true);
  });

  it('Look: time of day, weather, lights, effects, and bringing a hidden agent back', async () => {
    await open();
    await tab('Look');
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.chip')].find((b) => b.textContent === 'Night')!.click());
    expect(calls.find((c) => c.url === '/api/world/environment')!.body).toEqual({ preset: 'night' });
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.chip')].find((b) => b.textContent === 'Snow')!.click());
    expect(calls.filter((c) => c.url === '/api/world/environment').at(-1)!.body).toEqual({ weather: 'snow' });
    expect(el.textContent).toContain('Doorway');
    expect(el.textContent).toContain('Pond lights');
    expect(el.textContent).toContain('Mira off the map · no name label');
    await act(async () => button(el, 'Show on the map').click());
    expect(calls.find((c) => c.url === '/api/world/skins')!.body).toEqual({ to: 'agent', id: 'a1', fields: { hidden: false, label: true } });
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Take Doorway away"]')!.click());
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/world/lights/l1')).toBe(true);
  });

  it('World: every world, sharing one, copying one, the default, and deleting an unused one', async () => {
    await open();
    await tab('World');
    const rows = [...el.querySelectorAll<HTMLElement>('.world-row')];
    expect(rows.map((r) => r.querySelector('span')!.textContent)).toEqual(['Garden world', 'Old city']);
    expect(rows[0].textContent).toContain('shown here');
    expect(rows[1].textContent).toContain('default');
    expect(rows[1].textContent).toContain('made for City');
    // the one shown here: no share or copy; a world no project uses can go
    expect(button(rows[0], 'Share it')).toBeUndefined();
    expect(button(rows[0], 'Delete')).toBeUndefined();
    await act(async () => button(rows[1], 'Share it').click());
    expect(calls.find((c) => c.url === '/api/project-world')!.body).toEqual({ worldId: 'w2', mode: 'share' });
    await act(async () => button(rows[1], 'Start from a copy').click());
    expect(calls.filter((c) => c.url === '/api/project-world').at(-1)!.body).toEqual({ worldId: 'w2', mode: 'copy' });
    await act(async () => button(rows[1], 'No default').click());
    expect(calls.find((c) => c.url === '/api/worlds/default')!.body).toEqual({ worldId: null });
    await act(async () => button(rows[1], 'Delete').click());
    await sure('Delete it');
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/worlds/w2')).toBe(true);
  });

  it('the picker also opens on its own (the project menu)', async () => {
    await act(async () => openWorldPicker());
    await settle();
    expect(document.querySelectorAll('.world-row').length).toBe(2);
    expect(document.body.textContent).toContain('Launch: its voxel world');
  });
});

describe('files and pictures out, the prefab library in', () => {
  it('exports an object as a 3D model or a .vox, and the whole world', async () => {
    await open();
    await tab('Built');
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Export Sky island"]')!.click());
    await act(async () => button(el, '3D model').click());
    await settle();
    expect(calls.find((c) => c.url === '/api/world/export')!.body).toEqual({ what: 'object', id: 'o1', format: 'glb' });
    expect(document.getElementById('toasts')!.textContent + document.body.textContent).toContain('Saved "Sky island" to Artifacts');
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Export Lamp post"]')!.click());
    await act(async () => button(el, '.vox').click());
    await settle();
    expect(calls.filter((c) => c.url === '/api/world/export')[1].body).toEqual({ what: 'prefab', id: 'p1', format: 'vox' });
    await tab('World');
    await act(async () => button(el, 'Export the whole world').click());
    await settle();
    expect(calls.filter((c) => c.url === '/api/world/export')[2].body).toEqual({ what: 'world', format: 'glb' });
  });

  it('searches the library, takes a prefab in, and shares one out', async () => {
    await open();
    await tab('Built');
    await act(async () => button(el, 'Library').click());
    await act(() => new Promise((r) => setTimeout(r, 260)));
    expect(el.querySelector('.world-library')!.textContent).toContain('Palm by Imhotep · from Nile');
    await act(async () => button(el, 'Take into this world').click());
    await settle();
    expect(calls.find((c) => c.url === '/api/world/prefabs/import')!.body).toEqual({ name: 'Palm' });
    expect(document.body.textContent).toContain('Took "Palm" into this world as "Palm 2"');
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Share Lamp post to the library"]')!.click());
    await settle();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/world/prefabs/p1/publish')).toBe(true);
  });

  it('saves a picture of what you see, only when the Station can draw one', async () => {
    await open();
    expect(el.querySelector('.world-picture')).toBeNull();
    const off = setPictureSource((w) => `data:image/jpeg;base64,${w}`);
    act(() => view?.unmount());
    await open();
    await act(async () => el.querySelector<HTMLButtonElement>('.world-picture')!.click());
    await settle();
    expect(calls.find((c) => c.url === '/api/world/picture')!.body).toEqual({ image: 'data:image/jpeg;base64,1600', name: 'Garden world' });
    expect(document.body.textContent).toContain('Saved a picture to Artifacts');
    off();
  });
});
