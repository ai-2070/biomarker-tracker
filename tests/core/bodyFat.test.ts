import { describe, expect, it } from "vitest";
import { bodyFatBand, bodyFatComparison, bodyFatGuide, fatMassAt, fitnessFatBand } from "@bt/core/bodyFat";
import type { Measurement, Profile } from "@bt/core/types";
import { flagLatest, flagMeasurement, flagValue, isOutOfRange, resolveRange } from "@bt/core/trends";
import { isBiomarkerDef } from "@bt/core/knowledge";
import { def } from "../helpers";

const reading = (biomarkerId: string, value: number, date = "2026-10-24"): Measurement => ({
  id: `${biomarkerId}-${date}-${value}`, biomarkerId, value, date, originalValue: value,
  originalUnit: biomarkerId === "weight" ? "kg" : "%", source: "manual",
});
const man: Profile = { sex: "m", birthMonth: "1985-03" };

describe("age- and sex-specific body-fat guides", () => {
  it.each([
    [20, "m", 8, 20, 25], [39.999, "m", 8, 20, 25],
    [40, "m", 11, 22, 28], [59.999, "m", 11, 22, 28],
    [60, "m", 13, 25, 30], [79.999, "m", 13, 25, 30],
    [20, "f", 21, 33, 39], [40, "f", 23, 34, 40], [60, "f", 24, 36, 42],
  ] as const)("uses the published guide at age %s for %s", (age, sex, low, high, veryHigh) => {
    expect(bodyFatGuide(age, sex)).toMatchObject({ sex, low, high, veryHigh });
  });
  it.each([undefined, NaN, Infinity, -Infinity, 19.999, 80, 100])("does not extrapolate a guide at age %s", (age) => {
    expect(bodyFatGuide(age, "m")).toBeUndefined();
    expect(bodyFatGuide(age, "f")).toBeUndefined();
  });
  it("needs the sex used by the reference rather than assuming one", () => {
    expect(bodyFatGuide(35, undefined)).toBeUndefined();
  });
  it.each([
    [7.99, "below"], [8, "within"], [20, "within"], [20.01, "above"],
    [24.99, "above"], [25, "high"], [100, "high"],
  ] as const)("places %s%% on the existing inclusive guide boundaries", (value, expected) => {
    expect(bodyFatBand(value, bodyFatGuide(35, "m")!)).toBe(expected);
  });
  it.each([-1, 100.01, NaN, Infinity])("does not classify an invalid percentage %s", (value) => {
    expect(bodyFatBand(value, bodyFatGuide(35, "m")!)).toBeUndefined();
    expect(fitnessFatBand(value, "m")).toBeUndefined();
  });
});

describe("separate five-category adult reference", () => {
  it("keeps the two references distinct rather than presenting them as interchangeable", () => {
    expect(bodyFatBand(32, bodyFatGuide(45, "f")!)).toBe("within");
    expect(fitnessFatBand(32, "f")?.id).toBe("obesity");
    expect(fitnessFatBand(12, "m")?.id).toBe("athlete");
    expect(fitnessFatBand(16, "m")?.id).toBe("fitness");
    expect(fitnessFatBand(20, "m")?.id).toBe("average");
    expect(fitnessFatBand(12, "f")?.id).toBe("essential");
  });
  it.each([5.5, 13.5, 17.5, 24.5])("does not invent decimal cutoffs between published male ranges: %s", (value) => {
    expect(fitnessFatBand(value, "m")).toBeUndefined();
  });
  it("does not put a below-essential value into the essential category", () => {
    expect(fitnessFatBand(1, "m")).toBeUndefined();
    expect(fitnessFatBand(9, "f")).toBeUndefined();
    expect(fitnessFatBand(20, undefined)).toBeUndefined();
  });
});

describe("body-fat reading comparison", () => {
  it("uses the latest body-fat reading and age at that reading, not today's age or another marker", () => {
    const old = reading("body_fat", 20.5, "2020-10-24");
    const result = bodyFatComparison([reading("weight", 100), old, reading("body_fat", 22, "2019-01-01")], man, "2030-10-24");
    expect(result.latest?.id).toBe(old.id);
    expect(result.guide?.ageFrom).toBe(20);
    expect(result.band).toBe("above");
  });
  it("can show today's guide before any reading, without inventing a result", () => {
    const result = bodyFatComparison([], man, "2026-10-24");
    expect(result.guide?.ageFrom).toBe(40);
    expect(result.latest).toBeUndefined();
    expect(result.value).toBeUndefined();
    expect(result.band).toBeUndefined();
  });
  it("does not plot or assign an exact group to bounded or invalid readings", () => {
    for (const latest of [{ ...reading("body_fat", 27), qualifier: "<" as const }, reading("body_fat", 120)]) {
      const result = bodyFatComparison([latest], man, "2026-10-24");
      expect(result.latest?.id).toBe(latest.id);
      expect(result.value).toBeUndefined();
      expect(result.band).toBeUndefined();
      expect(result.fitness).toBeUndefined();
    }
  });
  it("keeps readings but avoids personal classifications with missing details or for children", () => {
    for (const profile of [{}, { sex: "m" as const }, { ...man, birthMonth: "2012-03" }, { ...man, birthMonth: "1985-13" }]) {
      const result = bodyFatComparison([reading("body_fat", 20)], profile, "2026-10-24");
      expect(result.value).toBe(20);
      expect(result.guide).toBeUndefined();
      expect(result.fitness).toBeUndefined();
    }
  });
});

describe("estimated fat mass", () => {
  it("uses canonical kg and an exact same-day percentage; source pounds are not converted twice", () => {
    const weight = { ...reading("weight", 100), originalValue: 220.462262, originalUnit: "lb" };
    const result = fatMassAt(reading("body_fat", 27), [reading("weight", 120, "2026-10-23"), weight])!;
    expect(result.kg).toBe(27);
    expect(result.lb).toBeCloseTo(59.5248, 4);
    expect(result.weight.id).toBe(weight.id);
    expect(result.daysApart).toBe(0);
  });
  it("chooses the nearest dated weight, preferring earlier on an equal-distance tie", () => {
    const earlier = reading("weight", 100, "2026-10-23");
    const later = reading("weight", 110, "2026-10-25");
    for (const weights of [[earlier, later], [later, earlier]]) {
      const result = fatMassAt(reading("body_fat", 20), weights)!;
      expect(result.kg).toBe(20);
      expect(result.weight.id).toBe(earlier.id);
      expect(result.daysApart).toBe(1);
    }
  });
  it("includes 30 days but does not use distant weight or a nearer bounded value", () => {
    const fat = reading("body_fat", 20);
    expect(fatMassAt(fat, [reading("weight", 100, "2026-09-24")])?.kg).toBe(20);
    expect(fatMassAt(fat, [reading("weight", 100, "2026-09-23")])).toBeUndefined();
    expect(fatMassAt(fat, [{ ...reading("weight", 90), qualifier: ">" }, reading("weight", 100, "2026-10-23")])?.kg).toBe(20);
  });
  it("requires valid exact inputs and does not fall back to an unrelated measurement", () => {
    const fat = reading("body_fat", 20);
    expect(fatMassAt({ ...fat, qualifier: "<" }, [reading("weight", 100)])).toBeUndefined();
    expect(fatMassAt(reading("body_fat", 101), [reading("weight", 100)])).toBeUndefined();
    expect(fatMassAt(fat, [reading("weight", 0), reading("weight", Infinity), reading("waist", 100)])).toBeUndefined();
    expect(fatMassAt(reading("weight", 20), [reading("weight", 100)])).toBeUndefined();
    expect(fatMassAt({ ...fat, date: "invalid" }, [reading("weight", 100)])).toBeUndefined();
  });
});

describe("body-fat comparisons are not clinical limits", () => {
  const fat = def("body_fat");
  const woman: Profile = { sex: "f", birthMonth: "1980-03" };
  it("retains the published comparison without calling a woman's 17% clinically low", () => {
    const result = reading("body_fat", 17);
    const range = resolveRange(fat, result, woman);
    expect(range).toMatchObject({ low: 23, high: 34, comparisonOnly: true });
    expect(bodyFatComparison([result], woman, result.date).band).toBe("below");
    expect(flagMeasurement(fat, result, woman)).toBe("unknown");
    expect(isOutOfRange(flagLatest(fat, [result], woman))).toBe(false);
  });
  it("does not call an in-reference value clinically normal or an upper-band value clinically high", () => {
    const profile: Profile = { sex: "m", birthMonth: "1995-03" };
    expect(bodyFatComparison([reading("body_fat", 18)], profile, "2026-10-24").band).toBe("within");
    expect(flagLatest(fat, [reading("body_fat", 18)], profile)).toBe("unknown");
    expect(flagLatest(fat, [reading("body_fat", 30)], profile)).toBe("unknown");
  });
  it("still assesses explicit laboratory ranges", () => {
    const result = { ...reading("body_fat", 17), labRange: { low: 20, high: 35 } };
    expect(resolveRange(fat, result, woman)).toEqual({ low: 20, high: 35, source: "lab" });
    expect(flagMeasurement(fat, result, woman)).toBe("low");
    expect(flagMeasurement(fat, { ...result, value: 25 }, woman)).toBe("normal");
  });
  it("preserves configured critical limits, including bounded readings", () => {
    const critical = { low: 3, high: 60 };
    const comparison = { low: 8, high: 20, comparisonOnly: true };
    expect(flagValue(2, comparison, critical)).toBe("critical-low");
    expect(flagValue(65, comparison, critical)).toBe("critical-high");
    expect(flagValue(3, comparison, critical, "<")).toBe("critical-low");
    expect(flagValue(60, comparison, critical, ">")).toBe("critical-high");
    expect(flagValue(7, comparison, critical, "<")).toBe("unknown");
  });
  it("rejects truthy non-boolean comparison metadata rather than disabling clinical flags", () => {
    expect(isBiomarkerDef({ ...fat, comparisonOnly: "yes" })).toBe(false);
    expect(isBiomarkerDef({ ...fat, comparisonOnly: false })).toBe(true);
  });
});
