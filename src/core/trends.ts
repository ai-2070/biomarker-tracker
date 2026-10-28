import { dayNumber } from "./dates";
import type { BiomarkerDef, Measurement, Profile } from "./types";

export interface ResolvedRange {
  low?: number;
  high?: number;
  /** Where the range came from: the lab's own report, or our typical adult range. */
  source: "lab" | "default";
}

/**
 * Pick the reference range for one measurement.
 * The lab's own range wins. Otherwise use the sex-specific default when the
 * profile has a sex, else the range that applies to everyone. If only
 * sex-specific ranges exist and sex is unknown, use the widest span of them.
 */
export function resolveRange(
  def: BiomarkerDef,
  m: Pick<Measurement, "labRange" | "fasted">,
  profile: Profile = {},
): ResolvedRange | undefined {
  const lab = m.labRange;
  if (lab && (lab.low !== undefined || lab.high !== undefined)) {
    return { low: lab.low, high: lab.high, source: "lab" };
  }
  const all = def.defaultRanges ?? [];
  // Ranges for fasting or after-meal readings apply only to those; otherwise the plain ones.
  const forState = typeof m.fasted === "boolean" ? all.filter((r) => r.fasted === m.fasted) : [];
  const ranges = forState.length ? forState : all.filter((r) => r.fasted === undefined);
  if (ranges.length === 0) return undefined;

  const bySex = profile.sex ? ranges.find((r) => r.sex === profile.sex) : undefined;
  const general = ranges.find((r) => r.sex === undefined);
  const pick = bySex ?? general;
  if (pick) return { low: pick.low, high: pick.high, source: "default" };

  const lows = ranges.map((r) => r.low).filter((v): v is number => v !== undefined);
  const highs = ranges.map((r) => r.high).filter((v): v is number => v !== undefined);
  return {
    low: lows.length ? Math.min(...lows) : undefined,
    high: highs.length ? Math.max(...highs) : undefined,
    source: "default",
  };
}

export type Flag = "normal" | "low" | "high" | "critical-low" | "critical-high" | "unknown";

export function flagValue(
  value: number,
  range: { low?: number; high?: number } | undefined,
  critical?: { low?: number; high?: number },
): Flag {
  if (critical?.low !== undefined && value < critical.low) return "critical-low";
  if (critical?.high !== undefined && value > critical.high) return "critical-high";
  if (!range || (range.low === undefined && range.high === undefined)) return "unknown";
  if (range.low !== undefined && value < range.low) return "low";
  if (range.high !== undefined && value > range.high) return "high";
  return "normal";
}

export function flagMeasurement(def: BiomarkerDef, m: Measurement, profile: Profile = {}): Flag {
  return flagValue(m.value, resolveRange(def, m, profile), def.criticalRange);
}

export function isCritical(flag: Flag): boolean {
  return flag === "critical-low" || flag === "critical-high";
}

export function isOutOfRange(flag: Flag): boolean {
  return flag !== "normal" && flag !== "unknown";
}

/** Oldest first; same-day entries keep their insertion order. */
export function sortByDate<T extends Pick<Measurement, "date">>(ms: readonly T[]): T[] {
  return [...ms].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface Trend {
  count: number;
  latest: Measurement;
  previous?: Measurement;
  /** latest − previous, canonical unit. */
  change?: number;
  /** Change as a percentage of the previous value. Undefined if previous is 0. */
  percentChange?: number;
  daysSincePrevious?: number;
  /** Least-squares slope over all points, canonical unit per year. Needs 2+ dates. */
  ratePerYear?: number;
  firstDate: string;
  lastDate: string;
}

/** Linear regression slope of y on x. Undefined when x has no spread. */
export function slope(points: readonly { x: number; y: number }[]): number | undefined {
  const n = points.length;
  if (n < 2) return undefined;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  return sxx === 0 ? undefined : sxy / sxx;
}

export function computeTrend(measurements: readonly Measurement[]): Trend | undefined {
  if (measurements.length === 0) return undefined;
  const sorted = sortByDate(measurements);
  const latest = sorted[sorted.length - 1]!;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;

  const perDay = slope(sorted.map((m) => ({ x: dayNumber(m.date), y: m.value })));

  const trend: Trend = {
    count: sorted.length,
    latest,
    firstDate: sorted[0]!.date,
    lastDate: latest.date,
    ratePerYear: perDay === undefined ? undefined : perDay * 365.25,
  };
  if (previous) {
    trend.previous = previous;
    trend.change = latest.value - previous.value;
    trend.percentChange =
      previous.value === 0 ? undefined : ((latest.value - previous.value) / previous.value) * 100;
    trend.daysSincePrevious = dayNumber(latest.date) - dayNumber(previous.date);
  }
  return trend;
}

/** True if `existing` already has this marker on this date with the same value. */
export function isAlreadySaved(existing: readonly Measurement[], m: Pick<Measurement, "biomarkerId" | "date" | "value">): boolean {
  return existing.some(
    (e) => e.biomarkerId === m.biomarkerId && e.date === m.date && Math.abs(e.value - m.value) <= 1e-9 * Math.max(1, Math.abs(m.value)),
  );
}

/** The most recent measurement per biomarker. */
export function latestByBiomarker(ms: readonly Measurement[]): Map<string, Measurement> {
  const out = new Map<string, Measurement>();
  for (const m of sortByDate(ms)) out.set(m.biomarkerId, m);
  return out;
}

/**
 * Y-axis bounds that fit all values plus the reference range, with some
 * headroom. Never goes below zero, since no tracked marker can be negative.
 */
export function paddedDomain(values: readonly number[], pad = 0.15): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || Math.abs(max) || 1;
  return [Math.max(0, min - span * pad), max + span * pad];
}

/** Group measurements by biomarker id. */
export function groupByBiomarker(ms: readonly Measurement[]): Map<string, Measurement[]> {
  const out = new Map<string, Measurement[]>();
  for (const m of ms) {
    const list = out.get(m.biomarkerId);
    if (list) list.push(m);
    else out.set(m.biomarkerId, [m]);
  }
  return out;
}
