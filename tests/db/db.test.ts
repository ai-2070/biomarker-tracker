import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBackup } from "@bt/shared/core/backup";
import { demoProfile } from "@bt/shared/core/demo";
import weight from "../../knowledge/biomarkers/weight.json";
import bodyFat from "../../knowledge/biomarkers/body_fat.json";
import pace from "../../knowledge/biomarkers/dunedinpace.json";
import type { BiomarkerDef } from "@bt/shared/core/types";
import { profileDetailsIn } from "@bt/shared/core/profileCompletion";
import {
  addMeasurement,
  addProtocol,
  saveDeviceMeasurements,
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
  fillPersonalDetails,
  LOADED_PROFILE_KEY,
  saveBirthMonth,
  saveCountry,
} from "../../apps/web/src/db/db";

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
const standardRoutine = demoProfile("2026-10-30").plans.find((p) => p.name === "Standard Routine")!;
const captureDefs = new Map<string, BiomarkerDef>([weight, bodyFat, pace].map((def) => [def.id, def as BiomarkerDef]));

describe("db", () => {
  it("removes an API key saved in the browser by older versions, and nothing else", async () => {
    await db.settings.put({ key: "ai", value: { provider: "anthropic", apiKey: "sk-old" } });
    await setProfile({ sex: "f" }, db);
    await forgetBrowserAiKey(db);
    expect(await db.settings.get("ai")).toBeUndefined();
    expect((await getProfile(db)).sex).toBe("f");
  });

  it("fills missing conversational details without replacing concurrent Settings edits or private fields", async () => {
    await db.settings.put({ key: LOADED_PROFILE_KEY, value: "person-a" });
    await setProfile({ name: "Private name", notes: "Private notes", heightCm: 168 }, db);
    const text = "I'm 180 cm. I'm male";
    const result = await fillPersonalDetails([{ details: [
      { field: "heightCm", quote: "I'm 180 cm" },
      { field: "sex", quote: "I'm male" },
    ] }], text, "2026-10-30", { id: "person-a" }, captureDefs, undefined, db);
    expect(result.added).toEqual([{ field: "sex", value: "m" }]);
    expect(await getProfile(db)).toEqual({ name: "Private name", notes: "Private notes", heightCm: 168, sex: "m" });
  });

  it("converts quoted height and saves separate validated calls as one profile update", async () => {
    await setProfile({ name: "Local person" }, db);
    const result = await fillPersonalDetails([
      { details: [{ field: "heightCm", quote: "I'm 5 feet 11 inches" }] },
      { details: [{ field: "diet", quote: "I'm vegetarian" }] },
    ], "I'm 5 feet 11 inches. I'm vegetarian", "2026-10-30", { id: null, name: "Local person" }, captureDefs, undefined, db);
    expect(result.sameProfile).toBe(true);
    expect(await getProfile(db)).toEqual({ name: "Local person", heightCm: 180.34, diet: "vegetarian" });
  });

  it("cannot fill a different folder profile or a replaced browser-only person", async () => {
    const inputs = [{ details: [{ field: "heightCm", quote: "I'm 180 cm" }] }];
    await db.settings.put({ key: LOADED_PROFILE_KEY, value: "person-b" });
    await setProfile({ name: "Other person" }, db);
    expect((await fillPersonalDetails(inputs, "I'm 180 cm", "2026-10-30", { id: "person-a" }, captureDefs, undefined, db)).sameProfile).toBe(false);
    expect(await getProfile(db)).toEqual({ name: "Other person" });
    await db.settings.delete(LOADED_PROFILE_KEY);
    expect((await fillPersonalDetails(inputs, "I'm 180 cm", "2026-10-30", { id: null, name: "Original person" }, captureDefs, undefined, db)).sameProfile).toBe(false);
    expect(await getProfile(db)).toEqual({ name: "Other person" });
  });

  it("does not write cancelled or document-only facts into the profile", async () => {
    await setProfile({ name: "Local person" }, db);
    const inputs = [{ details: [{ field: "heightCm", quote: "I'm 180 cm" }] }];
    const controller = new AbortController();
    controller.abort();
    await expect(fillPersonalDetails(inputs, "I'm 180 cm", "2026-10-30", { id: null, name: "Local person" }, captureDefs, controller.signal, db)).rejects.toThrow();
    const result = await fillPersonalDetails(inputs, "Please read the attached document", "2026-10-30", { id: null, name: "Local person" }, captureDefs, undefined, db);
    expect(result.added).toEqual([]);
    expect(await getProfile(db)).toEqual({ name: "Local person" });
  });

  it("saves profile details and typed readings together, and keeps existing same-day data", async () => {
    await setProfile({ name: "Local person" }, db);
    const date = "2026-10-30";
    const text = "I'm 31, 102kg, 192cm tall, man. I work from home, 27% body fat";
    const identity = { id: null, name: "Local person" };
    const result = await fillPersonalDetails([profileDetailsIn(text, date)], text, date, identity, captureDefs, undefined, db);
    expect(result.measurementsAdded.map(({ biomarkerId, value, date }) => ({ biomarkerId, value, date }))).toEqual([
      { biomarkerId: "weight", value: 102, date }, { biomarkerId: "body_fat", value: 27, date },
    ]);
    expect(await getProfile(db)).toEqual({ name: "Local person", heightCm: 192, sex: "m" });
    await fillPersonalDetails([], "im 29% body fat", date, identity, captureDefs, undefined, db);
    expect((await measurementsFor("body_fat", db)).map((m) => m.value)).toEqual([27]);
    expect(await db.measurements.count()).toBe(2);
  });

  it("adds a new dated reading once under concurrent submissions, without replacing history", async () => {
    await setProfile({ name: "Local person" }, db);
    const identity = { id: null, name: "Local person" };
    await fillPersonalDetails([], "my pace of aging is 0.90 today", "2026-10-29", identity, captureDefs, undefined, db);
    await Promise.all([
      fillPersonalDetails([], "my pace of aging is 0.88 today", "2026-10-30", identity, captureDefs, undefined, db),
      fillPersonalDetails([], "my pace of aging is 0.88 today", "2026-10-30", identity, captureDefs, undefined, db),
    ]);
    expect((await measurementsFor("dunedinpace", db)).map(({ date, value }) => ({ date, value }))).toEqual([
      { date: "2026-10-29", value: 0.9 }, { date: "2026-10-30", value: 0.88 },
    ]);
  });

  it("cannot write measurements to a switched profile or after cancellation", async () => {
    await setProfile({ name: "Other person" }, db);
    const text = "I'm 102kg and 27% body fat";
    const skipped = await fillPersonalDetails([], text, "2026-10-30", { id: "original" }, captureDefs, undefined, db);
    expect(skipped).toMatchObject({ sameProfile: false, measurementsAdded: [] });
    const controller = new AbortController();
    controller.abort();
    await expect(fillPersonalDetails([], text, "2026-10-30", { id: null, name: "Other person" }, captureDefs, controller.signal, db)).rejects.toThrow();
    expect(await db.measurements.count()).toBe(0);
  });

  it("saves a missing birth month without losing concurrent profile edits or replacing an existing date", async () => {
    await setProfile({ name: "Person", heightCm: 192, notes: "Updated private note", conditions: "asthma" }, db);
    const identity = { id: null, name: "Person" };
    expect(await saveBirthMonth("1995-06", identity, "2026-10-30", db)).toBe(true);
    expect(await getProfile(db)).toEqual({ name: "Person", heightCm: 192, notes: "Updated private note", conditions: "asthma", birthMonth: "1995-06" });
    expect(await saveBirthMonth("1984-05", identity, "2026-10-30", db)).toBe(false);
    expect((await getProfile(db)).birthMonth).toBe("1995-06");
  });

  it("does not save a birth month to a switched folder or a replaced browser profile", async () => {
    await db.settings.put({ key: LOADED_PROFILE_KEY, value: "other-folder" });
    await setProfile({ name: "Other person" }, db);
    expect(await saveBirthMonth("1995-06", { id: "original-folder" }, "2026-10-30", db)).toBe(false);
    await db.settings.delete(LOADED_PROFILE_KEY);
    expect(await saveBirthMonth("1995-06", { id: null, name: "Original person" }, "2026-10-30", db)).toBe(false);
    expect(await getProfile(db)).toEqual({ name: "Other person" });
  });

  it.each(["2026-11", "2027-01", "2020-00", "2020-13", "1899-12", "2020-1"])("rejects an invalid or future birth month: %s", async (birthMonth) => {
    await setProfile({ name: "Person" }, db);
    await expect(saveBirthMonth(birthMonth, { id: null, name: "Person" }, "2026-10-30", db)).rejects.toThrow();
    expect(await getProfile(db)).toEqual({ name: "Person" });
  });

  it("saves a missing country once while preserving concurrent profile edits", async () => {
    await setProfile({ name: "Person", heightCm: 192, notes: "New private note", conditions: "asthma" }, db);
    const results = await Promise.all([
      saveCountry("US", { id: null, name: "Person" }, db),
      saveCountry("GB", { id: null, name: "Person" }, db),
    ]);
    expect(results).toEqual([true, false]);
    expect(await getProfile(db)).toEqual({ name: "Person", heightCm: 192, notes: "New private note", conditions: "asthma", country: "US" });
  });
  it("refuses a country save after switching profiles and never replaces a saved country", async () => {
    await db.settings.put({ key: LOADED_PROFILE_KEY, value: "other-folder" });
    await setProfile({ name: "Other", country: "AT" }, db);
    expect(await saveCountry("US", { id: "original-folder" }, db)).toBe(false);
    expect(await saveCountry("US", { id: "other-folder" }, db)).toBe(false);
    await db.settings.delete(LOADED_PROFILE_KEY);
    await setProfile({ name: "Replacement" }, db);
    expect(await saveCountry("CA", { id: null, name: "Original" }, db)).toBe(false);
    expect(await getProfile(db)).toEqual({ name: "Replacement" });
  });
  it("repairs unsupported legacy countries but rejects unknown choices", async () => {
    await setProfile({ name: "Person", country: "ZZ" }, db);
    await expect(saveCountry("constructor", { id: null, name: "Person" }, db)).rejects.toThrow();
    expect(await saveCountry("NZ", { id: null, name: "Person" }, db)).toBe(true);
    expect((await getProfile(db)).country).toBe("NZ");
  });

  it("stores and queries measurements per biomarker, sorted by date", async () => {
    await addMeasurement({ ...sample, date: "2024-06-01" }, db);
    await addMeasurement({ ...sample, date: "2023-06-01" }, db);
    await addMeasurement({ ...sample, biomarkerId: "b12" }, db);
    const ferritin = await measurementsFor("ferritin", db);
    expect(ferritin.map((m) => m.date)).toEqual(["2023-06-01", "2024-06-01"]);
  });

  it("reimports corrected device values in place, adds new days and keeps unrelated results", async () => {
    const bad = { biomarkerId: "body_fat", value: 20, originalValue: 20, originalUnit: "%", date: "2026-03-01", source: "device" as const, note: "weight.csv: body fat mass" };
    const id = await addMeasurement({ ...bad, qualifier: "<", labRange: { high: 30 } }, db);
    const otherDay = await addMeasurement({ ...bad, date: "2026-02-01" }, db);
    const otherMarker = await addMeasurement(sample, db);
    const corrected = { ...bad, value: 25, originalValue: 25, note: "weight.csv: body fat" };
    const nextDay = { ...corrected, date: "2026-03-02", value: 24.5, originalValue: 24.5 };
    expect(await saveDeviceMeasurements([corrected, nextDay], db)).toEqual({ added: 1, updated: 1 });
    const storedCorrected = await db.measurements.get(id);
    expect(storedCorrected).toMatchObject({ ...corrected, id });
    expect(storedCorrected).not.toHaveProperty("qualifier");
    expect(storedCorrected).not.toHaveProperty("labRange");
    expect(await db.measurements.get(otherDay)).toMatchObject({ ...bad, date: "2026-02-01", id: otherDay });
    expect(await db.measurements.get(otherMarker)).toMatchObject({ ...sample, id: otherMarker });
    const before = await db.measurements.toArray();
    expect(await saveDeviceMeasurements([corrected, nextDay], db)).toEqual({ added: 0, updated: 2 });
    expect(await db.measurements.toArray()).toEqual(before);
  });

  it("uses the first overlapping series and updates every existing reading on that day", async () => {
    const day = { ...sample, biomarkerId: "weight", originalUnit: "kg", value: 80, originalValue: 80 };
    const firstId = await addMeasurement(day, db);
    const secondId = await addMeasurement({ ...day, value: 81, originalValue: 81 }, db);
    const imported = { ...day, value: 79, originalValue: 79, note: "watch.csv: weight" };
    expect(await saveDeviceMeasurements([imported, { ...imported, value: 90, originalValue: 90 }], db)).toEqual({ added: 0, updated: 1 });
    expect(await db.measurements.get(firstId)).toMatchObject({ ...imported, source: "device", id: firstId });
    expect(await db.measurements.get(secondId)).toMatchObject({ ...imported, source: "device", id: secondId });
  });

  it("serializes concurrent reimports without creating duplicate days", async () => {
    const first = { ...sample, biomarkerId: "body_fat", originalUnit: "%", value: 20, originalValue: 20 };
    const second = { ...first, value: 25, originalValue: 25 };
    await Promise.all([saveDeviceMeasurements([first], db), saveDeviceMeasurements([second], db)]);
    const results = await measurementsFor("body_fat", db);
    expect(results).toMatchObject([{ ...second, source: "device" }]);
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

  it("starts one protocol habit and ends its whole-routine watch without overwriting later protocol edits", async () => {
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
    expect((await db.protocols.toArray()).map((h) => h.label)).toEqual(["Stack"]);
    await watchHabit((await db.protocols.get(started.active!.habitIds[0]!))!, ["vitamin_d"], 56, "2026-10-10", db);
    const changedItems = [{ ...plan.items[0]!, amount: "My edited amount" }];
    await savePlan({ ...started, items: changedItems }, db);
    await stopPlan(started, "2026-10-29", db);
    expect((await db.protocols.toArray()).every((h) => h.end === "2026-10-29")).toBe(true);
    expect((await db.experiments.toArray())[0]!.end).toBe("2026-10-29");
    expect((await db.plans.get("p1"))!.active).toBeUndefined();
    expect((await db.plans.get("p1"))!.items).toEqual(changedItems);
    expect((await db.protocols.toArray())[0]!.plan!.items).toEqual(plan.items);
    // A protocol planned for later and stopped before it began leaves no habits behind.
    await startPlan(plan, "2026-12-01", db);
    const future = (await db.protocols.toArray()).find((h) => !h.end)!;
    await watchHabit(future, ["vitamin_d"], 56, "2026-10-29", db);
    await stopPlan((await db.plans.get("p1"))!, "2026-10-29", db);
    expect((await db.protocols.toArray()).map((h) => h.label)).toEqual(["Stack"]);
    expect((await db.experiments.toArray()).map((e) => e.end)).toEqual(["2026-10-29"]);
  });

  it("records Standard Routine once even for simultaneous starts, and keeps all 27 items through backup restore", async () => {
    await savePlan(standardRoutine, db);
    await Promise.all([startPlan(standardRoutine, "2026-10-30", db), startPlan(standardRoutine, "2026-10-30", db)]);
    const habits = await db.protocols.toArray();
    expect(habits.map((h) => h.label)).toEqual(["Standard Routine"]);
    expect(habits[0]!.plan!.items.map((i) => i.label)).toEqual(standardRoutine.items.map((i) => i.label));
    expect(habits[0]!.plan!.items).toHaveLength(27);
    expect((await db.plans.get(standardRoutine.id))!.active!.habitIds).toEqual([habits[0]!.id]);
    const parsed = parseBackup(JSON.parse(JSON.stringify(await exportAll(new Date("2026-10-30T00:00:00Z"), db))));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await deleteEverything(db);
    await importBackup(parsed.backup, "replace", db);
    expect(await db.protocols.toArray()).toEqual(habits);
  });

  it("keeps a grouped habit's dates, watch and source running state together when edited, stopped, reopened or deleted", async () => {
    await savePlan(standardRoutine, db);
    await startPlan(standardRoutine, "2026-10-10", db);
    const habit = (await db.protocols.toArray())[0]!;
    const watchId = await watchHabit(habit, ["vitamin_d"], 56, "2026-10-10", db);
    const edited = { ...habit, label: "My routine", start: "2026-10-11" };
    await saveHabit(edited, db);
    expect((await db.plans.get(standardRoutine.id))!.active).toEqual({ since: "2026-10-11", habitIds: [habit.id] });
    expect(await db.experiments.get(watchId)).toMatchObject({ change: "My routine", start: "2026-10-11" });
    await saveHabit({ ...edited, end: "2026-10-29" }, db);
    expect((await db.plans.get(standardRoutine.id))!.active).toBeUndefined();
    expect((await db.experiments.get(watchId))!.end).toBe("2026-10-29");
    await saveHabit(edited, db);
    expect((await db.plans.get(standardRoutine.id))!.active!.habitIds).toEqual([habit.id]);
    expect((await db.experiments.get(watchId))!.end).toBeUndefined();
    expect((await db.protocols.get(habit.id))!.plan).toEqual(habit.plan);
    await deleteHabit({ entry: edited }, db);
    expect((await db.plans.get(standardRoutine.id))!.active).toBeUndefined();
    expect(await db.protocols.toArray()).toEqual([]);
    expect(await db.experiments.toArray()).toEqual([]);
  });

  it("ending a protocol watch also ends its single habit and clears the protocol's running state", async () => {
    await savePlan(standardRoutine, db);
    await startPlan(standardRoutine, "2026-10-10", db);
    const habit = (await db.protocols.toArray())[0]!;
    const watchId = await watchHabit(habit, ["vitamin_d"], 56, "2026-10-10", db);
    await endExperiment(watchId, "2026-10-29", db);
    expect((await db.protocols.get(habit.id))!.end).toBe("2026-10-29");
    expect((await db.experiments.get(watchId))!.end).toBe("2026-10-29");
    expect((await db.plans.get(standardRoutine.id))!.active).toBeUndefined();
  });

  it("stops older multi-habit runs without merging their history or changing unrelated habits", async () => {
    const old = { ...standardRoutine, active: { since: "2026-10-10", habitIds: ["old-a", "old-b"] } };
    await savePlan(old, db);
    await db.protocols.bulkAdd([
      { id: "old-a", label: "Vitamin D3", category: "supplement", start: "2026-10-10" },
      { id: "old-b", label: "Walk", category: "lifestyle", start: "2026-10-10" },
      { id: "unrelated", label: "Other routine", category: "lifestyle", start: "2026-10-10" },
    ]);
    await stopPlan(old, "2026-10-29", db);
    expect(await db.protocols.get("old-a")).toMatchObject({ label: "Vitamin D3", end: "2026-10-29" });
    expect(await db.protocols.get("old-b")).toMatchObject({ label: "Walk", end: "2026-10-29" });
    expect((await db.protocols.get("unrelated"))!.end).toBeUndefined();
    expect((await db.plans.get(old.id))!.active).toBeUndefined();
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
