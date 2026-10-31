import { describe, expect, it } from "vitest";
import { reportChartGeometry } from "../../src/core/doctorReportChart";
import { fromCanonical, toCanonical } from "../../src/core/units";
import { def, measurement } from "../helpers";

const box = { left: 92, top: 28, width: 524, height: 146 };
const ferritin = def("ferritin");

describe("reportChartGeometry", () => {
  it("uses the report's full window rather than stretching each marker's own history", () => {
    const middle = measurement({ date: "2026-01-16", value: 20 });
    const chart = reportChartGeometry(ferritin, [middle], "µg/L", "2026-01-01", "2026-01-31", box);
    expect(chart.points[0]!.x).toBe(box.left + box.width / 2);
    expect(chart.dateTicks[0]).toEqual({ date: "2026-01-01", x: box.left });
    expect(chart.dateTicks.at(-1)).toEqual({ date: "2026-01-31", x: box.left + box.width });
    expect(chart.segments).toEqual([]);
    const other = reportChartGeometry(ferritin, [measurement({ date: "2026-01-02", value: 200 })], "µg/L", "2026-01-01", "2026-01-31", box);
    expect(other.dateTicks).toEqual(chart.dateTicks);
  });

  it("keeps both selected date boundaries and orders by date then save order without mutating input", () => {
    const last = measurement({ date: "2026-01-31", value: 30 });
    const sameDayLater = measurement({ date: "2026-01-01", savedOrder: 4, value: 20 });
    const sameDayEarlier = measurement({ date: "2026-01-01", savedOrder: 2, value: 10 });
    const input = [last, sameDayLater, sameDayEarlier];
    const chart = reportChartGeometry(ferritin, input, "µg/L", "2026-01-01", "2026-01-31", box);
    expect(chart.points.map((point) => point.measurement)).toEqual([sameDayEarlier, sameDayLater, last]);
    expect(chart.points[0]!.x).toBe(box.left);
    expect(chart.points[1]!.x).toBe(box.left);
    expect(chart.points[2]!.x).toBe(box.left + box.width);
    expect(input).toEqual([last, sameDayLater, sameDayEarlier]);
  });

  it("interrupts lines at either kind of bound, without connecting across it", () => {
    const rows = [
      measurement({ date: "2026-01-01", value: 10 }),
      measurement({ date: "2026-01-02", value: 20 }),
      measurement({ date: "2026-01-03", value: 25, qualifier: "<" }),
      measurement({ date: "2026-01-04", value: 30 }),
      measurement({ date: "2026-01-05", value: 40 }),
      measurement({ date: "2026-01-06", value: 50, qualifier: ">" }),
      measurement({ date: "2026-01-07", value: 60 }),
    ];
    const chart = reportChartGeometry(ferritin, rows, "µg/L", "2026-01-01", "2026-01-07", box);
    expect(chart.points.map((point) => point.measurement)).toEqual(rows);
    expect(chart.segments.map((segment) => segment.map((point) => point.measurement))).toEqual([rows.slice(0, 2), rows.slice(3, 5)]);
    expect(chart.points[2]!.y).toBeGreaterThan(chart.points[3]!.y);
    expect(chart.points[5]!.y).toBeGreaterThan(chart.points[6]!.y);
  });

  it("retains coincident readings with multiplicity, but never invents within-day line order", () => {
    const rows = [
      measurement({ date: "2026-01-01", value: 5 }),
      measurement({ date: "2026-01-02", value: 10 }),
      measurement({ date: "2026-01-03", value: 20 }),
      measurement({ date: "2026-01-03", value: 20 }),
      measurement({ date: "2026-01-03", value: 20, qualifier: "<" }),
      measurement({ date: "2026-01-04", value: 30 }),
      measurement({ date: "2026-01-05", value: 40 }),
    ];
    const chart = reportChartGeometry(ferritin, rows, "µg/L", "2026-01-01", "2026-01-05", box);
    expect(chart.hasSameDayReadings).toBe(true);
    expect(chart.points).toHaveLength(7);
    expect(chart.points[2]!.x).toBe(chart.points[3]!.x);
    expect(chart.points[2]!.y).toBe(chart.points[3]!.y);
    expect(chart.points.slice(2, 5).map((point) => [point.overlapIndex, point.overlapCount])).toEqual([[0, 2], [1, 2], [0, 1]]);
    expect(chart.segments.map((segment) => segment.map((point) => point.measurement))).toEqual([rows.slice(0, 2), rows.slice(5)]);
  });

  it.each([0, 42])("gives constant %s readings finite geometry and a nonzero vertical domain", (value) => {
    const rows = [measurement({ date: "2026-01-01", value }), measurement({ date: "2026-01-02", value })];
    const chart = reportChartGeometry(ferritin, rows, "µg/L", "2026-01-01", "2026-01-02", box);
    expect(chart.yTicks.length).toBeGreaterThan(1);
    expect(chart.points[0]!.y).toBe(chart.points[1]!.y);
    for (const point of chart.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.y).toBeGreaterThanOrEqual(box.top);
      expect(point.y).toBeLessThanOrEqual(box.top + box.height);
    }
  });

  it("centres a single-date report, retaining every same-day value", () => {
    const rows = [measurement({ date: "2026-01-01", value: 0 }), measurement({ date: "2026-01-01", value: 100 })];
    const chart = reportChartGeometry(ferritin, rows, "µg/L", "2026-01-01", "2026-01-01", box);
    expect(chart.points.map((point) => point.x)).toEqual([box.left + box.width / 2, box.left + box.width / 2]);
    expect(chart.dateTicks).toEqual([{ date: "2026-01-01", x: box.left + box.width / 2 }]);
    expect(chart.points[0]!.y).toBeGreaterThan(chart.points[1]!.y);
    expect(chart.segments).toEqual([]);
  });

  it("positions offset-unit values and returns ticks in canonical units, including negative display values", () => {
    const hba1c = def("hba1c");
    const rows = [-5, 25, 55].map((value, index) => measurement({ biomarkerId: hba1c.id, date: `2026-01-0${index + 1}`, value: toCanonical(hba1c, value, "mmol/mol") }));
    const chart = reportChartGeometry(hba1c, rows, "mmol/mol", "2026-01-01", "2026-01-03", box);
    const low = fromCanonical(hba1c, chart.yTicks[0]!.canonicalValue, "mmol/mol");
    const high = fromCanonical(hba1c, chart.yTicks.at(-1)!.canonicalValue, "mmol/mol");
    expect(low).toBeLessThanOrEqual(-5);
    expect(high).toBeGreaterThanOrEqual(55);
    expect(chart.points[1]!.y).toBeCloseTo((chart.points[0]!.y + chart.points[2]!.y) / 2);
    for (const point of chart.points) {
      expect(point.y).toBeGreaterThanOrEqual(box.top);
      expect(point.y).toBeLessThanOrEqual(box.top + box.height);
    }
  });

  it("keeps sleep durations and axis values in canonical hours for the existing hours/minutes formatter", () => {
    const sleep = def("sleep_duration");
    const chart = reportChartGeometry(sleep, [measurement({ biomarkerId: sleep.id, date: "2026-01-01", value: 7.5 }), measurement({ biomarkerId: sleep.id, date: "2026-01-02", value: 8 })], sleep.canonicalUnit, "2026-01-01", "2026-01-02", box);
    expect(chart.points.map((point) => point.measurement.value)).toEqual([7.5, 8]);
    expect(chart.points[0]!.y).toBeGreaterThan(chart.points[1]!.y);
    expect(chart.yTicks[0]!.canonicalValue).toBeLessThanOrEqual(7.5);
    expect(chart.yTicks.at(-1)!.canonicalValue).toBeGreaterThanOrEqual(8);
  });

  it("does not downsample dense histories and retains the full selected date window", () => {
    const rows = Array.from({ length: 800 }, (_, index) => measurement({ date: "2026-01-02", value: index % 100, ...(index % 11 === 0 ? { qualifier: "<" as const } : {}) }));
    const chart = reportChartGeometry(ferritin, rows, "µg/L", "2020-01-01", "2026-10-31", box);
    expect(chart.points).toHaveLength(rows.length);
    expect(new Set(chart.points.map((point) => point.measurement.id)).size).toBe(rows.length);
    expect(chart.dateTicks[0]).toEqual({ date: "2020-01-01", x: box.left });
    expect(chart.dateTicks.at(-1)).toEqual({ date: "2026-10-31", x: box.left + box.width });
  });
});
