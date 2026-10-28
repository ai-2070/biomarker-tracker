// scripts/keep-chunks.ts: a rebuild keeps the last builds' chunks, so a tab that is already open can
// still load the parts it hasn't opened yet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { KEEP_BUILDS, keepOldChunks } from '../../scripts/keep-chunks.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunks-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
const build = (files: string[]): string => {
  const dir = path.join(root, `b${n++}`);
  fs.mkdirSync(dir);
  for (const f of files) fs.writeFileSync(path.join(dir, f), f);
  return dir;
};

describe('keeping old chunks', () => {
  it('carries chunks the new build no longer makes, for a couple of builds', () => {
    let last = build(['app.js', 'chunk-aaa.js', 'chunk-aaa.js.map', 'chunk-bbb.js']);
    const next = build(['app.js', 'chunk-bbb.js', 'chunk-ccc.js']);
    expect(keepOldChunks(last, next)).toBe(2);
    expect(fs.readFileSync(path.join(next, 'chunk-aaa.js'), 'utf8')).toBe('chunk-aaa.js');
    expect(fs.existsSync(path.join(next, 'chunk-aaa.js.map'))).toBe(true);
    last = next;
    // the old chunk survives KEEP_BUILDS builds in all, then goes
    for (let i = 1; i <= KEEP_BUILDS; i++) {
      const b = build(['app.js', `chunk-new${i}.js`]);
      keepOldChunks(last, b);
      expect(fs.existsSync(path.join(b, 'chunk-aaa.js'))).toBe(i < KEEP_BUILDS);
      last = b;
    }
  });

  it("never copies other files, and a chunk that's made again starts over", () => {
    const last = build(['app.js', 'app.css', 'notes.txt', 'chunk-ddd.js']);
    const next = build(['app.js', 'app.css', 'chunk-ddd.js']);
    expect(keepOldChunks(last, next)).toBe(0);
    expect(fs.existsSync(path.join(next, 'notes.txt'))).toBe(false);
    expect(keepOldChunks(path.join(root, 'nothing'), next)).toBe(0);
  });
});
