// The / commands in the plain-DOM chats (team chat, Brain chat): the suggestions shown while you type
// "/", and the loop and goal chips above the box. (The agent chat is React: web/chat/ChatView.tsx.)
import { h, mount } from './core.ts';
import { icon } from './icons.ts';
import { GOAL_FOLLOW_UPS, loopPace, slashSuggestions } from '../shared/commands.ts';
import type { ChatKind, SlashOption } from '../shared/commands.ts';
import type { BrainBrief, LoopInfo } from '../shared/types.ts';

export interface SlashMenu {
  /** The menu (put it next to the box, in a positioned parent). */
  el: HTMLDivElement;
  /** Look at the box again (after each input). */
  update(): void;
  /** A key in the box: true when the menu used it. */
  key(e: KeyboardEvent): boolean;
  open(): boolean;
}

/** run: a command with nothing after it was picked (it is in the box now): send it. */
export function slashMenu(input: HTMLTextAreaElement, kind: ChatKind, { run }: { run: () => void }): SlashMenu {
  const el = h('div.tc-suggest.slash-menu.hidden', { role: 'listbox' });
  let options: SlashOption[] = [];
  let active = 0;
  const draw = () => {
    el.classList.toggle('hidden', !options.length);
    mount(
      el,
      options.map((o, i) =>
        h(
          `button.tc-sopt${i === active ? '.on' : ''}`,
          { class: 'items-baseline', type: 'button', role: 'option', 'aria-selected': String(i === active), onmousedown: (e: MouseEvent) => (e.preventDefault(), pick(o)) },
          h('b.slash-name', { class: 'flex-none font-mono text-[12.5px] leading-[normal] font-semibold text-accent' }, `/${o.name}`),
          o.args ? h('span', { class: 'flex-none font-mono text-[11.5px] leading-[normal] text-faint' }, o.args) : null,
          h('span.hint', { class: 'min-w-0' }, o.about),
        ),
      ),
    );
  };
  const update = () => {
    const next = slashSuggestions(input.value, kind);
    if (next.map((o) => o.name).join() !== options.map((o) => o.name).join()) active = 0;
    options = next;
    draw();
  };
  const pick = (o: SlashOption) => {
    input.value = o.args ? `/${o.name} ` : `/${o.name}`;
    options = [];
    draw();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    if (!o.args) run();
  };
  return {
    el,
    update,
    open: () => options.length > 0,
    key(e) {
      if (!options.length || e.isComposing) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') active = (active + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') return e.preventDefault(), pick(options[active]), true;
      else if (e.key === 'Escape') {
        // (and not the window it is in)
        e.stopPropagation();
        options = [];
      } else return false;
      e.preventDefault();
      draw();
      return true;
    },
  };
}

/** "every 15m · 3 of 10 sent · next 10:42" */
export function loopLine(l: LoopInfo): string {
  const next = l.next ? ` · next ${new Date(l.next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  return `${loopPace(l.every)} · ${l.done} of ${l.times} sent${next}`;
}

/** "the Brain checks each turn" / "2 of 5 follow-ups" */
export function goalLine(g: BrainBrief, max = GOAL_FOLLOW_UPS): string {
  return g.followUps ? `${g.followUps} of ${max} follow-ups` : 'the Brain checks the work after each turn';
}

const CHIP_TEXT = 'min-w-0 flex-1 truncate';

/** The loop and goal chips (x ends one). Empty when there is neither. */
export function commandChips(el: HTMLElement, { loop, goal, onStopLoop, onClearGoal }: { loop: LoopInfo | null; goal: BrainBrief | null; onStopLoop: () => void; onClearGoal: () => void }): void {
  el.classList.toggle('hidden', !loop && !goal);
  mount(
    el,
    goal
      ? h('div.cmd-chip.goal', icon('target', 13), h('span', { class: CHIP_TEXT }, h('b', 'Goal: '), goal.goal || goal.text), h('span.hint', goalLine(goal)), h('button.tc-act', { title: 'Drop this goal', 'aria-label': 'Drop this goal', onclick: onClearGoal }, icon('x', 12)))
      : null,
    loop ? h('div.cmd-chip.loop', icon('repeat', 13), h('span', { class: CHIP_TEXT }, h('b', 'Loop: '), loop.text), h('span.hint', loopLine(loop)), h('button.tc-act', { title: 'Stop the loop', 'aria-label': 'Stop the loop', onclick: onStopLoop }, icon('x', 12))) : null,
  );
}
