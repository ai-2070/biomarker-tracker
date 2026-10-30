import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FoodDb } from "../../src/core/meals";
import { validateWholeFoodDef, wholeFoodFor, wholeFoodPrescribes, type WholeFoodDef } from "../../src/core/wholeFoods";
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
      for (const x of f.findings) expect(x.bottomLine, `${f.id}: ${x.outcome}`).toBeTruthy();
      for (const v of f.visuals) expect(v.sources.length, `${f.id}: ${v.title}`).toBeGreaterThan(0);
    }
  });

  it("every food's own name leads back to its page", () => {
    for (const f of entries) expect(wholeFoodFor(f.name, entries)?.id, f.id).toBe(f.id);
  });
});

describe("whole foods: linking protocol items", () => {
  const base = { group: "fruit", summary: "S", inIt: ["I"], tableFoods: [], processing: [], whatStudiesDid: "W", markers: [], findings: [], visuals: [], whoShouldBeCareful: [], cautions: [], unknowns: ["U"], sources: [] };
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
  });
});
