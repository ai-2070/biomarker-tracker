// Small helpers shared by the engines that run another agent CLI (pi, oh-my-pi, OpenClaw):
// its version for Settings, and reading what it prints line by line.
import { which, killTree, run as runCmd } from '../util.ts';
import type { ChildProcess } from 'node:child_process';

/** Installed or not, where, and its version (fetched in the background, at most once a minute). */
export interface CliStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

const versions = new Map<string, { at: number; version: string | null }>();
export function cliStatus(cmd: string, parse: (out: string) => string = (s) => s.trim().split('\n')[0] || ''): CliStatus {
  const exe = which(cmd);
  const hit = versions.get(cmd);
  if (exe && (!hit || Date.now() - hit.at > 60_000)) {
    versions.set(cmd, { at: Date.now(), version: hit?.version ?? null });
    runCmd(cmd, ['--version'], { timeout: 20000 }).then((r) => versions.set(cmd, { at: Date.now(), version: r.code === 0 ? parse(r.stdout) || null : null }));
  }
  return { installed: !!exe, path: exe, version: exe ? (versions.get(cmd)?.version ?? null) : null };
}

/** What a finished child left behind. */
export interface ChildEnd {
  code: number | null;
  stderr: string;
}

/** Sends input on stdin, hands each line of stdout to onLine, and waits for the child to end.
 *  Stopping (signal) kills the child and its children. */
export function pipeLines(child: ChildProcess, { input, signal, onLine }: { input?: string; signal: AbortSignal; onLine: (line: string) => void }): Promise<ChildEnd> {
  const onAbort = () => killTree(child);
  signal.addEventListener('abort', onAbort);
  let buf = '';
  let stderr = '';
  const take = (line: string) => {
    const t = line.trim();
    if (!t) return;
    try {
      onLine(t);
    } catch {
      /* one bad line doesn't end the run */
    }
  };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (d: string) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      take(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  });
  child.stderr?.on('data', (d: string) => {
    if (stderr.length < 200_000) stderr += d;
  });
  if (child.stdin) {
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  }
  return new Promise<ChildEnd>((resolve) => {
    child.on('close', (code) => {
      take(buf);
      signal.removeEventListener('abort', onAbort);
      resolve({ code, stderr });
    });
    child.on('error', (e) => {
      stderr += e.message;
      signal.removeEventListener('abort', onAbort);
      resolve({ code: -1, stderr });
    });
  });
}

/** The end of what a CLI printed to stderr, for an error message. */
export const tail = (s: string, n = 1200): string => (s.trim() ? `\n${s.trim().slice(-n)}` : '');

/** The chat's engine session no longer exists (or never did). The engine has already cleared
 *  chat.sessionId and set chat.reseed, so the run can try again at once in a new session. */
export class SessionGone extends Error {}
