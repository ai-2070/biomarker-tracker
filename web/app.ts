// App shell: navigation, routing, the "Needs you" drawer and live notifications.
import { h, mount, clear, freshElement, state, onState, onEvent, refreshState, refreshSoon, connectEvents, toast, navigate, approvalCard, ago, GET } from './core.ts';
import * as home from './views/home.tsx';
import * as station from './views/station.ts';
import * as artifactsView from './views/artifacts.tsx';
import * as agents from './views/agents.tsx';
import * as chat from './views/chat.tsx';
import * as library from './views/library.tsx';
import * as workflows from './views/workflows.tsx';
import * as programs from './views/programs.tsx';
import * as mcp from './views/mcp.tsx';
import * as connections from './views/connections.tsx';
import * as outboxView from './views/outbox.tsx';
import * as terminals from './views/terminals.tsx';
import * as setup from './views/setup.tsx';
import * as skillsView from './views/skills.tsx';
import * as routinesView from './views/routines.tsx';
import { initDock } from './dock.tsx';
import { mountDrawerQuestions } from './questions.tsx';
import { guardPageDrops } from './attach.ts';
import { applyLook, applySavedLook } from './look.ts';
import { navLimits, panelSwitch, sidebarPanel } from './navlimits.ts';

applySavedLook();
import { icon, logo } from './icons.ts';
import { REPO } from '../shared/about.ts';
import { openProjectMenu, openLauncher } from './projects.ts';
import { projectMark } from './projectlogo.ts';
import type { AboutInfo, AppState, EngineStatus, RunEvent, ServerEvent } from '../shared/types.ts';

/** What a view gets as its third render() argument. */
export interface ViewContext {
  setTitle: (t: string) => void;
}
/** A page module in web/views/: render() draws it into the view element; the rest is optional.
 *  (Methods, so a view may take fewer or narrower arguments.) */
export interface View {
  render(el: HTMLElement, params: string[], ctx: ViewContext): unknown;
  unmount?(): unknown;
  onEvent?(ev: ServerEvent): unknown;
  title?(params: string[]): string | null | undefined;
  /** no padding around the page */
  flush?: boolean;
  /** the Station: full-screen map, folded sidebar */
  station?: boolean;
}
interface Route {
  path: string;
  label: string;
  view: View;
}
interface NavLink extends Route {
  ico: string;
  count?: () => number | undefined;
}

// The menu stays short. Other pages still open from links (branch editor, terminals, overview).
const NAV: NavLink[] = [
  { path: 'station', label: 'Station', ico: 'orbit', view: station },
  { path: 'outbox', label: 'Outbox', ico: 'send', view: outboxView, count: () => (state.data?.outboxPending || 0) + (state.data?.questions?.length || 0) },
  { path: 'artifacts', label: 'Artifacts', ico: 'archive', view: artifactsView },
  // how many agents this project has
  { path: 'agents', label: 'Agents', ico: 'bot', view: agents, count: () => state.data?.agents?.length || 0 },
  { path: 'library', label: 'Agent library', ico: 'library-big', view: library },
  { path: 'skills', label: 'Skills', ico: 'puzzle', view: skillsView },
  { path: 'routines', label: 'Routines', ico: 'repeat', view: routinesView },
  { path: 'settings', label: 'Settings', ico: 'settings', view: setup },
];
const HIDDEN: Route[] = [
  { path: 'home', label: 'Overview', view: home },
  { path: 'workflows', label: 'Team editor', view: workflows },
  { path: 'programs', label: 'Programs', view: programs },
  { path: 'mcp', label: 'MCP servers', view: mcp },
  { path: 'connections', label: 'Connections', view: connections },
  { path: 'tools', label: 'Settings', view: setup },
  { path: 'terminals', label: 'Terminals', view: terminals },
];

// The page's box: padded, or flush to the edges (view.flush). Every page fades or rises in.
const VIEW_PADDED = 'min-w-0 px-7 pt-6.5 pb-15 *:animate-rise-in max-md:px-4 max-md:pt-4.5 max-md:pb-12.5';
const VIEW_FLUSH = 'min-w-0 *:animate-[fade_0.35s_ease-out]';

// The sidebar's links. On the Station (body.station-mode) the bar folds to its icons: on a wide screen it is
// clipped to the icon strip and its text fades in when it opens (body.nav-wide); on a narrow one a hovered
// icon shows its name beside it.
const NAV_LINK =
  'group flex items-center gap-3 border-l-2 px-5 py-3 font-mono text-[12px] leading-[1.2] font-medium tracking-[0.14em] uppercase [transition:transform_0.18s_var(--ease-soft),background-color_0.18s,border-color_0.18s,color_0.18s,box-shadow_0.2s,opacity_0.2s] in-[.station-mode]:relative max-md:in-[.station-mode]:justify-center max-md:in-[.station-mode]:px-0 max-md:in-[.station-mode.nav-wide]:justify-start max-md:in-[.station-mode.nav-wide]:px-5 md:in-[.station-mode]:justify-start md:in-[.station-mode]:pr-0 md:in-[.station-mode]:pl-4.75';
const NAV_LINK_OFF = 'border-l-transparent text-dim hover:bg-panel-2 hover:text-ink';
const NAV_LINK_ON = 'border-l-accent bg-panel-2 text-accent';
const NAV_ICO = 'grid w-5 place-items-center text-center text-[14px] tracking-[0] in-[.station-mode]:text-[15px] in-[.station-mode]:group-hover:text-accent';
const NAV_TXT =
  'in-[.station-mode]:[display:none] in-[.station-mode]:group-hover:absolute in-[.station-mode]:group-hover:left-[58px] in-[.station-mode]:group-hover:z-90 in-[.station-mode]:group-hover:block in-[.station-mode]:group-hover:border in-[.station-mode]:group-hover:border-line-2 in-[.station-mode]:group-hover:bg-panel-2 in-[.station-mode]:group-hover:px-2.5 in-[.station-mode]:group-hover:py-1.5 in-[.station-mode]:group-hover:whitespace-nowrap in-[.station-mode]:group-hover:text-ink in-[.station-mode.nav-wide]:inline in-[.station-mode.nav-wide]:group-hover:static in-[.station-mode.nav-wide]:group-hover:border-0 in-[.station-mode.nav-wide]:group-hover:bg-transparent in-[.station-mode.nav-wide]:group-hover:p-0 in-[.station-mode.nav-wide]:group-hover:text-inherit md:in-[.station-mode]:inline md:in-[.station-mode]:whitespace-nowrap md:in-[.station-mode]:opacity-0 md:in-[.station-mode]:[transition:opacity_0.2s_ease] md:in-[.station-mode]:group-hover:static md:in-[.station-mode]:group-hover:border-0 md:in-[.station-mode]:group-hover:bg-transparent md:in-[.station-mode]:group-hover:p-0 md:in-[.station-mode]:group-hover:text-inherit md:in-[.station-mode.nav-wide]:opacity-100 md:in-[.station-mode.nav-wide]:[transition:opacity_0.3s_ease_0.15s]';
const NAV_COUNT =
  'ml-auto in-[.station-mode]:[display:none] in-[.station-mode.nav-wide]:inline-grid md:in-[.station-mode]:inline md:in-[.station-mode]:whitespace-nowrap md:in-[.station-mode]:opacity-0 md:in-[.station-mode]:[transition:opacity_0.2s_ease] md:in-[.station-mode.nav-wide]:inline-grid md:in-[.station-mode.nav-wide]:opacity-100 md:in-[.station-mode.nav-wide]:[transition:opacity_0.3s_ease_0.15s]';
// a line of the status list at the bottom left
const NS_LINE = '-mx-1.5 flex items-center gap-1.75 rounded-[6px] px-1.5 py-0.75 text-[11.5px] text-dim no-underline [transition:background_0.15s,color_0.15s] hover:bg-accent/12 hover:text-ink';

let viewEl = document.getElementById('view')!;
const titleEl = document.getElementById('page-title')!;
let current: { view: View; params: string[] } | null = null;

function renderNav() {
  const route = (location.hash.replace(/^#\/?/, '').split('/')[0] || 'station').split('?')[0];
  mount(
    document.getElementById('nav-links')!,
    NAV.map((n) => {
      const c = n.count?.();
      return h('a', { class: `${NAV_LINK} ${route === n.path ? NAV_LINK_ON : NAV_LINK_OFF}`, href: `#/${n.path}`, onclick: () => document.body.classList.remove('nav-open') }, h('span', { class: NAV_ICO }, icon(n.ico, 18)), h('span', { class: NAV_TXT }, n.label), c ? h('span.badge', { class: NAV_COUNT }, String(c)) : null);
    }),
  );
  const d = state.data;
  if (d) {
    // the status list, or (Status / Limits switch) your Claude and Codex usage limits
    mount(document.getElementById('nav-status')!, panelSwitch(renderNav), sidebarPanel() === 'limits' ? navLimits(renderNav) : navStatus(d));
  }
  // the version is asked for once (no GitHub call here: the star count is only fetched in Settings > About)
  if (!aboutAsked) {
    aboutAsked = true;
    void GET<AboutInfo>('/about').then((a) => ((about = a), renderNav()), () => {});
  }
  mount(document.getElementById('nav-about')!, navAbout());
}

let about: AboutInfo | null = null;
let aboutAsked = false;
// Bottom of the sidebar: the version (opens Settings > About) and a link to star Blacksite on GitHub.
const NAV_VER = 'flex min-w-0 items-baseline gap-1.5 -ml-1.5 rounded-[6px] px-1.5 py-0.75 font-sans text-[11.5px] leading-[1.3] font-semibold text-dim [transition:background_0.15s,color_0.15s] hover:bg-accent/12 hover:text-ink';
const NAV_STAR = 'inline-flex h-5.5 flex-none items-center gap-1.25 rounded-ctl border border-line-2 px-2 font-mono text-[10px] leading-none font-medium tracking-[0.08em] uppercase text-ink [transition:border-color_0.15s,color_0.15s] hover:border-accent hover:text-accent [&_svg]:flex-none';
function navAbout() {
  return [
    h('a', { class: NAV_VER, href: '#/settings?tab=about', title: 'About Blacksite', onclick: () => document.body.classList.remove('nav-open') }, h('span', REPO.name), about ? h('span', { class: 'font-mono text-[10.5px] leading-[1.3] font-normal text-faint tabular-nums' }, `v${about.version}`) : null),
    h('a', { class: NAV_STAR, href: REPO.url, target: '_blank', rel: 'noopener', title: `${REPO.slug} on GitHub: star it there` }, logo('github', 12, '#e6e8e0'), h('span', 'Star')),
  ];
}

// The status list at the bottom left. Every line opens the matching setting.
function navStatus(d: AppState) {
  const e: Partial<EngineStatus> = d.engines;
  const S = (q: string) => `#/settings?${q}`;
  const ver = (v: string | null | undefined) => (v ? String(v).split(/\s/)[0] : '');
  const line = (dot: string, label: string, value: string, href: string, title?: string) =>
    h('a', { class: NS_LINE, href, title: title || label, onclick: () => document.body.classList.remove('nav-open') }, h('span', { class: `dot ${dot}` }), h('span', { class: 'min-w-0 flex-1 truncate' }, label), value ? h('span', { class: 'text-[10.5px] whitespace-nowrap text-faint' }, value) : null);
  const cc: Partial<EngineStatus['claude-code']> = e['claude-code'] || {};
  const cx: Partial<EngineStatus['codex']> = e.codex || {};
  const acc: Partial<AppState['accounts']> = d.accounts || {};
  const x = acc.x || [];
  const rd = acc.reddit || [];
  const b = d.settings?.brain || { provider: 'claude', model: 'haiku' };
  const brainName = String(b.model || 'haiku').replace(/^anthropic\/claude-/, '').replace(/^./, (c) => c.toUpperCase());
  const lines = [
    line(cc.installed ? (cc.loggedIn ? 'on' : 'warn') : '', 'Claude Code', cc.installed ? (cc.loggedIn ? ver(cc.version) || 'ready' : 'not signed in') : 'not found', S('tab=general&find=Claude Code')),
    line(cx.installed ? (cx.loggedIn ? 'on' : 'warn') : '', 'Codex', cx.installed ? (cx.loggedIn ? ver(cx.version) || 'ready' : 'sign in') : 'not installed', S('tab=general&find=OpenAI Codex')),
    line(e.hermes?.installed ? 'on' : '', 'Hermes', e.hermes?.installed ? 'found' : 'not found', S('tab=general&find=Hermes')),
    // always listed, like the Station's engine tiles: grey with a link to how to install until found
    line(e.pi?.installed ? 'on' : '', 'pi coding agent', e.pi?.installed ? ver(e.pi.version) || 'found' : 'not installed', S('tab=general&find=pi coding agent')),
    line(e.omp?.installed ? 'on' : '', 'oh-my-pi', e.omp?.installed ? ver(e.omp.version) || 'found' : 'not installed', S('tab=general&find=oh-my-pi')),
    line(e.openclaw?.installed ? 'on' : '', 'OpenClaw', e.openclaw?.installed ? ver(e.openclaw.version) || 'found' : 'not installed', S('tab=general&find=OpenClaw')),
    line(e.openai?.openrouter ? 'on' : '', 'OpenRouter', e.openai?.openrouter ? 'key set' : 'no key', S('tab=general&find=OpenRouter key')),
    line('on', 'Brain', `${brainName}${b.provider === 'openrouter' ? ' · OR' : ''}`, S("tab=general&find=The Brain's model"), "The Brain's model"),
    line(x.length ? 'on' : '', 'X', x.length ? (x.length === 1 ? `@${x[0].username}` : `${x.length} accounts`) : 'not connected', S('tab=connections&sub=accounts&find=X accounts')),
    line(rd.length ? 'on' : '', 'Reddit', rd.length ? (rd.length === 1 ? `u/${rd[0].username}` : `${rd.length} accounts`) : 'not connected', S('tab=connections&sub=accounts&find=Reddit accounts')),
    line(acc.telegram?.configured ? 'on' : '', 'Telegram', acc.telegram?.configured ? 'ready' : 'off', S('tab=connections&sub=accounts&find=Telegram')),
    line(acc.discord?.configured ? 'on' : '', 'Discord', acc.discord?.configured ? 'ready' : 'off', S('tab=connections&sub=accounts&find=Discord')),
    line((d.mcpServers || []).length ? 'on' : '', 'MCP servers', String((d.mcpServers || []).length), S('tab=mcp&find=Your MCP servers')),
    d.outboxPending || d.questions?.length ? line('busy', 'Outbox', `${d.outboxPending + (d.questions?.length || 0)} waiting`, '#/outbox') : null,
  ];
  const sv = d.projectSaved;
  const savedLine = sv ? (sv.error ? `not saved: ${sv.error}` : `auto-saved ${ago(sv.at)}`) : 'auto-save on';
  const foot = 'min-w-0 flex-1 truncate text-faint';
  return [...lines, h('a', { class: NS_LINE, href: S('tab=about&find=This PC'), title: `Agents, teams and chats are saved into the project folder (.dashboard) after every change.\n${d.project?.brainPath || ''}` }, h('span', { class: foot }, `${d.project?.name || 'Project'} · ${savedLine}`)), h('a', { class: NS_LINE, href: S('tab=about&find=This PC'), title: 'Address' }, h('span', { class: foot }, `localhost:${d.port} · no login`))];
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const top = parts[0] || 'station';
  let view: View;
  let params = parts.slice(1);
  if (top === 'agents' && params[0] && params[1] !== 'edit') view = chat;
  else view = [...NAV, ...HIDDEN].find((n) => n.path === top)?.view || station;
  if (current?.view?.unmount) current.view.unmount();
  const here = (current = { view, params });
  // Each page gets its own element: one still loading when you leave draws into the old one, unseen.
  const el = (viewEl = freshElement(viewEl));
  el.className = view.flush ? VIEW_FLUSH : VIEW_PADDED;
  document.body.classList.toggle('station-mode', !!view.station);
  document.body.classList.remove('nav-wide');
  // a full chat page has its own message box
  document.body.classList.toggle('in-chat', view === chat);
  titleEl.textContent = view.title?.(params) || [...NAV, ...HIDDEN].find((n) => n.path === top)?.label || '';
  renderNav();
  try {
    await view.render(el, params, { setTitle: (t) => current === here && (titleEl.textContent = t) });
  } catch (e) {
    console.error(e);
    if (current === here) mount(el, h('div.panel', h('p', { class: 'text-red' }, `Something went wrong: ${(e as Error).message}`)));
  }
}

// ---------- Needs you ----------
const drawer = document.getElementById('drawer')!;
const drawerBody = document.getElementById('drawer-body')!;
let seenApprovals = new Set<string>();
let seenQuestions: Set<string> | null = null;
// Questions are React cards (choices to click, a box to answer): one place kept across redraws, so typing isn't lost.
let questionsHost: HTMLElement | null = null;
// Cards are kept while their approval is unchanged, so a typed note or edit survives other refreshes.
let drawnApprovals = '';
let approvalCards = new Map<string, { key: string; el: HTMLElement }>();

function renderApprovals() {
  const list = state.data?.approvals || [];
  const asked = state.data?.questions || [];
  const n = list.length + (state.data?.outboxPending || 0) + asked.length;
  const count = document.getElementById('needs-count')!;
  count.textContent = String(n);
  count.classList.toggle('hot', n > 0);
  const drawn = JSON.stringify([list, state.data?.outboxPending || 0, asked.map((q) => q.id)]);
  if (drawn === drawnApprovals) return;
  drawnApprovals = drawn;
  approvalCards = new Map(
    list.map((a) => {
      const key = JSON.stringify(a);
      const old = approvalCards.get(a.id);
      return [a.id, old?.key === key ? old : { key, el: approvalCard(a) }];
    }),
  );
  clear(drawerBody);
  const toOutbox = () => (navigate('#/outbox'), drawer.classList.add('hidden'));
  if (asked.length) {
    if (!questionsHost) {
      questionsHost = h('div', { class: 'flex flex-col gap-3' });
      mountDrawerQuestions(questionsHost);
    }
    drawerBody.append(questionsHost);
  }
  if (state.data?.outboxPending) {
    drawerBody.append(
      h('div.approval', h('div.t', `${state.data.outboxPending} post${state.data.outboxPending > 1 ? 's' : ''} waiting in the Outbox`), h('button.btn.small', { onclick: toOutbox }, 'Review posts')),
    );
  }
  for (const c of approvalCards.values()) drawerBody.append(c.el);
  if (!n) drawerBody.append(h('p.empty', 'Nothing needs you right now.'));
  // Open the drawer when something new arrives.
  const fresh = list.filter((a) => !seenApprovals.has(a.id));
  if (fresh.length) {
    drawer.classList.remove('hidden');
    toast(fresh[0].title, 'warn');
  }
  seenApprovals = new Set(list.map((a) => a.id));
  // a new question from an agent: say so (not for the ones already there when the page opened)
  const newQ = seenQuestions ? asked.filter((q) => !seenQuestions!.has(q.id)) : [];
  if (newQ.length && !fresh.length) {
    if (!location.hash.startsWith('#/outbox')) drawer.classList.remove('hidden');
    toast(`${newQ[0].agentName || 'An agent'} asks: ${newQ[0].question}`, 'warn');
  }
  seenQuestions = new Set(asked.map((q) => q.id));
}

function renderRunning() {
  const pill = document.getElementById('running-pill')!;
  const runs = state.data?.runs || [];
  pill.classList.toggle('hidden', !runs.length);
  mount(pill, h('span.dot.busy'), runs.length === 1 ? `${runs[0].agentName} working` : `${runs.length} agents working`);
  pill.className = `pill warn${runs.length ? '' : ' hidden'}`;
}

document.getElementById('needs-btn')!.onclick = () => drawer.classList.toggle('hidden');
// project switcher in the top bar (pages other than the Station)
const projBtn = h('button.btn.ghost.small', { class: 'gap-1.5 [&_.proj-logo]:mr-0.5', onclick: (e) => openProjectMenu(e.currentTarget) });
document.querySelector('.top-actions')!.prepend(projBtn);
onState((d) => mount(projBtn, projectMark(d.project, 15), d.project?.name || 'Project', icon('chevron-down', 13)));
document.getElementById('drawer-close')!.onclick = () => drawer.classList.add('hidden');
document.getElementById('nav-toggle')!.onclick = () => document.body.classList.toggle('nav-open');
document.getElementById('running-pill')!.onclick = () => {
  const r = state.data?.runs?.[0];
  if (r) navigate(`#/agents/${r.agentId}/${r.chatId}`);
};

onState(() => {
  renderNav();
  renderApprovals();
  renderRunning();
});
// the usage limits count down, and are read again now and then while they're shown
setInterval(() => sidebarPanel() === 'limits' && !document.hidden && renderNav(), 20_000);

const STATE_EVENTS = new Set(['agents', 'approvals', 'outbox', 'questions', 'runs', 'settings', 'accounts', 'terminals', 'mcp', 'project', 'project-logo', 'projects', 'engines']);
onEvent((ev) => {
  if (STATE_EVENTS.has(ev.type)) refreshSoon();
  if (ev.type === 'toast') toast(ev.text as string);
  if (ev.type === 'world-look') void station.answerLook(ev);
  if (ev.type === 'run' && (ev.event as RunEvent).kind === 'done' && !location.hash.includes(ev.chatId as string)) {
    const a = state.data?.agents?.find((x) => x.id === ev.agentId);
    if (a) toast(`${a.emoji || ''} ${a.name} finished`);
  }
  current?.view?.onEvent?.(ev);
});

window.addEventListener('hashchange', route);
// files dropped where nothing takes them must not open in the tab (from the start, not once the state loads)
guardPageDrops();
await refreshState();
if (state.data?.settings?.look) applyLook(state.data.settings.look);
connectEvents();
initDock();
openLauncher();
// Esc: whatever is open closes first (dialogs, menus, the Brain chat, Station panels handle it
// themselves). With nothing open, Esc opens the big sidebar, and Esc again closes it.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // let the open thing take it first, then decide
  setTimeout(() => {
    if (e.defaultPrevented) return;
    const pop = document.querySelector('.model-menu, .proj-menu');
    if (pop) return pop.remove();
    const target = e.target as HTMLElement;
    if (target.closest?.('input, textarea, select')) return target.blur();
    const body = document.body;
    if (body.classList.contains('nav-open')) return body.classList.remove('nav-open'); // phone menu
    if (body.classList.contains('nav-wide')) return body.classList.remove('nav-wide');
    if (body.classList.contains('station-mode')) body.classList.add('nav-wide');
  }, 0);
});
// Station: the sidebar is a thin icon bar; hovering it opens it to full width, leaving folds it back.
{
  const edge = document.createElement('div');
  edge.id = 'nav-edge';
  edge.className = 'md:hidden';
  edge.title = 'Menu';
  document.body.append(edge);
  const nav = document.getElementById('nav')!;
  let byHover = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  const open = () => {
    clearTimeout(closeTimer);
    if (!document.body.classList.contains('nav-wide')) {
      byHover = true;
      document.body.classList.add('nav-wide');
    }
  };
  edge.addEventListener('mouseenter', open);
  // hovering the icon bar opens it (only on the Station, where it is folded)
  nav.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
    if (document.body.classList.contains('station-mode')) open();
  });
  nav.addEventListener('mouseleave', () => {
    // opened by Esc: stays until Esc or a click elsewhere
    if (!byHover) return;
    closeTimer = setTimeout(() => {
      document.body.classList.remove('nav-wide');
      byHover = false;
    }, 350);
  });
  new MutationObserver(() => {
    if (!document.body.classList.contains('nav-wide')) byHover = false;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
// the big sidebar closes when you click anywhere else
document.addEventListener('pointerdown', (e) => {
  if (document.body.classList.contains('nav-wide') && !(e.target as Element).closest('#nav')) document.body.classList.remove('nav-wide');
}, true);
route();
