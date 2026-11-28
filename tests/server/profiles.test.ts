import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../apps/server/http";
import * as profiles from "../../apps/server/profiles";
import { getSettings } from "../../apps/server/store";
import { crc32, readZip, safeEntryName, writeZip } from "../../apps/server/zip";
import { statusOf, trpcClient } from "./trpc";

const m = (id: string, date: string, value: number) => ({
  id,
  biomarkerId: "ferritin",
  date,
  value,
  originalValue: value,
  originalUnit: "µg/L",
  source: "manual" as const,
});
const pdf = Buffer.from("%PDF-1.4\n% synthetic test file, no patient data\n");

describe("zip", () => {
  it("round-trips files, compressed or stored", () => {
    const big = Buffer.from("results ".repeat(2000));
    const tiny = Buffer.from("x");
    const back = readZip(
      writeZip([
        { name: "a/results.json", data: big },
        { name: "a/files/2026-10-28 r.pdf", data: tiny },
      ]),
    );
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
    for (const f of ["profile.json", "results.json", "log.json", "experiments.json", "protocols.json", "settings.json", "files.json", "README.txt"])
      expect(fs.existsSync(path.join(p.folder, f))).toBe(true);
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
    profiles.saveProfileData(p.id, {
      person: { name: "Ben", heightCm: 180 },
      measurements: [m("a", "2025-01-01", 30)],
      settings: { displayUnits: { ferritin: "ng/mL" }, ai: { key: "sk-x" } },
    });
    const d = profiles.getProfileData(p.id);
    expect(d.person.heightCm).toBe(180);
    expect(d.measurements).toHaveLength(1);
    expect(d.settings).toEqual({ displayUnits: { ferritin: "ng/mL" } });
  });
  it("preserves evidence history beyond the ordinary settings limit through folder saves and backup restores", () => {
    const p = profiles.createProfile({ person: { name: "History fixture" } });
    const history = { version: 1, checks: [], customTopics: [], updates: [], history: [{ summary: "Synthetic retained research audit. ".repeat(9000) }] };
    expect(JSON.stringify(history).length).toBeGreaterThan(200_000);
    profiles.saveProfileData(p.id, { person: { name: "History fixture" }, settings: { claimEvidence: history } });
    expect(profiles.getProfileData(p.id).settings.claimEvidence).toEqual(history);
    const restored = profiles.restoreZip(profiles.backupZip(p.id).data);
    expect(profiles.getProfileData(restored.id).settings.claimEvidence).toEqual(history);
    expect(() => profiles.saveProfileData(p.id, { person: { name: "History fixture" }, settings: { unrelated: "x".repeat(200_001) } })).toThrow(
      /Too many settings/,
    );
    expect(profiles.getProfileData(p.id).settings.claimEvidence).toEqual(history);
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

  it("keeps protocols in protocols.json, through saving and backups, and refuses damaged ones", () => {
    const plan = {
      id: "pl",
      name: "Stack",
      createdAt: "2026-10-01T00:00:00.000Z",
      items: [{ id: "i", label: "Vitamin D3", amount: "1000 IU", category: "supplement", when: "morning" }],
    };
    const p = profiles.createProfile({ person: { name: "Eva" }, plans: [plan] });
    expect(JSON.parse(fs.readFileSync(path.join(p.folder, "protocols.json"), "utf8"))).toEqual([plan]);
    const restored = profiles.restoreZip(profiles.backupZip(p.id).data);
    expect(profiles.getProfileData(restored.id).plans).toEqual([plan]);
    expect(() => profiles.saveProfileData(p.id, { person: { name: "Eva" }, plans: [{ ...plan, name: "" }] })).toThrow(/protocol is damaged/);
    const meal = { id: "m1", name: "Porridge", items: [{ foodId: "11-788", grams: 50 }], createdAt: "2026-10-29T00:00:00.000Z" };
    profiles.saveProfileData(p.id, { person: { name: "Eva" }, plans: [plan], meals: [meal] });
    expect(JSON.parse(fs.readFileSync(path.join(p.folder, "meals.json"), "utf8"))).toEqual([meal]);
    expect(profiles.getProfileData(profiles.restoreZip(profiles.backupZip(p.id).data).id).meals).toEqual([meal]);
    expect(() => profiles.saveProfileData(p.id, { person: { name: "Eva" }, meals: [{ ...meal, items: [{ foodId: "11-788", grams: 0 }] }] })).toThrow(
      /meal is damaged/,
    );
    const ticks = [{ id: "h1|2026-11-27", habitId: "h1", date: "2026-11-27", items: ["a"] }];
    profiles.saveProfileParts(p.id, { checkins: ticks });
    expect(JSON.parse(fs.readFileSync(path.join(p.folder, "checkins.json"), "utf8"))).toEqual(ticks);
    expect(profiles.getProfileData(profiles.restoreZip(profiles.backupZip(p.id).data).id).checkins).toEqual(ticks);
    expect(() => profiles.saveProfileParts(p.id, { checkins: [{ ...ticks[0], id: "h1|2026-11-26" }] })).toThrow(/check-in is damaged/);
    fs.unlinkSync(path.join(p.folder, "checkins.json"));
    expect(profiles.getProfileData(p.id).checkins).toEqual([]);
  });

  it("preserves started protocol snapshots through save and zip restore, and rejects corrupted log items", () => {
    const routine = {
      id: "routine",
      label: "Daily routine",
      category: "lifestyle",
      start: "2026-10-01",
      plan: {
        id: "deleted-source",
        items: [
          {
            id: "warfarin",
            label: "Warfarin",
            amount: "as prescribed",
            category: "medication",
            when: "evening",
            withFood: true,
            days: ["mon", "wed"],
            note: "Copied from my routine",
            mealId: "saved-meal",
          },
        ],
      },
    };
    const p = profiles.createProfile({ person: { name: "Snapshot test" }, protocols: [routine] });
    expect(profiles.getProfileData(p.id).protocols).toEqual([routine]);
    const edited = { ...routine, label: "My renamed routine", end: "2026-10-29" };
    profiles.saveProfileData(p.id, { person: { name: "Snapshot test" }, protocols: [edited] });
    expect(JSON.parse(fs.readFileSync(path.join(p.folder, "log.json"), "utf8"))).toEqual([edited]);
    const restored = profiles.restoreZip(profiles.backupZip(p.id).data);
    expect(profiles.getProfileData(restored.id).protocols).toEqual([edited]);
    expect(profiles.getProfileData(restored.id).plans).toEqual([]);

    const corrupt = { ...edited, plan: { ...routine.plan, items: [{ ...routine.plan.items[0], when: "lunch" }] } };
    expect(() => profiles.createProfile({ person: { name: "Broken snapshot" }, protocols: [corrupt] })).toThrow(/protocol list.*damaged/);
    expect(() => profiles.saveProfileData(p.id, { person: { name: "Snapshot test" }, protocols: [corrupt] })).toThrow(/protocol list.*damaged/);
    const corruptZip = writeZip(
      readZip(profiles.backupZip(p.id).data).map((entry) =>
        entry.name.endsWith("/log.json") ? { ...entry, data: Buffer.from(JSON.stringify([corrupt])) } : entry,
      ),
    );
    expect(() => profiles.restoreZip(corruptZip)).toThrow(/protocol list.*damaged/);
  });

  it("preserves source-local sleep windows through folder saves and zip restore, with no inferred offsets", () => {
    const sleep = {
      id: "sleep",
      savedOrder: 7,
      biomarkerId: "sleep_duration",
      date: "2026-10-25",
      value: 8,
      originalValue: 480,
      originalUnit: "min",
      source: "device",
      sleepSessions: [
        {
          start: "2026-10-24T23:15:00.125",
          end: "2026-10-25T07:30:00",
          kind: "asleep",
          source: "Synthetic watch",
          startOffsetMinutes: 120,
          endOffsetMinutes: 60,
        },
        { start: "2026-10-25T14:00:00", end: "2026-10-25T14:30:00", kind: "session", source: "Synthetic watch" },
      ],
    };
    const p = profiles.createProfile({ person: { name: "Sleep fixture" }, measurements: [sleep] });
    expect(JSON.parse(fs.readFileSync(path.join(p.folder, "results.json"), "utf8"))).toEqual([sleep]);
    expect(profiles.getProfileData(p.id).measurements).toEqual([sleep]);
    const edited = { ...sleep, note: "Source-local timestamps kept" };
    profiles.saveProfileData(p.id, { person: { name: "Sleep fixture" }, measurements: [edited] });
    const restored = profiles.restoreZip(profiles.backupZip(p.id).data);
    expect(profiles.getProfileData(restored.id).measurements).toEqual([edited]);
    const nap = profiles.getProfileData(restored.id).measurements[0]!.sleepSessions![1]!;
    expect(nap).not.toHaveProperty("startOffsetMinutes");
    expect(nap).not.toHaveProperty("endOffsetMinutes");

    const { sleepSessions: _sessions, ...durationOnly } = edited;
    profiles.saveProfileData(p.id, { person: { name: "Sleep fixture" }, measurements: [durationOnly] });
    expect(profiles.getProfileData(p.id).measurements).toEqual([durationOnly]);
    expect(profiles.getProfileData(profiles.restoreZip(profiles.backupZip(p.id).data).id).measurements).toEqual([durationOnly]);
  });

  it("rejects corrupt sleep metadata on profile creation, save, disk read and zip restore without replacing valid history", () => {
    const session = { start: "2026-10-24T23:00:00", end: "2026-10-25T07:00:00", kind: "asleep" };
    const sleep = { ...m("sleep", "2026-10-25", 8), biomarkerId: "sleep_duration", originalUnit: "h", sleepSessions: [session] };
    const p = profiles.createProfile({ person: { name: "Timing validation" }, measurements: [sleep] });
    const zip = profiles.backupZip(p.id).data;
    const invalid = [
      { ...sleep, sleepSessions: [] },
      { ...sleep, sleepSessions: [null] },
      { ...sleep, biomarkerId: "sleep_deep" },
      { ...sleep, date: "2026-10-26" },
      { ...sleep, sleepSessions: [{ ...session, startOffsetMinutes: 841 }] },
    ];
    for (const damaged of invalid) {
      expect(() => profiles.createProfile({ person: { name: "Broken timing" }, measurements: [damaged] })).toThrow(/Measurement.*damaged/);
      expect(() => profiles.saveProfileData(p.id, { person: { name: "Timing validation" }, measurements: [damaged] })).toThrow(/Measurement.*damaged/);
      expect(profiles.getProfileData(p.id).measurements).toEqual([sleep]);
      const corruptZip = writeZip(
        readZip(zip).map((entry) => (entry.name.endsWith("/results.json") ? { ...entry, data: Buffer.from(JSON.stringify([damaged])) } : entry)),
      );
      expect(() => profiles.restoreZip(corruptZip)).toThrow(/Measurement.*damaged/);
    }
    const results = path.join(p.folder, "results.json");
    fs.writeFileSync(results, JSON.stringify([invalid[0]]));
    try {
      expect(() => profiles.getProfileData(p.id)).toThrow(/damaged/);
      expect(() => profiles.backupZip(p.id)).toThrow(/damaged/);
    } finally {
      fs.writeFileSync(results, JSON.stringify([sleep]));
    }
  });

  it("backs up to a zip and restores it as a new profile, with files", () => {
    const p = profiles.createProfile({
      person: { name: "Dora", diet: "vegan" },
      measurements: [m("x", "2025-02-02", 20)],
      protocols: [{ id: "p", label: "Iron 30 mg", category: "supplement", start: "2025-01-01" }],
    });
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

  it("creates, opens, uploads a file, downloads it and backs up", async () => {
    const api = trpcClient(port);
    const { profile } = await api.profiles.create.mutate({ person: { name: "Finn" } });
    const list = await api.profiles.list.query();
    expect(list.active).toBe(profile.id);

    // Uploads need the app's header like every change.
    expect((await fetch(url(`/api/profiles/${profile.id}/files?name=r.pdf`), { method: "POST", body: pdf })).status).toBe(403);
    const up = await fetch(url(`/api/profiles/${profile.id}/files?name=r.pdf&note=Lab%20report`), {
      method: "POST",
      headers: { "x-bt": "1", "content-type": "application/pdf" },
      body: pdf,
    });
    const { file } = (await up.json()) as { file: { name: string } };
    const down = await fetch(url(`/api/profiles/${profile.id}/files/${encodeURIComponent(file.name)}`));
    expect(down.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await down.arrayBuffer()).equals(pdf)).toBe(true);

    const zip = await fetch(url(`/api/profiles/${profile.id}/backup`));
    expect(zip.headers.get("content-disposition")).toMatch(/attachment/);
    const restored = await fetch(url("/api/profiles/restore"), {
      method: "POST",
      headers: { "x-bt": "1", "content-type": "application/zip" },
      body: Buffer.from(await zip.arrayBuffer()),
    });
    expect(((await restored.json()) as { profile: { person: { name: string } } }).profile.person.name).toBe("Finn");
  });

  it("answers bad requests with plain errors", async () => {
    expect(await statusOf(trpcClient(port).profiles.data.query({ id: "nope-0000" }))).toBe(404);
    const bad = await fetch(url("/api/profiles/restore"), { method: "POST", headers: { "x-bt": "1" }, body: "junk" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/zip/);
  });
});

describe("what the assistant learns about the person", () => {
  it("gets age and details, never the name, birth month or private notes", async () => {
    const { parseSnapshot, personOf, resultsOverview } = await import("../../apps/server/healthTools");
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
