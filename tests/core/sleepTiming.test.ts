import { dayNumber } from "@bt/shared/core/dates";
import { buildSleepTiming, pairSleepCardiac, type SleepCardiacMetric, sleepClock } from "@bt/shared/core/sleepTiming";
import type { Measurement, SleepSession } from "@bt/shared/core/types";
import { describe, expect, it } from "vitest";

function session(start: string, end: string, extra: Partial<SleepSession> = {}): SleepSession {
  return { start, end, kind: "asleep", source: "Watch A", ...extra };
}

function reading(date: string, extra: Partial<Measurement> = {}): Measurement {
  return { id: `sleep-${date}`, biomarkerId: "sleep_duration", date, value: 8, originalValue: 8, originalUnit: "h", source: "device", ...extra };
}

function night(date: string, start: string, end: string, extra: Partial<SleepSession> = {}): Measurement {
  return reading(date, { sleepSessions: [session(start, end, extra)] });
}

function cardiac(date: string, value: number, biomarkerId = "resting_hr", extra: Partial<Measurement> = {}): Measurement {
  return reading(date, {
    id: `${biomarkerId}-${date}`,
    biomarkerId,
    value,
    originalValue: value,
    originalUnit: biomarkerId === "resting_hr" ? "bpm" : "ms",
    ...extra,
  });
}

const first = night("2026-10-24", "2026-10-23T23:00:00", "2026-10-24T07:00:00");
const second = night("2026-10-25", "2026-10-25T00:00:00", "2026-10-25T08:00:00");

describe("source-local sleep windows", () => {
  it("plots previous-day starts across midnight, without using the computer's zone", () => {
    const result = buildSleepTiming([second, first]);
    expect(result.nights.map((n) => n.date)).toEqual(["2026-10-24", "2026-10-25"]);
    expect(result.nights[0]).toMatchObject({
      day: dayNumber(first.date),
      start: -1,
      end: 7,
      midpoint: 3,
      windows: [{ start: -1, end: 7, kind: "asleep", main: true }],
    });
    expect(result.nights[0]!.main).toBe(first.sleepSessions![0]);
    expect(result.nights[0]!.measurement).toBe(first);
    expect(result.nights[1]).toMatchObject({ start: 0, end: 8, midpoint: 4, startShiftMinutes: 60, endShiftMinutes: 60, midpointShiftMinutes: 60 });
  });

  it("does not force daytime sleepers into a nighttime schedule", () => {
    const result = buildSleepTiming([night("2026-10-24", "2026-10-24T08:30:00", "2026-10-24T16:30:00")]);
    expect(result.nights[0]).toMatchObject({ start: 8.5, end: 16.5, midpoint: 12.5 });
    expect(result.regularity).toEqual({ pairs: 0 });
  });

  it("keeps naps separate, choosing the longest session rather than averaging windows", () => {
    const main = session("2026-10-23T23:00:00", "2026-10-24T06:00:00");
    const nap = session("2026-10-24T14:00:00", "2026-10-24T15:00:00");
    const result = buildSleepTiming([reading(first.date, { sleepSessions: [nap, main] })]);
    expect(result.nights[0]).toMatchObject({ main, start: -1, end: 6, midpoint: 2.5 });
    expect(result.nights[0]!.windows).toEqual([
      { start: 14, end: 15, kind: "asleep", main: false },
      { start: -1, end: 6, kind: "asleep", main: true },
    ]);
  });

  it("breaks longest-session ties at the later end regardless of array order", () => {
    const early = session("2026-10-24T00:00:00", "2026-10-24T04:00:00");
    const late = session("2026-10-24T12:00:00", "2026-10-24T16:00:00", { kind: "in-bed", source: "Ring" });
    for (const windows of [
      [early, late],
      [late, early],
    ]) {
      const result = buildSleepTiming([reading(first.date, { sleepSessions: windows })]);
      expect(result.nights[0]!.main).toBe(late);
      expect(result.nights[0]!.windows.filter((w) => w.main)).toHaveLength(1);
    }
  });

  it("uses elapsed duration to choose the main session only when both offsets are recorded", () => {
    const offset = session("2026-10-23T23:00:00", "2026-10-24T07:00:00", { startOffsetMinutes: 120, endOffsetMinutes: 60 });
    const other = session("2026-10-24T09:00:00", "2026-10-24T17:30:00");
    const known = buildSleepTiming([reading(first.date, { sleepSessions: [offset, other] })]);
    expect(known.nights[0]).toMatchObject({ main: offset, start: -1, end: 7, midpoint: 3 });
    const oneOffset = { ...offset, endOffsetMinutes: undefined };
    expect(buildSleepTiming([reading(first.date, { sleepSessions: [oneOffset, other] })]).nights[0]!.main).toBe(other);
  });

  it("retains wall-clock bounds across offset changes instead of moving clocks by an hour", () => {
    const a = night("2026-10-24", "2026-10-23T23:00:00", "2026-10-24T07:00:00", { startOffsetMinutes: 120, endOffsetMinutes: 120 });
    const b = night("2026-10-25", "2026-10-24T23:00:00", "2026-10-25T07:00:00", { startOffsetMinutes: 120, endOffsetMinutes: 60 });
    expect(buildSleepTiming([a, b]).regularity).toEqual({ pairs: 1, startShiftMinutes: 0, endShiftMinutes: 0, midpointShiftMinutes: 0 });
    const folded = night("2026-10-25", "2026-10-25T01:50:00", "2026-10-25T01:20:00", { startOffsetMinutes: 120, endOffsetMinutes: 60 });
    const n = buildSleepTiming([folded]).nights[0]!;
    expect(n.start).toBeCloseTo(1 + 50 / 60);
    expect(n.end).toBeCloseTo(1 + 20 / 60);
    expect(n.midpoint).toBeCloseTo(1 + 35 / 60);
  });

  it("respects selected inclusive dates and today, never using a future night", () => {
    const future = night("2026-10-26", "2026-10-25T23:00:00", "2026-10-26T07:00:00");
    const selected = buildSleepTiming([first, second, future], { from: second.date, to: future.date, today: second.date });
    expect(selected.nights.map((n) => n.date)).toEqual([second.date]);
    expect(selected.regularity).toEqual({ pairs: 0 });
    expect(buildSleepTiming([first, second], { from: second.date, to: first.date }).nights).toEqual([]);
  });

  it("requires valid positive unqualified readings and real source-local timestamps", () => {
    const invalid = [
      reading("2026-02-30"),
      reading("not-a-date"),
      { ...first, value: 0 },
      { ...first, value: -1 },
      { ...first, value: NaN },
      { ...first, value: Infinity },
      { ...first, qualifier: "<" as const },
      { ...first, qualifier: ">" as const },
      { ...first, sleepSessions: [] },
      { ...first, sleepSessions: [session("2026-10-23T23:00:00Z", "2026-10-24T07:00:00")] },
      { ...first, sleepSessions: [session("2026-10-23T23:00:00", "2026-10-25T07:00:00")] },
      { ...first, sleepSessions: [session("2026-10-23T23:00:00", "2026-10-24T25:00:00")] },
    ];
    for (const value of invalid) expect(buildSleepTiming([value])).toEqual({ nights: [], regularity: { pairs: 0 }, durationOnlyNights: 0, invalidNights: 1 });
    expect(buildSleepTiming([reading(first.date)])).toMatchObject({ durationOnlyNights: 1, invalidNights: 0, nights: [] });
    expect(buildSleepTiming([{ ...first, biomarkerId: "sleep_deep" }])).toMatchObject({ durationOnlyNights: 0, invalidNights: 0, nights: [] });
  });

  it("honours structural session limits without inventing sleep from malformed metadata", () => {
    const longest = session("2026-10-23T00:00:00", "2026-10-24T12:00:00");
    expect(buildSleepTiming([reading(first.date, { sleepSessions: [longest] })]).nights).toHaveLength(1);
    expect(buildSleepTiming([reading(first.date, { sleepSessions: [{ ...longest, end: "2026-10-24T12:00:01" }] })]).invalidNights).toBe(1);
    const windows = Array.from({ length: 64 }, () => first.sleepSessions![0]!);
    expect(buildSleepTiming([reading(first.date, { sleepSessions: windows })]).nights[0]!.windows).toHaveLength(64);
    expect(buildSleepTiming([reading(first.date, { sleepSessions: [...windows, windows[0]!] })]).invalidNights).toBe(1);
    expect(buildSleepTiming([{ ...first, sleepSessions: [{ ...first.sleepSessions![0]!, startOffsetMinutes: 841 }] }]).invalidNights).toBe(1);
    expect(buildSleepTiming([{ ...first, sleepSessions: [{ ...first.sleepSessions![0]!, source: "x".repeat(201) }] }]).invalidNights).toBe(1);
  });
});

describe("adjacent-night clock regularity", () => {
  it("uses shortest circular differences and averages magnitudes, not signed changes", () => {
    const a = night("2026-10-24", "2026-10-23T23:30:00", "2026-10-24T00:30:00");
    const b = night("2026-10-25", "2026-10-25T00:30:00", "2026-10-25T01:30:00");
    const c = night("2026-10-26", "2026-10-25T23:30:00", "2026-10-26T00:30:00");
    const result = buildSleepTiming([a, b, c]);
    expect(result.nights[1]).toMatchObject({ startShiftMinutes: 60, endShiftMinutes: 60, midpointShiftMinutes: 60 });
    expect(result.nights[2]).toMatchObject({ startShiftMinutes: -60, endShiftMinutes: -60, midpointShiftMinutes: -60 });
    expect(result.regularity).toEqual({ pairs: 2, startShiftMinutes: 60, endShiftMinutes: 60, midpointShiftMinutes: 60 });
  });

  it("chooses the same negative direction at an exact half-day tie", () => {
    const daytime = night("2026-10-25", "2026-10-25T11:00:00", "2026-10-25T19:00:00");
    expect(buildSleepTiming([first, daytime]).nights[1]).toMatchObject({ startShiftMinutes: -720, endShiftMinutes: -720, midpointShiftMinutes: -720 });
  });

  it("wraps a clock jump longer than twelve hours to the shorter direction", () => {
    const a = night("2026-10-24", "2026-10-24T20:00:00", "2026-10-24T21:00:00");
    const b = night("2026-10-25", "2026-10-25T06:00:00", "2026-10-25T07:00:00");
    expect(buildSleepTiming([a, b]).nights[1]).toMatchObject({ startShiftMinutes: 600, endShiftMinutes: 600, midpointShiftMinutes: 600 });
    const c = night("2026-10-26", "2026-10-26T20:00:00", "2026-10-26T21:00:00");
    expect(buildSleepTiming([b, c]).nights[1]).toMatchObject({ startShiftMinutes: -600, endShiftMinutes: -600, midpointShiftMinutes: -600 });
  });

  it("does not bridge gaps, unknown sources, provider changes or different window kinds", () => {
    const variants = [
      { ...second, date: "2026-10-26", sleepSessions: [session("2026-10-26T00:00:00", "2026-10-26T08:00:00")] },
      { ...second, sleepSessions: [{ ...second.sleepSessions![0]!, source: "Watch B" }] },
      { ...second, sleepSessions: [{ ...second.sleepSessions![0]!, kind: "in-bed" as const }] },
      { ...second, sleepSessions: [{ ...second.sleepSessions![0]!, kind: "session" as const }] },
    ];
    for (const other of variants) {
      const result = buildSleepTiming([first, other]);
      expect(result.nights).toHaveLength(2);
      expect(result.regularity).toEqual({ pairs: 0 });
      expect(result.nights[1]).not.toHaveProperty("midpointShiftMinutes");
    }
    for (const source of [undefined, "", "   "]) {
      const result = buildSleepTiming([first, second].map((m) => ({ ...m, sleepSessions: [{ ...m.sleepSessions![0]!, source }] })));
      expect(result.regularity).toEqual({ pairs: 0 });
    }
    const changedNap = {
      ...second,
      sleepSessions: [...second.sleepSessions!, session("2026-10-25T13:00:00", "2026-10-25T14:00:00", { source: "Ring", kind: "in-bed" })],
    };
    expect(buildSleepTiming([first, changedNap]).regularity.pairs).toBe(1);
  });

  it("uses persisted latest winners before exclusions, never resurrecting older timings", () => {
    const old = { ...first, savedOrder: 2 };
    const missing = reading(first.date, { savedOrder: 4 });
    const qualified = { ...first, savedOrder: 4, qualifier: "<" as const };
    const malformed = { ...first, savedOrder: 4, sleepSessions: [] };
    for (const winner of [missing, qualified, malformed]) {
      const result = buildSleepTiming([winner, second, old]);
      expect(result.nights.map((n) => n.date)).toEqual([second.date]);
      expect(result.regularity).toEqual({ pairs: 0 });
      expect(result.durationOnlyNights).toBe(winner === missing ? 1 : 0);
      expect(result.invalidNights).toBe(winner === missing ? 0 : 1);
    }
    // Legacy equal-order rows follow their saved input order too.
    expect(buildSleepTiming([first, reading(first.date)]).durationOnlyNights).toBe(1);
    expect(buildSleepTiming([reading(first.date), first]).nights).toHaveLength(1);
  });
});

describe("explicit resting measurements on the waking date", () => {
  const nights = buildSleepTiming([first, second]).nights;

  it("pairs the selected clock coordinate and the exact resting marker only", () => {
    const measurements = [
      cardiac(first.date, 55),
      cardiac(second.date, 58),
      cardiac(first.date, 40, "hrv_resting"),
      cardiac(first.date, 99, "heart_rate"),
      cardiac(first.date, 99, "exercise_hr"),
      cardiac(first.date, 99, "hrv"),
    ];
    const start = pairSleepCardiac(nights, measurements, "resting_hr", "start");
    expect(start.points.map((p) => [p.date, p.x, p.y])).toEqual([
      [first.date, -1, 55],
      [second.date, 0, 58],
    ]);
    expect(start.points[0]!.measurement).toBe(measurements[0]);
    expect(start.points[0]!.sleep).toBe(nights[0]);
    expect(pairSleepCardiac(nights, measurements, "resting_hr", "end").points.map((p) => p.x)).toEqual([7, 8]);
    expect(pairSleepCardiac(nights, measurements, "hrv_resting", "midpoint")).toMatchObject({ points: [{ x: 3, y: 40 }], excluded: 1 });
    expect(pairSleepCardiac(nights, measurements, "resting_hr", "shift")).toMatchObject({ points: [{ date: second.date, x: 60, y: 58 }], excluded: 1 });
  });

  it("does not carry nearby days or substitute daytime HRV / Apple SDNN for resting RMSSD", () => {
    const measurements = [
      cardiac("2026-10-23", 52),
      cardiac("2026-10-26", 57),
      cardiac(first.date, 42, "hrv", { note: "Apple SDNN" }),
      cardiac(second.date, 80, "heart_rate"),
      cardiac(second.date, 110, "exercise_hr"),
    ];
    expect(pairSleepCardiac(nights, measurements, "resting_hr", "midpoint")).toEqual({ points: [], excluded: 2 });
    expect(pairSleepCardiac(nights, measurements, "hrv_resting", "midpoint")).toEqual({ points: [], excluded: 2 });
    expect(pairSleepCardiac(nights, measurements, "hrv" as SleepCardiacMetric, "midpoint")).toEqual({ points: [], excluded: 2 });
  });

  it("uses saved winners before excluding limits, nonfinite values and impossible readings", () => {
    const old = cardiac(first.date, 55, "resting_hr", { savedOrder: 1 });
    for (const extra of [{ qualifier: "<" as const }, { qualifier: ">" as const }, { value: NaN }, { value: Infinity }, { value: 24.9 }, { value: 220.1 }]) {
      const winner = { ...old, ...extra, savedOrder: 3 };
      expect(pairSleepCardiac(nights, [winner, old], "resting_hr", "midpoint")).toEqual({ points: [], excluded: 2 });
    }
    expect(pairSleepCardiac(nights, [cardiac(first.date, 25), cardiac(second.date, 220)], "resting_hr", "midpoint").points.map((p) => p.y)).toEqual([25, 220]);
    expect(
      pairSleepCardiac(nights, [cardiac(first.date, 2, "hrv_resting"), cardiac(second.date, 300, "hrv_resting")], "hrv_resting", "midpoint").points.map(
        (p) => p.y,
      ),
    ).toEqual([2, 300]);
    expect(pairSleepCardiac(nights, [cardiac(first.date, 1.9, "hrv_resting"), cardiac(second.date, 300.1, "hrv_resting")], "hrv_resting", "midpoint")).toEqual({
      points: [],
      excluded: 2,
    });
  });

  it("leaves missing shifts absent rather than turning no pairs into zero", () => {
    const gap = buildSleepTiming([first, { ...second, sleepSessions: [{ ...second.sleepSessions![0]!, source: undefined }] }]).nights;
    expect(pairSleepCardiac(gap, [cardiac(first.date, 55), cardiac(second.date, 58)], "resting_hr", "shift")).toEqual({ points: [], excluded: 2 });
    expect(pairSleepCardiac([], [], "resting_hr", "midpoint")).toEqual({ points: [], excluded: 0 });
  });
});

describe("sleep clock labels", () => {
  it("wraps clock hours and rounds whole minutes across midnight", () => {
    expect(sleepClock(-1)).toBe("23:00");
    expect(sleepClock(0)).toBe("00:00");
    expect(sleepClock(7.5)).toBe("07:30");
    expect(sleepClock(23 + 59.75 / 60)).toBe("00:00");
    expect(sleepClock(-0.001)).toBe("00:00");
    expect(sleepClock(48 + 16.25)).toBe("16:15");
    expect(sleepClock(-48 - 1.5)).toBe("22:30");
    expect(sleepClock(7 + 0.5 / 60)).toBe("07:01");
    expect(sleepClock(NaN)).toBe("—");
    expect(sleepClock(Infinity)).toBe("—");
  });
});
