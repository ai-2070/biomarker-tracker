// This question's part (critical results, cautions, the date), after the stable rules; nothing when empty.
import { defineDynamic, defineInstructions } from "eve/instructions";
import { configuration, runOf } from "../lib/bridge";

export default defineDynamic(async (ctx) => {
  const { request } = await configuration(runOf(ctx));
  return request ? defineInstructions({ role: "system", content: request }) : null;
});
