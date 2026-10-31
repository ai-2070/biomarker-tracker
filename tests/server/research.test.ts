import { once } from "node:events";
import { readFileSync } from "node:fs";
import type http from "node:http";
import { join } from "node:path";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ask, type ChatMessage } from "../../server/assistant";
import { runAgent, type AgentRequest } from "../../server/agents";
import { callTool, closeRun, openRun, runFor } from "../../server/bridge";
import type { HealthSnapshot } from "../../server/healthTools";
import { createServer } from "../../server/http";
import { assistantTools, researchTools } from "../../server/mcp";
import { assistantCheck, currentChoice, readyModel } from "../../server/models";
import { addSkill, deleteSkill, setSkillEnabled } from "../../server/skills";
import { deferred } from "../helpers";

vi.mock(import("../../server/agents"), async (original) => ({
  ...await original(),
  runAgent: vi.fn(),
}));
vi.mock(import("../../server/models"), async (original) => ({
  ...await original(),
  currentChoice: vi.fn(),
  readyModel: vi.fn(),
  assistantCheck: vi.fn(),
}));
vi.mock(import("../../server/mcp"), async (original) => ({
  ...await original(),
  assistantTools: vi.fn(),
}));

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const answer = (text = "Not enough evidence.") => ({ content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });
const ready = (model: MockLanguageModelV4) => ({ model, providerOptions: {}, choice: { provider: "ollama" as const, model: "mock" } });
const snapshot: HealthSnapshot = {
  measurements: [{ id: "private-result", biomarkerId: "potassium", value: 6.6, originalValue: 6.6, originalUnit: "mmol/L", date: "2026-10-01", source: "manual" }],
  protocols: [{ id: "private-habit", label: "PRIVATE_WARFARIN", category: "medication", start: "2026-01-01" }],
  experiments: [],
  profile: { name: "PRIVATE_NAME", birthMonth: "1984-04", conditions: "PRIVATE_CONDITION" },
  meals: [{ id: "private-meal", name: "PRIVATE_MEAL", items: [], createdAt: "2026-01-01" }],
};
const question = "Does isolated oral astaxanthin improve skin hydration in adults?";
const maliciousMessages: ChatMessage[] = [
  { role: "user", content: "PRIVATE_HISTORY", images: [{ mediaType: "image/png", data: "PRIVATE_OLD_PHOTO" }] },
  { role: "assistant", content: "PRIVATE_ANSWER" },
  { role: "user", content: `  ${question}  `, images: [{ mediaType: "image/jpeg", data: "PRIVATE_NEW_PHOTO" }] },
  { role: "assistant", content: "PRIVATE_TRAILING_ANSWER" },
];
const forbidden = ["get_results", "get_marker", "get_levers", "get_body_summary", "get_biological_age", "get_log", "get_protocols", "get_meals", "compare_before_after", "save_profile_details", "propose_habit", "propose_protocol", "propose_meal"];
const fixture = readFileSync(join(import.meta.dirname, "..", "fixtures", "research", "europepmc-ferritin-reviews.json"), "utf8");

beforeEach(() => {
  vi.mocked(currentChoice).mockReturnValue({ provider: "ollama", model: "mock" });
  vi.mocked(assistantCheck).mockReturnValue({ ok: true });
  vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(new MockLanguageModelV4({ doGenerate: async () => answer() })) });
  vi.mocked(runAgent).mockReset();
  vi.mocked(assistantTools).mockResolvedValue({ tools: {}, servers: [], failed: [] });
});

describe("research-only assistant", () => {
  it("discards supplied snapshot, history and photos before model generation, while executing public research", async () => {
    let calls = 0;
    const prompts: unknown[] = [];
    const userPrompts: unknown[] = [];
    const offered: string[][] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        prompts.push(opts.prompt);
        userPrompts.push(opts.prompt.filter((m) => m.role === "user"));
        offered.push((opts.tools ?? []).map((t) => t.name));
        if (++calls === 1) return {
          content: [{ type: "tool-call", toolCallId: "research-1", toolName: "search_research", input: JSON.stringify({ terms: ["astaxanthin"], topic: "skin hydration", filter: "reviews" }) }],
          finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [],
        };
        return answer("Mixed evidence; see the retrieved source.");
      },
    });
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(fixture);
    }) as typeof fetch;
    // Throw on any snapshot access, not merely when it is serialized into a prompt.
    const unreadable = new Proxy(snapshot, { get: () => { throw new Error("Read private snapshot"); } });
    const result = await ask(maliciousMessages, unreadable, { researchOnly: true, userText: "PRIVATE_TYPED I am 180 cm tall", ready: ready(model), fetchFn });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toBe(2);
    expect(result.studyIds).toEqual(["PMID:42832553", "PMID:42687675", "PMID:42575304"]);
    expect(userPrompts[0]).toEqual([{ role: "user", content: [{ type: "text", text: question }] }]);
    expect(JSON.stringify(prompts)).not.toMatch(/PRIVATE_|1984-04|CRITICAL:|Potassium/);
    expect(urls).toHaveLength(1);
    expect(decodeURIComponent(urls[0]!)).toContain("astaxanthin");
    expect(decodeURIComponent(urls[0]!)).not.toMatch(/PRIVATE_|1984/);
    for (const names of offered) {
      expect(names).toContain("get_nutrient");
      expect(names).toContain("read_skill");
      for (const name of forbidden) expect(names).not.toContain(name);
    }
  });

  it("offers the same isolated tools through the agent bridge and keeps research citations verifiable", async () => {
    const sk = addSkill("---\nname: Research isolation test\ndescription: Check public research only.\n---\nExample only: PMID:12345678. Do not give personal doses; discuss changes with a doctor.");
    const mcpTools = researchTools(new Map([["enabled-research", {
      search: tool({ inputSchema: z.object({ query: z.string() }), execute: async () => ({ studies: [{ id: "PMID:87654321", title: "Synthetic research fixture" }] }) }),
    }]]));
    vi.mocked(assistantTools).mockResolvedValue({ tools: mcpTools, servers: [{ id: "enabled-research", name: "Enabled source", about: "Public research", tools: 1 }], failed: [] });
    vi.mocked(currentChoice).mockReturnValue({ provider: "codex", model: "mock" });
    vi.mocked(runAgent).mockImplementation(async (req: AgentRequest) => {
      expect(req.messages).toEqual([{ role: "user", content: question }]);
      expect(req.dataPack()).not.toMatch(/PRIVATE_|1984-04|Potassium/);
      const run = openRun(req.tools, req.provider);
      try {
        expect(runFor(run.token)).toBe(run);
        for (const name of forbidden) expect((await callTool(run, name, {})).isError).toBe(true);
        expect(run.steps).toEqual([]);
        const skill = await callTool(run, "read_skill", { id: sk.id });
        expect(skill.text).toContain("PMID:12345678");
        expect(run.ids.size).toBe(0);
        setSkillEnabled(sk.id, false);
        expect((await callTool(run, "read_skill", { id: sk.id })).text).toContain("No skill");
        const nutrient = await callTool(run, "get_nutrient", { nutrient: "vitamin D" });
        expect(nutrient.isError).toBe(false);
        expect(nutrient.text).not.toMatch(/PRIVATE_|1984-04/);
        expect(JSON.parse(nutrient.text).safetyNotesFromLog).toEqual([]);
        const listing = await callTool(run, "research_tools", { server: "enabled-research" });
        expect(listing.isError).toBe(false);
        const research = await callTool(run, "use_research_tool", { server: "enabled-research", tool: "search", input: { query: "astaxanthin" } });
        expect(research.text).toContain("PMID:87654321");
        expect(run.ids.has("PMID:12345678")).toBe(false);
        return { ok: true, text: "See [PMID:87654321].", steps: run.steps, studyIds: [...run.ids], usedTools: true };
      } finally {
        closeRun(run);
        expect(runFor(run.token)).toBeUndefined();
      }
    });
    try {
      const result = await ask(maliciousMessages, snapshot, { researchOnly: true, userText: "PRIVATE_TYPED I am 180 cm tall" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.studyIds).toContain("PMID:87654321");
      expect(result.studyIds).not.toContain("PMID:12345678");
      expect(result.note).toBeUndefined();
    } finally {
      deleteSkill(sk.id);
    }
  });

  it("gives tool-less agents no personal data pack and honestly marks their evidence check as unverified", async () => {
    vi.mocked(currentChoice).mockReturnValue({ provider: "openclaw", model: "mock" });
    vi.mocked(runAgent).mockImplementation(async (req) => {
      expect(req.messages).toEqual([{ role: "user", content: question }]);
      expect(req.dataPack()).not.toMatch(/PRIVATE_|1984-04|Potassium/);
      return { ok: true, text: "I cannot verify this live evidence check.", steps: [], studyIds: [], usedTools: false };
    });
    const result = await ask(maliciousMessages, snapshot, { researchOnly: true });
    expect(result).toMatchObject({ ok: true, studyIds: [], note: expect.any(String) });
  });

  it("rejects image-only research questions and keeps model readiness checks", async () => {
    expect(await ask([{ role: "user", content: " ", images: [{ mediaType: "image/png", data: "AAAA" }] }], snapshot, { researchOnly: true })).toMatchObject({ ok: false });
    vi.mocked(readyModel).mockReturnValue({ ok: false, reason: "Set up a model first." });
    expect(await ask([{ role: "user", content: question }], snapshot, { researchOnly: true })).toMatchObject({ ok: false });
    expect(runAgent).not.toHaveBeenCalled();
    expect(assistantTools).not.toHaveBeenCalled();
  });
});

let server: http.Server;
let port: number;
beforeAll(async () => {
  const listener = createServer(0);
  const firstListening = once(listener, "listening");
  listener.listen(0, "127.0.0.1");
  await firstListening;
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP server address.");
  port = address.port;
  const firstClosed = once(listener, "close");
  listener.close();
  await firstClosed;
  server = createServer(port);
  const listening = once(server, "listening");
  server.listen(port, "127.0.0.1");
  await listening;
});
afterAll(async () => {
  const closed = once(server, "close");
  server.close();
  await closed;
});
const post = (body: unknown, signal?: AbortSignal) => fetch(`http://127.0.0.1:${port}/api/assistant`, {
  method: "POST", headers: { "content-type": "application/json", "x-bt": "1" }, body: JSON.stringify(body), signal,
});

describe("research API boundary", () => {
  it("ignores even malformed supplied health data and sends only latest user text to the actual assistant", async () => {
    let prompt: unknown;
    let users: unknown;
    const model = new MockLanguageModelV4({ doGenerate: async (opts) => {
      prompt = opts.prompt;
      users = opts.prompt.filter((m) => m.role === "user");
      return answer();
    } });
    vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(model) });
    const response = await post({ scope: "research", userText: { malicious: "PRIVATE_TYPED I am 180 cm tall" }, snapshot: { measurements: [{ id: "PRIVATE_INVALID" }], profile: snapshot.profile }, messages: maliciousMessages });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(users).toEqual([{ role: "user", content: [{ type: "text", text: question }] }]);
    expect(JSON.stringify(prompt)).not.toMatch(/PRIVATE_|1984-04/);
    const personal = await post({ snapshot: { measurements: [{ id: "PRIVATE_INVALID" }] }, messages: [{ role: "user", content: question }] });
    expect(personal.status).toBe(400);
  });

  it("binds typed personal text before tools execute and ignores attached profile quotes", async () => {
    let calls = 0;
    const full = "What is my BMI?\n\nDocument: I am 180 cm tall";
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      if (++calls === 1) return {
        content: [{ type: "tool-call", toolCallId: "profile-api", toolName: "save_profile_details", input: JSON.stringify({ details: [{ field: "heightCm", quote: "I am 180 cm tall" }] }) }],
        finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [],
      };
      return answer();
    } });
    vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(model) });
    const bad = await post({ snapshot: {}, userText: "I am 180 cm tall", messages: [{ role: "user", content: full }] });
    expect(bad.status).toBe(400);
    expect(calls).toBe(0);
    const response = await post({ snapshot: {}, userText: "What is my BMI?", messages: [{ role: "user", content: full }] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, steps: [{ tool: "save_profile_details", validated: false }] });
    expect(calls).toBe(2);
  });

  it("fills typed profile facts through the API without a save call and keeps birth month out of tool output", async () => {
    const userText = "I am 180 cm tall. I was born in April 1984. What is my BMI?";
    let calls = 0;
    const outputs: unknown[] = [];
    const actions = [
      { tool: "get_results", input: {} },
      { tool: "get_body_summary", input: {} },
    ];
    const model = new MockLanguageModelV4({ doGenerate: async (options) => {
      outputs.push(options.prompt.filter((message) => message.role === "tool"));
      const action = actions[calls++];
      return action ? {
        content: [{ type: "tool-call", toolCallId: `api-${calls}`, toolName: action.tool, input: JSON.stringify(action.input) }],
        finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [],
      } : answer("The app reports a BMI of 25.");
    } });
    vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(model) });
    const response = await post({ userText, messages: [{ role: "user", content: userText }], snapshot: {
      measurements: [{ id: "w", biomarkerId: "weight", value: 81, originalValue: 81, originalUnit: "kg", date: "2026-10-01", source: "manual" }],
    } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, steps: [{ tool: "get_results" }, { tool: "get_body_summary" }] });
    expect(JSON.stringify(outputs)).toMatch(/bmi\\?":\{\\?"value\\?":25/);
    expect(JSON.stringify(outputs)).not.toContain("1984-04");
  });

  it("cancels model work when an evidence request is disconnected", async () => {
    const started = deferred<void>();
    const stopped = deferred<void>();
    const model = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        const blocked = deferred<void>();
        const onAbort = () => { stopped.resolve(); blocked.reject(new Error("Request cancelled")); };
        opts.abortSignal!.addEventListener("abort", onAbort, { once: true });
        started.resolve();
        await blocked.promise;
        return answer();
      },
    });
    vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(model) });
    const controller = new AbortController();
    const response = post({ scope: "research", messages: [{ role: "user", content: question }] }, controller.signal);
    await started.promise;
    controller.abort();
    await expect(response).rejects.toThrow();
    await stopped.promise;
  });

  it("rejects unknown scopes instead of falling back to patient mode", async () => {
    for (const scope of ["personal", "unknown", null, false, {}]) {
      const response = await post({ scope, messages: [{ role: "user", content: question }], snapshot: {} });
      expect(response.status).toBe(400);
    }
  });

  it("requires an explicit user text question and never turns assistant history or images into one", async () => {
    for (const messages of [[], [{ role: "assistant", content: "PRIVATE_ANSWER" }], [{ content: question }], [{ role: "user", content: " ", images: [{ mediaType: "image/png", data: "AAAA" }] }]]) {
      const response = await post({ scope: "research", messages });
      expect(response.status).toBe(400);
    }
  });
});
