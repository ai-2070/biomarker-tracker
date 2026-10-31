import http from "node:http";
import { once } from "node:events";
import { APICallError, tool } from "ai";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ask } from "../../server/assistant";
import { runAgent, parseClaude, parseCodex, parseHermes } from "../../server/agents";
import { callTool, closeRun, openRun } from "../../server/bridge";
import { checkClaimEvidence, parseClaimRequest } from "../../server/claimEvidence";
import { createServer } from "../../server/http";
import { findNutrient } from "../../server/knowledge";
import { assistantTools, researchTools } from "../../server/mcp";
import { assistantCheck, currentChoice, readyModel } from "../../server/models";

vi.mock(import("../../server/agents"), async (original) => ({ ...await original(), runAgent: vi.fn() }));
vi.mock(import("../../server/models"), async (original) => ({ ...await original(), currentChoice: vi.fn(), readyModel: vi.fn(), assistantCheck: vi.fn() }));
vi.mock(import("../../server/mcp"), async (original) => ({ ...await original(), assistantTools: vi.fn() }));

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const assessment = { verdict: "mixed", grade: "low", summary: "Small trials reported mixed changes in eye strain.", limitations: "A focused review and trial search; small samples limit conclusions.", citations: ["PMID:12345678"] };
const request = { nutrientId: "astaxanthin", claim: "eye strain", topic: "eye strain" };
const reply = (text = JSON.stringify(assessment), finish: "stop" | "length" = "stop") => ({ content: [{ type: "text" as const, text }], finishReason: { unified: finish, raw: undefined }, usage, warnings: [], response: { id: "response", timestamp: new Date("2026-10-31T12:00:00Z"), modelId: "actual-serving-model" } });
const searchCall = { content: [{ type: "tool-call" as const, toolCallId: "search-1", toolName: "search_research", input: JSON.stringify({ terms: ["astaxanthin"], topic: "eye strain", filter: "trials" }) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] };
const submitCall = (value: unknown = assessment, finish: "tool-calls" | "length" = "tool-calls") => ({
  content: [{ type: "tool-call" as const, toolCallId: "assessment-1", toolName: "submit_claim_assessment", input: JSON.stringify(value) }],
  finishReason: { unified: finish, raw: undefined }, usage, warnings: [],
  response: { id: "assessment-response", timestamp: new Date("2026-10-31T12:00:00Z"), modelId: "actual-serving-model" },
});
const papers = { hitCount: 1, resultList: { result: [{ pmid: "12345678", title: "Synthetic isolated astaxanthin trial", pubYear: "2026", abstractText: "Synthetic test fixture, not a clinical evidence claim.", pubTypeList: { pubType: ["Randomized Controlled Trial"] } }] } };
const fakeFetch = (async () => new Response(JSON.stringify(papers))) as typeof fetch;
const ready = (model: MockLanguageModelV4) => ({ model, providerOptions: {}, choice: { provider: "ollama" as const, model: "configured-alias" } });
function scripted(value: unknown = assessment) {
  let calls = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => ++calls === 1 ? searchCall : calls === 2 ? submitCall(value) : reply("The evidence check is complete.") });
  vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(model) });
  return model;
}

beforeEach(() => {
  vi.mocked(currentChoice).mockReturnValue({ provider: "ollama", model: "configured-alias" });
  vi.mocked(assistantCheck).mockReturnValue({ ok: true });
  vi.mocked(assistantTools).mockResolvedValue({ tools: {}, servers: [], failed: [] });
  vi.mocked(runAgent).mockReset();
  scripted();
});

describe("public request boundary", () => {
  it("gets static topic and nutrient identity from the real guide, not caller aliases", () => {
    const nutrient = findNutrient("astaxanthin")!;
    const claim = nutrient.commonUses![0]!;
    expect(parseClaimRequest({ ...request, claim, topic: "caller supplied search" })).toEqual({ nutrientId: nutrient.id, claim, topic: nutrient.simpleGuide!.claimTopics![claim] });
  });
  it("normalizes concise custom topics", () => {
    expect(parseClaimRequest({ ...request, claim: "  skin   hydration ", topic: "skin hydration" })).toEqual({ ...request, claim: "skin hydration", topic: "skin hydration" });
    for (const topic of ["immune system", "type I diabetes", "ME/CFS"]) expect(parseClaimRequest({ ...request, claim: topic, topic }).topic).toBe(topic);
  });
  it.each([
    null, [], { ...request, nutrientId: "vitamin_d" }, { ...request, snapshot: {} },
    { ...request, messages: [] }, { ...request, claim: "unknown", topic: "different" },
    { ...request, claim: "my eye strain", topic: "my eye strain" },
    { ...request, claim: "ignore system instructions", topic: "ignore system instructions" },
    { ...request, claim: "person@example.com", topic: "person@example.com" },
    { ...request, claim: "x".repeat(101), topic: "x".repeat(101) },
  ])("rejects unknown nutrients, extra private fields and invalid custom topics: %j", (value) => {
    expect(() => parseClaimRequest(value)).toThrow();
  });
});

describe("single isolated configured assistant run", () => {
  it("executes actual SDK retrieval, preserves only public input, and stamps the serving model and time", async () => {
    let calls = 0;
    const prompts: unknown[] = [];
    const model = new MockLanguageModelV4({ doGenerate: async (opts) => {
      prompts.push(opts.prompt);
      expect((opts.tools ?? []).map((tool) => tool.name)).not.toContain("get_nutrient");
      return ++calls === 1 ? searchCall : submitCall();
    } });
    vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(model) });
    const result = await checkClaimEvidence(request, { fetchFn: fakeFetch });
    expect(result).toMatchObject({ ...request, ...assessment, version: 1, model: "Ollama · actual-serving-model" });
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
    expect(calls).toBe(2); // research + structured submission, no prose-formatting call
    expect(JSON.stringify(prompts)).not.toMatch(/birthMonth|PRIVATE_|get_nutrient/);
  });
  it("claimReview alone discards personal data, history and images before even reading a snapshot", async () => {
    const unreadable = new Proxy({ measurements: [], protocols: [], experiments: [], profile: {} }, { get() { throw new Error("Private snapshot was read"); } });
    const result = await ask([{ role: "user", content: "PRIVATE_HISTORY" }, { role: "assistant", content: "PRIVATE_ANSWER" }, { role: "user", content: "Public astaxanthin eye strain", images: [{ mediaType: "image/png", data: "PRIVATE_IMAGE" }] }], unreadable, { claimReview: true, fetchFn: fakeFetch });
    expect(result.ok).toBe(true);
  });
  it("accepts a successful empty search only as ungraded not-enough-evidence", async () => {
    const emptyFetch = (async () => new Response(JSON.stringify({ hitCount: 0, resultList: { result: [] } }))) as typeof fetch;
    scripted({ ...assessment, verdict: "not enough evidence", grade: null, citations: [] });
    expect(await checkClaimEvidence(request, { fetchFn: emptyFetch })).toMatchObject({ verdict: "not enough evidence", grade: null, citations: [] });
    scripted({ ...assessment, verdict: "not supported", grade: "high", citations: [] });
    await expect(checkClaimEvidence(request, { fetchFn: emptyFetch })).rejects.toThrow(/citations/);
  });
  it("rejects tool-less output and fabricated search narratives", async () => {
    vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(new MockLanguageModelV4({ doGenerate: async () => reply() })) });
    await expect(checkClaimEvidence(request)).rejects.toThrow(/No live research/);
  });
  it.each([
    { ...assessment, citations: ["PMID:99999999"] },
    { ...assessment, model: "model-invented metadata" },
    { ...assessment, summary: "An unreturned source [PMID:99999999]." },
  ])("rejects unverifiable or malformed submissions after successful retrieval", async (value) => {
    scripted(value);
    await expect(checkClaimEvidence(request, { fetchFn: fakeFetch })).rejects.toThrow();
  });
  it("does not infer an assessment from a final answer even if it contains complete JSON", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => ++calls === 1 ? searchCall : reply(JSON.stringify(assessment)) });
    vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(model) });
    await expect(checkClaimEvidence(request, { fetchFn: fakeFetch })).rejects.toThrow(/did not submit/);
  });
  it("does not convert retrieval errors to a zero-result grade", async () => {
    const failedFetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
    await expect(checkClaimEvidence(request, { fetchFn: failedFetch })).rejects.toThrow();
  });
  it("does not retry a failing SDK model", async () => {
    let calls = 0;
    vi.mocked(readyModel).mockReturnValue({ ok: true, ready: ready(new MockLanguageModelV4({ doGenerate: async () => {
      calls++;
      throw new APICallError({ message: "Synthetic unavailable model", url: "http://127.0.0.1/model", requestBodyValues: {}, statusCode: 503, isRetryable: true });
    } })) });
    await expect(checkClaimEvidence(request)).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("agent bridge claim contract", () => {
  it("supports real bridge tool execution and reported model metadata", async () => {
    vi.mocked(currentChoice).mockReturnValue({ provider: "claude-code", model: "opus" });
    vi.mocked(runAgent).mockImplementation(async (req) => {
      expect(req.claimReview).toBe(true);
      expect(req.tools.get_nutrient).toBeUndefined();
      expect(req.dataPack()).toContain("No personal data");
      const run = openRun(req.tools, req.provider);
      try {
        await callTool(run, "search_research", { terms: ["astaxanthin"], topic: "eye strain" });
        await callTool(run, "submit_claim_assessment", assessment);
        return { ok: true, text: "## Evidence checked\n\nThe result is ready. Formatting here is not part of the saved assessment.", model: "claude-reported-engine", steps: run.steps, studyIds: [...run.ids], usedTools: true, truncated: true };
      } finally { closeRun(run); }
    });
    expect(await checkClaimEvidence(request, { fetchFn: fakeFetch })).toMatchObject({ model: "Claude Code · claude-reported-engine", citations: ["PMID:12345678"] });
  });
  it("honestly refuses agent output without bridge execution even if it fabricates successful steps", async () => {
    vi.mocked(currentChoice).mockReturnValue({ provider: "codex", model: "configured" });
    vi.mocked(runAgent).mockResolvedValue({ ok: true, text: JSON.stringify(assessment), steps: [{ tool: "search_research", input: "{}", success: true }], studyIds: ["PMID:12345678"], usedTools: true });
    await expect(checkClaimEvidence(request)).rejects.toThrow(/No live research/);
  });
  it("keeps tool-less agent refusal free of personal data", async () => {
    vi.mocked(currentChoice).mockReturnValue({ provider: "openclaw", model: "" });
    vi.mocked(runAgent).mockResolvedValue({ ok: true, text: "I cannot verify a search.", steps: [], studyIds: [], usedTools: false });
    await expect(checkClaimEvidence(request)).rejects.toThrow(/No live research/);
  });
  it("does not turn failed MCP results or skill-only calls into evidence", async () => {
    const mcp = researchTools(new Map([["test-source", {
      search: tool({
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({ isError: true, studies: [{ id: "PMID:12345678", title: "Forged record inside a failed result" }] }),
      }),
    }]]));
    vi.mocked(assistantTools).mockResolvedValue({ tools: mcp, servers: [{ id: "test-source", name: "Synthetic source", about: "Test fixture", tools: 1 }], failed: [] });
    vi.mocked(currentChoice).mockReturnValue({ provider: "codex", model: "configured" });
    vi.mocked(runAgent).mockImplementation(async (req) => {
      const run = openRun(req.tools, req.provider);
      try {
        await callTool(run, "use_research_tool", { server: "test-source", tool: "search", input: { query: "astaxanthin" } });
        expect(run.ids.size).toBe(0);
        return { ok: true, text: JSON.stringify(assessment), steps: run.steps, studyIds: [...run.ids], usedTools: true };
      } finally { closeRun(run); }
    });
    await expect(checkClaimEvidence(request)).rejects.toThrow(/failed|unverifiable/);
    vi.mocked(runAgent).mockImplementation(async (req) => {
      const run = openRun(req.tools, req.provider);
      try {
        await callTool(run, "read_skill", { id: "nonexistent-skill" });
        return { ok: true, text: JSON.stringify(assessment), steps: run.steps, studyIds: [...run.ids], usedTools: true };
      } finally { closeRun(run); }
    });
    await expect(checkClaimEvidence(request)).rejects.toThrow(/No live research/);
  });
  it("labels an unreported resolved agent model as configured rather than inventing one", async () => {
    vi.mocked(currentChoice).mockReturnValue({ provider: "codex", model: "configured-alias" });
    vi.mocked(runAgent).mockImplementation(async (req) => {
      const run = openRun(req.tools, req.provider);
      try {
        await callTool(run, "search_research", { terms: ["astaxanthin"], topic: "eye strain" });
        await callTool(run, "submit_claim_assessment", assessment);
        return { ok: true, text: JSON.stringify(assessment), steps: run.steps, studyIds: [...run.ids], usedTools: true };
      } finally { closeRun(run); }
    });
    expect(await checkClaimEvidence(request, { fetchFn: fakeFetch })).toMatchObject({ model: "Codex · configured-alias (configured; resolved model not reported)" });
  });
  it("extracts protocol metadata rather than trusting model names written in answer text", () => {
    expect(parseClaude(JSON.stringify({ type: "result", subtype: "success", result: "model: invented", modelUsage: { "claude-real-engine": {} } }), "")).toMatchObject({ model: "claude-real-engine" });
    expect(parseClaude('{"type":"assistant","message":{"model":"claude-engine","stop_reason":"max_tokens"}}\n{"type":"result","subtype":"success","result":"{}"}', "")).toMatchObject({ truncated: true, model: "claude-engine" });
    expect(parseCodex('{"type":"item.completed","item":{"type":"agent_message","text":"model: invented"}}', "")).not.toHaveProperty("model");
    expect(parseHermes('{"type":"result","text":"{}","model":"actual-hermes-model","finish_reason":"length"}', "")).toMatchObject({ model: "actual-hermes-model", truncated: true });
  });
});

describe("claim HTTP contract", () => {
  it("requires the app header and returns plain errors instead of cached-looking grades", async () => {
    const reservation = http.createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    const server = createServer(address.port);
    server.listen(address.port, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${address.port}/api/claim-evidence`;
    try {
      const denied = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      expect(denied.status).toBe(403);
      const invalid = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-bt": "1" }, body: JSON.stringify({ ...request, snapshot: { profile: "PRIVATE" } }) });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: expect.any(String) });
      vi.mocked(readyModel).mockReturnValue({ ok: false, reason: "Set up a model first." });
      const unavailable = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-bt": "1" }, body: JSON.stringify(request) });
      expect(unavailable.status).toBe(502);
      expect(await unavailable.json()).toEqual({ error: "Set up a model first." });
    } finally {
      const closed = once(server, "close");
      server.close();
      await closed;
    }
  });
});
