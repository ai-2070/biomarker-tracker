import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackup, parseBackup } from "../../src/core/backup";
import { dayNumber, todayIso } from "../../src/core/dates";
import type { Plan } from "../../src/core/plans";
import type { Meal } from "../../src/core/meals";
import { profilesInFolder } from "../../src/core/zipStore";
import { sortByDate } from "../../src/core/trends";
import { addMeasurement, addMeasurements, createHabit, getProfile, importBackup, saveMeal, savePlan, startPlan, stopPlan, TrackerDB, updateMeal, updatePlan } from "../../src/db/db";

let database: TrackerDB;
beforeEach(async () => { database = new TrackerDB(`integrity-${crypto.randomUUID()}`); await database.open(); });
afterEach(async () => { await database.delete(); vi.restoreAllMocks(); });
const measurement = { biomarkerId: "potassium", value: 4, originalValue: 4, originalUnit: "mmol/L", date: "2026-01-01", source: "manual" as const };
const plan: Plan = { id: "plan", name: "Walk", createdAt: "2026-01-01", items: [{ id: "item", label: "Walk", category: "lifestyle", when: "evening" }] };
const meal: Meal = { id: "meal", name: "Meal", createdAt: "2026-01-01", items: [{ foodId: "a", grams: 100 }, { foodId: "b", grams: 200 }] };

describe("review data-integrity repairs", () => {
  it("new same-day results take precedence regardless of random UUID order", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("ffffffff-ffff-4fff-8fff-ffffffffffff").mockReturnValueOnce("00000000-0000-4000-8000-000000000000");
    const first = await addMeasurement(measurement, database);
    const second = await addMeasurement({ ...measurement, value: 7, originalValue: 7 }, database);
    const rows = sortByDate(await database.measurements.toArray());
    expect(rows.map((m) => m.id)).toEqual([first, second]);
    expect(rows.at(-1)?.value).toBe(7);
  });

  it("concurrent batch and single inserts retain consumer-visible same-day precedence", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("ffffffff-ffff-4fff-8fff-ffffffffffff")
      .mockReturnValueOnce("88888888-8888-4888-8888-888888888888")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000000");
    await Promise.all([addMeasurements([measurement, { ...measurement, value: 5 }], database), addMeasurement({ ...measurement, value: 7 }, database)]);
    expect(sortByDate(await database.measurements.toArray()).map((m) => m.value)).toEqual([4, 5, 7]);
  });

  it("migrates legacy same-day rows without deleting their original values", async () => {
    const name = `legacy-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(6).stores({ measurements: "id, biomarkerId, date, [biomarkerId+date]", protocols: "id, start", settings: "key", experiments: "id, start", plans: "id", meals: "id" });
    await old.open();
    await old.table("measurements").bulkPut([{ ...measurement, id: "z", value: 7 }, { ...measurement, id: "a", value: 4 }]);
    old.close();
    const upgraded = new TrackerDB(name);
    try {
      await upgraded.open();
      await addMeasurement({ ...measurement, value: 8 }, upgraded);
      const rows = sortByDate(await upgraded.measurements.toArray());
      expect(rows.map((m) => m.value)).toEqual([4, 7, 8]);
    } finally { await upgraded.delete(); }
  });

  it("replace clears all previous person-owned data, retaining folder/browser ownership only", async () => {
    await saveMeal(meal, database);
    await savePlan(plan, database);
    await database.settings.bulkPut([{ key: "profile", value: { name: "A" } }, { key: "intakeList", value: [{ private: true }] }, { key: "chart:weight", value: { fit: true } }, { key: "loadedProfile", value: "folder-a" }, { key: "onboarded", value: true }]);
    await importBackup(createBackup({ profile: { name: "B" }, measurements: [], protocols: [], experiments: [] }, new Date()), "replace", database);
    expect(await getProfile(database)).toEqual({ name: "B" });
    expect(await database.plans.toArray()).toEqual([]);
    expect(await database.meals.toArray()).toEqual([]);
    expect(await database.settings.get("intakeList")).toBeUndefined();
    expect(await database.settings.get("chart:weight")).toBeUndefined();
    expect((await database.settings.get("loadedProfile"))?.value).toBe("folder-a");
    expect((await database.settings.get("onboarded"))?.value).toBe(true);
  });

  it("starting a stored protocol concurrently creates exactly one stoppable habit set", async () => {
    await savePlan(plan, database);
    await Promise.all([startPlan(plan, todayIso(), database), startPlan(plan, todayIso(), database)]);
    const active = (await database.plans.get(plan.id))!;
    const rows = await database.protocols.toArray();
    expect(rows.map((h) => h.id)).toEqual(active.active!.habitIds);
    expect(rows.map((h) => h.label)).toEqual(["Walk"]);
    await stopPlan(active, todayIso(), database);
    expect((await database.protocols.toArray()).map((h) => h.end)).toEqual([todayIso()]);
  });

  it("rejects protocol activation outside the shared planning boundary without creating habits", async () => {
    await savePlan(plan, database);
    const future = new Date((dayNumber(todayIso()) + 366) * 86_400_000).toISOString().slice(0, 10);
    await expect(startPlan(plan, future, database)).rejects.toThrow(/within the next year/);
    expect(await database.protocols.toArray()).toEqual([]);
    expect((await database.plans.get(plan.id))?.active).toBeUndefined();
  });

  it("watch write failure rolls back the habit, and retry creates only the requested pair", async () => {
    const fail = () => { throw new Error("QuotaExceededError"); };
    database.experiments.hook("creating", fail);
    const habit = { label: "Walk", category: "lifestyle" as const, start: "2026-01-01" };
    const watch = { markerIds: ["potassium"], retestAfterDays: 56, today: "2026-01-01" };
    await expect(createHabit(habit, watch, database)).rejects.toThrow("QuotaExceededError");
    expect(await database.protocols.toArray()).toEqual([]);
    expect(await database.experiments.toArray()).toEqual([]);
    database.experiments.hook("creating").unsubscribe(fail);
    const id = await createHabit(habit, watch, database);
    expect((await database.protocols.toArray()).map((h) => h.id)).toEqual([id]);
    expect((await database.experiments.toArray()).map((e) => ({ protocolId: e.protocolId, markerIds: e.markerIds }))).toEqual([{ protocolId: id, markerIds: ["potassium"] }]);
  });

  it("serializes meal field edits so a following deletion cannot revert grams", async () => {
    await saveMeal(meal, database);
    await Promise.all([
      updateMeal(meal.id, (m) => ({ ...m, items: m.items.map((it, i) => i === 0 ? { ...it, grams: 125 } : it) }), database),
      updateMeal(meal.id, (m) => ({ ...m, items: m.items.filter((it) => it.foodId !== "b") }), database),
    ]);
    expect((await database.meals.get(meal.id))?.items).toEqual([{ foodId: "a", grams: 125 }]);
  });

  it("serializes protocol field edits against its latest stored contents", async () => {
    await savePlan(plan, database);
    await Promise.all([
      updatePlan(plan.id, (p) => ({ ...p, name: "Evening walk" }), database),
      updatePlan(plan.id, (p) => ({ ...p, description: "Outside" }), database),
    ]);
    expect(await database.plans.get(plan.id)).toMatchObject({ name: "Evening walk", description: "Outside" });
  });

  it("refuses unsupported editor sizes before they can block folder sync", async () => {
    await saveMeal(meal, database);
    await savePlan(plan, database);
    await expect(saveMeal({ ...meal, items: Array.from({ length: 41 }, () => meal.items[0]!) }, database)).rejects.toThrow(/at most 40/);
    await expect(savePlan({ ...plan, items: Array.from({ length: 61 }, (_, i) => ({ ...plan.items[0]!, id: String(i) })) }, database)).rejects.toThrow(/at most 60/);
    expect((await database.meals.get(meal.id))?.items).toEqual(meal.items);
    expect((await database.plans.get(plan.id))?.items).toEqual(plan.items);
  });

  it("folder selection retains every supported person-owned JSON file", () => {
    const names = ["profile", "results", "log", "experiments", "protocols", "meals", "settings", "files"];
    expect(profilesInFolder(names.map((name) => ({ path: `person/${name}.json` })))[0]?.files.map((f) => f.name)).toEqual(names.map((name) => `person/${name}.json`));
  });

  it.each([0, -1, 6, 7.5, 731, 1e308])("rejects restored experiment interval %s before dashboard use", (interval) => {
    const backup = createBackup({ profile: {}, measurements: [], protocols: [], experiments: [{ id: "e", change: "Walk", category: "lifestyle", markerIds: ["potassium"], start: "2026-01-01", retestAfterDays: interval }] }, new Date());
    expect(parseBackup(backup)).toMatchObject({ ok: false, error: expect.stringMatching(/experiments.*damaged/) });
  });

  it.each(["measurements", "protocols", "experiments"] as const)("rejects duplicate identities within imported %s", (table) => {
    const backup = createBackup({ profile: {}, measurements: [{ ...measurement, id: "m" }], protocols: [{ id: "p", label: "Walk", category: "lifestyle", start: "2026-01-01" }], experiments: [{ id: "e", change: "Walk", category: "lifestyle", markerIds: ["potassium"], start: "2026-01-01", retestAfterDays: 56 }] }, new Date());
    const rows = backup[table];
    expect(parseBackup({ ...backup, [table]: [rows[0], rows[0]] })).toMatchObject({ ok: false, error: expect.stringMatching(/duplicate IDs/) });
    expect(parseBackup(backup).ok).toBe(true);
  });
});
