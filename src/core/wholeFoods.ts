import { visualErrors, type LifestyleVisual } from "./lifestyle";
import { PRESCRIBING, citationErrors, findingErrors, type NutrientFinding } from "./nutrients";
import type { Citation, SafetyId } from "./types";

/**
 * Whole foods (/knowledge/wholefoods/*.json), shown under Knowledge → Foods: extra virgin olive oil,
 * blueberries, strawberries, ginger, pomegranate… Research on eating the food itself, not on its
 * nutrients or compounds: a food holds thousands of compounds the food table doesn't track (nutritional
 * dark matter), and a study of people eating it captures all of them. Findings are graded, every number
 * is cited, and nothing is a personal amount or instruction.
 */

export type FoodGroup = "fruit" | "vegetables" | "oils and fats" | "herbs and spices" | "nuts and seeds" | "fish" | "legumes" | "grains" | "drinks" | "sweets";
export const FOOD_GROUPS: readonly FoodGroup[] = ["fruit", "vegetables", "oils and fats", "herbs and spices", "nuts and seeds", "fish", "legumes", "grains", "drinks", "sweets"];

export interface WholeFoodDef {
  id: string;
  name: string;
  group: FoodGroup;
  /** Other names and forms people search for: "EVOO", "pomegranate juice", "fresh ginger root". */
  otherNames: string[];
  /** Plain language, 1–3 sentences. */
  summary: string;
  /**
   * What's in it, in words: the compounds it's known for (polyphenols, anthocyanins, gingerols…), which of
   * them the food table measures and which it doesn't. Each point plain and cited in `sources`.
   */
  inIt: string[];
  /** Foods in the UK food table (CoFID ids) this page is about, with a labelled example portion for the measured nutrients. */
  tableFoods: { id: string; label: string; grams: number }[];
  /** What processing, storage or the form changes: extra virgin vs refined, juice vs whole fruit, fresh vs dried. */
  processing: string[];
  /** What the studies had people eat (describing studies, never advising): "about 50 g of olive oil a day in PREDIMED". */
  whatStudiesDid: string;
  /** Markers in this app it may move (for links and habit watches): "ldl", "bp_systolic"… */
  markers: string[];
  findings: NutrientFinding[];
  visuals: LifestyleVisual[];
  whoShouldBeCareful: { with: string; note: string; safetyId?: SafetyId }[];
  cautions: string[];
  /** What isn't known yet, said plainly. */
  unknowns: string[];
  sources: Citation[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const strList = (v: unknown, min = 0): boolean => Array.isArray(v) && v.length >= min && v.every(isStr);
const SAFETY_IDS = new Set(["anticoagulant", "diabetes", "pregnancy", "kidney"]);

/** Problems with a whole-food file; empty means valid. */
export function validateWholeFoodDef(v: unknown): string[] {
  if (!isObj(v)) return ["entry is not an object"];
  const errs: string[] = [];
  if (!isStr(v.id) || !/^[a-z0-9_]+$/.test(v.id)) errs.push("id must be lowercase_with_underscores");
  for (const k of ["name", "summary", "whatStudiesDid"] as const) if (!isStr(v[k])) errs.push(`${k} is required`);
  if (!FOOD_GROUPS.includes(v.group as FoodGroup)) errs.push(`group must be one of ${FOOD_GROUPS.join(", ")}`);
  if (!strList(v.otherNames)) errs.push("otherNames must be a list of strings");
  if (!strList(v.inIt, 1)) errs.push("inIt needs at least one point");
  if (!strList(v.processing)) errs.push("processing must be a list of strings");
  if (!Array.isArray(v.tableFoods) || !v.tableFoods.every((t) => isObj(t) && isStr(t.id) && isStr(t.label) && typeof t.grams === "number" && t.grams > 0 && t.grams <= 1000))
    errs.push("tableFoods need a CoFID id, a label and grams");
  if (!strList(v.markers)) errs.push("markers must be a list of marker ids");
  errs.push(...findingErrors(v.findings, "finding"));
  if (Array.isArray(v.findings) && v.findings.length === 0) errs.push("findings needs at least one finding");
  if (!Array.isArray(v.visuals) || v.visuals.length === 0) errs.push("visuals needs at least one visual");
  else (v.visuals as unknown[]).forEach((x, i) => errs.push(...visualErrors(x, `visual ${i + 1}`)));
  if (!Array.isArray(v.whoShouldBeCareful) || !v.whoShouldBeCareful.every((x) => isObj(x) && isStr(x.with) && isStr(x.note) && (x.safetyId === undefined || SAFETY_IDS.has(String(x.safetyId)))))
    errs.push("whoShouldBeCareful needs with and note (and a known safetyId, if any)");
  if (!strList(v.cautions)) errs.push("cautions must be a list of strings");
  if (!strList(v.unknowns, 1)) errs.push("unknowns needs at least one point: say what isn't known");
  errs.push(...citationErrors(v.sources, "sources"));
  return errs;
}

/** Every piece of text in a whole-food file, for the wording check (no personal instructions). */
export function wholeFoodText(f: WholeFoodDef): string[] {
  return [
    f.summary,
    f.whatStudiesDid,
    ...f.inIt,
    ...f.processing,
    ...f.findings.flatMap((x) => [x.outcome, x.population, x.summary, x.bottomLine ?? "", ...x.whyThisGrade]),
    ...f.visuals.flatMap((x) => [x.title, x.caption]),
    ...f.whoShouldBeCareful.flatMap((x) => [x.with, x.note]),
    ...f.cautions,
    ...f.unknowns,
  ];
}

export const wholeFoodPrescribes = (f: WholeFoodDef): string[] => wholeFoodText(f).filter((t) => PRESCRIBING.test(t));

/**
 * The whole-food page a protocol item is about, by name or other name ("Extra virgin olive oil",
 * "EVOO 2 tbsp" → olive oil; "Blueberries"). Every word of the food's name must appear in the item.
 */
export function wholeFoodFor(label: string, foods: readonly WholeFoodDef[]): WholeFoodDef | undefined {
  const words = (s: string) => ` ${s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const item = words(label);
  const names = foods
    .flatMap((f) => [f.name, ...f.otherNames].map((n) => ({ f, n: words(n).trim() })))
    .filter((x) => x.n.length >= 3)
    .sort((a, b) => b.n.length - a.n.length);
  return names.find(({ n }) => n.split(" ").every((w) => item.includes(` ${w} `) || item.includes(` ${w}s `)))?.f;
}
