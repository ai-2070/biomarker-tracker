import { describe, expect, it } from "vitest";
import { DEFAULT_CHOICE, EFFORT_LABEL, canUse, PROVIDERS, providerInfo, takesPictures } from "@bt/shared/core/aiProviders";

describe("provider registry", () => {
  it("lists only EU, US or local API providers; agents are labelled as depending on their own setup", () => {
    for (const p of PROVIDERS) {
      if (p.kind === "api") expect(["EU", "US", "local", "choose"]).toContain(p.region);
      else {
        expect(p.region).toBe("depends");
        expect(p.retention).toBe("depends");
        expect(p.command).toBeTruthy();
        expect(p.zdrNote).toMatch(/can't check/);
      }
    }
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

describe("canUse: OpenRouter and agents", () => {
  it("allows OpenRouter with a key alone, because zero retention is requested on every call", () => {
    const or = { provider: "openrouter" as const, model: "anthropic/claude-sonnet-5.5" };
    expect(canUse(or, {}, false)).toEqual({ ok: false, reason: expect.stringMatching(/API key/) });
    expect(canUse(or, {}, true)).toEqual({ ok: true });
  });

  it("allows agents without a key or model, but keeps names safe for a command line", () => {
    expect(canUse({ provider: "claude-code", model: "" }, {}, false)).toEqual({ ok: true });
    expect(canUse({ provider: "hermes", model: "" }, { profile: "research" }, false)).toEqual({ ok: true });
    expect(canUse({ provider: "hermes", model: "" }, { profile: "x; rm -rf /" }, false).ok).toBe(false);
    expect(canUse({ provider: "codex", model: "gpt-6 --yolo" }, {}, false).ok).toBe(false);
    expect(canUse({ provider: "openclaw", model: "anthropic/claude-opus-5.5" }, {}, false)).toEqual({ ok: true });
  });

  it("still needs a model for API providers", () => {
    expect(canUse({ provider: "openrouter", model: "" }, {}, true).ok).toBe(false);
  });
});

describe("provider order, models, effort and install", () => {
  it("lists programs on this computer first, then API-key providers, then local models", () => {
    const groups = PROVIDERS.map((p) => p.group);
    const firstApi = groups.indexOf("api");
    const firstLocal = groups.indexOf("local");
    expect(groups.slice(0, firstApi).every((g) => g === "agent")).toBe(true);
    expect(groups.slice(firstApi, firstLocal).every((g) => g === "api")).toBe(true);
    expect(groups.slice(firstLocal).every((g) => g === "local")).toBe(true);
    expect(PROVIDERS[0]!.id).toBe("claude-code");
  });

  it("defaults to Claude Code with Opus", () => {
    expect(DEFAULT_CHOICE).toEqual({ provider: "claude-code", model: "opus" });
    expect(providerInfo("claude-code")!.models.map((m) => m.id)).toContain("opus");
  });

  it("installs every program from its maker's own site, over https", () => {
    const sites: Record<string, string> = { "claude-code": "claude.ai", codex: "chatgpt.com", hermes: "hermes-agent.nousresearch.com", openclaw: "openclaw.ai" };
    for (const p of PROVIDERS.filter((x) => x.kind === "agent")) {
      for (const cmd of [p.install!.windows, p.install!.unix]) {
        const urls = cmd.match(/https?:\/\/[^\s)]+/g) ?? [];
        expect(urls.length, p.id).toBeGreaterThan(0);
        for (const u of urls) expect(new URL(u).hostname, p.id).toBe(sites[p.id]);
        expect(cmd).toMatch(/^[\w ()|.:/@-]+$/);
      }
      expect(p.install!.signIn.startsWith(p.command!)).toBe(true);
    }
  });

  it("accepts only the effort levels a provider has", () => {
    expect(canUse({ provider: "claude-code", model: "opus", effort: "max" }, {}, false)).toEqual({ ok: true });
    expect(canUse({ provider: "codex", model: "", effort: "max" }, {}, false).ok).toBe(false);
    expect(canUse({ provider: "ollama", model: "llama3.1", effort: "low" }, {}, false).ok).toBe(false);
    for (const p of PROVIDERS) for (const e of p.efforts) expect(Object.keys(EFFORT_LABEL)).toContain(e);
  });
});

describe("takesPictures", () => {
  it("allows API-key and local models, Claude Code and Codex, and refuses Hermes, OpenClaw and unknown ids", () => {
    for (const p of PROVIDERS) expect(takesPictures(p.id)).toBe(p.group !== "agent" || p.id === "claude-code" || p.id === "codex");
    expect(takesPictures("claude-code")).toBe(true);
    expect(takesPictures("hermes")).toBe(false);
    expect(takesPictures("openclaw")).toBe(false);
    expect(takesPictures("anthropic")).toBe(true);
    expect(takesPictures("nope")).toBe(false);
  });
});
