import { readFileSync } from "node:fs";
import { join } from "node:path";
import { candidateUnits, findDate, foldLabName, type ParsedRow, parseLabText, truncatedUnit, withTestDate } from "@bt/shared/core/importers/labText";
import { validateManualEntry } from "@bt/shared/core/importers/manual";
import { piecesToLines } from "@bt/shared/core/importers/pdfText";
import { describe, expect, it } from "vitest";
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
      ["lymphocyte_abs", "1,9", "G/L", "1,1", "4,5"],
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
      ["ldl_hdl_ratio", "2,7", "ratio", null, "3,0"],
      ["triglycerides", "110", "mg/dL", null, "150"],
      ["hba1c", "36", "mmol/mol", "20", "42"],
      ["crp_hs", "<0,6", "mg/L", null, "5,0"],
      ["ferritin", "85", "ng/mL", "30", "400"],
      ["tsh", "1,85", "mU/L", "0,27", "4,20"],
    ]);
  });

  it("reads a bare 'Lymphozyten' with a cell-count unit as the absolute count, never as a percentage", () => {
    expect(byId(report.rows, "lymphocyte_pct")).toBeUndefined();
    const lymph = byId(report.rows, "lymphocyte_abs")!;
    expect(lymph.value).toBe("1,9");
    expect(lymph.notes.join(" ")).toMatch(/because of its unit/);
  });

  it("still flags a count unit when no absolute-count marker is loaded", () => {
    const pctOnly = defs.filter((d) => d.id !== "lymphocyte_abs");
    const lymph = byId(parseLabText(fixture("de-synthetic.txt"), pctOnly).rows, "lymphocyte_pct")!;
    expect(lymph.problems[0]).toMatch(/isn't one this app knows/);
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

describe("Hungarian hospital report (synthetic, layout of a real clinic printout)", () => {
  const report = parseLabText(fixture("hu-hospital-synthetic.txt"), defs);
  const ok = report.rows.filter((r) => r.problems.length === 0);

  it("reads every result the app tracks, past Serum prefixes and Latin/Hungarian names", () => {
    expect(ok.map(brief)).toEqual([
      ["sodium", "141.0", "mmol/L", "133.0", "145.0"],
      ["potassium", "4.2", "mmol/L", "3.4", "5.0"],
      ["calcium", "2.40", "mmol/L", "2.20", "2.55"],
      ["calcium_corrected", "2.38", "mmol/L", "2.15", "2.55"],
      ["crp_hs", "1.2", "mg/L", null, "5.0"],
      ["glucose", "5.1", "mmol/L", "4.1", "6.0"],
      ["urea", "5.6", "mmol/L", "2.8", "8.1"],
      ["creatinine", "78", "µmol/L", "44", "80"],
      ["egfr", "88", "mL/min/1.73m²", "90", null],
      ["uric_acid", "300", "µmol/L", "143", "339"],
      ["albumin", "45", "g/L", "35", "52"],
      ["wbc", "6.10", "G/L", "4.00", "9.00"],
      ["rbc", "4.40", "T/L", "3.80", "4.50"],
      ["hemoglobin", "135.0", "g/L", "120.0", "161.0"],
      ["hematocrit", "0.41", "L/L", "0.38", "0.47"],
      ["mcv", "90.0", "fL", "82.0", "95.0"],
      ["mch", "30.1", "pg", "27.0", "32.0"],
      ["mchc", "335.0", "g/L", "290.0", "354.0"],
      ["rdw", "12.9", "%", "11.5", "14.5"],
      ["platelets", "240", "G/L", "150", "400"],
      ["mpv", "9.1", "fL", "7.2", "11.1"],
      ["neutrophil_pct", "58.0", "%", "40.0", "65.0"],
      ["lymphocyte_pct", "31.0", "%", "25.0", "40.0"],
      ["monocyte_pct", "6.0", "%", "3.0", "7.0"],
      ["neutrophil_abs", "3.54", "G/L", "2.20", "7.90"],
      ["lymphocyte_abs", "1.89", "G/L", "1.10", "4.50"],
      ["urine_albumin", "3.10", "mg/L", null, "20.00"],
      ["urine_acr", "0.4", "mg/mmol", null, "3.5"],
      ["urine_creatinine", "9.10", "mmol/L", "2.47", "19.20"],
      ["urine_creatinine", "9.10", "mmol/L", "2.47", "19.20"],
    ]);
  });

  it("says when a unit was cut off by the column", () => {
    expect(byId(report.rows, "egfr")!.notes.join(" ")).toMatch(/cut off/);
  });

  it("doesn't take corrected calcium for albumin, or absolute counts for percentages", () => {
    expect(report.rows.filter((r) => r.biomarkerId === "albumin")).toHaveLength(1);
    expect(report.rows.filter((r) => r.biomarkerId === "neutrophil_pct")).toHaveLength(1);
    expect(report.rows.filter((r) => r.biomarkerId === "lymphocyte_pct")).toHaveLength(1);
  });

  it("reads creatinine under a urine heading as urine creatinine, never as blood", () => {
    const urine = report.rows.filter((r) => r.biomarkerId === "urine_creatinine");
    expect(urine.map((r) => r.line)).toEqual(["Kreatinin   9.10   mmol/L   2.47-19.20", "Vizelet Creatinin   9.10   mmol/L   2.47-19.20"]);
    expect(urine[0]!.notes.join(" ")).toMatch(/urine heading/);
    expect(report.rows.filter((r) => r.biomarkerId === "creatinine")).toHaveLength(1);
  });

  it("unticks a blood test name under a urine heading when no urine test of that name exists", () => {
    const glucose = report.rows.filter((r) => r.biomarkerId === "glucose");
    expect(glucose.map((r) => [r.value, r.problems.some((p) => /urine heading/.test(p))])).toEqual([
      ["5.1", false],
      ["0.3", true],
    ]);
  });

  it("lists tests the app doesn't track", () => {
    expect(report.unmatched).toEqual(["fajsúly   1.015   umol/l   1.005-1.030"]);
  });

  it("uses the dated lab line", () => {
    expect(report.date).toBe("2025-03-14");
  });
});

describe("names as photos and labs print them", () => {
  it("ignores accents, a dotless i and spacing around brackets and percent signs", () => {
    const r = parseLabText(["Serum Natrıum   139   mmol/L", "Thrombocyta szam   210   G/L", "Neutrophil (pero) %   61.0   %"].join("\n"), defs);
    expect(r.rows.map(brief)).toEqual([
      ["sodium", "139", "mmol/L", null, null],
      ["platelets", "210", "G/L", null, null],
      ["neutrophil_pct", "61.0", "%", null, null],
    ]);
  });

  it("strips blood specimen prefixes but not urine ones", () => {
    const r = parseLabText(
      [
        "S-Kalium   4.1   mmol/L",
        "P-Glukose   5.0   mmol/L",
        "Plasma Sodium   140   mmol/L",
        "U-Kreatinin   8.0   mmol/L",
        "Urine creatinine   8.0   mmol/L",
      ].join("\n"),
      defs,
    );
    // "U-Kreatinin" isn't read as blood creatinine; "Urine creatinine" is its own urine test.
    expect(r.rows.map((x) => x.biomarkerId)).toEqual(["potassium", "glucose", "sodium", "urine_creatinine"]);
  });

  it("keeps foldLabName's positions pointing into the original text", () => {
    const f = foldLabName("Neutrophil (pero)  %");
    expect(f.text).toBe("neutrophil(pero)%");
    expect(f.at.length).toBe(f.text.length);
    expect("Neutrophil (pero)  %"[f.at[f.text.indexOf("%")]!]).toBe("%");
    expect(foldLabName("Fehérvérsejtszám").text).toBe("feherversejtszam");
  });
});

describe("ratio names", () => {
  it("reads a marker whose own name is a ratio, but not a ratio that merely starts with a marker's name", () => {
    const r = parseLabText(["Albumin/creatinine ratio   2.1   mg/mmol   <3.0", "Albumin/Globulin ratio   1.4", "Cholesterol/HDL ratio   4.1"].join("\n"), defs);
    expect(r.rows.map(brief)).toEqual([["urine_acr", "2.1", "mg/mmol", null, "3.0"]]);
  });
});

describe("two numbers before the unit", () => {
  it("unticks a lost decimal point or a speck read as a digit", () => {
    const r = parseLabText(["Serum Glucose   5 4   mmol/L   4.1-6.0", "Serum Natrium   8 140.0   mmol/L   133.0-145.0"].join("\n"), defs);
    expect(r.rows.map((x) => [x.biomarkerId, x.problems.some((p) => /Two numbers/.test(p))])).toEqual([
      ["glucose", true],
      ["sodium", true],
    ]);
  });

  it("leaves low and high range columns alone", () => {
    const r = parseLabText("Sodium   140   135   145   mmol/L", defs);
    expect(r.rows[0]!.problems).toEqual([]);
  });
});

describe("truncatedUnit", () => {
  it("reads a unit cut off by the column when every match converts the same", () => {
    expect(truncatedUnit(def("egfr"), "ml/min/1")).toBe("mL/min/1.73m²");
  });

  it("doesn't guess from short or ambiguous fragments", () => {
    expect(truncatedUnit(def("crp_hs"), "mg/")).toBeUndefined();
    expect(truncatedUnit(def("creatinine"), "mmol")).toBeUndefined();
    expect(truncatedUnit(def("urea"), "mg/dL")).toBeUndefined();
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
    const report = parseLabText("Ferritin\nProcalcitonin 0.8 ng/mL 0 - 0.5", defs);
    expect(report.rows).toEqual([]);
    expect(report.unmatched).toEqual(["Procalcitonin 0.8 ng/mL 0 - 0.5"]);
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

describe("withTestDate", () => {
  const rows: ParsedRow[] = [];
  it("leaves the report alone when no date was entered", () => {
    const report = { rows, unmatched: [], date: "2025-03-01", dateNote: "Day and month order unclear." };
    expect(withTestDate(report, undefined)).toBe(report);
  });
  it("fills the entered date and drops a note about a missing date", () => {
    expect(withTestDate({ rows, unmatched: [], dateNote: "No sample date was found." }, "2025-03-04")).toEqual({ rows, unmatched: [], date: "2025-03-04" });
  });
  it("uses the entered date but says so when the report prints another", () => {
    const out = withTestDate({ rows, unmatched: [], date: "2025-03-01" }, "2025-03-04");
    expect(out.date).toBe("2025-03-04");
    expect(out.dateNote).toContain("2025-03-01");
  });
  it("agrees quietly when both dates match", () => {
    expect(withTestDate({ rows, unmatched: [], date: "2025-03-04", dateNote: "Day and month order unclear." }, "2025-03-04")).toEqual({
      rows,
      unmatched: [],
      date: "2025-03-04",
    });
  });
});
