import type { UIMessageChunk } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { liveAnswer, streamAssistant, type LiveAnswer } from "../../apps/web/src/app/brain/stream";

/** A server-sent-event response the test writes chunk by chunk, like apps/server/uistream.ts. */
function uiStream() {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  return {
    response: () => new Response(body, { headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } }),
    push: (c: UIMessageChunk) => ctl.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`)),
    end: () => {
      ctl.enqueue(enc.encode("data: [DONE]\n\n"));
      ctl.close();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 10));
afterEach(() => vi.unstubAllGlobals());

describe("Brain's streamed answer in the page", () => {
  it("shows text, tools, studies and status as they arrive, then resolves with the verified reply", async () => {
    const s = uiStream();
    const fetchMock = vi.fn(async () => s.response());
    vi.stubGlobal("fetch", fetchMock);
    const updates: LiveAnswer[] = [];
    const done = streamAssistant<{ ok: boolean; text: string }>({ messages: [] }, new AbortController().signal, (live) => updates.push(structuredClone(live)));
    s.push({ type: "start", messageId: "m" });
    s.push({ type: "data-status", data: { text: "Claude Code is working…" }, transient: true } as UIMessageChunk);
    s.push({ type: "text-start", id: "t1" });
    s.push({ type: "text-delta", id: "t1", delta: "Let me check." });
    s.push({ type: "text-end", id: "t1" });
    s.push({ type: "tool-input-available", toolCallId: "c1", toolName: "search_research", input: { tool: "search_research", input: '{"terms":["ferritin"]}' }, dynamic: true });
    await flush();
    expect(updates.at(-1)).toMatchObject({ text: "", steps: [{ tool: "search_research", input: '{"terms":["ferritin"]}' }], status: "Claude Code is working…" });
    expect(updates.at(-1)!.steps[0]!.success).toBeUndefined();
    s.push({ type: "tool-output-available", toolCallId: "c1", output: { ok: true }, dynamic: true });
    s.push({ type: "data-studies", data: { ids: ["PMID:1"] } } as UIMessageChunk);
    s.push({ type: "text-start", id: "t2" });
    s.push({ type: "text-delta", id: "t2", delta: "Ferritin is " });
    await flush();
    expect(updates.some((u) => u.text === "Let me check.")).toBe(true);
    expect(updates.at(-1)).toMatchObject({ text: "Ferritin is ", studyIds: ["PMID:1"], steps: [{ success: true }] });
    s.push({ type: "text-delta", id: "t2", delta: "stored iron [PMID:1]." });
    s.push({ type: "text-end", id: "t2" });
    s.push({ type: "data-reply", data: { ok: true, text: "Ferritin is stored iron [PMID:1]." } } as UIMessageChunk);
    s.push({ type: "finish" });
    s.end();
    expect(await done).toEqual({ ok: true, text: "Ferritin is stored iron [PMID:1]." });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("accept")).toBe("text/event-stream");
    expect(headers.get("x-bt")).toBe("1");
    expect(JSON.parse(String(init.body))).toEqual({ messages: [] });
  });

  it("turns the server's JSON refusal into its plain message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Ask a question." }), { status: 400, headers: { "content-type": "application/json" } })));
    await expect(streamAssistant({}, new AbortController().signal, () => {})).rejects.toThrow("Ask a question.");
  });

  it("reports a stream that ends without a reply, with the server's error if it sent one", async () => {
    const s = uiStream();
    vi.stubGlobal("fetch", vi.fn(async () => s.response()));
    const done = streamAssistant({}, new AbortController().signal, () => {});
    s.push({ type: "start", messageId: "m" });
    s.push({ type: "error", errorText: "The AI service is having problems." });
    s.end();
    await expect(done).rejects.toThrow("The AI service is having problems.");
  });

  it("stops reading when the person stops", async () => {
    const s = uiStream();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => s.end());
      return s.response();
    }));
    const controller = new AbortController();
    const done = streamAssistant({}, controller.signal, () => {});
    s.push({ type: "start", messageId: "m" });
    await flush();
    controller.abort();
    await expect(done).rejects.toThrow();
  });

  it("keeps only the text after the last tool, like the final answer", () => {
    const live = liveAnswer({ id: "m", role: "assistant", parts: [
      { type: "text", text: "Looking…" },
      { type: "dynamic-tool", toolName: "get_results", toolCallId: "1", state: "output-error", input: { tool: "get_results" }, errorText: "x" },
      { type: "text", text: "Here is the answer." },
    ] } as never);
    expect(live).toEqual({ text: "Here is the answer.", steps: [{ tool: "get_results", input: "{}", success: false }], studyIds: [] });
  });

  it("notes when results read from a picture are critical", () => {
    const part = (output: unknown) => ({ type: "dynamic-tool", toolName: "propose_results", toolCallId: "1", state: "output-available", input: { tool: "propose_results" }, output });
    expect(liveAnswer({ id: "m", role: "assistant", parts: [part({ ok: true, critical: true })] } as never)).toMatchObject({ critical: true });
    expect(liveAnswer({ id: "m", role: "assistant", parts: [part({ ok: true })] } as never)).not.toHaveProperty("critical");
  });
});
