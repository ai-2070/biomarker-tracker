import type { EvidenceGrade } from "./types";
import { checkCitations, normalizeId } from "@bt/ai/citations";

export type ClaimVerdict = "supported" | "mixed" | "not supported" | "not enough evidence";

export const CLAIM_CATEGORIES = ["health", "longevity", "appearance"] as const;
export type ClaimCategory = typeof CLAIM_CATEGORIES[number];

/** Public claim only: never a profile, measurement, conversation or attachment. */
export interface ClaimRequest {
  nutrientId: string;
  claim: string;
  topic: string;
}

export interface ClaimAssessment {
  verdict: ClaimVerdict;
  /** No human evidence is not a high-confidence negative finding. */
  grade: EvidenceGrade | null;
  summary: string;
  limitations: string;
  citations: string[];
}

/** Model and time are assigned by the app, not supplied by the model. */
export interface ClaimCheck extends ClaimRequest, ClaimAssessment {
  version: 1 | 2;
  checkedAt: string;
  model: string;
  research?: ClaimResearch;
}

export type ClaimDepth = "quick" | "deep";
export type ClaimSearchRung = "reviews" | "trials" | "broad" | "extra" | "lookup";
export interface ClaimSearchPlan {
  intervention: string;
  outcome: string;
  interventionSynonyms: string[];
  outcomeSynonyms: string[];
  route: "oral" | "topical" | "any";
}
export interface ClaimSearchQuery {
  rung: ClaimSearchRung;
  query: string;
  source: "europepmc";
  sort: "relevance";
  resultCount: number | null;
  ids: string[];
  error?: string;
}
export interface ClaimScreening {
  id: string;
  decision: "direct" | "indirect" | "exclude";
  reason: string;
  route: "oral" | "topical" | "other" | "unclear";
  formulation: "alone" | "combination" | "unclear";
  evidence: "human_trial" | "human_review" | "human_other" | "preclinical" | "unclear";
}
export interface ClaimResearch {
  depth: ClaimDepth;
  status: "evidence_found" | "indirect_only" | "no_evidence" | "search_failed";
  plan?: ClaimSearchPlan;
  queries: ClaimSearchQuery[];
  records: { id: string; title: string }[];
  screening: ClaimScreening[];
  retrieved: number;
  screened: number;
  included: number;
  error?: string;
}

export function claimCheckLabel(check: ClaimCheck): string {
  if (check.research?.status === "search_failed") return "Search failed, retry";
  if (check.research?.status === "no_evidence") return "No evidence found";
  if (check.research?.status === "indirect_only") return "Very low (indirect only)";
  return { supported: "Supported", mixed: "Mixed findings", "not supported": "Not supported", "not enough evidence": "Quick check: no direct trials found" }[check.verdict];
}

/** Full run identity: same-day checks with different budgets or findings remain distinct. */
export function claimRunKey(check: ClaimCheck): string {
  return JSON.stringify([check.nutrientId, check.claim, check.topic, check.checkedAt, check.model, check.verdict, check.grade, check.summary, check.limitations, check.citations, check.research ?? null]);
}

export function claimGradeChange(current: ClaimCheck, previous: ClaimCheck): { before: ClaimCheck["grade"]; after: ClaimCheck["grade"] } | undefined {
  if (current.nutrientId !== previous.nutrientId || current.claim !== previous.claim || current.topic !== previous.topic ||
    current.research?.status === "search_failed" || previous.research?.status === "search_failed" || current.grade === previous.grade) return;
  return { before: previous.grade, after: current.grade };
}

/** A public intervention need not have an entry in the bundled knowledge base. */
export const publicInterventionId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_-]{1,79}$/i.test(value);

export function claimSearchQuery(plan: ClaimSearchPlan, rung: Exclude<ClaimSearchRung, "lookup">): string {
  const terms = (values: string[]) => `(${[...new Set(values)].map((value) => `TITLE_ABS:"${value.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim()}"`).join(" OR ")})`;
  const parts = [terms([plan.intervention, ...plan.interventionSynonyms]), terms([plan.outcome, ...plan.outcomeSynonyms])];
  if (rung === "reviews") parts.push('(PUB_TYPE:"meta-analysis" OR PUB_TYPE:"systematic review" OR TITLE:"meta-analysis" OR TITLE:"systematic review")');
  if (rung === "trials") parts.push('(PUB_TYPE:"randomized controlled trial" OR ((TITLE_ABS:randomized OR TITLE_ABS:randomised) AND (TITLE_ABS:controlled OR TITLE_ABS:placebo)))');
  return parts.join(" AND ");
}

export function completeClaimLadder(research: ClaimResearch): boolean {
  return ["reviews", "trials", "broad"].every((rung, i) => research.queries[i]?.rung === rung) &&
    research.queries.length >= 3 && research.queries.every((query) => !query.error && query.resultCount !== null);
}

/** Counts and terminal states are derived from actual searches and screening, never model prose. */
export function validateClaimResearch(research: ClaimResearch, assessment: ClaimAssessment): void {
  if (!research || !["quick", "deep"].includes(research.depth) || !["evidence_found", "indirect_only", "no_evidence", "search_failed"].includes(research.status) ||
    !Array.isArray(research.records) || !Array.isArray(research.screening) || !Array.isArray(research.queries) || research.queries.length > 30 || research.records.length > 300) throw new Error("Invalid research audit.");
  const ids = new Set(research.records.map((record) => record.id));
  const screened = new Set(research.screening.map((record) => record.id));
  const included = research.screening.filter((record) => record.decision !== "exclude");
  if (research.records.some((record) => !citationId(record.id) || typeof record.title !== "string" || !record.title.trim() || record.title.length > 10000)) throw new Error("Invalid retrieved record.");
  if (research.plan && (typeof research.plan.intervention !== "string" || !research.plan.intervention.trim() || typeof research.plan.outcome !== "string" || !research.plan.outcome.trim() ||
    !["oral", "topical", "any"].includes(research.plan.route) || !Array.isArray(research.plan.interventionSynonyms) || !Array.isArray(research.plan.outcomeSynonyms) ||
    [...research.plan.interventionSynonyms, ...research.plan.outcomeSynonyms].some((word) => typeof word !== "string" || !publicClaimTopic(word)))) throw new Error("Invalid search plan.");
  if (ids.size !== research.records.length || screened.size !== research.screening.length || [...screened].some((id) => !ids.has(id)) ||
    research.retrieved !== ids.size || research.screened !== screened.size || research.included !== included.length) throw new Error("Research counts do not match the recorded studies.");
  for (const query of research.queries) {
    if (!["reviews", "trials", "broad", "extra", "lookup"].includes(query.rung) || typeof query.query !== "string" || !query.query || query.query.length > 5000 || query.sort !== "relevance" || query.source !== "europepmc" || !Array.isArray(query.ids) ||
      (query.resultCount !== null && (!Number.isSafeInteger(query.resultCount) || query.resultCount < query.ids.length)) || (!query.error && query.resultCount === null) || query.ids.some((id) => !ids.has(id))) throw new Error("Invalid recorded search.");
  }
  for (const record of research.screening) {
    if (!["direct", "indirect", "exclude"].includes(record.decision) || typeof record.reason !== "string" || record.reason.length < 8 || record.reason.length > 500 ||
      !["oral", "topical", "other", "unclear"].includes(record.route) || !["alone", "combination", "unclear"].includes(record.formulation) || !["human_trial", "human_review", "human_other", "preclinical", "unclear"].includes(record.evidence)) throw new Error("Invalid screening decision.");
    if (record.decision === "direct" && (record.formulation !== "alone" || record.evidence === "preclinical" || record.evidence === "unclear" || record.route === "unclear" ||
      (research.plan?.route !== "any" && research.plan?.route !== record.route))) throw new Error("Combination products, uncertain attribution and mismatched routes must be indirect.");
  }
  if (research.status === "search_failed") {
    if (!research.error || assessment.grade !== null) throw new Error("A failed search cannot carry an evidence grade.");
    return;
  }
  if (research.error || !research.plan || !completeClaimLadder(research) || research.screened !== research.retrieved) throw new Error("The full clean ladder and complete screening are required.");
  if (research.status === "no_evidence") {
    if (included.length || assessment.grade !== null || assessment.citations.length) throw new Error("No evidence requires zero included studies and no grade.");
  } else if (research.status === "indirect_only") {
    if (!included.length || included.some((record) => record.decision === "direct") || assessment.grade !== "very low") throw new Error("Indirect-only evidence must be graded very low.");
  } else if (!included.some((record) => record.decision === "direct") || assessment.grade === null) throw new Error("Direct evidence requires an evidence grade.");
  if (assessment.citations.some((id) => !included.some((record) => record.id === id))) throw new Error("Citations must refer to included, screened studies.");
}

/** A metadata signal, not an assessment that any new record supports the claim. */
export interface ClaimUpdate {
  count: number;
  checkedAt: string;
  since: string;
  query: string;
}

/** Public topics can name immune systems and clinical acronyms without becoming personal prompts. */
export function publicClaimTopic(value: string): string | null {
  const topic = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (topic.length < 3 || topic.length > 100 || !/^[\p{L}\p{N}][\p{L}\p{N} ,()'’\/-]*$/u.test(topic) || !/\p{L}/u.test(topic) ||
    /\b(?:my|mine|we|our|email|address|born|ignore|instructions|prompt|assistant)\b|\bI(?:['’]m|\s+(?:am|have|take|use|was|need|want|feel))\b/i.test(topic)) return null;
  return topic;
}

const verdicts: readonly string[] = ["supported", "mixed", "not supported", "not enough evidence"];
const grades: readonly string[] = ["high", "moderate", "low", "very low"];
const fields = ["verdict", "grade", "summary", "limitations", "citations"];

function citationId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 240) return;
  const match = /^(PMID|PMCID|DOI)\s*:\s*(\d{4,9}|PMC\d+|10\.\d{4,9}\/[^\s<>"{}\[\]]+)$/i.exec(value.trim());
  if (!match) return;
  const kind = match[1]!.toUpperCase();
  const id = match[2]!;
  if ((kind === "PMID" && !/^\d{4,9}$/.test(id)) || (kind === "PMCID" && !/^(?:PMC)?\d+$/i.test(id)) || (kind === "DOI" && !/^10\./.test(id))) return;
  return normalizeId(kind, id);
}

/** Validate a structured tool result, never infer a verdict from the model's prose. */
export function validateClaimAssessment(value: unknown, studyIds: readonly string[]): ClaimAssessment {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The evidence check is not an object.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || fields.some((field) => !(field in record))) throw new Error("The evidence check has unexpected or missing fields.");
  if (typeof record.verdict !== "string" || !verdicts.includes(record.verdict)) throw new Error("The evidence verdict is invalid.");
  if (record.grade !== null && (typeof record.grade !== "string" || !grades.includes(record.grade))) throw new Error("The evidence grade is invalid.");
  if ((record.verdict === "not enough evidence") !== (record.grade === null)) throw new Error("Missing evidence must have no grade; other verdicts need an evidence grade.");
  const concise = (value: unknown, max: number): string => {
    if (typeof value !== "string" || value.trim().length < 12 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("The evidence summary or limitations are missing or too long.");
    return value.trim();
  };
  const summary = concise(record.summary, 600);
  const limitations = concise(record.limitations, 800);
  if (!Array.isArray(record.citations) || record.citations.length > 20) throw new Error("The evidence citations are invalid.");
  const allowed = new Set(studyIds.map(citationId).filter((id): id is string => !!id));
  const citations: string[] = [];
  for (const raw of record.citations) {
    const id = citationId(raw);
    if (!id || !allowed.has(id)) throw new Error("The evidence check cites a study that was not retrieved.");
    if (!citations.includes(id)) citations.push(id);
  }
  if (record.verdict !== "not enough evidence" && citations.length === 0) throw new Error("A graded verdict needs retrieved citations.");
  const inText = checkCitations(`${summary}\n${limitations}`, allowed);
  if (inText.unverified.length || inText.looseReferences.length || inText.verified.some((id) => !citations.includes(id))) throw new Error("The evidence text contains unverified or unlisted citations.");
  return { verdict: record.verdict as ClaimVerdict, grade: record.grade as EvidenceGrade | null, summary, limitations, citations };
}
