import { describe, expect, it } from "vitest";
import modelJson from "../../knowledge/models/mortality.json";
import evaluationJson from "../../tools/longevity/evaluation.json";
import { bestBeforeMoments, type LifeTable } from "@bt/shared/core/lifeTable";
import { coxRisk10, mortalityRiskAge, predictMortality, validateMortalityModels, type MortalityInputs, type MortalityModelFile } from "@bt/shared/core/mortalityModel";
import { mortalityProjection } from "@bt/shared/core/mortalityProjection";
import type { Measurement, Profile } from "@bt/shared/core/types";

const file = modelJson as unknown as MortalityModelFile;
const evaluations = evaluationJson as unknown as { variants: Record<string, { syntheticInferenceOracles: { input: MortalityInputs; lifelinesRisk10: number; lifelinesComparisonRisk10: number }[] }> };
const today = "2026-10-31";
const profile: Profile = { birthMonth: "1971-05", sex: "m", smoking: "never", heightCm: 180, country: "AT" };
const table: LifeTable = { lx: Array.from({ length: 96 }, (_, age) => age <= 60 ? 100_000 : 100_000 - (age - 60) * 2_000), e95: 3 };
const raw: MortalityInputs = { age: 55, sex: "m", smoking: "never", bodyFat: 24, waistToHeight: 0.5, phenoAgeGap: -3 };
let sequence = 0;
function reading(biomarkerId: string, value: number, date = today, extra: Partial<Measurement> = {}): Measurement {
  return { id: `synthetic-${sequence++}`, biomarkerId, value, originalValue: value, originalUnit: biomarkerId === "body_fat" ? "%" : biomarkerId === "waist" ? "cm" : "min", date, source: "manual", ...extra };
}
const body = () => [reading("body_fat", 24), reading("waist", 90)];
const clinicalValues: Record<string, number> = { albumin: 42, creatinine: 90, glucose: 5.5, crp_hs: 1, lymphocyte_pct: 30, mcv: 92, rdw: 13.5, alp: 80, wbc: 6 };
const labs = (date = today) => Object.entries(clinicalValues).map(([id, value]) => reading(id, value, date));
const ago = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

describe("fitted mortality inference", () => {
  it("accepts the shipped artifact and matches independent native-fitter predictions for nonlinear, sex and smoking cases", () => {
    expect(validateMortalityModels(file)).toEqual([]);
    for (const model of file.models) {
      for (const oracle of evaluations.variants[model.id]!.syntheticInferenceOracles) {
        expect(coxRisk10(model.fits, oracle.input)).toBeCloseTo(oracle.lifelinesRisk10, 12);
        expect(coxRisk10([model.comparison], oracle.input)).toBeCloseTo(oracle.lifelinesComparisonRisk10, 12);
        expect(mortalityRiskAge(model.comparison, oracle.lifelinesComparisonRisk10, oracle.input.sex!)).toBeCloseTo(oracle.input.age!, 9);
      }
    }
  });

  it("does not turn unknown smoking into never smoking or invent absent model inputs", () => {
    const result = predictMortality(file, { ...raw, smoking: undefined });
    expect(result.status).toBe("unavailable");
    expect(result.model).toBeUndefined();
    expect(result.risk10).toBeUndefined();
    expect(() => coxRisk10(file.models.find((m) => m.id === "body")!.fits, { age: 55, sex: "m", smoking: "never" })).toThrow(RangeError);
  });

  it("uses the separately fitted blood model when body measurements are absent", () => {
    const result = predictMortality(file, { ...raw, bodyFat: undefined, waistToHeight: undefined });
    expect(result.status).toBe("ok");
    expect(result.model?.id).toBe("blood");
  });

  it("refuses out-of-cohort ages and models that failed held-out evaluation", () => {
    expect(predictMortality(file, { ...raw, age: 85 }).status).toBe("unavailable");
    const rejected = structuredClone(file);
    for (const model of rejected.models) {
      model.evaluation.brier = model.evaluation.baselineBrier + 0.01;
      model.evaluation.accepted = false;
    }
    const result = predictMortality(rejected, raw);
    expect(result.status).toBe("unavailable");
    expect(result.risk10).toBeUndefined();
  });

  it("does not extrapolate when a required development support range is missing", () => {
    const damaged = structuredClone(file);
    damaged.models = damaged.models.filter((m) => m.id === "body");
    delete damaged.models[0]!.ranges.bodyFat;
    const result = mortalityProjection(table, profile, body(), today, damaged);
    expect(result.prediction.status).toBe("unavailable");
    expect(result.adjusted).toBeUndefined();
  });

  it("keeps a fitted risk but refuses an exact lifetime date outside the risk-age reference", () => {
    const syntheticReference = structuredClone(file);
    for (const model of syntheticReference.models) model.comparison.baselineHazard10 = 1e-12;
    const result = mortalityProjection(table, profile, body(), today, syntheticReference);
    expect(result.prediction.status).toBe("ok");
    expect(result.prediction.riskAgeBound).toBe("above");
    expect(result.adjusted).toBeUndefined();
    expect(result.plain?.medianAt).toBe(bestBeforeMoments(table, profile.birthMonth!, today).medianAt);
  });
});

describe("mortality projection data compatibility", () => {
  it("preserves the country reference without silently falling back to the old PhenoAge-only shift", () => {
    const result = mortalityProjection(table, { ...profile, smoking: undefined }, [...body(), ...labs()], today, file);
    expect(result.prediction.status).toBe("unavailable");
    expect(result.adjusted).toBeUndefined();
    expect(result.plain?.medianAt).toBe(bestBeforeMoments(table, profile.birthMonth!, today).medianAt);
  });

  it("does not use future or stale body readings and respects persisted same-day save order", () => {
    const invalid = mortalityProjection(table, profile, [reading("body_fat", 24, "2025-10-30"), reading("body_fat", 40, "2026-11-01"), reading("waist", 90)], today, file);
    expect(invalid.prediction.status).toBe("unavailable");
    const ordered = mortalityProjection(table, profile, [reading("body_fat", 24, today, { savedOrder: 2 }), reading("body_fat", 40, today, { savedOrder: 1 }), reading("waist", 90)], today, file);
    expect(ordered.prediction.model?.id).toBe("body");
    expect(ordered.included.find((v) => v.key === "bodyFat")?.value).toBe(24);
  });

  it("requires explicit activity compatibility, distinct-day coverage and actual daily totals including zeros", () => {
    const days = Array.from({ length: 20 }, (_, n) => reading("active_minutes", 0, ago(n)));
    const duplicate = [reading("active_minutes", 10, today, { savedOrder: 2 }), reading("active_minutes", 60, today, { savedOrder: 1 })];
    const insufficient = [...body(), ...days, ...duplicate];
    expect(mortalityProjection(table, profile, insufficient, today, file, true).prediction.model?.id).toBe("body");
    const complete = [...insufficient, reading("active_minutes", 0, ago(20))];
    expect(mortalityProjection(table, profile, complete, today, file).prediction.model?.id).toBe("body");
    const result = mortalityProjection(table, profile, complete, today, file, true);
    expect(result.prediction.model?.id).toBe("body_activity");
    expect(result.included.find((v) => v.key === "activityWeekly")?.value).toBeCloseTo(10 / 3, 12);
    const boundedWinner = reading("active_minutes", 120, ago(20), { savedOrder: 3, qualifier: ">" });
    expect(mortalityProjection(table, profile, [...complete, boundedWinner], today, file, true).prediction.model?.id).toBe("body");
  });

  it("does not mix blood draws or widely separated body measurements", () => {
    const splitLabs = labs().map((m, n) => n < 4 ? { ...m, date: ago(1) } : m);
    expect(mortalityProjection(table, profile, [...body(), ...splitLabs], today, file).prediction.model?.id).toBe("body");
    expect(mortalityProjection(table, profile, [...body(), ...labs()], today, file).prediction.model?.id).toBe("clinical");
    const separated = [reading("body_fat", 24, ago(40)), reading("waist", 90)];
    expect(mortalityProjection(table, profile, separated, today, file).prediction.status).toBe("unavailable");
  });

  it("accepts a positive CRP detection limit but not other bounded lab values as exact inputs", () => {
    const boundedCrp = labs().map((m) => m.biomarkerId === "crp_hs" ? { ...m, qualifier: "<" as const } : m);
    expect(mortalityProjection(table, profile, [...body(), ...boundedCrp], today, file).prediction.model?.id).toBe("clinical");
    const boundedAlbumin = labs().map((m) => m.biomarkerId === "albumin" ? { ...m, qualifier: "<" as const } : m);
    expect(mortalityProjection(table, profile, [...body(), ...boundedAlbumin], today, file).prediction.model?.id).toBe("body");
  });

  it("does not assign weights to recorded HRV, DunedinPACE or functional test results", () => {
    const baseline = mortalityProjection(table, profile, body(), today, file);
    const extra = mortalityProjection(table, profile, [...body(), reading("hrv_resting", 70), reading("dunedinpace", 0.88), reading("grip_strength", 50), reading("gait_speed", 1.4)], today, file);
    expect(extra.prediction.risk10).toBe(baseline.prediction.risk10);
    expect(extra.adjusted?.medianAt).toBe(baseline.adjusted?.medianAt);
    expect(extra.included.map((v) => v.key)).toEqual(baseline.included.map((v) => v.key));
  });
});
