import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WIN = process.platform === "win32";

/** Folders the official installers use, which may not be on this server's PATH yet (installed after it started). */
function usualDirs(env: NodeJS.ProcessEnv): string[] {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  if (IS_WIN) {
    return [
      path.join(home, ".local", "bin"), // Claude Code, Codex
      env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "hermes", "bin") : "",
      env.APPDATA ? path.join(env.APPDATA, "npm") : "", // npm installs (OpenClaw)
      env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "openclaw") : "",
    ].filter(Boolean);
  }
  return [path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin"), path.join(home, ".hermes", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
}

let registryPath: { at: number; dirs: string[] } | null = null;

/** On Windows, an installer updates PATH in the registry; read it so new installs are found without restarting. */
function windowsRegistryPath(env: NodeJS.ProcessEnv): string[] {
  if (!IS_WIN) return [];
  if (registryPath && Date.now() - registryPath.at < 5000) return registryPath.dirs;
  const read = (key: string) => {
    try {
      const out = execFileSync("reg", ["query", key, "/v", "Path"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
      const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(out);
      return m
        ? m[1]!
            .trim()
            .replace(/%([^%]+)%/g, (_, v: string) => env[v] ?? env[v.toUpperCase()] ?? `%${v}%`)
            .split(";")
        : [];
    } catch {
      return [];
    }
  };
  const dirs = [...read("HKCU\\Environment"), ...read("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")].filter(Boolean);
  registryPath = { at: Date.now(), dirs };
  return dirs;
}

function findIn(dirs: string[], cmd: string, env: NodeJS.ProcessEnv): string | null {
  const exts = IS_WIN ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

/** Full path of a command: on PATH, in the current PATH from the registry (Windows), or where installers put it. */
export function which(cmd: string, env: NodeJS.ProcessEnv = process.env, extra = env === process.env): string | null {
  const onPath = findIn((env.PATH ?? env.Path ?? "").split(path.delimiter), cmd, env);
  if (onPath || !extra) return onPath;
  return findIn([...windowsRegistryPath(env), ...usualDirs(env)], cmd, env);
}
