import fs from "node:fs";
import path from "node:path";

const IS_WIN = process.platform === "win32";

/** Full path of a command on PATH, or null. */
export function which(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts = IS_WIN ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter)) {
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
