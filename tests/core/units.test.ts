import { describe, expect, it } from "vitest";
import {
  deltaFromCanonical,
  formatValue,
  fromCanonical,
  isSupportedUnit,
  listUnits,
  matchUnit,
  normalizeUnit,
  roundForDisplay,
  toCanonical,
  UnitError,
} from "@bt/core/units";
import { def } from "../helpers";

describe("normalizeUnit", () => {
  it("ignores case and spaces", () => {
    expect(normalizeUnit(" mmol / l ")).toBe(normalizeUnit("mmol/L"));
  });
  it("treats both micro signs and 'u'/'mc' spellings the same", () => {
    const micro = normalizeUnit("µmol/L");
    expect(normalizeUnit("μmol/L")).toBe(micro);
    expect(normalizeUnit("umol/L")).toBe(micro);
    expect(normalizeUnit("mcg/L")).toBe(normalizeUnit("µg/L"));
    expect(normalizeUnit("ug/L")).toBe(normalizeUnit("µg/L"));
    expect(normalizeUnit("10^3/uL")).toBe(normalizeUnit("10^3/µL"));
    expect(normalizeUnit("uIU/mL")).toBe(normalizeUnit("µIU/mL"));
  });
  it("understands powers of ten as labs print them", () => {
    const want = normalizeUnit("10^9/L");
    for (const s of ["10*9/L", "10**9/L", "10E9/L", "x10^9/L", "×10^9/L", "x 10^9/L", "10⁹/L"]) {
      expect(normalizeUnit(s)).toBe(want);
    }
    expect(normalizeUnit("10^12/L")).not.toBe(want);
  });
  it("treats decimal comma and superscript 2 the same", () => {
    expect(normalizeUnit("mL/min/1,73 m²")).toBe(normalizeUnit("mL/min/1.73m2"));
  });
  it("does not turn enzyme units (U/L) into micro", () => {
    expect(normalizeUnit("U/L")).toBe("u/l");
    expect(normalizeUnit("IU/L")).toBe("iu/l");
  });
});

describe("toCanonical / fromCanonical", () => {
  it("converts glucose mg/dL to mmol/L", () => {
    expect(toCanonical(def("glucose"), 90, "mg/dL")).toBeCloseTo(5.0, 1);
  });
  it("converts creatinine mg/dL to µmol/L", () => {
    expect(toCanonical(def("creatinine"), 1, "mg/dL")).toBeCloseTo(88.42, 2);
  });
  it("converts LDL mg/dL to mmol/L", () => {
    expect(toCanonical(def("ldl"), 116, "mg/dL")).toBeCloseTo(3.0, 1);
  });
  it("converts vitamin D ng/mL to nmol/L", () => {
    expect(toCanonical(def("vitamin_d"), 20, "ng/mL")).toBeCloseTo(49.9, 1);
  });
  it("converts haemoglobin mmol/L (German labs) to g/L", () => {
    expect(toCanonical(def("hemoglobin"), 8.7, "mmol/L")).toBeCloseTo(140.2, 1);
  });
  it("handles HbA1c IFCC mmol/mol with an offset (master equation)", () => {
    const hba1c = def("hba1c");
    expect(toCanonical(hba1c, 48, "mmol/mol")).toBeCloseTo(6.5, 1);
    expect(toCanonical(hba1c, 39, "mmol/mol")).toBeCloseTo(5.7, 1);
    expect(fromCanonical(hba1c, 6.5, "mmol/mol")).toBeCloseTo(48, 0);
  });
  it("converts the v0.3 markers' lab units", () => {
    expect(toCanonical(def("bilirubin"), 1, "mg/dL")).toBeCloseTo(17.1, 1);
    expect(toCanonical(def("ft4"), 1.2, "ng/dL")).toBeCloseTo(15.4, 1);
    expect(toCanonical(def("iron"), 100, "µg/dL")).toBeCloseTo(17.9, 1);
    expect(toCanonical(def("folate"), 3, "ng/mL")).toBeCloseTo(6.8, 1);
    expect(toCanonical(def("hematocrit"), 0.42, "L/L")).toBeCloseTo(42, 6);
    expect(toCanonical(def("mchc"), 34, "g/dL")).toBe(340);
    expect(toCanonical(def("alt"), 0.5, "µkat/L")).toBe(30);
    // BUN 14 mg/dL and urea 30 mg/dL are both about 5 mmol/L urea.
    expect(toCanonical(def("urea"), 14, "mg/dL (BUN)")).toBeCloseTo(5.0, 1);
    expect(toCanonical(def("urea"), 30, "mg/dL (urea)")).toBeCloseTo(5.0, 1);
  });
  it("round-trips every unit of every marker", () => {
    for (const id of ["glucose", "hba1c", "b12", "ferritin", "wbc", "alp"]) {
      const d = def(id);
      for (const unit of Object.keys(d.conversions)) {
        expect(fromCanonical(d, toCanonical(d, 12.34, unit), unit)).toBeCloseTo(12.34, 9);
      }
    }
  });
  it("accepts differently written units", () => {
    expect(toCanonical(def("creatinine"), 1, "MG/DL")).toBeCloseTo(88.42, 2);
    expect(toCanonical(def("creatinine"), 80, "umol/l")).toBe(80);
  });
  it("converts differences without applying the offset", () => {
    const hba1c = def("hba1c");
    const a = toCanonical(hba1c, 40, "mmol/mol");
    const b = toCanonical(hba1c, 50, "mmol/mol");
    expect(deltaFromCanonical(hba1c, b - a, "mmol/mol")).toBeCloseTo(10, 9);
    expect(deltaFromCanonical(def("glucose"), 1, "mg/dL")).toBeCloseTo(18.02, 2);
  });
  it("throws a UnitError for unknown units", () => {
    expect(() => toCanonical(def("glucose"), 5, "g/L")).toThrow(UnitError);
  });
});

describe("unit helpers", () => {
  it("lists the canonical unit first", () => {
    expect(listUnits(def("glucose"))[0]).toBe("mmol/L");
  });
  it("matches a unit to its spelling in the knowledge file", () => {
    expect(matchUnit(def("b12"), "PG/ML")).toBe("pg/mL");
    expect(matchUnit(def("b12"), "mg")).toBeUndefined();
    expect(isSupportedUnit(def("tsh"), "uIU/mL")).toBe(true);
  });
});

describe("display rounding", () => {
  it("uses fewer decimals for bigger numbers", () => {
    expect(roundForDisplay(142.46)).toBe(142);
    expect(roundForDisplay(14.46)).toBe(14.5);
    expect(roundForDisplay(1.456)).toBe(1.46);
    expect(roundForDisplay(0.004)).toBe(0);
  });
  it("formats with the given locale", () => {
    expect(formatValue(5.43, "en-US")).toBe("5.43");
    expect(formatValue(5.43, "de-DE")).toBe("5,43");
    expect(formatValue(1234.4, "en-US")).toBe("1,234");
  });
});
