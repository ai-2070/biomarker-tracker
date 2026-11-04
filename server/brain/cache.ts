// How each provider is asked to reuse the prompt it has already read (prompt caching). The order the model
// reads things in is: tools, the stable system part, the per-request system part, then the conversation.
// Only the stable part and the conversation repeat between questions, so those are where the cache points go.
//
// - Anthropic: explicit cache points (`cacheControl`) after the stable system part (tools + rules) and on the
//   newest message, so the next question reads everything up to it from the cache.
// - OpenAI: automatic for long prompts; a stable `promptCacheKey` keeps questions on the same cache.
// - OpenRouter: a stable `session_id`, and `cache_control` for Anthropic models (added in models.ts, next to
//   the zero-retention routing).
// - Local and other providers: nothing to ask for; a stable prefix already helps servers that reuse it.
import crypto from "node:crypto";
import type { generateText, ModelMessage, SystemModelMessage } from "ai";
import type { ProviderId } from "../../src/core/aiProviders";
import type { PromptParts } from "./prompt";

/** Per-provider request options, as the AI SDK takes them. */
export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

const EPHEMERAL = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;

/** A short, stable name for a stable prompt: the same rules give the same key. Never contains personal data. */
export function cacheKey(scope: string, stable: string): string {
  return `biomarker-tracker-${scope}-${crypto.createHash("sha256").update(stable).digest("hex").slice(0, 24)}`;
}

export interface CacheLayout {
  instructions: SystemModelMessage[];
  messages: ModelMessage[];
  providerOptions: ProviderOptions;
}

export function cacheLayout(provider: ProviderId, parts: PromptParts, messages: ModelMessage[], key: string): CacheLayout {
  const anthropic = provider === "anthropic";
  const instructions: SystemModelMessage[] = [
    { role: "system", content: parts.stable, ...(anthropic ? { providerOptions: EPHEMERAL } : {}) },
    ...(parts.request ? [{ role: "system" as const, content: parts.request }] : []),
  ];
  const last = messages.length - 1;
  const marked = anthropic && last >= 0
    ? messages.map((m, i) => (i === last ? { ...m, providerOptions: { ...m.providerOptions, ...EPHEMERAL } } as ModelMessage : m))
    : messages;
  const providerOptions: ProviderOptions = provider === "openai" ? { openai: { promptCacheKey: key } } : {};
  return { instructions, messages: marked, providerOptions };
}

/** Merges per-provider option objects (the model's own options win over nothing, ours are added beside them). */
export function mergeProviderOptions(a: ProviderOptions, b: ProviderOptions): ProviderOptions {
  const out: ProviderOptions = { ...a };
  for (const [provider, options] of Object.entries(b)) out[provider] = { ...out[provider], ...options };
  return out;
}
