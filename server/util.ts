// Small shared helpers: paths, ids, JSON files, process helpers.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// tests point this at a throwaway folder
export const DATA = process.env.DASH_DATA ? path.resolve(process.env.DASH_DATA) : path.join(ROOT, 'data');
// The MCP bridge that agents' CLIs start. The desktop app ships the server bundled, as .js.
export const BRIDGE_SCRIPT = ((js) => (fs.existsSync(js) ? js : path.join(ROOT, 'server', 'mcp-bridge.ts')))(path.join(ROOT, 'server', 'mcp-bridge.js'));
export const HOME = os.homedir();
export const IS_WIN = process.platform === 'win32';
export let PORT = Number(process.env.DASH_PORT || 4800);
export function setPort(p: number | string | undefined | null) {
  PORT = Number(p) || PORT;
}

export const dataPath = (...p: string[]): string => path.join(DATA, ...p);

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

export function slugify(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Without a fallback a missing or broken file gives null.
export function readJSON<T = unknown>(file: string, fallback: T): T;
export function readJSON<T = unknown>(file: string, fallback?: null): T | null;
export function readJSON<T>(file: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

// Write to a temp file first, then rename, so a crash never leaves half a file.
export function writeJSON<T>(file: string, value: T): T {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  // Antivirus or an editor can hold the file for a moment on Windows: retry briefly.
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      break;
    } catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (i + 1));
    }
  }
  return value;
}

// Is p inside the folder root (or root itself, with orEqual)? Windows paths ignore case; other systems' don't,
// so lowercasing there would let /Brain/Uploads pass for /Brain/uploads.
export function isInside(root: string, p: string, { orEqual = false }: { orEqual?: boolean } = {}): boolean {
  const norm = (x: string) => (IS_WIN ? path.resolve(x).toLowerCase() : path.resolve(x));
  const r = norm(root);
  const q = norm(p);
  return (orEqual && q === r) || q.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** A JSON file, only when it is a plain file: a link could point at data/secrets.json or anywhere else. */
export function readPlain<T>(file: string, fallback: T): T {
  try {
    if (!fs.lstatSync(file).isFile()) return fallback;
  } catch {
    return fallback;
  }
  return readJSON<T>(file, fallback);
}

/** A folder that is really there, not a link to one (lstat: the link itself is not followed). */
export function isPlainDir(p: string): boolean {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

// Where a path really is on disk, with every link followed. A path that doesn't exist yet (a new file)
// is placed under the real location of its nearest existing folder. Returns null when that can't be
// worked out safely: a link that points nowhere, a link loop, or a folder that can't be read.
export function realTarget(p: string): string | null {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let head = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...rest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      // ENOENT also comes from a link whose target is missing: writing through it would land outside
      try {
        fs.lstatSync(head);
        return null;
      } catch {
        /* really not there: try the folder above */
      }
      const parent = path.dirname(head);
      if (parent === head) return abs;
      rest.unshift(path.basename(head));
      head = parent;
    }
  }
}

// The real location of p when it lies inside one of roots (links followed on both sides), else null.
// Case is ignored only on Windows. Elsewhere a folder may have a sibling that differs only in case
// (Linux), and real paths already come back in the folder's own case where the disk ignores it (macOS).
export function insideRoots(p: string, roots: string[]): string | null {
  const real = realTarget(p);
  if (!real) return null;
  const fold = (s: string) => (IS_WIN ? s.toLowerCase() : s);
  const target = fold(real);
  for (const root of roots) {
    const r = fold(realTarget(root) || path.resolve(root));
    if (target === r || target.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return real;
  }
  return null;
}

export function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

export function listFiles(dir: string, filter: (name: string) => boolean = () => true): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && filter(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
}

export interface WalkOptions {
  maxDepth?: number;
  /** Gets the full path of each file. */
  filter?: (file: string) => boolean;
  limit?: number;
}

export function walk(dir: string, { maxDepth = 6, filter = () => true, limit = 5000 }: WalkOptions = {}): string[] {
  const out: string[] = [];
  const visit = (d: string, depth: number) => {
    if (depth > maxDepth || out.length >= limit) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
        visit(p, depth + 1);
      } else if (filter(p)) out.push(p);
      if (out.length >= limit) return;
    }
  };
  visit(dir, 0);
  return out;
}

// Find an executable on PATH (respects PATHEXT on Windows).
const whichCache = new Map<string, string | null>();
export function which(cmd: string): string | null {
  if (whichCache.has(cmd)) return whichCache.get(cmd) ?? null;
  let found: string | null = null;
  if (path.isAbsolute(cmd)) found = exists(cmd) ? cmd : null;
  else {
    const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase()) : [''];
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    // Common user-level install spots that are not always on PATH.
    dirs.push(path.join(HOME, '.local', 'bin'), path.join(HOME, 'AppData', 'Local', 'hermes', 'bin'), path.join(HOME, '.bun', 'bin'));
    outer: for (const d of dirs) {
      for (const ext of IS_WIN ? ['.exe', '.cmd', '.bat', ...exts] : ['']) {
        const p = path.join(d, cmd + ext);
        if (exists(p)) {
          found = p;
          break outer;
        }
      }
    }
  }
  whichCache.set(cmd, found);
  return found;
}
export function clearWhichCache() {
  whichCache.clear();
}

/** What an npm (or pnpm) .cmd shim runs: node and the package's script, read from the shim. Null for
 *  any other .cmd, or when the script or node isn't there. */
export function shimTarget(shim: string): { command: string; args: string[] } | null {
  let text = '';
  try {
    if (fs.statSync(shim).size > 20_000) return null;
    text = fs.readFileSync(shim, 'utf8');
  } catch {
    return null;
  }
  // "%dp0%\node_modules\@openai\codex\bin\codex.js" (npm) or "%~dp0\..\codex\bin\codex.js" (pnpm)
  const m = /"%~?dp0%?\\?([^"%]+?\.[cm]?js)"/i.exec(text);
  if (!m) return null;
  const dir = path.dirname(shim);
  const script = path.resolve(dir, m[1].replace(/\\/g, '/'));
  if (!exists(script)) return null;
  const local = path.join(dir, 'node.exe');
  const node = exists(local) ? local : which('node');
  return node && /\.exe$/i.test(node) ? { command: node, args: [script] } : null;
}

// Build a spawn() call that works for .cmd/.bat shims on Windows too.
export function spawnCommand(cmd: string, args: string[] = [], opts: SpawnOptions = {}): ChildProcess {
  const exe = which(cmd) || cmd;
  if (IS_WIN && /\.(cmd|bat)$/i.test(exe)) {
    // These go through cmd.exe, which would interpret these characters: refuse rather than risk injection.
    const bad = args.find((a) => /["%!^&|<>\r\n]/.test(String(a)));
    // An npm-installed CLI (codex.cmd) only starts node with its script: start that directly instead, no
    // cmd.exe in between, so its arguments (Codex's quoted settings) go through as they are.
    const direct = bad !== undefined ? shimTarget(exe) : null;
    if (direct) return spawn(direct.command, [...direct.args, ...args], { windowsHide: true, ...opts });
    if (bad !== undefined) throw new Error(`This argument has characters that can't be passed safely to ${path.basename(exe)}: ${String(bad).slice(0, 80)}`);
    const quoted = [exe, ...args].map(winQuote).join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${quoted}"`], {
      ...opts,
      windowsVerbatimArguments: true,
      windowsHide: true,
    });
  }
  return spawn(exe, args, { windowsHide: true, ...opts });
}

export function winQuote(a: string): string {
  a = String(a);
  if (a && !/[\s"&|<>^%()]/.test(a)) return a;
  return `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

export interface RunOptions {
  timeout?: number;
  input?: string | Buffer;
  cwd?: string;
  /** Added on top of this process's environment. */
  env?: Record<string, string | undefined>;
  maxBytes?: number;
  signal?: AbortSignal;
  /** Each line of its output as it comes (for programs that stream, e.g. JSON lines). */
  onLine?: (line: string) => void;
}

/** code is null when the process was killed by a signal, -1 when it couldn't start. */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Run a command and collect its output.
export function run(cmd: string, args: string[] = [], { timeout = 60000, input, cwd, env, maxBytes = 2_000_000, signal, onLine }: RunOptions = {}): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    let out = '';
    let partial = '';
    // a line longer than maxBytes is dropped (up to its end), so the buffer never grows past it
    let skipping = false;
    const lines = (d: string, end = false) => {
      if (!onLine) return;
      partial += d;
      let nl;
      while ((nl = partial.indexOf('\n')) !== -1) {
        const line = partial.slice(0, nl);
        partial = partial.slice(nl + 1);
        // (the end of one that grew too long, or a whole one that came too long at once)
        if (skipping || line.length > maxBytes) {
          skipping = false;
          continue;
        }
        try {
          onLine(line);
        } catch {
          /* a listener's problem is not the program's */
        }
      }
      if (partial.length > maxBytes) {
        partial = '';
        skipping = true;
      }
      if (skipping && end) partial = '';
      if (end && partial) {
        const last = partial;
        partial = '';
        try {
          onLine(last);
        } catch {
          /* as above */
        }
      }
    };
    let err = '';
    let done = false;
    let child: ChildProcess;
    try {
      child = spawnCommand(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String((e as Error).message || e) });
      return;
    }
    const timer = setTimeout(() => {
      if (!done) {
        err += `\n[timed out after ${Math.round(timeout / 1000)}s]`;
        killTree(child);
      }
    }, timeout);
    const onAbort = () => {
      err += '\n[stopped]';
      killTree(child);
    };
    if (signal?.aborted) onAbort();
    signal?.addEventListener('abort', onAbort);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      if (out.length < maxBytes) out += d;
      lines(d);
    });
    child.stderr?.on('data', (d: string) => {
      if (err.length < maxBytes) err += d;
    });
    child.stdin?.on('error', () => {});
    child.on('error', (e) => {
      err += String(e.message || e);
    });
    child.on('close', (code: number | null) => {
      lines('', true);
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout: out, stderr: err });
    });
    if (input != null) child.stdin?.end(input);
    else child.stdin?.end();
  });
}

export function killTree(child: ChildProcess | null | undefined) {
  if (!child || child.exitCode != null) return;
  try {
    if (IS_WIN && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    else child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}

// Start a GUI program and forget about it.
export function launchDetached(exe: string, args: string[] = [], opts: SpawnOptions = {}): number | undefined {
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false, ...opts });
  child.on('error', () => {});
  child.unref();
  return child.pid;
}

// Open a file, folder, URL or .lnk with its default handler.
// No cmd.exe here: URLs go to the URL handler, files and folders to Explorer.
export function openWithShell(target: string) {
  target = String(target);
  if (/[\r\n]/.test(target)) throw new Error('Invalid path or link.');
  if (IS_WIN) {
    const isUrl = /^https?:\/\//i.test(target);
    const [exe, args]: [string, string[]] = isUrl ? ['rundll32.exe', ['url.dll,FileProtocolHandler', target]] : ['explorer.exe', [path.resolve(target)]];
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref();
  } else {
    const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  }
}

// Show a file or folder selected in Explorer / Finder (Linux: open the folder it is in).
export function revealInShell(target: string) {
  target = path.resolve(String(target));
  if (/[\r\n]/.test(target)) throw new Error('Invalid path.');
  let isDir = false;
  try {
    isDir = fs.statSync(target).isDirectory();
  } catch {
    /* gone: open what is left */
  }
  const [exe, args]: [string, string[]] = IS_WIN
    ? // "/select," then the path as its own argument: Explorer opens the folder with it selected
      ['explorer.exe', ['/select,', target]]
    : process.platform === 'darwin'
      ? ['open', ['-R', target]]
      : ['xdg-open', [isDir ? target : path.dirname(target)]];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

export interface FetchJSONOptions extends RequestInit {
  /** Milliseconds; ignored when a signal is given. */
  timeout?: number;
}

/** The error fetchJSON throws for a non-2xx answer. */
export type FetchError = Error & { status?: number; body?: unknown };

// The answer is parsed JSON (or the raw text when it isn't JSON); T is what the caller expects back.
export async function fetchJSON<T = unknown>(url: string, opts: FetchJSONOptions = {}): Promise<T> {
  const { timeout = 15000, ...rest } = opts;
  const res = await fetch(url, { ...rest, signal: rest.signal || AbortSignal.timeout(timeout) });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = body as { error?: { message?: string }; detail?: string; title?: string };
    const msg = typeof body === 'object' && body ? b.error?.message || b.detail || b.title || JSON.stringify(body) : text;
    const e: FetchError = new Error(`${res.status} ${String(msg).slice(0, 500)}`);
    e.status = res.status;
    e.body = body;
    throw e;
  }
  return body as T;
}

export async function ping(url: string, timeout = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export function truncate(s: unknown, n = 20000): string {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n) + `\n…[${str.length - n} more characters cut]` : str;
}

// Fill {{name}} placeholders from a values object (dot paths allowed).
export function renderTemplate(tpl: unknown, values: Record<string, unknown>): string {
  return String(tpl ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, key: string) => {
    const v = key.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), values);
    if (v == null) return m;
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
}

export function tmpFile(name: string): string {
  const dir = ensureDir(dataPath('tmp'));
  return path.join(dir, `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${name}`);
}

export async function readText(file: string, max = 400_000): Promise<string> {
  const buf = await fsp.readFile(file);
  return buf.subarray(0, max).toString('utf8');
}

// YAML's double-quoted escapes (JSON's are a subset, so a value written with JSON.stringify reads back
// exactly). An escape YAML doesn't know is kept as it is, backslash and all.
const YAML_ESCAPES: Record<string, string> = { '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: String.fromCharCode(0x2028), P: String.fromCharCode(0x2029) };
/** One YAML scalar on one line, as its text: "double" and 'single' quotes are decoded, a plain one is trimmed. */
export function yamlScalar(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[\s\S])/g, (all, e: string) => {
      if (e.length > 1) {
        const code = parseInt(e.slice(1), 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : all;
      }
      return YAML_ESCAPES[e] ?? all;
    });
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}
// characters YAML may read as line breaks (JSON.stringify leaves them as they are)
const YAML_BREAKS = [0x85, 0x2028, 0x2029];
/** A string as a YAML scalar on one line: plain when that reads back the same, else double-quoted. */
export function yamlString(s: string): string {
  return s === '' || /[:#"'\\\n\r\t]/.test(s) || /^[\s>|[\]{}&*!%@`,?-]/.test(s) || /\s$/.test(s) ? JSON.stringify(s).replace(/[^\x00-\x7e]/g, (c) => (YAML_BREAKS.includes(c.charCodeAt(0)) ? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}` : c)) : s;
}

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = yamlScalar(kv[2]);
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Waits for all of these to settle, but no longer than ms. True if they all did in time. */
export async function settledWithin(promises: readonly (Promise<unknown> | undefined)[], ms: number): Promise<boolean> {
  if (ms <= 0) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.allSettled(promises).then(() => true), new Promise<boolean>((done) => (timer = setTimeout(() => done(false), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}
