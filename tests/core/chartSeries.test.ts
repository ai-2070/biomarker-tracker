import { describe, expect, it } from "vitest";
import { groupReadings, groupingsFor, pointsForWindow, statsBetween } from "../../src/core/chartSeries";

const r = (date: string, value: number) => ({ date, value });

describe("chart series", () => {
  // Mon 2026-10-19 … Sun 2026-10-25 is one week; 2026-10-26 starts the next.
  const nights = [r("2026-10-19", 6), r("2026-10-21", 8), r("2026-10-25", 7), r("2026-10-26", 5), r("2026-11-02", 9)];

  it("keeps each reading", () => {
    expect(groupReadings(nights, "each")).toHaveLength(5);
    expect(groupReadings(nights, "each")[0]).toEqual({ date: "2026-10-19", value: 6, count: 1, from: "2026-10-19", to: "2026-10-19" });
  });
  it("averages per week (Monday to Sunday), drawn at the middle of its readings", () => {
    const w = groupReadings(nights, "week");
    expect(w.map((p) => [p.value, p.count])).toEqual([[7, 3], [5, 1], [9, 1]]);
    expect(w[0]).toMatchObject({ date: "2026-10-22", from: "2026-10-19", to: "2026-10-25" });
  });
  it("averages per month", () => {
    expect(groupReadings(nights, "month").map((p) => [p.value, p.count])).toEqual([[6.5, 4], [9, 1]]);
  });
  it("offers averages only when they combine readings", () => {
    expect(groupingsFor(nights)).toEqual(["each", "week", "month"]);
    expect(groupingsFor([r("2024-01-10", 1), r("2024-03-10", 2)])).toEqual(["each"]);
    expect(groupingsFor([r("2024-01-10", 1), r("2024-01-25", 2)])).toEqual(["each", "month"]);
  });
  it("gives count, average, lowest, highest, first, last and the change in a period", () => {
    expect(statsBetween(nights, "2026-10-20", "2026-10-31")).toEqual({
      count: 3,
      average: 20 / 3,
      low: r("2026-10-26", 5),
      high: r("2026-10-21", 8),
      first: r("2026-10-21", 8),
      last: r("2026-10-26", 5),
      change: -3,
    });
    expect(statsBetween(nights, "2027-01-01", "2027-02-01")).toBeUndefined();
  });
  it("draws the points in a window and one on each side", () => {
    const pts = groupReadings(nights, "each");
    expect(pointsForWindow(pts, "2026-10-20", "2026-10-25").map((p) => p.date)).toEqual(["2026-10-19", "2026-10-21", "2026-10-25", "2026-10-26"]);
    // Nothing inside: the two around it, so the line still crosses the window.
    expect(pointsForWindow(pts, "2026-10-27", "2026-10-30").map((p) => p.date)).toEqual(["2026-10-26", "2026-11-02"]);
    expect(pointsForWindow(pts, "2025-01-01", "2026-12-31")).toHaveLength(5);
  });
});
