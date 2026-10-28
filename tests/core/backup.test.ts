import { describe, expect, it } from "vitest";
import { BACKUP_VERSION, createBackup, parseBackup } from "../../src/core/backup";
import { isIsoDate, daysBetween, todayIso } from "../../src/core/dates";
import { measurement } from "../helpers";

describe("backup", () => {
  const m = measurement({ date: "2024-03-01", value: 42, labRange: { low: 15 }, qualifier: "<" });
  const backup = createBackup(
    {
      profile: { sex: "f" },
      measurements: [m],
      protocols: [{ id: "p1", label: "Iron 30 mg", category: "supplement", start: "2024-01-01" }],
      experiments: [{ id: "e1", change: "Iron 30 mg", category: "supplement", markerIds: ["ferritin"], start: "2024-01-01", retestAfterDays: 56, protocolId: "p1" }],
    },
    new Date("2024-05-01T10:00:00Z"),
  );

  it("round-trips through JSON", () => {
    const r = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(r).toEqual({ ok: true, backup });
  });

  it("stamps app name, version and export time", () => {
    expect(backup.app).toBe("biomarker-tracker");
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.exportedAt).toBe("2024-05-01T10:00:00.000Z");
  });

  it("rejects files from other apps", () => {
    expect(parseBackup({ app: "other" }).ok).toBe(false);
    expect(parseBackup(null).ok).toBe(false);
    expect(parseBackup([]).ok).toBe(false);
  });

  it("rejects backups from a newer version", () => {
    const r = parseBackup({ ...backup, version: BACKUP_VERSION + 1 });
    expect(!r.ok && r.error).toMatch(/newer version/);
  });

  it("points at the damaged measurement", () => {
    const r = parseBackup({ ...backup, measurements: [m, { ...m, value: "42" }] });
    expect(!r.ok && r.error).toMatch(/number 2/);
  });

  it("rejects invalid dates, sources and qualifiers", () => {
    for (const bad of [{ date: "2024-02-30" }, { source: "email" }, { qualifier: "~" }]) {
      expect(parseBackup({ ...backup, measurements: [{ ...m, ...bad }] }).ok).toBe(false);
    }
  });

  it("rejects damaged protocols and profiles", () => {
    expect(parseBackup({ ...backup, protocols: [{ id: "p", label: "x", category: "magic", start: "2024-01-01" }] }).ok).toBe(false);
    expect(parseBackup({ ...backup, profile: { sex: "x" } }).ok).toBe(false);
  });

  it("drops unknown profile fields", () => {
    const r = parseBackup({ ...backup, profile: { sex: "m", passport: "X123" } });
    expect(r.ok && r.backup.profile).toEqual({ sex: "m" });
  });

  it("keeps a valid birth month and rejects an invalid one", () => {
    const r = parseBackup({ ...backup, profile: { birthMonth: "1985-07" } });
    expect(r.ok && r.backup.profile).toEqual({ birthMonth: "1985-07" });
    expect(parseBackup({ ...backup, profile: { birthMonth: "1985-07-03" } }).ok).toBe(false);
  });

  it("still reads version 1 backups, which have no experiments", () => {
    const r = parseBackup({ app: "biomarker-tracker", version: 1, measurements: [m] });
    expect(r.ok && r.backup.experiments).toEqual([]);
  });

  it("rejects damaged experiments", () => {
    expect(parseBackup({ ...backup, experiments: [{ id: "e", change: "x" }] }).ok).toBe(false);
  });

  it("allows missing protocols and profile", () => {
    const r = parseBackup({ app: "biomarker-tracker", version: 1, measurements: [] });
    expect(r.ok && r.backup.protocols).toEqual([]);
    expect(r.ok && r.backup.profile).toEqual({});
  });
});

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2024-2-1")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
  it("counts days between dates across DST changes", () => {
    expect(daysBetween("2024-03-01", "2024-04-01")).toBe(31);
    expect(daysBetween("2024-10-20", "2024-11-03")).toBe(14);
  });
  it("formats today's local date", () => {
    expect(todayIso(new Date(2024, 0, 5, 23, 30))).toBe("2024-01-05");
  });
});
