import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readyModel } from "../../apps/server/models";
import { updateSecrets, updateSettings } from "../../apps/server/store";
import type { ProviderId } from "@bt/core/aiProviders";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const completion = { id: "mock-completion", object: "chat.completion", created: 0, model: "test-model", choices: [{ index: 0, message: { role: "assistant", content: "accepted" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
const anthropic = { id: "mock-message", type: "message", role: "assistant", model: "test-model", content: [{ type: "text", text: "accepted" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };

describe("named provider transport policy", () => {
  it.each([
    ["openai", "gpt-test", "https://api.openai.com/v1/chat/completions", "authorization", "Bearer SENTINEL_KEY"],
    ["anthropic", "claude-test", "https://api.anthropic.com/v1/messages", "x-api-key", "SENTINEL_KEY"],
    ["mistral", "mistral-medium-latest", "https://api.mistral.ai/v1/chat/completions", "authorization", "Bearer SENTINEL_KEY"],
  ] as const)("assistant-canonical-endpoint %s ignores ambient and saved overrides", async (provider, model, endpoint, header, credential) => {
    vi.stubEnv("OPENAI_BASE_URL", "http://ambient.invalid/v1");
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://ambient.invalid/v1");
    vi.stubEnv("MISTRAL_BASE_URL", "http://ambient.invalid/v1");
    updateSettings((settings) => {
      settings.assistant = { provider, model };
      settings.providers[provider] = { zdrConfirmed: true, baseURL: "http://saved-override.invalid/v1" };
    });
    updateSecrets((secrets) => { secrets.keys[provider] = "SENTINEL_KEY"; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(provider === "anthropic" ? anthropic : completion), { status: 200, headers: { "content-type": "application/json" } }));
    const ready = readyModel();
    expect(ready.ok).toBe(true);
    if (!ready.ok) throw new Error(ready.reason);
    const result = await generateText({ model: ready.ready.model, providerOptions: ready.ready.providerOptions, prompt: "HEALTH_PROMPT_SENTINEL", maxRetries: 0 });
    expect(result.text).toBe("accepted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(endpoint);
    expect(new Headers(options?.headers).get(header)).toBe(credential);
    expect(String(options?.body)).toContain("HEALTH_PROMPT_SENTINEL");
  });

  it("assistant-custom-endpoint uses the explicitly approved endpoint instead of the named-provider pin", async () => {
    updateSettings((settings) => {
      settings.assistant = { provider: "custom", model: "test-model" };
      settings.providers.custom = { zdrConfirmed: true, region: "EU", baseURL: "https://chosen.example/v1" };
    });
    updateSecrets((secrets) => { secrets.keys.custom = "CUSTOM_KEY"; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(completion), { status: 200, headers: { "content-type": "application/json" } }));
    const ready = readyModel();
    if (!ready.ok) throw new Error(ready.reason);
    expect((await generateText({ model: ready.ready.model, prompt: "custom-control", maxRetries: 0 })).text).toBe("accepted");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://chosen.example/v1/chat/completions");
  });

  it("assistant-mistral-effort refuses unsupported Large and forwards Low/High for supported Medium", async () => {
    const provider: ProviderId = "mistral";
    updateSettings((settings) => {
      settings.assistant = { provider, model: "mistral-large-latest", effort: "low" };
      settings.providers[provider] = { zdrConfirmed: true };
    });
    updateSecrets((secrets) => { secrets.keys[provider] = "SENTINEL_KEY"; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(completion), { status: 200, headers: { "content-type": "application/json" } }));
    expect(readyModel()).toEqual({ ok: false, reason: expect.stringMatching(/doesn't support.*effort/) });
    expect(fetchMock).not.toHaveBeenCalled();
    for (const effort of ["low", "high"] as const) {
      updateSettings((settings) => { settings.assistant = { provider, model: "mistral-medium-latest", effort }; });
      const ready = readyModel();
      if (!ready.ok) throw new Error(ready.reason);
      expect((await generateText({ model: ready.ready.model, providerOptions: ready.ready.providerOptions, prompt: "effort-control", maxRetries: 0 })).text).toBe("accepted");
      const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
      expect(body.reasoning_effort).toBe(effort);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
