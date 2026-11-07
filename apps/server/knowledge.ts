// The knowledge base, read from disk once (the page bundles the same files with Vite).
import fs from "node:fs";
import path from "node:path";
import { validateEvidenceClaim } from "@bt/shared/core/evidence";
import { type FitnessTestDef, validateFitnessTest } from "@bt/shared/core/fitnessTests";
import { validateBiomarkerDef } from "@bt/shared/core/knowledge";
import { type LifestyleDef, validateLifestyleDef } from "@bt/shared/core/lifestyle";
import { type LifeTableFile, validateLifeTables } from "@bt/shared/core/lifeTable";
import type { FoodDb } from "@bt/shared/core/meals";
import { type MortalityModelFile, validateMortalityModels } from "@bt/shared/core/mortalityModel";
import { type NutrientDef, validateNutrientDef } from "@bt/shared/core/nutrients";
import type { BiomarkerDef, EvidenceClaim, FoodTable } from "@bt/shared/core/types";
import { validateWholeFoodDef, type WholeFoodDef, wholeFoodFor } from "@bt/shared/core/wholeFoods";
import { ROOT } from "./store";

let tables: LifeTableFile | null | undefined;
/** Official country life tables, read once; invalid or missing files fail closed. */
export function lifeTables(): LifeTableFile | undefined {
  if (tables === undefined) {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "lifetables", "countries.json"), "utf8"));
      tables = validateLifeTables(value).length === 0 ? (value as LifeTableFile) : null;
    } catch {
      tables = null;
    }
  }
  return tables ?? undefined;
}
let mortality: MortalityModelFile | null | undefined;
/** Offline-fitted public-cohort coefficients. Invalid/missing files never become guessed parameters. */
export function mortalityModels(): MortalityModelFile | undefined {
  if (mortality === undefined) {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, "knowledge", "models", "mortality.json"), "utf8"));
      mortality = validateMortalityModels(value).length === 0 ? (value as MortalityModelFile) : null;
    } catch {
      mortality = null;
    }
  }
  return mortality ?? undefined;
}

function readAll(dir: string): unknown[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as unknown);
}

let cache:
  | {
      defs: Map<string, BiomarkerDef>;
      evidence: EvidenceClaim[];
      foods: FoodTable;
      nutrients: NutrientDef[];
      fitness: FitnessTestDef[];
      lifestyle: LifestyleDef[];
      wholeFoods: WholeFoodDef[];
    }
  | undefined;

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
    const ldir = path.join(k, "lifestyle");
    const lifestyle = (fs.existsSync(ldir) ? readAll(ldir) : []).filter((j) => validateLifestyleDef(j).length === 0) as LifestyleDef[];
    const wdir = path.join(k, "wholefoods");
    const wholeFoods = (fs.existsSync(wdir) ? readAll(wdir) : []).filter((j) => validateWholeFoodDef(j).length === 0) as WholeFoodDef[];
    cache = { defs, evidence, foods, nutrients, fitness, lifestyle, wholeFoods };
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
  const q = query
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const words = query.trim().toLowerCase();
  return knowledge().nutrients.find((n) => n.id === q || n.name.toLowerCase() === words || n.otherNames.some((o) => o.toLowerCase().startsWith(words)));
}

/** Find a lifestyle topic by id, name or other name ("sauna", "daily steps", "cold shower"). */
export function findLifestyle(query: string): LifestyleDef | undefined {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const words = query.trim().toLowerCase();
  return knowledge().lifestyle.find(
    (l) =>
      l.id === q || l.name.toLowerCase() === words || l.name.toLowerCase().startsWith(words) || l.otherNames.some((o) => o.toLowerCase().startsWith(words)),
  );
}

/** Find a whole food by id, name or other name ("evoo", "olive oil", "pomegranate juice"). */
export function findWholeFood(query: string): WholeFoodDef | undefined {
  const all = knowledge().wholeFoods;
  return (
    all.find(
      (f) =>
        f.id ===
        query
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_"),
    ) ?? wholeFoodFor(query, all)
  );
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
