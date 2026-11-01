import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup, parseBackup } from "../../src/core/backup";
import { sortByDate } from "../../src/core/trends";
import type { Measurement, SleepSession } from "../../src/core/types";
import {
  addMeasurement, addMeasurements, deleteMeasurements, exportAll, importBackup,
  saveDeviceMeasurements, TrackerDB, updateMeasurement,
} from "../../src/db/db";

let database: TrackerDB;
beforeEach(async () => {
  database = new TrackerDB(`sleep-persistence-${crypto.randomUUID()}`);
  await database.open();
});
afterEach(async () => { await database.delete(); });

const timing: SleepSession[] = [
  { start: "2026-10-24T23:15:00", end: "2026-10-25T07:30:00", kind: "asleep", source: "Synthetic watch", startOffsetMinutes: 120, endOffsetMinutes: 60 },
  { start: "2026-10-25T14:00:00", end: "2026-10-25T14:30:00", kind: "session", source: "Synthetic watch" },
];
const sleep: Omit<Measurement, "id"> = {
  biomarkerId: "sleep_duration", date: "2026-10-25", value: 8, originalValue: 480,
  originalUnit: "min", source: "device", sleepSessions: timing,
};
const { sleepSessions: _timing, ...durationOnly } = sleep;

describe("sleep timing in stored measurements", () => {
  it("adds optional timing inside existing rows without changing save order or duration-only readings", async () => {
    const rows = await addMeasurements([durationOnly, sleep], database);
    expect(rows.map((row) => row.savedOrder)).toEqual([1, 2]);
    const saved = sortByDate(await database.measurements.toArray());
    expect(saved.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(saved[0]).not.toHaveProperty("sleepSessions");
    expect(saved[1]!.sleepSessions).toEqual(timing);
    expect(saved[1]!.value).toBe(8);
  });

  it.each(["merge", "replace"] as const)("round-trips timing through JSON and %s restore with identity and order intact", async (mode) => {
    const id = await addMeasurement({ ...sleep, note: "Imported source clocks" }, database);
    const exported = await exportAll(new Date("2026-11-01T12:00:00Z"), database);
    const parsed = parseBackup(JSON.parse(JSON.stringify(exported)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    await deleteMeasurements([id], database);
    await importBackup(parsed.backup, mode, database);
    expect(await database.measurements.get(id)).toEqual(exported.measurements[0]);
    expect((await database.measurements.get(id))!.sleepSessions).toEqual(timing);
  });

  it("retains validated imported timing through note, unit and lab-only edits using the latest stored row", async () => {
    const id = await addMeasurement(sleep, database);
    await updateMeasurement(id, {
      ...durationOnly, originalValue: 8, originalUnit: "h", note: "Checked", lab: "Watch export",
    }, database);
    expect(await database.measurements.get(id)).toEqual({
      ...sleep, id, savedOrder: 1, originalValue: 8, originalUnit: "h", note: "Checked", lab: "Watch export",
    });
    await updateMeasurement(id, durationOnly, database);
    expect(await database.measurements.get(id)).toEqual({ ...sleep, id, savedOrder: 1 });
  });

  it("preserves newly reimported timing rather than reviving a stale editor's windows", async () => {
    const id = await addMeasurement(sleep, database);
    const replacement = [{ ...timing[0]!, start: "2026-10-24T22:30:00", source: "Replacement watch" }];
    await saveDeviceMeasurements([{ ...sleep, sleepSessions: replacement }], database);
    await updateMeasurement(id, { ...durationOnly, note: "Edited after reimport" }, database);
    expect(await database.measurements.get(id)).toEqual({
      ...sleep, id, savedOrder: 1, sleepSessions: replacement, note: "Edited after reimport",
    });
  });

  it("rolls a timing-clearing edit back if its write fails", async () => {
    const id = await addMeasurement(sleep, database);
    const original = await database.measurements.get(id);
    const rejectEdit = () => { throw new Error("Edit failed"); };
    database.measurements.hook("updating", rejectEdit);
    try {
      await expect(updateMeasurement(id, { ...durationOnly, value: 7 }, database)).rejects.toThrow("Edit failed");
    } finally {
      database.measurements.hook("updating").unsubscribe(rejectEdit);
    }
    expect(await database.measurements.get(id)).toEqual(original);
  });

  it("rejects caller-injected or changed edit timing without changing the stored result", async () => {
    const id = await addMeasurement(sleep, database);
    const original = await database.measurements.get(id);
    const injected: unknown[] = [
      [], null, [{ ...timing[0]!, start: "2026-10-24T22:00:00" }],
      [{ ...timing[0]!, source: "Another watch" }, timing[1]],
      [{ ...timing[0]!, startOffsetMinutes: 60 }, timing[1]],
    ];
    for (const sleepSessions of injected) {
      await expect(updateMeasurement(id, { ...sleep, note: "Not saved", sleepSessions } as Omit<Measurement, "id">, database)).rejects.toThrow(/only be changed by importing/);
      expect(await database.measurements.get(id)).toEqual(original);
    }
  });

  it.each([
    { value: 7.5 }, { date: "2026-10-26" }, { biomarkerId: "sleep_deep" }, { qualifier: "<" as const },
  ])("clears stale timing when the reading changes: %j", async (change) => {
    const id = await addMeasurement(sleep, database);
    await updateMeasurement(id, { ...sleep, ...change }, database);
    expect(await database.measurements.get(id)).toEqual({ ...durationOnly, ...change, id, savedOrder: 1 });
  });

  it("clears timing when a qualifier is removed and never lets an editor attach timing to a duration-only result", async () => {
    const id = await addMeasurement({ ...sleep, qualifier: ">" }, database);
    await updateMeasurement(id, durationOnly, database);
    expect(await database.measurements.get(id)).not.toHaveProperty("sleepSessions");
    await expect(updateMeasurement(id, sleep, database)).rejects.toThrow(/only be changed by importing/);
    expect(await database.measurements.get(id)).not.toHaveProperty("sleepSessions");
  });

  it("does not preserve corrupt legacy timing during a harmless edit", async () => {
    const corrupt = { ...sleep, id: "legacy", sleepSessions: [] };
    await database.measurements.add(corrupt);
    await updateMeasurement(corrupt.id, { ...durationOnly, note: "Checked" }, database);
    expect(await database.measurements.get(corrupt.id)).toEqual({ ...durationOnly, id: "legacy", note: "Checked" });
  });

  it("reimports timings by measurement and day, preserving ids/order and days absent from the import", async () => {
    const first = await addMeasurement({ ...durationOnly, source: "manual" }, database);
    const second = await addMeasurement(durationOnly, database);
    const unrelated = await addMeasurement({ ...durationOnly, date: "2026-10-23" }, database);
    expect(await saveDeviceMeasurements([sleep], database)).toEqual({ added: 0, updated: 1 });
    expect(await database.measurements.get(first)).toEqual({ ...sleep, id: first, savedOrder: 1 });
    expect(await database.measurements.get(second)).toEqual({ ...sleep, id: second, savedOrder: 2 });
    expect(await database.measurements.get(unrelated)).toEqual({ ...durationOnly, date: "2026-10-23", id: unrelated, savedOrder: 3 });
    const newDay = { ...durationOnly, date: "2026-10-26", sleepSessions: [{ ...timing[0]!, start: "2026-10-25T23:00:00", end: "2026-10-26T07:00:00" }] };
    expect(await saveDeviceMeasurements([newDay], database)).toEqual({ added: 1, updated: 0 });
    expect(sortByDate(await database.measurements.toArray()).at(-1)).toMatchObject({ ...newDay, savedOrder: 4 });
  });

  it("reimport without timing removes old windows and keeps first-selected-series precedence", async () => {
    const id = await addMeasurement(sleep, database);
    await saveDeviceMeasurements([{ ...durationOnly, value: 7 }, sleep], database);
    expect(await database.measurements.get(id)).toEqual({ ...durationOnly, value: 7, id, savedOrder: 1 });
    await saveDeviceMeasurements([sleep, { ...durationOnly, value: 6 }], database);
    expect(await database.measurements.get(id)).toEqual({ ...sleep, id, savedOrder: 1 });
  });

  it("merge replacement without timing cannot retain windows from the old row", async () => {
    const id = await addMeasurement(sleep, database);
    const backup = createBackup({ profile: {}, measurements: [{ ...durationOnly, id, savedOrder: 1 }], protocols: [], experiments: [] }, new Date());
    await importBackup(backup, "merge", database);
    expect(await database.measurements.get(id)).toEqual({ ...durationOnly, id, savedOrder: 1 });
  });

  it("rejects malformed metadata atomically at add, device-save and restore boundaries", async () => {
    const id = await addMeasurement(sleep, database);
    const original = await database.measurements.toArray();
    const invalid: unknown[] = [null, [], {}, [null], new Array(1), [{ ...timing[0], kind: ["asleep"] }], [{ ...timing[0], end: "2026-10-26T07:00:00" }]];
    for (const sleepSessions of invalid) {
      const damaged = { ...sleep, sleepSessions } as Omit<Measurement, "id">;
      await expect(addMeasurements([durationOnly, damaged], database)).rejects.toThrow(/sleep timing/);
      await expect(saveDeviceMeasurements([durationOnly, damaged], database)).rejects.toThrow(/sleep timing/);
      for (const mode of ["merge", "replace"] as const) {
        const backup = createBackup({ profile: {}, measurements: [{ ...damaged, id }], protocols: [], experiments: [] }, new Date());
        await expect(importBackup(backup, mode, database)).rejects.toThrow(/sleep timing/);
      }
      expect(await database.measurements.toArray()).toEqual(original);
    }
    await expect(addMeasurement({ ...sleep, biomarkerId: "sleep_rem" }, database)).rejects.toThrow(/sleep timing/);
    await expect(saveDeviceMeasurements([{ ...sleep, biomarkerId: "hrv_resting" }], database)).rejects.toThrow(/sleep timing/);
    expect(await database.measurements.toArray()).toEqual(original);
  });

  it("rolls back a complete reimport, including timing changes, when any write fails", async () => {
    const id = await addMeasurement(durationOnly, database);
    const original = await database.measurements.get(id);
    const rejectNewRow = () => { throw new Error("Write failed"); };
    database.measurements.hook("creating", rejectNewRow);
    try {
      await expect(saveDeviceMeasurements([sleep, { ...durationOnly, date: "2026-10-26" }], database)).rejects.toThrow("Write failed");
    } finally {
      database.measurements.hook("creating").unsubscribe(rejectNewRow);
    }
    expect(await database.measurements.toArray()).toEqual([original]);
  });

  it("deletes timing together with its measurement without touching another night's windows or resurrecting a stale edit", async () => {
    const rows = await addMeasurements([sleep, sleep], database);
    expect(await deleteMeasurements([rows[0]!.id, rows[0]!.id], database)).toBe(1);
    expect(await database.measurements.toArray()).toEqual([rows[1]]);
    await expect(updateMeasurement(rows[0]!.id, sleep, database)).rejects.toThrow(/no longer exists/);
    expect(await database.measurements.toArray()).toEqual([rows[1]]);
  });
});
