// No telemetry (CLAUDE.md), also from developer tools: Turborepo reports anonymous usage unless told not to.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("developer tools send no telemetry", () => {
  it("every script that runs turbo switches its telemetry off", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    const turbo = Object.entries(scripts).filter(([, command]) => /\bturbo\b/.test(command));
    expect(turbo.length).toBeGreaterThan(0);
    for (const [name, command] of turbo) expect(command, name).toMatch(/^TURBO_TELEMETRY_DISABLED=1 turbo /);
  });

  it("CI switches it off for every job", () => {
    expect(read(".github/workflows/desktop.yml")).toMatch(/^env:\n(?: {2}.*\n)*? {2}TURBO_TELEMETRY_DISABLED: '1'$/m);
  });
});
