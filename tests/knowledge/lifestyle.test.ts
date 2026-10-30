import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prescribes, validateLifestyleDef, type LifestyleDef } from "../../src/core/lifestyle";
import { loadDefs } from "../helpers";

const DIR = join(import.meta.dirname, "..", "..", "knowledge", "lifestyle");
const files = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .map((file) => ({ file, json: JSON.parse(readFileSync(join(DIR, file), "utf8")) as unknown }))
  : [];
const entries = files.map((f) => f.json as LifestyleDef);
const defs = loadDefs();

describe("knowledge base: lifestyle", () => {
  it.each(files)("$file is valid", ({ file, json }) => {
    expect(validateLifestyleDef(json)).toEqual([]);
    expect(`${(json as LifestyleDef).id}.json`).toBe(file);
  });

  it("links only to markers that exist", () => {
    for (const l of entries) for (const id of l.markers) expect(defs.has(id), `${l.id} -> ${id}`).toBe(true);
  });

  it("never words general information as personal advice", () => {
    for (const l of entries) expect(prescribes(l), l.id).toEqual([]);
  });

  it("gives every finding a bottom line, and every visual a source", () => {
    for (const l of entries) {
      for (const f of l.findings) { expect(f.bottomLine, `${l.id}: ${f.outcome}`).toBeTruthy(); expect(f.label && f.line, `${l.id}: ${f.outcome} needs a label and a line`).toBeTruthy(); }
      for (const v of l.visuals) expect(v.sources.length, `${l.id}: ${v.title}`).toBeGreaterThan(0);
    }
  });

  it("rejects a visual without numbers that fit", () => {
    const base = { title: "T", caption: "C", sources: [{ pmid: "1", title: "S", year: 2020, studyType: "review" }] };
    const entry = (visual: unknown) => ({ id: "x", name: "X", category: "movement", otherNames: [], summary: "S", howItWorks: ["H"], whatStudiesDid: "W", markers: [], findings: [{ outcome: "O", population: "P", effect: "helps", grade: "low", whyThisGrade: ["w"], summary: "S", studies: base.sources }], visuals: [visual], whoShouldBeCareful: [], cautions: [], unknowns: ["U"], sources: base.sources });
    expect(validateLifestyleDef(entry({ ...base, kind: "bars", scale: "ratio", items: [{ label: "a", value: 1 }, { label: "b", value: 0.6, low: 0.7, high: 0.8 }] }))).toContain("visual 1: an interval must contain its value");
    expect(validateLifestyleDef(entry({ ...base, kind: "spectrum", from: 600, to: 900, bands: [], marks: [{ nm: 1000, label: "x" }] }))).toContain("visual 1: marks need a wavelength inside the range and a label");
    expect(validateLifestyleDef(entry({ ...base, kind: "flow", steps: [{ label: "a", text: "b" }, { label: "c", text: "d" }] }))).toEqual([]);
    // Not a habit (sleep): needs a marker to link to instead.
    const flow = { ...base, kind: "flow", steps: [{ label: "a", text: "b" }, { label: "c", text: "d" }] };
    expect(validateLifestyleDef({ ...entry(flow), asHabit: false })).toContain("an entry that isn't a habit needs a marker to link to");
    expect(validateLifestyleDef({ ...entry(flow), asHabit: false, markers: ["sleep_duration"] })).toEqual([]);
  });
});
