import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyBrainChanges, undoBrainChanges } from "../../apps/web/src/db/brainChanges";
import { db, deleteEverything, getProfile } from "../../apps/web/src/db/db";
import { loadDefs } from "../helpers";

const defs = loadDefs();
const today = "2026-11-27";
const identity = { id: "a" };
const ferritin = {
  id: "m1",
  biomarkerId: "ferritin",
  date: "2025-03-12",
  value: 45,
  originalValue: 45,
  originalUnit: "µg/L",
  source: "pdf" as const,
  savedOrder: 1,
};
const ctx = (userText: string) => ({ userText, today, identity, defs });

beforeEach(async () => {
  await db.open();
  await deleteEverything();
  await db.measurements.put(ferritin);
  await db.protocols.put({ id: "h1", label: "Vitamin D3", category: "supplement", start: "2026-10-01" });
  await db.settings.bulkPut([
    { key: "profile", value: { name: "A", notes: "private", heightCm: 180 } },
    { key: "loadedProfile", value: "a" },
  ]);
});
afterEach(async () => {
  await db.delete();
});

describe("Brain's changes in the browser copy", () => {
  it("deletes, adds and sets in one go, then Undo puts everything back", async () => {
    const userText = "delete my ferritin from 12 March, add ferritin 50 today, stop vitamin d3 and I'm 182 cm";
    const r = await applyBrainChanges(
      {
        quote: userText,
        changes: [
          { kind: "delete_results", marker: "ferritin", date: "2025-03-12" },
          { kind: "add_results", date: today, results: [{ marker: "ferritin", value: "50" }] },
          { kind: "stop_habit", habit: "vitamin d3" },
          { kind: "set_profile", field: "heightCm", value: 182 },
        ],
      },
      ctx(userText),
    );
    expect(r.ok).toBe(true);
    const rows = await db.measurements.toArray();
    expect(rows.map((m) => [m.biomarkerId, m.value, m.date])).toEqual([["ferritin", 50, today]]);
    expect(rows[0]!.savedOrder).toBe(2);
    expect((await db.protocols.get("h1"))?.end).toBe(today);
    expect(await getProfile()).toEqual({ name: "A", notes: "private", heightCm: 182 });

    if (!r.ok) return;
    expect(await undoBrainChanges(r.undo)).toEqual({ restored: 4, kept: 0 });
    expect(await db.measurements.toArray()).toEqual([ferritin]);
    expect((await db.protocols.get("h1"))?.end).toBeUndefined();
    expect(await getProfile()).toEqual({ name: "A", notes: "private", heightCm: 180 });
  });

  it("changes nothing when one change is refused", async () => {
    const userText = "delete ferritin and add PTH 4";
    const r = await applyBrainChanges(
      {
        quote: userText,
        changes: [
          { kind: "delete_results", marker: "ferritin" },
          { kind: "add_results", date: today, results: [{ marker: "PTH", value: "4" }] },
        ],
      },
      ctx(userText),
    );
    expect(r.ok).toBe(false);
    expect(await db.measurements.toArray()).toEqual([ferritin]);
  });

  it("refuses when another profile was opened while Brain answered", async () => {
    await db.settings.put({ key: "loadedProfile", value: "b" });
    const r = await applyBrainChanges({ quote: "delete ferritin", changes: [{ kind: "delete_results", marker: "ferritin" }] }, ctx("delete ferritin"));
    expect(r).toMatchObject({ ok: false, otherProfile: true });
    expect(await db.measurements.count()).toBe(1);
  });

  it("Undo leaves rows edited since then alone", async () => {
    const r = await applyBrainChanges(
      { quote: "set my height", changes: [{ kind: "set_profile", field: "heightCm", value: 182 }] },
      ctx("set my height to 182"),
    );
    await db.settings.put({ key: "profile", value: { name: "A", notes: "private", heightCm: 185 } });
    expect(r.ok && (await undoBrainChanges(r.undo))).toEqual({ restored: 0, kept: 1 });
    expect((await getProfile()).heightCm).toBe(185);
  });
});
