// A long chat draws only the messages near what you see (and a few around them), so a chat of
// thousands of messages scrolls and streams as lightly as a short one. Each message is measured once
// it has drawn; the ones not drawn keep their last height, or a guess from what they hold (estimate.ts),
// so the scrollbar stays right and a jump to the top lands there. Heights are remembered per chat and
// message, so a chat opened again starts with the real ones.
// Short chats draw every message as before (the browser's own Find still sees them all).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { measureElement, useVirtualizer } from '@tanstack/react-virtual';

/** From this many messages on, a chat draws only what is near the screen. */
export const WINDOW_FROM = 50;

export interface WindowedProps<T extends { id: string }> {
  items: readonly T[];
  /** the element that scrolls (the message list) */
  scroller: RefObject<HTMLElement | null>;
  /** start at the newest message (you were at the bottom) */
  atEnd: boolean;
  /** the space between messages, in px (the list's own gap) */
  gap: number;
  /** a guess at a message's height before it has drawn (width: the list's) */
  estimate: number | ((item: T, width: number) => number);
  /**
   * What a remembered height is kept under: it must change when the message would draw differently.
   * Ids alone are not enough when they are positions (every chat has an "m-10").
   */
  memoKey?: (item: T) => string;
  render: (item: T) => ReactNode;
}

/** Heights measured before, by memo key, with the list width they were measured at. */
const remembered = new Map<string, { width: number; size: number }>();
/** A remembered height still holds while the list is about as wide. */
const SAME_WIDTH = 40;
/** At most this many heights are kept (the oldest go first). */
const REMEMBER = 5000;

/** Remember a measured height (exported for tests). */
export function rememberHeight(key: string, width: number, size: number): void {
  remembered.delete(key);
  remembered.set(key, { width, size });
  if (remembered.size > REMEMBER) remembered.delete(remembered.keys().next().value!);
}
/** A height measured before at about this width, if any. */
export function rememberedHeight(key: string, width: number): number | undefined {
  const known = remembered.get(key);
  return known && Math.abs(known.width - width) < SAME_WIDTH ? known.size : undefined;
}

export function Windowed<T extends { id: string }>({ items, scroller, atEnd, gap, estimate, memoKey, render }: WindowedProps<T>) {
  // (read once, when the list first draws)
  const startAtEnd = useRef(atEnd);
  // the list's width, kept by a ResizeObserver: a guess runs for every message not drawn yet, and
  // reading clientWidth in each would make the browser lay out the page again and again
  const lastWidth = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    lastWidth.current = el.clientWidth || lastWidth.current;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => (lastWidth.current = el.clientWidth || lastWidth.current));
    ro.observe(el);
    return () => ro.disconnect();
  }, [scroller]);
  const width = () => lastWidth.current || (lastWidth.current = scroller.current?.clientWidth || 800);
  const keyOf = (item: T) => (memoKey ? memoKey(item) : item.id);
  // guesses already made, by memo key and width: a streamed chunk asks again for every message
  const guessed = useRef(new Map<string, number>());
  const guess = (i: number): number => {
    const item = items[i];
    if (!item) return typeof estimate === 'number' ? estimate : 110;
    const w = width();
    const key = keyOf(item);
    const known = rememberedHeight(key, w);
    if (known != null) return known;
    if (typeof estimate === 'number') return estimate;
    const at = `${Math.round(w / SAME_WIDTH)}|${key}`;
    let size = guessed.current.get(at);
    if (size == null) {
      size = estimate(item, w);
      if (guessed.current.size > REMEMBER) guessed.current.clear();
      guessed.current.set(at, size);
    }
    return size;
  };
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: guess,
    // measured as usual, and remembered for the next time this chat opens
    measureElement: (el, entry, instance) => {
      const size = measureElement(el, entry, instance);
      const item = items[Number((el as HTMLElement).dataset.index)];
      if (item) rememberHeight(keyOf(item), width(), size);
      return size;
    },
    getItemKey: useCallback((i: number) => items[i]?.id ?? i, [items]),
    gap,
    overscan: 6,
    // (far past the end: the browser stops it at the bottom, so the first draw is already the newest messages)
    initialOffset: () => (startAtEnd.current ? Number.MAX_SAFE_INTEGER : (scroller.current?.scrollTop ?? 0)),
  });
  // messages drawn before: drawn again (scrolled back to), they don't play their arrival animation
  const [seen] = useState(() => new Set<string>());
  return (
    <div className="msg-window relative w-full shrink-0" style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((row) => {
        const item = items[row.index];
        if (!item) return null;
        return (
          <Row key={row.key} id={item.id} index={row.index} start={row.start} seen={seen} measure={v.measureElement}>
            {render(item)}
          </Row>
        );
      })}
    </div>
  );
}

function Row({ id, index, start, seen, measure, children }: { id: string; index: number; start: number; seen: Set<string>; measure: (el: Element | null) => void; children: ReactNode }) {
  const [again] = useState(() => seen.has(id));
  useEffect(() => void seen.add(id), [seen, id]);
  return (
    <div ref={measure} data-index={index} className={again ? 'msg-row again absolute top-0 left-0 flex w-full flex-col gap-3.5 in-[.ac-list]:gap-2' : 'msg-row absolute top-0 left-0 flex w-full flex-col gap-3.5 in-[.ac-list]:gap-2'} style={{ transform: `translateY(${start}px)` }}>
      {children}
    </div>
  );
}
