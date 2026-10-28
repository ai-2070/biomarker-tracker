// The / menu and the loop and goal chips in the plain-DOM chats (team chat, Brain chat).
import { describe, expect, it, vi } from 'vitest';
import { commandChips, goalLine, loopLine, slashMenu } from '../../web/chatcommands.ts';
import type { BrainBrief } from '../../shared/types.ts';

const key = (k: string) => new KeyboardEvent('keydown', { key: k, cancelable: true });

function setup(kind: 'team' | 'brain' = 'team') {
  const input = document.createElement('textarea');
  const run = vi.fn();
  const menu = slashMenu(input, kind, { run });
  document.body.append(input, menu.el);
  const type = (v: string) => ((input.value = v), menu.update());
  const shown = () => [...menu.el.querySelectorAll('.slash-name')].map((n) => n.textContent);
  return { input, run, menu, type, shown };
}

describe('slashMenu()', () => {
  it('shows the commands while you type "/", narrowing as you go', () => {
    const m = setup();
    m.type('/');
    expect(m.shown()).toEqual(['/queue', '/stop', '/resume', '/resend', '/loop', '/goal', '/clear']);
    expect(m.menu.el.classList.contains('hidden')).toBe(false);
    m.type('/re');
    expect(m.shown()).toEqual(['/resume', '/resend']);
    expect(m.menu.el.textContent).toContain('Pick up work that was stopped or paused');
    m.type('/re now');
    expect(m.menu.el.classList.contains('hidden')).toBe(true);
    expect(m.menu.open()).toBe(false);
  });

  it('Enter on a command with nothing after it puts it in the box and sends it', () => {
    const m = setup();
    m.type('/st');
    expect(m.menu.key(key('Enter'))).toBe(true);
    expect(m.input.value).toBe('/stop');
    expect(m.run).toHaveBeenCalledTimes(1);
  });

  it('arrows move through it; a command that takes more waits for it; Escape closes', () => {
    const m = setup('brain');
    m.type('/');
    m.menu.key(key('ArrowDown'));
    m.menu.key(key('ArrowUp'));
    m.menu.key(key('ArrowUp'));
    expect(m.menu.el.querySelector('.tc-sopt.on .slash-name')!.textContent).toBe('/goal');
    expect(m.menu.key(key('Tab'))).toBe(true);
    expect(m.input.value).toBe('/goal ');
    expect(m.run).not.toHaveBeenCalled();
    m.type('/l');
    expect(m.menu.key(key('Escape'))).toBe(true);
    expect(m.menu.open()).toBe(false);
    expect(m.menu.key(key('Enter'))).toBe(false);
  });
});

describe('commandChips()', () => {
  it('shows the goal and the loop, and × ends each', () => {
    const el = document.createElement('div');
    const onStopLoop = vi.fn();
    const onClearGoal = vi.fn();
    const goal = { id: 'b1', goal: 'tests pass', text: 'tests pass', followUps: 2 } as BrainBrief;
    commandChips(el, { loop: { text: 'check CI', every: 900_000, times: 10, done: 3, next: null }, goal, onStopLoop, onClearGoal });
    expect(el.querySelector('.cmd-chip.goal')!.textContent).toContain('Goal: tests pass');
    expect(el.querySelector('.cmd-chip.goal')!.textContent).toContain('2 of 5 follow-ups');
    expect(el.querySelector('.cmd-chip.loop')!.textContent).toContain('every 15m · 3 of 10 sent');
    (el.querySelector('.cmd-chip.loop button') as HTMLButtonElement).click();
    (el.querySelector('.cmd-chip.goal button') as HTMLButtonElement).click();
    expect(onStopLoop).toHaveBeenCalled();
    expect(onClearGoal).toHaveBeenCalled();
    commandChips(el, { loop: null, goal: null, onStopLoop, onClearGoal });
    expect(el.classList.contains('hidden')).toBe(true);
    expect(loopLine({ text: '', every: null, times: 5, done: 1, next: null })).toBe('after each answer · 1 of 5 sent');
    expect(goalLine({ followUps: 0 } as BrainBrief)).toBe('the Brain checks the work after each turn');
  });
});
