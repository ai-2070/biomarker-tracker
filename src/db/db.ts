import Dexie, { type EntityTable } from "dexie";
import { createBackup, type Backup } from "../core/backup";
import { syncWatch, watchFor } from "../core/habits";
import { habitsForPlan, type Plan } from "../core/plans";
import type { Meal } from "../core/meals";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "../core/types";

interface Setting {
  key: string;
  value: unknown;
}

export class TrackerDB extends Dexie {
  measurements!: EntityTable<Measurement, "id">;
  protocols!: EntityTable<ProtocolEntry, "id">;
  settings!: EntityTable<Setting, "key">;
  experiments!: EntityTable<Experiment, "id">;
  /** Protocols the person wrote (Protocols page); "protocols" above is the Habits log. */
  plans!: EntityTable<Plan, "id">;
  /** Meals the person built (foods and grams). */
  meals!: EntityTable<Meal, "id">;

  constructor(name = "biomarker-tracker") {
    super(name);
    this.version(1).stores({
      measurements: "id, biomarkerId, date, [biomarkerId+date]",
      protocols: "id, start",
      settings: "key",
    });
    // v2 (app v0.8): self-experiments.
    this.version(2).stores({ experiments: "id, start" });
    // v3: protocols (sets of supplements, foods, exercise… the person follows).
    this.version(3).stores({ plans: "id" });
    // v4: meals.
    this.version(4).stores({ meals: "id" });
  }
}

export const db = new TrackerDB();

export function newId(): string {
  return crypto.randomUUID();
}

// Protocols

export async function savePlan(p: Plan, database = db): Promise<void> {
  await database.plans.put(p);
}

export async function deletePlan(id: string, database = db): Promise<void> {
  await database.plans.delete(id);
}

/** Starts a protocol: each item becomes a habit from `start`, remembered so stopping can end them. */
export async function startPlan(p: Plan, start: string, database = db): Promise<void> {
  await database.transaction("rw", database.plans, database.protocols, async () => {
    const habitIds: string[] = [];
    for (const h of habitsForPlan(p, start)) {
      const id = newId();
      await database.protocols.add({ ...h, id });
      habitIds.push(id);
    }
    await database.plans.put({ ...p, active: { since: start, habitIds } });
  });
}

/** Stops a protocol: its habits end today (planned ones that hadn't started are removed). */
export async function stopPlan(p: Plan, today: string, database = db): Promise<void> {
  await database.transaction("rw", database.plans, database.protocols, database.experiments, async () => {
    for (const id of p.active?.habitIds ?? []) {
      const h = await database.protocols.get(id);
      if (!h || h.end) continue;
      if (h.start > today) {
        await database.protocols.delete(id);
        await database.experiments.filter((e) => e.protocolId === id).delete();
      } else {
        await database.protocols.put({ ...h, end: today });
        for (const e of await database.experiments.filter((x) => x.protocolId === id).toArray()) await database.experiments.put(syncWatch(e, { ...h, end: today }));
      }
    }
    const { active: _a, ...rest } = p;
    await database.plans.put(rest);
  });
}

// Meals

export async function saveMeal(m: Meal, database = db): Promise<void> {
  await database.meals.put(m);
}

export async function deleteMeal(id: string, database = db): Promise<void> {
  await database.meals.delete(id);
}

// Measurements

export async function addMeasurement(m: Omit<Measurement, "id">, database = db): Promise<string> {
  const id = newId();
  await database.measurements.add({ ...m, id });
  return id;
}

/** Save several results at once; all or nothing. */
export async function addMeasurements(ms: Omit<Measurement, "id">[], database = db): Promise<Measurement[]> {
  const rows = ms.map((m) => ({ ...m, id: newId() }));
  await database.measurements.bulkAdd(rows);
  return rows;
}

export async function deleteMeasurement(id: string, database = db): Promise<void> {
  await database.measurements.delete(id);
}

export async function measurementsFor(biomarkerId: string, database = db): Promise<Measurement[]> {
  return database.measurements.where("[biomarkerId+date]").between([biomarkerId, Dexie.minKey], [biomarkerId, Dexie.maxKey]).toArray();
}

// Protocol log (supplements, diet, medicines, lifestyle)

export async function addProtocol(p: Omit<ProtocolEntry, "id">, database = db): Promise<string> {
  const id = newId();
  await database.protocols.add({ ...p, id });
  return id;
}

/** Replace an entry. Uses put so that clearing `end` really removes it. */
export async function saveProtocol(p: ProtocolEntry, database = db): Promise<void> {
  await database.protocols.put(p);
}

// Experiments

/** Create an experiment and a matching log entry, so the change shows on charts. */
export async function createExperiment(e: Omit<Experiment, "id" | "protocolId">, database = db): Promise<string> {
  const id = newId();
  const protocolId = newId();
  await database.transaction("rw", database.experiments, database.protocols, async () => {
    await database.protocols.add({ id: protocolId, label: e.change, category: e.category, start: e.start });
    await database.experiments.add({ ...e, id, protocolId });
  });
  return id;
}

/** End an experiment, and its log entry if that is still open. */
export async function endExperiment(id: string, date: string, database = db): Promise<void> {
  await database.transaction("rw", database.experiments, database.protocols, async () => {
    const e = await database.experiments.get(id);
    if (!e) return;
    await database.experiments.put({ ...e, end: date });
    const p = e.protocolId ? await database.protocols.get(e.protocolId) : undefined;
    if (p && !p.end) await database.protocols.put({ ...p, end: date < p.start ? p.start : date });
  });
}

/** Delete an experiment. Its log entry and results are kept. */
export async function deleteExperiment(id: string, database = db): Promise<void> {
  await database.experiments.delete(id);
}

// Habits: a log entry and, optionally, the markers it watches (an experiment linked to it)

/** Start watching markers for a habit. Replaces an earlier watch of the same entry. */
export async function watchHabit(p: ProtocolEntry, markerIds: string[], retestAfterDays: number, today: string, database = db): Promise<string> {
  const id = newId();
  await database.transaction("rw", database.experiments, async () => {
    await database.experiments.filter((e) => e.protocolId === p.id).delete();
    await database.experiments.add({ ...watchFor(p, markerIds, retestAfterDays, today), id });
  });
  return id;
}

/** Save an edited habit; its watch keeps the same name and dates. */
export async function saveHabit(p: ProtocolEntry, database = db): Promise<void> {
  await database.transaction("rw", database.experiments, database.protocols, async () => {
    await database.protocols.put(p);
    const watches = await database.experiments.filter((e) => e.protocolId === p.id).toArray();
    for (const e of watches) await database.experiments.put(syncWatch(e, p));
  });
}

/** Delete a habit and what it watched. Test results are kept. */
export async function deleteHabit(h: { entry?: ProtocolEntry; watch?: Experiment }, database = db): Promise<void> {
  await database.transaction("rw", database.experiments, database.protocols, async () => {
    if (h.entry) {
      await database.protocols.delete(h.entry.id);
      await database.experiments.filter((e) => e.protocolId === h.entry!.id).delete();
    }
    if (h.watch) await database.experiments.delete(h.watch.id);
  });
}

export async function deleteProtocol(id: string, database = db): Promise<void> {
  await database.protocols.delete(id);
}

// Settings

const PROFILE_KEY = "profile";
const ONBOARDED_KEY = "onboarded";

export async function getProfile(database = db): Promise<Profile> {
  const row = await database.settings.get(PROFILE_KEY);
  return (row?.value as Profile | undefined) ?? {};
}

export async function setProfile(profile: Profile, database = db): Promise<void> {
  await database.settings.put({ key: PROFILE_KEY, value: profile });
}

/**
 * Before v0.9 an API key could be saved in the browser. Keys now live only in the
 * local server's secrets file, so remove any old copy from the browser.
 */
export async function forgetBrowserAiKey(database = db): Promise<void> {
  await database.settings.delete("ai");
}

export async function isOnboarded(database = db): Promise<boolean> {
  return (await database.settings.get(ONBOARDED_KEY))?.value === true;
}

export async function setOnboarded(database = db): Promise<void> {
  await database.settings.put({ key: ONBOARDED_KEY, value: true });
}

// Backup

export async function exportAll(now: Date, database = db): Promise<Backup> {
  const [measurements, protocols, experiments, profile] = await Promise.all([
    database.measurements.toArray(),
    database.protocols.toArray(),
    database.experiments.toArray(),
    getProfile(database),
  ]);
  return createBackup({ measurements, protocols, experiments, profile }, now);
}

export type ImportMode = "merge" | "replace";

/**
 * Restore a validated backup.
 * "merge" keeps existing data and adds or updates entries from the file.
 * "replace" deletes everything first.
 */
export async function importBackup(backup: Backup, mode: ImportMode, database = db): Promise<void> {
  await database.transaction("rw", [database.measurements, database.protocols, database.experiments, database.settings], async () => {
    if (mode === "replace") {
      await database.measurements.clear();
      await database.protocols.clear();
      await database.experiments.clear();
      await database.measurements.bulkPut(backup.measurements);
      await database.protocols.bulkPut(backup.protocols);
      await database.experiments.bulkPut(backup.experiments);
      await setProfile(backup.profile, database);
      return;
    }
    // bulkPut replaces rows with the same id and keeps all others.
    await database.measurements.bulkPut(backup.measurements);
    await database.protocols.bulkPut(backup.protocols);
    await database.experiments.bulkPut(backup.experiments);
    const profile = await getProfile(database);
    await setProfile({ ...backup.profile, ...profile }, database);
  });
}

export async function deleteEverything(database = db): Promise<void> {
  await database.transaction("rw", [database.measurements, database.protocols, database.experiments, database.plans, database.meals, database.settings], async () => {
    await database.measurements.clear();
    await database.protocols.clear();
    await database.experiments.clear();
    await database.plans.clear();
    await database.meals.clear();
    await database.settings.clear();
  });
}
