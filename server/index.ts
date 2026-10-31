// Biomarker Tracker's local server. Run: bun server/index.ts [--port 4820]
// Listens on 127.0.0.1 only.
import { ensureDefaultServers, stopAll, warmUp } from "./mcp";
import { createServer } from "./http";
import { DATA } from "./store";

const i = process.argv.indexOf("--port");
const port = Number(i > 0 ? process.argv[i + 1] : process.env.BT_PORT || 4820);

const server = createServer(port);
server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") console.error(`Port ${port} is already in use. Is Biomarker Tracker already running? Try --port 4821.`);
  else console.error(e);
  process.exit(1);
});
// The ready-made research servers are added on first start and started in the background.
ensureDefaultServers();
server.listen(port, "127.0.0.1", () => {
  warmUp();
  const address = server.address() as { port: number };
  if (process.env.BT_DESKTOP === "1") console.log(`BT_READY http://127.0.0.1:${address.port}`);
  else console.log(`\n  Biomarker Tracker is running at http://localhost:${address.port}\n  Data folder: ${DATA()}\n  Press Ctrl+C to stop.\n`);
});

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  server.close();
  // An unresponsive MCP program must not keep the desktop process alive forever.
  setTimeout(() => process.exit(0), 2000).unref();
  void stopAll().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (process.env.BT_DESKTOP === "1") {
  // The native shell owns this pipe. Also stop if it crashes or is force-closed.
  process.stdin.resume();
  process.stdin.on("data", shutdown);
  process.stdin.on("end", shutdown);
}
