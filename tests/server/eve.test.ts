import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePart, encodeOptions } from "../../runtime/eve/agent/lib/model";
import { ask } from "../../server/assistant";
import type { BrainEvent } from "../../server/brain/events";
import { closeEveRun, contextWindow, decodeOptions, openEveRun, withCache } from "../../server/eve/bridge";
import { eveBuilt, eveHost, stopEve } from "../../server/eve/host";
import { readEveEvent } from "../../server/eve/run";
import type { HealthSnapshot } from "../../server/healthTools";
import { createServer } from "../../server/http";
import { DATA } from "../../server/store";
import { MockModel } from "./mockModel";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const snapshot: HealthSnapshot = { measurements: [{ id: "f1", biomarkerId: "ferritin", date: "2024-05-12", value: 40, originalValue: 40, originalUnit: "µg/L", source: "manual" }], protocols: [], experiments: [], profile: {} };

describe("eve events", () => {
  it("streams deltas, keeps the reply parts, and ends on the turn's outcome", () => {
    const events: BrainEvent[] = [];
    const state = { reply: new Map<string, string>() } as Parameters<typeof readEveEvent>[1];
    for (const e of [
      { type: "model.started", data: {} },
      { type: "content.delta", data: { partId: "p0", delta: "Let me look. " } },
      { type: "content.completed", data: { kind: "text", phase: "narration", partId: "p0", value: "Let me look. " } },
      { type: "content.delta", data: { partId: "p1", delta: "Fine." } },
      { type: "content.completed", data: { kind: "text", phase: "reply", partId: "p1", value: "Fine." } },
      { type: "turn.settled", data: { outcome: "completed", reply: ["p1"] } },
    ]) readEveEvent(e, state, (x) => events.push(x));
    expect(events).toEqual([{ kind: "status", text: "Thinking…" }, { kind: "text", text: "Let me look. " }, { kind: "text", text: "Fine." }]);
    expect(state).toMatchObject({ outcome: "completed", replyIds: ["p1"] });
    expect([...state.reply.entries()]).toEqual([["p1", "Fine."]]);
    const refused = { reply: new Map<string, string>() } as Parameters<typeof readEveEvent>[1];
    readEveEvent({ type: "delivery.settled", data: { outcome: "refused", reason: "No." } }, refused, () => {});
    expect(refused).toMatchObject({ outcome: "failed", error: "No." });
  });
});

describe("the model bridge", () => {
  it("carries call options and stream parts as JSON, bytes and dates included", () => {
    const options = { prompt: [{ role: "user", content: [{ type: "file", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) }] }], abortSignal: new AbortController().signal } as unknown as LanguageModelV4CallOptions;
    const back = decodeOptions(encodeOptions(options));
    expect(back).not.toHaveProperty("abortSignal");
    expect((back.prompt[0]!.content as unknown as { data: Uint8Array }[])[0]!.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(decodePart({ type: "response-metadata", id: "r", timestamp: "2026-11-04T10:00:00.000Z" })).toMatchObject({ timestamp: new Date("2026-11-04T10:00:00.000Z") });
    const error = decodePart({ type: "error", error: { message: "bad key", statusCode: 401 } }) as { error: Error & { statusCode?: number } };
    expect(error.error).toBeInstanceOf(Error);
    expect(error.error.statusCode).toBe(401);
  });

  it("adds the same cache points as the built-in loop to eve's prompt", () => {
    const options = { prompt: [{ role: "system", content: "eve's own" }, { role: "system", content: "RULES" }, { role: "user", content: [{ type: "text", text: "hi" }] }] } as unknown as LanguageModelV4CallOptions;
    const anthropic = withCache("anthropic", options, "RULES", "k", {});
    expect(anthropic.prompt.map((m) => m.providerOptions)).toEqual([undefined, { anthropic: { cacheControl: { type: "ephemeral" } } }, { anthropic: { cacheControl: { type: "ephemeral" } } }]);
    expect(withCache("openai", options, "RULES", "k", { openai: { store: false } }).providerOptions).toEqual({ openai: { store: false, promptCacheKey: "k" } });
    expect(withCache("ollama", options, "RULES", "k", {}).prompt).toEqual(options.prompt);
    expect(contextWindow("anthropic")).toBe(200_000);
    expect(contextWindow("ollama")).toBe(32_000);
  });
});

describe("the eve bridge refuses everyone else", () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = createServer(0);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  it("without the runtime's token, or for a question that has ended", async () => {
    const { model } = { model: new MockModel({ doGenerate: async () => ({ content: [], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) }) };
    const run = openEveRun({ tools: {}, parts: { stable: "RULES", request: "" }, history: [], ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "m" } }, key: "k" });
    const post = (token: string, body: unknown) => fetch(`http://127.0.0.1:${port}/eve-bridge/configuration`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    expect((await post("0".repeat(64), { run: run.id })).status).toBe(403);
    expect((await post("", { run: run.id })).status).toBe(403);
    closeEveRun(run);
  });
});

describe.skipIf(!eveBuilt() || process.platform === "win32")("a question answered in eve (built runtime, mock model)", () => {
  let server: http.Server;
  beforeAll(async () => {
    const reservation = http.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    server = createServer(port);
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  });
  afterAll(async () => {
    await stopEve();
    server.close();
  });

  it("uses the app's tools through the bridge, streams the text, and returns the checked reply", async () => {
    const prompts: unknown[] = [];
    let n = 0;
    const model = new MockModel({
      doGenerate: async (options) => {
        prompts.push(options.prompt);
        return n++ === 0
          ? { content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "get_results", input: "{}" }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] }
          : { content: [{ type: "text" as const, text: "Your ferritin is 40 µg/L, in range." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
      },
    });
    const events: BrainEvent[] = [];
    const r = await ask(
      [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello." }, { role: "user", content: "How is my ferritin?" }],
      snapshot,
      { ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "mock" } }, engine: "eve", onEvent: (e) => events.push(e) },
    );
    expect(r).toMatchObject({ ok: true, text: "Your ferritin is 40 µg/L, in range.", model: expect.stringMatching(/eve$/) });
    if (!r.ok) return;
    expect(r.steps.map((s) => s.tool)).toEqual(["get_results"]);
    expect(events.some((e) => e.kind === "tool" && e.tool === "get_results")).toBe(true);
    expect(events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text).join("")).toContain("in range.");
    // The rules came from the main server, the earlier turns as history, the question last.
    const first = JSON.stringify(prompts[0]);
    expect(first).toContain("You are Brain");
    expect(first.indexOf("Hello.")).toBeLessThan(first.indexOf("How is my ferritin?"));
    // Its run store is in the data folder.
    expect(fs.existsSync(path.join(DATA(), "eve"))).toBe(true);
  }, 120_000);

  it("stops when the person stops", async () => {
    const controller = new AbortController();
    const model = new MockModel({
      doGenerate: async () => {
        controller.abort();
        return await new Promise(() => {});
      },
    });
    const r = await ask([{ role: "user", content: "Wait" }], snapshot, { ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "mock" } }, engine: "eve", signal: controller.signal });
    expect(r).toEqual({ ok: false, error: "Stopped." });
    // The runtime itself keeps running for the next question.
    expect((await fetch(`${(await eveHost()).url}/eve/v1/health`)).ok).toBe(true);
  }, 120_000);
});

describe("the eve setting", () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = createServer(0);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());
  const put = (on: unknown) => fetch(`http://127.0.0.1:${port}/api/settings/eve`, { method: "PUT", headers: { "content-type": "application/json", "x-bt": "1" }, body: JSON.stringify({ on }) });

  it("is off by default, can't be switched on without the built runtime, and switches off", async () => {
    const settings = (await (await fetch(`http://127.0.0.1:${port}/api/settings`)).json()) as { eve: { on: boolean } };
    expect(settings.eve.on).toBe(false);
    const old = process.env.BT_EVE_ENTRY;
    process.env.BT_EVE_ENTRY = path.join(DATA(), "missing", "launch.mjs");
    try {
      const refused = await put(true);
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toMatch(/isn't built/);
    } finally {
      if (old === undefined) delete process.env.BT_EVE_ENTRY;
      else process.env.BT_EVE_ENTRY = old;
    }
    expect((await put("yes")).status).toBe(400);
    expect(await (await put(false)).json()).toMatchObject({ ok: true, eve: { on: false } });
  });
});
