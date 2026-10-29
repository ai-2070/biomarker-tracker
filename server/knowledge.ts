// The knowledge base, read from disk once (the page bundles the same files with Vite).
import fs from "node:fs";
import path from "node:path";
import { validateEvidenceClaim } from "../src/core/evidence";
import { validateBiomarkerDef } from "../src/core/knowledge";
import { validateNutrientDef, type NutrientDef } from "../src/core/nutrients";
import type { BiomarkerDef, EvidenceClaim, FoodTable } from "../src/core/types";
import { ROOT } from "./store";

function readAll(dir: string): unknown[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as unknown);
}

let cache: { defs: Map<string, BiomarkerDef>; evidence: EvidenceClaim[]; foods: FoodTable; nutrients: NutrientDef[] } | undefined;

export function knowledge() {
  if (!cache) {
    const k = path.join(ROOT, "knowledge");
    const defs = new Map<string, BiomarkerDef>();
    for (const j of readAll(path.join(k, "biomarkers"))) if (validateBiomarkerDef(j).length === 0) defs.set((j as BiomarkerDef).id, j as BiomarkerDef);
    const evidence = readAll(path.join(k, "evidence")).filter((j) => validateEvidenceClaim(j).length === 0) as EvidenceClaim[];
    const foods = JSON.parse(fs.readFileSync(path.join(k, "foods", "cofid-foods.json"), "utf8")) as FoodTable;
    const dir = path.join(k, "nutrients");
    const nutrients = (fs.existsSync(dir) ? readAll(dir) : []).filter((j) => validateNutrientDef(j).length === 0) as NutrientDef[];
    cache = { defs, evidence, foods, nutrients };
  }
  return cache;
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
