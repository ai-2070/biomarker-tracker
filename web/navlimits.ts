// The sidebar's usage view, in place of the status list (the Status / Limits switch above it, or Settings > Look):
// how much of your Claude and Codex plans is used, when each limit starts again, and Codex's free limit resets.
import { h, mount, GET, POST, PUT, state, confirmBox, toast } from './core.ts';
import { DEFAULT_LOOK, applyLook, currentLook, uiZoom } from './look.ts';
import { logo } from './icons.ts';
import { EASE, flipFrom, reducedMotion, slideOut } from './motion.ts';
import type { CodexResetResult, LimitWindow, ProviderLimits, SidebarPanel, UsageLimits } from '../shared/types.ts';

// what the server last said; read again when it's a minute old and the view is drawn
let limits: UsageLimits | null = null;
let loadedAt = 0;
let loading = false;
let failed = false;
let resetting = false;
// sooner while a plan isn't ready: right after the server starts it is still finding out who's signed in
const stale = () => (limits && limits.claude.ready && limits.codex.ready ? 55_000 : 15_000);

/** For tests: forget what was read. */
export function resetLimitsCache(): void {
  limits = null;
  loadedAt = 0;
  loading = false;
  failed = false;
  resetting = false;
  hidePop();
}

export const sidebarPanel = (): SidebarPanel => state.data?.settings?.look?.sidebar || currentLook().sidebar || 'status';

// Switching Status / Limits: the old lines slide out toward where they sit (Status on the left, Limits on the
// right), the new ones slide in from the other side one after another, and the line under the tab glides over.
// Only on a switch: the sidebar is drawn again often, and that must not replay it.
let switching = false;
const lines = (host: Element | null): HTMLElement[] => (host ? ([...host.children].slice(1) as HTMLElement[]) : []);

/** Switches what the sidebar shows, here and in Settings > Look. */
export function setSidebarPanel(p: SidebarPanel, redraw: () => void): void {
  if (switching) return;
  const host = document.getElementById('nav-status');
  const dir = p === 'limits' ? 1 : -1;
  const mark = host?.querySelector('.sidebar-panel-mark')?.getBoundingClientRect();
  const swap = () => {
    switching = false;
    const look = { ...DEFAULT_LOOK, ...currentLook(), ...(state.data?.settings?.look || {}), sidebar: p };
    if (state.data?.settings) state.data.settings.look = look;
    applyLook(look);
    redraw();
    void PUT('/settings', { look: { sidebar: p } }).catch((e: unknown) => toast((e as Error).message, 'error'));
    if (reducedMotion() || typeof document.body.animate !== 'function') return;
    const now = host?.querySelector<HTMLElement>('.sidebar-panel-mark');
    if (now && mark?.width) flipFrom(now, mark, { duration: 260 });
    lines(host).forEach((el, i) => el.animate([{ opacity: 0, transform: `translateX(${dir * 12}px)` }, { opacity: 1, transform: 'none' }], { duration: 260, delay: Math.min(i, 10) * 22, easing: EASE, fill: 'backwards' }));
  };
  const old = lines(host);
  if (!old.length || reducedMotion() || typeof old[0].animate !== 'function') return swap();
  switching = true;
  // (swaps on time even if an animation never reports back)
  void Promise.race([Promise.all(old.map((el) => slideOut(el, { x: -dir * 8, duration: 110 }))), new Promise((r) => setTimeout(r, 160))]).then(swap);
}

/** "2d 13h", "4h 10m", "12m" until the given time (ms). */
export function timeUntil(at: number, now = Date.now()): string {
  const mins = Math.max(1, Math.round((at - now) / 60_000));
  const d = Math.floor(mins / 1440);
  const hr = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${hr}h`;
  if (hr) return `${hr}h ${m}m`;
  return `${m}m`;
}

const when = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function load(redraw: () => void): void {
  if (loading || Date.now() - loadedAt < stale()) return;
  loading = true;
  GET<UsageLimits>('/usage-limits').then(
    (l) => ((limits = l), (failed = false)),
    () => (failed = true),
  ).finally(() => {
    loading = false;
    loadedAt = Date.now();
    redraw();
  });
}

const ROW = '-mx-1.5 flex items-center gap-1.75 rounded-[6px] px-1.5 py-0.75 text-[11.5px] text-dim no-underline [transition:background_0.15s,color_0.15s] hover:bg-accent/12 hover:text-ink';
const close = () => document.body.classList.remove('nav-open');

function head(name: string, brand: string, color: string | undefined, p: ProviderLimits, href: string, right: string) {
  const dot = !p.ready ? (p.why === 'not signed in' ? 'warn' : '') : p.blocked ? 'warn' : 'on';
  return h(
    'a',
    { class: ROW, href, title: p.ready ? `${name} plan limits` : `${name}: ${p.why}`, onclick: close },
    h('span', { class: `dot ${dot}` }),
    h('span', { class: 'flex min-w-0 flex-1 items-center gap-1.5 truncate' }, logo(brand, 11, color), h('span', { class: 'truncate' }, name)),
    right ? h('span', { class: 'text-[10.5px] whitespace-nowrap text-faint' }, right) : null,
  );
}

function meter(w: LimitWindow) {
  const hot = w.percent >= 90 ? 'bg-red' : w.percent >= 75 ? 'bg-amber' : 'bg-accent';
  return h(
    'div',
    { class: 'limit-row flex items-center gap-1.5 py-0.5 pl-3.5 text-[10.5px] text-dim', title: w.resetsAt ? `${w.label}: ${w.percent}% used · starts again ${when(w.resetsAt)}` : `${w.label}: ${w.percent}% used` },
    h('span', { class: 'w-7.5 flex-none text-faint' }, w.label),
    h('span', { class: 'relative h-1 min-w-4 flex-1 overflow-hidden rounded-full bg-line-2' }, h('i', { class: `absolute inset-y-0 left-0 rounded-full ${hot}`, style: { width: `${w.percent}%` } })),
    h('b', { class: 'w-8 flex-none text-right font-medium text-ink tabular-nums' }, `${w.percent}%`),
    h('span', { class: 'w-11 flex-none text-right text-faint tabular-nums' }, w.resetsAt ? timeUntil(w.resetsAt) : ''),
  );
}

function windowsOf(p: ProviderLimits) {
  if (!p.ready) return [];
  if (!p.windows.length) return [h('div', { class: 'py-0.5 pl-3.5 text-[10.5px] text-faint' }, failed ? "couldn't read the limits" : limits ? 'no numbers yet' : 'reading…')];
  return p.windows.map(meter);
}

async function useReset(redraw: () => void): Promise<void> {
  const r = limits?.codex.resets;
  if (!r || resetting) return;
  const next = r.credits[0];
  const used = Math.max(0, ...(limits?.codex.windows || []).map((w) => w.percent));
  const ok = await confirmBox(
    h(
      'div',
      { class: 'flex flex-col gap-2' },
      h('p', { class: 'm-0' }, 'Use a free Codex limit reset now? Your Codex usage limits start again from 0%.'),
      h('p', { class: 'hint m-0' }, `You have ${r.available}.${next?.expiresAt ? ` This one runs out in ${timeUntil(next.expiresAt)} if you don't use it.` : ''}`),
      used < 50 ? h('p', { class: 'hint m-0' }, `You have only used ${used}% so far, so you may want to keep it for later.`) : null,
    ),
    { ok: 'Reset now' },
  );
  if (!ok) return;
  resetting = true;
  redraw();
  try {
    const res = await POST<CodexResetResult>('/codex/reset', { creditId: next?.id || null });
    limits = res.limits;
    loadedAt = Date.now();
    const left = res.limits.codex.resets?.available ?? 0;
    const say: Record<CodexResetResult['outcome'], string> = {
      reset: `Codex limits reset. ${left === 1 ? '1 free reset' : `${left} free resets`} left.`,
      nothingToReset: 'Nothing to reset yet: your Codex limits are unused. The reset was kept.',
      noCredit: 'No free Codex resets left.',
      alreadyRedeemed: 'That reset was already used.',
    };
    toast(say[res.outcome], res.outcome === 'reset' ? 'info' : 'warn');
  } catch (e) {
    toast((e as Error).message, 'error');
  } finally {
    resetting = false;
    redraw();
  }
}

// Codex's free resets: a card beside the sidebar while you point at Codex (signed in, with resets to use).
// It lives in <body>, so the sidebar redrawing under it (every state change) doesn't close it.
let pop: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
const POP = 'codex-resets fixed z-[55] flex w-56 flex-col gap-0.5 rounded-box border border-line-2 bg-panel px-3 py-2.5 font-mono shadow-pop animate-[fade_0.15s_ease-out]';

const hasResets = () => !!(limits?.codex.ready && limits.codex.resets?.available);

function hidePop(): void {
  clearTimeout(hideTimer);
  document.removeEventListener('pointermove', watchPointer);
  pop?.remove();
  pop = null;
}

// closes the card once the pointer is off both Codex's rows and the card
function watchPointer(e: PointerEvent): void {
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest('.codex-limits, .codex-resets')) clearTimeout(hideTimer);
  else if (pop) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePop, 200);
  }
}

function drawPop(redraw: () => void): void {
  if (!pop || !anchor) return;
  const r = limits?.codex.resets;
  if (!hasResets() || !r || !anchor.isConnected) return hidePop();
  const next = r.credits[0];
  mount(
    pop,
    h('span', { class: 'font-sans text-[12px] font-semibold text-ink' }, `${r.available} rate-limit reset${r.available === 1 ? '' : 's'} available`),
    next?.expiresAt ? h('span', { class: 'text-[11px] text-faint', title: `Runs out ${when(next.expiresAt)}` }, `Next expires in ${timeUntil(next.expiresAt)}`) : null,
    h('button', { class: 'btn ghost tiny mt-1.5 self-start', disabled: resetting, onclick: () => void useReset(redraw) }, resetting ? 'Resetting…' : 'Reset now'),
  );
  // beside the sidebar, level with Codex, kept on screen (positions are in screen pixels, the page may be zoomed)
  const z = uiZoom();
  const a = anchor.getBoundingClientRect();
  const side = anchor.closest('aside')?.getBoundingClientRect().right ?? a.right;
  pop.style.left = `${(side + 8) / z}px`;
  pop.style.top = `${Math.max(8, Math.min(a.top / z, window.innerHeight / z - pop.offsetHeight - 8))}px`;
}

function showPop(el: HTMLElement, redraw: () => void): void {
  clearTimeout(hideTimer);
  anchor = el;
  if (!hasResets()) return;
  if (!pop) {
    pop = h('div', { class: POP, role: 'dialog', 'aria-label': 'Codex limit resets' });
    document.body.append(pop);
    document.addEventListener('pointermove', watchPointer);
  }
  drawPop(redraw);
}
/** The usage view's lines. redraw: draw the sidebar again (after a read or a reset). */
export function navLimits(redraw: () => void): HTMLElement[] {
  load(redraw);
  const S = (q: string) => `#/settings?${q}`;
  const cc: ProviderLimits = limits?.claude || { ready: !!state.data?.engines?.['claude-code']?.installed, windows: [] };
  const cx = limits?.codex || { ready: !!state.data?.engines?.codex?.loggedIn, windows: [], resets: null };
  const plan = (p: string | null | undefined) => (p ? p.replace(/lite$/i, ' lite').replace(/^./, (c) => c.toUpperCase()) : '');
  const codex: HTMLElement = h(
    'div',
    { class: 'codex-limits flex flex-col', onmouseenter: () => showPop(codex, redraw), onfocusin: () => showPop(codex, redraw) },
    head('Codex', 'openai', '#e6e8e0', cx, S('tab=general&find=OpenAI Codex'), cx.ready ? (cx.blocked ? 'limit reached' : plan(cx.plan)) : cx.why || ''),
    windowsOf(cx),
  );
  // the sidebar was drawn again under an open card: keep it next to the new rows
  if (pop) {
    anchor = codex;
    queueMicrotask(() => drawPop(redraw));
  }
  return [
    head('Claude', 'claude', undefined, cc, S('tab=general&find=Claude Code'), cc.ready ? '' : cc.why || ''),
    ...windowsOf(cc),
    h('div', { class: 'h-1.5' }),
    codex,
  ];
}

/** The Status / Limits switch at the top of the sidebar's list. */
export function panelSwitch(redraw: () => void): HTMLElement {
  const now = sidebarPanel();
  const tab = (p: SidebarPanel, label: string, title: string) =>
    h(
      'button',
      { type: 'button', class: `sidebar-panel-tab relative cursor-pointer border-0 bg-transparent p-0 font-mono text-[9.5px] tracking-[0.14em] uppercase transition-colors duration-200 ${now === p ? 'on text-accent' : 'text-faint hover:text-ink'}`, title, 'aria-pressed': String(now === p), onclick: () => now !== p && setSidebarPanel(p, redraw) },
      label,
      // the line under the tab that's on (it glides to the other tab on a switch)
      now === p ? h('span.sidebar-panel-mark', { class: 'pointer-events-none absolute -bottom-1 left-0 h-px w-full bg-accent', 'aria-hidden': 'true' }) : null,
    );
  return h('div', { class: 'mb-1 flex items-center gap-3' }, tab('status', 'Status', "What's set up"), tab('limits', 'Limits', 'How much of your Claude and Codex plans is used'));
}
