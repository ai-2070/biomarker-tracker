import { describe, expect, it } from "vitest";
import { parseLabText } from "../../src/core/importers/labText";
import { validateManualEntry } from "../../src/core/importers/manual";
import { flagMeasurement } from "../../src/core/trends";
import { loadDefs } from "../helpers";

const defs = loadDefs();
const catalog = [...defs.values()];
const today = "2026-10-31";

describe("extended lipid results", () => {
  it("keeps apolipoproteins, ratios and non-HDL separate from LDL, HDL and total cholesterol", () => {
    const report = parseLabText([
      "Collection date: 2026-10-20",
      "Apo A1 140 mg/dL 120 - 180",
      "Apo B 950 mg/L 600 - 900",
      "Apo B/Apo A1 ratio 0.68 < 0.90",
      "LDL/HDL-Quotient 2,7 < 3,0",
      "Non-HDL cholesterol 160 mg/dL < 145",
      "LDL cholesterol 130 mg/dL < 116",
      "HDL cholesterol 50 mg/dL > 40",
      "Total cholesterol 210 mg/dL < 200",
    ].join("\n"), catalog);
    expect(report.date).toBe("2026-10-20");
    expect(report.rows.map((r) => r.biomarkerId)).toEqual([
      "apo_a1", "apo_b", "apo_b_a1_ratio", "ldl_hdl_ratio", "non_hdl_cholesterol", "ldl", "hdl", "total_cholesterol",
    ]);
    const saved = report.rows.map((row) => {
      const result = validateManualEntry({ biomarkerId: row.biomarkerId, value: row.value, unit: row.unit!, date: report.date!, labLow: row.labLow, labHigh: row.labHigh }, defs, today, "pdf");
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      return { id: `lipid-${row.biomarkerId}`, ...result.measurement };
    });
    expect(saved[0]!.value).toBeCloseTo(1.4);
    expect(saved[0]).toMatchObject({ labRange: { low: 1.2, high: 1.8 }, source: "pdf" });
    expect(saved[1]!.value).toBeCloseTo(0.95);
    expect(saved[1]!.labRange).toEqual({ low: 0.6, high: 0.9 });
    expect(flagMeasurement(defs.get("apo_b")!, saved[1]!, {})).toBe("high");
    expect(saved[2]).toMatchObject({ value: 0.68, originalUnit: "ratio", labRange: { high: 0.9 } });
    expect(saved[3]).toMatchObject({ value: 2.7, originalUnit: "ratio", labRange: { high: 3 } });
    expect(saved[4]!.value).toBeCloseTo(4.1376);
    expect(saved[4]!.labRange!.high).toBeCloseTo(3.7497);
  });

  it("accepts directly entered protein, cholesterol and dimensionless ratio values", () => {
    const cases = [
      { biomarkerId: "apo_a1", value: "1,4", unit: "g/L", expected: 1.4 },
      { biomarkerId: "apo_b", value: "95", unit: "mg/dL", expected: 0.95 },
      { biomarkerId: "apo_b_a1_ratio", value: "0,68", unit: "ratio", expected: 0.68 },
      { biomarkerId: "ldl_hdl_ratio", value: "2,7", unit: "ratio", expected: 2.7 },
      { biomarkerId: "non_hdl_cholesterol", value: "4,1", unit: "mmol/L", expected: 4.1 },
    ];
    for (const { expected, ...input } of cases) {
      const result = validateManualEntry({ ...input, date: "2026-10-20" }, defs, today);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      expect(result.measurement.value).toBeCloseTo(expected);
      expect(result.measurement.source).toBe("manual");
    }
  });

  it("preserves bounded ratios rather than calling them in range", () => {
    const row = parseLabText("Apo B/Apo A1 ratio <0.65 < 0.9", catalog).rows[0]!;
    const result = validateManualEntry({ biomarkerId: row.biomarkerId, value: row.value, unit: row.unit!, date: today, labHigh: row.labHigh }, defs, today);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.measurement).toMatchObject({ biomarkerId: "apo_b_a1_ratio", value: 0.65, qualifier: "<", labRange: { high: 0.9 } });
    expect(flagMeasurement(defs.get("apo_b_a1_ratio")!, { id: "bounded-ratio", ...result.measurement }, {})).toBe("unknown");
  });

  it("does not import unsupported total/HDL or inverse ratios as individual measurements", () => {
    const report = parseLabText("Total cholesterol/HDL ratio 4.2\nHDL/LDL ratio 0.5\nApo A1/Apo B ratio 1.4", catalog);
    expect(report.rows).toEqual([]);
  });

  it.each([
    { line: "Apo B 0.9 mmol/L", biomarkerId: "apo_b" },
    { line: "LDL/HDL ratio 2.7 mmol/L", biomarkerId: "ldl_hdl_ratio" },
  ])("refuses incompatible units for $biomarkerId", ({ line, biomarkerId }) => {
    const row = parseLabText(line, catalog).rows[0]!;
    expect(row.biomarkerId).toBe(biomarkerId);
    expect(row.unit).toBeUndefined();
    const result = validateManualEntry({ biomarkerId, value: row.value, unit: row.unitText!, date: today }, defs, today);
    expect(result).toMatchObject({ ok: false, errors: { unit: expect.any(String) } });
  });
});
