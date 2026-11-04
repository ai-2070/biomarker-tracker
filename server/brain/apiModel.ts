// An API or local model answering with the app's tools (AI SDK). No step limit: the model works until it
// stops calling tools (a claim check also stops once its assessment is submitted); the time limit is the
// caller's signal (10 minutes).
import { generateText, isLoopFinished, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import { describeModelError, type Ready } from "../models";
import { studyIdsFromTool, toolStep, validateToolResult, type ToolStep } from "../steps";
import type { AssistantReply } from "./ask";
import { cacheLayout, mergeProviderOptions } from "./cache";
import type { ClaimReview } from "./claimReview";
import type { PromptParts } from "./prompt";

export function stopCondition(claim?: ClaimReview): StopCondition<ToolSet> {
  return claim ? () => claim.assessment() !== undefined : isLoopFinished();
}

export async function runApiModel(o: {
  ready: Ready;
  parts: PromptParts;
  messages: ModelMessage[];
  tools: ToolSet;
  key: string;
  claim?: ClaimReview;
  modelLabel: string;
  /** Per model call; deep claim sessions write longer answers. */
  maxOutputTokens?: number;
  failedServers: { name: string; error: string }[];
  /** The user's stop and the time limit together. */
  signal: AbortSignal;
  /** The user's stop alone, to tell "Stopped." from a time-out. */
  userSignal?: AbortSignal;
}): Promise<AssistantReply> {
  const { model, providerOptions, choice } = o.ready;
  const layout = cacheLayout(choice.provider, o.parts, o.messages, o.key);
  try {
    const res = await generateText({
      model,
      instructions: layout.instructions,
      messages: layout.messages,
      tools: o.tools,
      stopWhen: stopCondition(o.claim),
      maxOutputTokens: o.maxOutputTokens ?? 8000,
      providerOptions: mergeProviderOptions(providerOptions, layout.providerOptions),
      ...(o.claim ? { maxRetries: 0 } : {}),
      abortSignal: o.signal,
    });
    const steps: ToolStep[] = [];
    const ids = new Set<string>();
    for (const step of res.steps) {
      for (const c of step.toolCalls) {
        const action = toolStep(c.toolName, c.input);
        const result = step.toolResults.find((tr) => tr.toolCallId === c.toolCallId && tr.toolName === c.toolName);
        if (result) validateToolResult(action, result.output);
        else action.success = false;
        steps.push(action);
      }
      for (const tr of step.toolResults) for (const id of studyIdsFromTool(tr.toolName, tr.output)) ids.add(id);
    }
    const claimError = o.claim?.finalError();
    if (claimError) return claimError;
    const reportedModel = res.response.modelId?.trim();
    const claimModel = reportedModel ? `${o.modelLabel.split(" · ")[0]} · ${reportedModel}` : `${o.modelLabel} (configured; resolved model not reported)`;
    const assessment = o.claim?.assessment();
    return {
      ok: true,
      text: res.text,
      model: o.claim ? claimModel : o.modelLabel,
      steps,
      studyIds: o.claim ? o.claim.studyIds([...ids]) : [...ids],
      truncated: res.finishReason === "length",
      failedServers: o.failedServers,
      ...(assessment ? { claimAssessment: assessment } : {}),
    };
  } catch (e) {
    if (o.userSignal?.aborted) return { ok: false, error: "Stopped." };
    return { ok: false, error: describeModelError(e) };
  }
}
