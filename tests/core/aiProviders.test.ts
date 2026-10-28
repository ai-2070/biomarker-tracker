import { describe, expect, it } from "vitest";
import { canUse, PROVIDERS, providerInfo } from "../../src/core/aiProviders";

describe("provider registry", () => {
  it("lists only EU, US or local providers", () => {
    for (const p of PROVIDERS) expect(["EU", "US", "local", "choose"]).toContain(p.region);
  });
  it("marks local providers as keeping nothing and cloud providers as needing an agreement", () => {
    expect(providerInfo("ollama")!.retention).toBe("local");
    expect(providerInfo("anthropic")!.retention).toBe("agreement");
    expect(providerInfo("mistral")!.region).toBe("EU");
  });
});

describe("canUse (zero-data-retention rule)", () => {
  const claude = { provider: "anthropic" as const, model: "claude-opus-5-5" };

  it("needs a model choice", () => {
    expect(canUse(undefined, {}, true)).toEqual({ ok: false, reason: expect.stringMatching(/Choose a model/) });
    expect(canUse({ provider: "anthropic", model: " " }, { zdrConfirmed: true }, true).ok).toBe(false);
  });

  it("allows a cloud provider only with a key and confirmed zero data retention", () => {
    expect(canUse(claude, {}, false)).toEqual({ ok: false, reason: expect.stringMatching(/API key/) });
    expect(canUse(claude, {}, true)).toEqual({ ok: false, reason: expect.stringMatching(/zero data retention/) });
    expect(canUse(claude, { zdrConfirmed: true }, true)).toEqual({ ok: true });
  });

  it("allows local models without a key or confirmation", () => {
    expect(canUse({ provider: "ollama", model: "llama3.1" }, {}, false)).toEqual({ ok: true });
    expect(canUse({ provider: "lmstudio", model: "qwen" }, { baseURL: "http://127.0.0.1:1234/v1" }, false)).toEqual({ ok: true });
  });

  it("refuses a 'local' provider pointed at another machine", () => {
    expect(canUse({ provider: "ollama", model: "x" }, { baseURL: "http://192.168.1.20:11434/v1" }, false).ok).toBe(false);
  });

  it("requires a region for custom endpoints, and only EU or US", () => {
    const custom = { provider: "custom" as const, model: "m" };
    const base = { baseURL: "https://llm.example.eu/v1", zdrConfirmed: true };
    expect(canUse(custom, base, true)).toEqual({ ok: false, reason: expect.stringMatching(/EU or US/) });
    expect(canUse(custom, { ...base, region: "EU" }, true)).toEqual({ ok: true });
    expect(canUse(custom, { ...base, region: "US" }, true)).toEqual({ ok: true });
  });

  it("requires https for remote custom endpoints", () => {
    const r = canUse({ provider: "custom", model: "m" }, { baseURL: "http://llm.example.com/v1", region: "US", zdrConfirmed: true }, true);
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/https/) });
  });

  it("rejects unknown providers", () => {
    expect(canUse({ provider: "nope" as never, model: "x" }, {}, true).ok).toBe(false);
  });
});
