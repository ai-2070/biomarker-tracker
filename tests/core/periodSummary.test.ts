import { buildPeriodSummary, PERIOD_LIMITS, type Period, periodBounds } from "@bt/shared/core/periodSummary";
import type { Measurement } from "@bt/shared/core/types";
import { describe, expect, it } from "vitest";
import { loadDefs, measurement } from "../helpers";

const defs = loadDefs();
const m = (biomarkerId: string, date: string, value: number, labRange?: { low?: number; high?: number }) =>
  measurement({ biomarkerId, date, value, originalUnit: defs.get(biomarkerId)!.canonicalUnit, source: "pdf", ...(labRange ? { labRange } : {}) });
const rolling: Period = { kind: "rolling", end: "2026-11-04" };
const run = (ms: Measurement[], period: Period = rolling) =>
  buildPeriodSummary({ measurements: ms, defs, profile: { sex: "f" }, period, categoryOrder: ["Blood count", "Kidney", "Iron & vitamins"] });
const marker = (s: ReturnType<typeof run>, id: string) => s.groups.flatMap((g) => g.markers).find((x) => x.id === id);

describe("periodBounds", () => {
  it("is the last 12 months and the 12 before, or a calendar year (cut at today) and the year before", () => {
    expect(periodBounds(rolling)).toEqual({ from: "2025-11-05", to: "2026-11-04", previous: { from: "2024-11-05", to: "2025-11-04" } });
    expect(periodBounds({ kind: "year", year: 2025, today: "2026-11-04" })).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
      previous: { from: "2024-01-01", to: "2024-12-31" },
    });
    expect(periodBounds({ kind: "year", year: 2026, today: "2026-11-04" }).to).toBe("2026-11-04");
  });
});

describe("buildPeriodSummary with few tests", () => {
  it("compares the year's tests with the year before, each marker with its own results", () => {
    const s = run([
      m("hemoglobin", "2025-03-01", 120),
      m("hemoglobin", "2026-02-01", 140),
      m("hemoglobin", "2026-09-01", 142),
      m("ferritin", "2026-09-01", 40),
    ]);
    expect(s.tests).toEqual(["2026-02-01", "2026-09-01"]);
    expect(s.previousTests).toEqual(["2025-03-01"]);
    const hb = marker(s, "hemoglobin")!;
    expect(hb.results.map((r) => r.date)).toEqual(["2026-02-01", "2026-09-01"]);
    expect(hb.versusBefore).toMatchObject({ nNow: 2, nBefore: 1, beyondNormalVariation: true });
    expect(hb.versusBefore!.beforeDate).toBeUndefined();
    expect(hb.versusBefore!.now).toBeCloseTo(Math.sqrt(140 * 142));
    // Ferritin was only measured once ever: nothing to compare, no trend.
    expect(marker(s, "ferritin")!.versusBefore).toBeUndefined();
    expect(marker(s, "ferritin")!.trend).toBeUndefined();
  });

  it("calls a small change what it is: within normal test-to-test variation", () => {
    const s = run([m("hemoglobin", "2025-03-01", 140), m("hemoglobin", "2026-03-01", 143)]);
    expect(marker(s, "hemoglobin")!.versusBefore).toMatchObject({ nNow: 1, nBefore: 1, beyondNormalVariation: false });
  });

  it("with one test this year and none last year, compares with the last earlier result and says how old it is", () => {
    const s = run([m("creatinine", "2023-06-01", 80), m("creatinine", "2026-06-01", 150)]);
    expect(s.previousTests).toEqual([]);
    expect(marker(s, "creatinine")!.versusBefore).toMatchObject({ beforeDate: "2023-06-01", nBefore: 1, beyondNormalVariation: true });
  });

  it("with no test in the period, shows each marker's last result and its age", () => {
    const s = run([m("ferritin", "2025-01-10", 8, { low: 13, high: 150 }), m("hemoglobin", "2024-12-01", 130)]);
    expect(s.tests).toEqual([]);
    expect(s.groups).toEqual([]);
    expect(s.notMeasured.map((n) => [n.id, n.monthsOld, n.lastFlag])).toEqual([
      ["hemoglobin", 23, "normal"],
      ["ferritin", 21, "low"],
    ]);
    expect(s.questions).toContain("My ferritin was outside its range when last tested, on 2025-01-10, and hasn't been tested since. Should it be re-tested?");
    expect(s.questions.at(-1)).toBe("How often should my blood tests be repeated, and which ones?");
  });
});

describe("trends", () => {
  it("needs 3 results over a year: two tests never make a trend", () => {
    const s = run([m("ldl", "2025-12-01", 3.0), m("ldl", "2026-10-01", 4.0)]);
    expect(marker(s, "ldl")!.trend).toBeUndefined();
  });

  it("says rising only when the whole interval agrees, with percent per year", () => {
    const s = run([m("ldl", "2024-01-01", 2.0), m("ldl", "2024-12-01", 2.5), m("ldl", "2025-11-01", 3.1), m("ldl", "2026-10-01", 3.9)]);
    const t = marker(s, "ldl")!.trend!;
    expect(t).toMatchObject({ verdict: "rising", tests: 4, from: "2024-01-01" });
    expect(t.percentPerYear).toBeGreaterThan(20);
    expect(t.low).toBeGreaterThan(0);
    expect(s.questions).toContain("My LDL cholesterol has been rising over 4 tests since 2024-01-01. Is that worth following up?");
  });

  it("says unclear when the results go up and down", () => {
    const s = run([m("ldl", "2024-01-01", 3.0), m("ldl", "2024-12-01", 3.6), m("ldl", "2025-11-01", 2.9), m("ldl", "2026-10-01", 3.3)]);
    expect(marker(s, "ldl")!.trend!.verdict).toBe("unclear");
  });
});

describe("the rest", () => {
  it("counts results outside the range and asks about markers outside on every test", () => {
    const s = run([m("ferritin", "2026-01-10", 9, { low: 13, high: 150 }), m("ferritin", "2026-07-10", 11, { low: 13, high: 150 })]);
    expect(marker(s, "ferritin")).toMatchObject({ outside: 2, lastFlag: "low" });
    expect(s.questions[0]).toBe("My ferritin was outside its range on both tests in this period. What could explain it, and does it need follow-up?");
  });

  it("summarises a calendar year and ignores later results", () => {
    const s = run([m("hemoglobin", "2025-05-01", 130), m("hemoglobin", "2026-05-01", 150)], { kind: "year", year: 2025, today: "2026-11-04" });
    expect(s.tests).toEqual(["2025-05-01"]);
    expect(marker(s, "hemoglobin")!.last.value).toBe(130);
  });

  it("leaves out body measurements and keeps the limits", () => {
    const s = run([m("weight", "2026-05-01", 70)]);
    expect(s.groups).toEqual([]);
    expect(s.notMeasured).toEqual([]);
    expect(s.limits).toEqual([...PERIOD_LIMITS]);
  });
});
