import { describe, expect, it } from "vitest";
import { BACKUP_VERSION, createBackup, parseBackup } from "@bt/shared/core/backup";
import { isIsoDate, daysBetween, todayIso } from "@bt/shared/core/dates";
import { MAX_ITEMS } from "@bt/shared/core/plans";
import type { ProtocolEntry } from "@bt/shared/core/types";
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
  const routine: ProtocolEntry = {
    id: "routine", label: "Daily routine", category: "lifestyle", start: "2024-01-01",
    plan: {
      id: "source",
      items: [{
        id: "item", label: "Oats", amount: "50 g", category: "diet", when: "morning",
        withFood: true, days: ["mon", "wed", "fri"], note: "My breakfast", mealId: "saved-meal",
      }],
    },
  };

  it("round-trips through JSON", () => {
    const r = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(r).toEqual({ ok: true, backup });
  });

  it("round-trips source-local sleep windows, naps and supplied offsets without filling missing offsets", () => {
    const sleep = measurement({
      biomarkerId: "sleep_duration", date: "2026-10-25", value: 8, originalUnit: "h", source: "device",
      sleepSessions: [
        { start: "2026-10-24T23:15:00.125", end: "2026-10-25T07:30:00", kind: "asleep", source: "Synthetic watch", startOffsetMinutes: 120, endOffsetMinutes: 60 },
        { start: "2026-10-25T14:00:00", end: "2026-10-25T14:45:00", kind: "in-bed", source: "Synthetic watch" },
      ],
    });
    const data = createBackup({ ...backup, measurements: [sleep] }, new Date("2026-11-01T12:00:00Z"));
    const parsed = parseBackup(JSON.parse(JSON.stringify(data)));
    expect(parsed).toEqual({ ok: true, backup: data });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.backup.measurements[0]!.sleepSessions![1]).not.toHaveProperty("startOffsetMinutes");
    expect(parsed.backup.measurements[0]!.sleepSessions![1]).not.toHaveProperty("endOffsetMinutes");
    expect(parsed.backup.measurements[0]!.sleepSessions![0]!.start).toBe("2026-10-24T23:15:00.125");
  });

  it("rejects damaged or misplaced sleep timing instead of retaining unchecked nested arrays", () => {
    const session = { start: "2026-10-24T23:00:00", end: "2026-10-25T07:00:00", kind: "asleep" };
    const sleep = { ...m, biomarkerId: "sleep_duration", date: "2026-10-25", qualifier: undefined };
    const damaged: unknown[] = [
      null, {}, [], [null], new Array(1), Array(65).fill(session),
      [{ ...session, start: "2026-10-24T23:00:00Z" }], [{ ...session, end: "2026-10-26T07:00:00" }],
      [{ ...session, kind: ["asleep"] }], [{ ...session, endOffsetMinutes: "60" }],
    ];
    for (const sleepSessions of damaged) {
      expect(parseBackup({ ...backup, measurements: [m, { ...sleep, sleepSessions }] })).toMatchObject({
        ok: false, error: expect.stringMatching(/number 2.*damaged/),
      });
    }
    for (const biomarkerId of ["sleep_deep", "sleep_rem", "resting_hr"]) {
      expect(parseBackup({ ...backup, measurements: [{ ...sleep, biomarkerId, sleepSessions: [session] }] }).ok).toBe(false);
    }
    expect(parseBackup({ ...backup, measurements: [sleep] }).ok).toBe(true);
  });

  it("round-trips a started protocol snapshot with all item metadata without a live source protocol", () => {
    const grouped = createBackup({ ...backup, protocols: [routine] }, new Date("2024-05-01T10:00:00Z"));
    const parsed = parseBackup(JSON.parse(JSON.stringify(grouped)));
    expect(parsed).toEqual({ ok: true, backup: grouped });
    expect(parsed.ok && parsed.backup.protocols[0]!.plan).toEqual(routine.plan);
  });

  it("rejects damaged protocol snapshots using the source protocol's item rules", () => {
    const plan = routine.plan!;
    const item = plan.items[0]!;
    const damaged: unknown[] = [
      null, [], "source", {}, { ...plan, id: "" }, { ...plan, id: 3 }, { ...plan, items: null },
      { ...plan, items: [null] }, { ...plan, items: [{ ...item, id: "" }] }, { ...plan, items: [{ ...item, label: "" }] },
      { ...plan, items: [{ ...item, category: "medicine" }] }, { ...plan, items: [{ ...item, when: "lunch" }] },
      { ...plan, items: [{ ...item, amount: "x".repeat(41) }] }, { ...plan, items: [{ ...item, withFood: "yes" }] },
      { ...plan, items: [{ ...item, days: ["mon", "mon"] }] }, { ...plan, items: [{ ...item, days: ["someday"] }] },
      { ...plan, items: [{ ...item, note: "x".repeat(301) }] }, { ...plan, items: [{ ...item, mealId: 3 }] },
      { ...plan, items: Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({ ...item, id: `item-${i}` })) },
    ];
    for (const snapshot of damaged) {
      expect(parseBackup({ ...backup, protocols: [{ ...routine, plan: snapshot }] }).ok, JSON.stringify(snapshot)).toBe(false);
    }
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
