import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tests stay in tests/ at the repository root and cover every workspace package.
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    projects: [
      { extends: true, test: { name: "core", include: ["tests/core/**/*.test.ts", "tests/core/**/*.test.tsx", "tests/knowledge/**/*.test.ts", "tests/research/**/*.test.ts", "tests/ai/**/*.test.ts", "tests/db/**/*.test.ts", "tests/app/**/*.test.ts", "tests/app/**/*.test.tsx"], environment: "node" } },
      // the local server, against a throwaway data folder (never data/)
      { extends: true, test: { name: "server", include: ["tests/server/**/*.test.ts"], environment: "node", setupFiles: ["tests/server/setup.ts"], isolate: true, testTimeout: 30_000 } },
    ],
  },
});
