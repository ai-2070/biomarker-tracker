import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { MIN_SPAN_DAYS, centerWindow, clampWindow, panWindow, presetWindow, zoomWindow, type TimeWindow } from "../../core/timeWindow";
import { MinusIcon, PlusIcon } from "./icons";
import { cx } from "./ui";

/**
 * Looking around in time, shared by the dashboard timeline and the charts: quick ranges, zoom buttons,
 * dragging (horizontal only, so the page still scrolls on touch: moves the timeline, selects a period
 * on a chart), an overview strip to move a chart, Ctrl+wheel zoom around the pointer, sideways wheel or
 * trackpad to move, and keys (arrows, + and -, 0; Enter zooms to a selection, Esc clears it). The
 * window maths is in core/timeWindow.ts (tested).
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

const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
const dayMonthFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
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
  /** True while the view is being dragged or a period selected (hover previews wait). */
  isDragging: () => boolean;
  /** With `drag: "select"`: the period dragged across (days), while dragging and after. */
  selection: TimeWindow | null;
  clearSelection: () => void;
  /** Zooms to the selected period and clears the selection. */
  zoomToSelection: () => void;
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

/** A shared date window; each chart still owns its pointer geometry and selection. */
export interface SharedTimeView {
  extent: { first: string; last: string };
  view: TimeWindow | null;
  preset: string;
  onChange: (view: TimeWindow | null, preset: string) => void;
}

/**
 * `plot` gives the plot area inside the element, in pixels from its left edge: where dragging and
 * the zoom anchor are measured. `onChange` runs whenever the window changes (e.g. to close a tooltip).
 * `drag`: "pan" moves the view (the dashboard timeline); "select" marks a period to look at or zoom
 * into (the charts, which move with the overview strip instead).
 */
export function useTimeView(
  full: TimeWindow,
  plot: { left: number; width: number },
  opts: { minSpan?: number; onChange?: () => void; ref?: RefObject<HTMLDivElement | null>; drag?: "pan" | "select"; shared?: SharedTimeView } = {},
): TimeView {
  const minSpan = opts.minSpan ?? MIN_SPAN_DAYS;
  const mode = opts.drag ?? "pan";
  const own = useRef<HTMLDivElement | null>(null);
  const ref = opts.ref ?? own;
  const [view, setView] = useState<TimeWindow | null>(null);
  const [preset, setPreset] = useState("All");
  const [selection, setSelection] = useState<TimeWindow | null>(null);
  const drag = useRef<{ x: number; w: TimeWindow; moved: boolean; day: number } | null>(null);
  const suppressClick = useRef(false);
  // Reconcile immediately, including the render before the effect commits new bounds.
  const currentView = opts.shared ? opts.shared.view : view;
  const v = currentView ? clampWindow(currentView, full, minSpan) : full;
  const zoomed = v.to - v.from < full.to - full.from - 1;
  useEffect(() => {
    setView((previous) => previous ? clampWindow(previous, full, minSpan) : null);
    setSelection(null);
    drag.current = null;
  }, [full.from, full.to, minSpan]);
  useEffect(() => {
    if (opts.shared) {
      setSelection(null);
      opts.onChange?.();
    }
  }, [opts.shared?.view?.from, opts.shared?.view?.to]);
  const width = Math.max(plot.width, 1);

  const show = (w: TimeWindow | null, label: string | null = null) => {
    if (opts.shared) opts.shared.onChange(w, label ?? "");
    else {
      setView(w);
      setPreset(label ?? "");
    }
    opts.onChange?.();
  };
  /** The day under a pointer, kept inside the plot. */
  const dayAt = (clientX: number) => {
    const left = ref.current?.getBoundingClientRect().left ?? 0;
    return v.from + Math.min(Math.max((clientX - left - plot.left) / width, 0), 1) * (v.to - v.from);
  };
  const zoomTo = (sel: TimeWindow) => {
    setSelection(null);
    show(clampWindow(sel, full, minSpan));
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
    preset: opts.shared ? opts.shared.preset : preset,
    zoomed,
    minSpan,
    show,
    isDragging: () => !!drag.current?.moved,
    selection,
    clearSelection: () => setSelection(null),
    zoomToSelection: () => selection && zoomTo(selection),
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
        else if (e.key === "Escape" && selection) setSelection(null);
        else if (e.key === "Enter" && selection) zoomTo(selection);
        else return;
        e.preventDefault();
      },
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, w: v, moved: false, day: dayAt(e.clientX) };
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
        if (mode === "select") {
          const day = dayAt(e.clientX);
          setSelection({ from: Math.min(g.day, day), to: Math.max(g.day, day) });
        } else show(panWindow(g.w, (-dx * (g.w.to - g.w.from)) / width, full, minSpan));
      },
      onPointerUp: () => {
        if (drag.current?.moved) {
          suppressClick.current = true;
          // A tiny selection (under a day) is a slip, not a period.
          if (mode === "select") setSelection((sel) => (sel && sel.to - sel.from >= 1 ? sel : null));
        }
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

/**
 * The whole time span in a thin strip under a chart, with the part on screen as a window. Drag the
 * window to move through time, or tap elsewhere to jump there. Shown when zoomed in.
 */
export function Overview({ t, lines }: { t: TimeView; lines: { points: { day: number; value: number }[]; color: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const H = 40;
  const drag = useRef<{ offset: number } | null>(null);
  const { full, v } = t;
  const x = (day: number) => ((day - full.from) / (full.to - full.from)) * width;
  const dayAt = (clientX: number) => full.from + ((clientX - (ref.current?.getBoundingClientRect().left ?? 0)) / Math.max(width, 1)) * (full.to - full.from);
  const values = lines.flatMap((l) => l.points.map((p) => p.value));
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const y = (val: number) => 6 + ((hi - val) / Math.max(hi - lo, 1e-9)) * (H - 12);
  const x0 = x(v.from);
  const x1 = Math.max(x(v.to), x0 + 8);
  return (
    <div
      ref={ref}
      className="relative w-full cursor-pointer touch-pan-y select-none"
      style={{ height: H }}
      aria-hidden="true"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const day = dayAt(e.clientX);
        const inside = day >= v.from && day <= v.to;
        // Outside the window: jump there first, then keep dragging from its middle.
        if (!inside) t.show(centerWindow(v, day, full, t.minSpan));
        drag.current = { offset: inside ? day - (v.from + v.to) / 2 : 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        t.show(centerWindow(v, dayAt(e.clientX) - drag.current.offset, full, t.minSpan));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {width > 0 && (
        <svg width={width} height={H} className="block">
          <rect x={0} y={0} width={width} height={H} rx={6} className="fill-sunken" />
          {lines.map((l, i) => (
            <polyline
              key={i}
              points={l.points.map((p) => `${x(p.day)},${y(p.value)}`).join(" ")}
              fill="none"
              stroke={l.color}
              strokeOpacity={0.7}
              strokeWidth={1.25}
              strokeLinejoin="round"
            />
          ))}
          <rect x={x0} y={1} width={x1 - x0} height={H - 2} rx={5} className="fill-accent/10 stroke-accent" strokeWidth={1.5} />
          <line x1={x0 + 4} x2={x0 + 4} y1={H / 2 - 6} y2={H / 2 + 6} className="stroke-accent" strokeWidth={2} strokeLinecap="round" />
          <line x1={x1 - 4} x2={x1 - 4} y1={H / 2 - 6} y2={H / 2 + 6} className="stroke-accent" strokeWidth={2} strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
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

const selFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Under a chart: a hint to drag across it, or, once a period is selected, what happened in it (given
 * by the chart) with a button to zoom to it.
 */
export function SelectionBar({ t, children }: { t: TimeView; children: ReactNode }) {
  if (!t.selection) {
    return <p className="text-sm text-ink-2">Drag across the chart to select a period{t.zoomed ? "; drag the strip below it to move" : ""}.</p>;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm" aria-live="polite">
      <div className="min-w-0">
        <p className="font-medium text-ink">
          {selFmt.format(fromDay(t.selection.from))} – {selFmt.format(fromDay(t.selection.to))}
        </p>
        <div className="text-ink-2">{children}</div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={t.zoomToSelection} className="flex h-11 items-center rounded-md bg-accent px-3 font-medium text-accent-ink sm:h-9">
          Zoom to this period
        </button>
        <button type="button" onClick={t.clearSelection} className="flex h-11 items-center rounded-md px-3 text-ink-2 hover:text-ink sm:h-9">
          Clear
        </button>
      </div>
    </div>
  );
}
