// A claim check (research-only, structured): which research actually ran, which study IDs it returned, and
// the assessment the model submitted through a tool. The page saves only that submission, never prose.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { validateClaimAssessment, type ClaimAssessment } from "@bt/shared/core/claimEvidence";
import type { ClaimSearchSession } from "../claimSearchSession";
import { studyIdsFromTool, toolStep, validateToolResult } from "../steps";

export const CLAIM_REVIEW_PROMPT = "\n\nFor this claim review, submit the completed result through submit_claim_assessment after retrieving and reading relevant research. Do not put JSON in the final answer: the page saves the tool result, not your prose. Use verdict supported, mixed, not supported, or not enough evidence; use grade null exactly when evidence is insufficient, otherwise high, moderate, low, or very low. Give a concise summary and limitations naming the search scope, population and important limits. Citations must be exact PMID:, PMCID: or DOI: IDs returned by live research tools in this request, never skills or memory. A graded verdict needs relevant retrieved human evidence. A successful search with no relevant evidence can only give not enough evidence with null grade; absence is not a confident negative finding. If the tool returns a validation error, correct the assessment using the retrieved evidence. Once submission succeeds, the check is complete: stop research and end your answer briefly. Do not supply timestamps or model names; code supplies them.";

/**
 * Observes actual executions, not a model's claimed search or a proposed tool call. With an audited claim
 * session, the session does its own bookkeeping and this only reads its assessment.
 */
export class ClaimReview {
  private retrieved = false;
  private retrievalFailed = false;
  private readonly ids = new Set<string>();
  private submitted: ClaimAssessment | undefined;
  private submissionError: string | undefined;

  constructor(private readonly session?: ClaimSearchSession) {}

  /** Wraps the research tools to record what they returned, and adds submit_claim_assessment. */
  prepare(tools: ToolSet): ToolSet {
    if (this.session) return tools;
    const out: ToolSet = {};
    for (const [name, definition] of Object.entries(tools)) {
      if (!definition.execute || name === "read_skill" || name === "research_tools") {
        out[name] = definition;
        continue;
      }
      const execute = definition.execute;
      out[name] = { ...definition, execute: async (input, context) => {
        try {
          const output = await execute(input, context);
          const action = toolStep(name, input);
          validateToolResult(action, output);
          const ids = studyIdsFromTool(name, output);
          const emptySearch = name === "search_research" && !!output && typeof output === "object" &&
            "studies" in output && Array.isArray(output.studies) && output.studies.length === 0 &&
            "total" in output && output.total === 0;
          if (!action.success || (!ids.length && !emptySearch)) this.retrievalFailed = true;
          else { this.retrieved = true; for (const id of ids) this.ids.add(id); }
          return output;
        } catch (error) {
          this.retrievalFailed = true;
          throw error;
        }
      } };
    }
    out.submit_claim_assessment = tool({
      description: "Submit the completed evidence assessment after searching live research. This supplies the page's saved result; final chat wording is not used. Use only retrieved study IDs.",
      inputSchema: z.object({
        verdict: z.enum(["supported", "mixed", "not supported", "not enough evidence"]),
        grade: z.enum(["high", "moderate", "low", "very low"]).nullable(),
        summary: z.string().min(12).max(600),
        limitations: z.string().min(12).max(800),
        citations: z.array(z.string()).max(20),
      }).strict(),
      execute: async (input) => {
        const error = this.retrievalError();
        if (error) return { error: error.error };
        try {
          this.submitted = validateClaimAssessment(input, [...this.ids]);
          this.submissionError = undefined;
          return { recorded: true };
        } catch (e) {
          this.submissionError = e instanceof Error ? e.message : "The assessment could not be validated.";
          return { error: this.submissionError };
        }
      },
    });
    return out;
  }

  /** Extra system prompt for claim checks (stable for every check of the same kind). */
  prompt(): string {
    return CLAIM_REVIEW_PROMPT + (this.session ? `\n\nThe following audited workflow takes precedence over the generic claim-review instructions above:\n${this.session.prompt}` : "");
  }

  assessment(): ClaimAssessment | undefined {
    return this.session?.assessment ?? this.submitted;
  }

  /** Why nothing may be saved: no live research, or a source failed. Undefined when retrieval is fine. */
  retrievalError(): { ok: false; error: string } | undefined {
    if (this.session) return undefined;
    if (this.retrieved && !this.retrievalFailed) return undefined;
    return {
      ok: false,
      error: this.retrievalFailed ? "A research source failed or returned unverifiable results. No evidence grade was saved." : "No live research was retrieved. This model cannot create a verified evidence check without the app's research tools.",
    };
  }

  /** The error to return when the check can't be saved, after the model finished. */
  finalError(): { ok: false; error: string } | undefined {
    const retrieval = this.retrievalError();
    if (retrieval) return retrieval;
    if (!this.assessment()) return { ok: false, error: this.submissionError ?? "The model did not submit its evidence assessment. No new grade was saved." };
    return undefined;
  }

  /** Study IDs the answer may cite. */
  studyIds(fallback: string[]): string[] {
    return this.session ? [...this.session.papers.keys()] : fallback;
  }
}
