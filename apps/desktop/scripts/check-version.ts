import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
const config = JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8")) as { version: string };
const cargo = fs.readFileSync(path.join(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
if (config.version !== pkg.version || cargoVersion !== pkg.version) throw new Error("package.json, Cargo.toml and tauri.conf.json versions must match.");
const tag = process.argv[2];
if (tag && tag !== `v${pkg.version}`) throw new Error(`Release tag ${tag} does not match v${pkg.version}.`);
console.log(`Desktop version: ${pkg.version}${tag ? ` (${tag})` : ""}`);
