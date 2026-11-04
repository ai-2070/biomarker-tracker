// The stable rules first (the same for every question), so the provider can reuse the prompt prefix.
import { defineDynamic, defineInstructions } from "eve/instructions";
import { configuration, runOf } from "../lib/bridge";

export default defineDynamic(async (ctx) => defineInstructions({ role: "system", content: (await configuration(runOf(ctx))).stable }));
