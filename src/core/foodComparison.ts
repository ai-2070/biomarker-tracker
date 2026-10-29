import type { Citation, EvidenceGrade } from "./types";

/**
 * Animal foods, fruit and other plant foods compared, claim by claim (knowledge/food-comparison/*.json),
 * under four topics: the animal matrix, absorption, vitamins and safety. Each claim is stated the way
 * people make it, then given a verdict and an evidence grade from the cited studies, with the other
 * side included where it exists. Explains, never prescribes a diet (CLAUDE.md).
 */

export type ComparisonTopic = "matrix" | "absorption" | "vitamins" | "safety";
export const TOPICS: readonly ComparisonTopic[] = ["matrix", "absorption", "vitamins", "safety"];
export type Verdict = "supported" | "partly supported" | "mixed" | "not supported" | "not enough evidence";
export const VERDICTS: readonly Verdict[] = ["supported", "partly supported", "mixed", "not supported", "not enough evidence"];
export type Favours = "animal foods" | "fruit" | "plant foods" | "neither" | "depends";
const FAVOURS: readonly Favours[] = ["animal foods", "fruit", "plant foods", "neither", "depends"];

export interface ComparisonClaim {
  id: string;
  /** The claim as people make it: "Iron from meat is absorbed better than iron from plants". */
  claim: string;
  verdict: Verdict;
  grade: EvidenceGrade;
  /** Which kind of food the evidence favours on this point, if any. */
  favours: Favours;
  /** What research shows, in plain language, including the other side and the limits. */
  summary: string;
  whyThisGrade: string[];
  studies: Citation[];
}

export interface ComparisonTopicFile {
  topic: ComparisonTopic;
  title: string;
  /** One or two sentences: what this topic is about. */
  intro: string;
  claims: ComparisonClaim[];
}

const STUDY_TYPES = new Set(["meta-analysis", "rct", "observational", "animal", "in vitro", "review", "guideline"]);
const GRADES = new Set(["high", "moderate", "low", "very low"]);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Problems with a topic file; empty means valid. */
export function validateComparisonTopic(v: unknown): string[] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return ["the file is not an object"];
  const t = v as Record<string, unknown>;
  const errs: string[] = [];
  if (!TOPICS.includes(t.topic as ComparisonTopic)) errs.push("topic must be matrix, absorption, vitamins or safety");
  if (!isStr(t.title)) errs.push("title is required");
  if (!isStr(t.intro)) errs.push("intro is required");
  if (!Array.isArray(t.claims) || t.claims.length === 0) return [...errs, "claims needs at least one claim"];
  (t.claims as Record<string, unknown>[]).forEach((c, i) => {
    const at = `claim ${i + 1}`;
    if (!isStr(c.id) || !/^[a-z0-9-]+$/.test(String(c.id))) errs.push(`${at}: id must be lowercase-with-dashes`);
    for (const k of ["claim", "summary"] as const) if (!isStr(c[k])) errs.push(`${at}: ${k} is required`);
    if (!VERDICTS.includes(c.verdict as Verdict)) errs.push(`${at}: verdict is invalid`);
    if (!GRADES.has(String(c.grade))) errs.push(`${at}: grade is invalid`);
    if (!FAVOURS.includes(c.favours as Favours)) errs.push(`${at}: favours is invalid`);
    if (!Array.isArray(c.whyThisGrade) || c.whyThisGrade.length === 0 || !c.whyThisGrade.every(isStr)) errs.push(`${at}: needs at least one reason for its grade`);
    if (!Array.isArray(c.studies) || c.studies.length === 0) errs.push(`${at}: needs at least one study`);
    else
      (c.studies as Record<string, unknown>[]).forEach((s, j) => {
        if (!isStr(s.title) || typeof s.year !== "number" || !STUDY_TYPES.has(String(s.studyType))) errs.push(`${at} study ${j + 1}: needs title, year and a valid studyType`);
        else if (!isStr(s.pmid) && !isStr(s.doi)) errs.push(`${at} study ${j + 1}: needs a pmid or doi`);
        else if (s.pmid !== undefined && !/^\d+$/.test(String(s.pmid))) errs.push(`${at} study ${j + 1}: pmid must be digits`);
      });
  });
  return errs;
}
