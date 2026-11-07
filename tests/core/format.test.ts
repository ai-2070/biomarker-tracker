import { describe, expect, it } from "vitest";
import { displayUnitFor, formatHours, showChange, showMeasurement, showRange, showValue, valueUnit } from "../../apps/web/src/app/format";
import { BIOMARKER_MAP } from "../../apps/web/src/app/knowledge";

describe("sleep duration display", () => {
  it.each([
    ["sleep_duration", 6.675, "6 h 41 min"],
    ["sleep_deep", 45.5 / 60, "46 min"],
    ["sleep_rem", 1.7, "1 h 42 min"],
  ] as const)("shows %s as hours/minutes even when an old display preference says minutes", (id, value, expected) => {
    const def = BIOMARKER_MAP.get(id)!;
    expect(showValue(def, value, "min")).toBe(expected);
    expect(valueUnit(def, "min")).toBe("");
    expect(displayUnitFor(def, "min")).toBe("h");
  });

  it("carries rounded minutes into the next hour", () => {
    expect(formatHours(59.5 / 60)).toBe("1 h");
    expect(formatHours(119.5 / 60)).toBe("2 h");
  });

  it("keeps lab qualifiers and formats changes and ranges without a second unit", () => {
    const def = BIOMARKER_MAP.get("sleep_duration")!;
    expect(
      showMeasurement(
        def,
        { id: "sleep", biomarkerId: def.id, date: "2026-03-01", value: 6.5, originalValue: 390, originalUnit: "min", qualifier: "<", source: "device" },
        "h",
      ),
    ).toBe("<6 h 30 min");
    expect(showChange(def, -1.25, "h")).toBe("−1 h 15 min");
    expect(showChange(def, 0.25, "min")).toBe("+15 min");
    expect(showChange(def, 6.675 - 6.25, "h")).toBe("+26 min");
    expect(showChange(def, 0.001, "h")).toBe("no change");
    expect(showRange(def, { low: 7, high: 9 }, "min")).toBe("7 h–9 h");
  });
});
