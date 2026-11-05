import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const conf = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")) as {
  bundle: { targets: string[]; createUpdaterArtifacts?: boolean };
  plugins: { updater: { pubkey: string; endpoints: string[]; windows: { installMode: string } } };
};

describe("desktop updates", () => {
  it("checks this repository's latest release, signed with a minisign key", () => {
    expect(conf.plugins.updater.endpoints).toEqual(["https://github.com/ai-2070/biomarker-tracker/releases/latest/download/latest.json"]);
    expect(Buffer.from(conf.plugins.updater.pubkey, "base64").toString("utf8")).toMatch(/^untrusted comment: minisign public key: [0-9A-F]+\n\S+/);
    expect(conf.plugins.updater.windows.installMode).toBe("passive");
  });

  it("makes update files only when CI has the signing key, so local builds work without it", () => {
    expect(conf.bundle.createUpdaterArtifacts).toBeUndefined();
    expect(JSON.parse(read("apps/desktop/src-tauri/tauri.updater.conf.json"))).toMatchObject({ bundle: { createUpdaterArtifacts: true } });
    const workflow = read(".github/workflows/desktop.yml");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}");
    expect(workflow).toContain("--config src-tauri/tauri.updater.conf.json");
    expect(workflow).toContain("uploadUpdaterJson: ${{ env.BT_UPDATER == '1' }}");
    // A release without the key fails instead of shipping installers that can never update.
    expect(workflow).toMatch(/elif \[\[ -n "\$RELEASE_TAG" \]\]; then\n\s+echo "::error::A release needs the TAURI_SIGNING_PRIVATE_KEY/);
  });

  it("builds the macOS app bundle, which the update file is made from", () => {
    expect(conf.bundle.targets).toContain("app");
    const workflow = read(".github/workflows/desktop.yml");
    for (const line of workflow.split("\n").filter((l) => /bundles: .*dmg/.test(l))) expect(line).toMatch(/bundles: app,dmg/);
  });

  it("registers the updater and stops the server before installing", () => {
    const main = read("apps/desktop/src-tauri/src/main.rs");
    const updater = read("apps/desktop/src-tauri/src/updater.rs");
    expect(read("apps/desktop/src-tauri/Cargo.toml")).toMatch(/^tauri-plugin-updater = "2\.\d+"$/m);
    expect(main).toContain(".plugin(tauri_plugin_updater::Builder::new().build())");
    expect(main).toContain("updater::start(app.handle());");
    expect(updater.indexOf("crate::stop_server(app);")).toBeLessThan(updater.indexOf("update.install(&bytes)"));
    expect(updater).toContain("crate::start_server(app)");
    // Asked first, never silent; off in development builds.
    expect(updater).toContain('"Install and restart".into()');
    expect(updater).toContain("cfg!(debug_assertions)");
  });

  it("never commits the private key", () => {
    const tracked = fs.readdirSync(path.join(root, "apps/desktop/src-tauri"));
    expect(tracked.some((f) => /\.key$/.test(f))).toBe(false);
    // The config holds the public key; a secret key's comment says "secret key".
    expect(Buffer.from(conf.plugins.updater.pubkey, "base64").toString("utf8")).not.toMatch(/secret key/i);
  });
});
