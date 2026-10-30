import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { aggregateFlag } from "../../src/app/components/chartAggregate";
import type { TimeView } from "../../src/app/components/timeControls";
import { groupReadings } from "../../src/core/chartSeries";
import { dayNumber } from "../../src/core/dates";
import type { BiomarkerDef, Measurement } from "../../src/core/types";
import { BIOMARKER_MAP } from "../../src/app/knowledge";

const measurement = (id: string, date: string, value: number, extra: Partial<Measurement> = {}): Measurement => ({
  id: `${id}-${date}`, biomarkerId: id, date, value, originalValue: value,
  originalUnit: BIOMARKER_MAP.get(id)!.canonicalUnit, source: "manual", ...extra,
});
const groupedFlag = (def: BiomarkerDef, ms: Measurement[], profile = {}, total = false) => {
  const point = groupReadings(ms, "week", total ? "total" : "average")[0]!;
  return aggregateFlag(def, point, ms, profile, total);
};

describe("review chart and form regressions", () => {

  it("classifies historical averages at the historical age, not the latest range", () => {
    const def = BIOMARKER_MAP.get("body_fat")!;
    const readings = [measurement(def.id, "2019-10-07", 21), measurement(def.id, "2019-10-08", 21), measurement(def.id, "2026-10-29", 21)];
    const profile = { birthMonth: "1984-01", sex: "m" as const };
    const points = groupReadings(readings, "week");
    expect(aggregateFlag(def, points[0]!, readings, profile, false)).toBe("high");
    expect(aggregateFlag(def, points[1]!, readings, profile, false)).toBe("normal");
  });

  it("does not apply one contributor's lab range or fasting state to a mixed bucket", () => {
    const def = BIOMARKER_MAP.get("glucose_home")!;
    const first = measurement(def.id, "2026-10-05", 7, { fasted: true, labRange: { high: 5.5 } });
    expect(groupedFlag(def, [first, measurement(def.id, "2026-10-06", 7, { fasted: true, labRange: { high: 5.5 } })])).toBe("high");
    expect(groupedFlag(def, [first, measurement(def.id, "2026-10-06", 7, { fasted: true, labRange: { high: 8 } })])).toBe("unknown");
    expect(groupedFlag(def, [first, measurement(def.id, "2026-10-06", 7, { fasted: false, labRange: { high: 5.5 } })])).toBe("unknown");
  });

  it("retains definite critical flags without treating opposing limits as exact means", () => {
    const def = BIOMARKER_MAP.get("glucose_home")!;
    const ms = [measurement(def.id, "2026-10-05", 30), measurement(def.id, "2026-10-06", 30)];
    expect(groupedFlag(def, ms)).toBe("critical-high");
    expect(groupedFlag(def, ms.map((m) => ({ ...m, qualifier: ">" as const })))).toBe("critical-high");
    expect(groupedFlag(def, [{ ...ms[0]!, qualifier: "<" }, { ...ms[1]!, qualifier: ">" }])).toBe("unknown");
  });

  it("requires seven distinct days before flagging a weekly total", () => {
    const def = BIOMARKER_MAP.get("active_minutes")!;
    const ms = Array.from({ length: 7 }, (_, i) => measurement(def.id, `2026-10-${String(5 + i).padStart(2, "0")}`, 10));
    expect(groupedFlag(def, ms, {}, true)).toBe("low");
    expect(groupedFlag(def, ms.slice(0, 6), {}, true)).toBe("unknown");
    expect(groupedFlag(def, Array.from({ length: 7 }, () => ms[0]!), {}, true)).toBe("unknown");
  });


  it("formats selected calendar days without a local timezone shift", async () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // Reload at this timezone boundary: static imports would freeze Intl's default zone too early.
      vi.resetModules();
      const { SelectionBar, TimeControls } = await import("../../src/app/components/timeControls");
      const t = { selection: { from: dayNumber("2026-10-10"), to: dayNumber("2026-10-12") }, v: { from: dayNumber("2026-10-10"), to: dayNumber("2026-10-12") }, full: { from: dayNumber("2026-10-01"), to: dayNumber("2026-10-31") }, minSpan: 1, zoomed: true, preset: "", clearSelection() {}, zoomToSelection() {}, show() {} } as unknown as TimeView;
      const expected = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      const label = `${expected.format(new Date("2026-10-10T00:00:00Z"))} – ${expected.format(new Date("2026-10-12T00:00:00Z"))}`;
      expect(renderToStaticMarkup(createElement(SelectionBar, { t, children: "Selected" }))).toContain(label);
      expect(renderToStaticMarkup(createElement(TimeControls, { t }))).toContain(label);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
