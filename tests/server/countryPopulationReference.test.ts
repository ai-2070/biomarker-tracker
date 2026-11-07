import fs from "node:fs";
import path from "node:path";
import * as projection from "@bt/shared/core/mortalityProjection";
import type { Measurement, Profile } from "@bt/shared/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPack } from "../../apps/server/assistant";
import { biologicalAge, type HealthSnapshot, healthTools } from "../../apps/server/healthTools";
import * as knowledge from "../../apps/server/knowledge";

const today = "2026-11-01";
const snapshot = (profile: Profile, expirationDate = false, measurements: Measurement[] = []): HealthSnapshot => ({
  profile,
  expirationDate,
  measurements,
  protocols: [],
  experiments: [],
});
const adult: Profile = { birthMonth: "1971-05", sex: "m", smoking: "never", heightCm: 180, country: "CA" };
const body = (): Measurement[] => [
  { id: "fat", biomarkerId: "body_fat", value: 24, originalValue: 24, originalUnit: "%", source: "manual", date: today },
  { id: "waist", biomarkerId: "waist", value: 90, originalValue: 90, originalUnit: "cm", source: "manual", date: today },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${today}T12:00:00Z`));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe("biological-age country population reference", () => {
  it("serves code-derived conditional survival through tools and the tool-less summary with dates off, without loading or running fitted models", async () => {
    vi.spyOn(knowledge, "mortalityModels").mockImplementation(() => {
      throw new Error("Fitted models must not load with dates off");
    });
    vi.spyOn(projection, "mortalityProjection").mockImplementation(() => {
      throw new Error("No fitted projection with dates off");
    });
    const s = snapshot(adult, false, body());
    const biological = (await healthTools(s).get_biological_age!.execute!({}, { toolCallId: "population", messages: [] } as never)) as ReturnType<
      typeof biologicalAge
    >;
    const reference = biological.countryPopulationReference;
    if (typeof reference === "string") throw new Error(reference);
    const file = knowledge.lifeTables()!;
    const table = file.countries.CA!.tables.m!;
    const age = reference.currentAge;
    expect(age).toBeGreaterThan(55);
    expect(age).toBeLessThan(56);
    expect(reference.country).toBe("CA");
    expect(reference.sex).toBe("m");
    expect(reference.survivalByAge[0]).toEqual({ age, alivePercent: 100, tailApproximation: false });
    // Independent interpolation of the source survivors checks the conditional denominator,
    // rather than accepting a birth-cohort percentage or an adjusted model age.
    const floor = Math.floor(age);
    const aliveNow = table.lx[floor]! + (table.lx[floor + 1]! - table.lx[floor]!) * (age - floor);
    expect(reference.survivalByAge[1]!.alivePercent).toBeCloseTo((100 * table.lx[floor + 1]!) / aliveNow, 10);
    expect(reference.survivalByAge.at(-1)!.alivePercent).toBeLessThanOrEqual(1);
    expect(reference.survivalByAge.some((point) => point.age > 95 && point.tailApproximation)).toBe(true);
    expect(reference.middleHalfAges[0]).toBeLessThan(reference.medianAge);
    expect(reference.middleHalfAges[1]).toBeGreaterThan(reference.medianAge);
    expect(typeof biological.expirationDate).toBe("string");
    const packed = JSON.parse(dataPack(s)) as { biologicalAge: typeof biological };
    expect(JSON.stringify(packed.biologicalAge)).not.toMatch(/medianDate|quarterAt|medianAt|threeQuartersAt/);
    const dates = [...JSON.stringify(packed.biologicalAge).matchAll(/"(\d{4}-\d{2}-\d{2})"/g)].map((match) => match[1]!);
    expect(dates.every((date) => date <= today)).toBe(true);
  });

  it("requires sex when the source has no combined-sex table instead of substituting another distribution", () => {
    const missingSex = biologicalAge(snapshot({ birthMonth: adult.birthMonth, country: "JP" }, true));
    expect(missingSex.countryPopulationReference).toEqual(expect.stringMatching(/sex.*Settings/i));
    expect(missingSex.expirationDate).toBe(missingSex.countryPopulationReference);
    const both = biologicalAge(snapshot({ birthMonth: adult.birthMonth, country: "AT" })).countryPopulationReference;
    if (typeof both === "string") throw new Error(both);
    expect(both.sex).toBe("t");
  });

  it("computes the age-95-plus median and mean from the actual sex-specific exponential tail", () => {
    for (const sex of ["m", "f"] as const) {
      const reference = biologicalAge(snapshot({ country: "JP", sex, birthMonth: "1930-11" })).countryPopulationReference;
      if (typeof reference === "string") throw new Error(reference);
      const e95 = knowledge.lifeTables()!.countries.JP!.tables[sex]!.e95;
      expect(reference.currentAge).toBeGreaterThan(95);
      expect(reference.averageRemainingYears).toBeCloseTo(e95, 10);
      expect(reference.medianAge).toBeCloseTo(reference.currentAge + e95 * Math.log(2), 10);
      expect(reference.middleHalfAges[0]).toBeCloseTo(reference.currentAge + e95 * Math.log(4 / 3), 10);
      expect(reference.middleHalfAges[1]).toBeCloseTo(reference.currentAge + e95 * Math.log(4), 10);
      expect(reference.survivalByAge.every((point) => point.tailApproximation)).toBe(true);
    }
  });

  it("distinguishes missing or unsupported country, missing birth month and future birth month from valid statistics", () => {
    for (const country of [undefined, "XX"]) {
      const result = biologicalAge(snapshot({ ...adult, country }, true));
      expect(result.countryPopulationReference).toEqual(expect.stringMatching(/supported country/i));
      expect(result.expirationDate).toBe(result.countryPopulationReference);
    }
    expect(biologicalAge(snapshot({ country: "CA" })).countryPopulationReference).toEqual(expect.stringMatching(/month and year of birth/i));
    expect(biologicalAge(snapshot({ ...adult, birthMonth: "2099-01" })).countryPopulationReference).toEqual(expect.stringMatching(/future/i));
  });

  it("retains fitted score, calibration, included/excluded inputs and opt-in dates while country changes only the population baseline", () => {
    const s = snapshot(adult, true, body());
    const ca = biologicalAge(s);
    const jp = biologicalAge({ ...s, profile: { ...adult, country: "JP" } });
    if (typeof ca.expirationDate === "string" || typeof jp.expirationDate === "string") throw new Error("Missing opt-in result");
    const fitted = ca.expirationDate.fittedTenYearMortality;
    if (fitted.percent === undefined || !fitted.includedInputs || !fitted.limits) throw new Error(JSON.stringify(fitted));
    expect(fitted.percent).toBeGreaterThan(0);
    expect(fitted.heldOutEvaluation).toBeDefined();
    expect(fitted.includedInputs.map((input) => input.key)).toEqual(expect.arrayContaining(["age", "sex", "bodyFat", "waistToHeight"]));
    expect(fitted.limits.length).toBeGreaterThan(0);
    expect(ca.expirationDate.notUsed.map((input) => input.key)).toEqual(expect.arrayContaining(["hrv_resting", "dunedinpace", "fitness"]));
    expect(jp.expirationDate.fittedTenYearMortality).toEqual(fitted);
    expect(ca.expirationDate.populationReference.medianDate).not.toBe(jp.expirationDate.populationReference.medianDate);
    expect(ca.expirationDate.medianDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const off = biologicalAge({ ...s, expirationDate: false });
    expect(off.countryPopulationReference).toEqual(ca.countryPopulationReference);
  });

  it.each(["missing", "invalid JSON", "invalid survivors"])("fails closed at the biological-age consumer when countries.json is %s", async (failure) => {
    const originalRead = fs.readFileSync;
    const artifact = path.join("knowledge", "lifetables", "countries.json");
    const valid = failure === "invalid survivors" ? JSON.parse(originalRead(path.resolve(artifact), "utf8")) : undefined;
    if (valid) valid.countries.CA.tables.m.lx[1] = 100_001;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (String(file).endsWith(artifact)) {
        if (failure === "missing") throw Object.assign(new Error("missing country file"), { code: "ENOENT" });
        return failure === "invalid JSON" ? "{" : JSON.stringify(valid);
      }
      return Reflect.apply(originalRead, fs, [file, ...args]);
    }) as typeof fs.readFileSync);
    vi.resetModules();
    // A fresh module cache is required to exercise failed first-load validation, not the already cached valid artifact.
    const isolated = await import("../../apps/server/healthTools");
    const result = isolated.biologicalAge(snapshot(adult, true, body()));
    expect(result.countryPopulationReference).toEqual(expect.stringMatching(/could not be loaded or validated/i));
    expect(result.expirationDate).toBe(result.countryPopulationReference);
    expect(JSON.stringify(result)).not.toMatch(/survivalByAge|medianDate|riskEquivalentAge/);
  });
});
