import { sortByDate } from "./trends";
import type { Measurement } from "./types";

/**
 * A person's usual range for a measurement that has no useful population range (HRV: it differs a
 * lot between people and falls with age). Built from their own readings, the way HRV is followed in
 * training studies: log-transformed values, a baseline of recent weeks, and a 7-day average compared
 * with it rather than single days (Plews 2013, PMID 23852425; Buchheit 2014, PMID 24578692).
 *
 * Usual range = mean ± 1 standard deviation of the log values in the 60 days before the last week,
 * about the middle two-thirds of those days. It describes this person, it isn't a medical range,
 * and nothing is flagged as out of range because of it.
 */

export const PERSONAL_RANGE = { baselineDays: 60, recentDays: 7, minBaseline: 14, minRecent: 3 } as const;

export interface PersonalRange {
  low: number;
  high: number;
  /** The baseline: readings and dates it was built from. */
  baseline: { count: number; from: string; to: string };
  /** Average of the last week (geometric mean, like the baseline), and where it falls. */
  recent?: { value: number; count: number; from: string; to: string; position: "below" | "within" | "above" };
}

const DAY = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString().slice(0, 10);

export function personalRange(series: readonly Measurement[]): PersonalRange | undefined {
  // One observation per date: repeated readings must not create extra baseline coverage or weight.
  const daily = new Map<string, { reading: Measurement; sum: number; count: number }>();
  for (const m of sortByDate(series)) {
    if (!(m.value > 0) || !Number.isFinite(m.value) || m.qualifier) continue;
    const day = daily.get(m.date) ?? { reading: m, sum: 0, count: 0 };
    day.sum += m.value;
    day.count++;
    daily.set(m.date, day);
  }
  const sorted = [...daily.values()].map(({ reading, sum, count }) => ({ ...reading, value: sum / count }));
  const last = sorted.at(-1);
  if (!last) return undefined;
  const recentFrom = shift(last.date, -(PERSONAL_RANGE.recentDays - 1));
  const baseFrom = shift(recentFrom, -PERSONAL_RANGE.baselineDays);
  const base = sorted.filter((m) => m.date >= baseFrom && m.date < recentFrom);
  if (base.length < PERSONAL_RANGE.minBaseline) return undefined;

  const logs = base.map((m) => Math.log(m.value));
  const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
  const sd = Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / (logs.length - 1));
  const low = Math.exp(mean - sd);
  const high = Math.exp(mean + sd);
  const out: PersonalRange = { low, high, baseline: { count: base.length, from: base[0]!.date, to: base.at(-1)!.date } };

  const recent = sorted.filter((m) => m.date >= recentFrom);
  if (recent.length >= PERSONAL_RANGE.minRecent) {
    const value = Math.exp(recent.reduce((s, m) => s + Math.log(m.value), 0) / recent.length);
    out.recent = { value, count: recent.length, from: recent[0]!.date, to: last.date, position: value < low ? "below" : value > high ? "above" : "within" };
  }
  return out;
}
