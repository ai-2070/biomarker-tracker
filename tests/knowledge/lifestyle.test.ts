import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type LifestyleDef, prescribes, validateLifestyleDef } from "@bt/shared/core/lifestyle";
import { describe, expect, it } from "vitest";
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
      for (const f of l.findings) {
        expect(f.bottomLine, `${l.id}: ${f.outcome}`).toBeTruthy();
        expect(f.label && f.line, `${l.id}: ${f.outcome} needs a label and a line`).toBeTruthy();
      }
      for (const v of l.visuals) expect(v.sources.length, `${l.id}: ${v.title}`).toBeGreaterThan(0);
    }
  });

  it("rejects a visual without numbers that fit", () => {
    const base = { title: "T", caption: "C", sources: [{ pmid: "1", title: "S", year: 2020, studyType: "review" }] };
    const flow0 = {
      ...base,
      kind: "flow",
      steps: [
        { label: "a", text: "b" },
        { label: "c", text: "d" },
      ],
    };
    const entry = (visual: unknown) => ({
      id: "x",
      name: "X",
      category: "movement",
      otherNames: [],
      summary: "S",
      howItWorks: ["H"],
      whatStudiesDid: "W",
      markers: [],
      claims: [
        { claim: "It helps one thing", topic: "one thing", label: "One thing", category: "health" },
        { claim: "It helps another thing", topic: "another thing", label: "Another thing", category: "health" },
        { claim: "It helps a third thing", topic: "a third thing", label: "Third thing", category: "longevity" },
      ],
      findings: [{ outcome: "O", population: "P", effect: "helps", grade: "low", whyThisGrade: ["w"], summary: "S", studies: base.sources }],
      visuals: [visual],
      whoShouldBeCareful: [],
      cautions: [],
      unknowns: ["U"],
      sources: base.sources,
    });
    expect(
      validateLifestyleDef(
        entry({
          ...base,
          kind: "bars",
          scale: "ratio",
          items: [
            { label: "a", value: 1 },
            { label: "b", value: 0.6, low: 0.7, high: 0.8 },
          ],
        }),
      ),
    ).toContain("visual 1: an interval must contain its value");
    expect(validateLifestyleDef(entry({ ...base, kind: "spectrum", from: 600, to: 900, bands: [], marks: [{ nm: 1000, label: "x" }] }))).toContain(
      "visual 1: marks need a wavelength inside the range and a label",
    );
    expect(
      validateLifestyleDef(
        entry({
          ...base,
          kind: "flow",
          steps: [
            { label: "a", text: "b" },
            { label: "c", text: "d" },
          ],
        }),
      ),
    ).toEqual([]);
    // Common claims: at least 3, plain topics, unique.
    const withClaims = (claims: unknown) => ({ ...entry({ ...flow0 }), claims });
    expect(validateLifestyleDef(withClaims([]))).toContain("claims needs at least 3 common claims");
    const c = (claim: string, topic = "a topic") => ({ claim, topic, label: "Label", category: "health" });
    expect(validateLifestyleDef(withClaims([c("a"), c("a"), c("b")]))).toContain("duplicate claim: a");
    expect(validateLifestyleDef(withClaims([c("a", "50% more"), c("b"), c("c")]))).toContain("claim topic is not a plain public topic: 50% more");
    // Not a habit (sleep): needs a marker to link to instead.
    const flow = {
      ...base,
      kind: "flow",
      steps: [
        { label: "a", text: "b" },
        { label: "c", text: "d" },
      ],
    };
    expect(validateLifestyleDef({ ...entry(flow), asHabit: false })).toContain("an entry that isn't a habit needs a marker to link to");
    expect(validateLifestyleDef({ ...entry(flow), asHabit: false, markers: ["sleep_duration"] })).toEqual([]);
  });
});
