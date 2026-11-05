import { describe, expect, it } from "vitest";
import {
  afterResults,
  analyzeMarker,
  beforeResults,
  experimentPhase,
  geometricMean,
  markersAwaitingRetest,
  rcvBand,
  retestDate,
  validateExperiment,
  personalBand,
  t95,
} from "@bt/core/experiments";
import type { Experiment } from "@bt/core/types";
import { def, measurement } from "../helpers";

const exp = (extra: Partial<Experiment> = {}): Experiment => ({
  id: "e1",
  change: "2 kiwis a day",
  category: "diet",
  markerIds: ["ferritin"],
  start: "2024-03-01",
  retestAfterDays: 56,
  ...extra,
});

describe("rcvBand", () => {
  it("matches the classic formula for small CVs", () => {
    // Symmetric RCV = 1.96·√2·√(CVA²+CVI²) = 2.77 × 5.59 % ≈ 15.5 % for CVI 5 %, CVA 2.5 %.
    const b = rcvBand(5);
    const symmetric = 1.96 * Math.SQRT2 * Math.sqrt(5 ** 2 + 2.5 ** 2) / 100;
    // The log-normal band is slightly wider upwards; its half-width matches the classic value.
    expect((b.up - b.down) / 2).toBeCloseTo(symmetric, 2);
    expect(b.up).toBeGreaterThan(symmetric);
    expect(-b.down).toBeLessThan(symmetric);
  });

  it("is asymmetric for markers that vary a lot (log-normal)", () => {
    const b = rcvBand(34.7); // CRP
    expect(b.up).toBeGreaterThan(-b.down);
    expect(b.down).toBeGreaterThan(-1); // can never fall more than 100 %
    expect((1 + b.up) * (1 + b.down)).toBeCloseTo(1, 10); // symmetric on the log scale
  });

  it("narrows with more results on each side", () => {
    expect(rcvBand(12.9, 3, 3).up).toBeLessThan(rcvBand(12.9, 1, 1).up);
  });

  it("uses a custom measurement error when given", () => {
    expect(rcvBand(10, 1, 1, 0).up).toBeLessThan(rcvBand(10, 1, 1, 5).up);
  });
});

describe("helpers", () => {
  it("computes the geometric mean", () => {
    expect(geometricMean([10, 40])).toBeCloseTo(20, 10);
    expect(geometricMean([7])).toBe(7);
  });
  it("computes the re-test date", () => {
    expect(retestDate(exp())).toBe("2024-04-26");
    expect(retestDate({ start: "2024-12-30", retestAfterDays: 7 })).toBe("2025-01-06");
  });
});

describe("before and after windows", () => {
  const ms = [
    measurement({ date: "2023-10-01", value: 10 }), // too old
    measurement({ date: "2024-01-15", value: 18 }),
    measurement({ date: "2024-03-01", value: 20 }), // start day counts as before
    measurement({ date: "2024-04-01", value: 22 }), // too early for after
    measurement({ date: "2024-04-26", value: 30 }),
    measurement({ date: "2024-09-01", value: 31 }),
  ];
  it("uses results up to 120 days before the start", () => {
    expect(beforeResults(exp(), ms).map((m) => m.value)).toEqual([18, 20]);
  });
  it("uses results from the re-test date on", () => {
    expect(afterResults(exp(), ms).map((m) => m.value)).toEqual([30, 31]);
  });
  it("ignores results long after an ended experiment", () => {
    expect(afterResults(exp({ end: "2024-05-01" }), ms).map((m) => m.value)).toEqual([30]);
  });
});

describe("analyzeMarker", () => {
  const ferritin = def("ferritin"); // CVI 12.9 %

  it("needs a baseline", () => {
    expect(analyzeMarker(exp(), ferritin, []).verdict).toBe("no-baseline");
  });

  it("waits for the re-test", () => {
    const r = analyzeMarker(exp(), ferritin, [measurement({ date: "2024-02-20", value: 20 })]);
    expect(r.verdict).toBe("waiting");
    expect(r.beforeValue).toBe(20);
  });

  it("calls a large rise beyond normal variation", () => {
    const r = analyzeMarker(exp(), ferritin, [measurement({ date: "2024-02-20", value: 20 }), measurement({ date: "2024-05-10", value: 32 })]);
    expect(r.change).toBeCloseTo(0.6, 10);
    expect(r.band!.up).toBeLessThan(0.6);
    expect(r.verdict).toBe("rise");
  });

  it("calls a small change within normal variation", () => {
    const r = analyzeMarker(exp(), ferritin, [measurement({ date: "2024-02-20", value: 20 }), measurement({ date: "2024-05-10", value: 23 })]);
    expect(r.verdict).toBe("within-noise");
  });

  it("calls a large fall", () => {
    const r = analyzeMarker(exp(), ferritin, [measurement({ date: "2024-02-20", value: 40 }), measurement({ date: "2024-05-10", value: 20 })]);
    expect(r.verdict).toBe("fall");
  });

  it("says when there is no variation data for the marker", () => {
    const rdw = def("rdw");
    expect(rdw.biologicalVariation).toBeUndefined();
    const ms = [
      measurement({ biomarkerId: "rdw", date: "2024-02-20", value: 13 }),
      measurement({ biomarkerId: "rdw", date: "2024-05-10", value: 15 }),
    ];
    expect(analyzeMarker(exp({ markerIds: ["rdw"] }), rdw, ms).verdict).toBe("no-variation-data");
  });

  it("estimates normal variation from the person's own readings when there is no published data", () => {
    const w = def("weight");
    expect(w.biologicalVariation).toBeUndefined();
    const at = (date: string, value: number) => measurement({ biomarkerId: "weight", date, value });
    const before = [at("2024-01-10", 72.1), at("2024-02-01", 71.6), at("2024-02-20", 72.4)];
    const fell = analyzeMarker(exp({ markerIds: ["weight"] }), w, [...before, at("2024-05-01", 69.0), at("2024-06-01", 68.6), at("2024-07-01", 69.3)]);
    expect(fell.bandFrom).toBe("personal");
    expect(fell.verdict).toBe("fall");
    const same = analyzeMarker(exp({ markerIds: ["weight"] }), w, [...before, at("2024-05-01", 71.8), at("2024-06-01", 72.6), at("2024-07-01", 71.5)]);
    expect(same.verdict).toBe("within-noise");
    // Two results on a side aren't enough to know the spread.
    const few = analyzeMarker(exp({ markerIds: ["weight"] }), w, [...before, at("2024-05-01", 60)]);
    expect(few.verdict).toBe("no-variation-data");
  });

  it("widens the personal band for small samples (t values)", () => {
    expect(t95(4)).toBe(2.776);
    expect(t95(11)).toBe(2.228);
    expect(t95(500)).toBe(1.98);
    expect(personalBand([5, 5, 5], [6, 6, 6])).toBeUndefined();
    const b = personalBand([10, 11, 9], [10, 11, 9])!;
    expect(b.up).toBeGreaterThan(0);
    expect(b.down).toBeLessThan(0);
  });

  it("won't judge results reported as below a limit", () => {
    const crp = def("crp_hs");
    const ms = [
      measurement({ biomarkerId: "crp_hs", date: "2024-02-20", value: 0.3, qualifier: "<" }),
      measurement({ biomarkerId: "crp_hs", date: "2024-05-10", value: 2 }),
    ];
    expect(analyzeMarker(exp({ markerIds: ["crp_hs"] }), crp, ms).verdict).toBe("below-limit");
  });

  it("only uses results for the marker being analysed", () => {
    const r = analyzeMarker(exp(), ferritin, [measurement({ biomarkerId: "b12", date: "2024-02-20", value: 300 })]);
    expect(r.verdict).toBe("no-baseline");
  });
});

describe("experimentPhase", () => {
  const ferritin = def("ferritin");
  it("moves from running to due to complete", () => {
    const base = [measurement({ date: "2024-02-20", value: 20 })];
    const e = exp();
    expect(experimentPhase([analyzeMarker(e, ferritin, base)], e, "2024-03-10")).toBe("running");
    expect(experimentPhase([analyzeMarker(e, ferritin, base)], e, "2024-04-26")).toBe("due");
    const full = [...base, measurement({ date: "2024-05-01", value: 30 })];
    expect(experimentPhase([analyzeMarker(e, ferritin, full)], e, "2024-05-02")).toBe("complete");
  });
  it("asks for a baseline before a future start", () => {
    const e = exp({ start: "2024-06-01" });
    expect(experimentPhase([analyzeMarker(e, ferritin, [])], e, "2024-05-01")).toBe("needs-baseline");
  });
  it("doesn't wait for markers that have no 'before' result", () => {
    const e = exp({ markerIds: ["ferritin", "b12"] });
    const ms = [measurement({ date: "2024-02-20", value: 20 }), measurement({ date: "2024-05-01", value: 30 })];
    const results = [analyzeMarker(e, ferritin, ms), analyzeMarker(e, def("b12"), ms)];
    expect(experimentPhase(results, e, "2024-05-02")).toBe("complete");
    expect(markersAwaitingRetest(results)).toEqual([]);
  });
  it("lists only markers still waiting for the re-test", () => {
    const e = exp({ markerIds: ["ferritin", "b12"] });
    const results = [analyzeMarker(e, ferritin, [measurement({ date: "2024-02-20", value: 20 })]), analyzeMarker(e, def("b12"), [])];
    expect(markersAwaitingRetest(results)).toEqual(["ferritin"]);
    expect(experimentPhase(results, e, "2024-05-02")).toBe("due");
  });
  it("needs a baseline when no marker has one", () => {
    const e = exp();
    expect(experimentPhase([analyzeMarker(e, ferritin, [])], e, "2024-03-10")).toBe("needs-baseline");
  });
  it("shows ended experiments as ended", () => {
    const e = exp({ end: "2024-03-20" });
    expect(experimentPhase([analyzeMarker(e, ferritin, [])], e, "2024-03-21")).toBe("ended");
  });
});

describe("validateExperiment", () => {
  const known = new Set(["ferritin", "b12"]);
  it("accepts a valid experiment and removes duplicate markers", () => {
    const r = validateExperiment({ change: " Kiwis ", category: "diet", markerIds: ["ferritin", "ferritin"], start: "2024-03-01", retestAfterDays: 56 }, known, "2024-03-01");
    expect(r).toEqual({ ok: true, experiment: { change: "Kiwis", category: "diet", markerIds: ["ferritin"], start: "2024-03-01", retestAfterDays: 56 } });
  });
  it("reports every problem", () => {
    const r = validateExperiment({ change: "", category: "x", markerIds: [], start: "nope", retestAfterDays: 3 }, known, "2024-03-01");
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["category", "change", "markerIds", "retestAfterDays", "start"]);
  });
  it("rejects unknown markers", () => {
    const r = validateExperiment({ change: "x", category: "diet", markerIds: ["nope"], start: "2024-03-01", retestAfterDays: 28 }, known, "2024-03-01");
    expect(!r.ok && r.errors.markerIds).toBe("Unknown marker.");
  });
});
