import { describe, expect, it } from "vitest";
import { normalizeOcrText } from "../../src/core/importers/ocrText";
import { decimalProblem, parseLabText } from "../../src/core/importers/labText";
import { loadDefs } from "../helpers";

describe("normalizeOcrText", () => {
  it("fixes O for zero and l for one in numbers, and table rules", () => {
    expect(normalizeOcrText("CRP | O.8 | mg/L | <5")).toBe("CRP   0.8   mg/L   <5".replace(/ {3}/g, "  "));
    expect(normalizeOcrText("Ferritin 1O2 ug/L")).toBe("Ferritin 102 ug/L");
    expect(normalizeOcrText("Hemoglobin 13l g/L")).toBe("Hemoglobin 131 g/L");
    expect(normalizeOcrText("Glucose 5 .2 mmol/L")).toBe("Glucose 5.2 mmol/L");
  });

  it("restores the raised power in cell-count units", () => {
    expect(normalizeOcrText('White cell count 6.4 x10"9/L (4.0 - 11.0)')).toBe("White cell count 6.4 x10^9/L (4.0 - 11.0)");
    expect(normalizeOcrText("Platelet count 233 x1079/L (150 - 400)")).toBe("Platelet count 233 x10^9/L (150 - 400)");
    expect(normalizeOcrText("Platelet count 233 x1049/L")).toBe("Platelet count 233 x10^9/L");
    expect(normalizeOcrText("Red cell count 4.6 x10412/L")).toBe("Red cell count 4.6 x10^12/L");
    // A plain number that happens to follow is left alone.
    expect(normalizeOcrText("Ferritin 1049 ug/L")).toBe("Ferritin 1049 ug/L");
  });

  it("reads litre written as a capital i", () => {
    expect(normalizeOcrText("Leukozyten 5,6 G/I 3,9-10,2")).toBe("Leukozyten 5,6 G/l 3,9-10,2");
    const r = parseLabText("Leukozyten 5,6 G/I 3,9-10,2", [...loadDefs().values()], { monthFirst: false });
    expect(r.rows[0]!.problems.join(" ")).toMatch(/unit/);
    const fixed = parseLabText(normalizeOcrText("Leukozyten 5,6 G/I 3,9-10,2"), [...loadDefs().values()], { monthFirst: false });
    expect(fixed.rows[0]).toMatchObject({ biomarkerId: "wbc", value: "5,6", problems: [] });
  });

  it("leaves words alone", () => {
    expect(normalizeOcrText("Total cholesterol  Ok")).toBe("Total cholesterol  Ok");
    expect(normalizeOcrText("Folate  Oxford Lab")).toBe("Folate  Oxford Lab");
  });

  it("lets the lab-report parser read a typical photo's text", () => {
    const ocr = ["Sample date: 12.05.2024", "Ferritin | 4O | ug/L | 15 - 150", "Hemoglobin | 13l | g/L | 120 - 155", "", "CRP | O.8 | mg/L | < 5"].join("\n");
    const r = parseLabText(normalizeOcrText(ocr), [...loadDefs().values()], { monthFirst: false });
    const byId = Object.fromEntries(r.rows.map((x) => [x.biomarkerId, x.value]));
    expect(byId.ferritin).toBe("40");
    expect(byId.hemoglobin).toBe("131");
    expect(byId.crp_hs).toBe("0.8");
    expect(r.date).toBe("2024-05-12");
  });
});

describe("lost decimal points", () => {
  it("flags a value far outside the lab's own range, e.g. potassium 5,4 read as 54", () => {
    const r = parseLabText("Probenentnahme: 12.05.2024\nKalium   54   mmol/l   3,5 - 5,1\nNatrium   140   mmol/l   135 - 145", [...loadDefs().values()], { monthFirst: false });
    expect(r.rows.find((x) => x.biomarkerId === "potassium")!.problems.join(" ")).toMatch(/decimal point/);
    expect(r.rows.find((x) => x.biomarkerId === "sodium")!.problems).toEqual([]);
  });

  it("catches a range that lost its comma, but not ordinary highs and lows", () => {
    expect(decimalProblem({ value: "14,8", labLow: "135", labHigh: "172" })).toBeDefined();
    expect(decimalProblem({ value: "9", labLow: "15", labHigh: "150" })).toBeUndefined();
    expect(decimalProblem({ value: "12", labHigh: "5" })).toBeUndefined();
    expect(decimalProblem({ value: "<0,6", labHigh: "5,0" })).toBeUndefined();
    expect(decimalProblem({ value: "54", labLow: "3,5", labHigh: "5,1" })).toBeDefined();
  });
});
