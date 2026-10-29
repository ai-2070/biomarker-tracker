import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBackup } from "../../src/core/backup";
import {
  addMeasurement,
  addProtocol,
  createExperiment,
  deleteHabit,
  saveHabit,
  watchHabit,
  endExperiment,
  deleteProtocol,
  saveProtocol,
  deleteEverything,
  exportAll,
  forgetBrowserAiKey,
  getProfile,
  importBackup,
  measurementsFor,
  setProfile,
  TrackerDB,
  savePlan,
  startPlan,
  stopPlan,
} from "../../src/db/db";

let db: TrackerDB;
let n = 0;

beforeEach(async () => {
  n += 1;
  db = new TrackerDB(`test-${n}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const sample = { biomarkerId: "ferritin", value: 40, originalValue: 40, originalUnit: "µg/L", date: "2024-01-01", source: "manual" as const };

describe("db", () => {
  it("removes an API key saved in the browser by older versions, and nothing else", async () => {
    await db.settings.put({ key: "ai", value: { provider: "anthropic", apiKey: "sk-old" } });
    await setProfile({ sex: "f" }, db);
    await forgetBrowserAiKey(db);
    expect(await db.settings.get("ai")).toBeUndefined();
    expect((await getProfile(db)).sex).toBe("f");
  });

  it("stores and queries measurements per biomarker, sorted by date", async () => {
    await addMeasurement({ ...sample, date: "2024-06-01" }, db);
    await addMeasurement({ ...sample, date: "2023-06-01" }, db);
    await addMeasurement({ ...sample, biomarkerId: "b12" }, db);
    const ferritin = await measurementsFor("ferritin", db);
    expect(ferritin.map((m) => m.date)).toEqual(["2023-06-01", "2024-06-01"]);
  });

  it("exports a backup that passes validation and restores it", async () => {
    await addMeasurement(sample, db);
    await setProfile({ sex: "f" }, db);
    const json = JSON.parse(JSON.stringify(await exportAll(new Date(), db)));
    const parsed = parseBackup(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    await deleteEverything(db);
    expect(await db.measurements.count()).toBe(0);
    expect(await getProfile(db)).toEqual({});

    await importBackup(parsed.backup, "replace", db);
    expect(await db.measurements.count()).toBe(1);
    expect(await getProfile(db)).toEqual({ sex: "f" });
  });

  it("merge keeps existing data and does not duplicate", async () => {
    const id = await addMeasurement(sample, db);
    const backup = await exportAll(new Date(), db);
    await addMeasurement({ ...sample, date: "2024-02-01" }, db);
    await importBackup(backup, "merge", db);
    expect(await db.measurements.count()).toBe(2);
    expect(await db.measurements.get(id)).toBeDefined();
  });

  it("merge keeps the current profile", async () => {
    await setProfile({ sex: "m" }, db);
    const backup = await exportAll(new Date(), db);
    await setProfile({ sex: "f" }, db);
    await importBackup(backup, "merge", db);
    expect(await getProfile(db)).toEqual({ sex: "f" });
  });

  it("adds, ends, reopens and deletes a log entry", async () => {
    const id = await addProtocol({ label: "Iron 30 mg", category: "supplement", start: "2024-01-01" }, db);
    await saveProtocol({ id, label: "Iron 30 mg", category: "supplement", start: "2024-01-01", end: "2024-03-01" }, db);
    expect((await db.protocols.get(id))?.end).toBe("2024-03-01");
    await saveProtocol({ id, label: "Iron 30 mg", category: "supplement", start: "2024-01-01" }, db);
    expect((await db.protocols.get(id))?.end).toBeUndefined();
    await deleteProtocol(id, db);
    expect(await db.protocols.count()).toBe(0);
  });

  it("creates an experiment with a linked log entry, and ends both", async () => {
    const id = await createExperiment({ change: "2 kiwis a day", category: "diet", markerIds: ["ferritin"], start: "2024-03-01", retestAfterDays: 56 }, db);
    const e = (await db.experiments.get(id))!;
    const p = (await db.protocols.get(e.protocolId!))!;
    expect(p).toMatchObject({ label: "2 kiwis a day", category: "diet", start: "2024-03-01" });
    await endExperiment(id, "2024-05-01", db);
    expect((await db.experiments.get(id))!.end).toBe("2024-05-01");
    expect((await db.protocols.get(e.protocolId!))!.end).toBe("2024-05-01");
  });

  it("starts a protocol as habits and stops it again", async () => {
    const plan = {
      id: "p1",
      name: "Stack",
      createdAt: "2026-10-01T00:00:00.000Z",
      items: [
        { id: "a", label: "Vitamin D3", amount: "1000 IU", category: "supplement" as const, when: "morning" as const },
        { id: "b", label: "Walk", category: "lifestyle" as const, when: "evening" as const },
      ],
    };
    await savePlan(plan, db);
    await startPlan(plan, "2026-10-10", db);
    const started = (await db.plans.get("p1"))!;
    expect(started.active?.since).toBe("2026-10-10");
    expect((await db.protocols.toArray()).map((h) => h.label).sort()).toEqual(["Vitamin D3 1000 IU", "Walk"]);
    await watchHabit((await db.protocols.get(started.active!.habitIds[0]!))!, ["vitamin_d"], 56, "2026-10-10", db);
    await stopPlan(started, "2026-10-29", db);
    expect((await db.protocols.toArray()).every((h) => h.end === "2026-10-29")).toBe(true);
    expect((await db.experiments.toArray())[0]!.end).toBe("2026-10-29");
    expect((await db.plans.get("p1"))!.active).toBeUndefined();
    // A protocol planned for later and stopped before it began leaves no habits behind.
    await startPlan(plan, "2026-12-01", db);
    await stopPlan((await db.plans.get("p1"))!, "2026-10-29", db);
    expect(await db.protocols.count()).toBe(2);
  });

  it("watches markers for a habit and keeps the watch in step with it", async () => {
    const pid = await addProtocol({ label: "Vitamin D3 1000 IU", category: "supplement", start: "2024-01-10" }, db);
    const p = (await db.protocols.get(pid))!;
    await watchHabit(p, ["vitamin_d"], 56, "2026-10-28", db);
    const second = await watchHabit(p, ["vitamin_d", "ferritin"], 84, "2026-10-28", db);
    expect(await db.experiments.count()).toBe(1);
    expect((await db.experiments.get(second))!).toMatchObject({ protocolId: pid, change: "Vitamin D3 1000 IU", markerIds: ["vitamin_d", "ferritin"], chosenOn: "2026-10-28" });
    await saveHabit({ ...p, label: "Vitamin D3 2000 IU", end: "2024-06-01" }, db);
    expect((await db.experiments.get(second))!).toMatchObject({ change: "Vitamin D3 2000 IU", end: "2024-06-01" });
    await deleteHabit({ entry: (await db.protocols.get(pid))! }, db);
    expect(await db.protocols.count()).toBe(0);
    expect(await db.experiments.count()).toBe(0);
  });

  it("includes experiments in backups and restores them", async () => {
    await createExperiment({ change: "x", category: "diet", markerIds: ["ferritin"], start: "2024-03-01", retestAfterDays: 28 }, db);
    const parsed = parseBackup(JSON.parse(JSON.stringify(await exportAll(new Date(), db))));
    expect(parsed.ok && parsed.backup.experiments.length).toBe(1);
    await deleteEverything(db);
    expect(await db.experiments.count()).toBe(0);
    if (parsed.ok) await importBackup(parsed.backup, "replace", db);
    expect(await db.experiments.count()).toBe(1);
  });

  it("replace removes data that is not in the backup", async () => {
    const backup = await exportAll(new Date(), db);
    await addMeasurement(sample, db);
    await importBackup(backup, "replace", db);
    expect(await db.measurements.count()).toBe(0);
  });
});
