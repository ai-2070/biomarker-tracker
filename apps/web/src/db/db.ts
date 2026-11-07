import { type Backup, createBackup } from "@bt/shared/core/backup";
import { todayIso } from "@bt/shared/core/dates";
import { exampleSleepUpdates } from "@bt/shared/core/demo";
import { syncWatch, watchFor } from "@bt/shared/core/habits";
import { LIFE_TABLE_COUNTRIES } from "@bt/shared/core/lifeTable";
import { type Meal, validateMeal } from "@bt/shared/core/meals";
import { measurementsIn } from "@bt/shared/core/measurementCompletion";
import { isBirthMonth } from "@bt/shared/core/phenoageDraws";
import { habitForPlan, type Plan, validatePlan } from "@bt/shared/core/plans";
import { completeProfileDetails, type ProfileCompletion } from "@bt/shared/core/profileCompletion";
import { validateProtocol } from "@bt/shared/core/protocols";
import { validSleepSessions } from "@bt/shared/core/sleepSessions";
import type { BiomarkerDef, Experiment, Measurement, Profile, ProtocolEntry } from "@bt/shared/core/types";
import Dexie, { type EntityTable } from "dexie";

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
    // v5 had a table of logged days for Daily intake; v6 drops it (the analyzer keeps one list in settings).
    this.version(5).stores({ intake: "id, date" });
    this.version(6).stores({ intake: null });
    // v7: save order, not random UUID order, breaks ties on the same sample date.
    this.version(7)
      .stores({ measurements: "id, biomarkerId, date, [biomarkerId+date], savedOrder" })
      .upgrade(async (tx) => {
        const rows = await tx.table<Measurement>("measurements").toArray();
        let order = rows.reduce((max, m) => Math.max(max, m.savedOrder ?? 0), 0);
        for (const row of rows) if (row.savedOrder === undefined) row.savedOrder = ++order;
        await tx.table<Measurement>("measurements").bulkPut(rows);
      });
  }
}

export const db = new TrackerDB();

export function newId(): string {
  return crypto.randomUUID();
}

// Protocols

export async function savePlan(p: Plan, database = db): Promise<void> {
  const errors = validatePlan(p);
  if (errors.length) throw new Error(errors[0]);
  await database.plans.put(p);
}

/** Apply a field edit to the latest stored protocol, not a stale React snapshot. */
export async function updatePlan(id: string, change: (current: Plan) => Plan, database = db): Promise<void> {
  await database.transaction("rw", database.plans, async () => {
    const current = await database.plans.get(id);
    if (!current) throw new Error("This protocol no longer exists.");
    const next = change(current);
    if (next.id !== id) throw new Error("A protocol edit cannot change its identity.");
    await savePlan(next, database);
  });
}

export async function deletePlan(id: string, database = db): Promise<void> {
  await database.plans.delete(id);
}

/** Starts the whole protocol as one habit; repeated starts of an active protocol do nothing. */
export async function startPlan(p: Plan, start: string, database = db): Promise<void> {
  await database.transaction("rw", database.plans, database.protocols, async () => {
    const current = await database.plans.get(p.id);
    if (!current) throw new Error("This protocol no longer exists.");
    if (current.active) return;
    const errors = validatePlan(current);
    if (errors.length) throw new Error(errors[0]);
    const habit = habitForPlan(current, start);
    const checked = validateProtocol(habit, todayIso());
    if (!checked.ok) throw new Error(Object.values(checked.errors)[0]);
    const id = newId();
    await database.protocols.add({ ...habit, id });
    await database.plans.put({ ...current, active: { since: start, habitIds: [id] } });
  });
}

/** Stops a protocol: its habits end today (planned ones that hadn't started are removed). */
export async function stopPlan(p: Plan, today: string, database = db): Promise<void> {
  await database.transaction("rw", database.plans, database.protocols, database.experiments, async () => {
    const current = (await database.plans.get(p.id)) ?? p;
    for (const id of current.active?.habitIds ?? []) {
      const h = await database.protocols.get(id);
      if (!h || h.end) continue;
      if (h.start > today) {
        await database.protocols.delete(id);
        await database.experiments.filter((e) => e.protocolId === id).delete();
      } else {
        await database.protocols.put({ ...h, end: today });
        for (const e of await database.experiments.filter((x) => x.protocolId === id).toArray())
          await database.experiments.put(syncWatch(e, { ...h, end: today }));
      }
    }
    const { active: _a, ...rest } = current;
    await database.plans.put(rest);
  });
}

// Meals

export async function saveMeal(m: Meal, database = db): Promise<void> {
  const errors = validateMeal(m);
  if (errors.length) throw new Error(errors[0]);
  await database.meals.put(m);
}

/** Serialize edits against the latest meal so blur/delete cannot revert another edit. */
export async function updateMeal(id: string, change: (current: Meal) => Meal, database = db): Promise<void> {
  await database.transaction("rw", database.meals, async () => {
    const current = await database.meals.get(id);
    if (!current) throw new Error("This meal no longer exists.");
    const next = change(current);
    if (next.id !== id) throw new Error("A meal edit cannot change its identity.");
    await saveMeal(next, database);
  });
}

export async function deleteMeal(id: string, database = db): Promise<void> {
  await database.meals.delete(id);
}

// Measurements

/** One-time fictional-example upgrade; never synthesizes data for a real profile or imported rows. */
export async function ensureExampleSleepData(database = db): Promise<number> {
  return database.transaction("rw", database.settings, database.measurements, async () => {
    const key = "exampleSleepDataVersion";
    if ((await database.settings.get(key))?.value === 1) return 0;
    const profile = await getProfile(database);
    if (profile.example !== true) return 0;
    const current = await database.measurements.toArray();
    const updates = exampleSleepUpdates(profile, current);
    const ids = new Set(current.map((m) => m.id));
    let order = (await database.measurements.orderBy("savedOrder").last())?.savedOrder ?? 0;
    for (const m of updates) if (!ids.has(m.id)) m.savedOrder = ++order;
    if (updates.length) await database.measurements.bulkPut(updates);
    await database.settings.put({ key, value: 1 });
    return updates.length;
  });
}

function checkSleepSessions(m: Pick<Measurement, "biomarkerId" | "date" | "sleepSessions">): void {
  if (m.sleepSessions !== undefined && !validSleepSessions(m.sleepSessions, m.biomarkerId, m.date))
    throw new Error("This result has damaged or mismatched sleep timing.");
}

export async function addMeasurement(m: Omit<Measurement, "id">, database = db): Promise<string> {
  const [row] = await addMeasurements([m], database);
  return row!.id;
}

/** Save several results at once; all or nothing. */
export async function addMeasurements(ms: Omit<Measurement, "id">[], database = db): Promise<Measurement[]> {
  ms.forEach(checkSleepSessions);
  return database.transaction("rw", database.measurements, async () => {
    let order = (await database.measurements.orderBy("savedOrder").last())?.savedOrder ?? 0;
    const rows = ms.map((m) => ({ ...m, id: newId(), savedOrder: ++order }));
    await database.measurements.bulkAdd(rows);
    return rows;
  });
}

/** Replace editable fields while preserving the latest stored identity and provenance. */
export async function updateMeasurement(id: string, measurement: Omit<Measurement, "id" | "source" | "savedOrder">, database = db): Promise<void> {
  await database.transaction("rw", database.measurements, async () => {
    const current = await database.measurements.get(id);
    if (!current) throw new Error("This result no longer exists.");
    // Timing describes the imported reading, not an independently editable diary entry.
    const { sleepSessions: submittedTiming, ...editable } = measurement;
    const storedTiming = validSleepSessions(current.sleepSessions, current.biomarkerId, current.date) ? current.sleepSessions : undefined;
    if (
      submittedTiming !== undefined &&
      (!validSleepSessions(submittedTiming, current.biomarkerId, current.date) ||
        !storedTiming ||
        submittedTiming.length !== storedTiming.length ||
        !submittedTiming.every((session, index) => {
          const stored = storedTiming[index]!;
          return (
            session.start === stored.start &&
            session.end === stored.end &&
            session.kind === stored.kind &&
            session.source === stored.source &&
            session.startOffsetMinutes === stored.startOffsetMinutes &&
            session.endOffsetMinutes === stored.endOffsetMinutes
          );
        }))
    )
      throw new Error("Sleep timing can only be changed by importing device data.");
    const sameReading =
      current.biomarkerId === measurement.biomarkerId &&
      current.date === measurement.date &&
      current.value === measurement.value &&
      current.qualifier === measurement.qualifier;
    const sleepSessions = sameReading ? storedTiming : undefined;
    await database.measurements.put({
      ...editable,
      ...(sleepSessions ? { sleepSessions } : {}),
      id: current.id,
      source: current.source,
      savedOrder: current.savedOrder,
    });
  });
}

/** Delete only the selected saved results, all or nothing, counting existing rows once. */
export async function deleteMeasurements(ids: readonly string[], database = db): Promise<number> {
  const selected = [...new Set(ids)];
  if (selected.length === 0) return 0;
  return database.transaction("rw", database.measurements, async () => {
    const existing = await database.measurements.bulkGet(selected);
    const count = existing.filter((row) => row !== undefined).length;
    await database.measurements.bulkDelete(selected);
    return count;
  });
}

/** A reviewed device import replaces each measurement/day; the first overlapping series wins. */
export async function saveDeviceMeasurements(ms: Omit<Measurement, "id" | "source">[], database = db): Promise<{ added: number; updated: number }> {
  const incoming = new Map<string, Omit<Measurement, "id" | "source">>();
  for (const m of ms) {
    checkSleepSessions(m);
    const key = `${m.biomarkerId}|${m.date}`;
    if (!incoming.has(key)) incoming.set(key, m);
  }
  return database.transaction("rw", database.measurements, async () => {
    const existing = await database.measurements
      .where("[biomarkerId+date]")
      .anyOf([...incoming.values()].map((m) => [m.biomarkerId, m.date]))
      .toArray();
    const matchesByDay = new Map<string, Measurement[]>();
    for (const m of existing) {
      const key = `${m.biomarkerId}|${m.date}`;
      const matches = matchesByDay.get(key) ?? [];
      matches.push(m);
      matchesByDay.set(key, matches);
    }
    const rows: Measurement[] = [];
    let order = (await database.measurements.orderBy("savedOrder").last())?.savedOrder ?? 0;
    let added = 0;
    let updated = 0;
    for (const [key, m] of incoming) {
      const matches = matchesByDay.get(key);
      if (matches) {
        for (const previous of matches) rows.push({ ...m, source: "device", id: previous.id, savedOrder: previous.savedOrder ?? ++order });
        updated++;
      } else {
        rows.push({ ...m, source: "device", id: newId(), savedOrder: ++order });
        added++;
      }
    }
    await database.measurements.bulkPut(rows);
    return { added, updated };
  });
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

/** A habit and its initial watch are one operation, including on quota/write failure. */
export async function createHabit(
  p: Omit<ProtocolEntry, "id">,
  watch?: { markerIds: string[]; retestAfterDays: number; today: string },
  database = db,
): Promise<string> {
  return database.transaction("rw", database.protocols, database.experiments, async () => {
    const id = await addProtocol(p, database);
    if (watch) await watchHabit({ ...p, id }, watch.markerIds, watch.retestAfterDays, watch.today, database);
    return id;
  });
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
  await database.transaction("rw", database.experiments, database.protocols, database.plans, async () => {
    const e = await database.experiments.get(id);
    if (!e) return;
    await database.experiments.put({ ...e, end: date });
    const p = e.protocolId ? await database.protocols.get(e.protocolId) : undefined;
    if (p && !p.end) {
      const ended = { ...p, end: date < p.start ? p.start : date };
      await database.protocols.put(ended);
      await syncSourcePlanHabit(ended, database);
    }
  });
}

/** Delete an experiment. Its log entry and results are kept. */
export async function deleteExperiment(id: string, database = db): Promise<void> {
  await database.experiments.delete(id);
}

// Habits: a log entry and, optionally, the markers it watches (an experiment linked to it)

/** Keep a grouped habit's source protocol in step, without changing its saved item snapshot. */
async function syncSourcePlanHabit(p: ProtocolEntry, database: TrackerDB, removed = false): Promise<void> {
  if (!p.plan) return;
  const plan = await database.plans.get(p.plan.id);
  if (!plan || (plan.active && !plan.active.habitIds.includes(p.id))) return;
  if (removed || p.end) {
    if (plan.active) {
      const { active: _active, ...rest } = plan;
      await database.plans.put(rest);
    }
  } else {
    await database.plans.put({ ...plan, active: { since: p.start, habitIds: [p.id] } });
  }
}

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
  await database.transaction("rw", database.experiments, database.protocols, database.plans, async () => {
    await database.protocols.put(p);
    const watches = await database.experiments.filter((e) => e.protocolId === p.id).toArray();
    for (const e of watches) await database.experiments.put(syncWatch(e, p));
    await syncSourcePlanHabit(p, database);
  });
}

/** Delete a habit and what it watched. Test results are kept. */
export async function deleteHabit(h: { entry?: ProtocolEntry; watch?: Experiment }, database = db): Promise<void> {
  await database.transaction("rw", database.experiments, database.protocols, database.plans, async () => {
    if (h.entry) {
      await database.protocols.delete(h.entry.id);
      await database.experiments.filter((e) => e.protocolId === h.entry!.id).delete();
      await syncSourcePlanHabit(h.entry, database, true);
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
/** The folder represented by the browser's working copy; not part of profile exports. */
export const LOADED_PROFILE_KEY = "loadedProfile";

export interface ProfileWriteIdentity {
  id: string | null;
  /** Used only to distinguish replacements in browser-only mode; never sent to the model. */
  name?: string;
}

export interface ProfileFillResult extends ProfileCompletion {
  sameProfile: boolean;
  measurementsAdded: Measurement[];
}

export async function getProfile(database = db): Promise<Profile> {
  const row = await database.settings.get(PROFILE_KEY);
  return (row?.value as Profile | undefined) ?? {};
}

export async function setProfile(profile: Profile, database = db): Promise<void> {
  await database.settings.put({ key: PROFILE_KEY, value: profile });
}

/** Fill the missing birth month without replacing another profile or concurrent profile edits. */
export async function saveBirthMonth(birthMonth: string, identity: ProfileWriteIdentity, today = todayIso(), database = db): Promise<boolean> {
  if (!isBirthMonth(birthMonth) || birthMonth > today.slice(0, 7)) throw new Error("Enter a valid month and year of birth, not in the future.");
  return database.transaction("rw", database.settings, async () => {
    const loaded = (await database.settings.get(LOADED_PROFILE_KEY))?.value;
    const id = typeof loaded === "string" ? loaded : null;
    const current = await getProfile(database);
    if (id !== identity.id || (id === null && current.name !== identity.name) || current.birthMonth) return false;
    await setProfile({ ...current, birthMonth }, database);
    return true;
  });
}

/** Fill a missing country, preserving concurrent edits and refusing a switched profile. */
export async function saveCountry(country: string, identity: ProfileWriteIdentity, database = db): Promise<boolean> {
  if (!Object.hasOwn(LIFE_TABLE_COUNTRIES, country)) throw new Error("Choose a supported country.");
  return database.transaction("rw", database.settings, async () => {
    const loaded = (await database.settings.get(LOADED_PROFILE_KEY))?.value;
    const id = typeof loaded === "string" ? loaded : null;
    const current = await getProfile(database);
    if (id !== identity.id || (id === null && current.name !== identity.name) || (current.country && Object.hasOwn(LIFE_TABLE_COUNTRIES, current.country)))
      return false;
    await setProfile({ ...current, country }, database);
    return true;
  });
}

/** Apply validated quotes to the same profile, re-reading blanks so concurrent Settings edits win. */
export async function fillPersonalDetails(
  inputs: readonly unknown[],
  userText: string,
  today: string,
  identity: ProfileWriteIdentity,
  defs: ReadonlyMap<string, BiomarkerDef>,
  signal?: AbortSignal,
  database = db,
): Promise<ProfileFillResult> {
  signal?.throwIfAborted();
  let onAbort: (() => void) | undefined;
  try {
    return await database.transaction("rw", database.settings, database.measurements, async () => {
      const transaction = Dexie.currentTransaction!;
      onAbort = () => {
        if (transaction.active) transaction.abort();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      signal?.throwIfAborted();
      const loaded = (await database.settings.get(LOADED_PROFILE_KEY))?.value;
      const id = typeof loaded === "string" ? loaded : null;
      const current = await getProfile(database);
      if (id !== identity.id || (id === null && current.name !== identity.name))
        return { profile: current, added: [], rejected: [], measurementsAdded: [], sameProfile: false };
      let profile = current;
      const added: ProfileCompletion["added"] = [];
      const rejected: string[] = [];
      for (const input of inputs) {
        const result = completeProfileDetails(profile, input, userText, today);
        profile = result.profile;
        added.push(...result.added);
        rejected.push(...result.rejected);
      }
      signal?.throwIfAborted();
      const measurementsAdded: Measurement[] = [];
      for (const candidate of measurementsIn(userText, today, defs)) {
        if (await database.measurements.where("[biomarkerId+date]").equals([candidate.biomarkerId, candidate.date]).count()) continue;
        const [measurement] = await addMeasurements([candidate], database);
        measurementsAdded.push(measurement!);
      }
      signal?.throwIfAborted();
      if (added.length) await setProfile(profile, database);
      return { profile, added, rejected, measurementsAdded, sameProfile: true };
    });
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
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
  backup.measurements.forEach(checkSleepSessions);
  await database.transaction(
    "rw",
    [database.measurements, database.protocols, database.experiments, database.plans, database.meals, database.settings],
    async () => {
      if (mode === "replace") {
        await database.measurements.clear();
        await database.protocols.clear();
        await database.experiments.clear();
        await database.plans.clear();
        await database.meals.clear();
        const personal = (await database.settings.toArray()).filter((s) => !["ai", "loadedProfile", "onboarded"].includes(s.key));
        await database.settings.bulkDelete(personal.map((s) => s.key));
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
    },
  );
}

export async function deleteEverything(database = db): Promise<void> {
  await database.transaction(
    "rw",
    [database.measurements, database.protocols, database.experiments, database.plans, database.meals, database.settings],
    async () => {
      await database.measurements.clear();
      await database.protocols.clear();
      await database.experiments.clear();
      await database.plans.clear();
      await database.meals.clear();
      await database.settings.clear();
    },
  );
}
