import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateUnits, findDate, parseLabText, type ParsedRow } from "../../src/core/importers/labText";
import { piecesToLines } from "../../src/core/importers/pdfText";
import { validateManualEntry } from "../../src/core/importers/manual";
import { def, loadDefs } from "../helpers";

const defs = [...loadDefs().values()];
const fixture = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "lab-text", name), "utf8");

/** Compact view of a row for readable expectations. */
const brief = (r: ParsedRow) => [r.biomarkerId, r.value, r.unit ?? null, r.labLow ?? null, r.labHigh ?? null];
const byId = (rows: ParsedRow[], id: string) => rows.find((r) => r.biomarkerId === id);

describe("German report (synthetic)", () => {
  const report = parseLabText(fixture("de-synthetic.txt"), defs);

  it("uses the collection date, not the birth date or the release date", () => {
    expect(report.date).toBe("2024-05-12");
    expect(report.dateNote).toBeUndefined();
  });

  it("reads every result line", () => {
    expect(report.rows.filter((r) => r.problems.length === 0).map(brief)).toEqual([
      ["wbc", "5,6", "G/L", "3,9", "10,2"],
      ["rbc", "4,9", "T/L", "4,3", "5,8"],
      ["hemoglobin", "14,8", "g/dL", "13,5", "17,2"],
      ["hematocrit", "0,44", "L/L", "0,40", "0,52"],
      ["mcv", "89", "fL", "80", "99"],
      ["mch", "30,2", "pg", "27", "33"],
      ["mchc", "34,0", "g/dL", "32", "36"],
      ["platelets", "245", "G/L", "150", "370"],
      ["sodium", "140", "mmol/L", "135", "145"],
      ["potassium", "5,4", "mmol/L", "3,5", "5,1"],
      ["creatinine", "0,98", "mg/dL", "0,70", "1,20"],
      ["egfr", "92", "mL/min/1.73m²", "60", null],
      ["urea", "32", "mg/dL (urea)", "17", "43"],
      ["alt", "41", "U/L", null, "50"],
      ["ast", "28", "U/L", null, "50"],
      ["ggt", "22", "U/L", null, "60"],
      ["glucose", "98", "mg/dL", "70", "100"],
      ["total_cholesterol", "212", "mg/dL", null, "200"],
      ["ldl", "138", "mg/dL", null, "116"],
      ["hdl", "52", "mg/dL", "40", null],
      ["triglycerides", "110", "mg/dL", null, "150"],
      ["hba1c", "36", "mmol/mol", "20", "42"],
      ["crp_hs", "<0,6", "mg/L", null, "5,0"],
      ["ferritin", "85", "ng/mL", "30", "400"],
      ["tsh", "1,85", "mU/L", "0,27", "4,20"],
    ]);
  });

  it("flags absolute lymphocytes instead of saving them as a percentage", () => {
    const lymph = byId(report.rows, "lymphocyte_pct")!;
    expect(lymph.value).toBe("1,9");
    expect(lymph.problems[0]).toMatch(/isn't one this app knows/);
  });

  it("skips ratio lines", () => {
    expect(report.rows.some((r) => r.line.includes("Quotient"))).toBe(false);
  });

  it("produces values that pass the normal entry validation", () => {
    const map = loadDefs();
    for (const r of report.rows.filter((x) => x.problems.length === 0)) {
      const v = validateManualEntry(
        { biomarkerId: r.biomarkerId, value: r.value, unit: r.unit!, date: report.date!, labLow: r.labLow, labHigh: r.labHigh },
        map,
        "2025-01-01",
      );
      expect(v.ok, r.line).toBe(true);
    }
  });
});

describe("Hungarian report (synthetic)", () => {
  const report = parseLabText(fixture("hu-synthetic.txt"), defs);

  it("reads the yyyy.mm.dd. date and skips the birth date", () => {
    expect(report.date).toBe("2025-01-08");
  });

  it("matches Hungarian names", () => {
    expect(report.rows.map(brief)).toEqual([
      ["wbc", "6,1", "G/L", "4,0", "10,0"],
      ["hemoglobin", "128", "g/L", "120", "160"],
      ["platelets", "302", "G/L", "150", "400"],
      ["glucose", "5,1", "mmol/L", "3,9", "6,0"],
      ["creatinine", "71", "µmol/L", "49", "90"],
      ["total_cholesterol", "5,4", "mmol/L", null, "5,2"],
      ["triglycerides", "1,1", "mmol/L", null, "1,7"],
      ["ferritin", "18", "µg/L", "13", "150"],
      ["vitamin_d", "48", "nmol/L", "75", "250"],
      ["alp", "64", "U/L", "35", "105"],
    ]);
  });
});

describe("US report (synthetic)", () => {
  it("reads slash dates month-first when asked, and notes the ambiguity", () => {
    const us = parseLabText(fixture("us-synthetic.txt"), defs, { monthFirst: true });
    expect(us.date).toBe("2024-03-11");
    expect(us.dateNote).toMatch(/month\/day/);
    const eu = parseLabText(fixture("us-synthetic.txt"), defs);
    expect(eu.date).toBe("2024-11-03");
  });

  it("handles US units, flags and names", () => {
    const report = parseLabText(fixture("us-synthetic.txt"), defs, { monthFirst: true });
    expect(report.rows.map(brief)).toEqual([
      ["wbc", "7.2", "10^3/µL", "3.4", "10.8"],
      ["rbc", "4.41", "10^6/µL", "3.77", "5.28"],
      ["hemoglobin", "12.9", "g/dL", "11.1", "15.9"],
      ["platelets", "288", "10^3/µL", "150", "450"],
      ["glucose", "104", "mg/dL", "70", "99"],
      ["urea", "15", "mg/dL (BUN)", "6", "24"],
      ["creatinine", "0.82", "mg/dL", "0.57", "1.00"],
      ["egfr", "93", "mL/min/1.73", "59", null],
      ["alt", "19", "IU/L", "0", "32"],
      ["total_cholesterol", "188", "mg/dL", "100", "199"],
      ["triglycerides", "96", "mg/dL", "0", "149"],
      ["hdl", "61", "mg/dL", "39", null],
      ["ldl", "109", "mg/dL", "0", "99"],
      ["vitamin_d", "31.5", "ng/mL", "30.0", "100.0"],
      ["tsh", "2.140", "µIU/mL", "0.450", "4.500"],
    ]);
    expect(byId(report.rows, "urea")!.notes[0]).toMatch(/BUN/);
  });
});

describe("UK report (synthetic)", () => {
  const report = parseLabText(fixture("uk-synthetic.txt"), defs);

  it("reads a day-first date above 12 without a note", () => {
    expect(report.date).toBe("2024-06-18");
    expect(report.dateNote).toBeUndefined();
  });

  it("reads ranges in brackets", () => {
    expect(report.rows.map(brief)).toEqual([
      ["hemoglobin", "141", "g/L", "130", "180"],
      ["wbc", "6.4", "10^9/L", "4.0", "11.0"],
      ["platelets", "233", "10^9/L", "150", "400"],
      ["ferritin", "112", "µg/L", "30", "400"],
      ["b12", "312", "ng/L", "197", "771"],
      ["folate", "9.8", "µg/L", "3.9", null],
      ["tsh", "2.1", "mU/L", "0.27", "4.2"],
      ["ft4", "15.3", "pmol/L", "12", "22"],
    ]);
  });
});

describe("line matching rules", () => {
  const rows = (text: string) => parseLabText(text, defs).rows.map(brief);

  it("doesn't let a short alias match the start of a longer word", () => {
    expect(rows("Kreatinin 80 µmol/L")).toEqual([["creatinine", "80", "µmol/L", null, null]]);
    expect(rows("HbA1c 5.6 %")).toEqual([["hba1c", "5.6", "%", null, null]]);
  });

  it("splits a unit or flag glued to the value", () => {
    expect(rows("Glucose 5.4mmol/L")).toEqual([["glucose", "5.4", "mmol/L", null, null]]);
    expect(rows("Sodium 149H mmol/L")).toEqual([["sodium", "149", "mmol/L", null, null]]);
  });

  it("does not read a number inside a name as the value", () => {
    expect(rows("Vitamin D, 25-Hydroxy 31.5 ng/mL")).toEqual([["vitamin_d", "31.5", "ng/mL", null, null]]);
  });

  it("assumes the only possible unit when none is printed, with a note", () => {
    const r = parseLabText("RDW 13.1", defs).rows[0]!;
    expect(r.unit).toBe("%");
    expect(r.notes[0]).toMatch(/assumed/);
  });

  it("asks for a unit when several are possible and none is printed", () => {
    expect(parseLabText("Glucose 5.4", defs).rows[0]!.problems[0]).toMatch(/No unit/);
  });

  it("ignores lines without a value and lists unknown result lines", () => {
    const report = parseLabText("Ferritin\nHomocysteine 9.2 µmol/L 5 - 15", defs);
    expect(report.rows).toEqual([]);
    expect(report.unmatched).toEqual(["Homocysteine 9.2 µmol/L 5 - 15"]);
  });

  it("skips lines with birth dates entirely", () => {
    expect(parseLabText("DOB: 01/02/1980\nGlucose 5 mmol/L", defs).date).toBeUndefined();
  });
});

describe("findDate", () => {
  it("reads the common formats", () => {
    expect(findDate("2024-05-12")?.date).toBe("2024-05-12");
    expect(findDate("2024.05.12.")?.date).toBe("2024-05-12");
    expect(findDate("12.05.2024")?.date).toBe("2024-05-12");
    expect(findDate("12.05.24")?.date).toBe("2024-05-12");
    expect(findDate("25/12/2024")?.date).toBe("2024-12-25");
    expect(findDate("12/25/2024")?.date).toBe("2024-12-25");
  });
  it("rejects impossible dates", () => {
    expect(findDate("31.02.2024")).toBeUndefined();
  });
});

describe("candidateUnits", () => {
  it("returns both urea units for a bare mg/dL", () => {
    expect(candidateUnits(def("urea"), "mg/dl").sort()).toEqual(["mg/dL (BUN)", "mg/dL (urea)"]);
  });
  it("ignores brackets around a unit", () => {
    expect(candidateUnits(def("wbc"), "(x10^9/L)")).toEqual(["10^9/L"]);
  });
});

describe("piecesToLines", () => {
  const p = (str: string, x: number, y: number, width = str.length * 5) => ({ str, x, y, width, height: 10 });

  it("groups by baseline, orders top to bottom and left to right", () => {
    expect(piecesToLines([p("5.6", 200, 700), p("Leukozyten", 50, 700.8), p("Natrium", 50, 680), p("140", 200, 680)])).toEqual([
      "Leukozyten   5.6",
      "Natrium   140",
    ]);
  });

  it("joins close pieces with a single space and touching pieces with none", () => {
    expect(piecesToLines([p("Ferri", 50, 700, 25), p("tin", 75, 700, 15), p("(S)", 93, 700)])).toEqual(["Ferritin (S)"]);
  });

  it("ignores empty pieces", () => {
    expect(piecesToLines([p("  ", 0, 0), p("", 5, 5)])).toEqual([]);
  });
});

describe("DunedinPACE from a DNA test report", () => {
  it("reads the value, with the unit assumed when the report prints none", () => {
    const r = parseLabText("Collection date: 2026-03-02\nDunedinPACE 0.83", defs);
    const row = r.rows.find((x) => x.biomarkerId === "dunedinpace")!;
    expect(row).toMatchObject({ value: "0.83", unit: "years/year" });
    expect(row.notes.join(" ")).toMatch(/No unit printed/);
  });
});
