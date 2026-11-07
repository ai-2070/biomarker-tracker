import "fake-indexeddb/auto";
import type { Measurement } from "@bt/shared/core/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteMeasurements, TrackerDB, updateMeasurement } from "../../apps/web/src/db/db";

let db: TrackerDB;
let sequence = 0;

beforeEach(async () => {
  db = new TrackerDB(`measurement-edits-${++sequence}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const editable = {
  biomarkerId: "glucose_home",
  value: 5,
  originalValue: 90,
  originalUnit: "mg/dL",
  date: "2026-10-01",
};
const row = (id: string, savedOrder: number): Measurement => ({
  ...editable,
  id,
  source: "device",
  savedOrder,
});

describe("editing saved measurements", () => {
  it("saves noncanonical device values and qualifiers without changing identity, source or order", async () => {
    const original = row("device-reading", 42);
    await db.measurements.add(original);
    const change = {
      ...editable,
      value: 5.5,
      originalValue: 99,
      date: "2026-10-02",
      qualifier: "<" as const,
      fasted: false,
      lab: "Meter",
      labRange: { low: 3.9, high: 7.8 },
      note: "Checked the export",
    };
    await updateMeasurement(original.id, change, db);
    expect(await db.measurements.get(original.id)).toEqual({
      ...change,
      id: original.id,
      source: "device",
      savedOrder: 42,
    });
    expect(await db.measurements.count()).toBe(1);
  });

  it("clears every omitted optional editable field instead of merging stale fields", async () => {
    await db.measurements.add({
      ...row("qualified", 7),
      source: "pdf",
      qualifier: ">",
      lab: "Lab",
      labRange: { low: 4, high: 6 },
      fasted: true,
      note: "Old note",
    });
    await updateMeasurement("qualified", editable, db);
    expect(await db.measurements.get("qualified")).toEqual({
      ...editable,
      id: "qualified",
      source: "pdf",
      savedOrder: 7,
    });
  });

  it("preserves the current stored provenance even when the caller supplies stale extra fields", async () => {
    await db.measurements.add({ ...row("current", 81), source: "manual" });
    const stale = { ...editable, id: "another-id", source: "device" as const, savedOrder: 1 };
    await updateMeasurement("current", stale, db);
    expect(await db.measurements.get("current")).toEqual({
      ...editable,
      id: "current",
      source: "manual",
      savedOrder: 81,
    });
    expect(await db.measurements.get("another-id")).toBeUndefined();
  });

  it("rejects a stale editor after deletion without resurrecting the row", async () => {
    await db.measurements.add(row("deleted", 1));
    await deleteMeasurements(["deleted"], db);
    await expect(updateMeasurement("deleted", editable, db)).rejects.toThrow("This result no longer exists.");
    expect(await db.measurements.count()).toBe(0);
    await expect(updateMeasurement("never-saved", editable, db)).rejects.toThrow("This result no longer exists.");
    expect(await db.measurements.count()).toBe(0);
  });

  it("rolls an edit back when a write fails", async () => {
    const original = row("failed-edit", 3);
    await db.measurements.add(original);
    const rejectWrite = () => {
      throw new Error("Write failed");
    };
    db.measurements.hook("updating", rejectWrite);
    try {
      await expect(updateMeasurement(original.id, { ...editable, value: 6 }, db)).rejects.toThrow("Write failed");
    } finally {
      db.measurements.hook("updating").unsubscribe(rejectWrite);
    }
    expect(await db.measurements.get(original.id)).toEqual(original);
  });
});

describe("deleting selected measurements", () => {
  it("removes only explicit IDs once, returning actual removals and preserving other profile data", async () => {
    const selectedBlood = { ...row("blood", 1), biomarkerId: "glucose", source: "pdf" as const };
    const selectedDevice = row("device", 2);
    const unrelated = row("same-day-unselected", 3);
    const habit = { id: "habit", label: "Walking", category: "lifestyle" as const, start: "2026-09-01" };
    const setting = { key: "profile", value: { name: "Local person" } };
    await db.measurements.bulkAdd([selectedBlood, selectedDevice, unrelated]);
    await db.protocols.add(habit);
    await db.settings.add(setting);
    expect(await deleteMeasurements(["blood", "missing", "device", "blood"], db)).toBe(2);
    expect(await db.measurements.toArray()).toEqual([unrelated]);
    expect(await db.protocols.toArray()).toEqual([habit]);
    expect(await db.settings.toArray()).toEqual([setting]);
    expect(await deleteMeasurements(["blood", "missing"], db)).toBe(0);
  });

  it("treats an empty selection as no deletion", async () => {
    const original = row("untouched", 1);
    await db.measurements.add(original);
    expect(await deleteMeasurements([], db)).toBe(0);
    expect(await db.measurements.toArray()).toEqual([original]);
  });

  it("rolls back the entire selected deletion if any selected delete fails", async () => {
    const originals = [row("a", 1), row("b", 2), row("c", 3)];
    await db.measurements.bulkAdd(originals);
    const rejectSecond = (key: string) => {
      if (key === "b") throw new Error("Delete failed");
    };
    db.measurements.hook("deleting", rejectSecond);
    try {
      await expect(deleteMeasurements(["a", "b"], db)).rejects.toThrow("Delete failed");
    } finally {
      db.measurements.hook("deleting").unsubscribe(rejectSecond);
    }
    expect(await db.measurements.toArray()).toEqual(originals);
  });
});
