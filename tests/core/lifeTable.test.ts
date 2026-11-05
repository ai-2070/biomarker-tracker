import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ageAtMoment, ageWhenLeft, bestBefore, bestBeforeMoments, bestBeforeWithShift, birthMoment, lifeTablePeriod, momentAtAge, populationSurvival, remainingYears, survivors, tableFor, validateLifeTables, type LifeTable, type LifeTableFile } from "@bt/shared/core/lifeTable";

/** A made-up table: nobody dies before 60, then survivors fall by 2,000 a year to 95, e95 = 3 years. */
const lx = Array.from({ length: 96 }, (_, a) => (a <= 60 ? 100_000 : 100_000 - (a - 60) * 2_000));
const t: LifeTable = { lx, e95: 3 };

describe("life tables", () => {
  it("joins whole ages with straight lines, and falls at 1/e95 past 95", () => {
    expect(survivors(t, 60)).toBe(100_000);
    expect(survivors(t, 61.5)).toBe(97_000);
    expect(survivors(t, 95)).toBe(30_000);
    expect(survivors(t, 98)).toBeCloseTo(30_000 * Math.exp(-1), 6);
  });
  it("finds when a quarter, half and three quarters have died", () => {
    // From 60: half of 100,000 left at 85 (100,000 − 25 × 2,000).
    expect(ageWhenLeft(t, 60, 0.5)).toBeCloseTo(85, 6);
    expect(ageWhenLeft(t, 60, 0.75)).toBeCloseTo(72.5, 6);
    // A quarter left = 25,000: past 95, 95 + 3·ln(30,000 / 25,000).
    expect(ageWhenLeft(t, 60, 0.25)).toBeCloseTo(95 + 3 * Math.log(30 / 25), 6);
    // Later in life the median comes later: you've already survived the earlier deaths.
    expect(ageWhenLeft(t, 80, 0.5)).toBeGreaterThan(ageWhenLeft(t, 60, 0.5));
    const b = bestBefore(t, 60);
    expect(b.quarter).toBeLessThan(b.median);
    expect(b.median).toBeLessThan(b.threeQuarters);
  });
  it("computes remaining life expectancy", () => {
    // Everyone alive at 95 lives 3 more years on average.
    expect(remainingYears(t, 95)).toBeCloseTo(3, 6);
    // From 60: the area under the line to 95 plus the open group, over 100,000.
    expect(remainingYears(t, 60)).toBeCloseTo((35 * (100_000 + 30_000)) / 2 / 100_000 + (30_000 * 3) / 100_000, 2);
  });
  it("turns ages into moments from the middle of the birth month", () => {
    expect(new Date(birthMoment("1980-02")).toISOString()).toBe("1980-02-15T12:00:00.000Z");
    expect(ageAtMoment("1980-02", momentAtAge("1980-02", 47.3))).toBeCloseTo(47.3, 9);
    const m = bestBeforeMoments(t, "1966-01", "2026-01-16");
    expect(m.age).toBeCloseTo(60, 1);
    expect(m.quarterAt).toBeLessThan(m.medianAt);
    // The same day gives the same moments, to the millisecond.
    expect(bestBeforeMoments(t, "1966-01", "2026-01-16").medianAt).toBe(m.medianAt);
  });
  it("conditions the chart on being alive now, rather than counting earlier deaths", () => {
    const curve = populationSurvival(t, 80);
    expect(curve[0]).toEqual({ age: 80, alivePercent: 100, tailApproximation: false });
    expect(curve.find((p) => p.age === 85)?.alivePercent).toBeCloseTo(100 * 50_000 / 60_000, 8);
    expect(curve.find((p) => p.age === 95)?.alivePercent).toBe(50);
    expect(populationSurvival(t, 60).find((p) => p.age === 85)?.alivePercent).toBe(50);
  });
  it("keeps fractional current age and marks the exponential tail without a discontinuity", () => {
    const curve = populationSurvival(t, 80.5);
    expect(curve[0]).toMatchObject({ age: 80.5, alivePercent: 100 });
    expect(curve.find((p) => p.age === 81)?.alivePercent).toBeCloseTo(100 * 58_000 / 59_000, 8);
    expect(curve.find((p) => p.age === 95)?.tailApproximation).toBe(false);
    expect(curve.find((p) => p.age === 96)).toMatchObject({ tailApproximation: true });
    expect(curve.find((p) => p.age === 96)?.alivePercent).toBeCloseTo(100 * 30_000 * Math.exp(-1 / 3) / 59_000, 8);
    expect(curve.at(-1)!.alivePercent).toBeLessThanOrEqual(1);
    expect(curve.every((p, i) => p.alivePercent >= 0 && p.alivePercent <= 100 && (i === 0 || p.alivePercent <= curve[i - 1]!.alivePercent))).toBe(true);
    expect(populationSurvival(t, 95.5).every((p) => p.tailApproximation)).toBe(true);
  });
  it.each([-1, NaN, Infinity])("does not chart an invalid current age: %s", (age) => {
    expect(populationSurvival(t, age)).toEqual([]);
  });
  it("distinguishes annual and multi-year reporting periods", () => {
    expect(lifeTablePeriod({ from: 2024, to: 2024 })).toBe("2024");
    expect(lifeTablePeriod({ from: 2022, to: 2024 })).toBe("2022–2024");
  });
});

describe("the shipped official population tables", () => {
  const file = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "knowledge", "lifetables", "countries.json"), "utf8")) as LifeTableFile;
  it("validates the source periods and survivor distributions used for country references", () => {
    expect(validateLifeTables(file)).toEqual([]);
    expect(tableFor(file, "HU", "f")).toMatchObject({ name: "Hungary", sex: "f" });
    expect(tableFor(file, "HU", undefined)?.sex).toBe("t");
    expect(tableFor(file, "XX", "f")).toBeUndefined();
    expect(tableFor(file, "constructor", "f")).toBeUndefined();
  });
  it("give plausible numbers: women outlive men, and remaining expectancy at 0 matches life expectancy at birth", () => {
    const f = tableFor(file, "EU27_2020", "f")!.table;
    const m = tableFor(file, "EU27_2020", "m")!.table;
    expect(remainingYears(f, 0)).toBeGreaterThan(remainingYears(m, 0));
    // EU life expectancy at birth is around 81 (both sexes); women about 84, men about 78.
    expect(remainingYears(f, 0)).toBeGreaterThan(80);
    expect(remainingYears(f, 0)).toBeLessThan(88);
    expect(remainingYears(m, 0)).toBeGreaterThan(74);
  });
  it.each([
    ["US", "f", 81.44568634033203, 20.830663681030273],
    ["US", "m", 76.52825164794922, 18.358739852905273],
    ["US", "t", 78.97103118896484, 19.661439895629883],
    ["GB", "f", 83.02, 21.16], ["GB", "m", 79.12, 18.73],
    ["CA", "f", 84.29, 22.45], ["CA", "m", 80.03, 19.75], ["CA", "t", 82.16, 21.15],
    ["AU", "f", 85.1047, 22.71761], ["AU", "m", 81.06156, 20.1023],
    ["NZ", "f", 83.45, 21.55], ["NZ", "m", 80.12, 19.43],
    ["JP", "f", 87.33, 24.52], ["JP", "m", 81.35, 19.68],
  ] as const)("reconstructs %s/%s published remaining means at birth and 65", (code, sex, e0, e65) => {
    // Native ex values from the official workbooks/CSVs; integrating the app's
    // linear lx and source e95 is approximate, not an invented replacement table.
    const found = tableFor(file, code, sex === "t" ? undefined : sex)!;
    expect(Math.abs(remainingYears(found.table, 0) - e0)).toBeLessThan(0.1);
    expect(Math.abs(remainingYears(found.table, 65) - e65)).toBeLessThan(0.1);
  });
  it.each(["GB", "AU", "NZ", "JP"])("does not invent a combined-sex distribution for %s", (code) => {
    expect(tableFor(file, code, undefined)).toBeUndefined();
    expect(bestBefore(tableFor(file, code, "f")!.table, 65).median).toBeGreaterThan(65);
  });
  it("rejects missing sources, missing sexes and broken numerical distributions", () => {
    const malformed = (change: (copy: LifeTableFile) => void) => {
      const copy = structuredClone(file);
      change(copy);
      return validateLifeTables(copy);
    };
    expect(validateLifeTables({ countries: {} })).toEqual(["no countries"]);
    expect(malformed((copy) => { copy.countries.US!.source.period = { from: 2025, to: 2024 }; })).not.toEqual([]);
    expect(malformed((copy) => { delete copy.countries.US!.tables.m; })).not.toEqual([]);
    expect(malformed((copy) => { copy.countries.US!.tables.f!.lx[20] = NaN; })).not.toEqual([]);
    expect(malformed((copy) => { copy.countries.US!.tables.f!.lx[20] = 100_001; })).not.toEqual([]);
    expect(malformed((copy) => { copy.countries.US!.tables.f!.e95 = Infinity; })).not.toEqual([]);
  });
});

describe("risk-equivalent age projection", () => {
  it("reads the table at a comparison age and adds those remaining years to calendar age", () => {
    const plain = bestBeforeMoments(t, "1966-01", "2026-01-16");
    const younger = bestBeforeWithShift(t, "1966-01", "2026-01-16", -10);
    // Compared with people aged about 50: in this table nobody dies before 60, so the median comes 10 years later.
    expect(younger.comparedAge).toBeCloseTo(50, 1);
    expect(younger.median).toBeCloseTo(plain.median + 10, 1);
    expect(younger.medianAt).toBeGreaterThan(plain.medianAt);
    // No difference: the same as the plain table.
    expect(bestBeforeWithShift(t, "1966-01", "2026-01-16", 0).medianAt).toBe(plain.medianAt);
  });
});
