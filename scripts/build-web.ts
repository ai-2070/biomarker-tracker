// Bundles the browser app (web/*.ts) into public/dist with Bun. Pass --watch to rebuild on change,
// --clean to leave out the last builds' chunks (for a package: the desktop app).
import fs from 'node:fs';
import path from 'node:path';
import { buildCss } from './build-css.ts';
import { buildFonts } from './build-fonts.ts';
import { keepOldChunks } from './keep-chunks.ts';

const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, 'public', 'dist');
// Built here first (same depth, so source map paths still fit), then swapped in only if it worked:
// a compile error leaves the last good bundle in place.
const tmpdir = path.join(root, 'public', '.dist-tmp');
const watch = process.argv.includes('--watch');
const clean = process.argv.includes('--clean');

async function build(): Promise<boolean> {
  const started = performance.now();
  fs.rmSync(tmpdir, { recursive: true, force: true });
  const result = await Bun.build({
    // (the voxel mesher's worker is loaded by URL: public/dist/voxel/mesh.worker.js)
    entrypoints: [path.join(root, 'web', 'app.ts'), path.join(root, 'web', 'voxel', 'mesh.worker.ts')],
    outdir: tmpdir,
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: !watch,
    sourcemap: 'linked',
    // React and OpenUI read this; "development" would also make OpenUI load its devtools from a CDN
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    // report errors in result.logs instead of throwing (a throw would end --watch)
    throw: false,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    fs.rmSync(tmpdir, { recursive: true, force: true });
    return false;
  }
  try {
    // the fonts' @font-face rules go after Tailwind's output (they sit outside its layers)
    fs.writeFileSync(path.join(tmpdir, 'app.css'), (await buildCss({ minify: !watch })) + '\n' + buildFonts(tmpdir));
  } catch (e) {
    console.error('css:', e instanceof Error ? e.message : e);
    fs.rmSync(tmpdir, { recursive: true, force: true });
    return false;
  }
  // OpenUI's stylesheet for the chats (web/chat), linked when a chat first opens. In its own layer
  // (placed in web/styles/app.css): above Tailwind's reset, below the page's own styles.
  const openui = fs.readFileSync(path.join(root, 'node_modules', '@openuidev', 'react-ui', 'dist', 'styles', 'index.css'), 'utf8');
  fs.writeFileSync(path.join(tmpdir, 'openui.css'), `@layer openui {\n${openui}\n}\n`);
  // (outputs read their size from the files, so take it before the move)
  const size = result.outputs.reduce((n, o) => n + o.size, 0);
  // open tabs still ask for the chunks of the build they loaded
  if (!clean) keepOldChunks(outdir, tmpdir);
  fs.rmSync(outdir, { recursive: true, force: true });
  try {
    fs.renameSync(tmpdir, outdir);
  } catch {
    // (Windows can refuse to rename a folder something has open)
    fs.cpSync(tmpdir, outdir, { recursive: true });
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  console.log(`web: ${result.outputs.length} files, ${(size / 1024).toFixed(0)} KB in ${Math.round(performance.now() - started)} ms → public/dist`);
  return true;
}

const ok = await build();
if (!watch) process.exit(ok ? 0 : 1);

// --watch: rebuild when anything in web/ or shared/ changes. One build at a time; changes that
// come in during a build start one more build when it ends.
let timer: ReturnType<typeof setTimeout> | null = null;
let building = false;
let again = false;
async function rebuild() {
  if (building) {
    again = true;
    return;
  }
  building = true;
  try {
    await build();
  } finally {
    building = false;
  }
  if (again) {
    again = false;
    void rebuild();
  }
}
for (const dir of ['web', 'shared']) {
  fs.watch(path.join(root, dir), { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 120);
  });
}
console.log('web: watching for changes');
