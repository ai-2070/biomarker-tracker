// Settings > Look: the chat font (picking one changes --font-chat and saves it) and the Station quality.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import { CHAT_FONTS, DEFAULT_LOOK, STATION_QUALITY, applyLook, chatFont, currentLook, stationLevel } from '../../web/look.ts';
import { LookTab } from '../../web/views/look.tsx';
import type { AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fontVar = () => document.documentElement.style.getPropertyValue('--font-chat');

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  localStorage.clear();
});

describe('chat fonts', () => {
  it('the default keeps the stylesheet’s own font', () => {
    applyLook({ chatFont: 'serif' });
    expect(fontVar()).toBe('');
  });

  it('a picked font sets --font-chat', () => {
    applyLook({ chatFont: 'google' });
    expect(fontVar()).toContain("'Google Sans'");
    applyLook({ chatFont: 'mono' });
    expect(fontVar()).toContain('JetBrains Mono');
    // back to the default
    applyLook({ chatFont: 'serif' });
    expect(fontVar()).toBe('');
  });

  it('an unknown or missing font falls back to the default', () => {
    expect(chatFont('nope').id).toBe(DEFAULT_LOOK.chatFont);
    expect(chatFont(undefined).id).toBe(DEFAULT_LOOK.chatFont);
    applyLook({ chatFont: 'nope' });
    expect(fontVar()).toBe('');
  });
});

describe('Station quality', () => {
  it('fewer frames and pixels the lower it is, Balanced by default', () => {
    expect(DEFAULT_LOOK.station).toBe('balanced');
    expect(stationLevel(undefined).id).toBe('balanced');
    expect(stationLevel('nope').id).toBe('balanced');
    const [smooth, balanced, saver] = ['smooth', 'balanced', 'saver'].map(stationLevel);
    expect(smooth.fps.moving).toBeNull(); // as fast as the screen
    expect(balanced.fps.moving!).toBeGreaterThan(saver.fps.moving!);
    for (const q of STATION_QUALITY) expect(q.fps.still).toBeGreaterThan(q.fps.away);
    expect(smooth.pixelRatio).toBeGreaterThan(balanced.pixelRatio);
    expect(balanced.pixelRatio).toBeGreaterThan(saver.pixelRatio);
    // a desk's screen has to look bigger before Battery saver animates it
    expect(saver.screenPx).toBeGreaterThan(balanced.screenPx);
  });

  it('the map reads the quality in use from the look', () => {
    applyLook({ station: 'saver' });
    expect(currentLook().station).toBe('saver');
    applyLook({});
    expect(currentLook().station).toBe('balanced');
  });
});

describe('Settings > Look', () => {
  let el: HTMLElement;
  let root: Root;
  const puts: unknown[] = [];
  beforeEach(() => {
    puts.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: 200 });
      }),
    );
    document.body.innerHTML = '<div id="toasts"></div><section id="view"></section>';
    el = document.getElementById('view')!;
    state.data = { settings: { look: { ...DEFAULT_LOOK } } } as unknown as AppState;
    root = createRoot(el);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    state.data = null;
  });

  it('lists every chat font in its own font, and saves the one picked', async () => {
    await act(async () => root.render(<LookTab />));
    const choices = [...el.querySelectorAll<HTMLButtonElement>('.look-font')];
    expect(choices.map((c) => c.firstElementChild!.textContent)).toEqual(CHAT_FONTS.map((f) => f.label));
    expect(choices.map((c) => c.getAttribute('aria-checked'))).toEqual(CHAT_FONTS.map((f) => String(f.id === 'serif')));
    const unquoted = (v: string) => v.replace(/["']/g, '');
    expect(choices.map((c) => unquoted((c.firstElementChild as HTMLElement).style.fontFamily))).toEqual(CHAT_FONTS.map((f) => unquoted(f.stack)));
    expect(el.querySelector('.look-sample')!.className).toContain('font-chat');

    const roboto = choices[CHAT_FONTS.findIndex((f) => f.id === 'roboto')];
    await act(async () => roboto.click());
    expect(roboto.getAttribute('aria-checked')).toBe('true');
    expect(fontVar()).toContain("'Roboto'");
    await act(async () => vi.advanceTimersByTime(400));
    expect(puts).toEqual([{ look: { ...DEFAULT_LOOK, chatFont: 'roboto' } }]);
  });

  it('sets the Station quality, says what it does, and saves it', async () => {
    await act(async () => root.render(<LookTab />));
    const seg = el.querySelector<HTMLElement>('[aria-label="Station quality"]')!;
    const choices = [...seg.querySelectorAll<HTMLButtonElement>('button')];
    expect(choices.map((b) => b.textContent)).toEqual(['Smooth', 'Balanced', 'Battery saver']);
    expect(el.querySelector('.look-station-hint')!.textContent).toBe(stationLevel('balanced').hint);
    await act(async () => choices[2].click());
    expect(el.querySelector('.look-station-hint')!.textContent).toBe(stationLevel('saver').hint);
    expect(currentLook().station).toBe('saver');
    await act(async () => vi.advanceTimersByTime(400));
    expect(puts).toEqual([{ look: { ...DEFAULT_LOOK, station: 'saver' } }]);
  });
});
