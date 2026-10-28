import Dexie, { type EntityTable } from "dexie";
import { createBackup, type Backup } from "../core/backup";
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

  constructor(name = "biomarker-tracker") {
    super(name);
    this.version(1).stores({
      measurements: "id, biomarkerId, date, [biomarkerId+date]",
      protocols: "id, start",
      settings: "key",
    });
    // v2 (app v0.8): self-experiments.
    this.version(2).stores({ experiments: "id, start" });
  }
}

export const db = new TrackerDB();

export function newId(): string {
  return crypto.randomUUID();
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
  await database.transaction("rw", [database.measurements, database.protocols, database.experiments, database.settings], async () => {
    await database.measurements.clear();
    await database.protocols.clear();
    await database.experiments.clear();
    await database.settings.clear();
  });
}
