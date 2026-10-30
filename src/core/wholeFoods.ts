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

export type FoodGroup = "fruit" | "vegetables" | "oils and fats" | "herbs and spices" | "nuts and seeds" | "fish" | "eggs and dairy" | "legumes" | "grains" | "drinks" | "sweets";
export const FOOD_GROUPS: readonly FoodGroup[] = ["fruit", "vegetables", "oils and fats", "herbs and spices", "nuts and seeds", "fish", "eggs and dairy", "legumes", "grains", "drinks", "sweets"];

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
  /**
   * Then and now: what people in the past used the food for (Egyptian, Greek, Roman, Chinese, Ayurvedic
   * physicians…), each set against what modern studies found. Traditional use tested the whole food over
   * generations, so it can point at effects of compounds no table measures; it can also be wrong.
   */
  history?: HistoryUse[];
  /**
   * What people believed: myths, religion, symbols and folk beliefs (Persephone and the pomegranate seeds),
   * told as what a culture believed, with where it's written: an ancient text (linked) or scholarship.
   * Not scored against studies, except a health claim (long life), which gets a verdict like `history`.
   */
  lore?: Lore[];
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

/** What modern studies say about a traditional use. */
/** "harmful": the old use is documented to cause harm (honey for newborns, mad honey); the note says how. */
export type ModernVerdict = "agrees" | "partly" | "not tested" | "disagrees" | "harmful";
export const MODERN_VERDICTS: readonly ModernVerdict[] = ["agrees", "partly", "not tested", "disagrees", "harmful"];

export interface HistoryUse {
  /** Who and when: "Ancient Egypt (Ebers Papyrus, about 1550 BC)", "Ancient Greece (Hippocrates)". */
  who: string;
  /** What they used it for, plainly: "Honey on wounds and burns". */
  use: string;
  modern: ModernVerdict;
  /** The finding on this page the verdict rests on (its `outcome` text), when there is one. */
  finding?: string;
  /** One or two sentences: what modern studies found, or that nobody has tested it. */
  note: string;
  /** Where the historical use is documented (history-of-medicine papers, reviews of traditional use). */
  sources: Citation[];
}

/** Where a belief is written: an ancient or historical text (with a link to a translation) or scholarship. */
export interface LoreSource {
  title: string;
  /** "Homeric Hymn to Demeter", "Pliny the Elder", or a modern author. */
  author?: string;
  /** Year written, if known (negative for BC is avoided: say it in `when`). */
  when?: string;
  kind: "ancient text" | "scholarship";
  url?: string;
  doi?: string;
  pmid?: string;
}

export interface Lore {
  /** Who believed it, and when: "Ancient Greece (Homeric Hymn to Demeter, about 600 BC)". */
  who: string;
  /** The belief, told plainly as theirs: "Persephone ate pomegranate seeds in the underworld, so…". */
  belief: string;
  /** Optional context: what it meant, how far it spread, or that a popular modern claim isn't in old texts. */
  note?: string;
  /** Only for a health claim (long life, strength): what modern studies say, as in `history`. */
  modern?: ModernVerdict;
  finding?: string;
  sources: LoreSource[];
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
  if (v.lore !== undefined) {
    if (!Array.isArray(v.lore) || v.lore.length === 0) errs.push("lore, when given, needs at least one belief");
    else {
      const outcomes = new Set(Array.isArray(v.findings) ? (v.findings as unknown[]).flatMap((f) => (isObj(f) && isStr(f.outcome) ? [f.outcome] : [])) : []);
      (v.lore as unknown[]).forEach((l, i) => {
        const at = `lore ${i + 1}`;
        if (!isObj(l) || !isStr(l.who) || !isStr(l.belief)) return void errs.push(`${at} needs who and belief`);
        if (l.note !== undefined && !isStr(l.note)) errs.push(`${at} note must be text`);
        if (l.modern !== undefined && !MODERN_VERDICTS.includes(l.modern as ModernVerdict)) errs.push(`${at} modern must be one of ${MODERN_VERDICTS.join(", ")}`);
        if (l.finding !== undefined && !outcomes.has(String(l.finding))) errs.push(`${at} finding must be the outcome of a finding on this page`);
        if ((l.modern === "agrees" || l.modern === "disagrees") && l.finding === undefined) errs.push(`${at}: "${l.modern}" needs the finding it rests on`);
        if (!Array.isArray(l.sources) || l.sources.length === 0) errs.push(`${at} needs at least one source`);
        else
          for (const s of l.sources as unknown[]) {
            if (!isObj(s) || !isStr(s.title) || (s.kind !== "ancient text" && s.kind !== "scholarship")) errs.push(`${at}: every source needs a title and a kind (ancient text or scholarship)`);
            else if (!isStr(s.url) && !isStr(s.doi) && !isStr(s.pmid)) errs.push(`${at}: every source needs a link, a DOI or a PMID`);
            else if (isStr(s.url) && !/^https:\/\//.test(s.url)) errs.push(`${at}: links must be https`);
          }
      });
    }
  }
  if (v.history !== undefined) {
    if (!Array.isArray(v.history) || v.history.length === 0) errs.push("history, when given, needs at least one use");
    else {
      const outcomes = new Set(Array.isArray(v.findings) ? (v.findings as unknown[]).flatMap((f) => (isObj(f) && isStr(f.outcome) ? [f.outcome] : [])) : []);
      (v.history as unknown[]).forEach((h, i) => {
        const at = `history ${i + 1}`;
        if (!isObj(h) || !isStr(h.who) || !isStr(h.use) || !isStr(h.note)) return void errs.push(`${at} needs who, use and note`);
        if (!MODERN_VERDICTS.includes(h.modern as ModernVerdict)) errs.push(`${at} modern must be one of ${MODERN_VERDICTS.join(", ")}`);
        if (h.finding !== undefined && !outcomes.has(String(h.finding))) errs.push(`${at} finding must be the outcome of a finding on this page`);
        if ((h.modern === "agrees" || h.modern === "disagrees") && h.finding === undefined) errs.push(`${at}: "${h.modern}" needs the finding it rests on`);
        errs.push(...citationErrors(h.sources, at));
      });
    }
  }
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
    ...(f.history ?? []).flatMap((h) => [h.use, h.note]),
    ...(f.lore ?? []).flatMap((l) => [l.belief, l.note ?? ""]),
    ...f.processing,
    ...f.findings.flatMap((x) => [x.outcome, x.population, x.summary, x.bottomLine ?? "", x.label ?? "", x.line ?? "", ...x.whyThisGrade]),
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
  // "Egg-free diet", "No honey", "Sugar-free": about leaving the food out, not eating it.
  if (/ (free|no|without|avoid|avoiding|less|cut|skip) /.test(item)) return undefined;
  const names = foods
    .flatMap((f) => [f.name, ...f.otherNames].map((n) => ({ f, n: words(n).trim() })))
    .filter((x) => x.n.length >= 3)
    .sort((a, b) => b.n.length - a.n.length);
  return names.find(({ n }) => n.split(" ").every((w) => item.includes(` ${w} `) || item.includes(` ${w}s `)))?.f;
}
