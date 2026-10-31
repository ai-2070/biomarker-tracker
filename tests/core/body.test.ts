import { describe, expect, it } from "vitest";
import { BIOMARKER_MAP } from "../../src/app/knowledge";
import { BODY_FIELDS, recentAverage, bmi, bmiTerms, bmrMifflin, bmrMifflinTerms, heightInCm, heightInFeet, rmrCunningham, latestBloodPressure, latestBody, validateBodyEntry, waistToHeight, waistToHeightBand, waistToHeightYearsLost } from "../../src/core/body";
import type { Measurement } from "../../src/core/types";

const today = "2026-10-28";
const m = (biomarkerId: string, date: string, value: number): Measurement => ({ id: `${biomarkerId}-${date}-${value}`, biomarkerId, date, value, originalValue: value, originalUnit: "", source: "manual" });

describe("body knowledge", () => {
  it("has a knowledge entry for every body field", () => {
    for (const f of BODY_FIELDS) expect(BIOMARKER_MAP.get(f)?.category, f).toBe("Body");
  });
});

describe("profile height units", () => {
  it("converts feet and inches to cm without losing fractional-centimetre height", () => {
    expect(heightInCm(5, "ft/in", 11)).toBe(180.34);
    expect(heightInCm(6, "ft/in")).toBe(182.88);
    expect(heightInCm(172.5, "cm")).toBe(172.5);
    expect(heightInFeet(180.34)).toEqual({ feet: 5, inches: 11 });
  });
  it("carries rounded inches into feet and keeps both height limits usable", () => {
    expect(heightInFeet(182.8799)).toEqual({ feet: 6, inches: 0 });
    for (const cm of [40, 168, 180.34, 192, 260]) {
      const parts = heightInFeet(cm)!;
      expect(parts.inches).toBeLessThan(12);
      expect(heightInCm(parts.feet, "ft/in", parts.inches)).toBeCloseTo(cm, 1);
    }
  });
  it.each([[5, 12], [5, -1], [5.5, 0], [-1, 0], [0, 0], [9, 0], [5, NaN], [Infinity, 0]])("rejects invalid feet/inches: %s / %s", (feet, inches) => {
    expect(heightInCm(feet, "ft/in", inches)).toBeUndefined();
  });
  it.each([39, 261, NaN, Infinity])("rejects invalid cm: %s", (cm) => {
    expect(heightInCm(cm, "cm")).toBeUndefined();
    expect(heightInFeet(cm)).toBeUndefined();
  });
});

describe("BMI and waist-to-height", () => {
  it("computes BMI from weight and height", () => {
    expect(bmi(70, 175)).toBeCloseTo(22.86, 2);
    expect(bmi(70, undefined)).toBeUndefined();
    expect(bmi(70, 60)).toBeUndefined();
    expect(bmi(0, 175)).toBeUndefined();
  });
  it("divides waist by height", () => {
    expect(waistToHeight(84, 168)).toBe(0.5);
    expect(bmiTerms(67.2, 168)).toMatchObject({ heightM: 1.68 });
    expect(bmiTerms(67.2, 168)!.heightSquared).toBeCloseTo(2.8224, 6);
    expect(bmiTerms(67.2, 168)!.bmi).toBeCloseTo(23.81, 2);
    expect(bmiTerms(67.2, undefined)).toBeUndefined();
    expect(waistToHeight(84, undefined)).toBeUndefined();
  });
});

describe("basal metabolic rate", () => {
  it("uses the Mifflin–St Jeor equation", () => {
    expect(bmrMifflin(80, 180, 30, "m")).toBe(1780);
    expect(bmrMifflin(60, 165, 40, "f")).toBeCloseTo(1270.25, 2);
    // The example profile: a woman, 67.2 kg, 168 cm, 47.6 years.
    expect(bmrMifflin(67.2, 168, 47.6, "f")).toBeCloseTo(1323, 0);
    const t = bmrMifflinTerms(67.2, 168, 47.6, "f")!;
    expect(t.weight + t.height + t.age + t.sex).toBeCloseTo(t.total, 6);
    expect(t).toMatchObject({ weight: 672, height: 1050, sex: -161, outsideStudyAges: false });
    expect(bmrMifflinTerms(70, 170, 80, "m")).toMatchObject({ sex: 5, outsideStudyAges: true });
    expect(bmrMifflinTerms(70, undefined, 40, "m")).toBeUndefined();
  });
  it("adds Cunningham's lean-mass estimate only with a body-fat reading near the weight", () => {
    const r = rmrCunningham([m("weight", "2026-10-22", 67.2), m("body_fat", "2026-10-01", 29.2)])!;
    expect(r.leanKg).toBeCloseTo(47.578, 3);
    expect(r.total).toBeCloseTo(500 + 22 * 47.5776, 2);
    expect(rmrCunningham([m("weight", "2026-10-22", 67.2), m("body_fat", "2026-08-01", 29.2)])).toBeUndefined();
    expect(rmrCunningham([m("weight", "2026-10-22", 67.2)])).toBeUndefined();
    expect(rmrCunningham([m("weight", "2026-10-22", 67.2), m("body_fat", "2026-10-20", 1)])).toBeUndefined();
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
  it("takes watch values: heart rate, HRV and blood oxygen", () => {
    const r = validateBodyEntry(
      { date: today, values: { heart_rate: { value: "72", unit: "bpm" }, hrv_resting: { value: "48", unit: "ms" }, spo2: { value: "97", unit: "%" }, exercise_hr: { value: "131", unit: "bpm" } } },
      BIOMARKER_MAP,
      today,
    );
    expect(r.ok && r.measurements.map((x) => [x.biomarkerId, x.value])).toEqual([["heart_rate", 72], ["exercise_hr", 131], ["hrv_resting", 48], ["spo2", 97]]);
    const bad = validateBodyEntry({ date: today, values: { spo2: { value: "103", unit: "%" } } }, BIOMARKER_MAP, today);
    expect(!bad.ok && bad.errors.spo2).toMatch(/unlikely/);
  });
  it("catches typos", () => {
    const r = validateBodyEntry({ date: today, values: { weight: { value: "700", unit: "kg" }, resting_hr: { value: "abc", unit: "bpm" } } }, BIOMARKER_MAP, today);
    expect(!r.ok && r.errors.weight).toMatch(/unlikely/);
    expect(!r.ok && r.errors.resting_hr).toMatch(/number/);
  });
});

describe("recent average", () => {
  it("averages the last week when there are enough nights", () => {
    const nights = [m("sleep_duration", "2026-10-10", 9), m("sleep_duration", "2026-10-23", 6), m("sleep_duration", "2026-10-25", 7), m("sleep_duration", "2026-10-29", 8)];
    expect(recentAverage(nights)).toMatchObject({ value: 7, count: 3 });
    expect(recentAverage(nights.slice(-2))).toBeUndefined();
    expect(recentAverage([])).toBeUndefined();
  });

  it("puts waist-to-height in Ashwell's ranges, rounded as shown", () => {
    expect(waistToHeightBand(0.39)).toBe("low");
    expect(waistToHeightBand(0.45)).toBe("guide");
    expect(waistToHeightBand(0.499)).toBe("increased"); // shown as 0.50
    expect(waistToHeightBand(0.5)).toBe("increased");
    expect(waistToHeightBand(0.594)).toBe("increased");
    expect(waistToHeightBand(0.6)).toBe("high");
  });

  it("finds the years-of-life-lost row for the nearest tabulated age and the columns around the ratio", () => {
    const at = (ratio: number, sex: "m" | "f", age: number) => {
      const r = waistToHeightYearsLost(ratio, { sex, age });
      return r && [r.row.sex, r.row.age, r.from, r.to];
    };
    expect(at(0.55, "m", 35)).toEqual(["m", 30, 0, 1]);
    expect(at(0.6, "f", 45)).toEqual(["f", 50, 1, 2]);
    expect(at(0.45, "m", 65)).toEqual(["m", 70, undefined, 0]);
    expect(at(0.85, "f", 72)).toEqual(["f", 70, 3, undefined]);
    expect(waistToHeightYearsLost(0.55, { sex: "m", age: 50 })?.row.years).toEqual([0, 1.4, 5.8, 14.3]);
    expect(waistToHeightYearsLost(0.55, { age: 50 })).toBeUndefined();
    expect(waistToHeightYearsLost(0.55, { sex: "f", age: 16 })).toBeUndefined();
  });
});
