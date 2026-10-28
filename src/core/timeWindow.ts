/**
 * The part of a timeline that is on screen, in day numbers (days since 1970-01-01, as dayNumber()).
 * Pure helpers for zooming, moving and choosing axis ticks; the chart only draws.
 */
import { dayNumber } from "./dates";

export interface TimeWindow {
  from: number;
  to: number;
}

/** Never zoom in further than this many days. */
export const MIN_SPAN_DAYS = 45;

/** Keeps a window inside the full range and at least MIN_SPAN_DAYS wide (or the full range, if shorter). */
export function clampWindow(w: TimeWindow, full: TimeWindow): TimeWindow {
  const fullSpan = full.to - full.from;
  const span = Math.min(Math.max(w.to - w.from, Math.min(MIN_SPAN_DAYS, fullSpan)), fullSpan);
  let from = w.from;
  if (from < full.from) from = full.from;
  if (from + span > full.to) from = full.to - span;
  return { from, to: from + span };
}

/** Zooms by `factor` (< 1 zooms in) keeping the day under `anchor` (0 = left edge, 1 = right edge) in place. */
export function zoomWindow(w: TimeWindow, factor: number, anchor: number, full: TimeWindow): TimeWindow {
  const span = w.to - w.from;
  const at = w.from + span * anchor;
  const next = span * factor;
  return clampWindow({ from: at - next * anchor, to: at - next * anchor + next }, full);
}

/** Moves the window by a number of days (negative: back in time). */
export function panWindow(w: TimeWindow, days: number, full: TimeWindow): TimeWindow {
  return clampWindow({ from: w.from + days, to: w.to + days }, full);
}

/** The last `days` days of the full range, or the whole range. */
export function presetWindow(days: number | "all", full: TimeWindow): TimeWindow {
  return days === "all" ? full : clampWindow({ from: full.to - days, to: full.to }, full);
}

export interface Tick {
  /** ISO date of the tick (first of a month). */
  date: string;
  day: number;
  /** "year": label with the year; "month": label with the month. */
  kind: "year" | "month";
}

/** Axis ticks for a window: years when wide, half-years in between, months when narrow. */
export function timeTicks(w: TimeWindow): Tick[] {
  const span = w.to - w.from;
  const step = span > 1100 ? 12 : span > 400 ? 6 : span > 150 ? 2 : 1;
  const start = new Date(w.from * 86_400_000);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1; // the next month start
  if (m > 11) {
    m = 0;
    y += 1;
  }
  const ticks: Tick[] = [];
  for (let guard = 0; guard < 400; guard++) {
    if (m % step === 0) {
      const date = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const day = dayNumber(date);
      if (day > w.to) break;
      if (day >= w.from) ticks.push({ date, day, kind: m === 0 ? "year" : "month" });
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return ticks;
}
