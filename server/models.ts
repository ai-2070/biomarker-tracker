// Turn the chosen provider and model into an AI SDK model, after checking the ZDR rule.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { DEFAULT_CHOICE, canUse, providerInfo, type ModelChoice, type UseCheck } from "../src/core/aiProviders";
import { agentInstalled } from "./agents";
import { zdrFetch } from "./openrouter";
import { getSecrets, getSettings } from "./store";

export interface Ready {
  model: LanguageModel;
  /** Per-provider options, e.g. telling OpenAI not to store anything. */
  providerOptions: Record<string, Record<string, string | boolean | number>>;
  choice: ModelChoice;
}

/** The model the assistant uses: the saved choice, or Claude Code with Opus until one is saved. */
export function currentChoice(): ModelChoice {
  return getSettings().assistant ?? DEFAULT_CHOICE;
}

export function assistantCheck(): UseCheck {
  const s = getSettings();
  const choice = currentChoice();
  const check = canUse(choice, choice ? s.providers[choice.provider] : undefined, !!(choice && getSecrets().keys[choice.provider]));
  if (!check.ok || !choice) return check;
  const info = providerInfo(choice.provider)!;
  if (info.kind === "agent" && !agentInstalled(choice.provider)) return { ok: false, reason: `${info.label} isn't installed on this computer (the \`${info.command}\` command wasn't found).` };
  return check;
}

/** The model to use, or why it can't be used. Never builds a model the ZDR rule refuses. */
export function readyModel(): { ok: true; ready: Ready } | { ok: false; reason: string } {
  const check = assistantCheck();
  if (!check.ok) return check;
  const s = getSettings();
  const choice = currentChoice();
  const effort = choice.effort;
  const cfg = s.providers[choice.provider] ?? {};
  const key = getSecrets().keys[choice.provider] ?? "";
  const info = providerInfo(choice.provider)!;
  const baseURL = (cfg.baseURL?.trim() || info.defaultBaseURL || "").replace(/\/+$/, "");

  switch (choice.provider) {
    case "anthropic":
      return { ok: true, ready: { model: createAnthropic({ apiKey: key, baseURL: "https://api.anthropic.com/v1" })(choice.model), providerOptions: effort ? { anthropic: { effort } } : {}, choice } };
    case "openai":
      // Chat Completions, and store: false, so OpenAI keeps no copy of the response.
      return { ok: true, ready: { model: createOpenAI({ apiKey: key, baseURL: "https://api.openai.com/v1" }).chat(choice.model), providerOptions: { openai: { store: false, ...(effort ? { reasoningEffort: effort } : {}) } }, choice } };
    case "mistral":
      return { ok: true, ready: { model: createMistral({ apiKey: key, baseURL: "https://api.mistral.ai/v1" })(choice.model), providerOptions: effort ? { mistral: { reasoningEffort: effort } } : {}, choice } };
    case "openrouter": {
      // Zero data retention is requested on every call (see openrouter.ts).
      const p = createOpenAICompatible({ name: "openrouter", baseURL, apiKey: key, fetch: zdrFetch(fetch, effort ? { reasoning: { effort } } : {}) });
      return { ok: true, ready: { model: p.chatModel(choice.model), providerOptions: {}, choice } };
    }
    case "claude-code":
    case "codex":
    case "hermes":
    case "openclaw":
      return { ok: false, reason: `${info.label} runs as an agent program, not through an API.` };
    case "custom":
    case "ollama":
    case "lmstudio": {
      const p = createOpenAICompatible({ name: choice.provider, baseURL, ...(key ? { apiKey: key } : {}) });
      return { ok: true, ready: { model: p.chatModel(choice.model), providerOptions: {}, choice } };
    }
  }
}

/** Plain-language message for a failed model call. Never includes keys. */
export function describeModelError(e: unknown): string {
  const status = typeof e === "object" && e !== null && "statusCode" in e ? Number((e as { statusCode: unknown }).statusCode) : undefined;
  if (status === 401 || status === 403) return "The API key was rejected. Check it in Settings → AI models.";
  if (status === 404) return "The model wasn't found. Check the model name in Settings → AI models.";
  if (status === 429) return "Too many requests, or no credit left on the account. Try again later.";
  if (status && status >= 500) return "The AI service is having problems. Try again later.";
  const msg = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(msg)) return "Couldn't reach the AI service. If it's a local model, check that it's running.";
  if (/abort|timed? ?out/i.test(msg)) return "The AI service took too long to answer.";
  return `The AI service returned an error: ${msg.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[key]").slice(0, 200)}`;
}
