// Build all runtime files before `tauri dev` / `tauri build`. No user data is copied.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const run = (args: string[]) => execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
const host = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const targets: Record<string, string> = {
  "x86_64-pc-windows-msvc": "bun-windows-x64-baseline",
  "x86_64-unknown-linux-gnu": "bun-linux-x64-baseline",
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64-baseline",
};
const bunTarget = targets[target];
if (!bunTarget) throw new Error(`Unsupported desktop target: ${target}`);

run(["run", "desktop:check-version"]);
run(["run", "build"]);
const binaries = path.join(root, "apps/desktop/src-tauri/binaries");
fs.mkdirSync(binaries, { recursive: true });
run([
  "build",
  "--compile",
  `--target=${bunTarget}`,
  "--no-compile-autoload-dotenv",
  "--no-compile-autoload-bunfig",
  "apps/server/index.ts",
  "--outfile",
  path.join(binaries, `biomarker-server-${target}${target.includes("windows") ? ".exe" : ""}`),
]);

const resources = path.resolve(root, "apps/desktop/src-tauri/resources");
// Only this generated directory may be removed, even when run from another cwd.
if (path.relative(root, resources).replaceAll("\\", "/") !== "apps/desktop/src-tauri/resources") throw new Error("Invalid resource directory");
fs.rmSync(resources, { recursive: true, force: true });
fs.mkdirSync(resources, { recursive: true });
fs.cpSync(path.join(root, "apps/web/dist"), path.join(resources, "dist"), { recursive: true });
for (const dir of ["knowledge", "skills"]) fs.cpSync(path.join(root, dir), path.join(resources, dir), { recursive: true });
// Brain's eve runtime (opt-in engine), at the same place relative to BT_ROOT as in the repository.
fs.cpSync(path.join(root, "apps/eve/.output"), path.join(resources, "apps/eve/.output"), { recursive: true });
console.log(`Desktop resources and ${target} sidecar are ready.`);
if (target === host) run(["run", "desktop:smoke"]);
