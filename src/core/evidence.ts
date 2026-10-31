import type { Flag } from "./trends";
import type { EvidenceClaim, EvidenceGrade, SafetyId } from "./types";

const GRADES: readonly EvidenceGrade[] = ["high", "moderate", "low", "very low"];
const KINDS = new Set(["food", "diet", "supplement", "habit"]);
const DIRECTIONS = new Set(["increase", "decrease", "no effect", "mixed"]);
const SAFETY_IDS = new Set(["anticoagulant", "antiplatelet", "diabetes", "pregnancy", "kidney"]);
const STUDY_TYPES = new Set(["meta-analysis", "rct", "observational", "animal", "in vitro", "review", "guideline"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Problems with an evidence file; empty means valid. */
export function validateEvidenceClaim(v: unknown): string[] {
  if (!isObj(v)) return ["entry is not an object"];
  const errs: string[] = [];
  if (!isStr(v.id) || !/^[a-z0-9-]+$/.test(v.id)) errs.push("id must be lowercase-with-dashes");
  for (const k of ["lever", "intervention", "outcome", "summary"] as const) if (!isStr(v[k])) errs.push(`${k} is required`);
  if (!isStr(v.kind) || !KINDS.has(v.kind)) errs.push("kind is invalid");
  if (!isStr(v.direction) || !DIRECTIONS.has(v.direction)) errs.push("direction is invalid");
  if (!isStr(v.grade) || !(GRADES as readonly string[]).includes(v.grade)) errs.push("grade is invalid");
  if (!Array.isArray(v.whyThisGrade) || v.whyThisGrade.length === 0 || !v.whyThisGrade.every(isStr)) errs.push("whyThisGrade needs at least one reason");
  if (!Array.isArray(v.markers) || v.markers.length === 0) errs.push("markers must list at least one biomarker");
  else if (!v.markers.every((m) => isObj(m) && isStr(m.biomarkerId) && (m.helpsWhen === "low" || m.helpsWhen === "high"))) errs.push("each marker needs biomarkerId and helpsWhen low|high");
  if (v.foods !== undefined && !(isObj(v.foods) && isStr(v.foods.nutrient) && Array.isArray(v.foods.foodIds) && v.foods.foodIds.every(isStr))) errs.push("foods needs nutrient and foodIds");
  if (v.hideWhen !== undefined && !(Array.isArray(v.hideWhen) && v.hideWhen.every((s) => isStr(s) && SAFETY_IDS.has(s)))) errs.push("hideWhen has an unknown id");
  if (!Array.isArray(v.studies) || v.studies.length === 0) errs.push("at least one study is required");
  else
    v.studies.forEach((s, i) => {
      if (!isObj(s) || !isStr(s.title) || typeof s.year !== "number" || !isStr(s.studyType) || !STUDY_TYPES.has(s.studyType)) errs.push(`study ${i + 1} needs title, year and a valid studyType`);
      else if (!isStr(s.pmid) && !isStr(s.doi)) errs.push(`study ${i + 1} needs a pmid or doi`);
    });
  // Whole foods and isolated nutrients are different interventions (CLAUDE.md).
  if (v.kind === "supplement" && v.foods !== undefined) errs.push("a supplement claim must not list foods");
  return errs;
}

export function gradeRank(g: EvidenceGrade): number {
  return GRADES.indexOf(g);
}

export interface LeverSelection {
  /** Claims for the direction the latest result is out of range in; or all when in range. */
  claims: EvidenceClaim[];
  /** Claims hidden because of the user's log. */
  hidden: EvidenceClaim[];
  /** "low" / "high" when the latest result is out of range in that direction. */
  focus?: "low" | "high";
}

/**
 * Pick the claims to show for a marker. When the latest result is low or high,
 * only claims for that direction are shown; otherwise all claims are, for
 * general information. Stronger evidence first.
 */
export function selectLevers(biomarkerId: string, flag: Flag | undefined, claims: readonly EvidenceClaim[], safety: readonly SafetyId[]): LeverSelection {
  const focus = flag === "low" ? "low" : flag === "high" ? "high" : undefined;
  const relevant = claims.filter((c) => c.markers.some((m) => m.biomarkerId === biomarkerId && (!focus || m.helpsWhen === focus)));
  const hidden = relevant.filter((c) => c.hideWhen?.some((s) => safety.includes(s)));
  const shown = relevant.filter((c) => !hidden.includes(c)).sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade));
  return focus ? { claims: shown, hidden, focus } : { claims: shown, hidden };
}
