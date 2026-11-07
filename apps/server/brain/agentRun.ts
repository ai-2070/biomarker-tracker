// An agent program (Claude Code, Codex, Hermes, OpenClaw) answering one question. Each question starts the
// program fresh, so nothing of the conversation is kept in the program's own folders; the stable system
// prompt is its prefix. Bridged programs reach the app's tools; the others get a data summary.

import { type ModelChoice, providerInfo } from "@bt/shared/core/aiProviders";
import type { ToolSet } from "ai";
import { isAgent, runAgent } from "../agents";
import type { HealthSnapshot } from "../healthTools";
import { getSettings } from "../store";
import type { AssistantReply, ChatMessage } from "./ask";
import type { ClaimReview } from "./claimReview";
import { dataPack } from "./dataPack";
import type { OnEvent } from "./events";
import type { PromptParts } from "./prompt";

export async function runAgentQuestion(o: {
  agent: ModelChoice;
  parts: PromptParts;
  messages: ChatMessage[];
  /** Photos and scanned pages sent with the newest question. */
  images: NonNullable<ChatMessage["images"]>;
  tools: ToolSet;
  snapshot: HealthSnapshot;
  researchOnly: boolean;
  claim?: ClaimReview;
  failedServers: { name: string; error: string }[];
  signal: AbortSignal;
  userSignal?: AbortSignal;
  onEvent?: OnEvent;
}): Promise<AssistantReply> {
  const { agent } = o;
  if (!isAgent(agent.provider)) return { ok: false, error: "This model isn't an agent program." };
  const info = providerInfo(agent.provider);
  const label = info?.models.find((m) => m.id === agent.model)?.label ?? (agent.model || "default model");
  const modelLabel = `${info?.label ?? agent.provider} · ${label.replace(/ \(fastest\)$/, "")}`;
  const profile = getSettings().providers[agent.provider]?.profile;
  const a = await runAgent({
    provider: agent.provider,
    model: agent.model,
    ...(agent.effort ? { effort: agent.effort } : {}),
    ...(profile ? { profile } : {}),
    system: o.parts.stable,
    ...(o.parts.request ? { context: o.parts.request } : {}),
    messages: o.messages,
    ...(o.images.length ? { images: o.images } : {}),
    tools: o.tools,
    dataPack: o.researchOnly
      ? () =>
          "Research-only request. No personal data is available. Without the app's research tools, this live evidence check cannot be performed or verified."
      : () => dataPack(o.snapshot),
    ...(o.claim ? { claimReview: true } : {}),
    signal: o.signal,
    ...(o.onEvent ? { onEvent: o.onEvent } : {}),
  });
  if (!a.ok) return o.userSignal?.aborted ? { ok: false, error: "Stopped." } : a;
  if (o.claim) {
    const error = o.claim.finalError();
    if (error) return error;
  }
  const note = a.usedTools
    ? undefined
    : o.researchOnly
      ? `${info!.label} has no access to the app's research tools for this request. This is not a verified live evidence check; no profile or results were supplied and its citations can't be checked.`
      : `${info!.label} answered from a summary of your data, without the app's research tools, so its citations can't be checked.`;
  const assessment = o.claim?.assessment();
  return {
    ok: true,
    text: a.text,
    model: o.claim
      ? `${info?.label ?? agent.provider} · ${a.model ?? `${agent.model || "program default"} (configured; resolved model not reported)`}`
      : modelLabel,
    steps: a.steps,
    studyIds: o.claim ? o.claim.studyIds(a.studyIds) : a.studyIds,
    truncated: o.claim ? (a.truncated ?? false) : false,
    failedServers: o.failedServers,
    ...(assessment ? { claimAssessment: assessment } : {}),
    ...(note ? { note } : {}),
  };
}
