import "fake-indexeddb/auto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import controls from "../fixtures/claimPositiveControls.json";
import { createServer } from "../../apps/server/http";
import { setBridgePort } from "../../apps/server/bridge";
import { updateSettings } from "../../apps/server/store";
import { currentChoice } from "../../apps/server/models";
import { checkClaimEvidence, readClaimEvidence } from "../../apps/web/src/app/claimEvidence";
import { TrackerDB } from "../../apps/web/src/db/db";
import { claimCheckLabel, type ClaimCheck } from "@bt/core/claimEvidence";
import type { ModelChoice } from "@bt/core/aiProviders";

// Explicit opt-in: these tests use live public search and the configured model/account.
// No KB entries, pinned records, mocked evidence or scripted grades enter this path.
describe.skipIf(process.env.BT_LIVE_CLAIM_CONTROLS !== "1")("live free-text claim controls", () => {
  const database = new TrackerDB(`claim-controls-${crypto.randomUUID()}`);
  const server = createServer(0);
  const nativeFetch = globalThis.fetch;
  const output = path.join(os.tmpdir(), `bt-claim-controls-${Date.now()}.json`);
  const results: ClaimCheck[] = [];
  let base: string;
  beforeAll(async () => {
    // tests/server/setup.ts has already redirected ALL writes to a throwaway data folder.
    if (process.env.BT_CLAIM_CONTROL_CHOICE) updateSettings((settings) => { settings.assistant = JSON.parse(process.env.BT_CLAIM_CONTROL_CHOICE!) as ModelChoice; });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    setBridgePort(port); base = `http://127.0.0.1:${port}`;
    globalThis.fetch = ((input, init) => nativeFetch(typeof input === "string" && input.startsWith("/api/") ? `${base}${input}` : input, init)) as typeof fetch;
    await database.open();
    console.log(`Live claim controls: ${JSON.stringify(currentChoice())}. Report: ${output}`);
  });
  afterAll(async () => {
    globalThis.fetch = nativeFetch;
    await database.delete();
    const closed = once(server, "close"); server.close(); await closed;
  });
  it("passes the frozen positive grade ranges through Check something else and stops on failure", async () => {
    for (const control of controls) {
      const request = { nutrientId: control.intervention, claim: control.outcome, topic: control.outcome };
      const result = await checkClaimEvidence(request, { database, custom: true, category: "health" });
      results.push(result); fs.writeFileSync(output, JSON.stringify(results, null, 2));
      console.log(`${control.intervention} / ${control.outcome}: ${claimCheckLabel(result)}; grade ${result.grade}; ${result.research?.retrieved} retrieved, ${result.research?.screened} screened, ${result.research?.included} included`);
      const accepted = result.grade !== null && control.expectedGrades.includes(result.grade) && result.research?.status === "evidence_found";
      if (!accepted) throw new Error(`STOP: positive control failed for ${control.intervention} / ${control.outcome}. Retrieved: ${JSON.stringify(result.research?.records)}. Queries: ${JSON.stringify(result.research?.queries)}. Full report: ${output}`);
      expect((await readClaimEvidence(database)).cache.customTopics).toContainEqual({ ...request, category: "health" });
      expect(result.research!.queries.slice(0, 3).map((query) => query.rung)).toEqual(["reviews", "trials", "broad"]);
    }
  }, 900_000);
  it("negative control reaches no evidence only after a clean complete ladder", async () => {
    const request = { nutrientId: "zorbafluxium-fictional", claim: "muscle strength", topic: "muscle strength" };
    const result = await checkClaimEvidence(request, { database, custom: true, category: "health" });
    results.push(result); fs.writeFileSync(output, JSON.stringify(results, null, 2));
    console.log(`Fictional compound: ${claimCheckLabel(result)}; ${result.research?.retrieved} retrieved, ${result.research?.screened} screened, ${result.research?.included} included`);
    expect(result.research?.status).toBe("no_evidence");
    expect(result.research!.queries.slice(0, 3).map((query) => query.rung)).toEqual(["reviews", "trials", "broad"]);
    expect(result.research!.queries.every((query) => !query.error && query.resultCount !== null)).toBe(true);
    expect(result.research!.screened).toBe(result.research!.retrieved);
    expect(result.research!.included).toBe(0);
    expect(result.grade).toBeNull();
  }, 300_000);
});
