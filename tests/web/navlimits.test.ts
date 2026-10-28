// The sidebar's usage view: Claude and Codex limits in place of the status list, Codex's free limit resets,
// and the Status / Limits switch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, state } from '../../web/core.ts';
import { navLimits, panelSwitch, resetLimitsCache, sidebarPanel, timeUntil } from '../../web/navlimits.ts';
import type { AppState, UsageLimits } from '../../shared/types.ts';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let requests: { method: string; url: string; body: unknown }[];
let limits: UsageLimits;
let el: HTMLElement;
const hoverCodex = () => el.querySelector('.codex-limits')!.dispatchEvent(new MouseEvent('mouseenter'));
const draw = () => mount(el, panelSwitch(draw), sidebarPanel() === 'limits' ? navLimits(draw) : [document.createTextNode('status list')]);

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><div id="nav-status"></div>';
  el = document.getElementById('nav-status')!;
  localStorage.clear();
  resetLimitsCache();
  state.data = { engines: { 'claude-code': { installed: true, loggedIn: true }, codex: { installed: true, loggedIn: true } }, settings: { look: { sidebar: 'limits' } } } as unknown as AppState;
  const now = Date.now();
  limits = {
    claude: { ready: true, windows: [{ label: '5h', percent: 42, resetsAt: now + 2 * HOUR + 10 * 60_000 }, { label: 'Week', percent: 91, resetsAt: now + 4 * DAY }] },
    codex: {
      ready: true,
      plan: 'prolite',
      windows: [{ label: 'Week', percent: 80, resetsAt: now + 6 * DAY }],
      resets: { available: 2, credits: [{ id: 'soon', expiresAt: now + 2 * DAY + 13 * HOUR + 60_000, title: 'Full reset' }, { id: 'later', expiresAt: now + 20 * DAY, title: null }] },
    },
  };
  requests = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url === '/api/usage-limits') return json(limits);
    if (url === '/api/codex/reset') {
      const after: UsageLimits = { ...limits, codex: { ...limits.codex, windows: [{ label: 'Week', percent: 0, resetsAt: Date.now() + 7 * DAY }], resets: { available: 1, credits: [limits.codex.resets!.credits[1]] } } };
      return json({ outcome: 'reset', limits: after });
    }
    return json({});
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('timeUntil', () => {
  it('days and hours, hours and minutes, or minutes', () => {
    const now = 1_000_000;
    expect(timeUntil(now + 2 * DAY + 13 * HOUR, now)).toBe('2d 13h');
    expect(timeUntil(now + 4 * HOUR + 10 * 60_000, now)).toBe('4h 10m');
    expect(timeUntil(now + 12 * 60_000, now)).toBe('12m');
    expect(timeUntil(now - 5000, now)).toBe('1m');
  });
});

describe('sidebar usage limits', () => {
  it('shows each plan’s limits with how much is used and when it starts again', async () => {
    draw();
    await tick(10);
    expect(requests.map((r) => r.url)).toEqual(['/api/usage-limits']);
    const rows = [...el.querySelectorAll('.limit-row')].map((r) => r.textContent);
    expect(rows).toEqual(['5h42%2h 10m', 'Week91%4d 0h', 'Week80%6d 0h']);
    expect(el.textContent).toContain('Pro lite');
    // nearly used up: red
    expect(el.querySelectorAll('.limit-row')[1].querySelector('i')!.className).toContain('bg-red');
  });

  it('shows Codex’s free resets beside the sidebar only while you point at Codex', async () => {
    draw();
    await tick(10);
    expect(document.querySelector('.codex-resets')).toBeNull();
    // pointing at Claude shows nothing
    el.querySelector('.limit-row')!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.codex-resets')).toBeNull();
    hoverCodex();
    const box = document.querySelector('.codex-resets')!;
    expect(box.parentElement).toBe(document.body);
    expect(box.textContent).toContain('2 rate-limit resets available');
    expect(box.textContent).toContain('Next expires in 2d 13h');
    expect(box.querySelector('button')!.textContent).toBe('Reset now');
    // the sidebar drawn again under it keeps it open
    draw();
    await tick();
    expect(document.querySelector('.codex-resets')).not.toBeNull();
    // and it goes once the pointer leaves Codex and the card
    document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    await tick(250);
    expect(document.querySelector('.codex-resets')).toBeNull();
  });

  it('moving onto the card keeps it open', async () => {
    draw();
    await tick(10);
    hoverCodex();
    const box = document.querySelector('.codex-resets')!;
    box.querySelector('button')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    await tick(250);
    expect(document.querySelector('.codex-resets')).toBe(box);
  });

  it('Reset now asks first, then uses the reset that runs out first', async () => {
    draw();
    await tick(10);
    hoverCodex();
    document.querySelector<HTMLButtonElement>('.codex-resets button')!.click();
    await tick();
    const ok = [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Reset now')!;
    expect(document.querySelector('.modal')!.textContent).toContain('You have 2.');
    ok.click();
    await tick(10);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: '/api/codex/reset', body: { creditId: 'soon' } });
    expect(document.querySelector('.codex-resets')!.textContent).toContain('1 rate-limit reset available');
    expect([...el.querySelectorAll('.limit-row')].at(-1)!.textContent).toContain('0%');
    expect(document.getElementById('toasts')!.textContent).toContain('Codex limits reset. 1 free reset left.');
  });

  it('Cancel uses nothing', async () => {
    draw();
    await tick(10);
    hoverCodex();
    document.querySelector<HTMLButtonElement>('.codex-resets button')!.click();
    await tick();
    [...document.querySelectorAll<HTMLButtonElement>('.modal-foot button')].find((b) => b.textContent === 'Cancel')!.click();
    await tick(10);
    expect(requests.some((r) => r.url === '/api/codex/reset')).toBe(false);
  });

  it('no card when Codex has no resets, or isn’t signed in, and says why a plan has no numbers', async () => {
    limits.codex = { ...limits.codex, resets: { available: 0, credits: [] } };
    draw();
    await tick(10);
    hoverCodex();
    expect(document.querySelector('.codex-resets')).toBeNull();
    resetLimitsCache();
    limits.codex = { ready: false, why: 'not signed in', windows: [], resets: { available: 2, credits: [] } };
    draw();
    await tick(10);
    hoverCodex();
    expect(document.querySelector('.codex-resets')).toBeNull();
    expect(el.textContent).toContain('not signed in');
  });

  it('the switch goes back to the status list and saves the choice', async () => {
    draw();
    await tick(10);
    const status = [...el.querySelectorAll<HTMLButtonElement>('.sidebar-panel-tab')].find((b) => b.textContent === 'Status')!;
    status.click();
    // the limits slide out first (a moment), then the status list comes in
    await tick(250);
    expect(el.textContent).toContain('status list');
    expect(el.querySelector('.limit-row')).toBeNull();
    expect(requests.at(-1)).toMatchObject({ method: 'PUT', url: '/api/settings', body: { look: { sidebar: 'status' } } });
  });
});
