import { describe, expect, it } from "vitest";
import { BIOMARKER_MAP } from "../../src/app/knowledge";
import { BODY_FIELDS, bmi, bmiBand, bmrMifflin, latestBloodPressure, latestBody, validateBodyEntry, waistToHeight } from "../../src/core/body";
import type { Measurement } from "../../src/core/types";

const today = "2026-10-28";
const m = (biomarkerId: string, date: string, value: number): Measurement => ({ id: `${biomarkerId}-${date}-${value}`, biomarkerId, date, value, originalValue: value, originalUnit: "", source: "manual" });

describe("body knowledge", () => {
  it("has a knowledge entry for every body field", () => {
    for (const f of BODY_FIELDS) expect(BIOMARKER_MAP.get(f)?.category, f).toBe("Body");
  });
});

describe("BMI and waist-to-height", () => {
  it("computes BMI from weight and height", () => {
    expect(bmi(70, 175)).toBeCloseTo(22.86, 2);
    expect(bmi(70, undefined)).toBeUndefined();
    expect(bmi(70, 60)).toBeUndefined();
    expect(bmi(0, 175)).toBeUndefined();
  });
  it("names the usual adult bands", () => {
    expect([18.4, 18.5, 24.9, 25, 29.9, 30].map(bmiBand)).toEqual(["under", "healthy", "healthy", "over", "over", "obesity"]);
  });
  it("divides waist by height", () => {
    expect(waistToHeight(84, 168)).toBe(0.5);
    expect(waistToHeight(84, undefined)).toBeUndefined();
  });
});

describe("basal metabolic rate", () => {
  it("uses the Mifflin–St Jeor equation", () => {
    expect(bmrMifflin(80, 180, 30, "m")).toBe(1780);
    expect(bmrMifflin(60, 165, 40, "f")).toBeCloseTo(1270.25, 2);
  });
  it("needs an adult with weight, height, age and sex", () => {
    expect(bmrMifflin(60, undefined, 40, "f")).toBeUndefined();
    expect(bmrMifflin(60, 165, undefined, "f")).toBeUndefined();
    expect(bmrMifflin(60, 165, 40, undefined)).toBeUndefined();
    expect(bmrMifflin(60, 165, 16, "f")).toBeUndefined();
  });
});

describe("latest readings", () => {
  const ms = [m("weight", "2026-01-01", 70), m("weight", "2026-03-01", 69), m("bp_systolic", "2026-03-01", 124), m("bp_diastolic", "2026-03-01", 79), m("bp_systolic", "2026-04-01", 130)];
  it("takes the newest of each", () => {
    expect(latestBody(ms).weight?.value).toBe(69);
    expect(latestBody(ms).waist).toBeUndefined();
  });
  it("pairs the two blood pressure numbers from the same day", () => {
    const bp = latestBloodPressure(ms)!;
    expect([bp.systolic.value, bp.diastolic.value, bp.systolic.date]).toEqual([124, 79, "2026-03-01"]);
    expect(latestBloodPressure([m("bp_systolic", "2026-03-01", 124)])).toBeUndefined();
  });
});

describe("entering body measurements", () => {
  it("saves the filled fields in canonical units", () => {
    const r = validateBodyEntry(
      { date: "2026-10-01", values: { weight: { value: "154", unit: "lb" }, bp_systolic: { value: "128", unit: "mmHg" }, bp_diastolic: { value: "82", unit: "mmHg" }, waist: { value: "", unit: "cm" } } },
      BIOMARKER_MAP,
      today,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.measurements.map((x) => x.biomarkerId)).toEqual(["weight", "bp_systolic", "bp_diastolic"]);
    expect(r.measurements[0]!.value).toBeCloseTo(69.85, 2);
    expect(r.measurements[0]!.originalUnit).toBe("lb");
  });
  it("needs a value, a valid date and both blood pressure numbers", () => {
    expect(validateBodyEntry({ date: today, values: {} }, BIOMARKER_MAP, today)).toEqual({ ok: false, errors: { form: "Enter at least one measurement." } });
    const future = validateBodyEntry({ date: "2027-01-01", values: { weight: { value: "70", unit: "kg" } } }, BIOMARKER_MAP, today);
    expect(!future.ok && future.errors.date).toMatch(/future/);
    const half = validateBodyEntry({ date: today, values: { bp_systolic: { value: "120", unit: "mmHg" } } }, BIOMARKER_MAP, today);
    expect(!half.ok && half.errors.bp_diastolic).toMatch(/both numbers/);
    const swapped = validateBodyEntry({ date: today, values: { bp_systolic: { value: "80", unit: "mmHg" }, bp_diastolic: { value: "120", unit: "mmHg" } } }, BIOMARKER_MAP, today);
    expect(!swapped.ok && swapped.errors.bp_systolic).toMatch(/higher/);
  });
  it("records whether a glucose reading was fasting, and requires saying", () => {
    const g = (glucoseContext?: "fasting" | "after-meal" | "other") =>
      validateBodyEntry({ date: today, values: { glucose_home: { value: "99", unit: "mg/dL" } }, ...(glucoseContext ? { glucoseContext } : {}) }, BIOMARKER_MAP, today);
    const fasting = g("fasting");
    expect(fasting.ok && fasting.measurements[0]).toMatchObject({ biomarkerId: "glucose_home", fasted: true });
    expect(fasting.ok && fasting.measurements[0]!.value).toBeCloseTo(5.49, 2);
    const after = g("after-meal");
    expect(after.ok && after.measurements[0]!.fasted).toBe(false);
    const other = g("other");
    expect(other.ok && other.measurements[0]!.fasted).toBeUndefined();
    const none = g();
    expect(!none.ok && none.errors.glucoseContext).toMatch(/when you measured/);
  });
  it("catches typos", () => {
    const r = validateBodyEntry({ date: today, values: { weight: { value: "700", unit: "kg" }, resting_hr: { value: "abc", unit: "bpm" } } }, BIOMARKER_MAP, today);
    expect(!r.ok && r.errors.weight).toMatch(/unlikely/);
    expect(!r.ok && r.errors.resting_hr).toMatch(/number/);
  });
});
