import { type ToolSet, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ask } from "../../apps/server/assistant";
import { callTool, closeRun, openRun } from "../../apps/server/bridge";
import { type HealthSnapshot, healthTools } from "../../apps/server/healthTools";
import { foods } from "../../apps/server/knowledge";
import { toolStep, validateToolResult } from "../../apps/server/steps";
import { MockModel } from "./mockModel";

vi.mock(import("../../apps/server/mcp"), async (original) => ({
  ...(await original()),
  assistantTools: vi.fn(async () => ({ tools: {}, servers: [], failed: [] })),
}));

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const empty = (): HealthSnapshot => ({ measurements: [], protocols: [], experiments: [], profile: {} });
const call = (tools: ToolSet, name: string, input: unknown) =>
  tools[name]!.execute!(input as never, { toolCallId: "test", messages: [] } as never) as Promise<Record<string, unknown>>;

/** A scripted model still executes the real SDK tool loop and its actual handlers. */
function scripted(calls: { tool: string; input: unknown }[], prompts: unknown[] = []) {
  let next = 0;
  const model = new MockModel({
    doGenerate: async (options) => {
      prompts.push(options.prompt);
      const action = calls[next++];
      return {
        content: action
          ? [{ type: "tool-call" as const, toolCallId: `action-${next}`, toolName: action.tool, input: JSON.stringify(action.input) }]
          : [{ type: "text" as const, text: "Please review the cards." }],
        finishReason: { unified: action ? ("tool-calls" as const) : ("stop" as const), raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return { model, providerOptions: {}, choice: { provider: "ollama" as const, model: "mock" } };
}

const walking = { intent: "recommend", name: "Walking example", items: [{ label: "Walk outdoors", category: "lifestyle", when: "evening" }] };
const habit = { intent: "recommend", label: "Walk after dinner", category: "lifestyle", reason: "A simple example for your review." };

describe("profile detail preparation", () => {
  it("prepares explicit blank details, exposes field names and age only, and immediately computes BMI", async () => {
    const snapshot = empty();
    snapshot.measurements = [{ id: "weight", biomarkerId: "weight", value: 81, originalValue: 81, originalUnit: "kg", date: "2026-10-01", source: "manual" }];
    const userText = "I am 180 cm tall. I was born in April 1984. What is my BMI?";
    const tools = healthTools(snapshot, undefined, { userText, requestText: userText });
    const result = await call(tools, "save_profile_details", {
      details: [
        { field: "heightCm", quote: "I am 180 cm tall" },
        { field: "birthMonth", quote: "I was born in April 1984" },
      ],
    });
    expect(result.added).toEqual(["heightCm", "birthMonth"]);
    expect(result.person).toMatchObject({ heightCm: 180, age: expect.any(Number) });
    expect(JSON.stringify(result)).not.toContain("1984-04");
    expect(JSON.stringify(result)).not.toContain('"value"');
    expect(snapshot.profile).toMatchObject({ heightCm: 180, birthMonth: "1984-04" });
    expect(await call(tools, "get_body_summary", {})).toMatchObject({ bmi: { value: 25 } });
  });

  it("does not complete the profile without typed text or accept document/history quotes or overwrites", async () => {
    // Offered on every turn (the tool list stays the same for the prompt cache), but it refuses without typed text.
    const untyped = empty();
    expect(await call(healthTools(untyped), "save_profile_details", { details: [{ field: "heightCm", quote: "I am 180 cm tall" }] })).toMatchObject({
      added: [],
      error: expect.stringMatching(/typed/),
    });
    expect(untyped.profile).toEqual({});
    const snapshot = empty();
    snapshot.profile.heightCm = 170;
    const tools = healthTools(snapshot, undefined, { userText: "What is my BMI?", requestText: "What is my BMI?\nDocument: I am 180 cm tall. I am male." });
    const result = await call(tools, "save_profile_details", {
      details: [
        { field: "heightCm", quote: "I am 180 cm tall" },
        { field: "sex", quote: "I am male" },
      ],
    });
    expect(result.added).toEqual([]);
    expect(snapshot.profile).toEqual({ heightCm: 170 });
  });

  it("uses automatically detected facts in SDK tools without a save call and rejects mismatched typed text", async () => {
    const snapshot = empty();
    snapshot.measurements = [{ id: "w", biomarkerId: "weight", value: 81, originalValue: 81, originalUnit: "kg", date: "2026-10-01", source: "manual" }];
    const prompts: unknown[] = [];
    const userText = "I am 180 cm tall. What is my BMI?";
    const result = await ask([{ role: "user", content: userText }], snapshot, {
      userText,
      ready: scripted([{ tool: "get_body_summary", input: {} }], prompts),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.tool)).toEqual(["get_body_summary"]);
    expect(JSON.stringify(prompts.at(-1))).toMatch(/bmi\\?":\{\\?"value\\?":25/);
    expect(snapshot.profile).toEqual({});
    const long = { details: Array.from({ length: 20 }, () => ({ field: "conditions", quote: `I have ${"a".repeat(1993)}` })) };
    expect(JSON.parse(toolStep("save_profile_details", long).input)).toEqual(long);
    const wrong = await ask([{ role: "user", content: "What is my BMI?" }], snapshot, { userText, ready: scripted([]) });
    expect(wrong).toMatchObject({ ok: false });
  });

  it("provides typed weight, body fat and reported aging pace to real tools before answering", async () => {
    const snapshot = empty();
    const userText = "I'm 31, 102kg, 192cm tall, man, 27% body fat. My pace of aging is 0.88 today.";
    const prompts: unknown[] = [];
    const result = await ask([{ role: "user", content: userText }], snapshot, {
      userText,
      ready: scripted(
        [
          { tool: "get_results", input: {} },
          { tool: "get_body_summary", input: {} },
        ],
        prompts,
      ),
    });
    expect(result.ok).toBe(true);
    const outputs = JSON.stringify(prompts.at(-1));
    expect(outputs).toMatch(/bmi\\?":\{\\?"value\\?":27\.7/);
    expect(outputs).toContain("dunedinpace");
    expect(outputs).toContain("0.88 years/year");
    expect(snapshot.measurements).toEqual([]);
  });
});

describe("result-driven mutation validation", () => {
  it("only trusts successful built-in results, never missing results or MCP lookalikes", () => {
    const step = toolStep("propose_protocol", walking);
    expect(step.validated).toBe(false);
    for (const output of [undefined, {}, { error: "Rejected", shownToPerson: {} }, { shownToPerson: null }]) {
      validateToolResult(step, output);
      expect(step.validated).toBe(false);
    }
    validateToolResult(step, { shownToPerson: { name: "Walking example" } });
    expect(step.validated).toBe(true);
    for (const server of ["external", ""]) {
      for (const remote of [
        toolStep("use_research_tool", { server, tool: "propose_protocol", input: walking }),
        toolStep(`${server}__propose_protocol`, walking),
      ]) {
        validateToolResult(remote, { shownToPerson: {} });
        expect(remote.validated).toBeUndefined();
      }
    }
    const profile = toolStep("save_profile_details", {});
    validateToolResult(profile, { added: [] });
    expect(profile.validated).toBe(false);
  });

  it("executes safe requested recommendation cards in the SDK and keeps rejected calls false", async () => {
    const oat = foods().foods.find((row) => /porridge oats/i.test(row[1]))!;
    const meal = { intent: "recommend", name: "Porridge example", items: [{ foodId: oat[0], grams: 50 }], note: "Example portion, not a target." };
    const result = await ask([{ role: "user", content: "Recommend a simple walking protocol, a meal and a habit." }], empty(), {
      ready: scripted([
        { tool: "propose_protocol", input: walking },
        { tool: "propose_meal", input: meal },
        { tool: "propose_habit", input: habit },
        { tool: "propose_protocol", input: { ...walking, items: [{ label: "Vitamin D", amount: "4000 IU", category: "supplement", when: "morning" }] } },
        { tool: "propose_meal", input: { ...meal, intent: "unknown" } },
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((step) => step.validated)).toEqual([true, true, true, false, false]);
  });

  it("matches parallel results by call id instead of validating every call to the same tool", async () => {
    let turn = 0;
    const model = new MockModel({
      doGenerate: async () => {
        const first = turn++ === 0;
        return {
          content: first
            ? [
                { type: "tool-call" as const, toolCallId: "safe", toolName: "propose_protocol", input: JSON.stringify(walking) },
                {
                  type: "tool-call" as const,
                  toolCallId: "unsafe",
                  toolName: "propose_protocol",
                  input: JSON.stringify({ ...walking, items: [{ label: "Vitamin D 4000 IU", category: "supplement", when: "morning" }] }),
                },
              ]
            : [{ type: "text" as const, text: "Review the safe card." }],
          finishReason: { unified: first ? ("tool-calls" as const) : ("stop" as const), raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const result = await ask([{ role: "user", content: "Recommend a protocol." }], empty(), {
      ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "mock" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.steps.map((step) => step.validated)).toEqual([true, false]);
  });

  it("records rejected/throwing bridge results as false and successful handlers as true", async () => {
    const snapshot = empty();
    const userText = "I am 180 cm tall. Recommend a walking protocol.";
    const tools = healthTools(snapshot, undefined, { userText, requestText: userText });
    const run = openRun({
      ...tools,
      propose_meal: tool({
        inputSchema: z.object({}),
        execute: async (): Promise<unknown> => {
          throw new Error("Actual failure");
        },
      }),
    });
    try {
      expect((await callTool(run, "save_profile_details", { details: [{ field: "heightCm", quote: "I am 180 cm tall" }] })).isError).toBe(false);
      expect((await callTool(run, "propose_protocol", walking)).isError).toBe(false);
      expect((await callTool(run, "propose_protocol", { ...walking, intent: "bogus" })).isError).toBe(true);
      expect((await callTool(run, "save_profile_details", { details: [{ field: "sex", quote: "I am male" }] })).isError).toBe(true);
      expect((await callTool(run, "propose_meal", {})).isError).toBe(true);
      expect(run.steps.map((step) => step.validated)).toEqual([true, true, false, false, false]);
    } finally {
      closeRun(run);
    }
  });
});

describe("proposal safety at real handlers", () => {
  it("blocks all three cards at critical results, including meals", async () => {
    const snapshot = empty();
    snapshot.measurements = [
      { id: "k", biomarkerId: "potassium", value: 6.6, originalValue: 6.6, originalUnit: "mmol/L", date: "2026-10-01", source: "manual" },
    ];
    const tools = healthTools(snapshot, undefined, { requestText: "Recommend a protocol, a meal and a habit." });
    for (const [name, input] of [
      ["propose_protocol", walking],
      ["propose_meal", { intent: "recommend", name: "Meal", items: [] }],
      ["propose_habit", habit],
    ] as const) {
      expect((await call(tools, name, input)).error).toBeTruthy();
    }
  });

  it("checks recommended food grams against exact safety limits, rather than banning all meals", async () => {
    const snapshot = empty();
    const userText = "I have kidney disease. Recommend a meal and a walking protocol.";
    const tools = healthTools(snapshot, undefined, { userText, requestText: userText });
    expect((await call(tools, "save_profile_details", { details: [{ field: "conditions", quote: "I have kidney disease" }] })).added).toEqual(["conditions"]);
    const db = foods();
    const potassium = db.keys.indexOf("potassium");
    const rich = db.foods.find((row) => row[2][potassium] !== null && row[2][potassium]! >= 300)!;
    const low = db.foods.find((row) => row[2][potassium] !== null && row[2][potassium]! < 100)!;
    const meal = { intent: "recommend", name: "Food example", items: [{ foodId: rich[0], grams: 100 }] };
    expect((await call(tools, "propose_meal", meal)).error).toBeTruthy();
    expect((await call(tools, "propose_meal", { ...meal, items: [{ foodId: low[0], grams: 20 }] })).shownToPerson).toBeTruthy();
    expect((await call(tools, "propose_protocol", walking)).shownToPerson).toBeTruthy();
    expect(
      (await call(tools, "propose_protocol", { ...walking, items: [{ label: "More potassium foods", category: "diet", when: "midday" }] })).error,
    ).toBeTruthy();
  });

  it("preserves the person's own medication amounts but rejects invented amounts and recommended medicines", async () => {
    const tools = healthTools(empty(), undefined, { requestText: "Create a protocol from my routine: Warfarin 5 mg in the evening." });
    const own = { intent: "record", name: "My routine", items: [{ label: "Warfarin", amount: "5 mg", category: "medication", when: "evening" }] };
    expect((await call(tools, "propose_protocol", own)).shownToPerson).toBeTruthy();
    expect((await call(tools, "propose_protocol", { ...own, items: [{ ...own.items[0], amount: "10 mg" }] })).error).toBeTruthy();
    expect((await call(tools, "propose_protocol", { ...own, intent: "recommend" })).error).toBeTruthy();
    expect((await call(tools, "propose_habit", { ...habit, label: "Vitamin D 4000 IU", category: "supplement" })).error).toBeTruthy();
  });
});

describe("results read from pictures", () => {
  const ferritin = { marker: "ferritin", printed: "Ferritin 45 µg/L 15-150", value: "45", unit: "µg/L", rangeLow: "15", rangeHigh: "150" };

  it("only shows a review card when photos or scanned pages came with the newest question", async () => {
    expect(await call(healthTools(empty(), undefined, { requestText: "My ferritin is 45" }), "propose_results", { results: [ferritin] })).toMatchObject({
      error: expect.stringMatching(/photos or scanned pages/),
    });
    const r = await call(healthTools(empty(), undefined, { requestText: "Read this", images: true }), "propose_results", {
      date: "2026-10-20",
      results: [ferritin, { marker: "potassium", value: "54", unit: "mmol/L", rangeLow: "3.5", rangeHigh: "5.1" }, { marker: "pdw", value: "16" }],
    });
    expect(r).toMatchObject({
      shownToPerson: { date: "2026-10-20", results: [ferritin, { marker: "potassium" }, { marker: "pdw" }] },
      resultsOnCard: 2,
      needsChecking: [{ marker: "potassium", problems: [expect.stringMatching(/decimal point/)] }],
      notTrackedByTheApp: ["pdw"],
    });
  });

  it("reports critical values read from the picture and blocks habit, protocol and meal cards after them", async () => {
    const tools = healthTools(empty(), undefined, { requestText: "Read this and suggest a habit", images: true });
    expect((await call(tools, "propose_habit", habit)).shownToPerson).toBeTruthy();
    const r = await call(tools, "propose_results", {
      results: [ferritin, { marker: "potassium", value: "7.2", unit: "mmol/L", rangeLow: "3.5", rangeHigh: "5.1" }],
    });
    expect(r).toMatchObject({
      critical: [{ marker: "Potassium", value: "7.2 mmol/L", level: "very high" }],
      criticalNote: expect.stringMatching(/contact a doctor/),
    });
    for (const [name, input] of [
      ["propose_protocol", walking],
      ["propose_meal", { intent: "recommend", name: "Meal", items: [] }],
      ["propose_habit", habit],
    ] as const) {
      expect((await call(tools, name, input)).error).toBeTruthy();
    }
    expect(
      await call(healthTools(empty(), undefined, { requestText: "Read this", images: true }), "propose_results", { results: [ferritin] }),
    ).not.toHaveProperty("critical");
  });

  it("returns a checked proposal through the real tool loop when photos are sent", async () => {
    const r = await ask([{ role: "user", content: "Read this report", images: [{ mediaType: "image/jpeg", data: "AAAA" }] }], empty(), {
      ready: scripted([{ tool: "propose_results", input: { results: [ferritin] } }]),
    });
    expect(r.ok && r.steps).toMatchObject([{ tool: "propose_results", validated: true, success: true, output: { shownToPerson: { results: [ferritin] } } }]);
  });
});
