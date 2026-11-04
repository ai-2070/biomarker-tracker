import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DefaultChatTransport, readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask } from "../../server/assistant";
import type { BrainEvent } from "../../server/brain/events";
import { claudeLines, codexLines, hermesLines } from "../../server/agents";
import type { HealthSnapshot } from "../../server/healthTools";
import { createServer } from "../../server/http";
import { TurnChunks } from "../../server/uistream";
import { installFakeAgents, type FakeAgents } from "./fakeAgents";
import { MockModel } from "./mockModel";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const snapshot: HealthSnapshot = { measurements: [{ id: "f1", biomarkerId: "ferritin", date: "2024-05-12", value: 40, originalValue: 40, originalUnit: "µg/L", source: "manual" }], protocols: [], experiments: [], profile: {} };

describe("events to UI message chunks", () => {
  it("opens and closes text around tools, and ends with the verified reply", () => {
    const chunks: UIMessageChunk[] = [];
    const turn = new TurnChunks((c) => chunks.push(c));
    turn.start("m1");
    turn.event({ kind: "status", text: "Working…" });
    turn.event({ kind: "text", text: "Let me " });
    turn.event({ kind: "text", text: "look." });
    turn.event({ kind: "tool", id: "c1", name: "search_research", tool: "search_research", input: "{}" });
    turn.event({ kind: "tool_result", id: "c1", ok: true, studyIds: ["PMID:1"] });
    turn.event({ kind: "text", text: "Done." });
    turn.finish({ ok: true, text: "Done." });
    expect(chunks.map((c) => c.type)).toEqual([
      "start", "start-step", "data-status", "text-start", "text-delta", "text-delta", "text-end",
      "tool-input-available", "tool-output-available", "data-studies", "text-start", "text-delta", "text-end", "data-reply", "finish-step", "finish",
    ]);
    expect(chunks.find((c) => c.type === "data-status")).toMatchObject({ transient: true });
  });
});

describe("the agent programs' output, read as it arrives", () => {
  const collect = (make: (emit: (e: BrainEvent) => void) => (line: string) => void, lines: unknown[]) => {
    const out: BrainEvent[] = [];
    const read = make((e) => out.push(e));
    for (const l of lines) read(JSON.stringify(l));
    return out;
  };

  it("Claude Code: partial-message text deltas, not sub-agent output, and whole messages only when not streamed", () => {
    const out = collect(claudeLines, [
      { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Your " } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "ferritin" } } },
      { type: "stream_event", parent_tool_use_id: "t", event: { type: "content_block_delta", delta: { type: "text_delta", text: "SUBAGENT" } } },
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Your ferritin" }] } },
      { type: "assistant", message: { id: "m2", content: [{ type: "text", text: " is fine." }, { type: "tool_use", name: "x" }] } },
      { type: "result", subtype: "success", result: "Your ferritin is fine." },
    ]);
    expect(out).toEqual([{ kind: "text", text: "Your " }, { kind: "text", text: "ferritin" }, { kind: "text", text: " is fine." }]);
  });

  it("Codex: each finished message; Hermes: its text lines", () => {
    expect(collect(codexLines, [
      { type: "item.started", item: { type: "reasoning" } },
      { type: "item.completed", item: { type: "agent_message", text: "One." } },
      { type: "item.completed", item: { type: "agent_message", text: "Two." } },
    ])).toEqual([{ kind: "status", text: "Thinking…" }, { kind: "text", text: "One." }, { kind: "text", text: "\n\nTwo." }]);
    expect(collect(hermesLines, [{ type: "text", text: "Hi" }, { type: "result", text: "Hi" }, "not json"])).toEqual([{ kind: "text", text: "Hi" }]);
  });
});

describe("API models stream text and tool calls", () => {
  it("reports text as it arrives and each tool call with its result, then returns the same reply", async () => {
    let n = 0;
    const model = new MockModel({
      doGenerate: async () => n++ === 0
        ? { content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "get_results", input: "{}" }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] }
        : { content: [{ type: "text" as const, text: "Your ferritin is in range." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] },
    });
    const events: BrainEvent[] = [];
    const r = await ask([{ role: "user", content: "How is my ferritin?" }], snapshot, { ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "mock" } }, onEvent: (e) => events.push(e) });
    expect(r).toMatchObject({ ok: true, text: "Your ferritin is in range." });
    expect(events[0]).toMatchObject({ kind: "tool", id: "c1", tool: "get_results" });
    expect(events[1]).toEqual({ kind: "tool_result", id: "c1", ok: true, studyIds: [] });
    const text = events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
    expect(text.length).toBeGreaterThan(1);
    expect(text.join("")).toBe("Your ferritin is in range.");
  });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(check: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end && !check()) await new Promise((r) => setTimeout(r, 25));
  return check();
}

describe.skipIf(process.platform === "win32")("the page's stream, end to end", () => {
  let server: http.Server;
  let port: number;
  let fakes: FakeAgents;

  beforeAll(async () => {
    const reservation = http.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    server = createServer(port);
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    // No saved model: Brain uses Claude Code, here a stand-in on PATH.
    fakes = installFakeAgents({ claude: "fake-claude.cjs" });
  });
  afterAll(() => {
    fakes.restore();
    server.close();
  });

  const body = { messages: [{ role: "user", content: "How is my ferritin?" }], snapshot, userText: "How is my ferritin?" };
  const transport = () => new DefaultChatTransport<UIMessage>({
    api: `http://127.0.0.1:${port}/api/assistant`,
    headers: { "x-bt": "1", accept: "text/event-stream" },
    prepareSendMessagesRequest: () => ({ body }),
  });
  const send = (signal?: AbortSignal) => transport().sendMessages({ chatId: "brain", messages: [], trigger: "submit-message", messageId: undefined, abortSignal: signal });

  it("streams Claude Code's text and the app's tool calls, then the verified reply", async () => {
    fakes.dir();
    process.env.FAKE_MCP = "1";
    process.env.FAKE_DELAY = "20";
    process.env.FAKE_LINES = JSON.stringify([
      { type: "stream_event", event: { type: "message_start", message: { id: "m1" } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Your ferritin " } } },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "is 40 µg/L." } } },
      { type: "result", subtype: "success", result: "Your ferritin is 40 µg/L.", modelUsage: { "claude-opus": {} } },
    ]);
    try {
      const stream = await send();
      const [forMessage, forChunks] = stream.tee();
      const chunks: UIMessageChunk[] = [];
      const reading = (async () => { for await (const c of forChunks) chunks.push(c); })();
      let last: UIMessage | undefined;
      for await (const m of readUIMessageStream({ stream: forMessage })) last = structuredClone(m);
      await reading;
      expect(chunks.filter((c) => c.type === "text-delta").map((c) => (c as { delta: string }).delta)).toEqual(["Your ferritin ", "is 40 µg/L."]);
      const tool = last!.parts.find((p) => p.type === "dynamic-tool") as { toolName: string; state: string } | undefined;
      expect(tool).toMatchObject({ toolName: "get_results", state: "output-available" });
      const reply = last!.parts.find((p) => p.type === "data-reply") as { data: { ok: boolean; text: string; steps: { tool: string }[] } };
      expect(reply.data).toMatchObject({ ok: true, text: "Your ferritin is 40 µg/L." });
      expect(reply.data.steps.map((s) => s.tool)).toEqual(["get_results"]);
      expect(chunks.at(-1)).toEqual({ type: "finish" });
    } finally {
      delete process.env.FAKE_MCP;
      delete process.env.FAKE_DELAY;
    }
  });

  it("closing the stream stops the question and the program it started", async () => {
    const dir = fakes.dir();
    process.env.FAKE_HANG = "1";
    process.env.FAKE_LINES = JSON.stringify([{ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Thinking" } } }]);
    try {
      const controller = new AbortController();
      const stream = await send(controller.signal);
      const reader = stream.getReader();
      expect(await until(() => fs.existsSync(path.join(dir, "pids.json")))).toBe(true);
      const { agent, helper } = JSON.parse(fs.readFileSync(path.join(dir, "pids.json"), "utf8")) as { agent: number; helper: number };
      controller.abort();
      await reader.cancel().catch(() => {});
      expect(await until(() => !alive(agent) && !alive(helper))).toBe(true);
    } finally {
      delete process.env.FAKE_HANG;
    }
  });

  it("still answers JSON to callers that don't ask for a stream, and refuses bad requests before streaming", async () => {
    fakes.dir();
    process.env.FAKE_LINES = JSON.stringify([{ type: "result", subtype: "success", result: "Fine." }]);
    const post = (b: unknown, accept?: string) => fetch(`http://127.0.0.1:${port}/api/assistant`, { method: "POST", headers: { "content-type": "application/json", "x-bt": "1", ...(accept ? { accept } : {}) }, body: JSON.stringify(b) });
    const json = await post(body);
    expect(json.headers.get("content-type")).toMatch(/application\/json/);
    expect(await json.json()).toMatchObject({ ok: true, text: "Fine." });
    const bad = await post({ messages: "nope", snapshot }, "text/event-stream");
    expect(bad.status).toBe(400);
    expect(bad.headers.get("content-type")).toMatch(/application\/json/);
  });
});
