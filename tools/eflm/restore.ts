// Puts the EFLM biological variation values back into the marker files, from a commit that still had them.
// Only for use once EFLM has given written permission (see docs/eflm-biological-variation.md).
//
//   bun tools/eflm/restore.ts            # from the last commit with the values
//   bun tools/eflm/restore.ts <commit>
//
// Each marker file gets its `biologicalVariation` object back just before `sources`, where it was.
// Markers that didn't exist then, or whose file has gone, are listed and skipped.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const DIR = "knowledge/biomarkers";
/** The last commit on main whose marker files still held the EFLM values. */
const LAST_WITH_VALUES = "b4d3ee2";
const commit = process.argv[2] ?? LAST_WITH_VALUES;

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

type Json = Record<string, unknown>;
const restored: string[] = [];
const skipped: string[] = [];

for (const file of git("ls-tree", "--name-only", `${commit}:${DIR}`)
  .split("\n")
  .filter((f) => f.endsWith(".json"))) {
  const old = JSON.parse(git("show", `${commit}:${DIR}/${file}`)) as Json;
  const bv = old.biologicalVariation;
  if (!bv) continue;
  const path = join(ROOT, DIR, file);
  if (!existsSync(path)) {
    skipped.push(`${file} (no longer exists)`);
    continue;
  }
  const now = JSON.parse(readFileSync(path, "utf8")) as Json;
  if (now.biologicalVariation) {
    skipped.push(`${file} (already has values)`);
    continue;
  }
  const out: Json = {};
  for (const [k, v] of Object.entries(now)) {
    if (k === "sources") out.biologicalVariation = bv;
    out[k] = v;
  }
  if (!out.biologicalVariation) out.biologicalVariation = bv;
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  restored.push(file);
}

console.log(`Restored biological variation in ${restored.length} marker files from ${commit}.`);
if (skipped.length) console.log(`Skipped:\n  ${skipped.join("\n  ")}`);
console.log("Next: follow 'Putting it back' in docs/eflm-biological-variation.md (wording, tests, licences).");
