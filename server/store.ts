// Settings and secrets on disk, in the data folder (git-ignored). Secrets never go to the page.
import fs from "node:fs";
import path from "node:path";
import type { ModelChoice, ProviderConfig, ProviderId } from "../src/core/aiProviders";

export const ROOT = path.resolve(import.meta.dirname, "..");
/** BT_DATA lets tests (and the desktop app later) use their own folder. */
export const DATA = (): string => (process.env.BT_DATA ? path.resolve(process.env.BT_DATA) : path.join(ROOT, "data"));
export const dataPath = (...p: string[]): string => path.join(DATA(), ...p);

export function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Write via a temporary file, so a crash never leaves half a file. */
export function writeJSON(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
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
}

export interface Secrets {
  keys: Partial<Record<ProviderId, string>>;
  mcpEnv: Record<string, Record<string, string>>;
}

const SETTINGS = () => dataPath("settings.json");
const SECRETS = () => dataPath("secrets.json");

export function getSettings(): Settings {
  const s = readJSON<Partial<Settings>>(SETTINGS(), {});
  return { providers: s.providers ?? {}, skillsOff: s.skillsOff ?? [], mcp: s.mcp ?? [], ...(s.assistant ? { assistant: s.assistant } : {}) };
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
  return { keys: s.keys ?? {}, mcpEnv: s.mcpEnv ?? {} };
}

export function updateSecrets(fn: (s: Secrets) => void): void {
  const s = getSecrets();
  fn(s);
  writeJSON(SECRETS(), s);
  // Only the owner can read it, where the system supports that.
  try {
    fs.chmodSync(SECRETS(), 0o600);
  } catch {
    /* not supported on this system */
  }
}
