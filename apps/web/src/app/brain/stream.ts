import { DefaultChatTransport, readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import type { Step } from "./store";

// Reads Brain's streamed answer from the local server (apps/server/uistream.ts) with the AI SDK's own transport
// and reader. While it streams, the page shows the text so far, the tools as they run and a status line;
// the final reply (data-reply) is the same verified envelope as before and replaces it.

export interface LiveAnswer {
  /** The text written since the last tool call (the final answer is the last such stretch). */
  text: string;
  steps: Step[];
  /** Study IDs a tool actually returned so far: only these may show as checked citations. */
  studyIds: string[];
  status?: string;
  /** Results Brain read from a picture are far outside the usual range: the urgent banner comes before its text. */
  critical?: boolean;
}

interface ToolInput {
  tool?: string;
  server?: string;
  input?: string;
}

/** The live view of a message as it streams. */
export function liveAnswer(message: UIMessage, status?: string): LiveAnswer {
  let text = "";
  const steps: Step[] = [];
  const studyIds = new Set<string>();
  let critical = false;
  for (const part of message.parts) {
    if (part.type === "text") text += part.text;
    else if (part.type === "dynamic-tool") {
      // A new tool starts a new stretch of text.
      text = "";
      const input = (part.input ?? {}) as ToolInput;
      steps.push({
        tool: input.tool ?? part.toolName,
        ...(input.server ? { server: input.server } : {}),
        input: input.input ?? "{}",
        ...(part.state === "output-available" ? { success: true } : part.state === "output-error" ? { success: false } : {}),
      });
      if (part.state === "output-available" && (part.output as { critical?: unknown } | undefined)?.critical === true) critical = true;
    } else if (part.type === "data-studies") {
      for (const id of ((part.data as { ids?: unknown }).ids as string[]) ?? []) if (typeof id === "string") studyIds.add(id);
    }
  }
  return { text, steps, studyIds: [...studyIds], ...(status ? { status } : {}), ...(critical ? { critical } : {}) };
}

/** Turns the server's JSON error replies into plain messages (the SDK would show the raw body). */
const appFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.ok) return res;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(data.error ?? `Request failed (${res.status}).`);
};

/**
 * Sends one question and reads the answer as it streams; resolves with the final reply. `onUpdate` gets the
 * live view after every change. Aborting `signal` stops the request, which stops the run on the server.
 */
export async function streamAssistant<Reply>(body: object, signal: AbortSignal, onUpdate: (live: LiveAnswer) => void): Promise<Reply> {
  const transport = new DefaultChatTransport<UIMessage>({
    api: "/api/assistant",
    // x-bt marks requests from this page; accept asks for the stream (other callers get JSON).
    headers: { "x-bt": "1", accept: "text/event-stream" },
    fetch: appFetch,
    prepareSendMessagesRequest: () => ({ body: body as Record<string, unknown> }),
  });
  const stream = await transport.sendMessages({ chatId: "brain", messages: [], trigger: "submit-message", messageId: undefined, abortSignal: signal });
  const [forMessage, forChunks] = stream.tee();
  let status: string | undefined;
  let failure: string | undefined;
  let reply: Reply | undefined;
  let latest: UIMessage | undefined;
  // Transient parts (the status line) and errors only appear in the chunks, not in the message.
  const watching = (async () => {
    for await (const chunk of forChunks as AsyncIterable<UIMessageChunk>) {
      if (chunk.type === "data-status") {
        status = (chunk.data as { text?: string }).text;
        if (latest) onUpdate(liveAnswer(latest, status));
      } else if (chunk.type === "error") failure = chunk.errorText;
    }
  })();
  for await (const message of readUIMessageStream({
    stream: forMessage,
    onError: (e) => {
      failure ??= e instanceof Error ? e.message : String(e);
    },
  })) {
    latest = message;
    const done = message.parts.find((p) => p.type === "data-reply");
    if (done) reply = (done as { data: Reply }).data;
    onUpdate(liveAnswer(message, status));
  }
  await watching;
  if (reply !== undefined) return reply;
  throw new Error(failure ?? "Brain stopped without an answer.");
}
