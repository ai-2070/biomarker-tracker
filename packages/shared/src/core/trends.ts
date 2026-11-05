import { DAILY_TOTAL_FIELDS, type BodyField } from "./body";
import { dayNumber, isIsoDate, todayIso } from "./dates";
import { ageAt, isBirthMonth } from "./phenoageDraws";
import type { BiomarkerDef, Measurement, Profile } from "./types";

export interface ResolvedRange {
  low?: number;
  high?: number;
  /** A descriptive population interval, not a limit for clinical low/high/normal flags. */
  comparisonOnly?: boolean;
  /** Where the range came from: the lab's own report, our typical adult range, or the person's own usual range (HRV). */
  source: "lab" | "default" | "personal";
}

/** Age in years on a date, from the profile's birth month; undefined when unknown. */
function ageOn(profile: Profile, date: string | undefined): number | undefined {
  if (!profile.birthMonth || !isBirthMonth(profile.birthMonth)) return undefined;
  return ageAt(profile.birthMonth, date && isIsoDate(date) ? date : todayIso());
}

/**
 * Pick the reference range for one measurement.
 * The lab's own range wins. Otherwise use the sex-specific default when the
 * profile has a sex, else the range that applies to everyone. If only
 * sex-specific ranges exist and sex is unknown, use the widest span of them.
 * Ranges with ages (body fat, sleep) apply at the person's age on the day measured;
 * outside every age band there is no range, and with age unknown the widest span is used.
 */
export function resolveRange(
  def: BiomarkerDef,
  m: Pick<Measurement, "labRange" | "fasted"> & { date?: string },
  profile: Profile = {},
): ResolvedRange | undefined {
  const lab = m.labRange;
  if (lab && (lab.low !== undefined || lab.high !== undefined)) {
    return { low: lab.low, high: lab.high, source: "lab" };
  }
  const all = def.defaultRanges ?? [];
  // Ranges for fasting or after-meal readings apply only to those; otherwise the plain ones.
  const forState = typeof m.fasted === "boolean" ? all.filter((r) => r.fasted === m.fasted) : [];
  const forAnyState = forState.length ? forState : all.filter((r) => r.fasted === undefined);
  const age = forAnyState.some((r) => r.ageFrom !== undefined || r.ageTo !== undefined) ? ageOn(profile, m.date) : undefined;
  const ranges = age === undefined ? forAnyState : forAnyState.filter((r) => (r.ageFrom ?? 0) <= age && age < (r.ageTo ?? Infinity));
  if (ranges.length === 0) return undefined;

  const bySex = profile.sex ? ranges.filter((r) => r.sex === profile.sex) : [];
  const general = ranges.filter((r) => r.sex === undefined);
  const pick = bySex.length ? bySex : general.length ? general : ranges;
  const comparison = def.comparisonOnly ? { comparisonOnly: true } : undefined;
  if (pick.length === 1) return { low: pick[0]!.low, high: pick[0]!.high, source: "default", ...comparison };

  const lows = pick.map((r) => r.low).filter((v): v is number => v !== undefined);
  const highs = pick.map((r) => r.high).filter((v): v is number => v !== undefined);
  return {
    low: lows.length ? Math.min(...lows) : undefined,
    high: highs.length ? Math.max(...highs) : undefined,
    source: "default",
    ...comparison,
  };
}

export type Flag = "normal" | "low" | "high" | "critical-low" | "critical-high" | "unknown";

export function flagValue(
  value: number,
  range: { low?: number; high?: number; comparisonOnly?: boolean } | undefined,
  critical?: { low?: number; high?: number; lowInclusive?: boolean; highInclusive?: boolean },
  qualifier?: Measurement["qualifier"],
): Flag {
  if (!Number.isFinite(value)) return "unknown";
  if (range?.comparisonOnly) range = undefined;
  if (qualifier === "<") {
    if (critical?.low !== undefined && value <= critical.low) return "critical-low";
    if (range?.low !== undefined && value <= range.low) return "low";
    return "unknown";
  }
  if (qualifier === ">") {
    if (critical?.high !== undefined && value >= critical.high) return "critical-high";
    if (range?.high !== undefined && value >= range.high) return "high";
    return "unknown";
  }
  if (critical?.low !== undefined && (value < critical.low || (critical.lowInclusive && value === critical.low))) return "critical-low";
  if (critical?.high !== undefined && (value > critical.high || (critical.highInclusive && value === critical.high))) return "critical-high";
  if (!range || (range.low === undefined && range.high === undefined)) return "unknown";
  if (range.low !== undefined && value < range.low) return "low";
  if (range.high !== undefined && value > range.high) return "high";
  return "normal";
}

/**
 * The flag of one reading. For markers judged on an average (sleep), one reading is only
 * flagged when it's critical: use `flagLatest` for the marker as a whole.
 */
export function flagMeasurement(def: BiomarkerDef, m: Measurement, profile: Profile = {}): Flag {
  if (def.judgeAverageOfDays || def.judgeSumOfDays) return flagValue(m.value, undefined, def.criticalRange, m.qualifier);
  return flagValue(m.value, resolveRange(def, m, profile), def.criticalRange, m.qualifier);
}

/**
 * Average of daily observations in the `days` days up to the latest one, with at least `min`
 * distinct dates. Sleep pieces, steps and active minutes add up per day; other readings average.
 */
export function recentAverage(series: readonly Measurement[], days = 7, min = 3): { value: number; count: number; from: string; to: string } | undefined {
  const sorted = sortByDate(series);
  const last = sorted.at(-1);
  if (!last) return undefined;
  const from = new Date(Date.parse(last.date) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const recent = sorted.filter((m) => m.date >= from);
  if (recent.some((m) => m.qualifier || !Number.isFinite(m.value))) return undefined;
  const daily = new Map<string, { sum: number; count: number }>();
  for (const m of recent) {
    const day = daily.get(m.date) ?? { sum: 0, count: 0 };
    day.sum += m.value;
    day.count++;
    daily.set(m.date, day);
  }
  if (daily.size < min) return undefined;
  const total = DAILY_TOTAL_FIELDS.has(last.biomarkerId as BodyField);
  let sum = 0;
  for (const day of daily.values()) sum += total ? day.sum : day.sum / day.count;
  return { value: sum / daily.size, count: daily.size, from, to: last.date };
}

/**
 * Total of the daily readings in the `days` days up to the latest one (e.g. a week of active minutes),
 * when at least `min` of those days have a reading; otherwise undefined. Days without a reading count
 * as nothing, so a week with gaps (the watch not worn) is reported with how many days it covers.
 */
export function recentTotal(series: readonly Measurement[], days = 7, min = 4): { value: number; days: number; from: string; to: string } | undefined {
  const sorted = sortByDate(series);
  const last = sorted.at(-1);
  if (!last) return undefined;
  const from = new Date(Date.parse(last.date) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const recent = sorted.filter((m) => m.date >= from);
  if (recent.some((m) => m.qualifier || !Number.isFinite(m.value))) return undefined;
  const covered = new Set(recent.map((m) => m.date)).size;
  if (covered < min) return undefined;
  return { value: recent.reduce((s, m) => s + m.value, 0), days: covered, from, to: last.date };
}

/**
 * The flag of a marker as it stands now: its latest reading, or for markers judged on an average
 * (sleep) the average of the last days, or on a total (active minutes) the last week's total, when
 * there are enough readings for one.
 */
export function flagLatest(def: BiomarkerDef, series: readonly Measurement[], profile: Profile = {}): Flag {
  const last = sortByDate(series).at(-1);
  if (!last) return "unknown";
  const single = flagMeasurement(def, last, profile);
  if (isCritical(single)) return single;
  if (def.judgeSumOfDays) {
    const total = recentTotal(series, def.judgeSumOfDays);
    return total ? flagValue(total.value, resolveRange(def, last, profile)) : "unknown";
  }
  if (!def.judgeAverageOfDays) return single;
  const avg = recentAverage(series, def.judgeAverageOfDays);
  return avg ? flagValue(avg.value, resolveRange(def, last, profile)) : "unknown";
}

export function isCritical(flag: Flag): boolean {
  return flag === "critical-low" || flag === "critical-high";
}

export function isOutOfRange(flag: Flag): boolean {
  return flag !== "normal" && flag !== "unknown";
}

/** Oldest first, then persisted save order; legacy rows with no order retain their input order. */
export function sortByDate<T extends Pick<Measurement, "date"> & { savedOrder?: number }>(ms: readonly T[]): T[] {
  return [...ms].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.savedOrder ?? 0) - (b.savedOrder ?? 0)));
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

/** Same canonical observation, including the distinction between an exact value and a bound. */
export function isAlreadySaved(existing: readonly Pick<Measurement, "biomarkerId" | "date" | "value" | "qualifier">[], m: Pick<Measurement, "biomarkerId" | "date" | "value" | "qualifier">): boolean {
  return existing.some(
    (e) => e.biomarkerId === m.biomarkerId && e.date === m.date && e.qualifier === m.qualifier && Math.abs(e.value - m.value) <= 1e-9 * Math.max(1, Math.abs(m.value)),
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
