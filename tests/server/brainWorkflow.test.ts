import { MockModel } from "./mockModel";
import { describe, expect, it } from "vitest";
import { ask, ASSISTANT_TIMEOUT_MS, promptParts } from "../../server/assistant";
import { cacheKey, cacheLayout } from "../../server/brain/cache";
import { requestTools } from "../../server/brain/tools";
import type { HealthSnapshot } from "../../server/healthTools";
import { openRouterCache, type Ready } from "../../server/models";
import type { ProviderId } from "../../src/core/aiProviders";
import type { Measurement } from "../../src/core/types";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const m = (id: string, biomarkerId: string, date: string, value: number): Measurement => ({ id, biomarkerId, date, value, originalValue: value, originalUnit: "x", source: "manual" });
const calm: HealthSnapshot = { measurements: [m("f1", "ferritin", "2024-05-12", 40)], protocols: [], experiments: [], profile: { sex: "f" } };
const critical: HealthSnapshot = { measurements: [m("k1", "potassium", "2024-05-12", 6.6)], protocols: [{ id: "p", label: "Warfarin", category: "medication", start: "2024-01-01" }], experiments: [], profile: {} };

type Call = Parameters<MockModel["doGenerate"]>[0];

/** A model that calls get_results `toolCalls` times, then answers; records every call it receives. */
function model(toolCalls = 0, provider: ProviderId = "ollama") {
  const calls: Call[] = [];
  let n = 0;
  const mock = new MockModel({
    doGenerate: async (options) => {
      calls.push(options);
      if (n++ < toolCalls) {
        return { content: [{ type: "tool-call" as const, toolCallId: `c${n}`, toolName: "get_results", input: "{}" }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] };
      }
      return { content: [{ type: "text" as const, text: "Here is what I found." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
  const ready: Ready = { model: mock, providerOptions: {}, choice: { provider, model: "mock" } };
  return { ready, calls };
}

const systemTexts = (call: Call) => call.prompt.filter((p) => p.role === "system").map((p) => p.content as string);
const toolNames = (call: Call) => (call.tools ?? []).map((t) => t.name);

describe("no step limit, one 10-minute limit", () => {
  it("keeps going while the model calls tools (well past the old limit of 10 steps)", async () => {
    const { ready, calls } = model(14);
    const r = await ask([{ role: "user", content: "Look at everything" }], calm, { ready });
    expect(r).toMatchObject({ ok: true, text: "Here is what I found." });
    if (!r.ok) return;
    expect(r.steps).toHaveLength(14);
    expect(calls).toHaveLength(15);
  });

  it("has one limit of 10 minutes, and every model call gets the stop signal", async () => {
    expect(ASSISTANT_TIMEOUT_MS).toBe(600_000);
    const { ready, calls } = model(1);
    await ask([{ role: "user", content: "hi" }], calm, { ready });
    for (const call of calls) expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("says Stopped. when the person stops, not that the service was slow", async () => {
    const controller = new AbortController();
    const slow = new MockModel({
      doGenerate: async (options) => {
        controller.abort();
        // The person's stop reaches the model call through the combined signal.
        expect(options.abortSignal?.aborted).toBe(true);
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    });
    const r = await ask([{ role: "user", content: "hi" }], calm, { ready: { model: slow, providerOptions: {}, choice: { provider: "ollama", model: "mock" } }, signal: controller.signal });
    expect(r).toEqual({ ok: false, error: "Stopped." });
  });
});

describe("prompt cache layout", () => {
  const opts = { skills: "- evidence-review: How to review evidence", cautious: false, critical: [] as string[], mcpServers: [] };

  it("keeps the stable part identical whatever the person's results are; per-request lines come last", () => {
    const quiet = promptParts(opts);
    const urgent = promptParts({ ...opts, critical: ["Potassium"], cautious: true });
    expect(urgent.stable).toBe(quiet.stable);
    expect(quiet.request).toBe("");
    expect(urgent.request).toMatch(/CRITICAL: .*Potassium/);
    expect(urgent.request).toMatch(/blood thinner/);
    expect(urgent.stable).not.toMatch(/CRITICAL|Potassium/);
    // Skills and research servers belong to the stable part.
    expect(quiet.stable).toContain("evidence-review");
  });

  it("puts the evidence-check date in the per-request part, as a day", () => {
    const parts = promptParts({ ...opts, researchOnly: true, today: "2026-11-04" });
    expect(parts.stable).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(parts.request).toBe("Evidence check date: 2026-11-04. State this date in the answer.");
  });

  it("offers the same tools in the same order on every turn, typed details or not", () => {
    const base = { snapshot: calm, serverTools: {}, requestText: "hi" };
    const typed = Object.keys(requestTools({ ...base, userText: "I am 180 cm tall" }));
    const untyped = Object.keys(requestTools(base));
    expect(untyped).toEqual(typed);
    expect(typed[0]).toBe("save_profile_details");
    const withServers = Object.keys(requestTools({ ...base, serverTools: { research_tools: {} as never, use_research_tool: {} as never } }));
    expect(withServers.slice(0, typed.length)).toEqual(typed);
    expect(withServers.slice(typed.length)).toEqual(["research_tools", "use_research_tool"]);
  });

  it("sends the same stable system text and tools across turns and people; only the last part differs", async () => {
    const first = model();
    await ask([{ role: "user", content: "How am I doing?" }], calm, { ready: first.ready, userText: "How am I doing?" });
    const second = model();
    await ask([{ role: "user", content: "How am I doing?" }, { role: "assistant", content: "Fine." }, { role: "user", content: "And now?" }], critical, { ready: second.ready });
    const [a, b] = [first.calls[0]!, second.calls[0]!];
    expect(systemTexts(b)[0]).toBe(systemTexts(a)[0]);
    expect(toolNames(b)).toEqual(toolNames(a));
    expect(systemTexts(a)).toHaveLength(1);
    expect(systemTexts(b)[1]).toMatch(/CRITICAL/);
  });

  it("asks Anthropic to cache the stable part and the conversation so far", () => {
    const parts = { stable: "rules", request: "today" };
    const layout = cacheLayout("anthropic", parts, [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }], "k");
    expect(layout.instructions[0]).toMatchObject({ content: "rules", providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } });
    expect(layout.instructions[1]).toEqual({ role: "system", content: "today" });
    expect(layout.messages.map((x) => x.providerOptions)).toEqual([undefined, undefined, { anthropic: { cacheControl: { type: "ephemeral" } } }]);
  });

  it("gives OpenAI a stable cache key, and adds nothing for local models", () => {
    const parts = { stable: "rules", request: "" };
    const key = cacheKey("personal", "rules");
    expect(key).toBe(cacheKey("personal", "rules"));
    expect(key).not.toBe(cacheKey("personal", "other rules"));
    expect(cacheLayout("openai", parts, [], key).providerOptions).toEqual({ openai: { promptCacheKey: key } });
    const local = cacheLayout("ollama", parts, [{ role: "user", content: "a" }], key);
    expect(local.providerOptions).toEqual({});
    expect(local.messages[0]!.providerOptions).toBeUndefined();
    expect(local.instructions[0]!.providerOptions).toBeUndefined();
  });

  it("asks OpenRouter for a stable session, and a cache point for Anthropic models", () => {
    expect(openRouterCache("anthropic/claude-sonnet-5.5", "biomarker-tracker-personal")).toEqual({ session_id: "biomarker-tracker-personal", cache_control: { type: "ephemeral" } });
    expect(openRouterCache("openai/gpt-5", "biomarker-tracker-personal")).toEqual({ session_id: "biomarker-tracker-personal" });
  });

  it("sends Anthropic's cache points through a real request", async () => {
    const { ready, calls } = model(0, "anthropic");
    await ask([{ role: "user", content: "hi" }], calm, { ready });
    const call = calls[0]!;
    const system = call.prompt.find((p) => p.role === "system")!;
    expect(system.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(call.prompt.at(-1)!.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
  });
});

describe.skipIf(process.platform === "win32")("agent programs get the prompt in cache order", () => {
  it("stable rules, then the tools note, then this request's part", async () => {
    const { installFakeAgents } = await import("./fakeAgents");
    const fakes = installFakeAgents({ claude: "fake-claude.cjs" });
    try {
      const dir = fakes.dir();
      process.env.FAKE_LINES = JSON.stringify([{ type: "result", subtype: "success", result: "Contact your doctor about potassium.", modelUsage: { "claude-opus": {} } }]);
      const r = await ask([{ role: "user", content: "How am I doing?" }], critical);
      expect(r).toMatchObject({ ok: true, text: "Contact your doctor about potassium." });
      const system = fakes.seen(dir).system!;
      const rules = system.indexOf("You are Brain");
      const note = system.indexOf('MCP server gives you the user');
      const now = system.indexOf("CRITICAL:");
      expect(rules).toBe(0);
      expect(note).toBeGreaterThan(rules);
      expect(now).toBeGreaterThan(note);
      expect(fakes.seen(dir).args).not.toContain("--max-turns");
    } finally {
      fakes.restore();
    }
  });
});
