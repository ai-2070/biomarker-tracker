import { describe, expect, it } from "vitest";
import { crc32 as browserCrc, profilesInFolder, zipStore } from "@bt/core/zipStore";
import * as profiles from "../../apps/server/profiles";
import { crc32, readZip } from "../../apps/server/zip";

const enc = new TextEncoder();

describe("loading a profile folder from the browser", () => {
  it("packs a zip the server reads back exactly", () => {
    const a = enc.encode('{"x":1}');
    const b = new Uint8Array([0, 1, 2, 255]);
    const back = readZip(Buffer.from(zipStore([{ name: "anna/results.json", data: a }, { name: "anna/files/r.pdf", data: b }])));
    expect(back.map((e) => e.name)).toEqual(["anna/results.json", "anna/files/r.pdf"]);
    expect(Buffer.from(a).equals(back[0]!.data)).toBe(true);
    expect(Buffer.from(b).equals(back[1]!.data)).toBe(true);
    expect(browserCrc(a)).toBe(crc32(Buffer.from(a)));
  });

  it("finds one profile folder, or several in a parent folder, and leaves other files out", () => {
    const one = profilesInFolder([{ path: "anna-1a2b/profile.json" }, { path: "anna-1a2b/results.json" }, { path: "anna-1a2b/files/2026-01-01 r.pdf" }, { path: "anna-1a2b/.DS_Store" }, { path: "anna-1a2b/files/sub/x.pdf" }]);
    expect(one).toHaveLength(1);
    expect(one[0]!.files.map((f) => f.name).sort()).toEqual(["anna-1a2b/files/2026-01-01 r.pdf", "anna-1a2b/profile.json", "anna-1a2b/results.json"]);

    const many = profilesInFolder([{ path: "profiles/anna/profile.json" }, { path: "profiles/anna/log.json" }, { path: "profiles/ben/profile.json" }, { path: "profiles/notes.txt" }]);
    expect(many.map((p) => [p.folder, p.files.map((f) => f.name)])).toEqual([
      ["anna", ["anna/profile.json", "anna/log.json"]],
      ["ben", ["ben/profile.json"]],
    ]);
    expect(profilesInFolder([{ path: "photos/a.jpg" }])).toEqual([]);
  });

  it("turns a chosen profile folder into a new profile with its data and files", () => {
    const src = profiles.createProfile({ person: { name: "Gita", heightCm: 165 }, measurements: [{ id: "1", biomarkerId: "ferritin", date: "2025-03-03", value: 40, originalValue: 40, originalUnit: "µg/L", source: "manual" }] });
    profiles.addFile(src.id, "report.pdf", Buffer.from("%PDF-1.4 synthetic"));
    // What the browser would send after the user picks that folder.
    const zip = profiles.backupZip(src.id).data;
    const files = readZip(zip).map((e) => ({ path: e.name, data: new Uint8Array(e.data) }));
    const [found] = profilesInFolder(files);
    const restored = profiles.restoreZip(Buffer.from(zipStore(found!.files.map((f) => ({ name: f.name, data: f.file.data })))));
    expect(profiles.getProfileData(restored.id).person).toEqual({ name: "Gita", heightCm: 165 });
    expect(restored.results).toBe(1);
    expect(restored.files).toBe(1);
  });
});
