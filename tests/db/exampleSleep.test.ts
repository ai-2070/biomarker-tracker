import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoProfile } from "@bt/shared/core/demo";
import { buildSleepTiming, pairSleepCardiac } from "@bt/shared/core/sleepTiming";
import type { Measurement } from "@bt/shared/core/types";
import { ensureExampleSleepData, saveDeviceMeasurements, TrackerDB } from "../../apps/web/src/db/db";

let database: TrackerDB;
beforeEach(async () => {
  database = new TrackerDB(`example-sleep-${crypto.randomUUID()}`);
  await database.open();
});
afterEach(async () => { await database.delete(); });

const today = "2026-10-31";
function legacyExample() {
  const example = demoProfile(today);
  const measurements = example.measurements.filter((m) => !m.id.startsWith("example-sleep-rhr-"))
    .map(({ sleepSessions: _timing, ...m }, index) => ({ ...m, savedOrder: index + 1 }));
  return { profile: example.person, measurements };
}

async function seed(example = legacyExample()) {
  await database.settings.put({ key: "profile", value: example.profile });
  await database.measurements.bulkPut(example.measurements);
  return example;
}

function withoutTiming(m: Measurement) {
  const { sleepSessions: _timing, ...rest } = m;
  return rest;
}

describe("existing fictional example sleep data", () => {
  it("populates sleep timing and both resting comparisons while preserving every existing result", async () => {
    const example = await seed();
    await ensureExampleSleepData(database);
    const saved = await database.measurements.toArray();
    for (const original of example.measurements) {
      expect(withoutTiming(saved.find((m) => m.id === original.id)!)).toEqual(original);
    }
    const timing = buildSleepTiming(saved, { today });
    expect(timing.nights).toHaveLength(70);
    expect(timing.regularity.pairs).toBe(69);
    expect(pairSleepCardiac(timing.nights, saved, "resting_hr", "midpoint").points.map((p) => p.date))
      .toEqual(timing.nights.map((night) => night.date));
    expect(pairSleepCardiac(timing.nights, saved, "hrv_resting", "midpoint").points.map((p) => p.date))
      .toEqual(timing.nights.map((night) => night.date));
    const resting = saved.filter((m) => m.biomarkerId === "resting_hr");
    expect(new Set(resting.map((m) => m.date)).size).toBe(resting.length);
    const beforeRepeat = await database.measurements.toArray();
    expect(await ensureExampleSleepData(database)).toBe(0);
    expect(await database.measurements.toArray()).toEqual(beforeRepeat);
  });

  it("never fabricates timing or pulse readings for a real profile", async () => {
    const example = legacyExample();
    await seed({ ...example, profile: { ...example.profile, example: undefined } });
    expect(await ensureExampleSleepData(database)).toBe(0);
    expect(await database.measurements.count()).toBe(example.measurements.length);
    for (const row of await database.measurements.toArray()) expect(row.sleepSessions).toBeUndefined();
    expect(await database.settings.get("exampleSleepDataVersion")).toBeUndefined();
  });

  it("preserves imported, edited and annotated sleep readings even inside an example profile", async () => {
    const example = legacyExample();
    const sleeps = example.measurements.filter((m) => m.biomarkerId === "sleep_duration" && m.source === "device");
    const imported = sleeps[0]!;
    imported.note = "Synthetic Samsung export.csv";
    const edited = sleeps[1]!;
    edited.value += 0.1;
    edited.originalValue = edited.value;
    const annotated = sleeps.at(-1)!;
    annotated.note = "A personal correction";
    await seed(example);
    await ensureExampleSleepData(database);
    expect(await database.measurements.get(imported.id)).toEqual(imported);
    expect(await database.measurements.get(edited.id)).toEqual(edited);
    expect(await database.measurements.get(annotated.id)).toEqual(annotated);
    expect(buildSleepTiming(await database.measurements.toArray(), { today }).nights).toHaveLength(67);
  });

  it("does not regenerate timings after a later duration-only reimport", async () => {
    await seed();
    await ensureExampleSleepData(database);
    const row = (await database.measurements.toArray()).find((m) => m.sleepSessions)!;
    const { id: _id, source: _source, ...durationOnly } = withoutTiming(row);
    await saveDeviceMeasurements([durationOnly], database);
    expect((await database.measurements.get(row.id))!.sleepSessions).toBeUndefined();
    expect(await ensureExampleSleepData(database)).toBe(0);
    expect((await database.measurements.get(row.id))!.sleepSessions).toBeUndefined();
  });
});
