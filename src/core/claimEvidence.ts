import type { EvidenceGrade } from "./types";
import { checkCitations, normalizeId } from "../ai/citations";

export type ClaimVerdict = "supported" | "mixed" | "not supported" | "not enough evidence";

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
  version: 1;
  checkedAt: string;
  model: string;
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
