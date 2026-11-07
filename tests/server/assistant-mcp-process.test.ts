import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assistantTools, stopAll } from "../../apps/server/mcp";
import { updateSettings } from "../../apps/server/store";

// A real local JSON-RPC stdio peer. No provider, package install or network connection.
// The production transport owns the child: EOF is the observable shutdown handshake.
const fixture = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const mode = process.argv[1];
const dir = process.argv[2];
const log = (event) => fs.appendFileSync(path.join(dir, mode + ".events"), JSON.stringify(event) + "\n");
let reason = "unexpected-exit";
log({ event: "started", pid: process.pid });
process.on("exit", () => fs.writeFileSync(path.join(dir, mode + ".exit"), JSON.stringify({ pid: process.pid, reason })));
process.on("SIGTERM", () => { reason = "SIGTERM"; process.exit(0); });
process.stdin.on("end", () => { reason = "stdin-end"; process.exit(0); });
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  log({ event: "request", method: request.method });
  if (request.id === undefined) return;
  const response = { jsonrpc: "2.0", id: request.id };
  if (request.method === "initialize") {
    response.result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "local-fixture", version: "1" } };
  } else if (request.method === "tools/list") {
    if (mode === "failure") response.error = { code: -32000, message: "fixture tools/list failure" };
    else response.result = { tools: [{ name: "fixture_tool", description: "Local positive control", inputSchema: { type: "object", properties: {} } }] };
  } else {
    response.error = { code: -32601, message: "Unknown fixture method" };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
});
`;

interface FixtureEvent {
  event: string;
  pid?: number;
  method?: string;
}

function readEvents(dir: string, mode: string): FixtureEvent[] {
  return fs
    .readFileSync(path.join(dir, `${mode}.events`), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as FixtureEvent);
}

function assertExited(dir: string, mode: string, pid: number): void {
  const marker = path.join(dir, `${mode}.exit`);
  expect(fs.existsSync(marker), `${mode}: child exit marker`).toBe(true);
  expect(JSON.parse(fs.readFileSync(marker, "utf8"))).toEqual({ pid, reason: "stdin-end" });
  let failure: unknown;
  try {
    process.kill(pid, 0);
  } catch (error) {
    failure = error;
  }
  // An arbitrary error is not an exit receipt: require the OS's no-such-process result.
  expect(failure).toMatchObject({ code: "ESRCH" });
}

describe("real MCP stdio ownership", () => {
  it("assistant-mcp-process discovery failure closes the initialized child, while successful discovery stays live until shutdown", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-assistant-mcp-process-"));
    try {
      updateSettings((settings) => {
        settings.mcp = [
          { id: "local-fixture", name: "Local fixture", command: process.execPath, args: ["-e", fixture, "failure", dir], env: {}, enabled: true },
        ];
      });
      const failure = await assistantTools();
      expect(failure.servers).toEqual([]);
      expect(failure.tools).toEqual({});
      expect(failure.failed).toEqual([{ name: "Local fixture", error: expect.stringContaining("fixture tools/list failure") }]);
      const failedEvents = readEvents(dir, "failure");
      const failedPid = failedEvents[0]!.pid!;
      expect(failedPid).toBeGreaterThan(0);
      expect(failedEvents.filter((event) => event.event === "request").map((event) => event.method)).toEqual([
        "initialize",
        "notifications/initialized",
        "tools/list",
      ]);
      assertExited(dir, "failure", failedPid);

      updateSettings((settings) => {
        settings.mcp[0]!.args = ["-e", fixture, "success", dir];
      });
      const control = await assistantTools();
      expect(control.failed).toEqual([]);
      expect(control.servers).toEqual([{ id: "local-fixture", name: "Local fixture", about: "", tools: 1 }]);
      expect(Object.keys(control.tools)).toEqual(["research_tools", "use_research_tool"]);
      const controlPid = readEvents(dir, "success")[0]!.pid!;
      expect(controlPid).toBeGreaterThan(0);
      expect(() => process.kill(controlPid, 0)).not.toThrow();
      expect(fs.existsSync(path.join(dir, "success.exit"))).toBe(false);
      await stopAll();
      assertExited(dir, "success", controlPid);
    } finally {
      await stopAll();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
