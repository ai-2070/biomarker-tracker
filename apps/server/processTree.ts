// Programs the server starts for a question (agent programs and their helpers) and everything they start.
// On macOS/Linux each one gets its own process group, so stopping it also stops its children: an agent
// program may start MCP servers, shells or model helpers of its own. Stopping sends SIGTERM to the whole
// group, then SIGKILL to whatever is still running after a short grace period. On Windows, taskkill /t
// ends the tree. The server stops every group it still owns when it shuts down or exits.
import { type ChildProcess, type SpawnOptions, spawn, spawnSync } from "node:child_process";

const IS_WIN = process.platform === "win32";

/** How long a program gets to finish after SIGTERM before it is killed. */
export const GRACE_MS = 3_000;

const owned = new Set<ChildProcess>();

/** Starts a program in its own process group (POSIX), owned by the server until it and its group end. */
export function spawnTree(command: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  const child = spawn(command, args, { ...options, detached: !IS_WIN });
  owned.add(child);
  // The leader may exit before its children; the group stays owned until it is stopped or empty.
  child.once("exit", () => {
    if (!groupAlive(child)) owned.delete(child);
  });
  child.once("error", () => owned.delete(child));
  return child;
}

/** The programs (process groups) the server still owns. For tests and shutdown. */
export function ownedTrees(): number {
  for (const child of owned) if (child.exitCode !== null || child.signalCode !== null) if (!groupAlive(child)) owned.delete(child);
  return owned.size;
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (!child.pid) return false;
  try {
    // A negative pid signals the whole process group the child leads.
    process.kill(-child.pid, signal);
    return true;
  } catch {
    try {
      // Not a group leader (never expected with spawnTree): signal the child itself.
      if (child.exitCode === null && child.signalCode === null) return child.kill(signal);
    } catch {
      /* already gone */
    }
    return false;
  }
}

/** Whether anything in the child's process group is still running. */
export function groupAlive(child: ChildProcess): boolean {
  if (!child.pid) return false;
  if (IS_WIN) return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    // ESRCH: the group is gone. (EPERM would mean someone else's process reused the id: not ours.)
    return false;
  }
}

function taskkill(pid: number): void {
  spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
}

/**
 * Stops a program and everything it started: SIGTERM to the group, then SIGKILL after `graceMs` if any of
 * it is still running. Resolves when the group is gone (or after the SIGKILL).
 */
export async function killTree(child: ChildProcess, graceMs = GRACE_MS): Promise<void> {
  if (!child.pid) {
    owned.delete(child);
    return;
  }
  if (IS_WIN) {
    taskkill(child.pid);
    owned.delete(child);
    return;
  }
  if (!signalGroup(child, "SIGTERM")) {
    owned.delete(child);
    return;
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!groupAlive(child)) {
      owned.delete(child);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  signalGroup(child, "SIGKILL");
  owned.delete(child);
}

/** Stops every program the server still owns (graceful shutdown). */
export async function killAllTrees(graceMs = GRACE_MS): Promise<void> {
  await Promise.all([...owned].map((child) => killTree(child, graceMs)));
}

/** Last resort when the server process exits: no time to wait, so SIGKILL every owned group now. */
export function killAllTreesNow(): void {
  for (const child of owned) {
    if (!child.pid) continue;
    if (IS_WIN) taskkill(child.pid);
    else signalGroup(child, "SIGKILL");
  }
  owned.clear();
}

let hooked = false;
/** Makes sure owned programs never outlive the server, even when it exits without a graceful shutdown. */
export function stopTreesOnExit(): void {
  if (hooked) return;
  hooked = true;
  process.once("exit", killAllTreesNow);
}
