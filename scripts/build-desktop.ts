// Gets everything the desktop app (src-tauri/) ships with, for one target:
//   src-tauri/app/       the server bundled into a few .js files, the page, skills, the Library,
//                        and the terminal's native module
//   src-tauri/binaries/  the Bun runtime that runs the server (a Tauri "sidecar")
// Tauri runs this before `tauri dev` and `tauri build`. By hand: bun scripts/build-desktop.ts [--target <triple>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { desktopTarget, hostTriple, shasumFor } from './desktop-target.ts';
import type { DesktopTarget } from './desktop-target.ts';

const root = path.resolve(import.meta.dirname, '..');
const tauriDir = path.join(root, 'src-tauri');
const stage = path.join(tauriDir, 'app');
const cache = path.join(tauriDir, 'target', 'desktop-cache');

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function rustHost(): string {
  const r = Bun.spawnSync(['rustc', '-vV'], { stdout: 'pipe', stderr: 'pipe' });
  return hostTriple(r.stdout.toString());
}

function step(what: string): void {
  console.log(`desktop: ${what}`);
}

/** Runs a command and stops the build if it fails. */
function sh(cmd: string[], cwd = root): void {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) throw new Error(`Failed (${r.exitCode}): ${cmd.join(' ')}`);
}

// ---------- the server, bundled ----------
async function bundleServer(): Promise<void> {
  const result = await Bun.build({
    // the MCP bridge is its own entry: agents' CLIs start it as a separate process
    entrypoints: [path.join(root, 'server', 'index.ts'), path.join(root, 'server', 'mcp-bridge.ts')],
    outdir: path.join(stage, 'server'),
    target: 'bun',
    format: 'esm',
    // keep names readable in error stacks
    minify: { whitespace: true, syntax: true, identifiers: false },
    // a native module: shipped as files in node_modules (copyTerminalModule)
    external: ['@lydell/node-pty'],
    naming: { entry: '[name].js', chunk: 'chunk-[hash].js', asset: 'asset-[hash].[ext]' },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    throw: false,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error('Could not bundle the server');
  }
  const size = result.outputs.reduce((n, o) => n + o.size, 0);
  step(`server: ${result.outputs.length} files, ${(size / 1024 / 1024).toFixed(1)} MB`);
}

// ---------- files the server reads from its own folder ----------
function copyDir(from: string, to: string, skip: (name: string) => boolean = () => false): void {
  fs.cpSync(from, to, { recursive: true, filter: (src) => !skip(path.basename(src)) });
}

function copyStatic(): void {
  // source maps only help when debugging the page; leave them out
  copyDir(path.join(root, 'public'), path.join(stage, 'public'), (n) => n.endsWith('.map') || n === '.dist-tmp');
  copyDir(path.join(root, 'skills'), path.join(stage, 'skills'));
  copyDir(path.join(root, 'library'), path.join(stage, 'library'));
  // the terminal's stylesheet is served straight from node_modules (VENDOR in server/index.ts)
  const css = path.join('node_modules', '@xterm', 'xterm', 'css', 'xterm.css');
  fs.mkdirSync(path.dirname(path.join(stage, css)), { recursive: true });
  fs.copyFileSync(path.join(root, css), path.join(stage, css));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string; version: string };
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module' }, null, 2) + '\n');
}

// node-pty is native, so it comes from an install for the target's OS and CPU, checked against bun.lock.
function copyTerminalModule(t: DesktopTarget): void {
  const lock = fs.readFileSync(path.join(root, 'bun.lock'));
  const key = crypto.createHash('sha256').update(lock).digest('hex').slice(0, 12);
  const dir = path.join(cache, `deps-${t.os}-${t.cpu}-${key}`);
  const platformPkg = path.join('node_modules', '@lydell', `node-pty-${t.os}-${t.cpu}`);
  if (!fs.existsSync(path.join(dir, platformPkg))) {
    step(`installing the terminal module for ${t.os}-${t.cpu}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(root, 'package.json'), path.join(dir, 'package.json'));
    fs.copyFileSync(path.join(root, 'bun.lock'), path.join(dir, 'bun.lock'));
    sh([process.execPath, 'install', '--frozen-lockfile', '--production', '--ignore-scripts', '--linker=hoisted', `--os=${t.os}`, `--cpu=${t.cpu}`], dir);
  }
  for (const p of [path.join('node_modules', '@lydell', 'node-pty'), platformPkg]) {
    if (!fs.existsSync(path.join(dir, p))) throw new Error(`Missing ${p} after install`);
    // (cpSync keeps file modes, so node-pty's spawn-helper stays executable on macOS and Linux)
    copyDir(path.join(dir, p), path.join(stage, p), (n) => n.endsWith('.pdb'));
  }
}

// ---------- the Bun runtime ----------
/** One file out of a .zip (Bun's releases are plain zips: no zip64, deflate or stored). */
function unzipOne(zip: Buffer, wanted: (name: string) => boolean): Buffer {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Broken zip directory');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    if (!wanted(name)) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error(`Unsupported zip compression (${method})`);
  }
  throw new Error('File not found in zip');
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// The same Bun version that runs this script, for the target, checked against Bun's SHASUMS256.txt.
async function bunRuntime(t: DesktopTarget, host: string): Promise<void> {
  const out = path.join(tauriDir, 'binaries', `bun-${t.triple}${t.exe}`);
  const cached = path.join(cache, `bun-${Bun.version}-${t.bunAsset}${t.exe}`);
  if (!fs.existsSync(cached)) {
    const base = `https://github.com/oven-sh/bun/releases/download/bun-v${Bun.version}`;
    try {
      step(`downloading Bun ${Bun.version} (${t.bunAsset})`);
      const [zip, sums] = await Promise.all([download(`${base}/${t.bunAsset}.zip`), download(`${base}/SHASUMS256.txt`)]);
      const want = shasumFor(sums.toString('utf8'), `${t.bunAsset}.zip`);
      const got = crypto.createHash('sha256').update(zip).digest('hex');
      if (!want || want !== got) throw new Error(`Checksum mismatch for ${t.bunAsset}.zip`);
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(cached + '.part', unzipOne(zip, (n) => n === `${t.bunAsset}/bun${t.exe}`));
      fs.renameSync(cached + '.part', cached);
    } catch (e) {
      // offline: building for this machine can still use the Bun that is running now
      if (t.triple !== host) throw e;
      console.warn(`desktop: ${e instanceof Error ? e.message : String(e)}; using this machine's Bun instead`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(process.execPath, out);
      return;
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(cached, out);
  if (t.exe === '') fs.chmodSync(out, 0o755);
}

// ---------- main ----------
const host = rustHost();
// Tauri passes the target it builds for (it differs from the host when cross-compiling)
const target = desktopTarget(argValue('--target') || process.env.TAURI_ENV_TARGET_TRIPLE || host);
const started = performance.now();
step(`building for ${target.triple}`);

// (--clean: no chunks of earlier builds in the app)
sh([process.execPath, path.join(root, 'scripts', 'build-web.ts'), '--clean']);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
await bundleServer();
copyStatic();
copyTerminalModule(target);
await bunRuntime(target, host);
step(`ready in ${((performance.now() - started) / 1000).toFixed(1)} s → src-tauri/app, src-tauri/binaries`);
