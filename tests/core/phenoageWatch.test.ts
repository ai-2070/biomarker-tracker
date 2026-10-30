import { describe, expect, it } from "vitest";
import { addDays } from "../../src/core/dates";
import { demoProfile } from "../../src/core/demo";
import { analyzeMarker, differenceBand } from "../../src/core/experiments";
import { PHENOAGE_GAP_DEF, PHENOAGE_GAP_ID, phenoAgeGaps, withPhenoAgeGap } from "../../src/core/phenoageWatch";
import { summarizePhenoAge } from "../../src/core/phenoageDraws";
import type { Experiment, Measurement } from "../../src/core/types";

const today = "2026-10-30";
const demo = demoProfile(today);

const gap = (date: string, value: number): Measurement => ({ id: date, biomarkerId: PHENOAGE_GAP_ID, value, originalValue: value, originalUnit: "years", date, source: "manual" });
const watch = (start: string): Experiment => ({ id: "w", change: "Habit", category: "diet", markerIds: [PHENOAGE_GAP_ID], start, retestAfterDays: 56 });

describe("PhenoAge gap for habit watches", () => {
  it("gives one gap per complete blood test: PhenoAge minus age that day", () => {
    const gaps = phenoAgeGaps(demo.measurements, demo.person.birthMonth);
    const draws = summarizePhenoAge(demo.measurements, demo.person.birthMonth).draws.filter((d) => d.status === "ok");
    expect(gaps.length).toBe(draws.length);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    for (const [i, d] of draws.entries()) {
      expect(gaps[i]!.date).toBe(d.date);
      expect(gaps[i]!.value).toBeCloseTo(d.phenoAge! - d.age!, 9);
    }
    // No birth month: no PhenoAge, so no gaps.
    expect(phenoAgeGaps(demo.measurements, undefined)).toEqual([]);
  });

  it("adds the gaps and the marker only for watching, never to the stored results", () => {
    const w = withPhenoAgeGap(demo.measurements, demo.person.birthMonth, new Map());
    expect(w.hasGap).toBe(true);
    expect(w.defs.get(PHENOAGE_GAP_ID)).toBe(PHENOAGE_GAP_DEF);
    expect(w.measurements.length).toBeGreaterThan(demo.measurements.length);
    expect(demo.measurements.some((m) => m.biomarkerId === PHENOAGE_GAP_ID)).toBe(false);
  });

  it("compares before and after as a difference in years, against the spread of earlier gaps", () => {
    const start = "2026-01-01";
    const ms = [gap("2025-03-01", -2.0), gap("2025-07-01", -1.4), gap("2025-10-01", -2.3), gap("2025-12-01", -1.9), gap(addDays(start, 70), -5.0)];
    const r = analyzeMarker(watch(start), PHENOAGE_GAP_DEF, ms);
    // "Before" is the 120 days up to the start: the last two gaps.
    expect(r.beforeValue).toBeCloseTo(-2.1);
    expect(r.afterValue).toBeCloseTo(-5.0);
    expect(r.change).toBeCloseTo(-2.9);
    expect(r.bandFrom).toBe("personal");
    expect(r.verdict).toBe("fall");
    // A small move stays within the person's usual wobble.
    const small = analyzeMarker(watch(start), PHENOAGE_GAP_DEF, [...ms.slice(0, 4), gap(addDays(start, 70), -2.4)]);
    expect(small.verdict).toBe("within-noise");
  });

  it("asks for more results rather than guessing when there are fewer than 3 earlier gaps", () => {
    const start = "2026-01-01";
    const r = analyzeMarker(watch(start), PHENOAGE_GAP_DEF, [gap("2025-12-01", -1.9), gap(addDays(start, 70), -5)]);
    expect(r.verdict).toBe("no-variation-data");
    expect(differenceBand([-1, -2], 1, 1)).toBeUndefined();
    expect(differenceBand([-1, -1, -1], 1, 1)).toBeUndefined();
    const band = differenceBand([-1, -2, -3], 1, 1)!;
    expect(band.up).toBeCloseTo(-band.down);
  });

  it("estimates noise from one test to the next, so a steady trend isn't counted as noise", () => {
    // A gap falling steadily by a year a test: consecutive differences are all 1, so noise is about 0.71 (1/√2),
    // much less than the plain spread of the values (about 1.58).
    const steady = differenceBand([-1, -2, -3, -4, -5], 1, 1)!;
    const zigzag = differenceBand([-3, -1, -3, -1, -3], 1, 1)!;
    expect(steady.up).toBeLessThan(zigzag.up);
    expect(steady.up).toBeCloseTo(2.776 * Math.SQRT1_2 * Math.SQRT2, 3);
  });
});
