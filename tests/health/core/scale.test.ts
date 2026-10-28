import { describe, expect, it } from "vitest";
import { niceStep, niceTicks } from "../../../shared/health/scale.ts";

describe("niceStep", () => {
  it("rounds to 1, 2, 2.5, 5 or 10 times a power of ten", () => {
    expect(niceStep(42.75)).toBe(50);
    expect(niceStep(0.13)).toBeCloseTo(0.2);
    expect(niceStep(2.2)).toBe(2.5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(1)).toBe(1);
  });
  it("falls back to 1 for invalid input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe("niceTicks", () => {
  it("covers the range with round numbers", () => {
    expect(niceTicks(0, 171)).toEqual([0, 50, 100, 150, 200]);
    expect(niceTicks(3.2, 6.1)).toEqual([3, 4, 5, 6, 7]);
  });
  it("avoids floating point noise", () => {
    expect(niceTicks(0.1, 0.7)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });
  it("handles a flat or reversed range", () => {
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
    expect(niceTicks(10, 0)).toEqual(niceTicks(0, 10));
  });
});
