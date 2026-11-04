// A stand-in for the `claude` program in tests: records what it was given, then prints the stream-json
// lines from FAKE_LINES (a JSON array), FAKE_DELAY ms apart. No network, no model.
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const dir = process.env.FAKE_DIR;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  const at = args.indexOf("--system-prompt-file");
  fs.writeFileSync(path.join(dir, "seen.json"), JSON.stringify({ args, input, system: at >= 0 ? fs.readFileSync(args[at + 1], "utf8") : null }));
  const lines = JSON.parse(process.env.FAKE_LINES || "[]");
  const delay = Number(process.env.FAKE_DELAY || 0);
  for (const line of lines) {
    process.stdout.write(JSON.stringify(line) + "\n");
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }
});
