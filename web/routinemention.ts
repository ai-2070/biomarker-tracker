// The "@" menu in a routine's text: type @ (or use the Agent / Team / Skill buttons) and pick who does it
// or which skill to use. Plain DOM on a textarea: the menu follows the caret.
import { h, mount } from './core.ts';
import type { Child } from './core.ts';
import { uiZoom } from './look.ts';
import { mentionQuery } from '../shared/routines.ts';
import type { RoutineMention, RoutineMentionKind } from '../shared/types.ts';

/** Something a routine can mention, as the menu shows it. */
export interface Candidate extends RoutineMention {
  lead: Child;
  sub: string;
  color?: string;
}

export const KIND_LABEL: Record<RoutineMentionKind, string> = { agent: 'Agents', team: 'Teams', skill: 'Skills' };

interface MenuState {
  el: HTMLElement;
  ta: HTMLTextAreaElement;
  start: number;
  kind: RoutineMentionKind | null;
  items: Candidate[];
  active: number;
  onPick: () => void;
  candidates: () => Candidate[];
}
let menu: MenuState | null = null;

export function closeMenu(): void {
  menu?.el.remove();
  menu = null;
}

/** Watches a textarea for "@…" and offers what it can mention. Returns how to stop. */
export function attachMentions(ta: HTMLTextAreaElement, candidates: () => Candidate[], onPick: () => void): () => void {
  const update = () => {
    const q = mentionQuery(ta.value, ta.selectionStart);
    if (!q || ta.selectionStart !== ta.selectionEnd) return closeMenu();
    openMenu(ta, q.start, q.query, menu?.ta === ta && menu.start === q.start ? menu.kind : null, onPick, candidates);
  };
  const blur = () => setTimeout(() => menu?.ta === ta && document.activeElement !== ta && closeMenu(), 150);
  const keydown = (e: KeyboardEvent) => {
    if (!menu || menu.ta !== ta) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = menu.items.length;
      if (n) menu.active = (menu.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      paintActive();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && menu.items.length) {
      e.preventDefault();
      pick(menu.items[menu.active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    }
  };
  ta.addEventListener('input', update);
  ta.addEventListener('click', update);
  ta.addEventListener('blur', blur);
  ta.addEventListener('keydown', keydown);
  return () => {
    ta.removeEventListener('input', update);
    ta.removeEventListener('click', update);
    ta.removeEventListener('blur', blur);
    ta.removeEventListener('keydown', keydown);
    if (menu?.ta === ta) closeMenu();
  };
}

/** The toolbar buttons: put an "@" at the caret and show only that kind. */
/** Puts text in place of start..end, caret after it, and says so the way typing does (so a React page
 *  hears it: its own value setter is skipped, and the event bubbles to where React listens). */
function replaceText(ta: HTMLTextAreaElement, text: string, start: number, end: number): void {
  const value = ta.value.slice(0, start) + text + ta.value.slice(end);
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, value);
  ta.setSelectionRange(start + text.length, start + text.length);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

export function startMention(ta: HTMLTextAreaElement, kind: RoutineMentionKind): void {
  ta.focus();
  const at = ta.selectionStart;
  const before = ta.value.slice(0, at);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  replaceText(ta, `${lead}@`, at, ta.selectionEnd);
  if (menu?.ta === ta) openMenu(ta, menu.start, '', kind, menu.onPick, menu.candidates);
}

function openMenu(ta: HTMLTextAreaElement, start: number, query: string, kind: RoutineMentionKind | null, onPick: () => void, candidates: () => Candidate[]) {
  const q = query.toLowerCase().trim();
  const all = candidates().filter((c) => !kind || c.kind === kind);
  // names that start with what you typed first, then names that contain it
  const items = [...all.filter((c) => c.name.toLowerCase().startsWith(q)), ...all.filter((c) => q && !c.name.toLowerCase().startsWith(q) && `${c.name} ${c.sub}`.toLowerCase().includes(q))].slice(0, 30);
  if (!items.length && q.includes(' ')) return closeMenu(); // typing on past a name: not a mention
  // (sized as the skill picker's menu, skp-menu)
  const el = menu?.ta === ta ? menu.el : h('div.st-menu.skp-menu.rt-menu', { class: 'static w-[300px] max-w-[300px]' });
  if (!el.isConnected) document.body.append(el);
  // keep the menu's own scroll and clicks from moving focus out of the text
  el.onmousedown = (e) => e.preventDefault();
  menu = { el, ta, start, kind, items, active: 0, onPick, candidates };
  const groups = (['agent', 'team', 'skill'] as const).map((k) => ({ k, list: items.filter((c) => c.kind === k) })).filter((g) => g.list.length);
  // the order on screen is the order for the arrow keys
  menu.items = groups.flatMap((g) => g.list);
  mount(
    el,
    h('div.st-menu-head', kind ? `Mention ${KIND_LABEL[kind].slice(0, -1).toLowerCase()}` : 'Mention'),
    h(
      'div.model-list',
      { class: 'max-h-[280px]' },
      groups.length
        ? groups.map((g) => [
            groups.length > 1 || !kind ? h('div', { class: 'px-2.5 pt-2 pb-0.75 font-mono text-[10px] leading-[normal] font-semibold tracking-[0.14em] text-faint uppercase' }, KIND_LABEL[g.k]) : null,
            g.list.map((c) => h('button.st-menu-item.rt-menu-item', { class: '[&.active]:bg-panel-2 [&.active]:text-accent [&.active_.ico-svg]:text-accent', type: 'button', onclick: () => pick(c) }, c.lead, h('span', { class: 'min-w-0 flex-1' }, c.name, c.sub ? h('span.model-sub', c.sub.slice(0, 90)) : null))),
          ])
        : h('div.hint', { style: { padding: '8px 10px' } }, kind ? `No ${KIND_LABEL[kind].toLowerCase()} match.` : 'Nothing matches. Agents, teams and skills show here.'),
    ),
  );
  paintActive();
  placeMenu(el, ta, start);
}

function paintActive() {
  if (!menu) return;
  const buttons = menu.el.querySelectorAll<HTMLElement>('.rt-menu-item');
  buttons.forEach((b, i) => b.classList.toggle('active', i === menu!.active));
  buttons[menu.active]?.scrollIntoView({ block: 'nearest' });
}

function pick(c: Candidate) {
  if (!menu) return;
  const { ta, start, onPick } = menu;
  const end = ta.selectionStart;
  const after = ta.value.slice(end);
  closeMenu();
  replaceText(ta, `@${c.name}${/^\s/.test(after) ? '' : ' '}`, start, end);
  closeMenu(); // the input above may have reopened it on the new text
  onPick();
  ta.focus();
}

// Put the menu under the caret: measure where it is with a hidden copy of the textarea.
function placeMenu(el: HTMLElement, ta: HTMLTextAreaElement, pos: number) {
  const z = uiZoom();
  const cs = getComputedStyle(ta);
  const copy = document.createElement('div');
  for (const p of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize'] as const) copy.style[p] = cs[p];
  Object.assign(copy.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  copy.textContent = ta.value.slice(0, pos);
  const mark = document.createElement('span');
  mark.textContent = '@';
  copy.append(mark);
  document.body.append(copy);
  const x = mark.offsetLeft - ta.scrollLeft;
  const y = mark.offsetTop - ta.scrollTop + (parseFloat(cs.lineHeight) || 20);
  copy.remove();
  const r = ta.getBoundingClientRect();
  const w = 320;
  const left = Math.max(8, Math.min(r.left / z + x, window.innerWidth / z - w - 8));
  let top = r.top / z + Math.min(y, ta.clientHeight) + 4;
  const room = window.innerHeight / z - top;
  // no room below: open above the caret
  if (room < 220) top = Math.max(8, r.top / z + y - (parseFloat(cs.lineHeight) || 20) - Math.min(320, el.offsetHeight || 320) - 6);
  Object.assign(el.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, transform: 'none', zIndex: '96', width: `${w}px` });
}
