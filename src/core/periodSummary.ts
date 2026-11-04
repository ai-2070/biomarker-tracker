/**
 * A summary of a year of blood tests, built for people who test a few times a year, not every month.
 *
 * Everything is compared test to test, never month to month: missing months are not filled in or averaged.
 * - Each marker uses its own results (ferritin once a year, blood counts twice).
 * - The year's results are compared with the period before (or, when it had none, the last earlier result),
 *   against normal test-to-test variation for the number of results on each side.
 * - A trend ("rising", "falling") only with at least 3 results spread over a year or more, using the same
 *   rule and 95% interval as the pace of PhenoAge (`phenoAgePace`), on log values (percent per year).
 * - Markers not measured in the period show their last result and how old it is. Explains, never diagnoses.
 */
import { phenoAgePace } from "./agePace";
import { addDays, daysBetween } from "./dates";
import { personalBand, rcvBand } from "./experiments";
import { flagMeasurement, isOutOfRange, sortByDate, type Flag } from "./trends";
import { formatValue } from "./units";
import type { BiomarkerDef, Measurement, Profile } from "./types";

export type Period = { kind: "rolling"; end: string } | { kind: "year"; year: number; today: string };

export interface PeriodMarker {
  id: string;
  name: string;
  category: string;
  /** Results in the period, oldest first. */
  results: Measurement[];
  /** How many of them were outside the range (critical included). */
  outside: number;
  last: Measurement;
  lastFlag: Flag;
  /** The period compared with the one before, or with the last earlier result when that period had none. */
  versusBefore?: {
    /** Geometric means (one result: the result itself). */
    now: number;
    before: number;
    nNow: number;
    nBefore: number;
    /** The last earlier result, when the period before had no result. */
    beforeDate?: string;
    changePercent: number;
    /** Undefined when normal variation for this marker isn't known. */
    beyondNormalVariation?: boolean;
  };
  /** Only with 3+ results over a year or more, up to the period's end (last 3 years). */
  trend?: { percentPerYear: number; low: number; high: number; tests: number; from: string; verdict: "rising" | "falling" | "unclear" };
}

export interface PeriodSummary {
  from: string;
  to: string;
  previous: { from: string; to: string };
  /** Blood test dates in the period, oldest first. */
  tests: string[];
  previousTests: string[];
  /** Measured in the period, grouped by category in the given order. */
  groups: { category: string; markers: PeriodMarker[] }[];
  /** Measured before but not in the period: the last result and its age. */
  notMeasured: { id: string; name: string; category: string; last: Measurement; lastFlag: Flag; monthsOld: number }[];
  questions: string[];
  limits: string[];
}

export const PERIOD_LIMITS: readonly string[] = [
  "With one or two tests a year, a change has to be large to stand out from normal test-to-test variation. 'Can't tell' is the honest answer for many results.",
  "Trends need at least 3 results spread over a year or more, and even then the range around them is wide.",
  "This summary explains what was measured and how it changed. It can't tell what is causing a result or a change; a doctor who knows you can.",
];

/** The period and the one before it. */
export function periodBounds(p: Period): { from: string; to: string; previous: { from: string; to: string } } {
  if (p.kind === "rolling") {
    const from = addDays(p.end, -364);
    return { from, to: p.end, previous: { from: addDays(from, -365), to: addDays(from, -1) } };
  }
  const end = `${p.year}-12-31`;
  return { from: `${p.year}-01-01`, to: end < p.today ? end : p.today, previous: { from: `${p.year - 1}-01-01`, to: `${p.year - 1}-12-31` } };
}

const geoMean = (xs: readonly number[]) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
const usable = (ms: readonly Measurement[]) => ms.filter((m) => !m.qualifier && m.value > 0);

function versusBefore(def: BiomarkerDef, now: readonly Measurement[], previous: readonly Measurement[], earlier: readonly Measurement[]): PeriodMarker["versusBefore"] {
  const a = usable(now).map((m) => m.value);
  const prev = usable(previous);
  const ref = prev.length ? prev : usable(earlier).slice(-1);
  const b = ref.map((m) => m.value);
  if (!a.length || !b.length) return undefined;
  const nowMean = geoMean(a);
  const beforeMean = geoMean(b);
  const rel = nowMean / beforeMean - 1;
  const band = def.biologicalVariation ? rcvBand(def.biologicalVariation.cvi, b.length, a.length) : personalBand(b, a);
  return {
    now: nowMean,
    before: beforeMean,
    nNow: a.length,
    nBefore: b.length,
    ...(prev.length ? {} : { beforeDate: ref[0]!.date }),
    changePercent: rel * 100,
    ...(band ? { beyondNormalVariation: rel > band.up || rel < band.down } : {}),
  };
}

function trendOf(ms: readonly Measurement[]): PeriodMarker["trend"] {
  const pts = usable(ms).map((m) => ({ date: m.date, years: Math.log(m.value) }));
  const pace = phenoAgePace(pts);
  if (!pace || !Number.isFinite(pace.low) || !Number.isFinite(pace.high)) return undefined;
  const pct = (x: number) => Math.expm1(x) * 100;
  return {
    percentPerYear: pct(pace.pace),
    low: pct(pace.low),
    high: pct(pace.high),
    tests: pace.tests,
    from: pace.from,
    verdict: pace.low > 0 ? "rising" : pace.high < 0 ? "falling" : "unclear",
  };
}

const inSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function buildPeriodSummary(input: {
  measurements: readonly Measurement[];
  defs: ReadonlyMap<string, BiomarkerDef>;
  profile: Profile;
  period: Period;
  categoryOrder?: readonly string[];
  formatDate?: (iso: string) => string;
}): PeriodSummary {
  const { defs, profile } = input;
  const fmtDate = input.formatDate ?? ((d: string) => d);
  const { from, to, previous } = periodBounds(input.period);
  const blood = sortByDate(input.measurements.filter((m) => {
    const def = defs.get(m.biomarkerId);
    return def && def.category !== "Body" && m.date <= to;
  }));
  const inRange = (a: string, b: string) => (m: Measurement) => m.date >= a && m.date <= b;
  const dates = (a: string, b: string) => [...new Set(blood.filter(inRange(a, b)).map((m) => m.date))].sort();

  const byMarker = new Map<string, Measurement[]>();
  for (const m of blood) byMarker.set(m.biomarkerId, [...(byMarker.get(m.biomarkerId) ?? []), m]);

  const measured: PeriodMarker[] = [];
  const notMeasured: PeriodSummary["notMeasured"] = [];
  for (const [id, ms] of byMarker) {
    const def = defs.get(id)!;
    const now = ms.filter(inRange(from, to));
    const before = ms.filter((m) => m.date < from);
    if (!now.length) {
      const last = before.at(-1)!;
      notMeasured.push({ id, name: def.name, category: def.category, last, lastFlag: flagMeasurement(def, last, profile), monthsOld: Math.floor(daysBetween(last.date, to) / 30.44) });
      continue;
    }
    const last = now.at(-1)!;
    const vb = versusBefore(def, now, before.filter(inRange(previous.from, previous.to)), before);
    const tr = trendOf(ms);
    measured.push({
      id,
      name: def.name,
      category: def.category,
      results: now,
      outside: now.filter((m) => isOutOfRange(flagMeasurement(def, m, profile))).length,
      last,
      lastFlag: flagMeasurement(def, last, profile),
      ...(vb ? { versusBefore: vb } : {}),
      ...(tr ? { trend: tr } : {}),
    });
  }

  const order = input.categoryOrder ?? [];
  const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  const categories = [...new Set(measured.map((m) => m.category))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const groups = categories.map((category) => ({ category, markers: measured.filter((m) => m.category === category).sort(byName) }));
  notMeasured.sort((a, b) => rank(a.category) - rank(b.category) || byName(a, b));

  return {
    from,
    to,
    previous,
    tests: dates(from, to),
    previousTests: dates(previous.from, previous.to),
    groups,
    notMeasured,
    questions: questionsFor(groups.flatMap((g) => g.markers), notMeasured, defs, fmtDate),
    limits: [...PERIOD_LIMITS],
  };
}

function questionsFor(measured: readonly PeriodMarker[], notMeasured: PeriodSummary["notMeasured"], defs: ReadonlyMap<string, BiomarkerDef>, fmtDate: (iso: string) => string): string[] {
  const qs: string[] = [];
  for (const m of measured) {
    const name = inSentence(m.name);
    if (m.outside > 0 && m.outside === m.results.length && m.results.length >= 2) {
      qs.push(`My ${name} was outside its range on ${m.results.length === 2 ? "both" : `all ${m.results.length}`} tests in this period. What could explain it, and does it need follow-up?`);
    } else if (m.trend && m.trend.verdict !== "unclear") {
      qs.push(`My ${name} has been ${m.trend.verdict} over ${m.trend.tests} tests since ${fmtDate(m.trend.from)}. Is that worth following up?`);
    } else if (isOutOfRange(m.lastFlag)) {
      const unit = defs.get(m.id)!.canonicalUnit;
      qs.push(`My latest ${name} was ${m.last.qualifier ?? ""}${formatValue(m.last.value)}${unit === "ratio" ? "" : ` ${unit}`}, outside its range. Should it be re-tested?`);
    }
  }
  for (const n of notMeasured) {
    if (isOutOfRange(n.lastFlag)) qs.push(`My ${inSentence(n.name)} was outside its range when last tested, on ${fmtDate(n.last.date)}, and hasn't been tested since. Should it be re-tested?`);
  }
  qs.push("How often should my blood tests be repeated, and which ones?");
  return qs;
}
