// Brain in eve (opt-in, Settings → AI models). No eve tools, sandbox or connections of its own: the rules,
// the app's tools and the model all come from the main server for the question being answered.
import { defineAgent, defineDynamic } from "eve";
import { configuration, runOf } from "./lib/bridge";
import { bridgeModel } from "./lib/model";

export default defineAgent({
  defaultTools: false,
  // Health data: delete each run's inputs, outputs and events when it ends (each question ends its session).
  experimental: { workflow: { retention: 0 } },
  model: defineDynamic(async (ctx) => {
    const run = runOf(ctx);
    const config = await configuration(run);
    return { model: bridgeModel(run, config.modelId), modelContextWindowTokens: config.contextWindow };
  }),
});
