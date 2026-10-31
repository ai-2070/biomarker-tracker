import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ask, dataPack } from "../../server/assistant";
import { parseCodex } from "../../server/agents";
import { callTool, closeRun, openRun, runFor, stableToken } from "../../server/bridge";
import { experimentResults, healthTools, type HealthSnapshot } from "../../server/healthTools";
import { studyIdsFromTool, toolStep } from "../../server/steps";
import { checkCitations } from "../../src/ai/citations";
import { planFromProposal, WEEKDAYS } from "../../src/core/plans";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-assistant-safety-")); vi.stubEnv("BT_DATA", dir); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); });
const snapshot: HealthSnapshot = { measurements: [], protocols: [], experiments: [], profile: {} };
const options = { toolCallId: "test", messages: [] } as never;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };

describe("assistant safety regressions", () => {
  it("rejects overlapping stable-token runs without rerouting the first person's tool", async () => {
    const tools = (person: string) => ({ sentinel: tool({ inputSchema: z.object({}), execute: async () => ({ person }) }) });
    const token = stableToken();
    const first = openRun(tools("A"), "hermes");
    try {
      expect(() => openRun(tools("B"), "hermes")).toThrow(/already answering/);
      expect(runFor(token)).toBe(first);
      expect(JSON.parse((await callTool(first, "sentinel", {})).text)).toEqual({ person: "A" });
    } finally { closeRun(first); }
    expect(runFor(token)).toBe("idle");
    const second = openRun(tools("B"), "hermes");
    try { expect(JSON.parse((await callTool(second, "sentinel", {})).text)).toEqual({ person: "B" }); }
    finally { closeRun(second); }
  });

  it("trusts retrieved records and DOI sources but not echoed identifiers or skill examples", () => {
    for (const output of [{ error: "No entry for PMID:99999999" }, { text: "PMID:99999999" }, { label: "DOI:10.1234/forged" }, { error: "failed", studies: [{ title: "Echo", id: "PMID:99999999" }] }]) {
      expect(studyIdsFromTool("get_nutrient", output)).toEqual([]);
    }
    const retrieved = { studies: [{ title: "Retrieved", id: "PMID:12345678" }, { title: "DOI only", doi: "10.1234/REAL" }] };
    expect(studyIdsFromTool("read_skill", retrieved)).toEqual([]);
    const allowed = new Set(studyIdsFromTool("get_nutrient", retrieved));
    expect(checkCitations("[PMID:12345678] [DOI:10.1234/real] [DOI:10.1234/fake]", allowed)).toMatchObject({ verified: ["PMID:12345678", "DOI:10.1234/real"], unverified: ["DOI:10.1234/fake"] });
    expect(checkCitations("DOI:10.1234/fake.", allowed).unverified).toEqual(["DOI:10.1234/fake"]);
  });

  it("marks a rejected meal as failed and transports only a validated successful meal", async () => {
    const run = openRun(healthTools(snapshot));
    try {
      const rejected = await callTool(run, "propose_meal", { intent: "record", name: "Unknown", items: [{ foodId: "missing", grams: 50 }] });
      expect(rejected.isError).toBe(true);
      expect(run.steps[0]).toMatchObject({ success: false, output: { error: expect.stringMatching(/find_foods/) } });
      const found = await healthTools(snapshot).find_foods!.execute!({ query: "porridge oats" }, options) as { foods: { id: string }[] };
      const foodId = found.foods[0]!.id;
      expect((await callTool(run, "propose_meal", { intent: "record", name: "Oats", items: [{ foodId, grams: 50 }] })).isError).toBe(false);
      expect(run.steps[1]).toMatchObject({ success: true, output: { meal: { name: "Oats", items: [{ foodId, grams: 50 }] } } });
    } finally { closeRun(run); }
  });

  it("preserves a valid 60-item proposal larger than the former JSON cutoff", async () => {
    const input = { intent: "record", name: "Full routine", items: Array.from({ length: 60 }, () => ({ label: "A".repeat(80), amount: "B".repeat(40), category: "supplement", when: "evening", note: "C".repeat(300), withFood: true, days: [...WEEKDAYS] })) };
    expect(planFromProposal(input, () => crypto.randomUUID(), "2026-10-30").ok).toBe(true);
    const step = toolStep("propose_protocol", input);
    expect(step.input.length).toBeGreaterThan(30_000);
    expect(JSON.parse(step.input)).toEqual(input);
    const run = openRun(healthTools(snapshot, undefined, { requestText: input.items.map((i) => `${i.label} ${i.amount} ${i.note}`).join("\n") }));
    try {
      await callTool(run, "propose_protocol", input);
      expect(run.steps[0]).toMatchObject({ success: true, output: { plan: { items: expect.any(Array) } } });
      const payload = z.object({ plan: z.object({ items: z.array(z.unknown()) }) }).parse(run.steps[0]!.output);
      expect(payload.plan.items).toHaveLength(60);
    } finally { closeRun(run); }
  });

  it("does not turn an interim Codex answer into success after a terminal failure", () => {
    const message = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Partial answer" } });
    expect(parseCodex(message, "")).toEqual({ ok: true, text: "Partial answer" });
    expect(parseCodex(message + "\n" + JSON.stringify({ type: "turn.failed", error: { message: "Quota exhausted" } }), "")).toEqual({ ok: false, error: "Codex: Quota exhausted" });
  });
  it("keeps post-hoc timing and protocol weekdays/with-food in tool and fallback summaries", async () => {
    const s: HealthSnapshot = { ...snapshot, experiments: [{ id: "e", change: "Routine", category: "diet", start: "2026-01-01", retestAfterDays: 30, chosenOn: "2026-03-01", markerIds: ["ldl", "hdl", "ferritin", "glucose", "vitamin_d"] }], plans: [{ id: "p", name: "Routine", createdAt: "2026-01-01", items: [{ id: "i", label: "Oats", category: "diet", when: "evening", withFood: true, days: ["mon", "wed", "fri"] }] }] };
    expect(experimentResults(s)[0]).toMatchObject({ chosenOn: "2026-03-01", pickedAfterResults: true, interpretation: expect.stringMatching(/hint, not a test/), caution: expect.stringMatching(/chance/) });
    const prospective = { ...s, experiments: s.experiments.map((e) => ({ ...e, chosenOn: "2026-01-01" })) };
    expect(experimentResults(prospective)[0]!.pickedAfterResults).toBe(false);
    const projected = await healthTools(s).get_protocols!.execute!({}, options) as { protocols: { items: unknown[] }[] };
    expect(projected.protocols[0]!.items[0]).toMatchObject({ days: ["mon", "wed", "fri"], withFood: true, when: "evening" });
    const pack = JSON.parse(dataPack(s));
    expect(pack.protocols[0].items[0]).toMatchObject({ days: ["mon", "wed", "fri"], withFood: true });
    expect(pack.experiments[0].pickedAfterResults).toBe(true);
  });

  it("carries actual model attribution and failed proposal outcome through the SDK loop", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => ++calls === 1
      ? { content: [{ type: "tool-call", toolCallId: "invalid-meal", toolName: "propose_meal", input: JSON.stringify({ intent: "record", name: "Unknown", items: [{ foodId: "missing", grams: 50 }] }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
      : { content: [{ type: "text", text: "That food was not found." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] } });
    const reply = await ask([{ role: "user", content: "Write my recipe" }], snapshot, { ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "actual-model" } } });
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.model).toBe("Ollama · actual-model");
    expect(reply.steps[0]).toMatchObject({ tool: "propose_meal", success: false });
    expect(reply.steps[0]!.output).toBeUndefined();
  });
});
