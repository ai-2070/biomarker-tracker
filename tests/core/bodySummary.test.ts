import { describe, expect, it } from "vitest";
import { bodySummary } from "../../src/core/bodySummary";
import { demoProfile } from "../../src/core/demo";
import { loadDefs } from "../helpers";

describe("body summary for Brain", () => {
  const today = "2026-10-29";
  const demo = demoProfile(today);
  const s = bodySummary(demo.person, demo.measurements, demo.protocols, today) as ReturnType<typeof bodySummary> & Record<string, { latest: number } | undefined>;
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
    expect(empty.heartAge).toEqual({ notShown: "Needs your sex, your month and year of birth, your height, a weight, a blood pressure reading, whether you smoke." });
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
});
