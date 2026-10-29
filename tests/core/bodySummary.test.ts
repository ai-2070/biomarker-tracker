import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { FitnessTestDef } from "../../src/core/fitnessTests";
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

  it("gives the fitness tests' comparisons with norms, worked out by the app", () => {
    const today = "2026-10-29";
    const demo = demoProfile(today);
    const dir = join(import.meta.dirname, "..", "..", "knowledge", "fitness");
    const tests = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as FitnessTestDef);
    const s = bodySummary(demo.person, demo.measurements, demo.protocols, today, loadDefs(), tests) as unknown as { fitnessTests: { results: { test: string; comparedWith: { place: string }[]; note?: string }[] } };
    const push = s.fitnessTests.results.find((r) => r.test === "Push-ups")!;
    expect(push.comparedWith[0]!.place).toBe("Very good");
    // The example person is 47: the sit-and-rise groups are for 51–80.
    expect(s.fitnessTests.results.find((r) => r.test === "Sitting-rising test")!.note).toMatch(/No norms/);
    expect(bodySummary(demo.person, [], [], today, loadDefs(), tests)).not.toHaveProperty("fitnessTests");
  });
});
