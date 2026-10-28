// What the assistant did (tool steps) and which studies it saw. Shared by the API-model loop and the agent bridge.
import { normalizeId } from "../src/ai/citations";

export interface ToolStep {
  tool: string;
  /** For MCP tools: the server id. */
  server?: string;
  input: string;
}

export function toolStep(name: string, input: unknown): ToolStep {
  // A research server's tool, called through use_research_tool: show the server and its tool.
  if (name === "use_research_tool" && typeof input === "object" && input !== null) {
    const i = input as { server?: unknown; tool?: unknown; input?: unknown };
    if (typeof i.server === "string" && typeof i.tool === "string") return { tool: i.tool, server: i.server, input: JSON.stringify(i.input ?? {}).slice(0, 200) };
  }
  const [server, tool] = name.includes("__") ? name.split("__", 2) : [undefined, name];
  return { tool: tool!, ...(server ? { server } : {}), input: JSON.stringify(input ?? {}).slice(0, 200) };
}

const ID_IN_TEXT = /\b(PMID|PMCID)\s*:?\s*"?(PMC\d+|\d{4,9})\b/gi;
const PMID_FIELD = /"(pmid|pmcid|PMID|PMCID)"\s*:\s*"?(PMC\d+|\d{4,9})"?/g;

/** Every study ID that appeared in a tool result: the only ones the answer may cite. */
export function studyIdsIn(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const ids = new Set<string>();
  for (const m of text.matchAll(ID_IN_TEXT)) ids.add(normalizeId(m[1]!, m[2]!));
  for (const m of text.matchAll(PMID_FIELD)) ids.add(normalizeId(m[1]!, m[2]!));
  return [...ids];
}


/** Study IDs a tool call returned. Skill instructions contain example IDs, so they never count. */
export function studyIdsFromTool(name: string, output: unknown): string[] {
  // Instructions and tool listings can contain example IDs; only real results count.
  return name === "read_skill" || name === "research_tools" ? [] : studyIdsIn(output);
}
