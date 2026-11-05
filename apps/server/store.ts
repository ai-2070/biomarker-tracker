// Settings and secrets on disk, in the data folder (git-ignored). Secrets never go to the page.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ModelChoice, ProviderConfig, ProviderId } from "@bt/core/aiProviders";

// The repository root (knowledge/, skills/, data/). Compiled desktop sidecars read bundled files from Tauri's resource directory.
export const ROOT = process.env.BT_ROOT ? path.resolve(process.env.BT_ROOT) : path.resolve(import.meta.dirname, "..", "..");
/** BT_DATA lets tests (and the desktop app later) use their own folder. */
export const DATA = (): string => (process.env.BT_DATA ? path.resolve(process.env.BT_DATA) : path.join(ROOT, "data"));
export const dataPath = (...p: string[]): string => path.join(DATA(), ...p);

export function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

/** Persist directory-entry changes on systems that support directory fsync. */
export function syncDirectory(dir: string): void {
  if (process.platform === "win32") return;
  const directory = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}

/** Write via a temporary file, so a crash never leaves half a file. */
export function writeJSON(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  // Exclusive creation prevents reuse of a stale, potentially public temporary file.
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    syncDirectory(path.dirname(file));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export interface McpServerConfig {
  id: string;
  name: string;
  /** Set for ready-made servers. */
  presetId?: string;
  command: string;
  args: string[];
  /** Non-secret environment values. Secret ones are in secrets.mcpEnv. */
  env: Record<string, string>;
  enabled: boolean;
}

export interface Settings {
  assistant?: ModelChoice;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  /** Skills that are switched off (all are on by default). */
  skillsOff: string[];
  mcp: McpServerConfig[];
  /** The ready-made MCP servers were added once; removing one later keeps it removed. */
  mcpSeeded?: boolean;
  /** The profile (folder in data/profiles) the app has open. */
  activeProfile?: string;
  /** API and local models answer in eve (preview, opt-in); off by default. */
  eve?: boolean;
}

export interface Secrets {
  keys: Partial<Record<ProviderId, string>>;
  mcpEnv: Record<string, Record<string, string>>;
  /** Lets an agent registered once (Hermes) reach the app's tools, only while it is answering. */
  bridgeToken?: string;
}

const SETTINGS = () => dataPath("settings.json");
const SECRETS = () => dataPath("secrets.json");

export function getSettings(): Settings {
  const s = readJSON<Partial<Settings>>(SETTINGS(), {});
  return { providers: s.providers ?? {}, skillsOff: s.skillsOff ?? [], mcp: s.mcp ?? [], ...(s.assistant ? { assistant: s.assistant } : {}), ...(s.mcpSeeded ? { mcpSeeded: true } : {}), ...(typeof s.activeProfile === "string" ? { activeProfile: s.activeProfile } : {}) };
}

export function saveSettings(s: Settings): void {
  writeJSON(SETTINGS(), s);
}

export function updateSettings(fn: (s: Settings) => void): Settings {
  const s = getSettings();
  fn(s);
  saveSettings(s);
  return s;
}

export function getSecrets(): Secrets {
  const s = readJSON<Partial<Secrets>>(SECRETS(), {});
  return { keys: s.keys ?? {}, mcpEnv: s.mcpEnv ?? {}, ...(typeof s.bridgeToken === "string" ? { bridgeToken: s.bridgeToken } : {}) };
}

export function updateSecrets(fn: (s: Secrets) => void): void {
  const s = getSecrets();
  fn(s);
  writeJSON(SECRETS(), s);
  // writeJSON creates the replacement with 0600 before writing any secret bytes.
}
