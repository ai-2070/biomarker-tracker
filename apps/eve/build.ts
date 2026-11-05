// Builds Brain's eve runtime (apps/eve/agent → apps/eve/.output), after ai-dashboard's build-eve.ts.
// Run: bun run eve:build. The output is a self-contained server; the main server starts it only when the
// eve engine is switched on (apps/server/eve/host.ts).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const runtime = import.meta.dirname;
for (let attempt = 0; ; attempt++) {
  // No telemetry (CLAUDE.md): eve's CLI reports usage to Vercel unless told not to.
  const build = spawnSync(process.execPath, [path.join(root, "node_modules/eve/bin/eve.js"), "build"], { cwd: runtime, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, EVE_TELEMETRY_DISABLED: "1" } });
  const output = `${build.stdout ?? ""}${build.stderr ?? ""}`;
  // Windows file scanners can hold a newly written file briefly.
  if (build.status && process.platform === "win32" && attempt < 2 && /EBUSY|EPERM/.test(output)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (attempt + 1));
    continue;
  }
  // Only the summary: eve lists every output file.
  process.stdout.write(output.split("\n").filter((line) => !/^\s+[├└]─/.test(line)).join("\n"));
  if (build.status !== 0) throw new Error("The eve runtime build failed.");
  break;
}
const entry = path.join(runtime, ".output", "server", "index.mjs");
if (!fs.existsSync(entry)) throw new Error("The eve build did not produce a server.");
fs.copyFileSync(path.join(runtime, "launch.mjs"), path.join(runtime, ".output", "launch.mjs"));
console.log("eve runtime built: apps/eve/.output");
