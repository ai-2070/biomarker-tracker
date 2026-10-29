import { describe, expect, it } from "vitest";
import { cutoffsMet, describePlace, normRow, placeInRow, placeResult, rowSpan, type FitnessTestDef, type NormSet } from "../../src/core/fitnessTests";

const source = { title: "Made-up norms", year: 2020, studyType: "observational" as const };

// Made-up tables in the three shapes sources use.
const bands: NormSet = {
  source,
  verifiedFrom: "test",
  population: "test",
  kind: "bands",
  variant: "standard",
  labels: ["Poor", "Below average", "Average", "Good", "Excellent"],
  rows: [
    {
      sex: "m",
      ageFrom: 20,
      ageTo: 29,
      bands: [
        { label: "Poor", min: 0, max: 11 },
        { label: "Below average", min: 12, max: 21 },
        { label: "Average", min: 22, max: 25 },
        { label: "Good", min: 26, max: 35 },
        { label: "Excellent", min: 39 },
      ],
    },
    { sex: "f", ageFrom: 20, ageTo: 29, bands: [{ label: "Poor", min: 0, max: 2 }, { label: "Average", min: 3, max: 9 }, { label: "Excellent", min: 10 }] },
  ],
};
const percentiles: NormSet = {
  source,
  verifiedFrom: "test",
  population: "test",
  kind: "percentiles",
  rows: [
    { sex: "m", ageFrom: 40, ageTo: 44, p10: 38, p50: 47, p90: 56 },
    { sex: "any", ageFrom: 70, p10: 20, p50: 28, p90: 36 },
  ],
};
const meanSd: NormSet = { source, verifiedFrom: "test", population: "test", kind: "mean_sd", rows: [{ sex: "f", ageFrom: 60, ageTo: 69, mean: 1.2, sd: 0.2 }] };

const test: FitnessTestDef = {
  id: "t",
  name: "Test",
  unit: "reps",
  higherIsBetter: true,
  summary: "",
  howTo: [],
  safety: [],
  norms: [bands, percentiles, meanSd],
  cutoffs: [
    { label: "Low (men)", sex: "m", below: 27, source },
    { label: "Slow from 65", atOrBelow: 0.8, ageFrom: 65, source },
  ],
  evidence: [],
  limits: [],
};

describe("fitness test norms", () => {
  it("finds the row for a sex and age, inclusive of the last year of a band", () => {
    expect(normRow(bands, "m", 29.9)?.ageTo).toBe(29);
    expect(normRow(bands, "m", 30)).toBeUndefined();
    expect(normRow(bands, "f", 20)?.sex).toBe("f");
    expect(normRow(bands, undefined, 25)).toBeUndefined();
    // "any" rows serve everyone; open-ended rows have no upper age.
    expect(normRow(percentiles, "f", 88)?.ageFrom).toBe(70);
  });

  it("places a value in a band, in a gap between bands, or past the ends", () => {
    const row = normRow(bands, "m", 25)!;
    expect(placeInRow(bands, row, 30)).toEqual({ kind: "band", label: "Good", rank: 3, of: 5 });
    expect(placeInRow(bands, row, 0)).toEqual({ kind: "band", label: "Poor", rank: 0, of: 5 });
    expect(placeInRow(bands, row, 80)).toEqual({ kind: "band", label: "Excellent", rank: 4, of: 5 });
    expect(placeInRow(bands, row, 37)).toEqual({ kind: "between-bands", lower: "Good", upper: "Excellent" });
    expect(placeInRow(bands, row, 25.5)).toEqual({ kind: "between-bands", lower: "Average", upper: "Good" });
    // A row with fewer bands than the labels still ranks by the shared labels.
    expect(placeInRow(bands, normRow(bands, "f", 22)!, 5)).toEqual({ kind: "band", label: "Average", rank: 2, of: 5 });
  });

  it("places a value between percentiles", () => {
    const row = normRow(percentiles, "m", 42)!;
    expect(placeInRow(percentiles, row, 50)).toEqual({ kind: "percentile", above: 50, below: 90, median: 47 });
    expect(placeInRow(percentiles, row, 47)).toEqual({ kind: "percentile", above: 50, below: 90, median: 47 });
    expect(placeInRow(percentiles, row, 30)).toEqual({ kind: "percentile", below: 10, median: 47 });
    expect(placeInRow(percentiles, row, 60)).toEqual({ kind: "percentile", above: 90, median: 47 });
  });

  it("gives the distance from the average in standard deviations", () => {
    const place = placeInRow(meanSd, normRow(meanSd, "f", 65)!, 0.9);
    expect(place).toMatchObject({ kind: "mean_sd", mean: 1.2, sd: 0.2 });
    expect(place?.kind === "mean_sd" && place.z).toBeCloseTo(-1.5);
  });

  it("uses every table that covers the person, and none without an age", () => {
    expect(placeResult(test, 30, { sex: "m", age: 25 }).map((r) => r.set.kind)).toEqual(["bands"]);
    expect(placeResult(test, 30, { sex: "m", age: 42 }).map((r) => r.set.kind)).toEqual(["percentiles"]);
    expect(placeResult(test, 30, { sex: "m" })).toEqual([]);
    expect(placeResult(test, 30, { age: 25 })).toEqual([]);
    // A variant picks its own tables (and tables without one).
    expect(placeResult(test, 30, { sex: "m", age: 25 }, "knee")).toEqual([]);
    expect(placeResult(test, 30, { sex: "m", age: 25 }, "standard")).toHaveLength(1);
  });

  it("checks clinical cut-offs by sex and age", () => {
    expect(cutoffsMet(test, 20, { sex: "m", age: 50 }).map((c) => c.label)).toEqual(["Low (men)"]);
    expect(cutoffsMet(test, 20, { sex: "f", age: 50 })).toEqual([]);
    expect(cutoffsMet(test, 0.8, { sex: "f", age: 70 }).map((c) => c.label)).toEqual(["Slow from 65"]);
    expect(cutoffsMet(test, 0.8, { sex: "f", age: 50 })).toEqual([]);
    expect(cutoffsMet(test, 0.8, { sex: "f" })).toEqual([]);
  });

  it("describes a place in plain words", () => {
    expect(describePlace({ kind: "band", label: "Good", rank: 3, of: 5 })).toBe("Good");
    expect(describePlace({ kind: "between-bands", lower: "Good", upper: "Excellent" })).toBe("Between good and excellent");
    expect(describePlace({ kind: "percentile", above: 25, below: 50 })).toBe("Between the 25th and 50th percentile");
    expect(describePlace({ kind: "percentile", below: 10 })).toBe("Below the 10th percentile");
    expect(describePlace({ kind: "percentile", above: 90 })).toBe("Above the 90th percentile");
    expect(describePlace({ kind: "mean_sd", mean: 1, sd: 0.2, z: 0.4 })).toBe("About average");
    expect(describePlace({ kind: "mean_sd", mean: 1, sd: 0.2, z: -1.2 })).toBe("Below average");
  });

  it("uses the nearest row when a table gives values at exact ages", () => {
    const atAges: NormSet = {
      source,
      verifiedFrom: "test",
      population: "test",
      kind: "percentiles",
      rows: [20, 25, 30, 90].map((a) => ({ sex: "f" as const, ageFrom: a, ageTo: a, p50: a })),
    };
    expect(rowSpan(atAges.rows, atAges.rows[1]!)).toEqual([22.5, 27.5]);
    expect(rowSpan(atAges.rows, atAges.rows[0]!)).toEqual([17.5, 22.5]);
    expect(normRow(atAges, "f", 22.4)?.ageFrom).toBe(20);
    expect(normRow(atAges, "f", 22.5)?.ageFrom).toBe(25);
    expect(normRow(atAges, "f", 17)).toBeUndefined();
    // A big gap: each side takes half of it.
    expect(normRow(atAges, "f", 59)?.ageFrom).toBe(30);
    expect(normRow(atAges, "f", 61)?.ageFrom).toBe(90);
    expect(normRow(atAges, "f", 95)?.ageFrom).toBe(90);
    expect(normRow(atAges, "f", 120)).toBeUndefined();
  });

  it("compares only with norms for the test's usual way of doing it", () => {
    const pure: NormSet = { ...percentiles, variant: "dominant hand" };
    const dodds: NormSet = { ...percentiles, variant: "best of either hand" };
    const grip = { ...test, defaultVariant: "best of either hand", norms: [pure, dodds] };
    expect(placeResult(grip, 50, { sex: "m", age: 42 }).map((r) => r.set.variant)).toEqual(["best of either hand"]);
    expect(placeResult(grip, 50, { sex: "m", age: 42 }, "dominant hand").map((r) => r.set.variant)).toEqual(["dominant hand"]);
  });
});
