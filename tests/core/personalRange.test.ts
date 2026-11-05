import { describe, expect, it } from "vitest";
import { personalRange } from "@bt/shared/core/personalRange";
import { measurement } from "../helpers";

const day = (i: number) => new Date(Date.UTC(2026, 7, 1) + i * 86_400_000).toISOString().slice(0, 10);
const hrv = (i: number, value: number) => measurement({ biomarkerId: "hrv_resting", date: day(i), value, originalUnit: "ms" });

// 60 nights alternating 40 and 60 ms, then a last week.
const baseline = Array.from({ length: 60 }, (_, i) => hrv(i, i % 2 ? 60 : 40));

describe("personal usual range", () => {
  it("is the mean ± 1 SD of the log values before the last week", () => {
    const p = personalRange([...baseline, ...[60, 61, 62, 63, 64, 65, 66].map((v, i) => hrv(60 + i, v))])!;
    // Logs of 40 and 60 alternate: mean ln(√2400), SD = |ln(60/40)|/2 · √(60/59).
    const mean = Math.log(Math.sqrt(2400));
    const sd = (Math.log(1.5) / 2) * Math.sqrt(60 / 59);
    expect(p.low).toBeCloseTo(Math.exp(mean - sd), 6);
    expect(p.high).toBeCloseTo(Math.exp(mean + sd), 6);
    expect(p.baseline).toEqual({ count: 60, from: day(0), to: day(59) });
    expect(p.recent).toMatchObject({ count: 7, position: "above" });
  });
  it("says where last week falls", () => {
    expect(personalRange([...baseline, ...[48, 49, 50].map((v, i) => hrv(62 + i, v))])!.recent?.position).toBe("within");
    expect(personalRange([...baseline, ...[25, 26, 27].map((v, i) => hrv(62 + i, v))])!.recent?.position).toBe("below");
  });
  it("needs 2 weeks of readings, and 3 in the last week for a comparison", () => {
    expect(personalRange(baseline.slice(-13).concat(hrv(70, 50)))).toBeUndefined();
    const p = personalRange([...baseline, hrv(66, 50)])!;
    expect(p).toBeDefined();
    expect(p.recent).toBeUndefined();
  });
  it("only uses the 60 days before the last week", () => {
    const old = Array.from({ length: 30 }, (_, i) => hrv(i - 200, 200));
    const withOld = personalRange([...old, ...baseline, hrv(66, 50)])!;
    expect(withOld.baseline.count).toBe(60);
    expect(withOld.high).toBeCloseTo(personalRange([...baseline, hrv(66, 50)])!.high, 9);
  });
});
