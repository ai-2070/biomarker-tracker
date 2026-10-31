// Exercise the actual compiled sidecar, outside the repo and without touching user data.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { demoProfile } from "../../src/core/demo";

const root = path.resolve(import.meta.dirname, "../..");
const host = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const binary = path.join(root, "src-tauri/binaries", `biomarker-server-${host}${process.platform === "win32" ? ".exe" : ""}`);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bt-desktop-"));
const data = path.join(temporary, "data");
fs.mkdirSync(data);
// No research programs or network connections are needed for this smoke check.
fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ mcpSeeded: true, mcp: [], providers: {}, skillsOff: [] }));
const resources = path.join(root, "src-tauri/resources");
const child = spawn(binary, ["--port", "0"], {
  cwd: temporary,
  env: { ...process.env, BT_ROOT: resources, BT_DIST: path.join(resources, "dist"), BT_DATA: data, BT_DESKTOP: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});
const exited = once(child, "exit");
let errors = "";
child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
const deadline = setTimeout(() => child.kill(), 30_000);
try {
  const origin = await new Promise<string>((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const ready = /BT_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (ready) resolve(ready[1]!);
    });
    child.once("error", reject);
    child.once("exit", () => reject(new Error(`Sidecar exited before ready: ${errors}`)));
  });
  const request = (url: string, init?: RequestInit) => fetch(`${origin}${url}`, { ...init, signal: AbortSignal.timeout(5000) });
  const status = await request("/api/status");
  assert.equal(status.status, 200);
  assert.equal(((await status.json()) as { app: string }).app, "biomarker-tracker");
  const page = await request("/");
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Content-Security-Policy/);
  const asset = /src="\.\/([^"\s]+\.js)"/.exec(html)?.[1];
  assert.ok(asset, "The packaged frontend must reference its JavaScript bundle");
  assert.equal((await request(`/${asset}`)).status, 200);
  assert.equal((await request("/ocr/worker.min.js")).status, 200);
  assert.equal((await request("/ocr/eng.traineddata.gz")).status, 200);
  const skills = (await (await request("/api/skills")).json()) as { skills: unknown[] };
  assert.ok(skills.skills.length > 0, "Bundled skills must be found outside the repository cwd");
  assert.equal((await request("/api/settings/assistant", { method: "PUT", body: "{}" })).status, 403);
  const save = await request("/api/settings/assistant", {
    method: "PUT", headers: { "content-type": "application/json", "x-bt": "1" },
    body: JSON.stringify({ provider: "ollama", model: "smoke-test" }),
  });
  assert.equal(save.status, 200);
  const settings = JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8")) as { assistant: { model: string } };
  assert.equal(settings.assistant.model, "smoke-test");
  const example = demoProfile("2026-01-01");
  const created = await request("/api/profiles", {
    method: "POST", headers: { "content-type": "application/json", "x-bt": "1" },
    body: JSON.stringify({ ...example, meals: [], settings: {} }),
  });
  assert.equal(created.status, 200, await created.clone().text());
  const { profile } = (await created.json()) as { profile: { id: string } };
  const restored = await (await request(`/api/profiles/${profile.id}/data`)).json() as { measurements: unknown[] };
  assert.equal(restored.measurements.length, example.measurements.length);
  assert.ok(fs.existsSync(path.join(data, "profiles", profile.id, "profile.json")));
  const backup = await request(`/api/profiles/${profile.id}/backup`);
  assert.equal(backup.status, 200);
  assert.equal(Buffer.from(await backup.arrayBuffer()).subarray(0, 2).toString(), "PK");
  // Closing stdin simulates the native shell closing or crashing.
  child.stdin.end();
  const [code] = await exited;
  assert.equal(code, 0, errors);
  console.log("Compiled desktop sidecar: frontend, OCR, API, security, bundled skills, profile persistence, backups and shutdown passed.");
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await exited;
  }
  if (!path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Invalid temporary directory");
  fs.rmSync(temporary, { recursive: true, force: true });
}
