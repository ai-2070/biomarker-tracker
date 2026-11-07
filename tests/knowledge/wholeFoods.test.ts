import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FoodDb } from "@bt/shared/core/meals";
import { validateWholeFoodDef, type WholeFoodDef, wholeFoodFor, wholeFoodPrescribes } from "@bt/shared/core/wholeFoods";
import { describe, expect, it } from "vitest";
import { loadDefs } from "../helpers";

const K = join(import.meta.dirname, "..", "..", "knowledge");
const DIR = join(K, "wholefoods");
const files = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .map((file) => ({ file, json: JSON.parse(readFileSync(join(DIR, file), "utf8")) as unknown }))
  : [];
const entries = files.map((f) => f.json as WholeFoodDef);
const defs = loadDefs();
const db = JSON.parse(readFileSync(join(K, "foods", "cofid-all.json"), "utf8")) as FoodDb;
const cofid = new Set(db.foods.map((f) => f[0]));

describe("knowledge base: whole foods", () => {
  it.each(files)("$file is valid", ({ file, json }) => {
    expect(validateWholeFoodDef(json)).toEqual([]);
    expect(`${(json as WholeFoodDef).id}.json`).toBe(file);
  });

  it("links only to markers and food-table foods that exist", () => {
    for (const f of entries) {
      for (const id of f.markers) expect(defs.has(id), `${f.id} -> ${id}`).toBe(true);
      for (const t of f.tableFoods) expect(cofid.has(t.id), `${f.id} -> CoFID ${t.id}`).toBe(true);
    }
  });

  it("never words general information as personal advice", () => {
    for (const f of entries) expect(wholeFoodPrescribes(f), f.id).toEqual([]);
  });

  it("gives every finding a bottom line, and every visual a source", () => {
    for (const f of entries) {
      for (const x of f.findings) {
        expect(x.bottomLine, `${f.id}: ${x.outcome}`).toBeTruthy();
        expect(x.label && x.line, `${f.id}: ${x.outcome} needs a label and a line`).toBeTruthy();
      }
      for (const v of f.visuals) expect(v.sources.length, `${f.id}: ${v.title}`).toBeGreaterThan(0);
    }
  });

  it("every food's own name leads back to its page", () => {
    for (const f of entries) expect(wholeFoodFor(f.name, entries)?.id, f.id).toBe(f.id);
  });
});

describe("whole foods: then and now", () => {
  const src = [{ pmid: "1", title: "A history of honey", year: 2020, studyType: "review" }];
  const finding = { outcome: "Burns", population: "P", effect: "helps", grade: "moderate", whyThisGrade: ["w"], summary: "S", studies: src };
  const entry = (history: unknown) => ({
    id: "x",
    name: "X",
    group: "sweets",
    otherNames: [],
    summary: "S",
    inIt: ["I"],
    tableFoods: [],
    processing: [],
    whatStudiesDid: "W",
    markers: [],
    findings: [finding],
    visuals: [
      {
        kind: "flow",
        title: "T",
        caption: "C",
        steps: [
          { label: "a", text: "b" },
          { label: "c", text: "d" },
        ],
        sources: src,
      },
    ],
    whoShouldBeCareful: [],
    cautions: [],
    unknowns: ["U"],
    sources: src,
    history,
  });

  it("checks each old use against a finding on the page, with a source", () => {
    expect(validateWholeFoodDef(entry([{ who: "Ancient Egypt", use: "On burns", modern: "agrees", finding: "Burns", note: "N", sources: src }]))).toEqual([]);
    expect(validateWholeFoodDef(entry([{ who: "Ancient Greece", use: "For coughs", modern: "not tested", note: "N", sources: src }]))).toEqual([]);
    // A harmful old use needs no finding: the note says what the harm is.
    expect(
      validateWholeFoodDef(entry([{ who: "Folk medicine", use: "Honey for newborns", modern: "harmful", note: "Infant botulism", sources: src }])),
    ).toEqual([]);
    expect(validateWholeFoodDef(entry([{ who: "W", use: "U", modern: "agrees", note: "N", sources: src }]))).toContain(
      'history 1: "agrees" needs the finding it rests on',
    );
    expect(validateWholeFoodDef(entry([{ who: "W", use: "U", modern: "partly", finding: "Nothing", note: "N", sources: src }]))).toContain(
      "history 1 finding must be the outcome of a finding on this page",
    );
    expect(validateWholeFoodDef(entry([{ who: "W", use: "U", modern: "maybe", note: "N", sources: src }]))[0]).toMatch(/modern must be one of/);
    expect(validateWholeFoodDef(entry([{ who: "W", use: "U", modern: "not tested", note: "N", sources: [] }]))).toContain(
      "history 1 needs at least one source",
    );
  });
});

describe("whole foods: what people believed", () => {
  const src = [{ pmid: "1", title: "A history of honey", year: 2020, studyType: "review" }];
  const finding = { outcome: "Death", population: "P", effect: "helps", grade: "low", whyThisGrade: ["w"], summary: "S", studies: src };
  const entry = (lore: unknown) => ({
    id: "x",
    name: "X",
    group: "fruit",
    otherNames: [],
    summary: "S",
    inIt: ["I"],
    tableFoods: [],
    processing: [],
    whatStudiesDid: "W",
    markers: [],
    findings: [finding],
    visuals: [
      {
        kind: "flow",
        title: "T",
        caption: "C",
        steps: [
          { label: "a", text: "b" },
          { label: "c", text: "d" },
        ],
        sources: src,
      },
    ],
    whoShouldBeCareful: [],
    cautions: [],
    unknowns: ["U"],
    sources: src,
    lore,
  });
  const hymn = { title: "Homeric Hymn to Demeter", kind: "ancient text", url: "https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0138" };

  it("tells a belief with where it's written, and scores only health claims", () => {
    expect(validateWholeFoodDef(entry([{ who: "Ancient Greece", belief: "Persephone ate the seeds", sources: [hymn] }]))).toEqual([]);
    expect(
      validateWholeFoodDef(entry([{ who: "W", belief: "It gives long life", modern: "not tested", note: "No study measured lifespan", sources: [hymn] }])),
    ).toEqual([]);
    expect(validateWholeFoodDef(entry([{ who: "W", belief: "B", sources: [{ title: "T", kind: "ancient text" }] }]))).toContain(
      "lore 1: every source needs a link, a DOI or a PMID",
    );
    expect(validateWholeFoodDef(entry([{ who: "W", belief: "B", sources: [{ ...hymn, url: "http://example.org" }] }]))).toContain(
      "lore 1: links must be https",
    );
    expect(validateWholeFoodDef(entry([{ who: "W", belief: "B", modern: "agrees", sources: [hymn] }]))).toContain(
      'lore 1: "agrees" needs the finding it rests on',
    );
  });
});

describe("whole foods: linking protocol items", () => {
  const base = {
    group: "fruit",
    summary: "S",
    inIt: ["I"],
    tableFoods: [],
    processing: [],
    whatStudiesDid: "W",
    markers: [],
    findings: [],
    visuals: [],
    whoShouldBeCareful: [],
    cautions: [],
    unknowns: ["U"],
    sources: [],
  };
  const foods = [
    { ...base, id: "evoo", name: "Extra virgin olive oil", otherNames: ["EVOO"] },
    { ...base, id: "blueberries", name: "Blueberries", otherNames: ["blueberry"] },
  ] as unknown as WholeFoodDef[];

  it("finds the food by its name or another name, in any item wording", () => {
    expect(wholeFoodFor("Extra virgin olive oil, 2 tbsp", foods)?.id).toBe("evoo");
    expect(wholeFoodFor("EVOO", foods)?.id).toBe("evoo");
    expect(wholeFoodFor("Frozen blueberries", foods)?.id).toBe("blueberries");
    expect(wholeFoodFor("Blueberry", foods)?.id).toBe("blueberries");
    expect(wholeFoodFor("Sunflower oil", foods)).toBeUndefined();
    // Leaving a food out isn't eating it.
    expect(wholeFoodFor("Blueberry-free week", foods)).toBeUndefined();
    expect(wholeFoodFor("No EVOO on salads", foods)).toBeUndefined();
  });
});
