import "fake-indexeddb/auto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as profiles from "../../server/profiles";
import { dataPath, readJSON, updateSecrets, writeJSON } from "../../server/store";
import { MAX_ZIP_BYTES, MAX_ZIP_EXPANDED_BYTES, readZip, writeZip } from "../../server/zip";
import { browserData, fileUrl, loadIntoBrowser } from "../../src/app/profiles";
import { db } from "../../src/db/db";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const measurement = (id: string, value: number) => ({ id, biomarkerId: "ferritin", date: "2026-01-01", value, originalValue: value, originalUnit: "µg/L", source: "manual" as const });
const habit = (label: string) => ({ id: "habit", label, category: "lifestyle" as const, start: "2026-01-01" });
const pdf = Buffer.from("%PDF-1.4 synthetic attachment\n");
const snapshotFiles = ["results.json", "log.json", "experiments.json", "protocols.json", "meals.json", "settings.json", "profile.json"];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
afterAll(() => db.close());

describe("server persistence review regressions", () => {
  it("R8-001 preserves disk and the existing browser copy when a real profile read fails", async () => {
    const saved = profiles.createProfile({ person: { name: "Disk person" }, measurements: [measurement("disk", 20)] });
    vi.stubGlobal("fetch", vi.fn(async () => {
      try {
        return Response.json(profiles.getProfileData(saved.id));
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 500 });
      }
    }));
    await loadIntoBrowser(saved.id); // Positive control: this transport really loads actual disk results.
    expect(await db.measurements.toArray()).toEqual([measurement("disk", 20)]);
    await db.measurements.put(measurement("browser", 44));
    const browserBefore = await browserData();
    const resultsPath = path.join(saved.folder, "results.json");
    const diskBefore = fs.readFileSync(resultsPath, "utf8");
    const originalRead = fs.readFileSync;
    let failures = 0;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (String(file) === resultsPath && failures++ === 0) throw Object.assign(new Error("profile results temporarily busy"), { code: "EBUSY" });
      return Reflect.apply(originalRead, fs, [file, ...args]);
    }) as typeof fs.readFileSync);
    await expect(loadIntoBrowser(saved.id)).rejects.toThrow("profile results temporarily busy");
    expect(failures).toBe(1);
    expect(await browserData()).toEqual(browserBefore);
    expect(fs.readFileSync(resultsPath, "utf8")).toBe(diskBefore);
    await loadIntoBrowser(saved.id);
    expect(await db.measurements.toArray()).toEqual([measurement("disk", 20)]);
  });

  it("R8-001 rejects missing required and corrupt existing files but accepts absent known legacy files", () => {
    const saved = profiles.createProfile({ person: { name: "Legacy" } });
    for (const file of ["experiments.json", "protocols.json", "meals.json", "settings.json"]) fs.unlinkSync(path.join(saved.folder, file));
    expect(profiles.getProfileData(saved.id)).toMatchObject({ experiments: [], plans: [], meals: [], settings: {} });
    fs.writeFileSync(path.join(saved.folder, "experiments.json"), "{");
    expect(() => profiles.getProfileData(saved.id)).toThrow(SyntaxError);
    fs.unlinkSync(path.join(saved.folder, "experiments.json"));
    for (const file of ["results.json", "log.json", "experiments.json"]) {
      fs.writeFileSync(path.join(saved.folder, file), "null");
      expect(() => profiles.getProfileData(saved.id)).toThrow(/history on disk is damaged/);
      writeJSON(path.join(saved.folder, file), []);
    }
    fs.unlinkSync(path.join(saved.folder, "results.json"));
    expect(() => profiles.getProfileData(saved.id)).toThrow(/ENOENT/);
    expect(() => profiles.saveProfileData(saved.id, { person: { name: "Replacement" } })).toThrow(/ENOENT/);
    expect(fs.existsSync(path.join(saved.folder, "results.json"))).toBe(false);
    // Repair the owned fixture so other tests can still list profiles.
    writeJSON(path.join(saved.folder, "results.json"), []);
  });

  it("R3-019 fails closed during failed rollback, then recovers every component before reads and backup", () => {
    const a = { person: { name: "Generation A" }, measurements: [measurement("m", 20)], protocols: [habit("Habit A")], settings: { theme: "light" } };
    const b = { person: { name: "Generation B" }, measurements: [measurement("m", 30)], protocols: [habit("Habit B")], settings: { theme: "dark" } };
    const saved = profiles.createProfile(a);
    const before = Object.fromEntries(snapshotFiles.map((name) => [name, JSON.parse(fs.readFileSync(path.join(saved.folder, name), "utf8"))]));
    const rename = fs.renameSync;
    const fault = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === path.join(saved.folder, "log.json")) throw Object.assign(new Error("blocked log replacement"), { code: "EBUSY" });
      rename(from, to);
    });
    expect(() => profiles.saveProfileData(saved.id, b)).toThrow("blocked log replacement");
    expect(fs.existsSync(path.join(saved.folder, ".save-journal.json"))).toBe(true);
    expect(() => profiles.getProfileData(saved.id)).toThrow("blocked log replacement");
    expect(() => profiles.backupZip(saved.id)).toThrow("blocked log replacement");
    expect(() => profiles.listProfiles()).toThrow("blocked log replacement");
    fault.mockRestore();
    expect(profiles.getProfileData(saved.id)).toMatchObject(a);
    expect(Object.fromEntries(snapshotFiles.map((name) => [name, JSON.parse(fs.readFileSync(path.join(saved.folder, name), "utf8"))]))).toEqual(before);
    expect(fs.existsSync(path.join(saved.folder, ".save-journal.json"))).toBe(false);
    const restored = profiles.restoreZip(profiles.backupZip(saved.id).data);
    expect(profiles.getProfileData(restored.id)).toMatchObject(a);
    profiles.saveProfileData(saved.id, b);
    expect(profiles.getProfileData(saved.id)).toMatchObject(b);
  });

  it.each([
    { phase: "save", failSync: false },
    { phase: "save", failSync: true },
    { phase: "recovery", failSync: false },
    { phase: "recovery", failSync: true },
  ])("R3-019 directory-syncs journal removal before $phase returns (sync failure: $failSync)", ({ phase, failSync }) => {
    const a = { person: { name: "Durable A" }, measurements: [measurement("m", 20)] };
    const b = { person: { name: "Durable B" }, measurements: [measurement("m", 30)] };
    const saved = profiles.createProfile(a);
    const journal = path.join(saved.folder, ".save-journal.json");
    if (phase === "recovery") {
      const previous = Object.fromEntries(snapshotFiles.map((name) => [name, fs.readFileSync(path.join(saved.folder, name), "utf8")]));
      profiles.saveProfileData(saved.id, b);
      writeJSON(journal, { previous });
    }
    const nativeWindows = process.platform === "win32";
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    const open = fs.openSync;
    const fsync = fs.fsyncSync;
    const close = fs.closeSync;
    const unlink = fs.unlinkSync;
    const directories = new Set<number>();
    const events: string[] = [];
    let removed = false;
    // Exercise the supported-platform branch on Windows while emulating only unavailable
    // directory descriptors. All profile files, journal removal and file fsyncs remain real.
    const openSpy = vi.spyOn(fs, "openSync").mockImplementation(((file: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
      if (String(file) === saved.folder && flags === "r") {
        const fd = nativeWindows ? -100 : open(file, flags, mode);
        directories.add(fd);
        events.push("directory-open");
        return fd;
      }
      return open(file, flags, mode);
    }) as typeof fs.openSync);
    const syncSpy = vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (directories.has(fd)) {
        events.push("directory-fsync");
        if (removed && failSync) throw new Error("journal directory sync failed");
        if (nativeWindows) return;
      }
      fsync(fd);
    });
    const closeSpy = vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      if (directories.delete(fd)) {
        events.push("directory-close");
        if (nativeWindows) return;
      }
      close(fd);
    });
    const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
      unlink(file);
      if (String(file) === journal) {
        removed = true;
        events.push("journal-unlink");
      }
    });
    try {
      Object.defineProperty(process, "platform", { ...platform, value: "linux" });
      const action = () => phase === "save" ? profiles.saveProfileData(saved.id, b) : profiles.getProfileData(saved.id);
      if (failSync) {
        expect(action).toThrow("journal directory sync failed");
        events.push("rejected");
      } else {
        action();
        events.push("acknowledged");
      }
      expect(events.slice(events.lastIndexOf("journal-unlink"))).toEqual([
        "journal-unlink", "directory-open", "directory-fsync", "directory-close", failSync ? "rejected" : "acknowledged",
      ]);
      expect(events.filter((event) => event === "directory-fsync").length).toBeGreaterThan(1);
    } finally {
      Object.defineProperty(process, "platform", platform);
      openSpy.mockRestore();
      syncSpy.mockRestore();
      closeSpy.mockRestore();
      unlinkSpy.mockRestore();
    }
    expect(profiles.getProfileData(saved.id)).toMatchObject(phase === "save" ? b : a);
    expect(fs.existsSync(journal)).toBe(false);
  });

  it("R1-010 rejects malformed file metadata and failed attachment writes without publishing a profile", () => {
    const source = profiles.createProfile({ person: { name: "Restore source" }, measurements: [measurement("m", 20)] });
    profiles.addFile(source.id, "first.pdf", pdf);
    profiles.addFile(source.id, "second.pdf", pdf);
    const backup = profiles.backupZip(source.id).data;
    const entries = readZip(backup);
    const before = profiles.listProfiles().map((p) => p.id).sort();
    for (const invalid of [Buffer.from("{"), Buffer.from("{}"), Buffer.from("[null]")]) {
      const damaged = entries.map((entry) => entry.name.endsWith("/files.json") ? { ...entry, data: invalid } : entry);
      expect(() => profiles.restoreZip(writeZip(damaged))).toThrow(/files.json.*damaged/);
      expect(profiles.listProfiles().map((p) => p.id).sort()).toEqual(before);
    }
    const write = fs.writeFileSync;
    let attachmentWrites = 0;
    const fault = vi.spyOn(fs, "writeFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (typeof file === "string" && file.endsWith(".pdf") && ++attachmentWrites === 2) throw Object.assign(new Error("attachment disk full"), { code: "ENOSPC" });
      return Reflect.apply(write, fs, [file, ...args]);
    }) as typeof fs.writeFileSync);
    expect(() => profiles.restoreZip(backup)).toThrow("attachment disk full");
    expect(attachmentWrites).toBe(2);
    fault.mockRestore();
    expect(profiles.listProfiles().map((p) => p.id).sort()).toEqual(before);
    expect(fs.readdirSync(profiles.PROFILES()).some((name) => name.startsWith(".restore-"))).toBe(false);
    const restored = profiles.restoreZip(backup);
    expect(profiles.listFiles(restored.id)).toHaveLength(2);
    for (const file of profiles.listFiles(restored.id)) expect(profiles.readFile(restored.id, file.name).data).toEqual(pdf);
  });

  it.each([
    { key: "meals", filename: "meals.json" },
    { key: "plans", filename: "protocols.json" },
  ] as const)("R6-001 rejects duplicate $key IDs before restore publication", ({ key, filename }) => {
    const input = {
      person: { name: `Unique ${key}` },
      meals: [
        { id: "meal-a", name: "Porridge", items: [{ foodId: "11-788", grams: 50 }], createdAt: "2026-10-29T00:00:00.000Z" },
        { id: "meal-b", name: "More porridge", items: [{ foodId: "11-788", grams: 75 }], createdAt: "2026-10-29T00:00:00.000Z" },
      ],
      plans: [
        { id: "plan-a", name: "Morning", createdAt: "2026-10-29T00:00:00.000Z", items: [{ id: "item-a", label: "Walk", amount: "", category: "lifestyle", when: "morning" }] },
        { id: "plan-b", name: "Evening", createdAt: "2026-10-29T00:00:00.000Z", items: [{ id: "item-b", label: "Read", amount: "", category: "lifestyle", when: "evening" }] },
      ],
    };
    const source = profiles.createProfile(input);
    const archive = profiles.backupZip(source.id).data;
    const valid = profiles.restoreZip(archive);
    expect(profiles.getProfileData(valid.id)[key]).toEqual(input[key]);
    const entries = readZip(archive);
    const duplicates = [input[key][0]!, { ...input[key][1]!, id: input[key][0]!.id }];
    const damaged = entries.map((entry) => entry.name.endsWith(`/${filename}`) ? { ...entry, data: Buffer.from(JSON.stringify(duplicates)) } : entry);
    const before = profiles.listProfiles().map((profile) => profile.id).sort();
    expect(() => profiles.restoreZip(writeZip(damaged))).toThrow(/duplicate IDs/);
    expect(profiles.listProfiles().map((profile) => profile.id).sort()).toEqual(before);
    expect(fs.readdirSync(profiles.PROFILES()).some((name) => name.startsWith(".restore-"))).toBe(false);
    expect(() => profiles.saveProfileData(source.id, { ...input, [key]: duplicates })).toThrow(/duplicate IDs/);
    expect(profiles.getProfileData(source.id)[key]).toEqual(input[key]);
  });

  it("R1-009 and R6-003 round-trip long and astral attachment names, extensions, URLs and actual bytes", () => {
    const source = profiles.createProfile({ person: { name: "Unicode" } });
    const names = ["a".repeat(205) + ".pdf", "A" + "\u{10400}".repeat(40) + ".pdf", "\u{10400}".repeat(205) + ".jpeg"];
    const kept = names.map((name) => profiles.addFile(source.id, name, pdf));
    for (const file of kept) {
      expect(file.originalName.endsWith(path.extname(file.name))).toBe(true);
      expect(() => fileUrl(source.id, file.name)).not.toThrow();
      expect(decodeURIComponent(fileUrl(source.id, file.name).split("/files/")[1]!)).toBe(file.name);
      expect(Buffer.byteLength(file.name)).toBeLessThan(255);
    }
    const restored = profiles.restoreZip(profiles.backupZip(source.id).data);
    expect(profiles.listFiles(restored.id).map((file) => file.originalName)).toEqual(kept.map((file) => file.originalName));
    // The zip's entry order depends on the file system; the saved files.json order must win.
    const reversed = profiles.restoreZip(writeZip(readZip(profiles.backupZip(source.id).data).reverse()));
    expect(profiles.listFiles(reversed.id).map((file) => file.originalName)).toEqual(kept.map((file) => file.originalName));
    for (const file of profiles.listFiles(restored.id)) {
      expect(() => fileUrl(restored.id, file.name)).not.toThrow();
      expect(profiles.readFile(restored.id, file.name).data).toEqual(pdf);
    }
  });

  it("R1-008 rejects archives beyond either supported size and ZIP32 entry boundaries before success", () => {
    const oneMiB = Buffer.alloc(1024 * 1024);
    const expanded = Array.from({ length: MAX_ZIP_EXPANDED_BYTES / oneMiB.length + 1 }, (_, i) => ({ name: `${i}.txt`, data: oneMiB }));
    expect(() => writeZip(expanded)).toThrow(/500 MB expanded backup limit/);
    const longName = "a".repeat(65535);
    const tiny = Buffer.alloc(0);
    // Empty data and long names reach the real encoded archive limit without huge source buffers.
    expect(() => writeZip(Array.from({ length: 1601 }, () => ({ name: longName, data: tiny })))).toThrow(/200 MB backup limit/);
    expect(() => writeZip(Array.from({ length: 65536 }, () => ({ name: "x", data: tiny })))).toThrow(/too many files/);
    expect(() => writeZip([{ name: longName + "a", data: tiny }])).toThrow(/name is too long/);
    expect(() => readZip(Buffer.allocUnsafe(MAX_ZIP_BYTES + 1))).toThrow(/200 MB upload limit/);
    const bytes = writeZip([{ name: "ok.txt", data: pdf }]);
    expect(readZip(bytes)[0]!.data).toEqual(pdf);
  });

  it("R1-008 rejects a profile over the expanded limit before reading its oversized attachment", () => {
    const saved = profiles.createProfile({ person: { name: "Large profile" } });
    const sparseFile = path.join(saved.folder, "files", "large.pdf");
    const fd = fs.openSync(sparseFile, "w");
    try { fs.ftruncateSync(fd, MAX_ZIP_EXPANDED_BYTES + 1); } finally { fs.closeSync(fd); }
    const read = fs.readFileSync;
    let oversizedReads = 0;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (String(file) === sparseFile) oversizedReads++;
      return Reflect.apply(read, fs, [file, ...args]);
    }) as typeof fs.readFileSync);
    expect(() => profiles.backupZip(saved.id)).toThrow(/500 MB expanded backup limit/);
    expect(oversizedReads).toBe(0);
    fs.unlinkSync(sparseFile);
    expect(profiles.restoreZip(profiles.backupZip(saved.id).data).person.name).toBe("Large profile");
  });

  it("R1-013 creates secret temporary files privately before any bytes are written and retains the mode on replacement", () => {
    const open = fs.openSync;
    const calls: { file: string; flags: unknown; mode: unknown }[] = [];
    vi.spyOn(fs, "openSync").mockImplementation(((file: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
      if (String(file).includes("secrets.json") && String(file).endsWith(".tmp")) calls.push({ file: String(file), flags, mode });
      return open(file, flags, mode);
    }) as typeof fs.openSync);
    updateSecrets((secrets) => { secrets.keys.openai = "synthetic-test-key"; });
    updateSecrets((secrets) => { secrets.keys.openai = "replacement-test-key"; });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.flags === "wx" && call.mode === 0o600)).toBe(true);
    expect(new Set(calls.map((call) => call.file)).size).toBe(2);
    expect(readJSON<{ keys: { openai: string } }>(dataPath("secrets.json"), { keys: { openai: "" } }).keys.openai).toBe("replacement-test-key");
    expect(calls.every((call) => !fs.existsSync(call.file))).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(dataPath("secrets.json")).mode & 0o777).toBe(0o600);
  });

  it("R3-020 reports an asynchronous launch error and keeps a listener after a successful spawn", async () => {
    const saved = profiles.createProfile({ person: { name: "Reveal" } });
    const failed = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReturnValueOnce(failed as unknown as ChildProcess);
    const launch = profiles.revealFolder(saved.id);
    const rejection = expect(launch).rejects.toThrow("Couldn't open the folder");
    failed.emit("error", Object.assign(new Error("missing file manager"), { code: "ENOENT" }));
    await rejection;
    expect(failed.unref).not.toHaveBeenCalled();
    const started = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockReturnValueOnce(started as unknown as ChildProcess);
    const success = profiles.revealFolder(saved.id);
    started.emit("spawn");
    await success;
    expect(started.unref).toHaveBeenCalledOnce();
    expect(started.listenerCount("error")).toBe(1);
    expect(() => started.emit("error", new Error("late file manager failure"))).not.toThrow();
  });
});

describe("backup zips", () => {
  it("are the same for the same folder, whatever order the file system lists it in", () => {
    const source = profiles.createProfile({ person: { name: "Order" } });
    for (const name of ["zeta.pdf", "alpha.pdf", "mid.pdf"]) profiles.addFile(source.id, name, pdf);
    const names = () => readZip(profiles.backupZip(source.id).data).map((entry) => entry.name);
    const listed = names();
    const original = fs.readdirSync;
    const spy = vi.spyOn(fs, "readdirSync").mockImplementation(((...args: Parameters<typeof original>) => [...(original(...args) as unknown[])].reverse()) as typeof original);
    try {
      expect(names()).toEqual(listed);
    } finally {
      spy.mockRestore();
    }
  });
});
