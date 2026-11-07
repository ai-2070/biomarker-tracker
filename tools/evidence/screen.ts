/**
 * Evidence map, step 2 (before build.ts): screen every eligible review's title and abstract against the
 * finding's question with a model, and keep each decision with its reason in
 * knowledge/evidence-maps/screening/<topic>.json, for people to spot-check.
 * Runs Claude Code (`claude -p`, no tools, in an empty folder) with the developer's own sign-in.
 * Decisions are reused only when their exact inputs and individual attribution are recorded and current.
 * `bun tools/evidence/screen.ts vitamin_d [model]`
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anyDesignKind } from "@bt/shared/core/evidenceMap";
import { loadTopic, SCREENING_DIR, type ScreeningFile } from "./load";
import { screenOutcome } from "./screening";

const { topic, eligible, screening, screeningFile } = loadTopic(process.argv[2]);
const model = process.argv[3] ?? "opus";
const empty = mkdtempSync(join(tmpdir(), "bt-screen-"));

function ask(prompt: string): Promise<string> {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--tools",
    "",
    "--no-session-persistence",
    "--system-prompt",
    "You screen systematic reviews for an evidence map. Answer only with the JSON asked for.",
  ];
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

const file: ScreeningFile = screening ?? {
  topic: topic.id,
  by: "Per-decision attribution; legacy decisions have unknown input/model provenance",
  outcomes: {},
};
const save = () => {
  mkdirSync(SCREENING_DIR, { recursive: true });
  writeFileSync(screeningFile, JSON.stringify(file, null, 1));
};

await Promise.all(
  topic.outcomes.map(async (o) => {
    const prev = file.outcomes[o.id];
    const mode = anyDesignKind(topic.kind) ? topic.kind! : o.anyDesign ? "any-design" : "supplement";
    const reviews = eligible(o.id);
    const done = await screenOutcome({
      question: o.question,
      reviews,
      mode,
      previous: prev?.decisions ?? [],
      by: `Claude Code (${model}), titles and abstracts only`,
      ask,
      onBatch(decisions) {
        file.outcomes[o.id] = { question: o.question, at: new Date().toISOString().slice(0, 10), decisions };
        save();
      },
    });
    console.log(`${o.id}: ${done.length} of ${reviews.length} screened with current inputs`);
  }),
);
const all = Object.values(file.outcomes).flatMap((x) => x.decisions);
console.log("done:", {
  yes: all.filter((d) => d.fits === "yes").length,
  partly: all.filter((d) => d.fits === "partly").length,
  no: all.filter((d) => d.fits === "no").length,
});
