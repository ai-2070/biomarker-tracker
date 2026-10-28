/**
 * AI providers the user can configure themselves. Plain fetch, no SDKs, so the
 * app keeps its small dependency list (CLAUDE.md). Requests are built and
 * parsed by pure functions so they can be tested without a network.
 */

export type ProviderId = "anthropic" | "openai" | "ollama";

export interface AiConfig {
  provider: ProviderId;
  /** Stored only in this browser's IndexedDB. Not used for Ollama. */
  apiKey?: string;
  model: string;
  /** Ollama only. Must be allowed by the Content Security Policy. */
  baseUrl?: string;
}

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most capable)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, cheaper)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" },
] as const;

export const DEFAULTS: Record<ProviderId, { model: string; baseUrl?: string }> = {
  anthropic: { model: "claude-opus-5-5" },
  openai: { model: "gpt-5" },
  ollama: { model: "llama3.1", baseUrl: "http://localhost:11434" },
};

/** Ollama addresses the Content Security Policy allows (see vite.config.ts). */
export const OLLAMA_ALLOWED = ["http://localhost:11434", "http://127.0.0.1:11434"];

export function isCloud(p: ProviderId): boolean {
  return p !== "ollama";
}

export function configProblem(c: AiConfig): string | undefined {
  if (!c.model.trim()) return "Choose a model.";
  if (isCloud(c.provider) && !c.apiKey?.trim()) return "Paste your API key.";
  if (c.provider === "ollama" && !OLLAMA_ALLOWED.includes((c.baseUrl ?? "").replace(/\/+$/, ""))) {
    return `For safety, this app can only reach Ollama at ${OLLAMA_ALLOWED.join(" or ")}.`;
  }
  return undefined;
}

export interface HttpRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body: string };
}

const ANTHROPIC_VERSION = "2026-10-21";
/** Models that accept the server-side refusal fallback ("default" routing). */
const ANTHROPIC_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export function buildRequest(c: AiConfig, system: string, user: string): HttpRequest {
  if (c.provider === "anthropic") {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": c.apiKey ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
      // Required for calls made directly from a browser with the user's own key.
      "anthropic-dangerous-direct-browser-access": "true",
    };
    const body: Record<string, unknown> = {
      model: c.model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      // Short evidence summaries don't need deep reasoning.
      output_config: { effort: "medium" },
    };
    if (ANTHROPIC_FALLBACK_MODELS.has(c.model)) {
      // If the model declines, Anthropic retries on a suitable fallback model.
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }
    return { url: "https://api.anthropic.com/v1/messages", init: { method: "POST", headers, body: JSON.stringify(body) } };
  }

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  if (c.provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${c.apiKey ?? ""}` },
        body: JSON.stringify({ model: c.model, messages, max_completion_tokens: 16000 }),
      },
    };
  }
  const base = (c.baseUrl ?? DEFAULTS.ollama.baseUrl!).replace(/\/+$/, "");
  return {
    url: `${base}/v1/chat/completions`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: c.model, messages, stream: false }),
    },
  };
}

export type AiResult = { ok: true; text: string; truncated: boolean } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read a successful (HTTP 2xx) response body. */
export function parseResponse(provider: ProviderId, json: unknown): AiResult {
  if (provider === "anthropic") {
    if (!isObj(json) || !Array.isArray(json.content)) return { ok: false, error: "The AI service sent an unexpected response." };
    if (json.stop_reason === "refusal") return { ok: false, error: "The model declined to answer this question." };
    const text = json.content
      .filter((b): b is Obj => isObj(b) && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("")
      .trim();
    if (!text) return { ok: false, error: "The model returned an empty answer." };
    return { ok: true, text, truncated: json.stop_reason === "max_tokens" };
  }
  const choice = isObj(json) && Array.isArray(json.choices) ? json.choices[0] : undefined;
  const message = isObj(choice) ? choice.message : undefined;
  const text = isObj(message) && typeof message.content === "string" ? message.content.trim() : "";
  if (!text) return { ok: false, error: "The model returned an empty answer." };
  return { ok: true, text, truncated: isObj(choice) && choice.finish_reason === "length" };
}

/** Turn an error response into a plain-language message. Never includes the key. */
export function describeHttpError(provider: ProviderId, status: number, json: unknown): string {
  const apiMessage =
    isObj(json) && isObj(json.error) && typeof json.error.message === "string" ? json.error.message.slice(0, 200) : undefined;
  if (status === 401 || status === 403) return "The API key was rejected. Check it on the Data page.";
  if (status === 429) return "Too many requests or no credit left on this account. Try again later.";
  if (status === 404 && provider === "ollama") return "Ollama couldn't find that model. Run `ollama pull <model>` first.";
  if (status >= 500) return "The AI service is having problems. Try again later.";
  return apiMessage ? `The AI service said: ${apiMessage}` : `The AI service returned an error (HTTP ${status}).`;
}

export async function askModel(
  c: AiConfig,
  system: string,
  user: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<AiResult> {
  const { url, init } = buildRequest(c, system, user);
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal });
  } catch {
    if (signal?.aborted) return { ok: false, error: "Cancelled." };
    return {
      ok: false,
      error:
        c.provider === "ollama"
          ? "Couldn't reach Ollama. Is it running, and was it started with OLLAMA_ORIGINS set to allow this page?"
          : "Couldn't reach the AI service. Check your internet connection.",
    };
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) return { ok: false, error: describeHttpError(c.provider, res.status, json) };
  return parseResponse(c.provider, json);
}
