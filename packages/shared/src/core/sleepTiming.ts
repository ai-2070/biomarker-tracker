import { PLAUSIBLE } from "./body";
import { dayNumber, isIsoDate } from "./dates";
import { sleepLocalTime, validSleepSessions } from "./sleepSessions";
import { sortByDate } from "./trends";
import type { Measurement, SleepSession } from "./types";

const HOUR = 3_600_000;

export interface SleepNight {
  date: string;
  day: number;
  measurement: Measurement;
  main: SleepSession;
  windows: { start: number; end: number; kind: SleepSession["kind"]; main: boolean }[];
  start: number;
  end: number;
  midpoint: number;
  /** Signed shortest clock change: positive is later, negative is earlier. */
  startShiftMinutes?: number;
  endShiftMinutes?: number;
  midpointShiftMinutes?: number;
}

export interface SleepTimingSummary {
  nights: SleepNight[];
  regularity: { pairs: number; startShiftMinutes?: number; endShiftMinutes?: number; midpointShiftMinutes?: number };
  durationOnlyNights: number;
  invalidNights: number;
}

export type SleepCardiacMetric = "resting_hr" | "hrv_resting";
export type SleepTimingMetric = "start" | "end" | "midpoint" | "shift";

/** Longest recorded window, not an estimate of sleep onset from the daily duration. */
export function buildSleepTiming(measurements: readonly Measurement[], options: { from?: string; to?: string; today?: string } = {}): SleepTimingSummary {
  const result: SleepTimingSummary = { nights: [], regularity: { pairs: 0 }, durationOnlyNights: 0, invalidNights: 0 };
  const shifts = { start: 0, end: 0, midpoint: 0 };
  for (const m of dailyWinners(measurements, "sleep_duration").values()) {
    if (!isIsoDate(m.date)) {
      result.invalidNights++;
      continue;
    }
    if ((options.from && m.date < options.from) || (options.to && m.date > options.to) || (options.today && m.date > options.today)) continue;
    if (m.qualifier !== undefined || !Number.isFinite(m.value) || m.value <= 0) {
      result.invalidNights++;
      continue;
    }
    if (m.sleepSessions === undefined) {
      result.durationOnlyNights++;
      continue;
    }
    if (!validSleepSessions(m.sleepSessions, m.biomarkerId, m.date)) {
      result.invalidNights++;
      continue;
    }
    const day = dayNumber(m.date);
    const midnight = day * 24 * HOUR;
    const windows = m.sleepSessions.map((session) => {
      const start = sleepLocalTime(session.start)!;
      const end = sleepLocalTime(session.end)!;
      const elapsed =
        end -
        start -
        (session.startOffsetMinutes !== undefined && session.endOffsetMinutes !== undefined
          ? (session.endOffsetMinutes - session.startOffsetMinutes) * 60_000
          : 0);
      return { session, start, end, elapsed };
    });
    // Stable tie-breaks keep a provider's record order from changing the principal window.
    const main = windows.reduce((a, b) => {
      const kindOrder = a.session.kind < b.session.kind ? -1 : a.session.kind > b.session.kind ? 1 : 0;
      const sourceA = a.session.source ?? "",
        sourceB = b.session.source ?? "";
      const order =
        b.elapsed - a.elapsed ||
        b.end - a.end ||
        b.start - a.start ||
        kindOrder ||
        (sourceA < sourceB ? -1 : sourceA > sourceB ? 1 : 0) ||
        (a.session.startOffsetMinutes ?? 0) - (b.session.startOffsetMinutes ?? 0) ||
        (a.session.endOffsetMinutes ?? 0) - (b.session.endOffsetMinutes ?? 0);
      return order <= 0 ? a : b;
    });
    const start = (main.start - midnight) / HOUR,
      end = (main.end - midnight) / HOUR;
    const night: SleepNight = {
      date: m.date,
      day,
      measurement: m,
      main: main.session,
      windows: windows.map((w) => ({ start: (w.start - midnight) / HOUR, end: (w.end - midnight) / HOUR, kind: w.session.kind, main: w === main })),
      start,
      end,
      midpoint: (start + end) / 2,
    };
    const previous = result.nights.at(-1);
    if (
      previous &&
      night.day - previous.day === 1 &&
      night.main.kind === previous.main.kind &&
      night.main.source?.trim() &&
      night.main.source === previous.main.source
    ) {
      night.startShiftMinutes = clockShift(previous.start, night.start);
      night.endShiftMinutes = clockShift(previous.end, night.end);
      night.midpointShiftMinutes = clockShift(previous.midpoint, night.midpoint);
      shifts.start += Math.abs(night.startShiftMinutes);
      shifts.end += Math.abs(night.endShiftMinutes);
      shifts.midpoint += Math.abs(night.midpointShiftMinutes);
      result.regularity.pairs++;
    }
    result.nights.push(night);
  }
  const pairs = result.regularity.pairs;
  if (pairs) {
    result.regularity.startShiftMinutes = shifts.start / pairs;
    result.regularity.endShiftMinutes = shifts.end / pairs;
    result.regularity.midpointShiftMinutes = shifts.midpoint / pairs;
  }
  return result;
}

/** Same waking date only; these resting measurements need not cover the same sleep window. */
export function pairSleepCardiac(
  nights: readonly SleepNight[],
  measurements: readonly Measurement[],
  metric: SleepCardiacMetric,
  timing: SleepTimingMetric,
): { points: { date: string; x: number; y: number; sleep: SleepNight; measurement: Measurement }[]; excluded: number } {
  const points: { date: string; x: number; y: number; sleep: SleepNight; measurement: Measurement }[] = [];
  if (metric !== "resting_hr" && metric !== "hrv_resting") return { points, excluded: nights.length };
  const winners = dailyWinners(measurements, metric);
  const range = PLAUSIBLE[metric];
  for (const sleep of nights) {
    const measurement = winners.get(sleep.date);
    const x = timing === "shift" ? sleep.midpointShiftMinutes : sleep[timing];
    if (
      !measurement ||
      !isIsoDate(measurement.date) ||
      measurement.qualifier !== undefined ||
      !Number.isFinite(measurement.value) ||
      measurement.value < range.min ||
      measurement.value > range.max ||
      x === undefined ||
      !Number.isFinite(x)
    )
      continue;
    points.push({ date: sleep.date, x, y: measurement.value, sleep, measurement });
  }
  return { points, excluded: nights.length - points.length };
}

/** A source-local clock, wrapped at midnight; rounding can carry into the following day. */
export function sleepClock(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  const minutes = Math.round((((hours % 24) + 24) % 24) * 60 + 1e-9) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function dailyWinners(measurements: readonly Measurement[], id: string): Map<string, Measurement> {
  const winners = new Map<string, Measurement>();
  for (const m of sortByDate(measurements.filter((m) => m.biomarkerId === id))) winners.set(m.date, m);
  return winners;
}

// The half-day tie is always earlier (−720), rather than depending on input sign.
function clockShift(previous: number, current: number): number {
  return (((((current - previous) * 60 + 720) % 1440) + 1440) % 1440) - 720;
}
