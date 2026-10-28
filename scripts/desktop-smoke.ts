// Checks what scripts/build-desktop.ts staged, the way the desktop app runs it: the bundled Bun
// starts the bundled server on a free port with a throwaway data folder and home folder, the page and an API answer,
// the MCP bridge starts, and the server stops by itself once its stdin closes.
// Run after build-desktop: bun scripts/desktop-smoke.ts [--target <triple>]
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { desktopTarget, hostTriple } from './desktop-target.ts';

const root = path.resolve(import.meta.dirname, '..');
const app = path.join(root, 'src-tauri', 'app');
const host = hostTriple(Bun.spawnSync(['rustc', '-vV']).stdout.toString());
const i = process.argv.indexOf('--target');
const t = desktopTarget(i > 0 ? process.argv[i + 1] : host);
const bun = path.join(root, 'src-tauri', 'binaries', `bun-${t.triple}${t.exe}`);
for (const f of [bun, path.join(app, 'server', 'index.js'), path.join(app, 'server', 'mcp-bridge.js')]) {
  if (!fs.existsSync(f)) throw new Error(`Missing ${f}. Run: bun scripts/build-desktop.ts`);
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('no port'))));
    });
  });

function fail(msg: string): never {
  console.error(`smoke: FAILED: ${msg}`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-smoke-'));
const data = path.join(tmp, 'data');
// a home of its own too: the default project's folder is <home>/Documents/Blacksite, and its auto-save
// must never touch yours
const home = path.join(tmp, 'home');
fs.mkdirSync(data);
fs.mkdirSync(home);
const isolated = { DASH_DATA: data, HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent') };
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
// cwd outside the repo, so nothing can be found by accident next to the sources
const server = Bun.spawn([bun, path.join(app, 'server', 'index.js'), '--port', String(port), '--no-open'], {
  cwd: data,
  env: { ...process.env, ...isolated, DASH_DESKTOP: '1' },
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
});
let output = '';
for (const stream of [server.stdout, server.stderr]) {
  void (async () => {
    for await (const chunk of stream) output += new TextDecoder().decode(chunk);
  })();
}

try {
  const until = Date.now() + 60_000;
  let page = '';
  while (Date.now() < until) {
    if (server.exitCode !== null) fail(`the server exited (${server.exitCode}):\n${output}`);
    try {
      const res = await fetch(base + '/');
      if (res.ok) {
        page = await res.text();
        break;
      }
    } catch {
      // not listening yet
    }
    await Bun.sleep(200);
  }
  if (!page) fail(`the server did not answer within 60 s:\n${output}`);
  if (!page.includes('dist/app.js')) fail('the page does not load the app bundle');
  console.log('smoke: page ok');

  for (const p of ['/dist/app.js', '/dist/app.css', '/vendor/xterm.css']) {
    const r = await fetch(base + p);
    if (!r.ok) fail(`${p} answered ${r.status}`);
  }
  const settings = await fetch(base + '/api/settings');
  if (!settings.ok) fail(`/api/settings answered ${settings.status}`);
  console.log('smoke: static files and API ok');

  // the bridge, as Claude Code would start it: one MCP initialize request over stdio
  const bridge = Bun.spawn([bun, path.join(app, 'server', 'mcp-bridge.js')], {
    env: { ...process.env, ...isolated, DASH_PORT: String(port) },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } };
  bridge.stdin.write(JSON.stringify(init) + '\n');
  await bridge.stdin.flush();
  const reader = bridge.stdout.getReader();
  const timer = setTimeout(() => bridge.kill(), 20_000);
  let reply = '';
  while (!reply.includes('\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    reply += new TextDecoder().decode(value);
  }
  clearTimeout(timer);
  bridge.kill();
  if (!reply.includes('"serverInfo"')) fail(`the MCP bridge did not answer: ${reply || '(nothing)'}`);
  console.log('smoke: MCP bridge ok');

  // closing stdin is how the desktop app says "stop"
  await server.stdin.end();
  const stopped = await Promise.race([server.exited.then(() => true), Bun.sleep(10_000).then(() => false)]);
  if (!stopped) fail('the server kept running after its stdin closed');
  console.log('smoke: stops with the app ok');
} finally {
  server.kill();
  await server.exited;
  fs.rmSync(tmp, { recursive: true, force: true });
}
