// The eve runtime as a private child process (after ai-dashboard's server/eve/host.ts): started on the
// first question that uses it, on 127.0.0.1 and a free port, with a new token each start; its run store is
// data/eve (cwd). It is an owned process tree (processTree.ts): stopped with the server, and it also stops
// when its stdin closes (launch.mjs), so it never outlives the server. Started again on demand if it exits.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { killTree, spawnTree } from "../processTree";
import { DATA, ROOT } from "../store";
import { which } from "../which";
import { newBridgeToken } from "./bridge";

export interface EveHost {
  url: string;
  token: string;
  exited: Promise<void>;
}

/** The built runtime (bun run eve:build); the desktop app ships it as a resource at the same place. */
export const EVE_ENTRY = () => process.env.BT_EVE_ENTRY ?? path.join(ROOT, "runtime", "eve", ".output", "launch.mjs");
export const eveBuilt = () => fs.existsSync(EVE_ENTRY());

interface Slot {
  host: Promise<EveHost>;
  child?: ChildProcess;
}
let current: Slot | undefined;
let bridgeUrl = "http://127.0.0.1:4820/eve-bridge/";
export const setEveBridgePort = (port: number) => (bridgeUrl = `http://127.0.0.1:${port}/eve-bridge/`);

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/**
 * The runtime is built for Bun. The server itself runs on Bun (and the desktop sidecar is a compiled Bun
 * program, which BUN_BE_BUN turns into `bun`); anything else (tests under Node) uses bun from PATH.
 */
export function bunExecutable(): string {
  if (process.versions.bun) return process.execPath;
  const bun = which("bun");
  if (!bun) throw new Error("The eve runtime needs Bun, which wasn't found.");
  return bun;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

async function launch(slot: Slot, signal?: AbortSignal): Promise<EveHost> {
  if (!eveBuilt()) throw new Error("The eve runtime isn't built. Run `bun run eve:build`, or switch eve off in Settings → AI models.");
  const directory = path.join(DATA(), "eve");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const token = crypto.randomBytes(32).toString("hex");
  const child = spawnTree(bunExecutable(), [EVE_ENTRY()], {
    cwd: directory,
    windowsHide: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: {
      ...process.env,
      // The desktop sidecar is a compiled Bun program: this makes it run the script like `bun` would.
      BUN_BE_BUN: "1",
      NODE_ENV: "production",
      // No telemetry (CLAUDE.md).
      EVE_TELEMETRY_DISABLED: "1",
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      PORT: String(port),
      NITRO_PORT: String(port),
      WORKFLOW_LOCAL_BASE_URL: url,
      // Inline-owned steps keep a long lease after a crash; queued steps resume promptly (ai-dashboard).
      WORKFLOW_INLINE_OWNERSHIP: "0",
      BT_EVE_TOKEN: token,
      BT_EVE_BRIDGE_URL: bridgeUrl,
      BT_EVE_BRIDGE_TOKEN: newBridgeToken(),
    },
  });
  slot.child = child;
  child.stdin?.on("error", () => {});
  let failure: Error | undefined;
  child.once("error", (e) => (failure = e));
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  // Started again on the next question if it stops.
  void exited.then(() => {
    if (current === slot) current = undefined;
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) break;
    if (failure) break;
    if (child.exitCode !== null || child.signalCode !== null) {
      failure = new Error("The eve runtime stopped before it was ready.");
      break;
    }
    try {
      const response = await fetch(`${url}/eve/v1/health`, { signal: AbortSignal.timeout(1000), redirect: "error" });
      const health = (response.ok ? await response.json() : null) as { ok?: boolean; status?: string } | null;
      if (health?.ok === true && health.status === "ready") return { url, token, exited };
    } catch {
      /* still starting */
    }
    await pause(100);
  }
  await killTree(child);
  if (current === slot) current = undefined;
  throw failure ?? new Error(signal?.aborted ? "Stopped." : "The eve runtime didn't start in time.");
}

/** The running eve runtime, started if needed. */
export function eveHost(signal?: AbortSignal): Promise<EveHost> {
  if (current) return current.host;
  const slot: Slot = { host: Promise.resolve(undefined as never) };
  slot.host = launch(slot, signal);
  slot.host.catch(() => {});
  current = slot;
  return slot.host;
}

/** Stops the runtime (Settings switched eve off, or the server is stopping). */
export async function stopEve(): Promise<void> {
  const slot = current;
  current = undefined;
  if (!slot?.child) return;
  slot.child.stdin?.end();
  await killTree(slot.child, 3000);
}
