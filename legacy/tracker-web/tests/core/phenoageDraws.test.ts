import { describe, expect, it } from "vitest";
import { phenoAge, type PhenoAgeInputs } from "../../src/core/phenoage";
import { ageAt, isBirthMonth, summarizePhenoAge } from "../../src/core/phenoageDraws";
import type { Measurement } from "../../src/core/types";

const panel: Record<string, number> = {
  albumin: 45,
  creatinine: 80,
  glucose: 5,
  crp_hs: 1,
  lymphocyte_pct: 30,
  mcv: 90,
  rdw: 13,
  alp: 70,
  wbc: 6,
};

let n = 0;
function draw(date: string, overrides: Partial<Record<string, number>> = {}, skip: string[] = []): Measurement[] {
  return Object.entries({ ...panel, ...overrides })
    .filter(([id]) => !skip.includes(id))
    .map(([biomarkerId, value]) => ({
      id: `m${++n}`,
      biomarkerId,
      value: value!,
      originalValue: value!,
      originalUnit: "x",
      date,
      source: "manual" as const,
    }));
}

describe("ageAt / isBirthMonth", () => {
  it("validates YYYY-MM", () => {
    expect(isBirthMonth("1985-07")).toBe(true);
    expect(isBirthMonth("1985-13")).toBe(false);
    expect(isBirthMonth("1985-7")).toBe(false);
    expect(isBirthMonth("1850-01")).toBe(false);
  });
  it("computes age from the middle of the birth month", () => {
    expect(ageAt("1985-07", "2025-07-15")).toBeCloseTo(40, 1);
    expect(ageAt("1985-07", "2025-01-15")).toBeCloseTo(39.5, 1);
  });
});

describe("summarizePhenoAge", () => {
  it("computes PhenoAge only for dates with all 9 markers", () => {
    const s = summarizePhenoAge([...draw("2024-03-01"), ...draw("2023-03-01", {}, ["rdw"])], "1985-03");
    expect(s.draws.map((d) => d.date)).toEqual(["2024-03-01"]);
    const d = s.draws[0]!;
    expect(d.status).toBe("ok");
    expect(d.phenoAge).toBeCloseTo(phenoAge({ ...(panel as Omit<PhenoAgeInputs, "age">), age: d.age! }), 9);
    expect(d.difference).toBeCloseTo(d.phenoAge! - d.age!, 9);
  });

  it("never mixes markers from different dates", () => {
    const ms = [...draw("2024-03-01", {}, ["alp"]), ...draw("2024-03-02", {}, ["albumin", "creatinine"])];
    expect(summarizePhenoAge(ms, "1985-03").draws).toEqual([]);
  });

  it("reports what the newest incomplete draw is missing", () => {
    const s = summarizePhenoAge([...draw("2023-01-01"), ...draw("2024-01-01", {}, ["rdw", "alp"])], "1985-03");
    expect(s.draws.length).toBe(1);
    expect(s.latestPartial).toEqual({ date: "2024-01-01", missing: ["rdw", "alp"] });
  });

  it("does not report a partial draw that is older than the latest complete one", () => {
    const s = summarizePhenoAge([...draw("2022-01-01", {}, ["rdw"]), ...draw("2024-01-01")], "1985-03");
    expect(s.latestPartial).toBeUndefined();
  });

  it("ignores markers that are not PhenoAge inputs", () => {
    const extra: Measurement = { ...draw("2024-06-01")[0]!, biomarkerId: "ferritin" };
    const s = summarizePhenoAge([...draw("2024-01-01"), extra], "1985-03");
    expect(s.latestPartial).toBeUndefined();
  });

  it("asks for a birth month when it is missing", () => {
    const s = summarizePhenoAge(draw("2024-01-01"));
    expect(s.draws[0]!.status).toBe("needs-birth-month");
    expect(s.draws[0]!.phenoAge).toBeUndefined();
  });

  it("does not compute for people under 20", () => {
    const s = summarizePhenoAge(draw("2024-01-01"), "2010-01");
    expect(s.draws[0]!.status).toBe("too-young");
  });

  it("marks results with '<' values as approximate, using the limit", () => {
    const ms = draw("2024-01-01", { crp_hs: 0.3 }).map((m) => (m.biomarkerId === "crp_hs" ? { ...m, qualifier: "<" as const } : m));
    const d = summarizePhenoAge(ms, "1985-03").draws[0]!;
    expect(d.status).toBe("ok");
    expect(d.approximate).toEqual([{ biomarkerId: "crp_hs", qualifier: "<" }]);
    expect(d.phenoAge).toBeDefined();
  });

  it("refuses a CRP of exactly zero", () => {
    const d = summarizePhenoAge(draw("2024-01-01", { crp_hs: 0 }), "1985-03").draws[0]!;
    expect(d.status).toBe("crp-zero");
    expect(d.phenoAge).toBeUndefined();
  });

  it("uses the later entry when a marker was entered twice on one day", () => {
    const ms = [...draw("2024-01-01"), ...draw("2024-01-01", { crp_hs: 5 }, Object.keys(panel).filter((k) => k !== "crp_hs"))];
    expect(summarizePhenoAge(ms, "1985-03").draws[0]!.used.crp_hs.value).toBe(5);
  });
});
