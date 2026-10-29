import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { MIN_SPAN_DAYS, panWindow, presetWindow, zoomWindow, type TimeWindow } from "../../core/timeWindow";
import { MinusIcon, PlusIcon } from "./icons";
import { cx } from "./ui";

/**
 * Looking around in time, shared by the dashboard timeline and the marker charts: quick ranges, zoom
 * buttons, dragging (horizontal only, so the page still scrolls on touch), Ctrl+wheel zoom around the
 * pointer, sideways wheel or trackpad to move, and keys (arrows, + and -, 0). The window maths is in
 * core/timeWindow.ts (tested).
 */

export interface Preset {
  label: string;
  days: number | "all";
}

export const PRESETS: Preset[] = [
  { label: "6M", days: 183 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
  { label: "5Y", days: 1826 },
  { label: "All", days: "all" },
];

/** Shorter ranges for marker charts, where daily readings from a watch are common. */
export const CHART_PRESETS: Preset[] = [{ label: "1M", days: 30 }, { label: "3M", days: 91 }, ...PRESETS];

const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });
const dayMonthFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
export const fromDay = (day: number) => new Date(Math.round(day) * 86_400_000);

export interface TimeView {
  /** What is on screen. */
  v: TimeWindow;
  full: TimeWindow;
  preset: string;
  zoomed: boolean;
  minSpan: number;
  /** Shows a window (null: everything), with the preset it came from, if any. */
  show: (w: TimeWindow | null, label?: string | null) => void;
  /** True while the view is being dragged (hover previews wait). */
  isDragging: () => boolean;
  /** Spread these on the element that is dragged and zoomed. */
  bind: {
    ref: RefObject<HTMLDivElement | null>;
    tabIndex: 0;
    onKeyDown: (e: KeyboardEvent) => void;
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onClickCapture: (e: MouseEvent) => void;
    style: { touchAction: "pan-y" };
  };
}

/**
 * `plot` gives the plot area inside the element, in pixels from its left edge: where dragging and
 * the zoom anchor are measured. `onChange` runs whenever the window changes (e.g. to close a tooltip).
 */
export function useTimeView(
  full: TimeWindow,
  plot: { left: number; width: number },
  opts: { minSpan?: number; onChange?: () => void; ref?: RefObject<HTMLDivElement | null> } = {},
): TimeView {
  const minSpan = opts.minSpan ?? MIN_SPAN_DAYS;
  const own = useRef<HTMLDivElement | null>(null);
  const ref = opts.ref ?? own;
  const [view, setView] = useState<TimeWindow | null>(null);
  const [preset, setPreset] = useState("All");
  const drag = useRef<{ x: number; w: TimeWindow; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const v = view ?? full;
  const zoomed = v.to - v.from < full.to - full.from - 1;
  const width = Math.max(plot.width, 1);

  const show = (w: TimeWindow | null, label: string | null = null) => {
    setView(w);
    setPreset(label ?? "");
    opts.onChange?.();
  };

  // Ctrl + wheel zooms around the pointer; a sideways wheel or trackpad swipe moves. A plain wheel scrolls the page.
  const latest = useRef({ v, full, plot, show, minSpan });
  latest.current = { v, full, plot, show, minSpan };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { v: cur, full: all, plot: p, show: go, minSpan: min } = latest.current;
      const pw = Math.max(p.width, 1);
      const anchor = Math.min(Math.max((e.clientX - el.getBoundingClientRect().left - p.left) / pw, 0), 1);
      if (e.ctrlKey) {
        e.preventDefault();
        go(zoomWindow(cur, e.deltaY > 0 ? 1.25 : 0.8, anchor, all, min));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        go(panWindow(cur, (e.deltaX * (cur.to - cur.from)) / pw, all, min));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);

  return {
    v,
    full,
    preset,
    zoomed,
    minSpan,
    show,
    isDragging: () => !!drag.current,
    bind: {
      ref,
      tabIndex: 0,
      style: { touchAction: "pan-y" },
      onKeyDown: (e) => {
        const step = (v.to - v.from) * 0.15;
        if (e.key === "ArrowLeft") show(panWindow(v, -step, full, minSpan));
        else if (e.key === "ArrowRight") show(panWindow(v, step, full, minSpan));
        else if (e.key === "+" || e.key === "=") show(zoomWindow(v, 0.7, 0.5, full, minSpan));
        else if (e.key === "-" || e.key === "_") show(zoomWindow(v, 1 / 0.7, 0.5, full, minSpan));
        else if (e.key === "0") show(null, "All");
        else return;
        e.preventDefault();
      },
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, w: v, moved: false };
      },
      onPointerMove: (e) => {
        const g = drag.current;
        if (!g) return;
        const dx = e.clientX - g.x;
        if (!g.moved && Math.abs(dx) < 5) return;
        if (!g.moved) {
          g.moved = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        show(panWindow(g.w, (-dx * (g.w.to - g.w.from)) / width, full, minSpan));
      },
      onPointerUp: () => {
        if (drag.current?.moved) suppressClick.current = true;
        drag.current = null;
      },
      onPointerCancel: () => {
        drag.current = null;
      },
      onClickCapture: (e) => {
        // The end of a drag is not a click on what's under it.
        if (suppressClick.current) {
          suppressClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
    },
  };
}

/** Width of an element, kept up to date. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export const segBtn = "flex h-11 min-w-11 items-center justify-center rounded-md px-2.5 text-sm transition-colors duration-150 sm:h-8 sm:min-w-9";
export const segGroup = "flex rounded-lg border border-line bg-sunken p-0.5";

/** What is shown (dates), quick ranges and zoom buttons. */
export function TimeControls({ t, presets = PRESETS }: { t: TimeView; presets?: Preset[] }) {
  const span = t.full.to - t.full.from;
  const fmt = t.v.to - t.v.from < 120 ? dayMonthFmt : monthYearFmt;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-ink-2 tabular-nums" aria-live="polite">
        {fmt.format(fromDay(t.v.from))} – {fmt.format(fromDay(t.v.to))}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Time range" className={segGroup}>
          {presets
            .filter((p) => p.days === "all" || p.days < span)
            .map((p) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={t.preset === p.label}
                onClick={() => t.show(p.days === "all" ? null : presetWindow(p.days, t.full, t.minSpan), p.label)}
                className={cx(segBtn, t.preset === p.label ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
              >
                {p.label}
              </button>
            ))}
        </div>
        <div role="group" aria-label="Zoom" className={segGroup}>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={!t.zoomed}
            onClick={() => t.show(zoomWindow(t.v, 1 / 0.7, 0.5, t.full, t.minSpan))}
            className={cx(segBtn, "text-ink-2 hover:text-ink disabled:opacity-40")}
          >
            <MinusIcon width={16} height={16} />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={t.v.to - t.v.from <= Math.min(t.minSpan, span) + 1}
            onClick={() => t.show(zoomWindow(t.v, 0.7, 0.5, t.full, t.minSpan))}
            className={cx(segBtn, "text-ink-2 hover:text-ink disabled:opacity-40")}
          >
            <PlusIcon width={16} height={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
