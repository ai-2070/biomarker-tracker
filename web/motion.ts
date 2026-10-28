// Small motion helpers for windows and panels. Everything animates transform and opacity only
// (no layout work per frame), and nothing moves when Settings › Look › Motion is Reduced.
import { uiZoom } from './look.ts';

export const EASE = 'cubic-bezier(.2,.9,.25,1)';
export const EASE_IN = 'cubic-bezier(.5,0,.75,0)';

export function reducedMotion(): boolean {
  return document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Box = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

// The transform that makes `to`'s box look like `from` (in CSS pixels, with the UI scale in mind).
function mapping(from: Box, to: Box): string {
  const z = uiZoom();
  const sx = from.width / Math.max(1, to.width);
  const sy = from.height / Math.max(1, to.height);
  return `translate(${(from.left - to.left) / z}px, ${(from.top - to.top) / z}px) scale(${sx}, ${sy})`;
}

/** The element moved or resized from `from` to where it is now: animate it from the old box. */
export function flipFrom(el: HTMLElement, from: Box, { duration = 380, fade = false }: { duration?: number; fade?: boolean } = {}): Animation | null {
  if (reducedMotion()) return null;
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return null;
  return el.animate(
    [
      { transformOrigin: 'top left', transform: mapping(from, to), opacity: fade ? 0 : 1 },
      { transformOrigin: 'top left', transform: 'none', opacity: 1 },
    ],
    { duration, easing: EASE },
  );
}

/** Shrink or grow the element into another box (e.g. a window into its pill), fading out. */
export function flipTo(el: HTMLElement, target: Box, { duration = 300 }: { duration?: number } = {}): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const from = el.getBoundingClientRect();
  if (!from.width || !from.height) return Promise.resolve();
  const a = el.animate(
    [
      { transformOrigin: 'top left', transform: 'none', opacity: 1 },
      { transformOrigin: 'top left', transform: mapping(target, from), opacity: 0 },
    ],
    { duration, easing: EASE_IN, fill: 'forwards' },
  );
  return a.finished.then(
    () => a.cancel(),
    () => undefined,
  );
}

/** Fade + slide something in (panels, pills). */
export function slideIn(el: Element, { x = 0, y = 0, scale = 1, duration = 380, blur = 0 }: { x?: number; y?: number; scale?: number; duration?: number; blur?: number } = {}): Animation | null {
  if (reducedMotion()) return null;
  return el.animate(
    [
      { opacity: 0, transform: `translate(${x}px, ${y}px) scale(${scale})`, filter: blur ? `blur(${blur}px)` : 'none' },
      { opacity: 1, transform: 'none', filter: 'none' },
    ],
    { duration, easing: EASE },
  );
}

/** Fade + slide something out; resolves when it's done (then hide it). */
export function slideOut(el: Element, { x = 0, y = 0, scale = 1, duration = 220 }: { x?: number; y?: number; scale?: number; duration?: number } = {}): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const a = el.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: `translate(${x}px, ${y}px) scale(${scale})` },
    ],
    { duration, easing: EASE_IN, fill: 'forwards' },
  );
  return a.finished.then(
    () => a.cancel(),
    () => undefined,
  );
}
