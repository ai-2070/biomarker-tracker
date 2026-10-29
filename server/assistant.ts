// The assistant: one model with the health tools, skills and MCP tools.
import { generateText, isStepCount, type ModelMessage, type ToolSet } from "ai";
import { skillIndex } from "../src/core/skills";
import { providerInfo } from "../src/core/aiProviders";
import { isAgent, runAgent } from "./agents";
import { setIdleTools } from "./bridge";
import { biologicalAge, experimentResults, healthTools, resultsOverview, safetyOf, type HealthSnapshot } from "./healthTools";
import { assistantTools } from "./mcp";
import { assistantCheck, currentChoice, describeModelError, readyModel, type Ready } from "./models";
import { getSettings } from "./store";
import { enabledSkills } from "./skills";
import { studyIdsFromTool, toolStep, type ToolStep } from "./steps";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Photos the person chose to send with this question (base64, already shrunk on their device). */
  images?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[];
}

export type { ToolStep } from "./steps";
export { studyIdsIn } from "./steps";

export type AssistantReply =
  | { ok: true; text: string; steps: ToolStep[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; /** e.g. answered without the app's tools */ note?: string }
  | { ok: false; error: string };

export const MAX_STEPS = 10;

// What an agent sees when it checks the app's tools between questions.
setIdleTools(() => healthTools({ measurements: [], protocols: [], experiments: [], profile: {} }));

/** The user's data as text, for agents that can't call the app's tools. Same numbers the tools give. */
export function dataPack(snapshot: HealthSnapshot): string {
  return JSON.stringify(
    {
      results: resultsOverview(snapshot),
      biologicalAge: biologicalAge(snapshot),
      log: snapshot.protocols.map((p) => ({ entry: p.label, kind: p.category, start: p.start, end: p.end ?? "ongoing" })),
      experiments: experimentResults(snapshot),
    },
    null,
    1,
  );
}

export function systemPrompt(opts: { skills: string; cautious: boolean; critical: string[]; mcpServers: { id: string; name: string; about: string }[] }): string {
  const lines = [
    "You are the research assistant in Biomarker Tracker, an app where people track their blood tests and body measurements (weight, waist, blood pressure, resting heart rate). You explain results and research in plain language to someone without medical training.",
    "",
    "How to work:",
    "- Get every number from your tools (get_results, get_marker, get_biological_age, get_body_summary, compare_before_after, get_levers). Never calculate a number yourself and present it as fact; for BMI, basal metabolic rate, heart age and averages of body measurements use get_body_summary.",
    "- For research, use search_research or the connected research tools, and cite only studies that a tool returned in this conversation, with the ID in square brackets exactly as returned, e.g. [PMID:12345678]. Never invent studies, authors or IDs.",
    "- Say how strong the evidence is. If the evidence you found doesn't answer the question, say so.",
    "- To read or summarize a specific study the user names, look it up with get_study using its ID, and cite it by that ID.",
    "- For questions about a vitamin, mineral or a supplement of one, read get_nutrient first. Keep supplement findings and food findings apart. EFSA reference intakes and upper limits are population values: never turn them into a dose for this person.",
    "- When a task matches a skill below, call read_skill first and follow it.",
    "- Never put the user's personal details into a search.",
    "",
    "Safety rules (always):",
    "- Don't diagnose. Don't tell anyone to start, stop or change a medicine. Don't give personal doses.",
    "- Out-of-range or fast-changing results: suggest discussing them with a doctor.",
    "- No calorie targets or weight-loss plans.",
    "- Keep answers short: under 300 words unless asked for more. Explain medical terms.",
    "- Photos: if the user sends a photo of their body, describe only what is plainly visible, in neutral general terms. Never estimate weight, body fat, BMI, muscle mass or age from a photo, and never compare bodies or comment on attractiveness. Never assess skin, moles, marks, wounds, rashes or swelling: say a doctor should look at anything like that. If the photo shows a screen or document, read it.",
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
  if (opts.mcpServers.length) {
    lines.push("", "Research servers (call research_tools with the id to see their tools, then use_research_tool):");
    for (const s of opts.mcpServers) lines.push(`- ${s.id}: ${s.name}${s.about ? `. ${s.about}` : ""}`);
  }
  return lines.join("\n");
}

export async function ask(
  messages: ChatMessage[],
  snapshot: HealthSnapshot,
  opts: { signal?: AbortSignal; fetchFn?: typeof fetch; /** Tests pass a mock model. */ ready?: Ready } = {},
): Promise<AssistantReply> {
  const settings = getSettings();
  const choice = currentChoice();
  const agent = !opts.ready && choice && isAgent(choice.provider) ? choice : undefined;
  const r = opts.ready ? ({ ok: true, ready: opts.ready } as const) : agent ? undefined : readyModel();
  if (r && !r.ok) return { ok: false, error: r.reason };
  if (agent) {
    const check = assistantCheck();
    if (!check.ok) return { ok: false, error: check.reason };
  }

  const mcp = await assistantTools();
  const tools: ToolSet = { ...mcp.tools, ...healthTools(snapshot, opts.fetchFn) };
  const overview = resultsOverview(snapshot);
  const system = systemPrompt({
    skills: skillIndex(enabledSkills()),
    cautious: safetyOf(snapshot).length > 0,
    critical: overview.critical,
    mcpServers: mcp.servers,
  });

  if (agent && messages.some((m) => m.images?.length)) {
    return { ok: false, error: "Photos can only be sent to models used with an API key or running on this computer, not to agent programs. Choose one in Settings → AI models, or send the question without the photo." };
  }

  if (agent && isAgent(agent.provider)) {
    const profile = settings.providers[agent.provider]?.profile;
    const a = await runAgent({
      provider: agent.provider,
      model: agent.model,
      ...(agent.effort ? { effort: agent.effort } : {}),
      ...(profile ? { profile } : {}),
      system,
      messages,
      tools,
      dataPack: () => dataPack(snapshot),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!a.ok) return a;
    const note = a.usedTools ? undefined : `${providerInfo(agent.provider)!.label} answered from a summary of your data, without the app's research tools, so its citations can't be checked.`;
    return { ok: true, text: a.text, steps: a.steps, studyIds: a.studyIds, truncated: false, failedServers: mcp.failed, ...(note ? { note } : {}) };
  }
  const { model, providerOptions } = r!.ready;

  try {
    const res = await generateText({
      model,
      system,
      messages: messages.map((m): ModelMessage =>
        m.role === "user" && m.images?.length
          ? { role: "user", content: [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image" as const, image: i.data, mediaType: i.mediaType }))] }
          : { role: m.role, content: m.content },
      ),
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
        steps.push(toolStep(c.toolName, c.input));
      }
      for (const tr of step.toolResults) for (const id of studyIdsFromTool(tr.toolName, tr.output)) ids.add(id);
    }
    return { ok: true, text: res.text, steps, studyIds: [...ids], truncated: res.finishReason === "length", failedServers: mcp.failed };
  } catch (e) {
    return { ok: false, error: describeModelError(e) };
  }
}
