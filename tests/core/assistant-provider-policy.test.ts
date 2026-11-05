import { describe, expect, it } from "vitest";
import { canUse, isLocalUrl, modelEfforts } from "@bt/shared/core/aiProviders";

describe("assistant provider capabilities", () => {
  it("assistant-model-efforts excludes Mistral Large without hiding supported model controls", () => {
    expect(modelEfforts("mistral", "mistral-large-latest")).toEqual([]);
    expect(modelEfforts("mistral", "mistral-large-2512")).toEqual([]);
    expect(modelEfforts("mistral", "mistral-medium-latest")).toEqual(["low", "high"]);
    expect(modelEfforts("mistral", "magistral-medium-latest")).toEqual(["low", "high"]);
    expect(modelEfforts("openai", "gpt-test")).toEqual(["low", "medium", "high"]);
    expect(modelEfforts("unknown", "x")).toEqual([]);
    expect(canUse({ provider: "mistral", model: "mistral-large-latest", effort: "high" }, { zdrConfirmed: true }, true)).toEqual({ ok: false, reason: expect.stringMatching(/doesn't support.*effort/) });
    expect(canUse({ provider: "mistral", model: "mistral-large-latest" }, { zdrConfirmed: true }, true)).toEqual({ ok: true });
    expect(canUse({ provider: "mistral", model: "mistral-medium-latest", effort: "high" }, { zdrConfirmed: true }, true)).toEqual({ ok: true });
  });

  it("assistant-loopback-policy includes IPv6 localhost and excludes another machine", () => {
    for (const address of ["http://localhost:11434/v1", "http://127.0.0.1:1234/v1", "http://[::1]:11434/v1"]) {
      expect(isLocalUrl(new URL(address))).toBe(true);
      expect(canUse({ provider: "ollama", model: "local-model" }, { baseURL: address }, false)).toEqual({ ok: true });
    }
    expect(isLocalUrl(new URL("http://127.0.0.1.attacker.invalid/v1"))).toBe(false);
    expect(isLocalUrl(new URL("http://[::2]:11434/v1"))).toBe(false);
    expect(canUse({ provider: "ollama", model: "local-model" }, { baseURL: "http://remote.invalid/v1" }, false).ok).toBe(false);
  });
});
