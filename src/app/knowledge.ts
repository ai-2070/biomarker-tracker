import { validateNutrientDef, type NutrientDef } from "../core/nutrients";
import { validateEvidenceClaim } from "../core/evidence";
import { validateBiomarkerDef } from "../core/knowledge";
import type { BiomarkerCategory, BiomarkerDef, EvidenceClaim, FoodTable } from "../core/types";
import foodTable from "../../knowledge/foods/cofid-foods.json";
import { lowerFirst } from "./format";

// Bundled at build time; nothing is fetched at runtime.
const modules = import.meta.glob<unknown>("../../knowledge/biomarkers/*.json", { eager: true, import: "default" });

function load(): BiomarkerDef[] {
  const out: BiomarkerDef[] = [];
  for (const [path, json] of Object.entries(modules)) {
    const errors = validateBiomarkerDef(json);
    if (errors.length > 0) {
      // Tests catch this before release; skip the entry rather than crash the app.
      console.error(`Invalid knowledge file ${path}:`, errors);
      continue;
    }
    out.push(json as BiomarkerDef);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const BIOMARKERS: readonly BiomarkerDef[] = load();
export const BIOMARKER_MAP: ReadonlyMap<string, BiomarkerDef> = new Map(BIOMARKERS.map((d) => [d.id, d]));

export const CATEGORY_ORDER: readonly BiomarkerCategory[] = [
  "Blood count",
  "Metabolic",
  "Lipids",
  "Kidney",
  "Liver",
  "Thyroid",
  "Iron & vitamins",
  "Electrolytes",
  "Inflammation",
  "Body",
];

/** Body measurements (weight, waist, blood pressure…) are markers too, but not blood tests. */
export const isBodyMarker = (def: BiomarkerDef): boolean => def.category === "Body";
export const BLOOD_MARKERS: readonly BiomarkerDef[] = BIOMARKERS.filter((d) => !isBodyMarker(d));
export const BODY_MARKERS: readonly BiomarkerDef[] = BIOMARKERS.filter(isBodyMarker);
/** Only blood test results (or only body measurements) of a list. */
export const bloodOnly = <T extends { biomarkerId: string }>(ms: readonly T[]): T[] => ms.filter((m) => BIOMARKER_MAP.get(m.biomarkerId)?.category !== "Body");
export const bodyOnly = <T extends { biomarkerId: string }>(ms: readonly T[]): T[] => ms.filter((m) => BIOMARKER_MAP.get(m.biomarkerId)?.category === "Body");

/** "Haemoglobin A1c (HbA1c)" — full name with the abbreviation explained once. */
export function fullName(def: BiomarkerDef): string {
  return def.abbreviation ? `${def.name} (${def.abbreviation})` : def.name;
}

/**
 * The name for use inside a sentence: "ferritin", "vitamin D (25-OH)", but
 * "LDL cholesterol" and "C-reactive protein" keep their capitals.
 */
export function nameInSentence(def: BiomarkerDef): string {
  return lowerFirst(def.name);
}

/** Short label for lists: the abbreviation when there is one. */
export function shortName(def: BiomarkerDef): string {
  return def.abbreviation ?? def.name;
}

// Evidence claims and food composition data (bundled, nothing fetched)

const evidenceModules = import.meta.glob<unknown>("../../knowledge/evidence/*.json", { eager: true, import: "default" });

function loadEvidence(): EvidenceClaim[] {
  const out: EvidenceClaim[] = [];
  for (const [path, json] of Object.entries(evidenceModules)) {
    const errors = validateEvidenceClaim(json);
    if (errors.length > 0) {
      console.error(`Invalid evidence file ${path}:`, errors);
      continue;
    }
    out.push(json as EvidenceClaim);
  }
  return out;
}

export const EVIDENCE: readonly EvidenceClaim[] = loadEvidence();
export const FOODS: FoodTable = foodTable as FoodTable;

// Vitamins and minerals (Supplementation): research-based, bundled like the markers.
const nutrientModules = import.meta.glob<unknown>("../../knowledge/nutrients/*.json", { eager: true, import: "default" });

function loadNutrients(): NutrientDef[] {
  const out: NutrientDef[] = [];
  for (const [path, json] of Object.entries(nutrientModules)) {
    const errors = validateNutrientDef(json);
    if (errors.length > 0) {
      console.error(`Invalid knowledge file ${path}:`, errors);
      continue;
    }
    out.push(json as NutrientDef);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

export const NUTRIENTS: readonly NutrientDef[] = loadNutrients();
export const NUTRIENT_MAP: ReadonlyMap<string, NutrientDef> = new Map(NUTRIENTS.map((n) => [n.id, n]));
