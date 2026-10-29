/** Shared by build.ts and screen.ts: a topic's downloaded records (fetch.ts), classified, one per paper. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { anyDesignKind, classify, eligibleReviews, type Decision, type EvidenceRecord, type Question } from "../../src/core/evidenceMap";
import type { ComparisonTopicFile } from "../../src/core/foodComparison";
import type { NutrientDef } from "../../src/core/nutrients";
import type { LifestyleDef } from "../../src/core/lifestyle";
import type { Citation } from "../../src/core/types";
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
    /** Food maps: records each claim's own search found. */
    outcomeCounts?: Record<string, number>;
    records: { reviews: EvidenceRecord[]; trials: EvidenceRecord[]; guidelines: EvidenceRecord[] };
  };
  // Food and lifestyle maps: a search per claim or finding, reviews of any design.
  const food = anyDesignKind(topic.kind);
  const read = <T,>(...path: string[]) => JSON.parse(readFileSync(join(ROOT, "knowledge", ...path), "utf8")) as T;
  // What each outcome checks, and the studies it cites: a nutrient finding, or a food comparison claim.
  const claims = topic.kind === "food" ? read<ComparisonTopicFile>("food-comparison", `${topic.comparisonId}.json`).claims : [];
  const findings =
    topic.kind === "lifestyle" ? read<LifestyleDef>("lifestyle", `${topic.lifestyleId}.json`).findings : topic.kind === "food" ? [] : read<NutrientDef>("nutrients", `${topic.nutrientId}.json`).findings;
  const studiesFor = (finding: string | undefined): Citation[] =>
    !finding ? [] : topic.kind === "food" ? (claims.find((c) => c.id === finding)?.studies ?? []) : (findings.find((f) => f.outcome === finding)?.studies ?? []);
  // One record per paper (a review can also be a guideline).
  const seen = new Set<string>();
  const records = [...raw.records.guidelines, ...raw.records.reviews, ...raw.records.trials]
    .filter((r) => {
      const key = r.pmid ?? r.doi ?? r.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => classify(r, topic.outcomes))
    .filter((r) => !topic.localFilter || topic.localFilter.test(`${r.title} ${r.abstract}`));
  // The topic's own terms (plain words, no special characters) must be in a review's title. Food maps
  // search claim by claim, so the claim's own search and title words do that job.
  const topicTitle = food ? undefined : (topic.titleTerms ?? new RegExp(topic.terms.join("|"), "i"));
  const eligible = (outcomeId: string) => {
    const o = topic.outcomes.find((x) => x.id === outcomeId)!;
    return eligibleReviews(records, o.id, topicTitle, o.excludeTitle, food ? topic.kind : o.anyDesign ? "food" : "supplement");
  };
  const screeningFile = join(SCREENING_DIR, `${topic.id}.json`);
  const screening = existsSync(screeningFile) ? (JSON.parse(readFileSync(screeningFile, "utf8")) as ScreeningFile) : undefined;
  return { topic, raw, food, studiesFor, records, topicTitle, eligible, screening, screeningFile };
}
