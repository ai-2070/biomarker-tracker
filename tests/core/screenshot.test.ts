import { describe, expect, it } from "vitest";
import { durationHours, parseHealthScreenshot } from "@bt/shared/core/importers/screenshot";

// Text as on-device recognition returns it from synthetic screenshots of health apps.
const today = "2026-10-29";
const values = (text: string) => Object.fromEntries(parseHealthScreenshot(text, today).rows.map((r) => [r.biomarkerId, [r.value, r.unit]]));

describe("health app screenshots", () => {
  it("reads values on the label's line or the next one", () => {
    const samsung = `9:41
Heart rate
72 bpm
Resting heart rate 58 bpm
Blood oxygen
96 %
Stress
Low`;
    expect(values(samsung)).toEqual({ heart_rate: ["72", "bpm"], resting_hr: ["58", "bpm"], spo2: ["96", "%"] });
  });
  it("reads sleep durations and stages, not the sleep score", () => {
    const oura = `Sleep score
82
Total sleep
7 h 12 min
Deep sleep 1h 25m
REM sleep
1 h 48 min
Resting heart rate
54 bpm
HRV during sleep
47 ms`;
    expect(values(oura)).toEqual({
      sleep_duration: ["7.2", "h"],
      sleep_deep: ["1.42", "h"],
      sleep_rem: ["1.8", "h"],
      resting_hr: ["54", "bpm"],
      hrv_resting: ["47", "ms"],
    });
  });
  it("reads blood pressure as two values, weight in pounds, and skips goals", () => {
    const r = values(`Blood pressure
128/82 mmHg
Weight
154.2 lbs
Goal weight 140 lbs
Body fat 29.4 %
VO2 max
38 mL/kg/min`);
    expect(r).toEqual({ bp_systolic: ["128", "mmHg"], bp_diastolic: ["82", "mmHg"], weight: ["154.2", "lb"], body_fat: ["29.4", "%"], vo2max: ["38", "mL/kg/min"] });
  });
  it("flags values that can't be real and sets today's date with a note", () => {
    const p = parseHealthScreenshot("Heart rate\n720 bpm", today);
    expect(p.rows[0]!.problems).toHaveLength(1);
    expect(p.date).toBe(today);
    expect(p.dateNote).toMatch(/date/);
  });
  it("ignores times and text without values", () => {
    expect(values("Heart rate\nLast 24 hours")).toEqual({});
  });
  it("turns durations into hours", () => {
    expect(durationHours("7 h 30 min")).toBe(7.5);
    expect(durationHours("6h")).toBe(6);
    expect(durationHours("95 min")).toBeCloseTo(1.583, 3);
    expect(durationHours("1:30")).toBe(1.5);
  });
});

describe("steps and active minutes in screenshots", () => {
  it("reads steps with a thousands separator, and active minutes", () => {
    expect(values("Steps\n8,412")).toEqual({ steps: ["8412", "steps"] });
    expect(values("Steps 12 045")).toEqual({ steps: ["12045", "steps"] });
    expect(values("Exercise minutes\n42 min")).toEqual({ active_minutes: ["42", "min"] });
    expect(values("Active minutes 1 h 5 min")).toEqual({ active_minutes: ["65", "min"] });
    expect(values("Step goal 10,000")).toEqual({});
  });
});
