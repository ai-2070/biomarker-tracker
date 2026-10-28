// A page that is already open loads parts of the app later (a chat, the voxel world) by the chunk
// names of the build it started with. A rebuild names changed chunks anew, so the old ones are carried
// into the new output for a few more builds: an open tab keeps working until it is reloaded.
// Used by build-web.ts (and its test); plain Node.
import fs from 'node:fs';
import path from 'node:path';

/** How many later builds an old chunk is kept for. */
export const KEEP_BUILDS = 2;
const MANIFEST = 'old-chunks.json';
const CHUNK = /^chunk-[a-z0-9]+\.js(\.map)?$/;

/** Copies the chunks in `from` (the last output) that `to` (the new one) doesn't have, unless they are
 *  already KEEP_BUILDS builds old, and notes their age in `to`. Returns how many were kept. */
export function keepOldChunks(from: string, to: string): number {
  let names: string[];
  try {
    names = fs.readdirSync(from).filter((n) => CHUNK.test(n));
  } catch {
    return 0; // no earlier build
  }
  let ages: Record<string, unknown> = {};
  try {
    const j: unknown = JSON.parse(fs.readFileSync(path.join(from, MANIFEST), 'utf8'));
    if (j && typeof j === 'object' && !Array.isArray(j)) ages = j as Record<string, unknown>;
  } catch {
    // none yet: every chunk there came from the last build
  }
  const kept: Record<string, number> = {};
  for (const n of names) {
    if (fs.existsSync(path.join(to, n))) continue; // made again, unchanged
    const was = ages[n];
    const age = (typeof was === 'number' && Number.isFinite(was) ? was : 0) + 1;
    if (age > KEEP_BUILDS) continue;
    const src = path.join(from, n);
    if (!fs.lstatSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(to, n));
    kept[n] = age;
  }
  if (Object.keys(kept).length) fs.writeFileSync(path.join(to, MANIFEST), JSON.stringify(kept));
  return Object.keys(kept).length;
}
