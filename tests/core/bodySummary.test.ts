import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bodySummary } from "@bt/shared/core/bodySummary";
import { demoProfile } from "@bt/shared/core/demo";
import type { FitnessTestDef } from "@bt/shared/core/fitnessTests";
import type { Measurement } from "@bt/shared/core/types";
import { describe, expect, it } from "vitest";
import { loadDefs } from "../helpers";

describe("body summary for Brain", () => {
  const today = "2026-10-29";
  const demo = demoProfile(today);
  const s = bodySummary(demo.person, demo.measurements, demo.protocols, today) as ReturnType<typeof bodySummary> &
    Record<string, { latest: number } | undefined>;
  it("gives the app's own calculations", () => {
    expect(s.bmi?.value).toBeGreaterThan(20);
    expect(s.basalMetabolicRate?.kcalPerDay).toBeGreaterThan(1000);
    expect(s.basalMetabolicRate?.note).toMatch(/Not a target/);
    expect(s.bloodPressure?.latest).toMatch(/^\d+\/\d+ mmHg$/);
    expect("years" in s.heartAge && s.heartAge.years).toBeGreaterThan(30);
    expect(s.sleepHours?.latest).toBeGreaterThan(5);
  });
  it("says what's missing instead of guessing", () => {
    const empty = bodySummary({}, [], [], today);
    expect(empty.bmi).toBeUndefined();
    expect(empty.heartAge).toEqual({
      notShown: "Needs your sex, your month and year of birth, your height, a weight, a blood pressure reading, whether you smoke.",
    });
  });
});

describe("ranges in the body summary", () => {
  it("judges sleep on the week's average and gives HRV the person's usual range", () => {
    const today = "2026-10-29";
    const demo = demoProfile(today);
    const s = bodySummary(demo.person, demo.measurements, demo.protocols, today, loadDefs()) as unknown as Record<string, Record<string, unknown> | undefined>;
    expect(s.sleepHours).toMatchObject({ range: { low: 7, high: 9 }, rangeCheckedAgainst: expect.stringMatching(/week/), flag: "normal" });
    const usual = s.restingHrvMs?.usualRange as { low: number; high: number };
    expect(usual.low).toBeLessThan(48);
    expect(usual.high).toBeGreaterThan(48);
    expect(s.bmi).not.toHaveProperty("band");
    expect(s.bodyFatPercent).toHaveProperty("range");
  });

  it("gives the fitness tests' comparisons with norms, worked out by the app", () => {
    const today = "2026-10-29";
    const demo = demoProfile(today);
    const dir = join(import.meta.dirname, "..", "..", "knowledge", "fitness");
    const tests = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as FitnessTestDef);
    const s = bodySummary(demo.person, demo.measurements, demo.protocols, today, loadDefs(), tests) as unknown as {
      fitnessTests: { results: { test: string; comparedWith: { place: string }[]; note?: string }[] };
    };
    const push = s.fitnessTests.results.find((r) => r.test === "Push-ups")!;
    expect(push.comparedWith[0]!.place).toBe("Very good");
    // The example person is 47: the sit-and-rise groups are for 51–80.
    expect(s.fitnessTests.results.find((r) => r.test === "Sitting-rising test")!.note).toMatch(/No norms/);
    expect(bodySummary(demo.person, [], [], today, loadDefs(), tests)).not.toHaveProperty("fitnessTests");
  });
});

describe("sleep timing in Brain's body summary", () => {
  const today = "2026-11-01";
  const recorded = (date: string, extra: Partial<Measurement> = {}): Measurement => ({
    id: `sleep-${date}`,
    biomarkerId: "sleep_duration",
    date,
    value: 7.5,
    originalValue: 7.5,
    originalUnit: "h",
    source: "device",
    sleepSessions: [{ start: `${date}T00:00:00`, end: `${date}T07:30:00`, kind: "asleep", source: "Watch" }],
    ...extra,
  });
  const resting = (date: string, biomarkerId: string, value: number, extra: Partial<Measurement> = {}): Measurement => ({
    id: `${biomarkerId}-${date}`,
    biomarkerId,
    date,
    value,
    originalValue: value,
    originalUnit: biomarkerId === "resting_hr" ? "bpm" : "ms",
    source: "device",
    ...extra,
  });

  it("computes an inclusive last-30-days summary with clocks and compact explicit pair counts", () => {
    const rows = [
      recorded("2026-10-02"),
      recorded("2026-10-03"),
      recorded("2026-10-04", { sleepSessions: [{ start: "2026-10-04T00:30:00", end: "2026-10-04T08:00:00", kind: "asleep", source: "Watch" }] }),
      recorded("2026-10-05", { sleepSessions: undefined }),
      recorded("2026-10-06", { sleepSessions: [] }),
      recorded("2026-10-31", { sleepSessions: [{ start: "2026-10-30T23:45:00", end: "2026-10-31T07:15:00", kind: "in-bed", source: "Ring" }] }),
      recorded("2026-11-02"),
      resting("2026-10-03", "resting_hr", 55),
      resting("2026-10-04", "resting_hr", 58, { savedOrder: 1 }),
      resting("2026-10-04", "resting_hr", 58, { savedOrder: 2, qualifier: "<" }),
      resting("2026-10-03", "hrv_resting", 40),
      resting("2026-10-04", "hrv_resting", 42),
      resting("2026-10-31", "hrv_resting", 45),
      resting("2026-10-31", "hrv", 99),
    ];
    const summary = bodySummary({}, rows, [], today).sleepTiming;
    expect(summary).toMatchObject({
      from: "2026-10-03",
      to: today,
      nightsWithTiming: 3,
      durationOnlyNights: 1,
      invalidNights: 1,
      regularity: { pairs: 1, startShiftMinutes: 30, endShiftMinutes: 30, midpointShiftMinutes: 30 },
      latest: {
        date: "2026-10-31",
        kind: "in-bed",
        source: "Ring",
        startClock: "23:45",
        endClock: "07:15",
        midpointClock: "03:30",
        startHours: -0.25,
        endHours: 7.25,
        midpointHours: 3.5,
        sessionCount: 1,
      },
      cardiacPairs: {
        restingHeartRate: { sameWakeDatePairs: 1, consecutiveNightShiftPairs: 0, excludedNights: 2 },
        restingHrv: { sameWakeDatePairs: 3, consecutiveNightShiftPairs: 1, excludedNights: 0 },
      },
    });
    expect(summary).not.toHaveProperty("nights");
    expect(summary).not.toHaveProperty("points");
    expect(summary.notes.join(" ")).toMatch(/Same-date readings need not cover the same sleep window/);
    expect(summary.notes.join(" ")).toMatch(/No correlation or causal effect/);
  });

  it("explains no eligible pairs and never fills clocks for duration-only profiles", () => {
    const rows = [recorded("2026-10-30", { sleepSessions: undefined }), recorded("2026-10-31", { sleepSessions: undefined })];
    const summary = bodySummary({}, rows, [], today).sleepTiming;
    expect(summary).toMatchObject({ nightsWithTiming: 0, durationOnlyNights: 2, regularity: { pairs: 0 } });
    expect(summary).not.toHaveProperty("latest");
    expect(summary.regularity).not.toHaveProperty("midpointShiftMinutes");
    expect(summary.notes.join(" ")).toMatch(/No eligible adjacent-night pairs/);
    expect(summary.notes.join(" ")).toMatch(/unavailable, not zero/);
    expect(summary.cardiacPairs.restingHrv).toEqual({ sameWakeDatePairs: 0, consecutiveNightShiftPairs: 0, excludedNights: 0 });
    expect(rows.every((m) => m.sleepSessions === undefined)).toBe(true);
    const empty = bodySummary({}, [], [], today).sleepTiming;
    expect(empty.nightsWithTiming).toBe(0);
    expect(empty.regularity).toEqual({ pairs: 0 });
  });

  it("does not expose older timing when a saved latest winner loses its metadata", () => {
    const date = "2026-10-31";
    const summary = bodySummary({}, [recorded(date, { savedOrder: 3, sleepSessions: undefined }), recorded(date, { savedOrder: 1 })], [], today).sleepTiming;
    expect(summary).toMatchObject({ nightsWithTiming: 0, durationOnlyNights: 1 });
    expect(summary).not.toHaveProperty("latest");
  });
});
