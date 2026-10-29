import { describe, expect, it } from "vitest";
import { phenoAgePace } from "../../src/core/agePace";

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
