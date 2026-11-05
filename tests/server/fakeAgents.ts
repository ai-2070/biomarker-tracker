// Puts stand-ins for agent programs on PATH (tests/fixtures/agents), so the real runner, process handling
// and output parsing run without a real program, network or model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/agents");

export interface FakeAgents {
  /** A fresh folder the fake writes what it saw into (seen.json). */
  dir(): string;
  seen(dir: string): { args: string[]; input: string; images: string[]; system: string | null };
  restore(): void;
}

/** `programs` maps a command name (e.g. "claude") to a fixture file name (e.g. "fake-claude.cjs"). */
export function installFakeAgents(programs: Record<string, string>): FakeAgents {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bt-fake-agents-"));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  for (const [name, fixture] of Object.entries(programs)) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${path.join(FIXTURES, fixture)}" "$@"\n`, { mode: 0o755 });
  }
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  let n = 0;
  return {
    dir: () => {
      const d = path.join(root, `run-${++n}`);
      fs.mkdirSync(d);
      process.env.FAKE_DIR = d;
      return d;
    },
    seen: (d) => JSON.parse(fs.readFileSync(path.join(d, "seen.json"), "utf8")),
    restore: () => {
      process.env.PATH = oldPath;
      delete process.env.FAKE_DIR;
      delete process.env.FAKE_LINES;
      delete process.env.FAKE_DELAY;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
