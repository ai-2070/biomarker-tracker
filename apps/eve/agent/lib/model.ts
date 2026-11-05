// The model, as a proxy: every call goes to the main server (/model), which calls the person's configured
// model with its key, zero-retention routing and cache settings, and streams the parts back as JSON lines.
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { bridgeFetch, bridgeJson } from "./bridge";

/** Call options as JSON: the abort signal stays here; binary file data travels as base64. */
export function encodeOptions(options: LanguageModelV4CallOptions): unknown {
  const { abortSignal: _signal, ...rest } = options as LanguageModelV4CallOptions & { abortSignal?: AbortSignal };
  return JSON.parse(JSON.stringify(rest, (_key, value: unknown) => (value instanceof Uint8Array ? { $bytes: Buffer.from(value).toString("base64") } : value)));
}

type RemoteError = { message?: string; statusCode?: number; isRetryable?: boolean };

function remoteError(e: RemoteError | undefined): Error {
  const error = new Error(e?.message ?? "The model call failed.") as Error & { statusCode?: number; isRetryable?: boolean };
  if (typeof e?.statusCode === "number") error.statusCode = e.statusCode;
  if (typeof e?.isRetryable === "boolean") error.isRetryable = e.isRetryable;
  return error;
}

/** A stream part from JSON: dates and errors become real objects again. */
export function decodePart(raw: Record<string, unknown>): LanguageModelV4StreamPart {
  if (raw.type === "response-metadata" && typeof raw.timestamp === "string") return { ...raw, timestamp: new Date(raw.timestamp) } as LanguageModelV4StreamPart;
  if (raw.type === "error") return { type: "error", error: remoteError(raw.error as RemoteError) };
  return raw as LanguageModelV4StreamPart;
}

export function bridgeModel(run: string, modelId: string): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "biomarker-tracker",
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const out = await bridgeJson<{ result?: Parameters<typeof JSON.stringify>[0]; error?: RemoteError }>("/model", { run, mode: "generate", options: encodeOptions(options) }, options.abortSignal);
      if (out.error || !out.result) throw remoteError(out.error);
      const result = out.result as Awaited<ReturnType<LanguageModelV4["doGenerate"]>> & { response?: { timestamp?: unknown } };
      if (result.response && typeof result.response.timestamp === "string") result.response.timestamp = new Date(result.response.timestamp);
      return result;
    },
    async doStream(options) {
      const response = await bridgeFetch("/model", { run, mode: "stream", options: encodeOptions(options) }, options.abortSignal);
      if (!response.body) throw new Error("The model call returned nothing.");
      let buffer = "";
      const stream = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, LanguageModelV4StreamPart>({
        transform(chunk, controller) {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) controller.enqueue(decodePart(JSON.parse(line) as Record<string, unknown>));
        },
        flush(controller) {
          if (buffer.trim()) controller.enqueue(decodePart(JSON.parse(buffer) as Record<string, unknown>));
        },
      }));
      return { stream };
    },
  };
}
