// The assistant: one model with the health tools, skills and MCP tools.
import { generateText, isStepCount, type ModelMessage, type ToolSet } from "ai";
import { normalizeId } from "../src/ai/citations";
import { skillIndex } from "../src/core/skills";
import { healthTools, resultsOverview, safetyOf, type HealthSnapshot } from "./healthTools";
import { assistantTools } from "./mcp";
import { describeModelError, readyModel, type Ready } from "./models";
import { enabledSkills } from "./skills";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolStep {
  tool: string;
  /** For MCP tools: the server id. */
  server?: string;
  input: string;
}

export type AssistantReply =
  | { ok: true; text: string; steps: ToolStep[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[] }
  | { ok: false; error: string };

export const MAX_STEPS = 10;

export function systemPrompt(opts: { skills: string; cautious: boolean; critical: string[]; mcpServers: string[] }): string {
  const lines = [
    "You are the research assistant in Biomarker Tracker, an app where people track their blood tests. You explain results and research in plain language to someone without medical training.",
    "",
    "How to work:",
    "- Get every number from your tools (get_results, get_marker, get_biological_age, compare_before_after, get_levers). Never calculate a number yourself and present it as fact.",
    "- For research, use search_research or the connected research tools, and cite only studies that a tool returned in this conversation, with the ID in square brackets exactly as returned, e.g. [PMID:12345678]. Never invent studies, authors or IDs.",
    "- Say how strong the evidence is. If the evidence you found doesn't answer the question, say so.",
    "- When a task matches a skill below, call read_skill first and follow it.",
    "- Never put the user's personal details into a search.",
    "",
    "Safety rules (always):",
    "- Don't diagnose. Don't tell anyone to start, stop or change a medicine. Don't give personal doses.",
    "- Out-of-range or fast-changing results: suggest discussing them with a doctor.",
    "- No calorie targets or weight-loss plans.",
    "- Keep answers short: under 300 words unless asked for more. Explain medical terms.",
  ];
  if (opts.critical.length) {
    lines.push(
      `- CRITICAL: these latest results are far outside the usual range: ${opts.critical.join(", ")}. Before anything else, tell the user to contact a doctor or their lab promptly, and to call emergency services if they feel unwell. Don't interpret those results further.`,
    );
  }
  if (opts.cautious) {
    lines.push("- The user's log has a blood thinner, diabetes medicine, pregnancy or kidney disease. Don't suggest increasing any nutrient, food or supplement; say changes should be discussed with their doctor.");
  }
  if (opts.skills) lines.push("", "Skills (load one with read_skill):", opts.skills);
  if (opts.mcpServers.length) lines.push("", `Connected research tools: ${opts.mcpServers.join(", ")}. Their tool names start with the server id.`);
  return lines.join("\n");
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

export async function ask(
  messages: ChatMessage[],
  snapshot: HealthSnapshot,
  opts: { signal?: AbortSignal; fetchFn?: typeof fetch; /** Tests pass a mock model. */ ready?: Ready } = {},
): Promise<AssistantReply> {
  const r = opts.ready ? ({ ok: true, ready: opts.ready } as const) : readyModel();
  if (!r.ok) return { ok: false, error: r.reason };
  const { model, providerOptions } = r.ready;

  const mcp = await assistantTools();
  const tools: ToolSet = { ...mcp.tools, ...healthTools(snapshot, opts.fetchFn) };
  const overview = resultsOverview(snapshot);
  const system = systemPrompt({
    skills: skillIndex(enabledSkills()),
    cautious: safetyOf(snapshot).length > 0,
    critical: overview.critical,
    mcpServers: [...new Set(Object.keys(mcp.tools).map((n) => n.split("__")[0]!))],
  });

  try {
    const res = await generateText({
      model,
      system,
      messages: messages.map((m): ModelMessage => ({ role: m.role, content: m.content })),
      tools,
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: 8000,
      providerOptions,
      abortSignal: opts.signal ?? AbortSignal.timeout(180_000),
    });
    const steps: ToolStep[] = [];
    const ids = new Set<string>();
    for (const step of res.steps) {
      for (const c of step.toolCalls) {
        const [server, tool] = c.toolName.includes("__") ? c.toolName.split("__", 2) : [undefined, c.toolName];
        steps.push({ tool: tool!, ...(server ? { server } : {}), input: JSON.stringify(c.input ?? {}).slice(0, 200) });
      }
      for (const tr of step.toolResults) for (const id of studyIdsIn(tr.output)) ids.add(id);
    }
    return { ok: true, text: res.text, steps, studyIds: [...ids], truncated: res.finishReason === "length", failedServers: mcp.failed };
  } catch (e) {
    return { ok: false, error: describeModelError(e) };
  }
}
