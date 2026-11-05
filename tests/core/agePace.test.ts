import { describe, expect, it } from "vitest";
import { dunedinSummary, phenoAgePace } from "@bt/shared/core/agePace";

/** A test every 6 months, PhenoAge rising `rate` years per calendar year from 40, with an optional wobble. */
const series = (rate: number, n: number, wobble: number[] = []) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2023, 0, 1) + i * 182.625 * 86_400_000).toISOString().slice(0, 10);
    return { date: d, years: 40 + rate * i * 0.5 + (wobble[i] ?? 0) };
  });

describe("pace of PhenoAge", () => {
  it("is the slope of PhenoAge against the calendar", () => {
    const p = phenoAgePace(series(0.6, 7))!;
    expect(p.pace).toBeCloseTo(0.6, 2);
    expect(p.tests).toBe(7);
    expect(p.spanYears).toBeCloseTo(3, 1);
    // No scatter: the interval is the pace itself, clearly slower than the calendar.
    expect(p.high - p.low).toBeLessThan(0.01);
    expect(p.verdict).toBe("slower");
  });
  it("says unclear when the interval includes 1, as it does with few, scattered tests", () => {
    const p = phenoAgePace(series(0.6, 3, [0, 2.5, -1]))!;
    expect(p.low).toBeLessThan(1);
    expect(p.high).toBeGreaterThan(1);
    expect(p.verdict).toBe("unclear");
    expect(phenoAgePace(series(1.6, 7))!.verdict).toBe("faster");
    // PhenoAge going down across the tests.
    expect(phenoAgePace(series(-0.8, 7))!.verdict).toBe("falling");
  });
  it("uses only the last 3 years, and needs 3 tests over at least a year", () => {
    expect(phenoAgePace(series(0.6, 10))!.tests).toBe(7);
    expect(phenoAgePace(series(0.6, 2))).toBeUndefined();
    expect(phenoAgePace([{ date: "2026-01-01", years: 40 }, { date: "2026-04-01", years: 40.2 }, { date: "2026-08-01", years: 40.3 }])).toBeUndefined();
    expect(phenoAgePace([])).toBeUndefined();
  });
  it("counts approximate results", () => {
    const pts = series(0.6, 4).map((p, i) => ({ ...p, approximate: i === 1 }));
    expect(phenoAgePace(pts)!.approximate).toBe(1);
  });
});

describe("DunedinPACE by the leaderboard rule", () => {
  const r = (date: string, value: number) => ({ date, value });
  it("averages the best 3 tests within 2 years of the latest, beside the plain average", () => {
    const s = dunedinSummary([r("2023-01-10", 0.7), r("2025-01-10", 0.9), r("2025-06-10", 0.8), r("2025-12-10", 0.85), r("2026-06-10", 0.95)], "2026-10-29")!;
    // 2023 is more than 2 years before the latest test: left out.
    expect(s.window).toEqual({ from: "2025-01-10", to: "2026-06-10", tests: 4 });
    expect(s.average).toBeCloseTo((0.9 + 0.8 + 0.85 + 0.95) / 4, 9);
    expect(s.bestThree!.value).toBeCloseTo((0.8 + 0.85 + 0.9) / 3, 9);
    expect(s.bestThree!.dates).toEqual(["2025-01-10", "2025-06-10", "2025-12-10"]);
    // The best 3 can never be above the plain average.
    expect(s.bestThree!.value).toBeLessThanOrEqual(s.average);
  });
  it("needs 3 tests for the leaderboard number, and leaves out tests 4 or more years old", () => {
    const s = dunedinSummary([r("2025-01-10", 0.9), r("2026-01-10", 0.8)], "2026-10-29")!;
    expect(s.bestThree).toBeUndefined();
    expect(s.window.tests).toBe(2);
    expect(dunedinSummary([r("2021-01-10", 0.9)], "2026-10-29")).toBeUndefined();
    expect(dunedinSummary([], "2026-10-29")).toBeUndefined();
  });
});
