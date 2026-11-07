import {
  chanceNote,
  defaultRetestDays,
  HABIT_HINTS,
  habitsOf,
  pickedAfterResults,
  suggestMarkers,
  summarizeWatch,
  syncWatch,
  watchFor,
} from "@bt/shared/core/habits";
import type { Experiment, Measurement, ProtocolEntry } from "@bt/shared/core/types";
import { describe, expect, it } from "vitest";
import { BIOMARKER_MAP } from "../../apps/web/src/app/knowledge";

const d3: ProtocolEntry = { id: "p1", label: "Vitamin D3 1000 IU daily", category: "supplement", start: "2026-01-10" };
const oats: ProtocolEntry = { id: "p2", label: "Oats every day", category: "diet", start: "2025-06-01", end: "2025-09-01" };

describe("habit marker suggestions", () => {
  it("only suggests markers the app knows", () => {
    for (const h of HABIT_HINTS) for (const id of h.markers) expect(BIOMARKER_MAP.has(id), id).toBe(true);
  });
  it("finds markers from words in the habit, ones with results first", () => {
    expect(suggestMarkers("Vitamin D3 1000 IU daily")).toEqual(["vitamin_d"]);
    expect(suggestMarkers("Iron bisglycinate 25 mg", (id) => id === "hemoglobin")[0]).toBe("hemoglobin");
    expect(suggestMarkers("Oats and beans every day (more fibre)")).toEqual(["ldl", "total_cholesterol"]);
    expect(suggestMarkers("Walking 30 minutes a day")).toEqual(["resting_hr", "hrv_resting", "bp_systolic", "bp_diastolic"]);
    expect(suggestMarkers("Reading before bed")).toEqual([]);
    expect(suggestMarkers("Steak on Sundays")).toEqual([]);
    expect(suggestMarkers("No coffee with meals")).toEqual(["ferritin", "sleep_duration", "sleep_deep", "sleep_rem"]);
  });
  it("uses included item labels for a routine, deduplicates hints, and keeps results first", () => {
    const routine: Pick<ProtocolEntry, "label" | "plan"> = {
      label: "Vitamin D routine",
      plan: {
        id: "source",
        items: [
          { id: "d3", label: "Vitamin D3", category: "supplement", when: "morning" },
          { id: "iron", label: "Iron bisglycinate", category: "supplement", when: "midday" },
          { id: "oats", label: "Oats", category: "diet", when: "morning" },
        ],
      },
    };
    expect(suggestMarkers(routine, (id) => id === "ldl")).toEqual([
      "ldl",
      "vitamin_d",
      "ferritin",
      "hemoglobin",
      "iron",
      "transferrin_saturation",
      "total_cholesterol",
    ]);
    expect(suggestMarkers(d3)).toEqual(suggestMarkers(d3.label));
  });
});

describe("watching a habit", () => {
  it("follows the log entry's name and dates", () => {
    const w = watchFor(oats, ["ldl", "ldl"], 56, "2026-10-28");
    expect(w).toEqual({
      change: "Oats every day",
      category: "diet",
      markerIds: ["ldl"],
      start: "2025-06-01",
      retestAfterDays: 56,
      end: "2025-09-01",
      protocolId: "p2",
      chosenOn: "2026-10-28",
    });
    const e: Experiment = { id: "e1", ...w };
    const synced = syncWatch(e, { ...oats, label: "Oats daily", end: undefined });
    expect(synced.change).toBe("Oats daily");
    expect(synced.end).toBeUndefined();
    expect(synced.markerIds).toEqual(["ldl"]);
  });
  it("marks markers picked after the results were in", () => {
    expect(pickedAfterResults({ start: "2025-06-01", retestAfterDays: 56, chosenOn: "2026-10-28" })).toBe(true);
    expect(pickedAfterResults({ start: "2026-10-28", retestAfterDays: 56, chosenOn: "2026-10-28" })).toBe(false);
    expect(pickedAfterResults({ start: "2025-06-01", retestAfterDays: 56 })).toBe(false);
  });
  it("lists entries with their watch, and keeps watches whose entry was deleted", () => {
    const e1: Experiment = { id: "e1", ...watchFor(oats, ["ldl"], 56, "2025-06-01") };
    const orphan: Experiment = {
      id: "e2",
      change: "Kiwis",
      category: "diet",
      markerIds: ["ferritin"],
      start: "2024-01-01",
      retestAfterDays: 56,
      protocolId: "gone",
    };
    const hs = habitsOf([d3, oats], [e1, orphan]);
    expect(hs.map((h) => h.id)).toEqual(["p1", "e2", "p2"]);
    expect(hs.find((h) => h.id === "p2")?.watch?.id).toBe("e1");
    expect(hs.find((h) => h.id === "e2")?.entry).toBeUndefined();
    expect(hs.find((h) => h.id === "p1")?.watch).toBeUndefined();
  });
});

describe("what changed", () => {
  const m = (id: string, date: string, value: number): Measurement => ({
    id: `${id}-${date}`,
    biomarkerId: "ldl",
    date,
    value,
    originalValue: value,
    originalUnit: "mmol/L",
    source: "manual",
  });
  const watch: Experiment = { id: "e1", change: "Oats", category: "diet", markerIds: ["ldl", "vitamin_d"], start: "2025-06-01", retestAfterDays: 56 };
  it("puts a change beyond normal variation first", () => {
    const s = summarizeWatch(watch, BIOMARKER_MAP, [m("a", "2025-05-01", 3.8), m("b", "2025-09-01", 2.9)], "2025-10-01");
    expect(s.headline?.biomarkerId).toBe("ldl");
    expect(s.headline?.verdict).toBe("fall");
    expect(s.results.find((r) => r.biomarkerId === "vitamin_d")?.verdict).toBe("no-baseline");
    expect(s.phase).toBe("complete");
  });
  it("has no headline before the re-test", () => {
    const s = summarizeWatch(watch, BIOMARKER_MAP, [m("a", "2025-05-01", 3.8)], "2025-06-10");
    expect(s.headline).toBeUndefined();
    expect(s.phase).toBe("running");
  });
  it("suggests 12 weeks for HbA1c", () => {
    expect(defaultRetestDays(["ldl"])).toBe(56);
    expect(defaultRetestDays(["ldl", "hba1c"])).toBe(84);
  });
});

describe("watching many markers", () => {
  it("says that some may move by chance", () => {
    expect(chanceNote(4)).toBeUndefined();
    expect(chanceNote(5)).toMatch(/^With 5 markers, one of them may/);
    expect(chanceNote(21)).toMatch(/one of them/);
    expect(chanceNote(40)).toMatch(/about 2 of them/);
  });
});
