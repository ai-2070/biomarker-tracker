import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../server/http";
import * as profiles from "../../server/profiles";
import { getSettings } from "../../server/store";
import { crc32, readZip, safeEntryName, writeZip } from "../../server/zip";

const m = (id: string, date: string, value: number) => ({ id, biomarkerId: "ferritin", date, value, originalValue: value, originalUnit: "µg/L", source: "manual" as const });
const pdf = Buffer.from("%PDF-1.4\n% synthetic test file, no patient data\n");

describe("zip", () => {
  it("round-trips files, compressed or stored", () => {
    const big = Buffer.from("results ".repeat(2000));
    const tiny = Buffer.from("x");
    const back = readZip(writeZip([{ name: "a/results.json", data: big }, { name: "a/files/2026-10-28 r.pdf", data: tiny }]));
    expect(back.map((e) => e.name)).toEqual(["a/results.json", "a/files/2026-10-28 r.pdf"]);
    expect(back[0]!.data.equals(big)).toBe(true);
    expect(back[1]!.data.equals(tiny)).toBe(true);
  });

  it("uses the standard CRC-32 and refuses unsafe names and damaged files", () => {
    expect(crc32(Buffer.from("123456789")).toString(16)).toBe("cbf43926");
    for (const bad of ["../x", "/etc/passwd", "a/../../x", "C:/x", "a\\b"]) expect(safeEntryName(bad)).toBe(false);
    expect(() => readZip(writeZip([{ name: "../evil.txt", data: Buffer.from("x") }]))).toThrow(/unsafe/);
    const z = writeZip([{ name: "a.txt", data: Buffer.from("hello hello hello hello") }]);
    z[40] = z[40]! ^ 0xff;
    expect(() => readZip(z)).toThrow();
    expect(() => readZip(Buffer.from("not a zip"))).toThrow(/zip/);
  });
});

describe("profiles: one folder per person", () => {
  it("creates a readable folder with everything in it", () => {
    const p = profiles.createProfile({ person: { name: "Anna Kovács", sex: "f", birthMonth: "1984-04" }, measurements: [m("1", "2024-05-12", 46)] });
    expect(p.id).toMatch(/^anna-kovacs-[0-9a-f]{4}$/);
    for (const f of ["profile.json", "results.json", "log.json", "experiments.json", "settings.json", "files.json", "README.txt"]) expect(fs.existsSync(path.join(p.folder, f))).toBe(true);
    expect(p.results).toBe(1);
    expect(p.lastResult).toBe("2024-05-12");
    expect(profiles.getProfileData(p.id).person).toEqual({ name: "Anna Kovács", sex: "f", birthMonth: "1984-04" });
  });

  it("needs a name and valid data", () => {
    expect(() => profiles.createProfile({ person: {} })).toThrow(/name/);
    expect(() => profiles.createProfile({ person: { name: "X" }, measurements: [{ id: 1 }] })).toThrow(/damaged/);
    expect(() => profiles.getProfileData("../secrets")).toThrow(/valid/);
  });

  it("saves changes and keeps only display settings", () => {
    const p = profiles.createProfile({ person: { name: "Ben" } });
    profiles.saveProfileData(p.id, { person: { name: "Ben", heightCm: 180 }, measurements: [m("a", "2025-01-01", 30)], settings: { displayUnits: { ferritin: "ng/mL" }, ai: { key: "sk-x" } } });
    const d = profiles.getProfileData(p.id);
    expect(d.person.heightCm).toBe(180);
    expect(d.measurements).toHaveLength(1);
    expect(d.settings).toEqual({ displayUnits: { ferritin: "ng/mL" } });
  });

  it("keeps scanned files with safe, dated names and never overwrites", () => {
    const p = profiles.createProfile({ person: { name: "Cara" } });
    const a = profiles.addFile(p.id, "../../Lab report.pdf", pdf, "Lab report");
    const b = profiles.addFile(p.id, "Lab report.pdf", pdf);
    expect(a.name).toMatch(/^\d{4}-\d{2}-\d{2} Lab report\.pdf$/);
    expect(b.name).toMatch(/Lab report \(2\)\.pdf$/);
    expect(profiles.listFiles(p.id)).toHaveLength(2);
    expect(profiles.readFile(p.id, a.name).data.equals(pdf)).toBe(true);
    expect(() => profiles.addFile(p.id, "run.exe", pdf)).toThrow(/Only PDF/);
    expect(() => profiles.readFile(p.id, "../profile.json")).toThrow(/No file/);
    profiles.deleteFile(p.id, a.name);
    expect(profiles.listFiles(p.id).map((f) => f.name)).toEqual([b.name]);
  });

  it("backs up to a zip and restores it as a new profile, with files", () => {
    const p = profiles.createProfile({ person: { name: "Dora", diet: "vegan" }, measurements: [m("x", "2025-02-02", 20)], protocols: [{ id: "p", label: "Iron 30 mg", category: "supplement", start: "2025-01-01" }] });
    profiles.addFile(p.id, "report.pdf", pdf, "Lab report");
    const { data, fileName } = profiles.backupZip(p.id);
    expect(fileName).toMatch(/^biomarker-tracker-dora-[0-9a-f]{4}-\d{4}-\d{2}-\d{2}\.zip$/);
    const restored = profiles.restoreZip(data);
    expect(restored.id).not.toBe(p.id);
    const d = profiles.getProfileData(restored.id);
    expect(d.person).toEqual({ name: "Dora", diet: "vegan" });
    expect(d.measurements).toEqual(profiles.getProfileData(p.id).measurements);
    expect(d.protocols).toHaveLength(1);
    expect(profiles.listFiles(restored.id).map((f) => [f.originalName, f.note])).toEqual([["report.pdf", "Lab report"]]);
    expect(() => profiles.restoreZip(writeZip([{ name: "x.txt", data: Buffer.from("x") }]))).toThrow(/profile\.json/);
  });

  it("deletes the whole folder and forgets it as the open profile", () => {
    const p = profiles.createProfile({ person: { name: "Eve" } });
    profiles.setActiveProfile(p.id);
    expect(profiles.activeProfile()).toBe(p.id);
    profiles.deleteProfile(p.id);
    expect(fs.existsSync(p.folder)).toBe(false);
    expect(profiles.activeProfile()).toBeNull();
    expect(getSettings().activeProfile).toBeUndefined();
  });
});

describe("profiles over HTTP", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer(0);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
    server.close();
    server = createServer(port);
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  });
  afterAll(() => server.close());
  const url = (p: string) => `http://127.0.0.1:${port}${p}`;
  const write = { "x-bt": "1", "content-type": "application/json" };

  it("creates, opens, uploads a file, downloads it and backs up", async () => {
    const r = await fetch(url("/api/profiles"), { method: "POST", headers: write, body: JSON.stringify({ person: { name: "Finn" } }) });
    const { profile } = (await r.json()) as { profile: { id: string } };
    const list = (await (await fetch(url("/api/profiles"))).json()) as { active: string };
    expect(list.active).toBe(profile.id);

    // Uploads need the app's header like every change.
    expect((await fetch(url(`/api/profiles/${profile.id}/files?name=r.pdf`), { method: "POST", body: pdf })).status).toBe(403);
    const up = await fetch(url(`/api/profiles/${profile.id}/files?name=r.pdf&note=Lab%20report`), { method: "POST", headers: { "x-bt": "1", "content-type": "application/pdf" }, body: pdf });
    const { file } = (await up.json()) as { file: { name: string } };
    const down = await fetch(url(`/api/profiles/${profile.id}/files/${encodeURIComponent(file.name)}`));
    expect(down.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await down.arrayBuffer()).equals(pdf)).toBe(true);

    const zip = await fetch(url(`/api/profiles/${profile.id}/backup`));
    expect(zip.headers.get("content-disposition")).toMatch(/attachment/);
    const restored = await fetch(url("/api/profiles/restore"), { method: "POST", headers: { "x-bt": "1", "content-type": "application/zip" }, body: Buffer.from(await zip.arrayBuffer()) });
    expect(((await restored.json()) as { profile: { person: { name: string } } }).profile.person.name).toBe("Finn");
  });

  it("answers bad requests with plain errors", async () => {
    expect((await fetch(url("/api/profiles/nope-0000/data"))).status).toBe(404);
    const bad = await fetch(url("/api/profiles/restore"), { method: "POST", headers: { "x-bt": "1" }, body: "junk" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/zip/);
  });
});

describe("what the assistant learns about the person", () => {
  it("gets age and details, never the name, birth month or private notes", async () => {
    const { parseSnapshot, personOf, resultsOverview } = await import("../../server/healthTools");
    const r = parseSnapshot({
      measurements: [],
      profile: { name: "Anna Kovács", birthMonth: "1984-04", sex: "f", diet: "vegan", conditions: "chronic kidney disease", notes: "secret" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const person = personOf(r.snapshot);
    expect(person).toMatchObject({ sex: "female", diet: "vegan", conditions: "chronic kidney disease" });
    expect(typeof person.age).toBe("number");
    const sent = JSON.stringify(resultsOverview(r.snapshot));
    expect(sent).not.toMatch(/Anna|1984-04|secret/);
    expect(r.snapshot.profile).not.toHaveProperty("name");
  });
});
