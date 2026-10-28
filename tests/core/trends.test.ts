import { describe, expect, it } from "vitest";
import {
  computeTrend,
  flagMeasurement,
  flagValue,
  groupByBiomarker,
  isCritical,
  isAlreadySaved,
  isOutOfRange,
  latestByBiomarker,
  paddedDomain,
  resolveRange,
  slope,
  sortByDate,
} from "../../src/core/trends";
import { def, measurement } from "../helpers";

describe("resolveRange", () => {
  const ferritin = def("ferritin");

  it("prefers the lab's own range", () => {
    expect(resolveRange(ferritin, { labRange: { low: 20, high: 300 } }, { sex: "f" })).toEqual({
      low: 20,
      high: 300,
      source: "lab",
    });
  });
  it("uses the sex-specific default when sex is known", () => {
    expect(resolveRange(ferritin, {}, { sex: "f" })).toEqual({ low: 15, high: 150, source: "default" });
    expect(resolveRange(ferritin, {}, { sex: "m" })).toEqual({ low: 30, high: 400, source: "default" });
  });
  it("uses the widest span of sex-specific ranges when sex is unknown", () => {
    expect(resolveRange(ferritin, {}, {})).toEqual({ low: 15, high: 400, source: "default" });
  });
  it("uses the general range when there is one", () => {
    expect(resolveRange(def("sodium"), {}, { sex: "m" })).toEqual({ low: 135, high: 145, source: "default" });
  });
  it("ignores an empty lab range", () => {
    expect(resolveRange(def("sodium"), { labRange: {} })?.source).toBe("default");
  });
  it("uses the fasting or after-meal range when the reading says which", () => {
    const g = def("glucose_home");
    expect(resolveRange(g, { fasted: true })).toMatchObject({ low: 3.9, high: 5.5 });
    expect(resolveRange(g, { fasted: false })).toMatchObject({ low: 3.9, high: 7.8 });
    expect(resolveRange(g, {})).toMatchObject({ low: 3.9, high: 11 });
    // Markers without such ranges are unaffected.
    expect(resolveRange(def("sodium"), { fasted: true })).toMatchObject({ low: 135, high: 145 });
  });
  it("supports one-sided ranges", () => {
    expect(resolveRange(def("hdl"), {}, { sex: "f" })).toEqual({ low: 1.2, high: undefined, source: "default" });
  });
});

describe("flagValue", () => {
  const range = { low: 3.5, high: 5.1 };
  const critical = { low: 2.8, high: 6.2 };
  it("flags low, normal and high, with limits counting as normal", () => {
    expect(flagValue(3.4, range)).toBe("low");
    expect(flagValue(3.5, range)).toBe("normal");
    expect(flagValue(5.1, range)).toBe("normal");
    expect(flagValue(5.2, range)).toBe("high");
  });
  it("flags critical values before anything else", () => {
    expect(flagValue(2.7, range, critical)).toBe("critical-low");
    expect(flagValue(6.3, range, critical)).toBe("critical-high");
    expect(flagValue(6.3, undefined, critical)).toBe("critical-high");
  });
  it("returns unknown without a range", () => {
    expect(flagValue(1, undefined)).toBe("unknown");
    expect(flagValue(1, {})).toBe("unknown");
  });
  it("classifies flags", () => {
    expect(isCritical("critical-low")).toBe(true);
    expect(isCritical("low")).toBe(false);
    expect(isOutOfRange("high")).toBe(true);
    expect(isOutOfRange("normal")).toBe(false);
    expect(isOutOfRange("unknown")).toBe(false);
  });
  it("flags a measurement using its definition", () => {
    const k = def("potassium");
    expect(flagMeasurement(k, measurement({ biomarkerId: "potassium", date: "2024-01-01", value: 6.5 }))).toBe("critical-high");
  });
});

describe("slope", () => {
  it("is undefined for fewer than two points or no spread in x", () => {
    expect(slope([{ x: 1, y: 1 }])).toBeUndefined();
    expect(slope([{ x: 1, y: 1 }, { x: 1, y: 5 }])).toBeUndefined();
  });
  it("fits a straight line exactly", () => {
    expect(slope([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toBeCloseTo(2);
  });
});

describe("computeTrend", () => {
  it("returns undefined with no data", () => {
    expect(computeTrend([])).toBeUndefined();
  });
  it("handles a single measurement", () => {
    const t = computeTrend([measurement({ date: "2024-01-01", value: 50 })]);
    expect(t?.count).toBe(1);
    expect(t?.change).toBeUndefined();
    expect(t?.ratePerYear).toBeUndefined();
  });
  it("computes change from the previous value regardless of input order", () => {
    const t = computeTrend([
      measurement({ date: "2024-07-01", value: 60 }),
      measurement({ date: "2023-01-01", value: 40 }),
      measurement({ date: "2024-01-01", value: 50 }),
    ]);
    expect(t?.latest.value).toBe(60);
    expect(t?.previous?.value).toBe(50);
    expect(t?.change).toBe(10);
    expect(t?.percentChange).toBeCloseTo(20);
    expect(t?.daysSincePrevious).toBe(182);
    expect(t?.firstDate).toBe("2023-01-01");
    expect(t?.lastDate).toBe("2024-07-01");
  });
  it("computes the rate of change per year", () => {
    const t = computeTrend([
      measurement({ date: "2022-01-01", value: 100 }),
      measurement({ date: "2024-01-01", value: 120 }),
    ]);
    expect(t?.ratePerYear).toBeCloseTo(10, 1);
  });
  it("leaves percent change undefined when the previous value is zero", () => {
    const t = computeTrend([
      measurement({ date: "2022-01-01", value: 0 }),
      measurement({ date: "2023-01-01", value: 1 }),
    ]);
    expect(t?.percentChange).toBeUndefined();
  });
  it("has no rate when all samples are from the same day", () => {
    const t = computeTrend([
      measurement({ date: "2022-01-01", value: 1 }),
      measurement({ date: "2022-01-01", value: 2 }),
    ]);
    expect(t?.ratePerYear).toBeUndefined();
  });
});

describe("helpers", () => {
  it("sorts by date without mutating the input", () => {
    const input = [measurement({ date: "2024-02-01", value: 1 }), measurement({ date: "2023-02-01", value: 2 })];
    const sorted = sortByDate(input);
    expect(sorted.map((m) => m.date)).toEqual(["2023-02-01", "2024-02-01"]);
    expect(input[0]!.date).toBe("2024-02-01");
  });
  it("detects a result that is already saved", () => {
    const existing = [measurement({ biomarkerId: "ferritin", date: "2024-01-01", value: 45 })];
    expect(isAlreadySaved(existing, { biomarkerId: "ferritin", date: "2024-01-01", value: 45 })).toBe(true);
    expect(isAlreadySaved(existing, { biomarkerId: "ferritin", date: "2024-01-01", value: 45.1 })).toBe(false);
    expect(isAlreadySaved(existing, { biomarkerId: "ferritin", date: "2024-01-02", value: 45 })).toBe(false);
    expect(isAlreadySaved(existing, { biomarkerId: "b12", date: "2024-01-01", value: 45 })).toBe(false);
  });
  it("finds the latest measurement per biomarker", () => {
    const latest = latestByBiomarker([
      measurement({ biomarkerId: "a", date: "2024-05-01", value: 2 }),
      measurement({ biomarkerId: "a", date: "2023-01-01", value: 1 }),
      measurement({ biomarkerId: "b", date: "2020-01-01", value: 9 }),
    ]);
    expect(latest.get("a")?.value).toBe(2);
    expect(latest.get("b")?.value).toBe(9);
  });
  it("pads the chart domain and never goes below zero", () => {
    expect(paddedDomain([10, 20], 0.1)).toEqual([9, 21]);
    expect(paddedDomain([0.5, 10])).toEqual([0, 10 + 9.5 * 0.15]);
    expect(paddedDomain([5], 0.1)).toEqual([4.5, 5.5]);
    expect(paddedDomain([])).toEqual([0, 1]);
    expect(paddedDomain([0])).toEqual([0, 0.15]);
  });
  it("groups by biomarker", () => {
    const g = groupByBiomarker([
      measurement({ biomarkerId: "a", date: "2024-01-01", value: 1 }),
      measurement({ biomarkerId: "b", date: "2024-01-01", value: 2 }),
      measurement({ biomarkerId: "a", date: "2024-02-01", value: 3 }),
    ]);
    expect(g.get("a")?.length).toBe(2);
    expect(g.get("b")?.length).toBe(1);
  });
});
