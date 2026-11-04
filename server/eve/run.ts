// One question answered in eve (opt-in engine for API-key and local models). The session lives for this
// question only: the earlier conversation is imported as history (the page's conversation stays the source),
// the rules, tools and model come from the main server through the bridge, and the session is ended
// afterwards so eve deletes its run data (retention 0). No step limit; the 10-minute limit is `signal`.
import { Client } from "eve/client";
import type { ToolSet } from "ai";
import type { AssistantReply, ChatMessage } from "../brain/ask";
import type { OnEvent } from "../brain/events";
import type { PromptParts } from "../brain/prompt";
import type { Ready } from "../models";
import { closeEveRun, openEveRun } from "./bridge";
import { eveHost } from "./host";

type Fact = { type: string; data?: Record<string, unknown> };

/** What one stream event means for the answer. Exported for tests. */
export function readEveEvent(event: Fact, state: { reply: Map<string, string>; replyIds?: string[]; outcome?: string; error?: string; truncated?: boolean }, onEvent: OnEvent): void {
  const data = event.data ?? {};
  switch (event.type) {
    case "content.delta":
      if (typeof data.delta === "string" && data.delta) onEvent({ kind: "text", text: data.delta });
      return;
    case "content.completed":
      if (data.kind === "text" && data.phase === "reply" && typeof data.partId === "string" && typeof data.value === "string") state.reply.set(data.partId, data.value);
      return;
    case "model.started":
      onEvent({ kind: "status", text: "Thinking…" });
      return;
    case "model.settled":
      if (data.finishReason === "length") state.truncated = true;
      return;
    case "turn.settled":
      state.outcome = typeof data.outcome === "string" ? data.outcome : "failed";
      if (Array.isArray(data.reply)) state.replyIds = data.reply.filter((id): id is string => typeof id === "string");
      if (state.outcome !== "completed") state.error ??= typeof (data.error as { message?: unknown } | undefined)?.message === "string" ? (data.error as { message: string }).message : undefined;
      return;
    case "delivery.settled":
      if (data.outcome === "failed" || data.outcome === "refused") {
        state.outcome ??= "failed";
        state.error ??= typeof data.reason === "string" ? data.reason : "eve couldn't take the question.";
      }
      return;
  }
}

export async function runEveQuestion(o: {
  ready: Ready;
  parts: PromptParts;
  messages: ChatMessage[];
  tools: ToolSet;
  key: string;
  modelLabel: string;
  failedServers: { name: string; error: string }[];
  signal: AbortSignal;
  userSignal?: AbortSignal;
  onEvent?: OnEvent;
}): Promise<AssistantReply> {
  const onEvent = o.onEvent ?? (() => {});
  const question = o.messages.at(-1)?.content ?? "";
  const history = o.messages.slice(0, -1).map((m, i) => ({ id: `m${i}`, role: m.role, text: m.content }));
  const run = openEveRun({ tools: o.tools, parts: o.parts, history, ready: o.ready, key: o.key, ...(o.onEvent ? { onEvent: o.onEvent } : {}) });
  let session: { cancel(options?: { signal?: AbortSignal }): Promise<unknown>; end(options?: { signal?: AbortSignal }): Promise<unknown> } | undefined;
  try {
    onEvent({ kind: "status", text: "Starting eve…" });
    const host = await eveHost(o.signal);
    const client = new Client({ baseUrl: host.url, auth: { bearer: host.token }, headers: { "x-bt-run": run.id } });
    const created = await client.sessions.create({ message: question, signal: o.signal, headers: { "x-bt-run": run.id } });
    session = created.session as unknown as typeof session;
    const state: Parameters<typeof readEveEvent>[1] = { reply: new Map() };
    for await (const event of created.delivery.stream({ signal: o.signal })) {
      readEveEvent(event as unknown as Fact, state, onEvent);
      if (state.outcome) break;
    }
    if (o.signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    if (state.outcome !== "completed") return { ok: false, error: state.error ? `eve: ${state.error}`.slice(0, 600) : "eve stopped without an answer." };
    const text = (state.replyIds ?? [...state.reply.keys()]).map((id) => state.reply.get(id) ?? "").filter(Boolean).join("\n\n");
    return {
      ok: true,
      text,
      model: `${o.modelLabel} · eve`,
      steps: run.bridge.steps,
      studyIds: [...run.bridge.ids],
      truncated: state.truncated ?? false,
      failedServers: o.failedServers,
    };
  } catch (e) {
    if (o.userSignal?.aborted) return { ok: false, error: "Stopped." };
    if (o.signal.aborted) return { ok: false, error: "eve took too long to answer (the limit is 10 minutes)." };
    return { ok: false, error: `eve: ${e instanceof Error ? e.message : String(e)}`.slice(0, 600) };
  } finally {
    // A stopped question is cancelled; every session ends, so eve deletes its run data.
    const cleanup = AbortSignal.timeout(10_000);
    if (session) {
      if (o.signal.aborted) await session.cancel({ signal: cleanup }).catch(() => {});
      await session.end({ signal: cleanup }).catch(() => {});
    }
    closeEveRun(run);
  }
}
