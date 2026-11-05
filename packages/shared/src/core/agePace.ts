import { dayNumber } from "./dates";
import { t95 } from "./experiments";

/**
 * How fast PhenoAge changes per calendar year, from a person's own blood tests: the slope of PhenoAge
 * against time. 1.0 means PhenoAge rises in step with the calendar; below 1, slower. It is not
 * DunedinPACE (a DNA methylation test with its own method): it is the pace of one blood-test estimate,
 * and single PhenoAge values move with short-term things like an infection raising CRP, so the
 * interval around it is shown and is wide with few tests.
 */

export interface PacePoint {
  date: string;
  /** PhenoAge in years. */
  years: number;
  /** A CRP below the lab's limit made this PhenoAge approximate. */
  approximate?: boolean;
}

export interface AgePace {
  /** PhenoAge years per calendar year. */
  pace: number;
  /** 95% interval for the pace (t distribution, n − 2 degrees of freedom). */
  low: number;
  high: number;
  tests: number;
  /** How many of them were approximate. */
  approximate: number;
  from: string;
  to: string;
  /** Calendar years between the first and the last test used. */
  spanYears: number;
  /**
   * Faster or slower than the calendar only when the whole interval says so; "falling" when even its
   * top is below 0 (PhenoAge went down across these tests).
   */
  verdict: "falling" | "slower" | "faster" | "unclear";
}

const YEAR = 365.25;
/** Test dates wobble (a test "every 6 months" falls a few days either side), so limits allow two weeks. */
const SLACK_DAYS = 14;

/**
 * The pace over the tests in the last `windowYears` (default 3) up to the latest one. Needs at least
 * 3 tests spanning at least a year; otherwise undefined.
 */
export function phenoAgePace(points: readonly PacePoint[], windowYears = 3, minTests = 3, minSpanYears = 1): AgePace | undefined {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  if (!last) return undefined;
  const since = dayNumber(last.date) - windowYears * YEAR - SLACK_DAYS;
  const used = sorted.filter((p) => dayNumber(p.date) >= since);
  const n = used.length;
  if (n < minTests) return undefined;
  const xs = used.map((p) => (dayNumber(p.date) - dayNumber(used[0]!.date)) / YEAR);
  const spanYears = xs.at(-1)!;
  if (spanYears < minSpanYears - SLACK_DAYS / YEAR) return undefined;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = used.reduce((s, p) => s + p.years, 0) / n;
  let sxx = 0;
  let sxy = 0;
  used.forEach((p, i) => {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (p.years - my);
  });
  const pace = sxy / sxx;
  const sse = used.reduce((s, p, i) => s + (p.years - (my + pace * (xs[i]! - mx))) ** 2, 0);
  const se = Math.sqrt(sse / (n - 2) / sxx);
  const half = t95(n - 2) * se;
  const low = pace - half;
  const high = pace + half;
  return {
    pace,
    low,
    high,
    tests: n,
    approximate: used.filter((p) => p.approximate).length,
    from: used[0]!.date,
    to: last.date,
    spanYears,
    verdict: high < 0 ? "falling" : high < 1 ? "slower" : low > 1 ? "faster" : "unclear",
  };
}

// ---- DunedinPACE: your results by the Rejuvenation Olympics rule, and your plain average --------------

export interface DunedinSummary {
  /** Tests in the 2 years up to the latest test (each under 4 years old). */
  window: { from: string; to: string; tests: number };
  /** The plain average of those tests. */
  average: number;
  /**
   * The leaderboard rule ("average pace from best 3 tests over 2 years", at least 3 tests, each under 4
   * years old; rejuvenationolympics.com): the 3 lowest tests averaged. Undefined with fewer than 3.
   */
  bestThree?: { value: number; dates: string[] };
}

/**
 * Your DunedinPACE results summed up two ways. Taking only the best 3 tests picks the lucky ones, so the
 * leaderboard number is always at or below your plain average; both are shown.
 */
export function dunedinSummary(results: readonly { date: string; value: number }[], today: string): DunedinSummary | undefined {
  const fourYears = new Date(Date.parse(today) - 4 * YEAR * 86_400_000).toISOString().slice(0, 10);
  const recent = [...results].filter((r) => r.date >= fourYears && r.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const last = recent.at(-1);
  if (!last) return undefined;
  const twoYears = new Date(Date.parse(last.date) - 2 * YEAR * 86_400_000).toISOString().slice(0, 10);
  const used = recent.filter((r) => r.date >= twoYears);
  const average = used.reduce((s, r) => s + r.value, 0) / used.length;
  const best = [...used].sort((a, b) => a.value - b.value || a.date.localeCompare(b.date)).slice(0, 3);
  return {
    window: { from: used[0]!.date, to: last.date, tests: used.length },
    average,
    ...(best.length === 3 ? { bestThree: { value: best.reduce((s, r) => s + r.value, 0) / 3, dates: best.map((r) => r.date).sort() } } : {}),
  };
}
