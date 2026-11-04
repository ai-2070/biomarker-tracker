// One question to Brain: choose the mode and the engine, prepare the data, prompt and tools, and run it.
// Modes: personal (the person's data and proposal tools), research-only (public research, no personal data),
// claim review (research-only with a structured, submitted assessment) and claim session (an audited claim
// workflow with its own tools). Engines: an API or local model (apiModel.ts) or an agent program (agentRun.ts).
import type { ModelMessage } from "ai";
import { providerInfo } from "../../src/core/aiProviders";
import { todayIso } from "../../src/core/dates";
import { measurementsIn } from "../../src/core/measurementCompletion";
import { completeProfileDetails, profileDetailsIn } from "../../src/core/profileCompletion";
import { skillIndex } from "../../src/core/skills";
import type { ClaimAssessment } from "../../src/core/claimEvidence";
import { isAgent } from "../agents";
import type { ClaimSearchSession } from "../claimSearchSession";
import { resultsOverview, safetyOf, type HealthSnapshot } from "../healthTools";
import { knowledge } from "../knowledge";
import { assistantTools } from "../mcp";
import { assistantCheck, currentChoice, readyModel, type Ready } from "../models";
import { enabledSkills } from "../skills";
import type { ToolStep } from "../steps";
import { runAgentQuestion } from "./agentRun";
import { runApiModel } from "./apiModel";
import { cacheKey } from "./cache";
import type { OnEvent } from "./events";
import { ClaimReview } from "./claimReview";
import { promptParts } from "./prompt";
import { EMPTY_SNAPSHOT, requestTools } from "./tools";

/** The one time limit for every assistant path: API models, agent programs, research and claim checks. */
export const ASSISTANT_TIMEOUT_MS = 10 * 60_000;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Photos the person chose to send with this question (base64, already shrunk on their device). */
  images?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[];
}

export type AssistantReply =
  | { ok: true; text: string; model: string; steps: ToolStep[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; claimAssessment?: ClaimAssessment; /** e.g. answered without the app's tools */ note?: string }
  | { ok: false; error: string };

export interface AskOptions {
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  researchOnly?: boolean;
  /** Structured, live-retrieval-only public claim check. */
  claimReview?: boolean;
  claimSession?: ClaimSearchSession;
  /** Original typed question, never attached documents. */
  userText?: string;
  /** Tests pass a mock model. */
  ready?: Ready;
  /** Text, tool calls and status as they happen (the streamed answer). The reply is still returned whole. */
  onEvent?: OnEvent;
}

const STOPPED = { ok: false, error: "Stopped." } as const;

/** Research-only requests keep the newest question only and never touch the caller's snapshot. */
function isolate(messages: ChatMessage[]): ChatMessage[] | undefined {
  const question = messages.filter((m) => m.role === "user").at(-1)?.content;
  if (typeof question !== "string" || !question.trim()) return undefined;
  return [{ role: "user", content: question.trim().slice(0, 20_000) }];
}

/** Profile facts and readings typed in this question, visible to the tools before the page saves them. */
function withTypedDetails(snapshot: HealthSnapshot, userText: string | undefined): HealthSnapshot {
  // Never change the caller's snapshot while preparing details for this request.
  const current = { ...snapshot.profile };
  const today = todayIso();
  const profile = userText ? completeProfileDetails(current, profileDetailsIn(userText, today), userText, today).profile : current;
  const measurements = [...snapshot.measurements];
  if (userText) {
    for (const reading of measurementsIn(userText, today, knowledge().defs)) {
      if (!measurements.some((m) => m.biomarkerId === reading.biomarkerId && m.date === reading.date)) measurements.push({ ...reading, id: crypto.randomUUID() });
    }
  }
  return { ...snapshot, profile, measurements };
}

function modelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage =>
    m.role === "user" && m.images?.length
      ? { role: "user", content: [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image" as const, image: i.data, mediaType: i.mediaType }))] }
      : { role: m.role, content: m.content },
  );
}

export async function ask(messages: ChatMessage[], snapshot: HealthSnapshot, opts: AskOptions = {}): Promise<AssistantReply> {
  if (opts.claimReview) opts = { ...opts, researchOnly: true };
  if (opts.signal?.aborted) return STOPPED;
  // Isolation is enforced here too, for direct callers, before readiness, tools or prompt construction.
  if (opts.researchOnly) {
    const only = isolate(messages);
    if (!only) return { ok: false, error: "Ask a question." };
    messages = only;
    snapshot = { ...EMPTY_SNAPSHOT, profile: {} };
  }
  const latest = messages.at(-1);
  const requestText = latest?.role === "user" ? latest.content : "";
  if (!opts.researchOnly && opts.userText !== undefined &&
    (typeof opts.userText !== "string" || !opts.userText.trim() || !requestText.startsWith(opts.userText))) {
    return { ok: false, error: "The typed question does not match the latest message." };
  }
  if (!opts.researchOnly) snapshot = withTypedDetails(snapshot, opts.userText);

  // Which engine answers.
  const choice = currentChoice();
  const agent = !opts.ready && choice && isAgent(choice.provider) ? choice : undefined;
  const scope = opts.claimReview ? "claim" : opts.researchOnly ? "research" : "personal";
  // Readiness before anything starts (research servers, prompts). OpenRouter's session is per mode.
  let ready: Ready | undefined = opts.ready;
  if (agent) {
    const check = assistantCheck();
    if (!check.ok) return { ok: false, error: check.reason };
  } else if (!ready) {
    const r = readyModel({ cacheKey: `biomarker-tracker-${scope}` });
    if (!r.ok) return { ok: false, error: r.reason };
    ready = r.ready;
  }

  // Tools: the research servers (unless an audited claim session brings its own), then the prompt.
  const servers = opts.claimSession ? { tools: {}, servers: [], failed: [] } : await assistantTools();
  if (opts.signal?.aborted) return STOPPED;
  const claim = opts.claimReview ? new ClaimReview(opts.claimSession) : undefined;
  let tools = opts.claimSession
    ? { ...opts.claimSession.tools }
    : requestTools({ snapshot, researchOnly: opts.researchOnly, claimReview: opts.claimReview, serverTools: servers.tools, fetchFn: opts.fetchFn, userText: opts.userText, requestText });
  if (claim) tools = claim.prepare(tools);
  const parts = promptParts({
    skills: skillIndex(enabledSkills()),
    cautious: !opts.researchOnly && safetyOf(snapshot).length > 0,
    critical: opts.researchOnly ? [] : resultsOverview(snapshot).critical,
    researchOnly: opts.researchOnly,
    mcpServers: servers.servers,
  });
  if (claim) parts.stable += claim.prompt();
  const key = cacheKey(scope, parts.stable);
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)]) : AbortSignal.timeout(ASSISTANT_TIMEOUT_MS);

  if (agent) {
    if (messages.some((m) => m.images?.length)) {
      return { ok: false, error: "Photos can only be sent to models used with an API key or running on this computer, not to agent programs. Choose one in Settings → AI models, or send the question without the photo." };
    }
    return runAgentQuestion({ agent, parts, messages, tools, snapshot, researchOnly: !!opts.researchOnly, claim, failedServers: servers.failed, signal, userSignal: opts.signal, ...(opts.onEvent ? { onEvent: opts.onEvent } : {}) });
  }

  if (!ready) return { ok: false, error: "Set up a model first." };
  const info = providerInfo(ready.choice.provider);
  const label = info?.models.find((m) => m.id === ready.choice.model)?.label ?? (ready.choice.model || "default model");
  const modelLabel = `${info?.label ?? ready.choice.provider} · ${label.replace(/ \(fastest\)$/, "")}`;
  return runApiModel({ ready, parts, messages: modelMessages(messages), tools, key, claim, modelLabel, maxOutputTokens: opts.claimSession?.research.depth === "deep" ? 16_000 : 8000, failedServers: servers.failed, signal, userSignal: opts.signal, ...(opts.onEvent ? { onEvent: opts.onEvent } : {}) });
}
