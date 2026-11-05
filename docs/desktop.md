# Desktop app

The desktop app (`apps/desktop/src-tauri/`, Tauri 2) is a window around the local server: it starts the bundled server
(`biomarker-server`, the Bun server compiled by `bun run desktop:prepare`) on `127.0.0.1:4821`, waits for it
to be ready and opens it. Profiles live in the app's local data folder (or `BT_DATA`).

## Building

- `bun run desktop:dev`: development build (no update checks). Uses `src-tauri/tauri.dev.conf.json`: runs `bun dev`
  and opens the window on Vite (http://localhost:5173) with hot reload; the server restarts when its files change
  and keeps profiles in `data/` (or `BT_DATA`). `bun run tauri dev` still builds and runs the bundled
  server (`desktop:prepare` first).
- `bun run desktop:build`: installers for this computer. Without the signing key these can't be used as
  updates, which is fine for local builds.
- To try signed update files locally: set `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents, or its path)
  and add `--config src-tauri/tauri.updater.conf.json` (relative to `apps/desktop`, where the Tauri commands run).

## Releases

1. Bump the version in the root `package.json`, `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/src-tauri/tauri.conf.json` (they must
   match; `bun run desktop:check-version` checks).
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `.github/workflows/desktop.yml` builds and signs every platform, attaches the installers, the update files
   (`.app.tar.gz`, NSIS/MSI, AppImage, each with a `.sig`) and `latest.json` to a draft release.
4. Publish the draft. Installed apps only see published releases (`releases/latest`).

A release tag without the `TAURI_SIGNING_PRIVATE_KEY` secret fails on purpose: installers built without it
could never update.

## Updates

`apps/desktop/src-tauri/src/updater.rs`, after ai-dashboard. Release builds check 30 seconds after start and then every
6 hours (never in development builds, or with `BT_NO_UPDATES` set). When a newer version is out, a native
dialog asks **Install and restart** or **Later** (Later skips that version until the app opens again). The
download's progress shows in the window title. Before installing, the app stops the local server and
everything it started; if installing fails, the server starts again and a dialog says so. The page has no
part in it (no Tauri IPC or capabilities). What happened is written to `updater.log` in the app's log folder.

The check downloads the public `latest.json` only; nothing about the person is sent (CLAUDE.md, allowed
network calls).

**The repository must be public** for `releases/latest/download/latest.json` to work without a login. While
it is private, installed apps find no update.

## The signing key

Updates are signed with a minisign key; the app installs a download only if its signature matches the
public key in `tauri.conf.json` (`plugins.updater.pubkey`).

- The key pair was made with `bun run tauri signer generate -w ~/.tauri/biomarker-tracker.key` (no
  password). The private key is never committed.
- Add the private key file's contents as the repository secret `TAURI_SIGNING_PRIVATE_KEY`
  (`gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/biomarker-tracker.key`). If the key gets a password,
  add it as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Keep a backup. If the private key is lost, installed apps can never update again (a new key needs a
  manual reinstall).
