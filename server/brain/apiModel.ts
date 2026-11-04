// An API or local model answering with the app's tools (AI SDK streamText). No step limit: the model works
// until it stops calling tools (a claim check also stops once its assessment is submitted); the time limit is
// the caller's signal (10 minutes). Text and tool calls are reported as they happen (onEvent); the reply is
// built from the same results as before, after the stream ends.
import { isLoopFinished, streamText, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import { describeModelError, type Ready } from "../models";
import { studyIdsFromTool, toolStep, validateToolResult, type ToolStep } from "../steps";
import type { AssistantReply } from "./ask";
import { cacheLayout, mergeProviderOptions } from "./cache";
import type { ClaimReview } from "./claimReview";
import { noEvents, toolFinished, toolStarted, type OnEvent } from "./events";
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
  onEvent?: OnEvent;
}): Promise<AssistantReply> {
  const onEvent = o.onEvent ?? noEvents;
  const { model, providerOptions, choice } = o.ready;
  const layout = cacheLayout(choice.provider, o.parts, o.messages, o.key);
  try {
    const res = streamText({
      model,
      instructions: layout.instructions,
      messages: layout.messages,
      tools: o.tools,
      stopWhen: stopCondition(o.claim),
      maxOutputTokens: o.maxOutputTokens ?? 8000,
      providerOptions: mergeProviderOptions(providerOptions, layout.providerOptions),
      ...(o.claim ? { maxRetries: 0 } : {}),
      abortSignal: o.signal,
      // Errors come through the stream below; don't also log them.
      onError: () => {},
    });
    let failure: unknown;
    const inputs = new Map<string, unknown>();
    for await (const part of res.fullStream) {
      if (part.type === "text-delta") onEvent({ kind: "text", text: part.text });
      else if (part.type === "tool-call") {
        inputs.set(part.toolCallId, part.input);
        onEvent(toolStarted(part.toolCallId, part.toolName, part.input));
      } else if (part.type === "tool-result") onEvent(toolFinished(part.toolCallId, part.toolName, inputs.get(part.toolCallId), part.output));
      else if (part.type === "tool-error") onEvent(toolFinished(part.toolCallId, part.toolName, inputs.get(part.toolCallId), undefined, true));
      else if (part.type === "error") failure ??= part.error;
      else if (part.type === "abort") failure ??= new DOMException("The operation was aborted.", "AbortError");
    }
    if (failure !== undefined) throw failure;
    const [resSteps, text, finishReason, response] = await Promise.all([res.steps, res.text, res.finishReason, res.response]);
    const steps: ToolStep[] = [];
    const ids = new Set<string>();
    for (const step of resSteps) {
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
    const reportedModel = response.modelId?.trim();
    const claimModel = reportedModel ? `${o.modelLabel.split(" · ")[0]} · ${reportedModel}` : `${o.modelLabel} (configured; resolved model not reported)`;
    const assessment = o.claim?.assessment();
    return {
      ok: true,
      text,
      model: o.claim ? claimModel : o.modelLabel,
      steps,
      studyIds: o.claim ? o.claim.studyIds([...ids]) : [...ids],
      truncated: finishReason === "length",
      failedServers: o.failedServers,
      ...(assessment ? { claimAssessment: assessment } : {}),
    };
  } catch (e) {
    if (o.userSignal?.aborted) return { ok: false, error: "Stopped." };
    return { ok: false, error: describeModelError(e) };
  }
}
