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

export interface NutrientDef {
  id: string;
  name: string;
  kind: NutrientKind;
  /** Other names and the forms' chemical names: "cholecalciferol (D3)". */
  otherNames: string[];
  /** Plain language, 1–3 sentences. */
  summary: string;
  /** Its main jobs in the body, short phrases. */
  roles: string[];
  /** How status is measured. `biomarkerIds` are markers in this app (may be empty). */
  status: { biomarkerIds: string[]; note: string };
  low: { signs: string[]; atRisk: string[] };
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

const STUDY_TYPES = new Set(["meta-analysis", "rct", "observational", "animal", "in vitro", "review", "guideline"]);
const GRADES = new Set(["high", "moderate", "low", "very low"]);
const EFFECTS = new Set(["helps", "no clear effect", "harms", "mixed"]);
const SAFETY_IDS = new Set(["anticoagulant", "diabetes", "pregnancy", "kidney"]);
const UNITS = new Set(["µg", "mg", "g"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const strList = (v: unknown, min = 0): boolean => Array.isArray(v) && v.length >= min && v.every(isStr);

export function citationErrors(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.length === 0) return [`${where} needs at least one source`];
  const errs: string[] = [];
  v.forEach((s, i) => {
    if (!isObj(s) || !isStr(s.title) || typeof s.year !== "number" || !isStr(s.studyType) || !STUDY_TYPES.has(s.studyType)) errs.push(`${where} source ${i + 1} needs title, year and a valid studyType`);
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
  if (!strList(v.otherNames)) errs.push("otherNames must be a list of strings");
  if (!strList(v.roles, 1)) errs.push("roles needs at least one entry");
  if (!isObj(v.status) || !strList(v.status.biomarkerIds) || !isStr(v.status.note)) errs.push("status needs biomarkerIds and a note");
  if (!isObj(v.low) || !strList(v.low.signs, 1) || !strList(v.low.atRisk, 1)) errs.push("low needs signs and atRisk");
  if (!isObj(v.high) || !strList(v.high.signs) || !isStr(v.high.note)) errs.push("high needs signs and a note");
  if (!isObj(v.foodSources) || !strList(v.foodSources.examples, 1)) errs.push("foodSources needs examples");
  if (!Array.isArray(v.forms) || !v.forms.every((f) => isObj(f) && isStr(f.name) && isStr(f.note))) errs.push("forms need a name and a note each");
  const r = v.reference;
  if (!isObj(r)) errs.push("reference is required");
  else {
    // Only other supplements may have no reference intake (they aren't essential nutrients).
    if (Array.isArray(r.intake) && r.intake.length === 0 && v.kind !== "supplement") errs.push("a vitamin or mineral needs a reference intake");
    if (!Array.isArray(r.intake) || !r.intake.every((x) => isObj(x) && isStr(x.group) && typeof x.amount === "number" && x.amount > 0 && UNITS.has(String(x.unit)) && (x.type === "PRI" || x.type === "AI")))
      errs.push("reference intake needs group, amount, unit (µg, mg, g) and type (PRI or AI)");
    if (r.upperLimit !== undefined && !(isObj(r.upperLimit) && typeof r.upperLimit.amount === "number" && UNITS.has(String(r.upperLimit.unit)) && isStr(r.upperLimit.note))) errs.push("upperLimit needs amount, unit and note");
    if (r.upperLimit === undefined && !isStr(r.noUpperLimit)) errs.push("give an upperLimit or say why there is none (noUpperLimit)");
    errs.push(...citationErrors(r.sources, "reference"));
  }
  errs.push(...findingErrors(v.findings, "finding"));
  if (Array.isArray(v.findings) && v.findings.length === 0) errs.push("findings needs at least one supplement finding");
  if (v.foodFindings !== undefined) errs.push(...findingErrors(v.foodFindings, "food finding"));
  if (!Array.isArray(v.interactions) || !v.interactions.every((x) => isObj(x) && isStr(x.with) && isStr(x.note) && (x.safetyId === undefined || SAFETY_IDS.has(String(x.safetyId)))))
    errs.push("interactions need with and note (and a known safetyId, if any)");
  if (!strList(v.cautions)) errs.push("cautions must be a list of strings");
  if (!strList(v.evidenceClaims)) errs.push("evidenceClaims must be a list of ids");
  errs.push(...citationErrors(v.sources, "sources"));
  return errs;
}

/** Wording that would turn general information into personal advice (a test checks every file). */
export const PRESCRIBING = /\byou should (take|start|stop)\b|\btake \d|\bwe recommend\b|\byour dose\b|\bstart taking\b|\bstop taking\b/i;

/** Every piece of text in a nutrient file, for wording checks. */
export function nutrientText(n: NutrientDef): string[] {
  return [
    n.summary,
    ...n.roles,
    n.status.note,
    ...n.low.signs,
    ...n.low.atRisk,
    ...n.high.signs,
    n.high.note,
    ...n.foodSources.examples,
    n.foodSources.note ?? "",
    ...n.forms.flatMap((f) => [f.name, f.note]),
    n.reference.upperLimit?.note ?? "",
    n.reference.noUpperLimit ?? "",
    ...[...n.findings, ...(n.foodFindings ?? [])].flatMap((f) => [f.outcome, f.population, f.summary, f.bottomLine ?? "", ...f.whyThisGrade]),
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
    ...f("Food", n.foodSources.examples),
    ...f("Trial outcome", n.findings.map((x) => x.outcome)),
    ...f("Food study", (n.foodFindings ?? []).map((x) => x.outcome)),
    ...f("Interaction", n.interactions.map((x) => x.with)),
    ...f("Sign of too little", n.low.signs),
    ...f("Who runs low", n.low.atRisk),
    ...f("Sign of too much", n.high.signs),
    ...f("Form", n.forms.map((x) => x.name)),
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
