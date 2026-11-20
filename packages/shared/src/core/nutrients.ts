import { CLAIM_CATEGORIES, type ClaimCategory } from "./claimEvidence";
import { isIsoDate } from "./dates";
import type { Citation, EvidenceGrade, SafetyId } from "./types";

/**
 * The vitamins and minerals knowledge base (/knowledge/nutrients/*.json), shown under Supplementation.
 * Research-based and general: what each nutrient does, how status is measured, who runs low, food
 * sources, supplement forms, what trials of supplements found (graded, cited), official EU reference
 * intakes and safe upper limits, and interactions. Never a personal dose (CLAUDE.md, principle 6).
 * Whole-food evidence and supplement evidence are kept apart (Nutrition rules).
 */

/**
 * Vitamins and minerals, and other supplements (omega-3, creatine, fibre, CoQ10…): those may have no
 * EFSA reference intake, because they aren't essential nutrients, and then say why (`noUpperLimit`
 * and the reference sources still explain EFSA's position).
 */
export type NutrientKind = "vitamin" | "mineral" | "supplement";
export const NUTRIENT_KINDS: readonly NutrientKind[] = ["vitamin", "mineral", "supplement"];
/** What a trial outcome showed for people taking the supplement. */
export type FindingEffect = "helps" | "no clear effect" | "harms" | "mixed";

export interface NutrientFinding {
  /** What was measured, plainly: "Bone fractures", "Blood level of 25-OH vitamin D". */
  outcome: string;
  /** Who was studied: "Older adults living at home, most not deficient". */
  population: string;
  effect: FindingEffect;
  grade: EvidenceGrade;
  whyThisGrade: string[];
  /** Plain-language summary, including the limits of the evidence. */
  summary: string;
  /**
   * The finding in one or two plain sentences (about 25-45 words): who, what happened, how much, and
   * the main limit. Shown first; the full summary and sources are one tap away. Written from the
   * summary only, adding nothing it doesn't say.
   */
  bottomLine?: string;
  /**
   * For "Main uses & benefits": a bold short name ("Heart attacks and strokes", "Cough in children") and
   * one plain line on what happened ("About 30% fewer in a large trial"), both written only from the
   * summary, no stronger than it. The grade is shown beside them.
   */
  label?: string;
  line?: string;
  studies: Citation[];
}

/** An official population reference value (EFSA): a guide for groups, never a personal dose. */
export interface ReferenceIntake {
  /** "Women", "Men", "Adults", "Pregnancy", "Breastfeeding". */
  group: string;
  amount: number;
  unit: "µg" | "mg" | "g";
  /** PRI: population reference intake; AI: adequate intake (when a PRI couldn't be set). */
  type: "PRI" | "AI";
}

/** Amounts of one ingredient in whole foods, set against the amounts that studies or safety reviews used. */
export interface FoodAmounts {
  /** Amounts to compare against, in mg a day (e.g. the amount EFSA assessed). May be empty when no food can supply the ingredient. */
  targets: { label: string; mg: number }[];
  /** mg per 100 g as [low, high] from a cited analysis; list only measured foods (may be empty). */
  foods: { name: string; mgPer100g: [number, number]; note?: string }[];
  /** Plain-language answer to "could you eat this every day?". */
  verdict: string;
  /** Foods the guide did not list because no cited amount was found. */
  notChecked?: string;
  sources: Citation[];
}

/** Grams of a food holding `mg` of the ingredient, given its mg per 100 g; rounded to the nearest 10 g. */
export function gramsForAmount(mg: number, mgPer100g: number): number {
  if (!(mg > 0) || !(mgPer100g > 0)) return NaN;
  return Math.round(((mg / mgPer100g) * 100) / 10) * 10;
}

export interface NutrientDef {
  id: string;
  name: string;
  kind: NutrientKind;
  /** Other names and the forms' chemical names: "cholecalciferol (D3)". */
  otherNames: string[];
  /** Plain language, 1–3 sentences. */
  summary: string;
  /** Basic guides defer efficacy review to on-demand research. */
  researchStatus?: "not-reviewed";
  /** Purposes people use it for, not claims that it works. Required on basic guides. */
  commonUses?: string[];
  /** Public reference pages for basic descriptions and cautions, not research findings. */
  basicSources?: { title: string; year: number; url: string }[];
  /** Opt-in concise guide; commonUses are potential claims, checked with Brain on demand. */
  simpleGuide?: {
    origin: string[];
    dosage: string[];
    /** Stable facts are reviewed apart from live, locally cached benefit checks. */
    factsReviewedOn?: string;
    claimsSource?: { title: string; url: string };
    /** Explicit outcome words for inexpensive PubMed metadata checks, keyed by the claim text. */
    claimTopics?: Record<string, string>;
    /** Display grouping only; never an evidence grade or a benefit score. */
    claimCategories?: Record<string, ClaimCategory>;
    /** Neutral row labels; the underlying claim text remains the saved-check identity. */
    claimLabels?: Record<string, string>;
    /** Could the amounts studied come from whole foods? Grams are worked out in code (`gramsForAmount`). */
    foodAmounts?: FoodAmounts;
  };
  /** Its main jobs in the body, short phrases. */
  roles: string[];
  /** How status is measured. `biomarkerIds` are markers in this app (may be empty). */
  status: { biomarkerIds: string[]; note: string };
  low: { signs: string[]; atRisk: string[]; note?: string };
  high: { signs: string[]; note: string };
  /** Foods rich in it, in words; `cofidNutrient` links to measured amounts in /knowledge/foods. */
  foodSources: { examples: string[]; cofidNutrient?: string; note?: string };
  /** Supplement forms and how they differ. */
  forms: { name: string; note: string }[];
  /** EFSA dietary reference values for adults, and the tolerable upper intake level. */
  reference: {
    intake: ReferenceIntake[];
    upperLimit?: { amount: number; unit: "µg" | "mg" | "g"; note: string };
    /** When EFSA set no upper limit, why (e.g. "no harm seen at high intakes"). */
    noUpperLimit?: string;
    sources: Citation[];
  };
  /** What trials of supplements found, outcome by outcome. */
  findings: NutrientFinding[];
  /** What studies of foods rich in it found, kept apart from supplement findings. */
  foodFindings?: NutrientFinding[];
  /** Medicines, conditions or other nutrients it interacts with. */
  interactions: { with: string; note: string; safetyId?: SafetyId }[];
  cautions: string[];
  /** Linked entries in /knowledge/evidence (the levers shown on marker pages). */
  evidenceClaims: string[];
  /** General sources: reviews, fact sheets, guidelines. */
  sources: Citation[];
}

/** A bottom line is one or two real sentences: not a label, not a paragraph. */
export const BOTTOM_LINE = { min: 90, max: 340 } as const;
/** "Main uses & benefits": a short bold name and one plain line. */
export const FINDING_LABEL = { min: 3, max: 34 } as const;
export const FINDING_LINE = { min: 15, max: 120 } as const;

const STUDY_TYPES = new Set(["meta-analysis", "rct", "observational", "animal", "in vitro", "review", "guideline"]);
const GRADES = new Set(["high", "moderate", "low", "very low"]);
const EFFECTS = new Set(["helps", "no clear effect", "harms", "mixed"]);
const SAFETY_IDS = new Set(["anticoagulant", "antiplatelet", "diabetes", "pregnancy", "kidney"]);
const UNITS = new Set(["µg", "mg", "g"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const strList = (v: unknown, min = 0): boolean => Array.isArray(v) && v.length >= min && v.every(isStr);
const isHttpsUrl = (v: unknown): boolean => {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

export function citationErrors(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.length === 0) return [`${where} needs at least one source`];
  const errs: string[] = [];
  v.forEach((s, i) => {
    if (!isObj(s) || !isStr(s.title) || typeof s.year !== "number" || !isStr(s.studyType) || !STUDY_TYPES.has(s.studyType))
      errs.push(`${where} source ${i + 1} needs title, year and a valid studyType`);
    else if (!isStr(s.pmid) && !isStr(s.doi)) errs.push(`${where} source ${i + 1} needs a pmid or doi`);
    else if (s.pmid !== undefined && !/^\d+$/.test(String(s.pmid))) errs.push(`${where} source ${i + 1} pmid must be digits`);
  });
  return errs;
}

export function findingErrors(v: unknown, where: string): string[] {
  if (!Array.isArray(v)) return [`${where} must be a list`];
  return v.flatMap((f, i) => {
    const at = `${where} ${i + 1}`;
    if (!isObj(f)) return [`${at} is not an object`];
    const errs: string[] = [];
    for (const k of ["outcome", "population", "summary"] as const) if (!isStr(f[k])) errs.push(`${at} needs ${k}`);
    if (!isStr(f.effect) || !EFFECTS.has(f.effect)) errs.push(`${at} effect is invalid`);
    if (!isStr(f.grade) || !GRADES.has(f.grade)) errs.push(`${at} grade is invalid`);
    if (!strList(f.whyThisGrade, 1)) errs.push(`${at} needs at least one reason for its grade`);
    if (f.bottomLine !== undefined && !(isStr(f.bottomLine) && f.bottomLine.length >= BOTTOM_LINE.min && f.bottomLine.length <= BOTTOM_LINE.max))
      errs.push(`${at} bottomLine must be ${BOTTOM_LINE.min}-${BOTTOM_LINE.max} characters`);
    if (f.label !== undefined && !(isStr(f.label) && f.label.length >= FINDING_LABEL.min && f.label.length <= FINDING_LABEL.max))
      errs.push(`${at} label must be ${FINDING_LABEL.min}-${FINDING_LABEL.max} characters`);
    if (f.line !== undefined && !(isStr(f.line) && f.line.length >= FINDING_LINE.min && f.line.length <= FINDING_LINE.max))
      errs.push(`${at} line must be ${FINDING_LINE.min}-${FINDING_LINE.max} characters`);
    return [...errs, ...citationErrors(f.studies, at)];
  });
}

/** Problems with a nutrient file; empty means valid. */
export function validateNutrientDef(v: unknown): string[] {
  if (!isObj(v)) return ["entry is not an object"];
  const errs: string[] = [];
  if (!isStr(v.id) || !/^[a-z0-9_]+$/.test(v.id)) errs.push("id must be lowercase_with_underscores");
  for (const k of ["name", "summary"] as const) if (!isStr(v[k])) errs.push(`${k} is required`);
  if (!NUTRIENT_KINDS.includes(v.kind as NutrientKind)) errs.push("kind must be vitamin, mineral or supplement");
  const basic = v.researchStatus === "not-reviewed";
  if (v.researchStatus !== undefined && !basic) errs.push("researchStatus must be not-reviewed when provided");
  if (v.simpleGuide !== undefined) {
    if (!basic) errs.push("simpleGuide belongs only to basic supplement guides");
    if (!isObj(v.simpleGuide) || !strList(v.simpleGuide.origin, 1) || !strList(v.simpleGuide.dosage, 1))
      errs.push("simpleGuide needs origin and dosage descriptions");
    else {
      if (v.simpleGuide.factsReviewedOn !== undefined && (typeof v.simpleGuide.factsReviewedOn !== "string" || !isIsoDate(v.simpleGuide.factsReviewedOn)))
        errs.push("simpleGuide factsReviewedOn must be an ISO date");
      if (
        v.simpleGuide.claimsSource !== undefined &&
        (!isObj(v.simpleGuide.claimsSource) || !isStr(v.simpleGuide.claimsSource.title) || !isHttpsUrl(v.simpleGuide.claimsSource.url))
      )
        errs.push("simpleGuide claimsSource needs a title and HTTPS URL");
      const topics = v.simpleGuide.claimTopics;
      if (
        topics !== undefined &&
        (!isObj(topics) ||
          !Array.isArray(v.commonUses) ||
          Object.keys(topics).length !== v.commonUses.length ||
          !v.commonUses.every((claim) => typeof claim === "string" && Object.hasOwn(topics, claim) && isStr(topics[claim])))
      )
        errs.push("simpleGuide claimTopics must name each common claim exactly once");
      const fa = v.simpleGuide.foodAmounts;
      if (fa !== undefined) {
        const okRange = (r: unknown) =>
          Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === "number" && x > 0) && (r[0] as number) <= (r[1] as number);
        if (
          !isObj(fa) ||
          !Array.isArray(fa.targets) ||
          !fa.targets.every((t) => isObj(t) && isStr(t.label) && typeof t.mg === "number" && t.mg > 0) ||
          !Array.isArray(fa.foods) ||
          !fa.foods.every((f) => isObj(f) && isStr(f.name) && okRange(f.mgPer100g)) ||
          (fa.foods.length > 0 && fa.targets.length === 0) ||
          !isStr(fa.verdict) ||
          !Array.isArray(fa.sources) ||
          fa.sources.length === 0
        )
          errs.push("simpleGuide foodAmounts needs a verdict, sources, and (when it lists foods) targets and a [low, high] mg per 100 g for each food");
        else errs.push(...citationErrors(fa.sources as Citation[], "foodAmounts sources"));
      }
      const categories = v.simpleGuide.claimCategories;
      if (
        categories !== undefined &&
        (!isObj(categories) ||
          !Array.isArray(v.commonUses) ||
          Object.keys(categories).length !== v.commonUses.length ||
          !v.commonUses.every(
            (claim) =>
              typeof claim === "string" &&
              Object.hasOwn(categories, claim) &&
              typeof categories[claim] === "string" &&
              CLAIM_CATEGORIES.includes(categories[claim] as ClaimCategory),
          ))
      )
        errs.push("simpleGuide claimCategories must group each common claim exactly once");
      const labels = v.simpleGuide.claimLabels;
      if (
        labels !== undefined &&
        (!isObj(labels) ||
          !Array.isArray(v.commonUses) ||
          Object.keys(labels).length !== v.commonUses.length ||
          !v.commonUses.every((claim) => typeof claim === "string" && Object.hasOwn(labels, claim) && isStr(labels[claim])))
      )
        errs.push("simpleGuide claimLabels must label each common claim exactly once");
    }
  }
  if (basic && v.kind !== "supplement" && v.simpleGuide === undefined) errs.push("basic guides are for other supplements, not vitamins or minerals");
  if ((basic || v.commonUses !== undefined) && !strList(v.commonUses, basic ? 1 : 0)) errs.push("commonUses must list the purposes of a basic guide");
  if (v.basicSources !== undefined) {
    if (!basic) errs.push("basicSources belong only to basic supplement guides");
    if (
      !Array.isArray(v.basicSources) ||
      v.basicSources.length === 0 ||
      !v.basicSources.every((s) => isObj(s) && isStr(s.title) && typeof s.year === "number" && isHttpsUrl(s.url))
    )
      errs.push("basicSources need a title, year and HTTPS URL");
  }
  if (!strList(v.otherNames)) errs.push("otherNames must be a list of strings");
  if (!strList(v.roles, 1)) errs.push("roles needs at least one entry");
  if (!isObj(v.status) || !strList(v.status.biomarkerIds) || !isStr(v.status.note)) errs.push("status needs biomarkerIds and a note");
  if (!isObj(v.low) || !strList(v.low.signs, basic ? 0 : 1) || !strList(v.low.atRisk, basic ? 0 : 1)) errs.push("low needs signs and atRisk");
  if (isObj(v.low) && v.low.note !== undefined && !isStr(v.low.note)) errs.push("low note must be a description");
  if (!isObj(v.high) || !strList(v.high.signs) || !isStr(v.high.note)) errs.push("high needs signs and a note");
  if (!isObj(v.foodSources) || !strList(v.foodSources.examples, basic ? 0 : 1)) errs.push("foodSources needs examples");
  if (!Array.isArray(v.forms) || !v.forms.every((f) => isObj(f) && isStr(f.name) && isStr(f.note))) errs.push("forms need a name and a note each");
  const r = v.reference;
  if (!isObj(r)) errs.push("reference is required");
  else {
    // Only other supplements may have no reference intake (they aren't essential nutrients).
    if (Array.isArray(r.intake) && r.intake.length === 0 && v.kind !== "supplement") errs.push("a vitamin or mineral needs a reference intake");
    if (
      !Array.isArray(r.intake) ||
      !r.intake.every(
        (x) => isObj(x) && isStr(x.group) && typeof x.amount === "number" && x.amount > 0 && UNITS.has(String(x.unit)) && (x.type === "PRI" || x.type === "AI"),
      )
    )
      errs.push("reference intake needs group, amount, unit (µg, mg, g) and type (PRI or AI)");
    if (
      r.upperLimit !== undefined &&
      !(isObj(r.upperLimit) && typeof r.upperLimit.amount === "number" && UNITS.has(String(r.upperLimit.unit)) && isStr(r.upperLimit.note))
    )
      errs.push("upperLimit needs amount, unit and note");
    if (r.upperLimit === undefined && !isStr(r.noUpperLimit)) errs.push("give an upperLimit or say why there is none (noUpperLimit)");
    if (!(basic && Array.isArray(r.sources) && r.sources.length === 0)) errs.push(...citationErrors(r.sources, "reference"));
  }
  errs.push(...findingErrors(v.findings, "finding"));
  if (Array.isArray(v.findings)) {
    if (basic && v.findings.length > 0) errs.push("basic guides must not contain graded findings");
    if (!basic && v.findings.length === 0) errs.push("findings needs at least one supplement finding");
  }
  if (v.foodFindings !== undefined) errs.push(...findingErrors(v.foodFindings, "food finding"));
  if (basic && Array.isArray(v.foodFindings) && v.foodFindings.length > 0) errs.push("basic guides must not contain graded food findings");
  if (
    !Array.isArray(v.interactions) ||
    !v.interactions.every((x) => isObj(x) && isStr(x.with) && isStr(x.note) && (x.safetyId === undefined || SAFETY_IDS.has(String(x.safetyId))))
  )
    errs.push("interactions need with and note (and a known safetyId, if any)");
  if (!strList(v.cautions)) errs.push("cautions must be a list of strings");
  if (!strList(v.evidenceClaims)) errs.push("evidenceClaims must be a list of ids");
  if (basic && Array.isArray(v.evidenceClaims) && v.evidenceClaims.length > 0) errs.push("basic guides must not link graded evidence claims");
  if (!(basic && Array.isArray(v.sources) && v.sources.length === 0 && Array.isArray(v.basicSources) && v.basicSources.length > 0))
    errs.push(...citationErrors(v.sources, "sources"));
  return errs;
}

/** Wording that would turn general information into personal advice (a test checks every file). */
export const PRESCRIBING = /\byou should (take|start|stop)\b|\btake \d|\bwe recommend\b|\byour dose\b|\bstart taking\b|\bstop taking\b/i;

/** Every piece of text in a nutrient file, for wording checks. */
export function nutrientText(n: NutrientDef): string[] {
  return [
    n.summary,
    ...(n.commonUses ?? []),
    ...(n.simpleGuide?.origin ?? []),
    ...(n.simpleGuide?.dosage ?? []),
    n.simpleGuide?.foodAmounts?.verdict ?? "",
    n.simpleGuide?.foodAmounts?.notChecked ?? "",
    ...(n.simpleGuide?.foodAmounts?.foods.map((f) => f.note ?? "") ?? []),
    ...n.roles,
    n.status.note,
    ...n.low.signs,
    ...n.low.atRisk,
    n.low.note ?? "",
    ...n.high.signs,
    n.high.note,
    ...n.foodSources.examples,
    n.foodSources.note ?? "",
    ...n.forms.flatMap((f) => [f.name, f.note]),
    n.reference.upperLimit?.note ?? "",
    n.reference.noUpperLimit ?? "",
    ...[...n.findings, ...(n.foodFindings ?? [])].flatMap((f) => [
      f.outcome,
      f.population,
      f.summary,
      f.bottomLine ?? "",
      f.label ?? "",
      f.line ?? "",
      ...f.whyThisGrade,
    ]),
    ...n.interactions.flatMap((x) => [x.with, x.note]),
    ...n.cautions,
  ];
}

/** The strongest grade among a nutrient's supplement findings that showed a benefit, if any. */
export function strongestBenefit(n: NutrientDef): EvidenceGrade | undefined {
  const order: EvidenceGrade[] = ["high", "moderate", "low", "very low"];
  return order.find((g) => n.findings.some((f) => f.effect === "helps" && f.grade === g));
}

/** Interactions that apply to this person (from their log and profile, via safetyNotes ids). */
export function interactionsFor(n: NutrientDef, safety: readonly SafetyId[]): NutrientDef["interactions"] {
  return n.interactions.filter((x) => x.safetyId && safety.includes(x.safetyId));
}

/** How many supplement findings helped, showed no clear effect, harmed or were mixed: for the overview. */
export function findingCounts(n: NutrientDef): Record<FindingEffect, number> {
  const out: Record<FindingEffect, number> = { helps: 0, "no clear effect": 0, harms: 0, mixed: 0 };
  for (const f of n.findings) out[f.effect]++;
  return out;
}

/** Findings with the strongest evidence first; harms before other effects at the same grade. */
export function sortFindings(fs: readonly NutrientFinding[]): NutrientFinding[] {
  const g: EvidenceGrade[] = ["high", "moderate", "low", "very low"];
  const e: FindingEffect[] = ["harms", "helps", "mixed", "no clear effect"];
  return [...fs].sort((a, b) => g.indexOf(a.grade) - g.indexOf(b.grade) || e.indexOf(a.effect) - e.indexOf(b.effect));
}

// ---- Search ------------------------------------------------------------------------------------

/** Where a search matched, when it wasn't the name: "Food: Oily fish such as herring". */
export interface NutrientMatch {
  label: string;
  text: string;
}

/** Lower case, no accents, letters and digits split ("B12" → "b 12", "D3" → "d 3"), other marks as spaces. */
const searchNorm = (s: string) =>
  ` ${s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/([a-z])(\d)|(\d)([a-z])/g, "$1$3 $2$4")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** The searchable parts of a nutrient, most telling first. */
function searchFields(n: NutrientDef): NutrientMatch[] {
  const f = (label: string, items: readonly string[]) => items.map((text) => ({ label, text }));
  return [
    { label: "", text: n.name },
    ...f("Also called", n.otherNames),
    ...f("What it does", n.roles),
    ...f("Common use", n.commonUses ?? []),
    ...f("Food", n.foodSources.examples),
    ...f("Origin", n.simpleGuide?.origin ?? []),
    ...f(
      "Trial outcome",
      n.findings.map((x) => x.outcome),
    ),
    ...f(
      "Food study",
      (n.foodFindings ?? []).map((x) => x.outcome),
    ),
    ...f(
      "Interaction",
      n.interactions.map((x) => x.with),
    ),
    ...f("Sign of too little", n.low.signs),
    ...f("Who runs low", n.low.atRisk),
    ...f("Sign of too much", n.high.signs),
    ...f(
      "Form",
      n.forms.map((x) => x.name),
    ),
    ...f("Caution", n.cautions),
    { label: "About", text: n.summary },
  ];
}

/**
 * Vitamins and minerals matching a search: every word has to start a word somewhere in the entry
 * (name, other names, roles, foods, trial outcomes, interactions, signs, forms, cautions, summary).
 * Name matches come first; otherwise the entry's best-matching part is returned to show why it matched.
 * An empty search returns everything in its order.
 */
export function searchNutrients(nutrients: readonly NutrientDef[], query: string): { n: NutrientDef; match?: NutrientMatch }[] {
  const q = searchNorm(query).trim();
  if (!q) return nutrients.map((n) => ({ n }));
  const words = q.split(" ");
  const has = (text: string, w: string) => text.includes(` ${w}`);
  const out: { n: NutrientDef; match?: NutrientMatch; rank: number; order: number }[] = [];
  nutrients.forEach((n, order) => {
    const fields = searchFields(n).map((x) => ({ ...x, norm: searchNorm(x.text) }));
    if (!words.every((w) => fields.some((x) => has(x.norm, w)))) return;
    // The part that covers the most words; earlier parts win ties.
    let best = 0;
    let bestCount = -1;
    fields.forEach((x, i) => {
      const count = words.filter((w) => has(x.norm, w)).length;
      if (count > bestCount) [best, bestCount] = [i, count];
    });
    const b = fields[best]!;
    const all = bestCount === words.length;
    const rank = (all ? 0 : 1000) + (best === 0 && fields[0]!.norm.startsWith(` ${q}`) ? -1 : best);
    out.push({ n, ...(best === 0 ? {} : { match: { label: b.label, text: b.text } }), rank, order });
  });
  return out.sort((a, b) => a.rank - b.rank || a.order - b.order).map(({ n, match }) => (match ? { n, match } : { n }));
}
