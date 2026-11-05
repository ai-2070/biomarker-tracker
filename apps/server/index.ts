// Biomarker Tracker's local server. Run: bun apps/server/index.ts [--port 4820]
// Listens on 127.0.0.1 only.
import { ensureDefaultServers, stopAll, warmUp } from "./mcp";
import { createServer } from "./http";
import { DATA } from "./store";
import { killAllTrees, killAllTreesNow, stopTreesOnExit } from "./processTree";
import { stopEve } from "./eve/host";

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
// Agent programs run in their own process groups: they never get the terminal's Ctrl+C or the desktop
// shell's group kill, so the server stops them itself, also when it exits without a graceful shutdown.
stopTreesOnExit();
server.listen(port, "127.0.0.1", () => {
  warmUp();
  const address = server.address() as { port: number };
  if (process.env.BT_DESKTOP === "1") console.log(`BT_READY http://127.0.0.1:${address.port}`);
  else console.log(`\n  Biomarker Tracker is running at http://localhost:${address.port}\n  Data folder: ${DATA()}\n  Press Ctrl+C to stop.\n`);
});

// `bun --watch` (bun dev) restarts the server right after SIGTERM without waiting for the cleanup below,
// so programs it started are stopped at once. MCP servers end by themselves when their input closes.
const watching = process.execArgv.includes("--watch");

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  if (watching) killAllTreesNow();
  server.close();
  // An unresponsive program must not keep the desktop process alive forever (the exit hook then
  // SIGKILLs any process group still owned).
  // The desktop shell waits 5 s before it kills the server, so finish well before that.
  setTimeout(() => process.exit(0), 2500).unref();
  void Promise.allSettled([stopAll(), stopEve(), killAllTrees(1500)]).finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (process.env.BT_DESKTOP === "1") {
  // The native shell owns this pipe. Also stop if it crashes or is force-closed.
  process.stdin.resume();
  process.stdin.on("data", shutdown);
  process.stdin.on("end", shutdown);
}
