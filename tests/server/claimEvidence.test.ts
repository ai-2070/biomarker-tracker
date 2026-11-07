import { once } from "node:events";
import http from "node:http";
import { claimCheckLabel } from "@bt/shared/core/claimEvidence";
import { APICallError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../../apps/server/agents";
import { ask } from "../../apps/server/assistant";
import { callTool, closeRun, openRun } from "../../apps/server/bridge";
import { checkClaimEvidence, parseClaimRequest } from "../../apps/server/claimEvidence";
import { createServer } from "../../apps/server/http";
import { findNutrient, knowledge } from "../../apps/server/knowledge";
import { assistantCheck, currentChoice, readyModel } from "../../apps/server/models";
import { MockModel } from "./mockModel";
import { rawCall } from "./trpc";

vi.mock(import("../../apps/server/agents"), async (original) => ({ ...(await original()), runAgent: vi.fn() }));
vi.mock(import("../../apps/server/models"), async (original) => ({
  ...(await original()),
  currentChoice: vi.fn(),
  readyModel: vi.fn(),
  assistantCheck: vi.fn(),
}));

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const assessment = {
  verdict: "mixed",
  grade: "low",
  summary: "Synthetic trial results remain uncertain [PMID:12345678].",
  limitations: "Synthetic fixtures test the pipeline, not a clinical claim.",
  citations: ["PMID:12345678"],
};
const request = { nutrientId: "test-intervention-not-in-kb", claim: "test outcome", topic: "test outcome" };
const screen = {
  id: "PMID:12345678",
  decision: "direct",
  reason: "Synthetic matching human trial with the intervention alone.",
  route: "oral",
  formulation: "alone",
  evidence: "human_trial",
};
const plan = { interventionSynonyms: [], outcomeSynonyms: ["alternative endpoint"], route: "any" };
const record = {
  pmid: "12345678",
  title: "Synthetic human trial",
  pubYear: "2025",
  abstractText: "Synthetic test fixture, not clinical evidence.",
  pubTypeList: { pubType: ["Randomized Controlled Trial"] },
};
const fakeFetch = vi.fn(async () => Response.json({ hitCount: 1, resultList: { result: [record] } }));
const emptyFetch = vi.fn(async () => Response.json({ hitCount: 0, resultList: { result: [] } }));
const call = (toolName: string, input: unknown) => ({
  content: [{ type: "tool-call" as const, toolCallId: crypto.randomUUID(), toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
  response: { id: "response", timestamp: new Date(), modelId: "actual-serving-model" },
});
const finish = () => ({
  content: [{ type: "text" as const, text: "Done." }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage,
  warnings: [],
  response: { id: "response", timestamp: new Date(), modelId: "actual-serving-model" },
});
function scripted(value: unknown = assessment, screening: unknown = screen, extra = false) {
  const actions = [
    call("prepare_claim_search", plan),
    ...(extra ? [call("search_research", { ...plan, route: undefined, filter: "all" })] : []),
    call("screen_claim_records", { records: [screening] }),
    call("submit_claim_assessment", value),
  ];
  const model = new MockModel({ doGenerate: async () => actions.shift() ?? finish() });
  vi.mocked(readyModel).mockReturnValue({ ok: true, ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "configured-alias" } } });
  return model;
}
beforeEach(() => {
  vi.mocked(currentChoice).mockReturnValue({ provider: "ollama", model: "configured-alias" });
  vi.mocked(assistantCheck).mockReturnValue({ ok: true });
  vi.mocked(runAgent).mockReset();
  fakeFetch.mockClear();
  emptyFetch.mockClear();
  scripted();
});

describe("public request boundary", () => {
  it("supports interventions without knowledge-base entries and the same free-text path", () => {
    expect(findNutrient(request.nutrientId)).toBeUndefined();
    expect(parseClaimRequest(request)).toEqual(request);
    expect(parseClaimRequest({ ...request, depth: "deep" })).toEqual(request);
  });
  it("resolves existing preset topics from knowledge without trusting caller search text", () => {
    for (const nutrient of knowledge().nutrients.filter((n) => n.simpleGuide?.claimTopics)) {
      const claim = nutrient.commonUses![0]!;
      expect(parseClaimRequest({ nutrientId: nutrient.id, claim, topic: "caller search" }).topic).toBe(nutrient.simpleGuide!.claimTopics![claim]);
    }
  });
  it.each([
    null,
    [],
    { ...request, snapshot: {} },
    { ...request, messages: [] },
    { ...request, nutrientId: "bad id" },
    { ...request, claim: "my sleep", topic: "my sleep" },
    { ...request, claim: "different" },
    { ...request, depth: "unlimited" },
    { ...request, deepModel: "anything" },
    { ...request, depth: "deep", deepModel: "opus" },
  ])("rejects private data, instructions and invalid options: %j", (value) => {
    expect(() => parseClaimRequest(value)).toThrow();
  });
});

describe("audited claim workflow", () => {
  it("runs reviews, trials, broad and only then model extras; records exact queries, counts and unique screening", async () => {
    scripted(assessment, screen, true);
    const result = await checkClaimEvidence(request, { fetchFn: fakeFetch });
    expect(result).toMatchObject({
      ...request,
      ...assessment,
      version: 2,
      model: "Ollama · actual-serving-model",
      research: { status: "evidence_found", retrieved: 1, screened: 1, included: 1 },
    });
    expect(result.research!.queries.map((q) => q.rung)).toEqual(["reviews", "trials", "broad", "extra"]);
    const queries = result.research!.queries;
    expect(queries[0]!.query).toMatch(/meta-analysis.*systematic review/);
    expect(queries[1]!.query).toContain('PUB_TYPE:"randomized controlled trial"');
    expect(queries[2]!.query).not.toContain("PUB_TYPE");
    for (const query of queries) {
      expect(query.resultCount).toBe(1);
      expect(query.sort).toBe("relevance");
      expect(query.query).toContain('TITLE_ABS:"test intervention not in kb"');
      expect(query.query).toContain('AND (TITLE_ABS:"test outcome"');
    }
    expect(fakeFetch).toHaveBeenCalledTimes(4);
  });
  it("does not let an empty review rung become no evidence or skip the trial/broad rungs", async () => {
    let i = 0;
    const fetcher = vi.fn(async () => (++i === 1 ? emptyFetch() : fakeFetch()));
    const result = await checkClaimEvidence(request, { fetchFn: fetcher });
    expect(result.research!.queries.map((q) => q.resultCount)).toEqual([0, 1, 1]);
    expect(claimCheckLabel(result)).not.toBe("No evidence found");
    expect(result.grade).toBe("low");
  });
  it("allows no evidence for a fictional compound only after a completely clean empty ladder", async () => {
    const result = await checkClaimEvidence({ ...request, nutrientId: "zorbafluxium-fictional" }, { fetchFn: emptyFetch });
    expect(emptyFetch).toHaveBeenCalledTimes(3);
    expect(result.research).toMatchObject({ status: "no_evidence", retrieved: 0, screened: 0, included: 0 });
    expect(result.research!.queries.map((q) => q.rung)).toEqual(["reviews", "trials", "broad"]);
    expect(claimCheckLabel(result)).toBe("No evidence found");
  });
  it("distinguishes no relevant evidence from a zero-hit search by recording every exclusion", async () => {
    scripted(
      { ...assessment, verdict: "not enough evidence", grade: null, citations: [], summary: "All retrieved studies addressed an unrelated intervention." },
      { ...screen, decision: "exclude", reason: "The abstract addresses an unrelated intervention and outcome." },
    );
    const result = await checkClaimEvidence(request, { fetchFn: fakeFetch });
    expect(result.research).toMatchObject({ status: "no_evidence", retrieved: 1, screened: 1, included: 0 });
  });
  it.each(["topical", "oral"])("includes %s combination evidence as indirect with a very-low grade", async (route) => {
    scripted({ ...assessment, grade: "very low" }, { ...screen, decision: "indirect", route, formulation: "combination" });
    const result = await checkClaimEvidence(request, { fetchFn: fakeFetch });
    expect(result.research).toMatchObject({ status: "indirect_only", included: 1 });
    expect(claimCheckLabel(result)).toBe("Very low (indirect only)");
  });
  it.each([
    ["null grade despite direct evidence", { ...assessment, verdict: "not enough evidence", grade: null }, screen],
    ["unretrieved citation", { ...assessment, citations: ["PMID:99999999"] }, screen],
    ["blend labelled direct", assessment, { ...screen, formulation: "combination" }],
    ["unreviewed records", assessment, { ...screen, id: "PMID:99999999" }],
  ])("keeps %s inconclusive rather than saving a false absence", async (_reason, value, screening) => {
    scripted(value, screening);
    const result = await checkClaimEvidence(request, { fetchFn: fakeFetch });
    expect(result.research!.status).toBe("search_failed");
    expect(claimCheckLabel(result)).toBe("Search failed, retry");
  });
  it.each(["timeout", "empty-response", "http-error"])("failure injection: %s never becomes no evidence", async (kind) => {
    let i = 0;
    const fetcher = vi.fn(async () => {
      if (++i !== 1) return fakeFetch();
      if (kind === "timeout") throw new DOMException("Search timed out", "TimeoutError");
      if (kind === "empty-response") return Response.json({ hitCount: 4, resultList: { result: [] } });
      return new Response("Unavailable", { status: 503 });
    });
    const result = await checkClaimEvidence(request, { fetchFn: fetcher });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.research!.queries[0]!.error).toBeTruthy();
    expect(result.research!.status).toBe("search_failed");
    expect(result.grade).toBeNull();
    expect(claimCheckLabel(result)).toBe("Search failed, retry");
  });
  it("does not retry an unavailable SDK model or fabricate completed searches", async () => {
    let calls = 0;
    const model = new MockModel({
      doGenerate: async () => {
        calls++;
        throw new APICallError({ message: "Synthetic unavailable", url: "http://127.0.0.1/model", requestBodyValues: {}, statusCode: 503, isRetryable: true });
      },
    });
    vi.mocked(readyModel).mockReturnValue({ ok: true, ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "configured" } } });
    const result = await checkClaimEvidence(request);
    expect(calls).toBe(1);
    expect(result.research!.queries).toEqual([]);
    expect(result.research!.status).toBe("search_failed");
  });
  it("isolates personal data/history for direct claimReview callers too", async () => {
    const unreadable = new Proxy(
      { measurements: [], protocols: [], experiments: [], profile: {} },
      {
        get() {
          throw new Error("Private snapshot read");
        },
      },
    );
    const result = await ask(
      [
        { role: "user", content: "PRIVATE_HISTORY" },
        { role: "user", content: "Public claim", images: [{ mediaType: "image/png", data: "PRIVATE_IMAGE" }] },
      ],
      unreadable,
      { claimReview: true },
    );
    expect(result.ok).toBe(false);
  });
});

describe("configured model and deeper budgets", () => {
  it.each([
    { provider: "claude-code", model: "haiku", effort: "low" },
    { provider: "codex", model: "selected-codex-model", effort: "medium" },
    { provider: "hermes", model: "selected-hermes-model", effort: "high" },
  ] as const)("preserves $provider model and effort, with no turn limit and the shared 10-minute limit", async (choice) => {
    vi.mocked(currentChoice).mockReturnValue(choice);
    vi.mocked(runAgent).mockImplementation(async (req) => {
      expect(req.provider).toBe(choice.provider);
      expect(req.model).toBe(choice.model);
      expect(req.effort).toBe(choice.effort);
      expect(req).not.toHaveProperty("budget");
      expect(req.signal).toBeInstanceOf(AbortSignal);
      expect(req.tools.get_nutrient).toBeUndefined();
      expect(req.tools.use_research_tool).toBeUndefined();
      expect(req.dataPack()).toContain("No personal data");
      const run = openRun(req.tools, req.provider);
      try {
        await callTool(run, "prepare_claim_search", plan);
        await callTool(run, "screen_claim_records", { records: [screen] });
        await callTool(run, "submit_claim_assessment", assessment);
        return { ok: true, text: "Done", model: "reported-engine", steps: run.steps, studyIds: [...run.ids], usedTools: true };
      } finally {
        closeRun(run);
      }
    });
    const result = await checkClaimEvidence({ ...request, depth: "deep" }, { fetchFn: fakeFetch });
    expect(result).toMatchObject({ grade: "low", research: { depth: "deep", status: "evidence_found" } });
    expect(result.model).toContain("reported-engine");
    for (const [url] of fakeFetch.mock.calls as unknown as [string][]) expect(new URL(url).searchParams.get("pageSize")).toBe("30");
    expect(currentChoice()).toEqual(choice);
  });
  it.each(["ollama", "custom", "openrouter", "openai"] as const)("uses the saved %s model without requiring a deep model override", async (provider) => {
    const choice = { provider, model: "selected-model", effort: "low" as const };
    vi.mocked(currentChoice).mockReturnValue(choice);
    vi.mocked(readyModel).mockClear();
    const result = await checkClaimEvidence({ ...request, depth: "deep" }, { fetchFn: fakeFetch });
    expect(result.research?.status).toBe("evidence_found");
    expect(readyModel).toHaveBeenCalledWith({ cacheKey: "biomarker-tracker-claim" });
    expect(currentChoice()).toEqual(choice);
  });
  it("does not trust an agent's invented tool steps", async () => {
    vi.mocked(currentChoice).mockReturnValue({ provider: "codex", model: "configured" });
    vi.mocked(runAgent).mockResolvedValue({
      ok: true,
      text: JSON.stringify(assessment),
      steps: [{ tool: "search_research", input: "{}", success: true }],
      studyIds: ["PMID:12345678"],
      usedTools: true,
    });
    const result = await checkClaimEvidence(request);
    expect(result.research!.status).toBe("search_failed");
    expect(result.research!.queries).toEqual([]);
  });
});

describe("claim HTTP contract", () => {
  it("requires the app header and rejects private extra fields", async () => {
    const reserve = http.createServer();
    reserve.listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const server = createServer(port);
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    try {
      expect((await rawCall(port, "claimEvidence.check", { mutation: true, input: request, headers: {} })).status).toBe(403);
      const invalid = await rawCall(port, "claimEvidence.check", { mutation: true, input: { ...request, snapshot: { profile: "PRIVATE" } } });
      expect(invalid.status).toBe(400);
      expect(((await invalid.json()) as { error: { message: string } }).error.message).toMatch(/without personal data/);
    } finally {
      const closed = once(server, "close");
      server.close();
      await closed;
    }
  });
});
