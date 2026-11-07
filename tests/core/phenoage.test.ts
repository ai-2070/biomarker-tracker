import { mortalityFromPhenoAge, mortalityScore, type PhenoAgeInputs, phenoAge, phenoAgeFromLogHazard, phenoAgeLogHazard } from "@bt/shared/core/phenoage";
import { describe, expect, it } from "vitest";

const typical: PhenoAgeInputs = {
  albumin: 45,
  creatinine: 80,
  glucose: 5.0,
  crp_hs: 1, // mg/L = 0.1 mg/dL
  lymphocyte_pct: 30,
  mcv: 90,
  rdw: 13,
  alp: 70,
  wbc: 6,
  age: 40,
};

/**
 * Literal transcription of BioAge's `phenoage_calc(orig = TRUE)` (R), used as
 * an independent oracle. It uses full-precision weights and goes through M.
 */
function bioAgeReference(x: PhenoAgeInputs): number {
  const lncrp = Math.log(x.crp_hs / 10);
  const xb =
    -19.90667 +
    -0.03359355 * x.albumin +
    0.009506491 * x.creatinine +
    0.1953192 * x.glucose +
    0.09536762 * lncrp +
    -0.01199984 * x.lymphocyte_pct +
    0.02676401 * x.mcv +
    0.3306156 * x.rdw +
    0.001868778 * x.alp +
    0.05542406 * x.wbc +
    0.08035356 * x.age;
  const m = 1 - Math.exp((-1.51714 * Math.exp(xb)) / 0.007692696);
  return Math.log(-0.0055305 * Math.log(1 - m)) / 0.090165 + 141.50225;
}

describe("phenoAgeFromLogHazard", () => {
  // Reference values computed in R 4.5.3 by the pyaging maintainers
  // (docs/development/phenoage-gompertz-correction.md).
  it.each([
    [-12, 9.37497303957636],
    [-9, 42.64730709381026],
    [-6, 75.91964114804416],
  ])("log hazard %d gives %f years", (xb, expected) => {
    expect(phenoAgeFromLogHazard(xb)).toBeCloseTo(expected, 9);
  });

  it("equals the paper's formula written with M", () => {
    for (const xb of [-12, -10, -8, -6, -4]) {
      const m = mortalityScore(xb);
      const viaM = 141.50225 + Math.log(-0.00553 * Math.log(1 - m)) / 0.090165;
      expect(phenoAgeFromLogHazard(xb)).toBeCloseTo(viaM, 6);
    }
  });

  it("stays finite where the M form breaks down", () => {
    // exp(xb) is so large that M rounds to exactly 1 and ln(1 - M) is -Infinity.
    expect(mortalityScore(3)).toBe(1);
    expect(Number.isFinite(phenoAgeFromLogHazard(3))).toBe(true);
  });
});

describe("phenoAge", () => {
  it("gives a plausible result for a typical healthy 40-year-old", () => {
    // Pinned so any change to weights or units is caught.
    expect(phenoAge(typical)).toBeCloseTo(32.972, 3);
    expect(bioAgeReference(typical)).toBeCloseTo(32.926, 3);
  });

  it("agrees with the BioAge R reference across a wide range of inputs", () => {
    const cases: PhenoAgeInputs[] = [
      typical,
      { ...typical, age: 25, crp_hs: 0.3, glucose: 4.6 },
      { ...typical, age: 70, crp_hs: 8, rdw: 15.5, albumin: 38, creatinine: 120 },
      { ...typical, age: 55, wbc: 9.5, alp: 120, mcv: 99, lymphocyte_pct: 18 },
      { ...typical, age: 85, crp_hs: 25, glucose: 9, rdw: 17 },
    ];
    for (const c of cases) {
      // Published 4-digit weights vs BioAge full precision: within 0.2 years.
      expect(Math.abs(phenoAge(c) - bioAgeReference(c))).toBeLessThan(0.2);
    }
  });

  it("converts CRP from mg/L to mg/dL before taking the log", () => {
    const xb1 = phenoAgeLogHazard({ ...typical, crp_hs: 10 }); // 1 mg/dL -> ln = 0
    const xb0 = phenoAgeLogHazard(typical);
    expect(xb1 - xb0).toBeCloseTo(0.0954 * Math.log(10), 10);
  });

  it("moves in the published direction for each marker", () => {
    const base = phenoAge(typical);
    expect(phenoAge({ ...typical, albumin: 50 })).toBeLessThan(base);
    expect(phenoAge({ ...typical, lymphocyte_pct: 40 })).toBeLessThan(base);
    for (const k of ["creatinine", "glucose", "crp_hs", "mcv", "rdw", "alp", "wbc", "age"] as const) {
      expect(phenoAge({ ...typical, [k]: typical[k] * 1.2 })).toBeGreaterThan(base);
    }
  });

  it("rises by about one year per calendar year with other markers unchanged", () => {
    const d = phenoAge({ ...typical, age: 41 }) - phenoAge(typical);
    expect(d).toBeCloseTo(0.0804 / 0.090165, 6);
  });

  it("refuses CRP of zero or below", () => {
    expect(() => phenoAge({ ...typical, crp_hs: 0 })).toThrow(RangeError);
    expect(() => phenoAge({ ...typical, crp_hs: -1 })).toThrow(RangeError);
  });
});

describe("the 10-year risk a PhenoAge stands for", () => {
  it("is the model's own mortality score, recovered from the PhenoAge", () => {
    for (const xb of [-12, -9, -6]) expect(mortalityFromPhenoAge(phenoAgeFromLogHazard(xb))).toBeCloseTo(mortalityScore(xb), 12);
    // Older PhenoAge, higher risk.
    expect(mortalityFromPhenoAge(60)).toBeGreaterThan(mortalityFromPhenoAge(40));
  });
});
