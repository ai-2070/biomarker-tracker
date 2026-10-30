/**
 * Evidence map, step 2 (before build.ts): screen every eligible review's title and abstract against the
 * finding's question with a model, and keep each decision with its reason in
 * knowledge/evidence-maps/screening/<topic>.json, for people to spot-check.
 * Runs Claude Code (`claude -p`, no tools, in an empty folder) with the developer's own sign-in.
 * Decisions are kept; only reviews without one, or outcomes whose question changed, are screened again.
 * `bun tools/evidence/screen.ts vitamin_d [model]`
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScreening, screeningPrompt, type Decision } from "../../src/core/evidenceMap";
import { SCREENING_DIR, loadTopic, type ScreeningFile } from "./load";

const { topic, eligible, screening, screeningFile } = loadTopic(process.argv[2]);
const model = process.argv[3] ?? "opus";
const BATCH = 20;
const empty = mkdtempSync(join(tmpdir(), "bt-screen-"));

function ask(prompt: string): Promise<string> {
  const args = ["-p", "--output-format", "json", "--model", model, "--tools", "", "--no-session-persistence", "--system-prompt", "You screen systematic reviews for an evidence map. Answer only with the JSON asked for."];
  const child = spawn("claude", args, { cwd: empty, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
  child.stdin.end(prompt);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", () => {
      try {
        const j = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (j.is_error) throw new Error(j.result);
        resolve(j.result ?? "");
      } catch (e) {
        reject(new Error(`Claude Code: ${e instanceof Error ? e.message : ""} ${err.slice(-400)}`));
      }
    });
  });
}

const file: ScreeningFile = screening ?? { topic: topic.id, by: `Claude Code (${model}), titles and abstracts only`, outcomes: {} };
file.by = `Claude Code (${model}), titles and abstracts only`;
const save = () => {
  mkdirSync(SCREENING_DIR, { recursive: true });
  writeFileSync(screeningFile, JSON.stringify(file, null, 1));
};

await Promise.all(
  topic.outcomes.map(async (o) => {
    const prev = file.outcomes[o.id];
    const same = prev && JSON.stringify(prev.question) === JSON.stringify(o.question);
    const done = new Map<string, Decision>(same ? prev.decisions.map((d) => [d.pmid, d]) : []);
    const todo = eligible(o.id).filter((r) => r.pmid && !done.has(r.pmid));
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const ids = batch.map((r) => r.pmid!);
      // One retry for a batch that comes back short or malformed.
      for (let attempt = 0; attempt < 2; attempt++) {
        const got = parseScreening(await ask(screeningPrompt(o.question, batch, topic.kind === "food" || topic.kind === "lifestyle" || topic.kind === "wholefood" ? topic.kind : o.anyDesign ? "food" : "supplement")), ids);
        for (const d of got) done.set(d.pmid, d);
        if (ids.every((id) => done.has(id))) break;
      }
      file.outcomes[o.id] = { question: o.question, at: new Date().toISOString().slice(0, 10), decisions: [...done.values()] };
      save();
      console.log(`${o.id}: ${done.size} of ${eligible(o.id).length} screened`);
    }
    if (todo.length === 0) console.log(`${o.id}: nothing new to screen`);
  }),
);
const all = Object.values(file.outcomes).flatMap((x) => x.decisions);
console.log("done:", { yes: all.filter((d) => d.fits === "yes").length, partly: all.filter((d) => d.fits === "partly").length, no: all.filter((d) => d.fits === "no").length });
