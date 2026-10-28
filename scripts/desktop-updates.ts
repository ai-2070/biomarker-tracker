// What installed desktop apps read to update themselves: latest.json in the newest GitHub release.
// The app's updater looks for "<os>-<arch>-<installer>" first (the kind it was installed with), then
// "<os>-<arch>". Kept free of Bun APIs so the tests (which run in Node) can import it.
import { desktopTarget } from './desktop-target.ts';

/** One file a release carries, and the signature of it when it can be used as an update. */
export interface ReleaseFile {
  file: string;
  signature?: string;
}

/** What one target's build adds to latest.json: platform key -> the release file it updates from. */
export interface UpdaterPart {
  target: string;
  platforms: Record<string, { file: string; signature: string }>;
}

export interface UpdaterManifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { url: string; signature: string }>;
}

const ARCH = { x64: 'x86_64', arm64: 'aarch64' } as const;

/** A bundle's name in the release: no spaces (GitHub would turn them into dots anyway, and the URL
 *  in latest.json must match), and the macOS update named after its CPU, as the .dmg already is. */
export function releaseName(file: string, triple: string, version: string): string {
  const t = desktopTarget(triple);
  if (file.endsWith('.app.tar.gz')) return `${file.slice(0, -'.app.tar.gz'.length)}_${version}_${t.cpu === 'arm64' ? 'aarch64' : 'x64'}.app.tar.gz`.replace(/ /g, '.');
  return file.replace(/ /g, '.');
}

/** The platform keys a target's signed files serve. Windows installs from the NSIS installer unless
 *  the app came from the MSI; Linux only updates the kind it was installed as (an AppImage can't
 *  replace a .deb). */
export function updaterPart(triple: string, files: ReleaseFile[]): UpdaterPart {
  const t = desktopTarget(triple);
  const arch = ARCH[t.cpu];
  const platforms: UpdaterPart['platforms'] = {};
  for (const { file, signature } of files) {
    if (!signature) continue;
    const keys =
      t.os === 'darwin' && file.endsWith('.app.tar.gz') ? [`darwin-${arch}-app`, `darwin-${arch}`]
      : t.os === 'win32' && file.endsWith('-setup.exe') ? [`windows-${arch}-nsis`, `windows-${arch}`]
      : t.os === 'win32' && file.endsWith('.msi') ? [`windows-${arch}-msi`]
      : t.os === 'linux' && file.endsWith('.AppImage') ? [`linux-${arch}-appimage`]
      : t.os === 'linux' && file.endsWith('.deb') ? [`linux-${arch}-deb`]
      : t.os === 'linux' && file.endsWith('.rpm') ? [`linux-${arch}-rpm`]
      : [];
    for (const key of keys) platforms[key] = { file, signature: signature.trim() };
  }
  return { target: triple, platforms };
}

/** latest.json from every target's part. Throws when a target has nothing to update from, so a
 *  release is never published that installed apps of that kind would miss. */
export function updaterManifest({ tag, repo, parts, now = new Date() }: { tag: string; repo: string; parts: UpdaterPart[]; now?: Date }): UpdaterManifest {
  if (!/^v\d+\.\d+\.\d+/.test(tag)) throw new Error(`"${tag}" isn't a version tag like v0.1.0`);
  const empty = parts.filter((p) => !Object.keys(p.platforms).length).map((p) => p.target);
  if (!parts.length || empty.length) throw new Error(`No signed updates for ${empty.join(', ') || 'any target'}: was TAURI_SIGNING_PRIVATE_KEY set?`);
  const platforms: UpdaterManifest['platforms'] = {};
  for (const part of parts) {
    for (const [key, { file, signature }] of Object.entries(part.platforms)) {
      if (platforms[key]) throw new Error(`Two builds give an update for ${key}`);
      platforms[key] = { url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`, signature };
    }
  }
  return { version: tag.slice(1), notes: `https://github.com/${repo}/releases/tag/${tag}`, pub_date: now.toISOString(), platforms };
}
