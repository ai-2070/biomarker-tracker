/** Shared by build.ts and screen.ts: a topic's downloaded records (fetch.ts), classified, one per paper. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classify, eligibleReviews, type Decision, type EvidenceRecord, type Question } from "../../src/core/evidenceMap";
import type { NutrientDef } from "../../src/core/nutrients";
import { TOPICS } from "./topics";

export const ROOT = join(import.meta.dirname, "..", "..");
export const CACHE = join(import.meta.dirname, "cache");
export const SCREENING_DIR = join(ROOT, "knowledge", "evidence-maps", "screening");

export interface ScreeningFile {
  topic: string;
  /** Who screened: the model and how it was run. */
  by: string;
  outcomes: Record<string, { question: Question; at: string; decisions: Decision[] }>;
}

export function loadTopic(id: string | undefined) {
  const topic = TOPICS.find((t) => t.id === id);
  if (!topic) throw new Error(`Unknown topic. Known: ${TOPICS.map((t) => t.id).join(", ")}`);
  const raw = JSON.parse(readFileSync(join(CACHE, `${topic.id}.json`), "utf8")) as {
    fetchedAt: string;
    queries: Record<string, string>;
    counts: Record<string, number>;
    records: { reviews: EvidenceRecord[]; trials: EvidenceRecord[]; guidelines: EvidenceRecord[] };
  };
  const nutrient = JSON.parse(readFileSync(join(ROOT, "knowledge", "nutrients", `${topic.nutrientId}.json`), "utf8")) as NutrientDef;
  // One record per paper (a review can also be a guideline).
  const seen = new Set<string>();
  const records = [...raw.records.guidelines, ...raw.records.reviews, ...raw.records.trials]
    .filter((r) => {
      const key = r.pmid ?? r.doi ?? r.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => classify(r, topic.outcomes));
  // The topic's own terms (plain words, no special characters) must be in a review's title.
  const topicTitle = new RegExp(topic.terms.join("|"), "i");
  const eligible = (outcomeId: string) => {
    const o = topic.outcomes.find((x) => x.id === outcomeId)!;
    return eligibleReviews(records, o.id, topicTitle, o.excludeTitle);
  };
  const screeningFile = join(SCREENING_DIR, `${topic.id}.json`);
  const screening = existsSync(screeningFile) ? (JSON.parse(readFileSync(screeningFile, "utf8")) as ScreeningFile) : undefined;
  return { topic, raw, nutrient, records, topicTitle, eligible, screening, screeningFile };
}
