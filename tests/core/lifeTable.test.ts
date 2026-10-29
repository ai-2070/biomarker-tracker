import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ageAtMoment, ageWhenLeft, bestBefore, bestBeforeMoments, bestBeforeWithShift, phenoAgeShift, birthMoment, momentAtAge, remainingYears, survivors, tableFor, validateLifeTables, type LifeTable, type LifeTableFile } from "../../src/core/lifeTable";

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
});

describe("the shipped Eurostat tables", () => {
  const file = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "knowledge", "lifetables", "eurostat.json"), "utf8")) as LifeTableFile;
  it("are valid, for every EU and EFTA country and the EU average", () => {
    expect(validateLifeTables(file)).toEqual([]);
    expect(Object.keys(file.countries).length).toBe(32);
    expect(tableFor(file, "HU", "f")).toMatchObject({ name: "Hungary", sex: "f" });
    expect(tableFor(file, "HU", undefined)?.sex).toBe("t");
    expect(tableFor(file, "XX", "f")).toBeUndefined();
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
});

describe("with your blood tests", () => {
  it("averages the PhenoAge difference over the latest tests within 2 years", () => {
    const draws = [
      { date: "2022-01-01", age: 40, phenoAge: 50 },
      { date: "2025-03-01", age: 43, phenoAge: 40 },
      { date: "2025-09-01", age: 43.5, phenoAge: 41.5 },
      { date: "2026-03-01", age: 44, phenoAge: 42 },
    ];
    // Differences −3, −2 and −2: the 2022 test is more than 2 years before the latest.
    expect(phenoAgeShift(draws)).toMatchObject({ tests: 3, from: "2025-03-01", to: "2026-03-01" });
    expect(phenoAgeShift(draws)!.shift).toBeCloseTo(-7 / 3, 9);
    expect(phenoAgeShift([])).toBeUndefined();
  });
  it("reads the table at your PhenoAge and adds those remaining years to your age", () => {
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
