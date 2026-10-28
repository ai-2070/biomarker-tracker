// The desktop app's build helpers (scripts/desktop-target.ts) and what the server does differently
// when the desktop app starts it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { desktopTarget, desktopTriples, hostTriple, shasumFor } from '../../scripts/desktop-target.ts';
import { releaseName, updaterManifest, updaterPart } from '../../scripts/desktop-updates.ts';
import { BRIDGE_SCRIPT, ROOT } from '../../server/util.ts';

describe('desktop build targets', () => {
  it('knows Windows, macOS and Linux on x64 and arm64', () => {
    expect(desktopTriples()).toHaveLength(6);
    expect(desktopTarget('x86_64-pc-windows-msvc')).toMatchObject({ os: 'win32', cpu: 'x64', bunAsset: 'bun-windows-x64-baseline', exe: '.exe' });
    expect(desktopTarget('aarch64-pc-windows-msvc')).toMatchObject({ os: 'win32', cpu: 'arm64', bunAsset: 'bun-windows-aarch64', exe: '.exe' });
    expect(desktopTarget('aarch64-apple-darwin')).toMatchObject({ os: 'darwin', cpu: 'arm64', bunAsset: 'bun-darwin-aarch64', exe: '' });
    expect(desktopTarget('x86_64-apple-darwin')).toMatchObject({ os: 'darwin', cpu: 'x64', exe: '' });
    expect(desktopTarget('x86_64-unknown-linux-gnu')).toMatchObject({ os: 'linux', cpu: 'x64', bunAsset: 'bun-linux-x64-baseline' });
    expect(desktopTarget('aarch64-unknown-linux-gnu')).toMatchObject({ os: 'linux', cpu: 'arm64', bunAsset: 'bun-linux-aarch64' });
  });

  it('says what to do instead of a universal macOS build, and refuses unknown targets', () => {
    expect(() => desktopTarget('universal-apple-darwin')).toThrow(/separately/);
    expect(() => desktopTarget('wasm32-unknown-unknown')).toThrow(/can't be built/);
  });

  it('reads the host from rustc and checksums from Bun\'s list', () => {
    expect(hostTriple('rustc 1.96.1\nbinary: rustc\nhost: aarch64-apple-darwin\nrelease: 1.96.1\n')).toBe('aarch64-apple-darwin');
    expect(() => hostTriple('')).toThrow(/rustc/);
    const a = 'a'.repeat(64);
    const b = 'B'.repeat(64);
    const sums = `${a}  bun-linux-x64.zip\r\n${b}  bun-linux-x64-baseline.zip\n`;
    expect(shasumFor(sums, 'bun-linux-x64-baseline.zip')).toBe('b'.repeat(64));
    expect(shasumFor(sums, 'bun-linux-x64.zip')).toBe(a);
    expect(shasumFor(sums, 'bun-darwin-x64.zip')).toBeNull();
  });
});

describe('server started by the desktop app', () => {
  let tmp = '';
  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('runs the MCP bridge from source in a checkout', () => {
    // (the desktop app ships server/mcp-bridge.js, bundled, and BRIDGE_SCRIPT picks that one)
    expect(fs.realpathSync(BRIDGE_SCRIPT)).toBe(fs.realpathSync(path.join(ROOT, 'server', 'mcp-bridge.ts')));
  });

  it('stops by itself when its stdin closes (the app quit or crashed)', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-desktop-'));
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const port = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const p = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });
    const child = spawn('bun', ['server/index.ts', '--port', String(port), '--no-open'], {
      cwd: path.resolve(import.meta.dirname, '..', '..'),
      env: { ...process.env, DASH_DATA: path.join(tmp, 'data'), DASH_DESKTOP: '1', HOME: home, USERPROFILE: home },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    try {
      let up = false;
      for (let i = 0; i < 200 && !up && child.exitCode === null; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/state`);
          up = r.ok && String(((await r.json()) as { dataDir?: string }).dataDir || '').startsWith(tmp);
        } catch {
          /* not up yet */
        }
        if (!up) await new Promise((r) => setTimeout(r, 150));
      }
      expect(up).toBe(true);
      child.stdin?.end();
      const code = await Promise.race([exited, new Promise<'still running'>((r) => setTimeout(() => r('still running'), 10_000))]);
      expect(code).toBe(0);
    } finally {
      child.kill();
    }
  }, 60_000);
});

describe('desktop updates (latest.json)', () => {
  it('names release files without spaces, and the macOS update after its CPU', () => {
    expect(releaseName('Blacksite_0.3.0_x64-setup.exe', 'x86_64-pc-windows-msvc', '0.3.0')).toBe('Blacksite_0.3.0_x64-setup.exe');
    expect(releaseName('Some App_0.3.0_x64-setup.exe', 'x86_64-pc-windows-msvc', '0.3.0')).toBe('Some.App_0.3.0_x64-setup.exe');
    expect(releaseName('Blacksite.app.tar.gz', 'aarch64-apple-darwin', '0.3.0')).toBe('Blacksite_0.3.0_aarch64.app.tar.gz');
    expect(releaseName('Blacksite.app.tar.gz', 'x86_64-apple-darwin', '0.3.0')).toBe('Blacksite_0.3.0_x64.app.tar.gz');
  });

  it('maps signed files to the platform keys the updater looks for, by how the app was installed', () => {
    const win = updaterPart('x86_64-pc-windows-msvc', [
      { file: 'Blacksite_0.3.0_x64-setup.exe', signature: 'sig-nsis\n' },
      { file: 'Blacksite_0.3.0_x64_en-US.msi', signature: 'sig-msi' },
    ]);
    expect(win.platforms).toEqual({
      'windows-x86_64-nsis': { file: 'Blacksite_0.3.0_x64-setup.exe', signature: 'sig-nsis' },
      'windows-x86_64': { file: 'Blacksite_0.3.0_x64-setup.exe', signature: 'sig-nsis' },
      'windows-x86_64-msi': { file: 'Blacksite_0.3.0_x64_en-US.msi', signature: 'sig-msi' },
    });
    const mac = updaterPart('aarch64-apple-darwin', [{ file: 'Blacksite_0.3.0_aarch64.dmg' }, { file: 'Blacksite_0.3.0_aarch64.app.tar.gz', signature: 's' }]);
    expect(Object.keys(mac.platforms)).toEqual(['darwin-aarch64-app', 'darwin-aarch64']);
    // Linux: only the kind it was installed as (no plain linux-x86_64 an AppImage would answer for a .deb)
    const linux = updaterPart('x86_64-unknown-linux-gnu', [
      { file: 'Blacksite_0.3.0_amd64.AppImage', signature: 'a' },
      { file: 'Blacksite_0.3.0_amd64.deb' },
    ]);
    expect(Object.keys(linux.platforms)).toEqual(['linux-x86_64-appimage']);
  });

  it('writes latest.json, and refuses a release a target has no signed update in', () => {
    const parts = [
      updaterPart('aarch64-apple-darwin', [{ file: 'Blacksite_0.3.0_aarch64.app.tar.gz', signature: 'm' }]),
      updaterPart('aarch64-pc-windows-msvc', [{ file: 'Blacksite_0.3.0_arm64-setup.exe', signature: 'w' }]),
    ];
    const latest = updaterManifest({ tag: 'v0.3.0', repo: 'ai-2070/blacksite', parts, now: new Date('2026-10-26T12:00:00Z') });
    expect(latest).toEqual({
      version: '0.3.0',
      notes: 'https://github.com/ai-2070/blacksite/releases/tag/v0.3.0',
      pub_date: '2026-10-26T12:00:00.000Z',
      platforms: {
        'darwin-aarch64-app': { url: 'https://github.com/ai-2070/blacksite/releases/download/v0.3.0/Blacksite_0.3.0_aarch64.app.tar.gz', signature: 'm' },
        'darwin-aarch64': { url: 'https://github.com/ai-2070/blacksite/releases/download/v0.3.0/Blacksite_0.3.0_aarch64.app.tar.gz', signature: 'm' },
        'windows-aarch64-nsis': { url: 'https://github.com/ai-2070/blacksite/releases/download/v0.3.0/Blacksite_0.3.0_arm64-setup.exe', signature: 'w' },
        'windows-aarch64': { url: 'https://github.com/ai-2070/blacksite/releases/download/v0.3.0/Blacksite_0.3.0_arm64-setup.exe', signature: 'w' },
      },
    });
    const unsigned = updaterPart('x86_64-unknown-linux-gnu', [{ file: 'Blacksite_0.3.0_amd64.AppImage' }]);
    expect(() => updaterManifest({ tag: 'v0.3.0', repo: 'a/b', parts: [...parts, unsigned] })).toThrow('No signed updates for x86_64-unknown-linux-gnu');
    expect(() => updaterManifest({ tag: 'v0.3.0', repo: 'a/b', parts: [] })).toThrow('No signed updates');
    expect(() => updaterManifest({ tag: 'main', repo: 'a/b', parts })).toThrow('version tag');
  });

  it('the app checks the release this repo publishes, signed with a key', () => {
    const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')) as { plugins: { updater: { pubkey: string; endpoints: string[] } }; bundle: { createUpdaterArtifacts?: unknown } };
    expect(conf.plugins.updater.endpoints).toEqual(['https://github.com/ai-2070/blacksite/releases/latest/download/latest.json']);
    expect(Buffer.from(conf.plugins.updater.pubkey, 'base64').toString('utf8')).toMatch(/^untrusted comment: minisign public key/);
    // local builds work without the private key: CI turns update files on
    expect(conf.bundle.createUpdaterArtifacts).toBeUndefined();
  });
});
