// Every server test file gets its own throwaway data folder; never the real data/.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-test-"));
process.env.BT_DATA = dir;
if (!process.env.BT_DATA.startsWith(os.tmpdir())) throw new Error("Test data folder is not in the temp folder; refusing to run.");

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
