import { applyChanges, type BrainChange, type BrainData, parseChangeRequest } from "@bt/shared/core/brainChanges";
import type { Plan } from "@bt/shared/core/plans";
import { describe, expect, it } from "vitest";
import { loadDefs, measurement } from "../helpers";

const defs = loadDefs();
const today = "2026-11-27";
let n = 0;
const ctx = (userText: string) => ({ userText, today, defs, newId: () => `new-${++n}` });
const run = (data: BrainData, userText: string, ...changes: BrainChange[]) => applyChanges(data, { quote: userText, changes }, ctx(userText));

const plan: Plan = {
  id: "plan-1",
  name: "Morning routine",
  items: [{ id: "i1", label: "Walk", category: "lifestyle", when: "morning" }],
  createdAt: "2026-01-01",
};

function data(): BrainData {
  return {
    measurements: [
      measurement({ id: "m1", biomarkerId: "ferritin", date: "2025-03-12", value: 45, originalValue: 45, originalUnit: "µg/L" }),
      measurement({ id: "m2", biomarkerId: "ferritin", date: "2025-09-01", value: 60, originalValue: 60, originalUnit: "µg/L" }),
      measurement({ id: "m3", biomarkerId: "hba1c", date: "2025-03-12", value: 5.4, originalValue: 5.4, originalUnit: "%" }),
    ],
    protocols: [{ id: "h1", label: "Vitamin D3", category: "supplement", start: "2026-10-01" }],
    experiments: [
      { id: "e1", change: "Vitamin D3", category: "supplement", markerIds: ["vitamin_d"], start: "2026-10-01", retestAfterDays: 56, protocolId: "h1" },
    ],
    plans: [plan],
    meals: [{ id: "meal-1", name: "Oat breakfast", items: [], createdAt: "2026-01-01" }],
    profile: { sex: "m", heightCm: 180 },
  };
}

describe("brain changes: the person's own words", () => {
  it("refuses without a typed request or with a quote that isn't in it", () => {
    const c: BrainChange = { kind: "delete_results", marker: "ferritin", date: "2025-03-12" };
    expect(applyChanges(data(), { quote: "delete it", changes: [c] }, ctx(""))).toMatchObject({ ok: false });
    const r = applyChanges(data(), { quote: "delete my ferritin", changes: [c] }, ctx("what does ferritin mean?"));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain("own words");
  });
  it("accepts a quote that differs only in case, spaces and apostrophes", () => {
    const r = applyChanges(
      data(),
      { quote: "delete   my ferritin's result", changes: [{ kind: "delete_results", marker: "ferritin", date: "2025-03-12" }] },
      ctx("Please Delete my ferritin’s result from 12 March"),
    );
    expect(r.ok).toBe(true);
  });
  it("checks the request's shape", () => {
    expect(parseChangeRequest({ quote: "x", changes: [{ kind: "format_disk" }] })).toContain("Unknown change");
    expect(parseChangeRequest({ quote: "", changes: [] })).toContain("Quote");
    expect(parseChangeRequest({ quote: "save them", changes: [{ kind: "save_open_card" }] })).toEqual({
      quote: "save them",
      changes: [{ kind: "save_open_card" }],
    });
  });
});

describe("brain changes: results", () => {
  it("deletes a marker's result on a date, and never touches the input", () => {
    const before = data();
    const r = run(before, "delete my ferritin from 12 March", { kind: "delete_results", marker: "ferritin", date: "2025-03-12" });
    expect(r.ok && r.data.measurements.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(r.ok && r.done[0]).toContain("Deleted Ferritin");
    expect(before.measurements).toHaveLength(3);
  });
  it("deletes a whole test by date, and says which dates exist when nothing matches", () => {
    const all = run(data(), "delete the test from 12 March", { kind: "delete_results", date: "2025-03-12" });
    expect(all.ok && all.data.measurements.map((m) => m.id)).toEqual(["m2"]);
    const none = run(data(), "delete ferritin from May", { kind: "delete_results", marker: "ferritin", date: "2025-05-01" });
    expect(!none.ok && none.error).toContain("2025-03-12, 2025-09-01");
  });
  it("adds typed results in the unit given, and doesn't add the same one twice", () => {
    const r = run(data(), "my ferritin was 52 and hba1c 39 mmol/mol on 1 Nov", {
      kind: "add_results",
      date: "2026-11-01",
      results: [
        { marker: "ferritin", value: "52" },
        { marker: "HbA1c", value: "39", unit: "mmol/mol" },
      ],
    });
    expect(r.ok).toBe(true);
    const added = r.ok ? r.data.measurements.slice(3) : [];
    expect(added.map((m) => [m.biomarkerId, m.originalUnit, m.source])).toEqual([
      ["ferritin", "µg/L", "manual"],
      ["hba1c", "mmol/mol", "manual"],
    ]);
    const again = run(data(), "ferritin 45 on 12 March", { kind: "add_results", date: "2025-03-12", results: [{ marker: "ferritin", value: "45" }] });
    expect(again.ok && again.data.measurements).toHaveLength(3);
    expect(again.ok && again.done[0]).toContain("already saved");
  });
  it("refuses unknown markers, bad values and future dates, all or nothing", () => {
    const r = run(
      data(),
      "add these",
      { kind: "delete_results", marker: "ferritin", date: "2025-03-12" },
      { kind: "add_results", date: "2026-11-01", results: [{ marker: "PTH", value: "4" }] },
    );
    expect(!r.ok && r.error).toContain("doesn't track");
    expect(run(data(), "add", { kind: "add_results", date: "2027-01-01", results: [{ marker: "ferritin", value: "4" }] }).ok).toBe(false);
    expect(run(data(), "add", { kind: "add_results", date: "2026-11-01", results: [{ marker: "ferritin", value: "lots" }] }).ok).toBe(false);
  });
  it("edits one result, keeping its identity, and asks which when several match", () => {
    const r = run(data(), "change my ferritin from 12 March to 54", { kind: "edit_result", marker: "ferritin", date: "2025-03-12", value: "54" });
    const m1 = r.ok ? r.data.measurements.find((m) => m.id === "m1") : undefined;
    expect(m1).toMatchObject({ id: "m1", value: 54, originalValue: 54, originalUnit: "µg/L", date: "2025-03-12" });
    const many = run(data(), "change ferritin", { kind: "edit_result", marker: "ferritin", value: "54" });
    expect(!many.ok && many.error).toContain("marker and the date");
  });
});

describe("brain changes: habits and protocols", () => {
  it("records a medicine the person says they take, with watched markers", () => {
    const r = run(data(), "log my metformin 500 mg from today and watch hba1c", {
      kind: "start_habit",
      label: "Metformin 500 mg",
      category: "medication",
      watch: ["hba1c"],
    });
    expect(r.ok).toBe(true);
    const h = r.ok ? r.data.protocols.at(-1) : undefined;
    expect(h).toMatchObject({ label: "Metformin 500 mg", category: "medication", start: today });
    expect(r.ok && r.data.experiments.at(-1)).toMatchObject({ protocolId: h?.id, markerIds: ["hba1c"], retestAfterDays: 84 });
  });
  it("stops, edits and deletes a habit by name, keeping its watch in step", () => {
    const stopped = run(data(), "stop vitamin d3", { kind: "stop_habit", habit: "vitamin d3" });
    expect(stopped.ok && stopped.data.protocols[0]).toMatchObject({ end: today });
    expect(stopped.ok && stopped.data.experiments[0]).toMatchObject({ end: today });
    const edited = run(data(), "rename it", { kind: "edit_habit", habit: "h1", label: "Vitamin D3 2000 IU" });
    expect(edited.ok && edited.data.experiments[0]?.change).toBe("Vitamin D3 2000 IU");
    const deleted = run(data(), "delete the vitamin d habit", { kind: "delete_habit", habit: "Vitamin D" });
    expect(deleted.ok && [deleted.data.protocols.length, deleted.data.experiments.length]).toEqual([0, 0]);
  });
  it("gives a habit its days, keeps them through edits, and changes them only when asked", () => {
    const r = run(data(), "I run on monday wednesday and friday", {
      kind: "start_habit",
      label: "Running",
      category: "lifestyle",
      days: ["fri", "mon", "wed"],
    });
    expect(r.ok && r.data.protocols.at(-1)).toMatchObject({ label: "Running", days: ["mon", "wed", "fri"] });
    expect(r.ok && r.done[0]).toContain("mon, wed, fri");
    const id = r.ok ? r.data.protocols.at(-1)!.id : "";
    const renamed = r.ok ? run(r.data, "call it jogging", { kind: "edit_habit", habit: id, label: "Jogging" }) : r;
    expect(renamed.ok && renamed.data.protocols.at(-1)).toMatchObject({ label: "Jogging", days: ["mon", "wed", "fri"] });
    const other = renamed.ok ? run(renamed.data, "make it every other day", { kind: "edit_habit", habit: id, everyOtherDay: true }) : renamed;
    expect(other.ok && other.data.protocols.at(-1)).toMatchObject({ every: 2 });
    expect(other.ok && other.data.protocols.at(-1)!.days).toBeUndefined();
    const daily = other.ok ? run(other.data, "every day now", { kind: "edit_habit", habit: id, days: [] }) : other;
    expect(daily.ok && [daily.data.protocols.at(-1)!.days, daily.data.protocols.at(-1)!.every]).toEqual([undefined, undefined]);
    expect(run(data(), "run on funday", { kind: "start_habit", label: "Run", category: "lifestyle", days: ["fun"] })).toMatchObject({ ok: false });
    const both = run(data(), "both", { kind: "start_habit", label: "Run", category: "lifestyle", days: ["mon"], everyOtherDay: true });
    expect(!both.ok && both.error).toContain("not both");
  });
  it("ticks a habit, a protocol's items by name, or an item named on its own, and unticks", () => {
    const base = data();
    base.protocols.push({
      id: "h2",
      label: "Supplements through the day",
      category: "supplement",
      start: "2026-11-01",
      plan: {
        id: "p2",
        items: [
          { id: "d3", label: "Vitamin D3", category: "supplement", when: "morning" },
          { id: "o3", label: "Omega-3", category: "supplement", when: "midday" },
        ],
      },
    });
    const plain = run(base, "did my vitamin d3 habit", { kind: "tick", habit: "h1" });
    expect(plain.ok && plain.data.checkins).toEqual([{ id: `h1|${today}`, habitId: "h1", date: today }]);
    const item = run(base, "I took my omega-3", { kind: "tick", habit: "omega-3" });
    expect(item.ok && item.data.checkins).toEqual([{ id: `h2|${today}`, habitId: "h2", date: today, items: ["o3"] }]);
    expect(item.ok && item.done[0]).toBe("Ticked Omega-3 (Supplements through the day) for today.");
    const all = run(base, "did all my supplements yesterday", { kind: "tick", habit: "Supplements through the day", date: "2026-11-26" });
    expect(all.ok && all.data.checkins?.[0]?.items).toEqual(["d3", "o3"]);
    const undone = item.ok ? run(item.data, "actually I didn't take the omega-3", { kind: "tick", habit: "h2", items: ["omega"], untick: true }) : item;
    expect(undone.ok && undone.data.checkins).toEqual([]);
    expect(run(base, "tick tomorrow", { kind: "tick", habit: "h1", date: "2026-11-28" })).toMatchObject({ ok: false });
    // Deleting a habit removes its ticks.
    const gone = plain.ok ? run(plain.data, "delete vitamin d3", { kind: "delete_habit", habit: "h1" }) : plain;
    expect(gone.ok && gone.data.checkins).toEqual([]);
  });
  it("starts and stops a saved protocol", () => {
    const started = run(data(), "start my morning routine", { kind: "start_protocol", protocol: "morning routine" });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const habit = started.data.protocols.at(-1)!;
    expect(started.data.plans[0]?.active).toEqual({ since: today, habitIds: [habit.id] });
    const again = applyChanges(started.data, { quote: "start it", changes: [{ kind: "start_protocol", protocol: "plan-1" }] }, ctx("start it"));
    expect(!again.ok && again.error).toContain("already running");
    const stopped = applyChanges(
      started.data,
      { quote: "stop", changes: [{ kind: "stop_protocol", protocol: "Morning routine", date: today }] },
      ctx("stop the routine"),
    );
    expect(stopped.ok && stopped.data.plans[0]?.active).toBeUndefined();
    expect(stopped.ok && stopped.data.protocols.find((p) => p.id === habit.id)?.end).toBe(today);
  });
  it("deletes a meal and lists the saved ones when the name doesn't match", () => {
    expect(run(data(), "delete my oat breakfast", { kind: "delete_meal", meal: "oat breakfast" }).ok).toBe(true);
    const r = run(data(), "delete pizza", { kind: "delete_meal", meal: "pizza" });
    expect(!r.ok && r.error).toContain("Oat breakfast");
  });
});

describe("brain changes: profile", () => {
  it("sets and overwrites fields, and refuses bad values", () => {
    const r = run(
      data(),
      "I'm 182 cm, I'm a vegetarian now and I live in Austria",
      { kind: "set_profile", field: "heightCm", value: 182 },
      { kind: "set_profile", field: "diet", value: "Vegetarian" },
      { kind: "set_profile", field: "country", value: "at" },
    );
    expect(r.ok && r.data.profile).toEqual({ sex: "m", heightCm: 182, diet: "vegetarian", country: "AT" });
    expect(run(data(), "I'm 3 m tall", { kind: "set_profile", field: "heightCm", value: 300 }).ok).toBe(false);
    expect(run(data(), "born 2030", { kind: "set_profile", field: "birthMonth", value: "2030-01" }).ok).toBe(false);
    const cleared = run(data(), "remove my height", { kind: "set_profile", field: "heightCm", value: null });
    expect(cleared.ok && cleared.data.profile).toEqual({ sex: "m" });
  });
  it("never sets the name or private notes", () => {
    const r = run(data(), "call me Sam", { kind: "set_profile", field: "name" as "sex", value: "Sam" });
    expect(r.ok).toBe(false);
  });
});

describe("brain changes: the open card", () => {
  it("flags saving the open review card without changing data", () => {
    const r = run(data(), "save them", { kind: "save_open_card" });
    expect(r).toMatchObject({ ok: true, saveOpenCard: true, done: [] });
  });
});
