// The chat window: one floating window over the map with a tab for every conversation you open
// (team group chats and agents). Drag it by its title bar, resize it from any edge or corner,
// minimize it to a pill or maximize it. Size, place and open tabs are remembered in this browser.
// The window is React (Base UI tabs); each tab's conversation is made directly (renderTeamChat,
// renderAgentChat) so openChat() can hand its api back at once, and the window puts it in place.
import { StrictMode, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Tabs } from '@base-ui/react/tabs';
import { state, onState, GET } from './core.ts';
import { renderTeamChat } from './teamchat.tsx';
import { renderAgentChat } from './agentchat.tsx';
import { uiZoom } from './look.ts';
import { flipFrom, flipTo, slideIn, reducedMotion } from './motion.ts';
import { Avatar, Icon, useAppState } from './ui/react.tsx';
import type { TeamListing } from '../shared/types.ts';

declare global {
  interface Window {
    /** The Station's teams (it sets this on every load); the chat window reads names and colors from it. */
    __teams?: TeamListing[];
    /** Team id → ids of the members working right now (set by the Station). */
    __teamWorking?: Record<string, string[]>;
  }
}

export type ChatKind = 'team' | 'agent';
/** A tab's chat: focus it, @mention someone (team chats only), and tear it down. */
export interface ChatTabApi {
  focus: () => void;
  mention?: (name: string) => void;
  destroy: () => void;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface ChatTab {
  key: string;
  kind: ChatKind;
  id: string;
  /** the conversation's own element, made outside React and put in the window's body */
  body: HTMLDivElement;
  api: ChatTabApi;
}
/** What is remembered in localStorage. */
interface SavedWindow {
  rect?: Rect | null;
  tabs?: string[];
  active?: string | null;
  min?: boolean;
  max?: boolean;
}

const KEY = 'dash-chatwin';
const W = { tabs: [] as ChatTab[], active: null as string | null, min: false, max: false, rect: null as Rect | null };

const load = (): SavedWindow => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null') || {};
  } catch {
    return {};
  }
};
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ rect: W.rect, tabs: W.tabs.map((t) => t.key), active: W.active, min: W.min, max: W.max }));
  } catch {
    /* private window */
  }
};

const agentOf = (id: string) => state.data?.agents.find((a) => a.id === id);

// ---------- the window's state, outside React ----------
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
const snapshot = () => version;
/** Draws the window again, at once (callers then animate or focus what was drawn). */
function changed(): void {
  version++;
  if (host) flushSync(() => listeners.forEach((fn) => fn()));
}

let host: { root: Root; el: HTMLElement; win: { current: HTMLDivElement | null }; body: { current: HTMLDivElement | null }; pill: { current: HTMLButtonElement | null } } | null = null;

function ensure(): void {
  if (host?.el.isConnected) return;
  const saved = load();
  const z = uiZoom();
  const vw = window.innerWidth / z;
  const vh = window.innerHeight / z;
  // first time: on the left, so the middle of the map stays free (the info panel is on the right)
  W.rect = saved.rect || { x: 74, y: 64, w: Math.min(600, vw * 0.4), h: Math.max(360, vh - 150) };
  W.min = !!saved.min;
  W.max = !!saved.max;
  W.tabs = [];
  W.active = null;
  const el = document.createElement('div');
  el.style.display = 'contents';
  document.body.append(el);
  host = { root: createRoot(el), el, win: { current: null }, body: { current: null }, pill: { current: null } };
  const h = host;
  flushSync(() => h.root.render(<StrictMode><ChatWindow refs={h} /></StrictMode>));
  // also drops the tab of an agent that was deleted
  onState(() => W.tabs.length && refreshChatTabs());
  if (!window.__teams) GET<TeamListing[]>('/workflows').then((w) => ((window.__teams ||= w), changed())).catch(() => {});
}

// The smallest the window gets: 380 × 300, or less on a screen too small for that.
function minSize() {
  const z = uiZoom();
  return { w: Math.min(380, window.innerWidth / z - 20), h: Math.min(300, window.innerHeight / z - 20) };
}

/** Where the window goes: its rect kept inside the screen, or the screen less a margin when maximized. */
function placement(): CSSProperties {
  const z = uiZoom();
  const vw = window.innerWidth / z;
  const vh = window.innerHeight / z;
  const r = W.rect!;
  const min = minSize();
  r.w = Math.max(min.w, Math.min(r.w, vw - 20));
  r.h = Math.max(min.h, Math.min(r.h, vh - 20));
  r.x = Math.max(4, Math.min(r.x, vw - 120));
  r.y = Math.max(4, Math.min(r.y, vh - 48));
  return W.max ? { left: '70px', top: '64px', width: `${vw - 90}px`, height: `${vh - 84}px` } : { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` };
}

/** Follows the pointer until it is let go, then remembers where the window is. */
function track(onMove: (dx: number, dy: number) => void, e: ReactPointerEvent) {
  const z = uiZoom();
  const sx = e.clientX;
  const sy = e.clientY;
  const win = host!.win.current!;
  win.classList.add('moving');
  const move = (ev: PointerEvent) => {
    onMove((ev.clientX - sx) / z, (ev.clientY - sy) / z);
    changed();
  };
  const up = () => {
    win.classList.remove('moving');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    save();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function startDrag(e: ReactPointerEvent) {
  if (e.button !== 0 || (e.target as Element).closest('button, .cw-tab') || W.max) return;
  e.preventDefault();
  const { x, y } = W.rect!;
  track((dx, dy) => ((W.rect!.x = x + dx), (W.rect!.y = y + dy)), e);
}

function startResize(e: ReactPointerEvent, dir: string) {
  if (W.max) return;
  e.preventDefault();
  e.stopPropagation();
  const r0 = { ...W.rect! };
  const min = minSize();
  track((dx, dy) => {
    const r = { ...r0 };
    if (dir.includes('e')) r.w = r0.w + dx;
    if (dir.includes('s')) r.h = r0.h + dy;
    if (dir.includes('w')) {
      r.w = Math.max(min.w, r0.w - dx);
      r.x = r0.x + (r0.w - r.w);
    }
    if (dir.includes('n')) {
      r.h = Math.max(min.h, r0.h - dy);
      r.y = r0.y + (r0.h - r.h);
    }
    W.rect = r;
  }, e);
}

// Minimize: the window shrinks into its pill. Open again: it grows back out of the pill.
let minimizing: Promise<void> | null = null;
/** While the window shrinks into the pill, both are drawn (the pill unseen, to know where to go). */
let shrinking = false;
function setMin(v: boolean) {
  if (v === W.min && !minimizing) return;
  W.min = v;
  save();
  const el = host!.win.current!;
  if (v) {
    shrinking = true;
    changed();
    const pill = host!.pill.current!;
    const to = pill.getBoundingClientRect();
    const done = (minimizing = flipTo(el, to, { duration: 320 }).then(() => {
      if (minimizing !== done) return;
      minimizing = null;
      shrinking = false;
      changed();
      slideIn(host!.pill.current!, { scale: 0.7, duration: 320 });
    }));
    return;
  }
  minimizing = null;
  shrinking = false;
  el.getAnimations().forEach((a) => a.cancel());
  const from = host!.pill.current?.getBoundingClientRect();
  changed();
  if (from?.width) flipFrom(el, from, { duration: 420, fade: true });
}
// Maximize / restore: the window glides from its old size to the new one.
function setMax(v: boolean) {
  const el = host!.win.current!;
  const from = el.getBoundingClientRect();
  W.max = v;
  W.min = false;
  save();
  changed();
  if (from.width && !reducedMotion()) flipFrom(el, from, { duration: 380 });
}

/** A little pop when the window appears. */
function pop() {
  const el = host?.win.current;
  if (!el || el.classList.contains('hidden')) return;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

function activate(key: string, focus = true) {
  const t = W.tabs.find((x) => x.key === key);
  if (!t) return;
  W.active = key;
  for (const x of W.tabs) x.body.classList.toggle('hidden', x.key !== key);
  save();
  changed();
  if (focus) setTimeout(() => t.api?.focus?.(), 30);
}

function makeTab(kind: ChatKind, id: string): ChatTab {
  const key = `${kind}:${id}`;
  const body = document.createElement('div');
  body.className = 'cw-pane absolute inset-0 flex flex-col pt-2.5 px-3 pb-3 *:flex-1 *:min-h-0 hidden';
  host!.body.current!.append(body);
  const api: ChatTabApi = kind === 'team' ? renderTeamChat(body, id, { fill: true }) : renderAgentChat(body, id);
  const t: ChatTab = { key, kind, id, body, api };
  W.tabs.push(t);
  return t;
}

function closeTab(key: string) {
  const i = W.tabs.findIndex((x) => x.key === key);
  if (i < 0) return;
  const [t] = W.tabs.splice(i, 1);
  t.api?.destroy?.();
  t.body.remove();
  if (W.active === key) W.active = W.tabs[Math.min(i, W.tabs.length - 1)]?.key || null;
  if (W.active) activate(W.active);
  save();
  changed();
}

function closeAll() {
  for (const t of [...W.tabs]) closeTab(t.key);
}

// ---------- the window ----------
// The resize grips sit just outside the rounded edge, so they can be grabbed.
const GRIPS: Record<string, string> = {
  n: 'absolute z-2 left-2.5 right-2.5 h-1.5 cursor-ns-resize -top-0.75',
  s: 'absolute z-2 left-2.5 right-2.5 h-1.5 cursor-ns-resize -bottom-0.75',
  e: 'absolute z-2 top-2.5 bottom-2.5 w-1.5 cursor-ew-resize -right-0.75',
  w: 'absolute z-2 top-2.5 bottom-2.5 w-1.5 cursor-ew-resize -left-0.75',
  ne: 'absolute z-2 size-3.5 -top-1 -right-1 cursor-nesw-resize',
  nw: 'absolute z-2 size-3.5 -top-1 -left-1 cursor-nwse-resize',
  // (with the corner lines)
  se: "absolute z-2 size-4.5 -bottom-1.5 -right-1.5 cursor-nwse-resize after:content-[''] after:absolute after:right-2.25 after:bottom-2.25 after:size-2.5 after:bg-[linear-gradient(135deg,transparent_0_48%,var(--color-line-2)_48%_58%,transparent_58%_70%,var(--color-line-2)_70%_80%,transparent_80%)]",
  sw: 'absolute z-2 size-3.5 -bottom-1 -left-1 cursor-nesw-resize',
};
const TAB = 'group/tab flex items-center gap-1.75 pt-1.75 pr-2 pb-2 pl-2.25 max-w-[200px] cursor-pointer flex-none border border-b-0 rounded-t-[9px] text-[12.5px] [transition:background_.15s,color_.15s]';
const BTN = 'size-7 rounded-ctl text-dim cursor-pointer grid place-items-center text-[14px] flex-none mb-1.5 hover:bg-panel-2 hover:text-ink';

function ChatWindow({ refs }: { refs: NonNullable<typeof host> }) {
  useSyncExternalStore(subscribe, snapshot);
  const d = useAppState();
  // the window keeps inside the screen as it changes size
  useEffect(() => {
    const onResize = () => changed();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const winRef = useCallback((el: HTMLDivElement | null) => void (refs.win.current = el), [refs]);
  const bodyRef = useCallback((el: HTMLDivElement | null) => void (refs.body.current = el), [refs]);
  const pillRef = useCallback((el: HTMLButtonElement | null) => void (refs.pill.current = el), [refs]);
  const any = W.tabs.length > 0;
  const teams = window.__teams || [];
  const busyAgents = new Set((d?.runs || []).map((r) => r.agentId));
  // the pill sits next to "Ask the Brain" at the bottom
  const bar = document.querySelector('.bottom-bar') || document.body;
  const pill = (
    <button
      ref={pillRef}
      // (in the bottom bar, next to Ask the Brain, it sits in line there)
      className={`cw-pill fixed z-44 right-[84px] bottom-[22px] flex items-center gap-2 py-2.25 px-3.5 border border-line-2 rounded-full bg-panel text-ink cursor-pointer font-sans text-[12.5px] font-medium leading-[normal] shadow-[0_10px_30px_rgba(0,0,0,.45)] animate-[cw-pop_.25s_ease-out] hover:border-accent in-[.bottom-bar]:relative in-[.bottom-bar]:right-auto in-[.bottom-bar]:bottom-auto in-[.bottom-bar]:z-auto in-[.bottom-bar]:py-2.75 in-[.bottom-bar]:px-4 in-[.bottom-bar]:animate-none in-[.bottom-bar]:hover:[transform:translateY(-2px)] ${any && (W.min || shrinking) ? '' : ' hidden'}`}
      style={shrinking ? { opacity: 0 } : undefined}
      onClick={() => setMin(false)}
      title="Open the chats"
    >
      <Icon name="message-square" size={15} />
      <span>{`${W.tabs.length} chat${W.tabs.length === 1 ? '' : 's'}`}</span>
    </button>
  );
  return (
    <>
      <div
        ref={winRef}
        // pop and moving are set by script (pop(), track())
        className={`cw group/cw fixed z-44 flex flex-col bg-[color-mix(in_srgb,var(--color-panel)_94%,transparent)] backdrop-blur-[14px] border border-line-2 shadow-[0_24px_80px_rgba(0,0,0,.55),0_0_0_1px_rgba(255,255,255,.02)_inset] overflow-visible [&.pop]:animate-[cw-pop_.28s_cubic-bezier(.2,.9,.25,1.05)] [&.moving]:select-none [&.moving]:transition-none ${W.max ? 'rounded-[12px]' : 'rounded-[14px]'}${!any || (W.min && !shrinking) ? ' hidden' : ''}`}
        style={W.rect ? placement() : undefined}
        role="dialog"
        aria-label="Chats"
        aria-modal="false"
      >
        <div
          className={`flex items-center gap-2 pt-1.5 pr-2 pb-0 pl-3 border-b border-line cursor-grab group-[.moving]/cw:cursor-grabbing text-dim min-h-[42px] ${W.max ? 'rounded-t-[12px]' : 'rounded-t-[14px]'}`}
          onPointerDown={startDrag}
          onDoubleClick={(e) => !(e.target as Element).closest('button') && setMax(!W.max)}
        >
          <Icon name="message-square" size={15} />
          <Tabs.Root value={W.active} onValueChange={(v) => activate(String(v))}>
            <Tabs.List className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden self-end min-w-0" aria-label="Open chats">
              {W.tabs.map((t) => {
                let label = '';
                let lead = null;
                let busy = false;
                if (t.kind === 'team') {
                  const w = teams.find((x) => x.id === t.id);
                  label = w?.name || 'Team';
                  lead = (
                    <span className="size-5 rounded-[6px] grid place-items-center bg-[color-mix(in_srgb,var(--c)_30%,#111)] text-white" style={{ '--c': w?.color || '#7350c8' } as CSSProperties}>
                      <Icon name="users" size={11} />
                    </span>
                  );
                  busy = (window.__teamWorking?.[t.id] || []).length > 0;
                } else {
                  const a = agentOf(t.id);
                  label = a?.name || 'Agent';
                  lead = a ? <Avatar agent={a} /> : null;
                  busy = busyAgents.has(t.id);
                }
                const on = t.key === W.active;
                // cw-tab: startDrag() leaves the tabs alone by it
                return (
                  <div
                    key={t.key}
                    className={`cw-tab ${TAB} [&_.avatar]:size-5 [&_.avatar]:text-[11px] ${on ? 'text-ink bg-bg border-line -mb-px' : 'border-transparent text-dim hover:text-ink hover:bg-ink/4'}`}
                    title={label}
                    onAuxClick={(e) => e.button === 1 && closeTab(t.key)}
                  >
                    <Tabs.Tab value={t.key} className="flex items-center gap-1.75 min-w-0 cursor-pointer">
                      {lead}
                      <span className="truncate">{label}</span>
                      {busy ? <span className="dot busy" aria-label="working" /> : null}
                    </Tabs.Tab>
                    <button
                      className={`text-faint cursor-pointer px-0.5 text-[11px] [transition:opacity_.15s] hover:text-ink ${on ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'}`}
                      title="Close" aria-label={`Close ${label}`} onClick={() => closeTab(t.key)}>
                      ✕
                    </button>
                  </div>
                );
              })}
            </Tabs.List>
          </Tabs.Root>
          <span className="flex-1 min-w-0" />
          <button className={BTN} title="Minimize" aria-label="Minimize the chats" onClick={() => setMin(true)}>
            –
          </button>
          <button className={BTN} title="Maximize / restore" aria-label={W.max ? 'Restore the chats' : 'Maximize the chats'} onClick={() => setMax(!W.max)}>
            <Icon name="maximize-2" size={13} />
          </button>
          <button className={BTN} title="Close all chats" aria-label="Close all chats" onClick={closeAll}>
            ✕
          </button>
        </div>
        {/* the conversations' own elements go in here (made outside React) */}
        <div className={`flex-1 min-h-0 relative bg-bg overflow-hidden ${W.max ? 'rounded-b-[12px]' : 'rounded-b-[14px]'}`} ref={bodyRef} />
        {Object.entries(GRIPS).map(([dir, cls]) => (
          <div key={dir} className={W.max ? `${cls} hidden` : cls} aria-hidden="true" onPointerDown={(e) => startResize(e, dir)} />
        ))}
      </div>
      {createPortal(pill, bar)}
    </>
  );
}

// Open (or focus) a chat. kind: 'team' | 'agent'. Returns the tab's chat API (focus, mention).
export function openChat(kind: ChatKind, id: string, { focus = true }: { focus?: boolean } = {}): ChatTabApi {
  ensure();
  const key = `${kind}:${id}`;
  const was = !host!.win.current || host!.win.current.classList.contains('hidden');
  const t = W.tabs.find((x) => x.key === key) || makeTab(kind, id);
  W.min = false;
  activate(t.key, focus);
  if (was) pop();
  return t.api;
}

export function refreshChatTabs(): void {
  if (!host) return;
  // drop tabs whose agent or team is gone
  const teams = window.__teams;
  for (const t of [...W.tabs]) {
    if (t.kind === 'agent' && state.data && !agentOf(t.id)) closeTab(t.key);
    if (t.kind === 'team' && teams && !teams.some((w) => w.id === t.id)) closeTab(t.key);
  }
  changed();
}

// Bring back the tabs that were open last time.
export function restoreChats(): void {
  const saved = load();
  if (!saved.tabs?.length) return;
  ensure();
  for (const key of saved.tabs) {
    const [kind, id] = key.split(':') as [ChatKind, string];
    if (kind === 'agent' && !agentOf(id)) continue;
    if (kind === 'team' && window.__teams && !window.__teams.some((w) => w.id === id)) continue;
    if (!W.tabs.some((x) => x.key === key)) makeTab(kind, id);
  }
  if (!W.tabs.length) return;
  activate(W.tabs.some((x) => x.key === saved.active) ? saved.active! : W.tabs[0].key);
  pop();
}

export function closeChatsForProject(): void {
  if (host) closeAll();
}
