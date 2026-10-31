import { describe, expect, it } from "vitest";
import { measurementsIn } from "../../src/core/measurementCompletion";
import type { BiomarkerDef } from "../../src/core/types";
import weight from "../../knowledge/biomarkers/weight.json";
import bodyFat from "../../knowledge/biomarkers/body_fat.json";
import pace from "../../knowledge/biomarkers/dunedinpace.json";
import ldl from "../../knowledge/biomarkers/ldl.json";
import systolic from "../../knowledge/biomarkers/bp_systolic.json";
import diastolic from "../../knowledge/biomarkers/bp_diastolic.json";

const defs = new Map<string, BiomarkerDef>([weight, bodyFat, pace, ldl, systolic, diastolic].map((def) => [def.id, def as BiomarkerDef]));
const today = "2026-10-30";
const read = (text: string) => measurementsIn(text, today, defs);

describe("current measurements stated in personal chat", () => {
  it("extracts weight and body fat from a mixed personal introduction", () => {
    const text = "I'm 31, 102kg, 192cm tall, man, I take 1 hour walks every day, I do work from home, 27% body fat, I only take magnesum and sometimes creatine. I usually eat eveything, I have a sweet tooth. What should I take if I restart weight lifting casually in the gym, and to focus better at work.";
    expect(read(text).map(({ biomarkerId, value, date, source }) => ({ biomarkerId, value, date, source }))).toEqual([
      { biomarkerId: "weight", value: 102, date: today, source: "manual" },
      { biomarkerId: "body_fat", value: 27, date: today, source: "manual" },
    ]);
  });

  it.each(["im 27% body fat", "My body fat is 27% today", "I'm 27% body fat"])("records a percentage in %s", (text) => {
    expect(read(text)).toMatchObject([{ biomarkerId: "body_fat", value: 27, originalUnit: "%", date: today }]);
  });

  it("recognises the reported aging-pace alias and its single unit without inventing a calculated pace", () => {
    expect(read("my pace of aging is 0.88 today")).toMatchObject([{ biomarkerId: "dunedinpace", value: 0.88, originalUnit: "years/year", date: today }]);
    expect(read("my pace of aging from PhenoAge is 0.88 today")).toEqual([]);
  });

  it("uses existing unit conversion for pounds and preserves the original reading", () => {
    const result = read("I weigh 220 lb today");
    expect(result).toMatchObject([{ biomarkerId: "weight", originalValue: 220, originalUnit: "lb" }]);
    expect(result[0]!.value).toBeCloseTo(99.7903214, 7);
  });

  it("uses marker aliases for an explicitly named lab result and does not guess between its units", () => {
    expect(read("My LDL cholesterol is 3.1 mmol/L today")).toMatchObject([{ biomarkerId: "ldl", value: 3.1, originalUnit: "mmol/L" }]);
    expect(read("My LDL cholesterol is 3.1 today")).toEqual([]);
  });

  it.each([
    "If I'm 102kg and 27% body fat, what would that mean?",
    "Example: \"I'm 102kg. I'm 27% body fat.\"",
    "> I'm 102kg",
    "My brother is 102kg and 27% body fat",
    "I lift weights, 102kg",
    "I lift 102kg",
    "I have 27 kg body fat",
    "I'm 27% body fat?",
    "I'm 102kg. Don't save this",
    "I was 102kg yesterday",
    "My target weight is 102kg",
    "I'm 102kg last year",
    "My report says I'm 102kg",
    "My BMI is 27 today",
  ])("does not save a hypothetical, non-current, unrelated or derived value in %s", (text) => {
    expect(read(text)).toEqual([]);
  });

  it("rejects implausible and conflicting readings without discarding an independent valid field", () => {
    expect(read("I weigh 999kg and my body fat is 27%")).toMatchObject([{ biomarkerId: "body_fat", value: 27 }]);
    expect(read("I'm 27% body fat. My body fat is 29%")).toEqual([]);
    expect(read("im 27,5% body fat")).toMatchObject([{ biomarkerId: "body_fat", value: 27.5 }]);
  });

  it("requires a complete and correctly ordered blood-pressure pair", () => {
    const top = `My ${systolic.name} is 120 mmHg`;
    const bottom = `My ${diastolic.name} is 80 mmHg`;
    expect(read(top)).toEqual([]);
    expect(read(`${top}. ${bottom}`).map(({ biomarkerId, value }) => ({ biomarkerId, value }))).toEqual([
      { biomarkerId: "bp_systolic", value: 120 }, { biomarkerId: "bp_diastolic", value: 80 },
    ]);
    expect(read(`My ${systolic.name} is 80 mmHg. My ${diastolic.name} is 120 mmHg`)).toEqual([]);
  });
});
