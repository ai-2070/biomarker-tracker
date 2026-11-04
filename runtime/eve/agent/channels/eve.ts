// Only the main server may talk to this runtime: a bearer token that changes on every start. Each session
// belongs to one question (x-bt-run); its earlier conversation comes from the main server as history.
import { timingSafeEqual } from "node:crypto";
import { eveChannel } from "eve/channels/eve";
import { bridgeJson } from "../lib/bridge";

type History = { history: { id: string; role: "user" | "assistant"; text: string }[] };

export default eveChannel({
  turnPolicy: "queue",
  onMessage: async ({ eve }) => {
    const run = eve.caller?.attributes?.run;
    if (typeof run !== "string" || !run) throw new Error("This message belongs to no Brain question.");
    const { history } = await bridgeJson<History>("/history", { run });
    return { auth: eve.caller, history };
  },
  auth: async (request: Request) => {
    const token = process.env.BT_EVE_TOKEN;
    const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const run = request.headers.get("x-bt-run");
    if (!token || !supplied || !run) return null;
    const expected = Buffer.from(token);
    const actual = Buffer.from(supplied);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    return { principalId: "biomarker-tracker", principalType: "service", authenticator: "biomarker-tracker", attributes: { run } };
  },
});
