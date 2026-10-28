// Runs before each server test file: point the dashboard at a fresh, empty data folder
// (and a fake home for the Claude/Codex lookups), so tests never read or change your real data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-test-'));
process.env.DASH_DATA = path.join(dir, 'data');
fs.mkdirSync(process.env.DASH_DATA, { recursive: true });
// project folders default to <home>/Documents/Blacksite: keep those in the throwaway folder too
const home = path.join(dir, 'home');
fs.mkdirSync(home, { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
// pi prefers this over the home folder: an inherited one would let pi's tests write your real mcp.json
process.env.PI_CODING_AGENT_DIR = path.join(home, '.pi', 'agent');
if (os.homedir() !== home) throw new Error(`Tests could not use a throwaway home folder (got ${os.homedir()}); stopping so your real files stay untouched.`);
// and the dashboard really uses the throwaway data folder
const { dataPath } = await import('../../server/util.ts');
if (!path.resolve(dataPath()).startsWith(path.resolve(dir))) throw new Error(`The data folder is ${dataPath()}, not the throwaway one; stopping so your real data stays untouched.`);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
