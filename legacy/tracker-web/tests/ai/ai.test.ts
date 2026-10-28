import { describe, expect, it } from "vitest";
import { checkCitations, normalizeId } from "../../src/ai/citations";
import { buildAiContext, MAX_ABSTRACT_CHARS, MAX_PAPERS, systemPrompt } from "../../src/ai/context";
import { askModel, buildRequest, configProblem, describeHttpError, parseResponse, type AiConfig } from "../../src/ai/providers";
import type { Paper } from "../../src/research/papers";
import { def } from "../helpers";

const paper = (n: number, extra: Partial<Paper> = {}): Paper => ({
  id: `PMID:${1000 + n}`,
  pmid: String(1000 + n),
  title: `Study ${n}`,
  kind: "meta-analysis",
  openAccess: false,
  url: "https://example.org",
  year: 2024,
  abstract: "Short abstract.",
  ...extra,
});

describe("citation checker", () => {
  const allowed = new Set(["PMID:1001", "PMID:1002", "PMCID:PMC555"]);

  it("marks retrieved IDs as verified and others as unverified", () => {
    const r = checkCitations("Iron raises ferritin [PMID:1001]. Also see [PMID:9999].", allowed);
    expect(r.verified).toEqual(["PMID:1001"]);
    expect(r.unverified).toEqual(["PMID:9999"]);
    expect(r.segments).toEqual([
      { type: "text", text: "Iron raises ferritin " },
      { type: "cite", id: "PMID:1001", valid: true },
      { type: "text", text: ". Also see " },
      { type: "cite", id: "PMID:9999", valid: false },
      { type: "text", text: "." },
    ]);
  });

  it("handles several IDs in one bracket and different spellings", () => {
    const r = checkCitations("Shown in [PMID: 1001; pmid 1002, PMCID:PMC555].", allowed);
    expect(r.verified).toEqual(["PMID:1001", "PMID:1002", "PMCID:PMC555"]);
    expect(r.unverified).toEqual([]);
  });

  it("checks IDs written without brackets too", () => {
    const r = checkCitations("According to PMID 4242, it works.", allowed);
    expect(r.unverified).toEqual(["PMID:4242"]);
  });

  it("leaves ordinary brackets alone", () => {
    const r = checkCitations("Ferritin [a storage protein] is low.", allowed);
    expect(r.segments).toEqual([{ type: "text", text: "Ferritin [a storage protein] is low." }]);
  });

  it("counts author-year references it can't verify", () => {
    expect(checkCitations("As Smith et al. (2019) showed.", allowed).looseReferences).toEqual(["Smith et al. (2019)"]);
  });

  it("normalises IDs", () => {
    expect(normalizeId("pmid", "123")).toBe("PMID:123");
    expect(normalizeId("PMCID", "123")).toBe("PMCID:PMC123");
    expect(normalizeId("pmcid", "pmc123")).toBe("PMCID:PMC123");
  });
});

describe("context builder", () => {
  const base = {
    def: def("ferritin"),
    unit: "µg/L",
    question: "Does vitamin C help iron absorption?",
    papers: [paper(1), paper(2)],
  };

  it("includes rules, studies with IDs and the question", () => {
    const { system, user, allowedIds } = buildAiContext(base);
    expect(system).toMatch(/Cite them with their ID/);
    expect(system).toMatch(/Do not diagnose/);
    expect(user).toMatch(/\[PMID:1001\] Study 1 \(2024, Meta-analysis\)/);
    expect(user).toMatch(/QUESTION: Does vitamin C help iron absorption\?$/);
    expect([...allowedIds]).toEqual(["PMID:1001", "PMID:1002"]);
  });

  it("leaves out personal results unless given", () => {
    expect(buildAiContext(base).user).not.toMatch(/MY RESULTS/);
    const withResults = buildAiContext({
      ...base,
      results: [{ date: "2024-01-01", value: "11", flag: "low", range: "15–150 µg/L" }],
      age: 40.7,
      sex: "f",
    }).user;
    expect(withResults).toMatch(/- 2024-01-01: 11 µg\/L, low \(range 15–150 µg\/L\)/);
    expect(withResults).toMatch(/About me: age 40, female/);
  });

  it("never contains birth dates, lab names or notes (they aren't inputs)", () => {
    const user = buildAiContext({ ...base, results: [{ date: "2024-01-01", value: "11", flag: "low" }], age: 40 }).user;
    expect(user).not.toMatch(/birth|lab name|note/i);
  });

  it("limits studies and abstract length", () => {
    const many = Array.from({ length: MAX_PAPERS + 3 }, (_, i) => paper(i, { abstract: "word ".repeat(1000) }));
    const { user, allowedIds } = buildAiContext({ ...base, papers: many });
    expect(allowedIds.size).toBe(MAX_PAPERS);
    const abstractLine = user.split("\n").find((l) => l.startsWith("Abstract:"))!;
    expect(abstractLine.length).toBeLessThan(MAX_ABSTRACT_CHARS + 20);
    expect(abstractLine.endsWith("…")).toBe(true);
  });

  it("adds a no-nutrient-increase rule when the log calls for caution", () => {
    expect(systemPrompt(false)).not.toMatch(/Do not suggest increasing/);
    expect(systemPrompt(true)).toMatch(/Do not suggest increasing any nutrient/);
  });
});

describe("providers", () => {
  const anthropic: AiConfig = { provider: "anthropic", apiKey: "sk-ant-test", model: "claude-opus-5-5" };

  it("builds an Anthropic request for direct browser use", () => {
    const { url, init } = buildRequest(anthropic, "SYS", "USER");
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(init.headers["anthropic-version"]).toBe("2026-10-21");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(init.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "claude-opus-5-5", system: "SYS", messages: [{ role: "user", content: "USER" }], fallbacks: "default" });
    expect(body.temperature).toBeUndefined();
  });

  it("doesn't request fallbacks for Haiku", () => {
    const { init } = buildRequest({ ...anthropic, model: "claude-haiku-5-5" }, "S", "U");
    expect(init.headers["anthropic-beta"]).toBeUndefined();
    expect(JSON.parse(init.body).fallbacks).toBeUndefined();
  });

  it("builds OpenAI and Ollama requests", () => {
    const o = buildRequest({ provider: "openai", apiKey: "k", model: "gpt-5" }, "S", "U");
    expect(o.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(o.init.headers.authorization).toBe("Bearer k");
    const l = buildRequest({ provider: "ollama", model: "llama3.1", baseUrl: "http://localhost:11434/" }, "S", "U");
    expect(l.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(l.init.headers.authorization).toBeUndefined();
  });

  it("checks the configuration", () => {
    expect(configProblem(anthropic)).toBeUndefined();
    expect(configProblem({ ...anthropic, apiKey: " " })).toMatch(/API key/);
    expect(configProblem({ provider: "ollama", model: "x", baseUrl: "http://evil.example" })).toMatch(/only reach Ollama/);
    expect(configProblem({ provider: "ollama", model: "x", baseUrl: "http://127.0.0.1:11434" })).toBeUndefined();
  });

  it("reads Anthropic text blocks and ignores thinking and fallback blocks", () => {
    const r = parseResponse("anthropic", {
      content: [{ type: "thinking", thinking: "" }, { type: "fallback" }, { type: "text", text: "Answer " }, { type: "text", text: "[PMID:1]" }],
      stop_reason: "end_turn",
    });
    expect(r).toEqual({ ok: true, text: "Answer [PMID:1]", truncated: false });
  });

  it("reports refusals, truncation and empty answers", () => {
    expect(parseResponse("anthropic", { content: [], stop_reason: "refusal" })).toEqual({ ok: false, error: expect.stringMatching(/declined/) });
    expect(parseResponse("anthropic", { content: [{ type: "text", text: "x" }], stop_reason: "max_tokens" })).toMatchObject({ truncated: true });
    expect(parseResponse("openai", { choices: [{ message: { content: "" } }] }).ok).toBe(false);
    expect(parseResponse("openai", { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] })).toEqual({ ok: true, text: "hi", truncated: false });
  });

  it("turns HTTP errors into plain language without echoing secrets", () => {
    expect(describeHttpError("anthropic", 401, { error: { message: "invalid x-api-key sk-ant-test" } })).not.toMatch(/sk-ant/);
    expect(describeHttpError("openai", 429, {})).toMatch(/Too many requests/);
    expect(describeHttpError("anthropic", 400, { type: "error", error: { type: "invalid_request_error", message: "bad model" } })).toMatch(/bad model/);
  });

  it("askModel sends the built request and parses the answer", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const r = await askModel(anthropic, "S", "U", async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }), { status: 200 });
    });
    expect(r).toEqual({ ok: true, text: "ok", truncated: false });
    expect(seen?.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("askModel explains network failures", async () => {
    const r = await askModel({ provider: "ollama", model: "x", baseUrl: "http://localhost:11434" }, "S", "U", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/OLLAMA_ORIGINS/) });
  });
});
