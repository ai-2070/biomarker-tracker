// The app's tools for this question, run by the main server, which records each call and the studies it
// returned (the citation check) exactly as for agent programs.
import { defineDynamic, defineTool, toolOutput } from "eve/tools";
import { bridgeJson, configuration, runOf } from "../lib/bridge";

export default defineDynamic(async (ctx) => {
  const run = runOf(ctx);
  const config = await configuration(run);
  return Object.fromEntries(
    config.tools.map((tool) => [
      tool.name,
      defineTool({
        description: tool.description,
        inputSchema: tool.inputSchema,
        toModelOutput: (output: unknown) =>
          toolOutput.text(typeof (output as { text?: unknown })?.text === "string" ? (output as { text: string }).text : JSON.stringify(output)),
        execute: async (input: unknown, call: { abortSignal?: AbortSignal }) =>
          bridgeJson<{ text: string; isError: boolean }>("/tool", { run, name: tool.name, input }, call.abortSignal),
      }),
    ]),
  );
});
