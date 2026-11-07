import { type ManualEntryInput, parseLabNumber, plausibilityWarnings, validateManualEntry } from "@bt/shared/core/importers/manual";
import { describe, expect, it } from "vitest";
import { def, loadDefs } from "../helpers";

describe("parseLabNumber", () => {
  it("parses plain and decimal-comma numbers", () => {
    expect(parseLabNumber("5.4")).toEqual({ value: 5.4 });
    expect(parseLabNumber("5,4")).toEqual({ value: 5.4 });
    expect(parseLabNumber(" 12 ")).toEqual({ value: 12 });
    expect(parseLabNumber(".5")).toEqual({ value: 0.5 });
  });
  it("parses thousands separators in both styles", () => {
    expect(parseLabNumber("1.234,5")).toEqual({ value: 1234.5 });
    expect(parseLabNumber("1,234.5")).toEqual({ value: 1234.5 });
    expect(parseLabNumber("1 234,5")).toEqual({ value: 1234.5 });
  });
  it("treats a single comma as a decimal comma (European lab style)", () => {
    expect(parseLabNumber("1,234")).toEqual({ value: 1.234 });
  });
  it("keeps < and > qualifiers from lab reports", () => {
    expect(parseLabNumber("<0.1")).toEqual({ value: 0.1, qualifier: "<" });
    expect(parseLabNumber("< 0,3")).toEqual({ value: 0.3, qualifier: "<" });
    expect(parseLabNumber(">90")).toEqual({ value: 90, qualifier: ">" });
    expect(parseLabNumber("≤5")).toEqual({ value: 5, qualifier: "<" });
  });
  it("rejects text that is not a number", () => {
    for (const bad of ["", "abc", "5.4.3", "1,2,3", "5 mg", "--1", "<"]) {
      expect(parseLabNumber(bad)).toBeUndefined();
    }
  });
});

describe("validateManualEntry", () => {
  const defs = loadDefs();
  const today = "2025-06-01";
  const base: ManualEntryInput = { biomarkerId: "glucose", value: "90", unit: "mg/dL", date: "2025-05-01" };

  it("converts a valid entry to the canonical unit", () => {
    const r = validateManualEntry(base, defs, today);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.measurement.value).toBeCloseTo(4.995, 3);
    expect(r.measurement.originalValue).toBe(90);
    expect(r.measurement.originalUnit).toBe("mg/dL");
    expect(r.measurement.source).toBe("manual");
    expect(r.warnings).toEqual([]);
  });

  it("stores the unit as spelled in the knowledge file", () => {
    const r = validateManualEntry({ ...base, unit: "MG/DL" }, defs, today);
    expect(r.ok && r.measurement.originalUnit).toBe("mg/dL");
  });

  it("converts the lab range to the canonical unit too", () => {
    const r = validateManualEntry({ ...base, labLow: "70", labHigh: "99" }, defs, today);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.measurement.labRange?.low).toBeCloseTo(3.885, 3);
    expect(r.measurement.labRange?.high).toBeCloseTo(5.4945, 3);
  });

  it("keeps a one-sided lab range", () => {
    const r = validateManualEntry({ ...base, labHigh: "99" }, defs, today);
    expect(r.ok && r.measurement.labRange).toEqual({ high: 99 * 0.0555 });
  });

  it("keeps optional fields and trims text", () => {
    const r = validateManualEntry({ ...base, lab: "  City Lab ", fasted: true, note: " after holiday " }, defs, today);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.measurement.lab).toBe("City Lab");
    expect(r.measurement.fasted).toBe(true);
    expect(r.measurement.note).toBe("after holiday");
  });

  it("records a below-detection-limit value", () => {
    const r = validateManualEntry({ biomarkerId: "crp_hs", value: "<0.3", unit: "mg/L", date: "2025-01-01" }, defs, today);
    expect(r.ok && r.measurement.qualifier).toBe("<");
    expect(r.ok && r.measurement.value).toBe(0.3);
  });

  it("reports every problem at once", () => {
    const r = validateManualEntry({ biomarkerId: "nope", value: "abc", unit: "", date: "2025-13-01" }, defs, today);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["biomarkerId", "date", "value"]);
  });

  it("rejects an unsupported unit, future dates and negative values", () => {
    const r = validateManualEntry({ ...base, unit: "g/L", date: "2025-06-02", value: "-1" }, defs, today);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.unit).toBeDefined();
    expect(r.errors.date).toMatch(/future/);
    expect(r.errors.value).toMatch(/negative/);
  });

  it("accepts today's date", () => {
    expect(validateManualEntry({ ...base, date: today }, defs, today).ok).toBe(true);
  });

  it("asks for a value when empty", () => {
    const r = validateManualEntry({ ...base, value: "  " }, defs, today);
    expect(!r.ok && r.errors.value).toBe("Enter the result.");
  });

  it("rejects a lab range where low is above high", () => {
    const r = validateManualEntry({ ...base, labLow: "100", labHigh: "70" }, defs, today);
    expect(!r.ok && r.errors.labHigh).toBeDefined();
  });

  it("rejects a non-numeric lab range", () => {
    const r = validateManualEntry({ ...base, labLow: "low" }, defs, today);
    expect(!r.ok && r.errors.labLow).toBeDefined();
  });

  it("warns when the value suggests the wrong unit was picked", () => {
    // 90 typed as mmol/L is almost certainly a mg/dL value.
    const r = validateManualEntry({ ...base, unit: "mmol/L" }, defs, today);
    expect(r.ok && r.warnings.length).toBe(1);
  });
});

describe("plausibilityWarnings", () => {
  it("does not warn for ordinary out-of-range values", () => {
    expect(plausibilityWarnings(def("ferritin"), 600, "µg/L")).toEqual([]);
    expect(plausibilityWarnings(def("ferritin"), 5, "µg/L")).toEqual([]);
  });
  it("warns for values far too low", () => {
    expect(plausibilityWarnings(def("sodium"), 1.4, "mmol/L").length).toBe(1);
  });
});

describe("validateManualEntry source", () => {
  it("records where the value came from", () => {
    const r = validateManualEntry({ biomarkerId: "glucose", value: "5", unit: "mmol/L", date: "2025-01-01" }, loadDefs(), "2025-06-01", "pdf");
    expect(r.ok && r.measurement.source).toBe("pdf");
  });
});
