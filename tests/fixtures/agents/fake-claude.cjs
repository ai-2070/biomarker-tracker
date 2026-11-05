// A stand-in for the `claude` (and `codex`) program in tests: records what it was given (with the contents of
// image files passed with -i, as base64), then prints the stream-json
// lines from FAKE_LINES (a JSON array), FAKE_DELAY ms apart. With FAKE_HANG=1 it then starts a helper and
// keeps running (pids in pids.json), like a program that is still working when the person presses Stop.
// FAKE_MCP=1 calls the app's first bridge tool before answering (lists, then calls get_results).
// No network, no model.
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const dir = process.env.FAKE_DIR;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  const at = args.indexOf("--system-prompt-file");
  const images = args.flatMap((a, i) => (a === "-i" ? [fs.readFileSync(args[i + 1]).toString("base64")] : []));
  fs.writeFileSync(path.join(dir, "seen.json"), JSON.stringify({ args, input, images, system: at >= 0 ? fs.readFileSync(args[at + 1], "utf8") : null }));
  if (process.env.FAKE_MCP === "1") {
    const at2 = args.indexOf("--mcp-config");
    const cfg = JSON.parse(fs.readFileSync(args[at2 + 1], "utf8")).mcpServers.bt;
    const call = async (id, method, params) => {
      const r = await fetch(cfg.url, { method: "POST", headers: { ...cfg.headers, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
      return r.text();
    };
    await call(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "1" } });
    await call(2, "tools/call", { name: "get_results", arguments: {} });
  }
  const lines = JSON.parse(process.env.FAKE_LINES || "[]");
  const delay = Number(process.env.FAKE_DELAY || 0);
  for (const line of lines) {
    process.stdout.write(JSON.stringify(line) + "\n");
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }
  if (process.env.FAKE_HANG === "1") {
    const { spawn } = require("node:child_process");
    const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    fs.writeFileSync(path.join(dir, "pids.tmp"), JSON.stringify({ agent: process.pid, helper: helper.pid }));
    fs.renameSync(path.join(dir, "pids.tmp"), path.join(dir, "pids.json"));
    setInterval(() => {}, 1000);
  }
});
