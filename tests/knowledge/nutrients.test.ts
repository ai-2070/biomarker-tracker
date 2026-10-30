import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRESCRIBING, nutrientText, searchNutrients, validateNutrientDef, type NutrientDef } from "../../src/core/nutrients";
import type { FoodTable } from "../../src/core/types";
import { loadDefs } from "../helpers";

const ROOT = join(import.meta.dirname, "..", "..", "knowledge");
const DIR = join(ROOT, "nutrients");
const files = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .map((file) => ({ file, json: JSON.parse(readFileSync(join(DIR, file), "utf8")) as unknown }))
  : [];
const nutrients = files.map((f) => f.json as NutrientDef);
const defs = loadDefs();
const foods = JSON.parse(readFileSync(join(ROOT, "foods", "cofid-foods.json"), "utf8")) as FoodTable;
const claimIds = new Set(readdirSync(join(ROOT, "evidence")).map((f) => f.replace(/\.json$/, "")));

describe("knowledge base: vitamins and minerals", () => {
  it.each(files)("$file is valid", ({ file, json }) => {
    expect(validateNutrientDef(json)).toEqual([]);
    expect(`${(json as NutrientDef).id}.json`).toBe(file);
  });

  it("links only to markers, evidence claims and food nutrients that exist", () => {
    for (const n of nutrients) {
      for (const id of n.status.biomarkerIds) expect(defs.has(id), `${n.id} -> marker ${id}`).toBe(true);
      for (const id of n.evidenceClaims) expect(claimIds.has(id), `${n.id} -> claim ${id}`).toBe(true);
      if (n.foodSources.cofidNutrient) expect(foods.nutrients[n.foodSources.cofidNutrient], `${n.id} -> food nutrient`).toBeDefined();
    }
  });

  it("never words general information as personal advice", () => {
    for (const n of nutrients) for (const t of nutrientText(n)) expect(PRESCRIBING.test(t), `${n.id}: "${t}"`).toBe(false);
  });

  it("explains every upper limit and every finding's grade", () => {
    for (const n of nutrients) {
      expect(n.reference.upperLimit?.note ?? n.reference.noUpperLimit, n.id).toBeTruthy();
      for (const f of n.findings) expect(f.whyThisGrade.length, `${n.id}: ${f.outcome}`).toBeGreaterThan(0);
    }
  });

  it("gives every finding a bottom line, shown first on the page", () => {
    for (const n of nutrients) for (const f of [...n.findings, ...(n.foodFindings ?? [])]) { expect(f.bottomLine, `${n.id}: ${f.outcome}`).toBeTruthy(); expect(f.label && f.line, `${n.id}: ${f.outcome} needs a label and a line`).toBeTruthy(); }
  });

  it("finds the obvious entries when searched", () => {
    const ids = (q: string) => searchNutrients(nutrients, q).map((x) => x.n.id);
    expect(ids("vitamin d")[0]).toBe("vitamin_d");
    expect(ids("b12")[0]).toBe("vitamin_b12");
    expect(ids("warfarin")).toContain("vitamin_k");
    expect(ids("salmon").length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    expect(new Set(nutrients.map((n) => n.id)).size).toBe(nutrients.length);
  });

  it("rejects files without sources or with personal doses", () => {
    expect(validateNutrientDef({})).not.toEqual([]);
    expect(PRESCRIBING.test("You should take 1000 IU a day")).toBe(true);
    expect(PRESCRIBING.test("Trials used 800–1000 IU a day")).toBe(false);
  });
});
