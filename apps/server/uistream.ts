// Brain's answers as an AI SDK UI message stream (server-sent events), written straight to node:http, as in
// ai-dashboard. Every engine reports the same events (brain/events.ts); this turns them into UIMessageChunks:
// text as it arrives, each tool call as a dynamic tool with its result, a transient status line, the study
// IDs a tool actually returned (data-studies), and at the end the verified reply (data-reply), which is the
// same envelope the JSON API returns. The page reads it with the SDK's own reader (apps/web/src/app/brain/stream.ts).
import type http from "node:http";
import { UI_MESSAGE_STREAM_HEADERS, type UIMessageChunk } from "ai";
import type { BrainEvent } from "./brain/events";

export const KEEP_ALIVE_MS = 15_000;

/** Turns Brain events into chunks, in order, with text blocks opened and closed around tools. */
export class TurnChunks {
  private textId: string | null = null;
  private n = 0;
  constructor(private readonly emit: (chunk: UIMessageChunk) => void) {}

  start(messageId: string): void {
    this.emit({ type: "start", messageId });
    this.emit({ type: "start-step" });
  }

  private endText(): void {
    if (!this.textId) return;
    this.emit({ type: "text-end", id: this.textId });
    this.textId = null;
  }

  event(e: BrainEvent): void {
    switch (e.kind) {
      case "text":
        if (!e.text) return;
        if (!this.textId) {
          this.textId = `t${++this.n}`;
          this.emit({ type: "text-start", id: this.textId });
        }
        this.emit({ type: "text-delta", id: this.textId, delta: e.text });
        return;
      case "tool":
        this.endText();
        this.emit({
          type: "tool-input-available",
          toolCallId: e.id,
          toolName: e.name,
          input: { tool: e.tool, ...(e.server ? { server: e.server } : {}), input: e.input },
          dynamic: true,
        });
        return;
      case "tool_result":
        if (e.ok)
          this.emit({ type: "tool-output-available", toolCallId: e.id, output: { ok: true, ...(e.critical ? { critical: true } : {}) }, dynamic: true });
        else this.emit({ type: "tool-output-error", toolCallId: e.id, errorText: "The tool didn't return a usable result.", dynamic: true });
        if (e.studyIds.length) this.emit({ type: "data-studies", data: { ids: e.studyIds } } as UIMessageChunk);
        return;
      case "status":
        this.emit({ type: "data-status", data: { text: e.text }, transient: true } as UIMessageChunk);
        return;
    }
  }

  /** The final, verified reply (or its error), then the end of the message. */
  finish(reply: unknown): void {
    this.endText();
    this.emit({ type: "data-reply", data: reply } as UIMessageChunk);
    this.emit({ type: "finish-step" });
    this.emit({ type: "finish" });
  }
}

/**
 * Streams one answer. `run` gets an event callback and returns the final reply; closing the request aborts
 * `signal` (the caller wires that), which stops the run and any program it started.
 */
export async function streamAnswer(
  res: http.ServerResponse,
  run: (onEvent: (e: BrainEvent) => void) => Promise<unknown>,
  opts: { keepAliveMs?: number; messageId?: string } = {},
): Promise<void> {
  res.writeHead(200, { ...UI_MESSAGE_STREAM_HEADERS, "cache-control": "no-store" });
  const write = (chunk: UIMessageChunk) => {
    if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };
  const alive = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": keep-alive\n\n");
  }, opts.keepAliveMs ?? KEEP_ALIVE_MS);
  const turn = new TurnChunks(write);
  turn.start(opts.messageId ?? `brain-${Date.now().toString(36)}`);
  try {
    const reply = await run((e) => turn.event(e));
    turn.finish(reply);
  } catch (e) {
    write({ type: "error", errorText: e instanceof Error ? e.message : "Something went wrong." });
  } finally {
    clearInterval(alive);
    if (!res.destroyed && !res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}
