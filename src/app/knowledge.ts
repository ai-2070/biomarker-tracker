import { TOPICS, validateComparisonTopic, type ComparisonTopicFile } from "../core/foodComparison";
import { validateFitnessTest, type FitnessTestDef } from "../core/fitnessTests";
import { validateNutrientDef, type NutrientDef } from "../core/nutrients";
import { validateEvidenceClaim } from "../core/evidence";
import { validateBiomarkerDef } from "../core/knowledge";
import type { BiomarkerCategory, BiomarkerDef, EvidenceClaim, FoodTable } from "../core/types";
import foodTable from "../../knowledge/foods/cofid-foods.json";
import { lowerFirst } from "./format";
import { validateLifestyleDef, type LifestyleDef } from "../core/lifestyle";
import { validateWholeFoodDef, type WholeFoodDef } from "../core/wholeFoods";

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
  "Aging",
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

// Lifestyle (walking, sauna, red light, sleep, cold water…): research-based, with visuals from the studies.
const lifestyleModules = import.meta.glob<unknown>("../../knowledge/lifestyle/*.json", { eager: true, import: "default" });
export const LIFESTYLE: readonly LifestyleDef[] = Object.entries(lifestyleModules)
  .filter(([path, json]) => {
    const errors = validateLifestyleDef(json);
    if (errors.length > 0) console.error(`Invalid knowledge file ${path}:`, errors);
    return errors.length === 0;
  })
  .map(([, json]) => json as LifestyleDef)
  .sort((a, b) => a.name.localeCompare(b.name));
export const LIFESTYLE_MAP: ReadonlyMap<string, LifestyleDef> = new Map(LIFESTYLE.map((l) => [l.id, l]));

// Whole foods (olive oil, blueberries, ginger…): research on eating the food itself.
const wholeFoodModules = import.meta.glob<unknown>("../../knowledge/wholefoods/*.json", { eager: true, import: "default" });
export const WHOLE_FOODS: readonly WholeFoodDef[] = Object.entries(wholeFoodModules)
  .filter(([path, json]) => {
    const errors = validateWholeFoodDef(json);
    if (errors.length > 0) console.error(`Invalid knowledge file ${path}:`, errors);
    return errors.length === 0;
  })
  .map(([, json]) => json as WholeFoodDef)
  .sort((a, b) => a.name.localeCompare(b.name));
export const WHOLE_FOOD_MAP: ReadonlyMap<string, WholeFoodDef> = new Map(WHOLE_FOODS.map((f) => [f.id, f]));
export const NUTRIENT_MAP: ReadonlyMap<string, NutrientDef> = new Map(NUTRIENTS.map((n) => [n.id, n]));

// Fitness tests with norms for age and sex (Body page, Biological age page), one file per test.
const fitnessModules = import.meta.glob<unknown>("../../knowledge/fitness/*.json", { eager: true, import: "default" });
export const FITNESS: readonly FitnessTestDef[] = Object.entries(fitnessModules).flatMap(([path, json]) => {
  const errors = validateFitnessTest(json);
  if (errors.length) {
    console.error(`Invalid knowledge file ${path}:`, errors);
    return [];
  }
  return [json as FitnessTestDef];
});
export const FITNESS_MAP: ReadonlyMap<string, FitnessTestDef> = new Map(FITNESS.map((t) => [t.id, t]));

// Animal foods, fruit and plants compared (Meals page), one file per topic.
const comparisonModules = import.meta.glob<unknown>("../../knowledge/food-comparison/*.json", { eager: true, import: "default" });

export const FOOD_COMPARISON: readonly ComparisonTopicFile[] = Object.entries(comparisonModules)
  .flatMap(([path, json]) => {
    const errors = validateComparisonTopic(json);
    if (errors.length) {
      console.error(`Invalid knowledge file ${path}:`, errors);
      return [];
    }
    return [json as ComparisonTopicFile];
  })
  .sort((a, b) => TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic));
