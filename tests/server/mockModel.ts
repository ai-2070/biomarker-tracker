// Mock models for the assistant's streamed loop (streamText). Tests describe a model by what one call
// returns (the doGenerate shape); the same answer is also given as a stream, part by part.
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

type Generate = Extract<ConstructorParameters<typeof MockLanguageModelV4>[0], object>["doGenerate"];
type GenerateFn = Extract<Generate, (...args: never[]) => unknown>;

/** Splits a text into a few deltas, so streaming is exercised, not one big chunk. */
function deltas(text: string): string[] {
  const words = text.split(/(?<= )/);
  return words.length > 1 ? words : [text];
}

export class MockModel extends MockLanguageModelV4 {
  constructor(opts: { doGenerate: GenerateFn }) {
    const doGenerate = opts.doGenerate;
    super({
      doGenerate,
      doStream: async (options) => {
        const r = await doGenerate(options);
        const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: r.warnings ?? [] }];
        if (r.response) parts.push({ type: "response-metadata", ...r.response } as LanguageModelV4StreamPart);
        r.content.forEach((c, i) => {
          if (c.type === "text") {
            const id = `text-${i}`;
            parts.push({ type: "text-start", id });
            for (const delta of deltas(c.text)) parts.push({ type: "text-delta", id, delta });
            parts.push({ type: "text-end", id });
          } else parts.push(c as LanguageModelV4StreamPart);
        });
        parts.push({ type: "finish", finishReason: r.finishReason, usage: r.usage, ...(r.providerMetadata ? { providerMetadata: r.providerMetadata } : {}) });
        return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { for (const p of parts) controller.enqueue(p); controller.close(); } }) };
      },
    });
  }
}
