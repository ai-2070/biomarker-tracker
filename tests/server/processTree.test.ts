import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent, runProgram } from "../../server/agents";
import { killAllTrees, ownedTrees, spawnTree } from "../../server/processTree";

// Real processes, no mocks: a fake agent program starts a helper of its own (the "grandchild"), the way
// Claude Code starts MCP servers and shells. Both must be gone after a stop, a timeout or a shutdown.
const AGENT = String.raw`
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const mode = process.env.FAKE_MODE || "wait";
const dir = process.env.FAKE_DIR;
const stubborn = mode === "stubborn";
if (stubborn) process.on("SIGTERM", () => {});
// The helper says it's ready only once its own SIGTERM handler is in place.
const ready = path.join(dir, "helper.ready");
const helper = spawn(process.execPath, ["-e", (stubborn ? "process.on('SIGTERM', () => {});" : "") + "require('node:fs').writeFileSync(process.argv[1], '1'); setInterval(() => {}, 1000)", ready], { stdio: mode === "leave" ? ["ignore", "inherit", "ignore"] : "ignore" });
const started = setInterval(() => {
  if (!fs.existsSync(ready)) return;
  clearInterval(started);
  // Written whole, then renamed: the test never reads half a file.
  fs.writeFileSync(path.join(dir, "pids.tmp"), JSON.stringify({ agent: process.pid, helper: helper.pid }));
  fs.renameSync(path.join(dir, "pids.tmp"), path.join(dir, "pids.json"));
}, 10);
if (mode === "stream") {
  process.stdout.write(JSON.stringify({ type: "line", n: 1 }) + "\n");
  setTimeout(() => { process.stdout.write(JSON.stringify({ type: "line", n: 2 }) + "\n"); process.exit(0); }, 100);
} else if (mode === "leave") {
  // Done, but the helper still holds stdout open.
  process.stdout.write("done\n");
  setTimeout(() => process.exit(0), 50);
} else {
  setInterval(() => {}, 1000);
}
`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean, ms = 15_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return check();
}

let root: string;
let bin: string;
let oldPath: string | undefined;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-tree-"));
  bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const script = path.join(root, "agent.js");
  fs.writeFileSync(script, AGENT);
  // The fake program, found on PATH like the real agent programs.
  for (const name of ["fake-agent", "claude"]) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  }
  oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
});

afterAll(async () => {
  await killAllTrees(200);
  process.env.PATH = oldPath;
  fs.rmSync(root, { recursive: true, force: true });
});

function run(mode: string, opts: { signal?: AbortSignal; timeoutMs?: number; graceMs?: number; onLine?: (line: string) => void } = {}) {
  const dir = fs.mkdtempSync(path.join(root, `${mode}-`));
  const done = runProgram("fake-agent", [], { cwd: dir, env: { FAKE_MODE: mode, FAKE_DIR: dir }, ...opts });
  const pids = async () => {
    await until(() => fs.existsSync(path.join(dir, "pids.json")));
    return JSON.parse(fs.readFileSync(path.join(dir, "pids.json"), "utf8")) as { agent: number; helper: number };
  };
  return { done, pids };
}

describe.skipIf(process.platform === "win32")("agent programs and everything they start", () => {
  it("Stop ends the program and its helper", async () => {
    const controller = new AbortController();
    const r = run("wait", { signal: controller.signal });
    const { agent, helper } = await r.pids();
    expect(alive(agent) && alive(helper)).toBe(true);
    controller.abort();
    await r.done;
    expect(await until(() => !alive(agent) && !alive(helper))).toBe(true);
  });

  it("the time limit ends both", async () => {
    const r = run("wait", { timeoutMs: 400 });
    const { agent, helper } = await r.pids();
    await r.done;
    expect(await until(() => !alive(agent) && !alive(helper))).toBe(true);
  });

  it("programs that ignore SIGTERM are killed after the grace period", async () => {
    const controller = new AbortController();
    const r = run("stubborn", { signal: controller.signal, graceMs: 300 });
    const { agent, helper } = await r.pids();
    const started = Date.now();
    controller.abort();
    await r.done;
    expect(await until(() => !alive(agent) && !alive(helper))).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it("a helper left running after the program finishes is stopped, and doesn't hold the answer up", async () => {
    const r = run("leave", { timeoutMs: 20_000 });
    const { helper } = await r.pids();
    const started = Date.now();
    const out = await r.done;
    expect(out.stdout).toContain("done");
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await until(() => !alive(helper))).toBe(true);
  });

  it("passes each output line on as it arrives", async () => {
    const lines: string[] = [];
    const r = run("stream", { onLine: (line) => lines.push(line) });
    const out = await r.done;
    expect(lines.map((l) => JSON.parse(l).n)).toEqual([1, 2]);
    expect(out.code).toBe(0);
  });

  it("shutdown stops every program the server still owns", async () => {
    const dir = fs.mkdtempSync(path.join(root, "owned-"));
    const child = spawnTree(path.join(bin, "fake-agent"), [], { cwd: dir, env: { ...process.env, FAKE_MODE: "wait", FAKE_DIR: dir }, stdio: "ignore" });
    await until(() => fs.existsSync(path.join(dir, "pids.json")));
    const { agent, helper } = JSON.parse(fs.readFileSync(path.join(dir, "pids.json"), "utf8")) as { agent: number; helper: number };
    expect(ownedTrees()).toBeGreaterThan(0);
    await killAllTrees(500);
    expect(await until(() => !alive(agent) && !alive(helper))).toBe(true);
    expect(child.pid).toBe(agent);
    expect(ownedTrees()).toBe(0);
  });

  it("stopping a question to Claude Code also stops what Claude Code started", async () => {
    const dir = path.join(root, "claude");
    fs.mkdirSync(dir);
    process.env.FAKE_MODE = "wait";
    process.env.FAKE_DIR = dir;
    const controller = new AbortController();
    const answer = runAgent({ provider: "claude-code", model: "", system: "rules", messages: [{ role: "user", content: "hi" }], tools: {}, dataPack: () => "{}", signal: controller.signal });
    await until(() => fs.existsSync(path.join(dir, "pids.json")));
    const { agent, helper } = JSON.parse(fs.readFileSync(path.join(dir, "pids.json"), "utf8")) as { agent: number; helper: number };
    controller.abort();
    expect(await answer).toEqual({ ok: false, error: "Stopped." });
    expect(await until(() => !alive(agent) && !alive(helper))).toBe(true);
    delete process.env.FAKE_MODE;
    delete process.env.FAKE_DIR;
  });
});
