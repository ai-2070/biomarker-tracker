// Gets a desktop release ready (run by .github/workflows/desktop.yml).
//
//   bun scripts/desktop-release.ts collect --target <triple>
//     after `tauri build --target <triple>`: copies its installers and signed updates into
//     release/files/ with their release names, and what they update into release/parts/<triple>.json
//   bun scripts/desktop-release.ts manifest --tag v0.1.0 --repo owner/name
//     with every target's release/ folder merged: writes release/files/latest.json
import fs from 'node:fs';
import path from 'node:path';
import { releaseName, updaterManifest, updaterPart } from './desktop-updates.ts';
import type { ReleaseFile, UpdaterPart } from './desktop-updates.ts';

const ROOT = path.resolve(import.meta.dir, '..');
const OUT = path.join(ROOT, 'release');
const FILES = path.join(OUT, 'files');
const PARTS = path.join(OUT, 'parts');

const arg = (name: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`Give --${name}`);
  return v;
};

// what tauri build makes, by bundle folder (an .app is left out: its .dmg and .app.tar.gz have it)
const KINDS: [string, RegExp][] = [
  ['nsis', /\.exe$/],
  ['msi', /\.msi$/],
  ['dmg', /\.dmg$/],
  ['macos', /\.app\.tar\.gz$/],
  ['deb', /\.deb$/],
  ['rpm', /\.rpm$/],
  ['appimage', /\.AppImage$/],
];

function collect(triple: string) {
  const version = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const bundle = path.join(ROOT, 'src-tauri', 'target', triple, 'release', 'bundle');
  fs.mkdirSync(FILES, { recursive: true });
  fs.mkdirSync(PARTS, { recursive: true });
  const files: ReleaseFile[] = [];
  for (const [dir, pattern] of KINDS) {
    const from = path.join(bundle, dir);
    if (!fs.existsSync(from)) continue;
    for (const name of fs.readdirSync(from).filter((n) => pattern.test(n))) {
      const file = releaseName(name, triple, version);
      fs.copyFileSync(path.join(from, name), path.join(FILES, file));
      const sig = path.join(from, `${name}.sig`);
      const signature = fs.existsSync(sig) ? fs.readFileSync(sig, 'utf8') : undefined;
      if (signature) fs.writeFileSync(path.join(FILES, `${file}.sig`), signature);
      files.push({ file, signature });
      console.log(`release: ${file}${signature ? ' (signed update)' : ''}`);
    }
  }
  if (!files.length) throw new Error(`Nothing was built in ${bundle}`);
  const part = updaterPart(triple, files);
  if (!Object.keys(part.platforms).length) console.warn('release: no signed updates (no TAURI_SIGNING_PRIVATE_KEY): installed apps can\'t update to this build');
  fs.writeFileSync(path.join(PARTS, `${triple}.json`), JSON.stringify(part, null, 2));
}

function manifest(tag: string, repo: string) {
  const parts = fs.existsSync(PARTS) ? fs.readdirSync(PARTS).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(PARTS, n), 'utf8')) as UpdaterPart) : [];
  const latest = updaterManifest({ tag, repo, parts });
  fs.mkdirSync(FILES, { recursive: true });
  fs.writeFileSync(path.join(FILES, 'latest.json'), JSON.stringify(latest, null, 2));
  console.log(`release: latest.json for ${latest.version}: ${Object.keys(latest.platforms).sort().join(', ')}`);
}

const command = process.argv[2];
if (command === 'collect') collect(arg('target'));
else if (command === 'manifest') manifest(arg('tag'), arg('repo'));
else throw new Error('Use: bun scripts/desktop-release.ts collect --target <triple> | manifest --tag <v…> --repo <owner/name>');
