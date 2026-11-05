// What the assistant did (tool steps) and which studies it saw. Shared by the API-model loop and the agent bridge.
import { normalizeId } from "@bt/shared/ai/citations";

export interface ToolStep {
  tool: string;
  /** For MCP tools: the server id. */
  server?: string;
  input: string;
  /** Only built-in mutation tools, after an actual successful result. */
  validated?: boolean;
  /** An actual completed tool result, never a model's proposed call alone. */
  success?: boolean;
  /** Server proposal result; a confirmation card requires a successful validated result. */
  output?: unknown;
}

export function toolStep(name: string, input: unknown): ToolStep {
  // A research server's tool, called through use_research_tool: show the server and its tool.
  if (name === "use_research_tool" && typeof input === "object" && input !== null) {
    const i = input as { server?: unknown; tool?: unknown; input?: unknown };
    if (typeof i.server === "string" && typeof i.tool === "string") return { tool: i.tool, server: i.server, input: JSON.stringify(i.input ?? {}).slice(0, 200) };
  }
  const [server, tool] = name.includes("__") ? name.split("__", 2) : [undefined, name];
  // Action inputs stay whole: the page rechecks the original quotes/proposals before applying them.
  const mutation = server === undefined && isMutationTool(tool!);
  const text = JSON.stringify(input ?? {});
  const max = tool === "save_profile_details" && server === undefined ? 64 * 1024 : mutation ? undefined : 200;
  return { tool: tool!, ...(server !== undefined ? { server } : {}), input: text.slice(0, max), ...(mutation ? { validated: false } : {}) };
}

export function isMutationTool(name: string): boolean {
  return ["save_profile_details", "propose_protocol", "propose_meal", "propose_habit"].includes(name);
}

/** Failed, missing and unexecuted calls remain false; MCP lookalikes never receive this handshake. */
export function validateToolResult(step: ToolStep, output: unknown): void {
  const result = typeof output === "object" && output !== null ? output as Record<string, unknown> : undefined;
  step.success = !result || (!("error" in result) && result.isError !== true);
  if (step.server !== undefined || !isMutationTool(step.tool)) return;
  step.validated = step.success && !!result && (step.tool === "save_profile_details"
    ? Array.isArray(result.added) && result.added.length > 0
    : typeof result.shownToPerson === "object" && result.shownToPerson !== null);
  step.success = step.validated;
  if (step.validated && step.tool !== "save_profile_details") step.output = output;
}

/** Collect identifiers only from structured study records, never prose or echoed errors. */
export function studyIdsIn(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if ("error" in record || record.isError === true) return;
    if (typeof record.title === "string" && record.title.trim()) {
      for (const kind of ["pmid", "pmcid", "doi"] as const) {
        const v = record[kind] ?? record[kind.toUpperCase()];
        if (typeof v !== "string" && typeof v !== "number") continue;
        const text = String(v).trim();
        if ((kind === "pmid" && /^\d{4,9}$/.test(text)) || (kind === "pmcid" && /^(?:PMC)?\d+$/i.test(text)) || (kind === "doi" && /^10\.\d{4,9}\/\S+$/i.test(text))) ids.add(normalizeId(kind, text));
      }
      if (typeof record.id === "string") {
        const match = /^(PMID|PMCID|DOI):(PMC\d+|\d{4,9}|10\.\d{4,9}\/\S+)$/i.exec(record.id);
        if (match) ids.add(normalizeId(match[1]!, match[2]!));
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "instructions" || key === "input" || key === "arguments") continue;
      // MCP text blocks may contain JSON study records. Plain text cannot establish authority.
      if (key === "text" && record.type === "text" && typeof child === "string") {
        try { visit(JSON.parse(child)); } catch { /* Unstructured text is not a retrieved record. */ }
      } else visit(child);
    }
  };
  if (typeof value === "string") {
    try { visit(JSON.parse(value)); } catch { /* Unstructured text is not a retrieved record. */ }
  } else visit(value);
  return [...ids];
}


/** Study IDs a tool call returned. Skill instructions contain example IDs, so they never count. */
export function studyIdsFromTool(name: string, output: unknown): string[] {
  // Instructions and tool listings can contain example IDs; only real results count.
  return name === "read_skill" || name === "research_tools" ? [] : studyIdsIn(output);
}
