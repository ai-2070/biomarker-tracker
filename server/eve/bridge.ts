// What the eve runtime calls back to (runtime/eve/agent/lib/bridge.ts), at /eve-bridge/* on the main server:
// the question's rules, earlier conversation and tools, each tool call, and every model call. Only the eve
// runtime this server started can call it (a token made at each start); a question's run id works only
// while that question is being answered. Tool calls are recorded like the agent bridge's (steps, study IDs).
import crypto from "node:crypto";
import type http from "node:http";
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4Prompt } from "@ai-sdk/provider";
import type { ToolSet } from "ai";
import type { ProviderId } from "../../src/core/aiProviders";
import { mergeProviderOptions } from "../brain/cache";
import type { OnEvent } from "../brain/events";
import type { PromptParts } from "../brain/prompt";
import { callTool, closeRun, listTools, openRun, type BridgeRun } from "../bridge";
import type { Ready } from "../models";

export interface EveRun {
  /** Sent to eve as x-bt-run; dies with the question. */
  id: string;
  bridge: BridgeRun;
  parts: PromptParts;
  history: { id: string; role: "user" | "assistant"; text: string }[];
  ready: Ready;
  key: string;
}

const runs = new Map<string, EveRun>();
let bridgeToken = "";

/** A new token for a new eve runtime; earlier runtimes can no longer call. */
export function newBridgeToken(): string {
  bridgeToken = crypto.randomBytes(32).toString("hex");
  return bridgeToken;
}

export function openEveRun(o: { tools: ToolSet; parts: PromptParts; history: EveRun["history"]; ready: Ready; key: string; onEvent?: OnEvent }): EveRun {
  const bridge = openRun(o.tools, undefined, o.onEvent);
  const run: EveRun = { id: crypto.randomBytes(24).toString("hex"), bridge, parts: o.parts, history: o.history, ready: o.ready, key: o.key };
  runs.set(run.id, run);
  return run;
}

export function closeEveRun(run: EveRun): void {
  runs.delete(run.id);
  closeRun(run.bridge);
}

/** The model's context window eve plans compaction for. Conservative where the model isn't known. */
export function contextWindow(provider: ProviderId): number {
  if (provider === "anthropic") return 200_000;
  if (provider === "ollama" || provider === "lmstudio" || provider === "custom") return 32_000;
  return 128_000;
}

const EPHEMERAL = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;

/**
 * The same prompt-cache layout as the built-in loop (brain/cache.ts), applied to the prompt eve built:
 * Anthropic cache points after the stable rules and on the newest message; OpenAI's stable key.
 */
export function withCache(provider: ProviderId, options: LanguageModelV4CallOptions, stable: string, key: string, own: Ready["providerOptions"]): LanguageModelV4CallOptions {
  let prompt: LanguageModelV4Prompt = options.prompt;
  if (provider === "anthropic" && prompt.length) {
    const rules = prompt.findIndex((m) => m.role === "system" && m.content === stable);
    prompt = prompt.map((m, i) => (i === rules || i === prompt.length - 1 ? { ...m, providerOptions: { ...m.providerOptions, ...EPHEMERAL } } as typeof m : m));
  }
  const cache: Ready["providerOptions"] = provider === "openai" ? { openai: { promptCacheKey: key } } : {};
  return { ...options, prompt, providerOptions: mergeProviderOptions(mergeProviderOptions((options.providerOptions ?? {}) as Ready["providerOptions"], own), cache) as LanguageModelV4CallOptions["providerOptions"] };
}

/** Binary file data comes as { $bytes: base64 }. */
export function decodeOptions(raw: unknown): LanguageModelV4CallOptions {
  return JSON.parse(JSON.stringify(raw), (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) && typeof (value as { $bytes?: unknown }).$bytes === "string" && Object.keys(value).length === 1
      ? new Uint8Array(Buffer.from((value as { $bytes: string }).$bytes, "base64"))
      : value) as LanguageModelV4CallOptions;
}

export function errorJson(e: unknown): { message: string; statusCode?: number; isRetryable?: boolean } {
  const any = e as { message?: unknown; statusCode?: unknown; isRetryable?: unknown };
  return {
    message: typeof any?.message === "string" ? any.message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[key]").slice(0, 500) : "The model call failed.",
    ...(typeof any?.statusCode === "number" ? { statusCode: any.statusCode } : {}),
    ...(typeof any?.isRetryable === "boolean" ? { isRetryable: any.isRetryable } : {}),
  };
}

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Handles /eve-bridge/*. The caller has already checked the Host header; body is the parsed JSON. */
export async function handleEveBridge(req: http.IncomingMessage, res: http.ServerResponse, url: URL, body: Record<string, unknown>): Promise<void> {
  const send = (status: number, value: unknown): void => void res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(value));
  const supplied = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";
  if (req.method !== "POST" || !bridgeToken || !supplied || !same(supplied, bridgeToken)) return send(403, { error: "Not allowed." });
  const run = typeof body.run === "string" ? runs.get(body.run) : undefined;
  if (!run) return send(404, { error: "This Brain question has ended." });
  switch (url.pathname) {
    case "/eve-bridge/configuration": {
      const tools = (await listTools(run.bridge.tools)).map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }));
      return send(200, { stable: run.parts.stable, request: run.parts.request, modelId: run.ready.choice.model || "default", contextWindow: contextWindow(run.ready.choice.provider), tools });
    }
    case "/eve-bridge/history":
      return send(200, { history: run.history });
    case "/eve-bridge/tool": {
      if (typeof body.name !== "string") return send(400, { error: "Name the tool." });
      const input = typeof body.input === "object" && body.input !== null && !Array.isArray(body.input) ? (body.input as Record<string, unknown>) : {};
      return send(200, await callTool(run.bridge, body.name, input));
    }
    case "/eve-bridge/model": {
      const model = run.ready.model as LanguageModelV4;
      const controller = new AbortController();
      const stop = () => controller.abort();
      res.once("close", stop);
      try {
        const options = { ...withCache(run.ready.choice.provider, decodeOptions(body.options), run.parts.stable, run.key, run.ready.providerOptions), abortSignal: controller.signal };
        if (body.mode === "generate") return send(200, { result: await model.doGenerate(options) });
        const { stream } = await model.doStream(options);
        res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
        for await (const part of stream as unknown as AsyncIterable<Record<string, unknown>>) {
          if (res.destroyed) break;
          res.write(`${JSON.stringify(part.type === "error" ? { type: "error", error: errorJson(part.error) } : part)}\n`);
        }
        if (!res.destroyed) res.end();
      } catch (e) {
        if (!res.headersSent) send(502, { error: errorJson(e) });
        else if (!res.destroyed) res.end(`${JSON.stringify({ type: "error", error: errorJson(e) })}\n`);
      } finally {
        res.off("close", stop);
      }
      return;
    }
    default:
      return send(404, { error: "Not found." });
  }
}
