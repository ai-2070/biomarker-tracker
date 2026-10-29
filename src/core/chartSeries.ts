import { dayNumber } from "./dates";

/**
 * What a marker chart shows: each reading, or averages per week or month (for daily readings from a
 * watch, where single days are noisy). Pure helpers; the chart only draws.
 */

export type Grouping = "each" | "week" | "month";

export interface Reading {
  date: string;
  value: number;
}

export interface ChartPoint {
  /** Where the point is drawn: the reading's date, or the middle of the readings it averages. */
  date: string;
  value: number;
  /** Readings behind the point (1 for a single reading). */
  count: number;
  /** First and last reading it covers. */
  from: string;
  to: string;
}

const isoOfDay = (day: number) => new Date(Math.round(day) * 86_400_000).toISOString().slice(0, 10);

/** The week (starting Monday) or month a date belongs to. */
function bucketOf(date: string, by: "week" | "month"): string {
  if (by === "month") return date.slice(0, 7);
  const day = dayNumber(date);
  // Day 0 (1970-01-01) was a Thursday: Monday is 3 days before it.
  return isoOfDay(day - ((((day + 3) % 7) + 7) % 7));
}

/** Readings as chart points, one per reading or averaged per week or month. Oldest first. */
export function groupReadings(readings: readonly Reading[], by: Grouping): ChartPoint[] {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  if (by === "each") return sorted.map((r) => ({ date: r.date, value: r.value, count: 1, from: r.date, to: r.date }));
  const buckets = new Map<string, Reading[]>();
  for (const r of sorted) {
    const k = bucketOf(r.date, by);
    const list = buckets.get(k);
    if (list) list.push(r);
    else buckets.set(k, [r]);
  }
  return [...buckets.values()].map((rs) => ({
    date: isoOfDay(rs.reduce((s, r) => s + dayNumber(r.date), 0) / rs.length),
    value: rs.reduce((s, r) => s + r.value, 0) / rs.length,
    count: rs.length,
    from: rs[0]!.date,
    to: rs.at(-1)!.date,
  }));
}

/** Groupings worth offering: averaging only helps when some week (or month) has more than one reading. */
export function groupingsFor(readings: readonly Reading[]): Grouping[] {
  const has = (by: "week" | "month") => {
    const seen = new Set<string>();
    for (const r of readings) {
      const k = bucketOf(r.date, by);
      if (seen.has(k)) return true;
      seen.add(k);
    }
    return false;
  };
  const out: Grouping[] = ["each"];
  if (has("week")) out.push("week");
  if (has("month")) out.push("month");
  return out;
}

export interface PeriodStats {
  count: number;
  average: number;
  low: Reading;
  high: Reading;
  /** The first and last reading in the period, and the change between them (last − first). */
  first: Reading;
  last: Reading;
  change: number;
}

/** Count, average, lowest, highest, first and last of the readings between two dates (inclusive). */
export function statsBetween(readings: readonly Reading[], from: string, to: string): PeriodStats | undefined {
  const inside = readings.filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  if (inside.length === 0) return undefined;
  let low = inside[0]!;
  let high = inside[0]!;
  for (const r of inside) {
    if (r.value < low.value) low = r;
    if (r.value > high.value) high = r;
  }
  const first = inside[0]!;
  const last = inside.at(-1)!;
  return { count: inside.length, average: inside.reduce((s, r) => s + r.value, 0) / inside.length, low, high, first, last, change: last.value - first.value };
}

/**
 * Points to draw for a time window: those inside it, plus the nearest one on each side so the
 * line runs on to the edges instead of stopping short.
 */
export function pointsForWindow<T extends { date: string }>(points: readonly T[], from: string, to: string): T[] {
  const first = points.findIndex((p) => p.date >= from);
  if (first === -1) return points.length ? [points.at(-1)!] : [];
  let last = first;
  while (last + 1 < points.length && points[last + 1]!.date <= to) last++;
  if (points[first]!.date > to) last = first - 1;
  return points.slice(Math.max(0, first - 1), Math.min(points.length, last + 2));
}
