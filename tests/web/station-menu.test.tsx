// The Station's right-click menu (Base UI): headings, dividers, picking something, and Esc.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountStationMenu } from '../../web/views/stationmenu.tsx';
import type { StationMenu } from '../../web/views/stationmenu.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

let menu: StationMenu;
let ran: string[];
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  // (no animations in happy-dom)
  Element.prototype.getAnimations ??= () => [];
  ran = [];
  act(() => void (menu = mountStationMenu(document.getElementById('host')!)));
});
afterEach(() => act(() => menu.unmount()));

const open = () =>
  act(() =>
    menu.open(120, 80, [
      { kind: 'head', text: 'Thumbs' },
      { kind: 'item', label: 'Open', icon: 'maximize-2', run: () => ran.push('open') },
      { kind: 'item', label: 'Rename', run: () => ran.push('rename') },
      { kind: 'sep' },
      { kind: 'item', label: 'Delete team', icon: 'trash-2', danger: true, run: () => ran.push('delete') },
    ]),
  );
const items = () => [...document.querySelectorAll<HTMLElement>('.st-menu [role="menuitem"]')];

describe('the Station menu', () => {
  it('shows its heading, items and divider', async () => {
    expect(menu.isOpen()).toBe(false);
    await open();
    await settle();
    expect(menu.isOpen()).toBe(true);
    expect(document.querySelector('.st-menu .st-menu-head')!.textContent).toBe('Thumbs');
    expect(items().map((i) => i.textContent!.trim())).toEqual(['Open', 'Rename', 'Delete team']);
    expect(items()[2].classList.contains('danger')).toBe(true);
    expect(document.querySelectorAll('.st-menu .st-menu-sep')).toHaveLength(1);
    expect(menu.contains(items()[0])).toBe(true);
    expect(menu.contains(document.body)).toBe(false);
  });

  it('runs what you pick and closes', async () => {
    await open();
    await settle();
    await act(async () => items()[1].click());
    await settle();
    expect(ran).toEqual(['rename']);
    expect(menu.isOpen()).toBe(false);
    expect(document.querySelector('.st-menu')).toBeNull();
  });

  it('closes from the map (close())', async () => {
    await open();
    await settle();
    await act(async () => menu.close());
    await settle();
    expect(menu.isOpen()).toBe(false);
    expect(ran).toEqual([]);
  });
});
