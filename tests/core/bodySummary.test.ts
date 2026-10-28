import { describe, expect, it } from "vitest";
import { bodySummary } from "../../src/core/bodySummary";
import { demoProfile } from "../../src/core/demo";

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
