// Which tools a question gets. The set and its order stay the same for every question in a mode (the
// provider's prompt cache starts with the tools): the app's own tools first, in their fixed order, then the
// research-server tools. What a tool may do in this request is checked when it runs, not by leaving it out.
import type { ToolSet } from "ai";
import { healthTools, type HealthSnapshot } from "../healthTools";

export const EMPTY_SNAPSHOT: HealthSnapshot = { measurements: [], protocols: [], experiments: [], profile: {} };

/** Public research tools only, built without a caller's snapshot: no personal or proposal tools. */
export function researchOnlyTools(fetchFn?: typeof fetch, claimReview = false): ToolSet {
  const publicTools = healthTools({ ...EMPTY_SNAPSHOT, profile: {} }, fetchFn);
  const names = claimReview
    ? ["search_research", "get_study", "read_skill"]
    : ["search_research", "get_study", "get_nutrient", "get_whole_food", "get_lifestyle", "find_foods", "read_skill"];
  return Object.fromEntries(names.map((name) => [name, publicTools[name]!]));
}

export function requestTools(o: {
  snapshot: HealthSnapshot;
  researchOnly?: boolean;
  claimReview?: boolean;
  /** The research servers' two tools (mcp.ts), or nothing when none is ready. */
  serverTools: ToolSet;
  fetchFn?: typeof fetch;
  userText?: string;
  requestText: string;
  /** Photos or scanned pages came with the newest question (propose_results). */
  images?: boolean;
}): ToolSet {
  const own = o.researchOnly
    ? researchOnlyTools(o.fetchFn, o.claimReview)
    : healthTools(o.snapshot, o.fetchFn, { userText: o.userText, requestText: o.requestText, images: o.images });
  return { ...own, ...o.serverTools };
}
