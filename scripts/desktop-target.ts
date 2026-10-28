// Which Bun download and which native terminal module go with each desktop build target.
// Kept free of Bun APIs so the tests (which run in Node) can import it.

export interface DesktopTarget {
  /** Rust target triple, as Tauri names the sidecar: binaries/bun-<triple>[.exe] */
  triple: string;
  /** Node's names, used by `bun install --os/--cpu` and node-pty's platform packages */
  os: 'win32' | 'darwin' | 'linux';
  cpu: 'x64' | 'arm64';
  /** Bun release asset, without .zip */
  bunAsset: string;
  exe: '' | '.exe';
}

const TARGETS: Record<string, Omit<DesktopTarget, 'triple'>> = {
  // x64 uses Bun's "baseline" build: the default one needs AVX2, which some older PCs lack.
  'x86_64-pc-windows-msvc': { os: 'win32', cpu: 'x64', bunAsset: 'bun-windows-x64-baseline', exe: '.exe' },
  'aarch64-pc-windows-msvc': { os: 'win32', cpu: 'arm64', bunAsset: 'bun-windows-aarch64', exe: '.exe' },
  'x86_64-apple-darwin': { os: 'darwin', cpu: 'x64', bunAsset: 'bun-darwin-x64-baseline', exe: '' },
  'aarch64-apple-darwin': { os: 'darwin', cpu: 'arm64', bunAsset: 'bun-darwin-aarch64', exe: '' },
  'x86_64-unknown-linux-gnu': { os: 'linux', cpu: 'x64', bunAsset: 'bun-linux-x64-baseline', exe: '' },
  'aarch64-unknown-linux-gnu': { os: 'linux', cpu: 'arm64', bunAsset: 'bun-linux-aarch64', exe: '' },
};

export const desktopTriples = (): string[] => Object.keys(TARGETS);

export function desktopTarget(triple: string): DesktopTarget {
  const t = TARGETS[triple];
  if (!t) {
    const hint = triple === 'universal-apple-darwin' ? ' Build aarch64-apple-darwin and x86_64-apple-darwin separately instead.' : '';
    throw new Error(`The desktop app can't be built for ${triple}.${hint} Supported: ${desktopTriples().join(', ')}`);
  }
  return { triple, ...t };
}

/** The host's triple from `rustc -vV` output. */
export function hostTriple(rustcVersion: string): string {
  const m = /^host:\s*(\S+)/m.exec(rustcVersion);
  if (!m) throw new Error('Could not read the host target from `rustc -vV`. Is Rust installed?');
  return m[1];
}

/** The SHA-256 listed for a file in Bun's SHASUMS256.txt. */
export function shasumFor(shasums: string, file: string): string | null {
  for (const line of shasums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (m && m[2] === file) return m[1].toLowerCase();
  }
  return null;
}
