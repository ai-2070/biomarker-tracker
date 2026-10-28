// The Station's side panel (React), with a stand-in for the map: what each kind of pick shows, and what
// its buttons ask the map to do.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import { mountStationPanel } from '../../web/views/stationpanel.tsx';
import type { StationPanelApi } from '../../web/views/stationpanel.tsx';
import type { MapPick, TeamView } from '../../web/views/stationdata.ts';
import type { AppState, Team } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

const team = (over: Partial<TeamView> = {}): TeamView => ({ id: 't1', name: 'Thumbs', members: ['a1', 'a2'], lead: 'a1', steps: [], description: 'Make thumbnails', ...over }) as TeamView;
let picked: MapPick | null;
let teams: TeamView[];
let saved: TeamView[];
let chosen: (MapPick | null)[];
let view: { update: () => void; unmount: () => void } | null = null;
let el: HTMLElement;

const api = (): StationPanelApi => ({
  selected: () => picked,
  teams: () => teams,
  teamState: (id) => (id === 't1' ? { working: ['a2'], queued: [] } : { working: [], queued: [] }),
  teamBusy: () => false,
  busyTeams: () => 0,
  programs: () => [],
  teamLinks: (id) => new Set(id === 't1' ? ['claude', 'x'] : []),
  now: (agentId) => (agentId === 'a2' ? { st: 'working', text: 'Blender · rendering' } : { st: 'idle', text: '' }),
  connectors: () => [],
  choose: (p) => void chosen.push(p),
  saveTeam: async (wf) => (saved.push(wf), wf as Team),
  reloadTeams: async () => {},
  spinTeam: async () => {},
  zoomToTeam: () => {},
  newTeam: () => {},
});
const open = async (p: MapPick) => {
  picked = p;
  await act(async () => void (view ? view.update() : (view = mountStationPanel(el, api()))));
  await settle();
};
const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === text)!;

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><aside class="st-panel"></aside>';
  el = document.querySelector('.st-panel')!;
  picked = null;
  saved = [];
  chosen = [];
  teams = [team(), team({ id: 't2', name: 'Posts', members: [], lead: null, description: '' })];
  state.data = {
    runs: [],
    approvals: [],
    agents: [
      { id: 'a1', name: 'Scout', emoji: '🔭', engine: 'claude-code', model: 'sonnet', specialty: 'Finds ideas' },
      { id: 'a2', name: 'Maker', emoji: '🎨', engine: 'openai', model: 'm', provider: 'custom', toolGroups: ['social'] },
      { id: 'a3', name: 'Writer', emoji: '✍️', engine: 'openai', model: 'm', provider: 'custom' },
    ],
    project: { id: 'p1', name: 'Launch', brainPath: 'C:/Brain', skills: [] },
    toolGroups: [{ id: 'social', label: 'Social', description: '' }],
    mcpServers: [],
    settings: {},
    engines: { 'claude-code': { installed: true }, hermes: { installed: false }, codex: { installed: false } },
    accounts: { reddit: [], x: [{ id: 'x1' }], telegram: { configured: false }, discord: { configured: false } },
    secrets: { openrouterKey: { set: true } },
  } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    if (url === '/api/brain') return json({ project: {}, entries: [{ name: 'PROJECT.md', dir: false, path: 'PROJECT.md' }, { name: 'notes', dir: true, path: 'notes' }], files: 2, sizeMB: 0.1, git: null, summary: { text: 'A product launch.', from: 'PROJECT.md' } });
    return json([]);
  });
});
afterEach(() => {
  act(() => view?.unmount());
  view = null;
  vi.unstubAllGlobals();
});

describe('the Station panel', () => {
  it('draws nothing while nothing is picked', async () => {
    picked = null;
    await act(async () => void (view = mountStationPanel(el, api())));
    expect(el.textContent).toBe('');
  });

  it("a team: its goal, who's working, and making someone lead", async () => {
    await open({ type: 'branch', id: 't1' });
    expect(el.querySelector('.st-panel-title')!.textContent).toBe('Thumbs');
    expect(el.querySelector('.st-team-goal')!.textContent).toBe('Make thumbnails');
    expect(el.querySelector('.st-team-status')!.textContent).toContain('Maker working');
    const rows = [...el.querySelectorAll('.st-member')];
    expect(rows.map((r) => r.querySelector('.st-member-name')!.textContent)).toEqual(['Scoutlead', 'Maker']);
    expect(rows[1].classList.contains('working')).toBe(true);
    expect(rows[1].querySelector('.st-member-now')!.textContent).toContain('Blender · rendering');
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Make Maker lead"]')!.click());
    expect(saved.at(-1)!.lead).toBe('a2');
  });

  it('a team: adding someone and taking someone off save its members', async () => {
    await open({ type: 'branch', id: 't1' });
    const sel = el.querySelector<HTMLSelectElement>('select[aria-label="Agent to add"]')!;
    expect([...sel.options].map((o) => o.value)).toEqual(['a3']);
    await act(async () => button('Add').click());
    expect(saved.at(-1)!.members).toEqual(['a1', 'a2', 'a3']);
    expect(saved.at(-1)!.steps!.map((s) => s.agentId)).toEqual(['a1', 'a2', 'a3']);
    // taking off the lead takes the lead too
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Take Scout off this team"]')!.click());
    expect(saved.at(-1)!.members).toEqual(['a2']);
    expect(saved.at(-1)!.lead).toBe(null);
  });

  it('a team: the Setup tab saves the name when you leave the field, and the routine', async () => {
    await open({ type: 'branch', id: 't1' });
    await act(async () => [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === 'Setup')!.click());
    await settle();
    const name = el.querySelector<HTMLInputElement>('input[aria-label="Team name"]')!;
    expect(name.value).toBe('Thumbs');
    name.value = 'Thumbnails';
    await act(async () => void name.dispatchEvent(new Event('change')));
    expect(saved.at(-1)!.name).toBe('Thumbnails');
    // the connections it reaches, from the map
    expect([...el.querySelectorAll('.st-conn .grow')].map((x) => x.textContent)).toEqual(['Claude Code', 'X']);
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.seg button')].find((b) => b.textContent === 'Every day')!.click());
    expect(saved.at(-1)!.schedule).toEqual({ type: 'daily' });
    expect(saved.at(-1)!.enabled).toBe(true);
  });

  it('an agent: its teams, adding it to another, and opening a team', async () => {
    await open({ type: 'agent', id: 'a1' });
    expect(el.querySelector('.st-panel-title')!.textContent).toBe('Scout');
    expect(el.querySelector('.st-agent-now')!.textContent).toBe('Ready');
    // (its teams are rows; its connections, buttons)
    expect([...el.querySelectorAll('div.st-conn.ok .grow')].map((x) => x.textContent)).toEqual(['Thumbs · ★ lead']);
    await act(async () => button('Add to team').click());
    await settle();
    expect(saved.at(-1)!.id).toBe('t2');
    expect(saved.at(-1)!.members).toEqual(['a1']);
    await act(async () => el.querySelector<HTMLElement>('div.st-conn.ok .grow')!.click());
    expect(chosen.at(-1)).toEqual({ type: 'branch', id: 't1' });
  });

  it('the Brain: the project, what is in its folder, and its teams', async () => {
    await open({ type: 'brain' });
    for (let i = 0; i < 20 && !el.querySelector('.st-file'); i++) await settle();
    expect(el.querySelector('.st-panel-title')!.textContent).toBe('Launch');
    expect(el.querySelector('.st-about-text')!.textContent).toBe('A product launch.');
    expect([...el.querySelectorAll('.st-file')].map((f) => f.textContent!.trim())).toEqual(['PROJECT.md', 'notes']);
    expect([...el.querySelectorAll('.list .title')].map((t) => t.textContent)).toEqual(['Thumbs', 'Posts']);
    await act(async () => el.querySelector<HTMLElement>('.list .list-row')!.click());
    expect(chosen.at(-1)).toEqual({ type: 'branch', id: 't1' });
  });

  it('a connection: the teams and agents that reach it', async () => {
    await open({ type: 'int', id: 'x' });
    expect(el.querySelector('.st-panel-title')!.textContent).toBe('X');
    expect(el.querySelector('.pill')!.textContent).toBe('ready');
    expect([...el.querySelectorAll('.list .grow')].map((l) => l.textContent)).toEqual(['Thumbs', 'Maker']);
  });

  it('the Bench: agents on no team', async () => {
    teams = [team({ members: ['a1'] })];
    await open({ type: 'bench' });
    expect(el.querySelector('.st-panel-title')!.textContent).toBe('2 agents not on a team');
    expect([...el.querySelectorAll('.list .title')].map((t) => t.textContent)).toEqual(['Maker', 'Writer']);
  });
});
