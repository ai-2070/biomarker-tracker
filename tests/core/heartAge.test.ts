import { describe, expect, it } from "vitest";
import { FRAMINGHAM_BMI, framinghamRisk, heartAge, heartAgeData, type HeartAgeInput } from "@bt/core/heartAge";
import type { Measurement, ProtocolEntry } from "@bt/core/types";

const normal = (sex: "m" | "f", age: number): HeartAgeInput => ({ sex, age, systolic: 125, treatedBp: false, smoker: false, diabetes: false, bmi: 22.5 });

describe("Framingham risk and heart age (BMI model)", () => {
  it("matches the Framingham Heart Study's own calculator (gencardio_bmi.xls, its default example)", () => {
    // Woman, 30, systolic 125 untreated, non-smoker, no diabetes, BMI 22.5:
    // the calculator shows a 10-year risk of 0.010801167676829593 and a heart age of 30.
    expect(framinghamRisk(normal("f", 30))).toBeCloseTo(0.010801167676829593, 12);
    expect(heartAge(normal("f", 30))).toBeCloseTo(30, 9);
  });
  it("uses the published coefficients", () => {
    expect(FRAMINGHAM_BMI.m).toMatchObject({ lnAge: 3.11296, lnBmi: 0.79277, lnSbpUntreated: 1.85508, lnSbpTreated: 1.92672, smoker: 0.70953, diabetes: 0.5316, s0: 0.88431, mean: 23.9388 });
    expect(FRAMINGHAM_BMI.f).toMatchObject({ lnAge: 2.72107, lnBmi: 0.51125, lnSbpUntreated: 2.81291, lnSbpTreated: 2.88267, smoker: 0.61868, diabetes: 0.77763, s0: 0.94833, mean: 26.0145 });
  });
  it("equals the real age with normal risk factors, for both sexes and any age", () => {
    for (const sex of ["m", "f"] as const) for (const age of [35, 50, 70]) expect(heartAge(normal(sex, age))).toBeCloseTo(age, 9);
  });
  it("is the age at which normal risk factors give the same risk", () => {
    const i: HeartAgeInput = { sex: "m", age: 50, systolic: 148, treatedBp: true, smoker: true, diabetes: false, bmi: 29 };
    const h = heartAge(i);
    expect(h).toBeGreaterThan(50);
    expect(framinghamRisk(normal("m", h))).toBeCloseTo(framinghamRisk(i), 12);
  });
  it("rises with smoking, treated blood pressure and diabetes, and falls with lower pressure", () => {
    const base = normal("f", 50);
    expect(heartAge({ ...base, smoker: true })).toBeGreaterThan(50);
    expect(heartAge({ ...base, treatedBp: true })).toBeGreaterThan(50);
    expect(heartAge({ ...base, diabetes: true })).toBeGreaterThan(50);
    expect(heartAge({ ...base, systolic: 110, bmi: 21 })).toBeLessThan(50);
  });
});

describe("heart age inputs from the app's data", () => {
  const m = (biomarkerId: string, date: string, value: number): Measurement => ({ id: `${biomarkerId}${date}${value}`, biomarkerId, date, value, originalValue: value, originalUnit: "", source: "manual" });
  const ms = [m("bp_systolic", "2026-09-01", 150), m("bp_systolic", "2026-10-10", 130), m("bp_systolic", "2026-10-28", 126), m("weight", "2026-10-20", 70)];
  const profile = { sex: "f" as const, birthMonth: "1976-06", heightCm: 167, smoking: "never" as const };

  it("averages the last 30 days of systolic readings and computes BMI", () => {
    const d = heartAgeData(profile, ms, [], "2026-10-29");
    expect(d.missing).toEqual([]);
    expect(d.input?.systolic).toBe(128);
    expect(d.input?.bmi).toBeCloseTo(70 / 1.67 ** 2, 6);
    expect(d.input?.age).toBeGreaterThan(50);
    expect(d.from.systolicReadings).toBe(2);
  });
  it("finds blood pressure treatment and diabetes in habits or conditions, not prediabetes", () => {
    const meds: ProtocolEntry[] = [{ id: "1", label: "Amlodipine 5 mg", category: "medication", start: "2025-01-01" }];
    expect(heartAgeData(profile, ms, meds, "2026-10-29").from.treatedBp).toBe("habits");
    expect(heartAgeData({ ...profile, conditions: "Type 2 diabetes" }, ms, [], "2026-10-29").from.diabetes).toBe("profile");
    expect(heartAgeData({ ...profile, conditions: "prediabetes" }, ms, [], "2026-10-29").from.diabetes).toBe("no");
    const stopped: ProtocolEntry[] = [{ ...meds[0]!, end: "2026-01-01" }];
    expect(heartAgeData(profile, ms, stopped, "2026-10-29").from.treatedBp).toBe("no");
  });
  it("keeps treatment inputs unchanged when medicines become one mixed protocol, at historical dates too", () => {
    const routine: ProtocolEntry = {
      id: "routine", label: "Daily routine", category: "lifestyle", start: "2026-09-01", end: "2026-10-10",
      plan: {
        id: "source",
        items: [
          { id: "bp", label: "Amlodipine", amount: "5 mg", category: "medication", when: "morning", days: ["mon", "wed", "fri"] },
          { id: "diabetes", label: "Metformin", category: "medication", when: "evening" },
          { id: "diet", label: "Oats", category: "diet", when: "morning" },
        ],
      },
    };
    const separate = routine.plan!.items.map((i): ProtocolEntry => ({ id: i.id, label: i.label, category: i.category, start: routine.start, end: routine.end }));
    for (const date of ["2026-08-31", "2026-09-01", "2026-09-15", "2026-10-10", "2026-10-11", "2026-10-29"]) {
      const grouped = heartAgeData(profile, ms, [routine], date);
      expect(grouped).toEqual(heartAgeData(profile, ms, separate, date));
      const active = date >= routine.start && date <= routine.end!;
      expect(grouped.input).toMatchObject({ treatedBp: active, diabetes: active });
      expect(grouped.from).toMatchObject({ treatedBp: active ? "habits" : "no", diabetes: active ? "habits" : "no" });
    }
  });
  it("only infers treatment from items marked as medicines, not a routine name or other item types", () => {
    const routine: ProtocolEntry = {
      id: "routine", label: "Amlodipine and metformin notes", category: "medication", start: "2026-01-01",
      plan: {
        id: "source",
        items: [{ id: "notes", label: "Metformin and amlodipine research", category: "lifestyle", when: "any time" }],
      },
    };
    expect(heartAgeData(profile, ms, [routine], "2026-10-29").input).toMatchObject({ treatedBp: false, diabetes: false });
  });
  it("lists what's missing and marks ages outside 30–74", () => {
    expect(heartAgeData({}, [], [], "2026-10-29").missing).toEqual(["your sex", "your month and year of birth", "your height", "a weight", "a blood pressure reading", "whether you smoke"]);
    expect(heartAgeData({ ...profile, birthMonth: "2000-01" }, ms, [], "2026-10-29").outOfRange).toBe("young");
  });
});
