import {
  type ClaimAssessment,
  type ClaimDepth,
  type ClaimResearch,
  type ClaimSearchPlan,
  type ClaimSearchRung,
  claimSearchQuery,
  completeClaimLadder,
  publicClaimTopic,
  validateClaimAssessment,
  validateClaimResearch,
} from "@bt/shared/core/claimEvidence";
import { EUROPE_PMC, type Paper, parseEuropePmc, studyQuery } from "@bt/shared/research/papers";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

const synonyms = z.array(z.string().min(2).max(100)).max(6);
const screeningSchema = z
  .object({
    id: z.string().max(240),
    decision: z.enum(["direct", "indirect", "exclude"]),
    reason: z.string().min(8).max(500),
    route: z.enum(["oral", "topical", "other", "unclear"]),
    formulation: z.enum(["alone", "combination", "unclear"]),
    evidence: z.enum(["human_trial", "human_review", "human_other", "preclinical", "unclear"]),
  })
  .strict();
const assessmentSchema = z
  .object({
    verdict: z.enum(["supported", "mixed", "not supported", "not enough evidence"]),
    grade: z.enum(["high", "moderate", "low", "very low"]).nullable(),
    summary: z.string().min(12).max(600),
    limitations: z.string().min(12).max(800),
    citations: z.array(z.string()).max(20),
  })
  .strict();

/** One public claim, one deterministic search ladder, and a complete per-record screening ledger. */
export class ClaimSearchSession {
  readonly research: ClaimResearch;
  readonly tools: ToolSet;
  readonly papers = new Map<string, Paper>();
  assessment?: ClaimAssessment;
  private preparing?: Promise<unknown>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly intervention: string,
    readonly outcome: string,
    depth: ClaimDepth,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly signal?: AbortSignal,
  ) {
    this.research = { depth, status: "search_failed", queries: [], records: [], screening: [], retrieved: 0, screened: 0, included: 0 };
    this.tools = {
      prepare_claim_search: tool({
        description:
          "First step: extract intervention/outcome synonyms from this claim. Code builds and runs the review, randomized-trial and broad queries in order. Do not supply Boolean queries, unrelated topics or exclude routes/blends.",
        inputSchema: z.object({ interventionSynonyms: synonyms, outcomeSynonyms: synonyms, route: z.enum(["oral", "topical", "any"]) }).strict(),
        execute: async (input) => {
          if (!this.preparing) this.preparing = this.prepare(input);
          return this.preparing;
        },
      }),
      search_research: tool({
        description:
          "Extra queries only AFTER prepare_claim_search finishes. Supply alternative outcome words and intervention synonyms, not free-form queries. The intervention and outcome are always joined with AND. Every extra query is recorded.",
        inputSchema: z.object({ interventionSynonyms: synonyms, outcomeSynonyms: synonyms, filter: z.enum(["reviews", "trials", "all"]) }).strict(),
        execute: async (input) =>
          this.serial(async () => {
            if (!this.ladderReady()) return { error: "Complete prepare_claim_search before extra research." };
            if (this.research.queries.length >= (depth === "deep" ? 20 : 8))
              return { error: "Search budget reached. Screen the retrieved records and submit, or use a deeper check." };
            const plan = {
              ...this.research.plan!,
              interventionSynonyms: this.words(input.interventionSynonyms),
              outcomeSynonyms: this.words(input.outcomeSynonyms),
            };
            const rung = input.filter === "all" ? "broad" : input.filter;
            return this.search(claimSearchQuery(plan, rung), "extra");
          }),
      }),
      get_study: tool({
        description: "Read a study abstract by its retrieved ID after the full ladder. Lookups and their result counts are recorded too.",
        inputSchema: z.object({ id: z.string().max(240) }).strict(),
        execute: async ({ id }) =>
          this.serial(async () => {
            if (!this.ladderReady()) return { error: "Complete prepare_claim_search first." };
            const query = studyQuery(id);
            if (!query || !this.papers.has(id)) return { error: "Use an ID already retrieved by this check." };
            if (this.research.queries.length >= 30) return { error: "Lookup budget reached." };
            return this.search(query, "lookup", 1);
          }),
      }),
      screen_claim_records: tool({
        description:
          "Screen every retrieved record, including unrelated results. Tag relevant records direct or indirect with a reason, route, formulation and evidence type. Include blends and topical/other routes as indirect when attribution differs; do not discard them by scope. You may screen in batches.",
        inputSchema: z.object({ records: z.array(screeningSchema).max(300) }).strict(),
        execute: async ({ records }) =>
          this.serial(async () => {
            if (!this.ladderReady()) return { error: "Complete the search ladder before screening." };
            const next = new Map(this.research.screening.map((record) => [record.id, record]));
            for (const record of records) {
              if (!this.papers.has(record.id)) return { error: `Study ${record.id} was not retrieved.` };
              next.set(record.id, record);
            }
            const candidate = [...next.values()];
            try {
              validateClaimResearch(
                {
                  ...this.research,
                  screening: candidate,
                  screened: candidate.length,
                  included: candidate.filter((record) => record.decision !== "exclude").length,
                  status: "search_failed",
                  error: "Screening in progress.",
                },
                { verdict: "not enough evidence", grade: null, summary: "Screening in progress.", limitations: "Screening in progress.", citations: [] },
              );
            } catch (error) {
              return { error: error instanceof Error ? error.message : "Invalid screening." };
            }
            this.research.screening = [...next.values()];
            this.counts();
            return { screened: this.research.screened, included: this.research.included, remainingIds: [...this.papers.keys()].filter((id) => !next.has(id)) };
          }),
      }),
      submit_claim_assessment: tool({
        description:
          "Submit only after the full clean ladder and screening of EVERY retrieved record. Direct evidence needs a grade; indirect-only evidence must be very low. No relevant evidence uses null, and never means evidence of no effect.",
        inputSchema: assessmentSchema,
        execute: async (input) =>
          this.serial(async () => {
            try {
              const assessment = validateClaimAssessment(input, [...this.papers.keys()]);
              const included = this.research.screening.filter((record) => record.decision !== "exclude");
              this.research.status = included.some((record) => record.decision === "direct")
                ? "evidence_found"
                : included.length
                  ? "indirect_only"
                  : "no_evidence";
              validateClaimResearch(this.research, assessment);
              this.assessment = assessment;
              return { recorded: true };
            } catch (error) {
              this.research.status = "search_failed";
              return { error: error instanceof Error ? error.message : "Invalid assessment." };
            }
          }),
      }),
    };
  }

  readonly prompt = [
    "This claim has an audited search workflow. Your FIRST tool call must be prepare_claim_search. Extract synonyms for the named intervention and the claimed outcome; use concise scientific alternatives (including related measured endpoints) rather than requiring every outcome word together. Never send a Boolean query or an unrelated intervention as a synonym. The canonical intervention and outcome cannot be replaced.",
    "Use route any unless the public claim explicitly specifies a route. The automatic ladder always runs reviews first, then randomized trials, then a broad search, by relevance. An empty rung is not a conclusion. Inspect all returned abstracts. Then use search_research for your own additional structured searches if the first results are thin or the synonyms need expansion.",
    "Call screen_claim_records for EVERY retrieved ID, including exclusions, with an explicit reason. Include combination products, oral/topical preparations, related outcomes and laboratory evidence; label them indirect where attribution, route, population, outcome or evidence type differs. Never exclude a record merely because it is a blend or has another route. Exclude only unrelated, retracted, or unusable evidence, explaining why. Do not promote a related endpoint or blend into proof for the exact claim.",
    "A relevant human trial/review with attributable intervention, matching route and outcome may be direct even if small, negative, or imperfect. Low certainty is a low/very low grade, not missing evidence. Grades reflect certainty, not whether the effect is positive. Assess risk of bias, consistency, precision and applicability; a meta-analysis alone does not guarantee a high grade. Explicitly describe abstract-only limits.",
    "Submit via submit_claim_assessment. If only indirect evidence was included, use grade very low and a suitably qualified verdict (usually mixed). If direct evidence was included, assign high/moderate/low/very low as warranted; never null. If all records were screened out, use not enough evidence with null grade and no citations. A search failure or incomplete screening must never become no evidence. Cite only included retrieved IDs. Correct validation errors and stop once recorded.",
  ].join("\n");

  private words(values: string[]): string[] {
    if (values.some((word) => !publicClaimTopic(word) || /\b(?:AND|OR|NOT|TITLE_ABS|PUB_TYPE|SORT)\b/.test(word)))
      throw new Error("Use public synonym phrases, not search instructions.");
    return [...new Set(values.map((word) => publicClaimTopic(word)!))];
  }

  private async prepare(input: { interventionSynonyms: string[]; outcomeSynonyms: string[]; route: ClaimSearchPlan["route"] }): Promise<unknown> {
    this.research.plan = {
      intervention: this.intervention,
      outcome: this.outcome,
      interventionSynonyms: this.words(input.interventionSynonyms),
      outcomeSynonyms: this.words(input.outcomeSynonyms),
      route: input.route,
    };
    const results: unknown[] = [];
    // Deliberately sequential: no early exit after a hit or an empty/error rung.
    for (const rung of ["reviews", "trials", "broad"] as const) results.push(await this.search(claimSearchQuery(this.research.plan, rung), rung));
    if (completeClaimLadder(this.research) && this.papers.size === 0) {
      this.research.status = "no_evidence";
      this.assessment = {
        verdict: "not enough evidence",
        grade: null,
        summary: "No relevant records were found after the complete review, randomized-trial and broad search ladder.",
        limitations:
          "All three queries completed without errors. Zero retrieved records were screened; this bounded search is not proof that no evidence exists.",
        citations: [],
      };
    }
    return { results, retrieved: this.papers.size, searchFailed: !!this.research.error, complete: completeClaimLadder(this.research) };
  }

  private ladderReady(): boolean {
    return this.research.queries.length >= 3 && ["reviews", "trials", "broad"].every((rung, i) => this.research.queries[i]?.rung === rung);
  }

  private async search(query: string, rung: ClaimSearchRung, pageSize = this.research.depth === "deep" ? 30 : 12): Promise<unknown> {
    this.signal?.throwIfAborted();
    const entry = {
      rung,
      query,
      source: "europepmc" as const,
      sort: "relevance" as const,
      resultCount: null as number | null,
      ids: [] as string[],
      error: undefined as string | undefined,
    };
    this.research.queries.push(entry);
    try {
      // Europe PMC's default ordering is relevance; no date/citation sort is added.
      const params = new URLSearchParams({ query, format: "json", resultType: "core", pageSize: String(pageSize), synonym: "true" });
      const signal = this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
      const response = await this.fetchFn(`${EUROPE_PMC}?${params}`, { signal });
      if (!response.ok) throw new Error(`Research search failed (HTTP ${response.status}).`);
      const raw: unknown = await response.json();
      if (!raw || typeof raw !== "object" || !("hitCount" in raw) || !Number.isSafeInteger(raw.hitCount) || Number(raw.hitCount) < 0 || "error" in raw)
        throw new Error("Invalid search response or missing result count.");
      const result = parseEuropePmc(raw);
      entry.resultCount = result.total;
      if (result.total > 0 && result.papers.length === 0) throw new Error("Search reported hits but returned no usable records. Retry.");
      for (const paper of result.papers) this.papers.set(paper.id, paper);
      entry.ids = [...new Set(result.papers.map((paper) => paper.id))];
      this.counts();
      return {
        rung,
        query,
        total: result.total,
        studies: result.papers.map((paper) => ({ ...paper, abstract: paper.abstract?.slice(0, this.research.depth === "deep" ? 6000 : 3000) ?? null })),
      };
    } catch (error) {
      this.signal?.throwIfAborted();
      entry.error = error instanceof Error ? error.message.slice(0, 500) : "Search failed.";
      this.research.error = "Search failed, retry. At least one query failed or returned unusable results.";
      return { error: entry.error, rung, query, total: entry.resultCount };
    }
  }

  private counts(): void {
    this.research.records = [...this.papers.values()].map(({ id, title }) => ({ id, title }));
    this.research.retrieved = this.papers.size;
    this.research.screened = this.research.screening.length;
    this.research.included = this.research.screening.filter((record) => record.decision !== "exclude").length;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(work);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  failure(reason: string): ClaimAssessment {
    this.assessment = undefined;
    this.research.status = "search_failed";
    this.research.error = `Search failed, retry. ${reason}`.slice(0, 800);
    return {
      verdict: "not enough evidence",
      grade: null,
      summary: "The check did not complete a verified search and assessment. Retry or run a deeper check.",
      limitations: this.research.error,
      citations: [],
    };
  }
}
