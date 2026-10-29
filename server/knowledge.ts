// The knowledge base, read from disk once (the page bundles the same files with Vite).
import fs from "node:fs";
import path from "node:path";
import { validateEvidenceClaim } from "../src/core/evidence";
import { validateBiomarkerDef } from "../src/core/knowledge";
import { validateFitnessTest, type FitnessTestDef } from "../src/core/fitnessTests";
import { validateNutrientDef, type NutrientDef } from "../src/core/nutrients";
import type { FoodDb } from "../src/core/meals";
import type { BiomarkerDef, EvidenceClaim, FoodTable } from "../src/core/types";
import { ROOT } from "./store";
import type { LifeTableFile } from "../src/core/lifeTable";

let tables: LifeTableFile | null | undefined;
/** Eurostat life tables (knowledge/lifetables), read once; null when the file is missing. */
export function lifeTables(): LifeTableFile | undefined {
  if (tables === undefined) {
    try {
      tables = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "lifetables", "eurostat.json"), "utf8")) as LifeTableFile;
    } catch {
      tables = null;
    }
  }
  return tables ?? undefined;
}

function readAll(dir: string): unknown[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as unknown);
}

let cache: { defs: Map<string, BiomarkerDef>; evidence: EvidenceClaim[]; foods: FoodTable; nutrients: NutrientDef[]; fitness: FitnessTestDef[] } | undefined;

export function knowledge() {
  if (!cache) {
    const k = path.join(ROOT, "knowledge");
    const defs = new Map<string, BiomarkerDef>();
    for (const j of readAll(path.join(k, "biomarkers"))) if (validateBiomarkerDef(j).length === 0) defs.set((j as BiomarkerDef).id, j as BiomarkerDef);
    const evidence = readAll(path.join(k, "evidence")).filter((j) => validateEvidenceClaim(j).length === 0) as EvidenceClaim[];
    const foods = JSON.parse(fs.readFileSync(path.join(k, "foods", "cofid-foods.json"), "utf8")) as FoodTable;
    const dir = path.join(k, "nutrients");
    const nutrients = (fs.existsSync(dir) ? readAll(dir) : []).filter((j) => validateNutrientDef(j).length === 0) as NutrientDef[];
    const fdir = path.join(k, "fitness");
    const fitness = (fs.existsSync(fdir) ? readAll(fdir) : []).filter((j) => validateFitnessTest(j).length === 0) as FitnessTestDef[];
    cache = { defs, evidence, foods, nutrients, fitness };
  }
  return cache;
}

let foodDb: FoodDb | undefined;
/** The full food table (every CoFID 2021 food), read on first use. */
export function foods(): FoodDb {
  foodDb ??= JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "foods", "cofid-all.json"), "utf8")) as FoodDb;
  return foodDb;
}

/** Find a vitamin or mineral by id, name or other name (case-insensitive; "vitamin d", "cobalamin"). */
export function findNutrient(query: string): NutrientDef | undefined {
  const q = query.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const words = query.trim().toLowerCase();
  return knowledge().nutrients.find((n) => n.id === q || n.name.toLowerCase() === words || n.otherNames.some((o) => o.toLowerCase().startsWith(words)));
}

/** Find a marker by id, name, abbreviation or any alias (case-insensitive). */
export function findMarker(query: string): BiomarkerDef | undefined {
  const q = query.trim().toLowerCase();
  const { defs } = knowledge();
  if (defs.has(q)) return defs.get(q);
  for (const d of defs.values()) {
    if ([d.name, d.abbreviation ?? "", ...d.aliases].some((a) => a.toLowerCase() === q)) return d;
  }
  return undefined;
}
