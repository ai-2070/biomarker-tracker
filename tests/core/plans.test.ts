import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NutrientDef } from "@bt/shared/core/nutrients";
import {
  daysLabel,
  habitForPlan,
  itemErrors,
  itemsByTime,
  normalizeItem,
  nutrientFor,
  type Plan,
  pairWarnings,
  planFromFile,
  planFromProposal,
  planToFile,
  scheduleLabel,
  validatePlan,
} from "@bt/shared/core/plans";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "..", "..", "knowledge", "nutrients");
const nutrients = readdirSync(DIR).map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as NutrientDef);

let n = 0;
const id = () => `id-${++n}`;
const plan: Plan = {
  id: "p1",
  name: "Morning stack",
  description: "What I take.",
  items: [
    { id: "a", label: "Vitamin D3", amount: "1000 IU", category: "supplement", when: "morning" },
    { id: "b", label: "Iron bisglycinate", category: "supplement", when: "with meals" },
    { id: "c", label: "Calcium carbonate", amount: "500 mg", category: "supplement", when: "with meals" },
    { id: "d", label: "Zone 2 cardio", amount: "45 min", category: "lifestyle", when: "evening", note: "Easy pace" },
    { id: "e", label: "Fish oil", category: "supplement", when: "morning" },
  ],
  createdAt: "2026-10-29T10:00:00.000Z",
};

describe("protocols", () => {
  it("accepts a valid protocol and rejects broken ones", () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(validatePlan({ ...plan, name: "" })).toContain("the protocol needs a name");
    expect(validatePlan({ ...plan, items: [{ ...plan.items[0], when: "noon" }] })).toContain("item time is invalid");
    expect(validatePlan({ ...plan, active: { since: "soon", habitIds: [] } })).toContain("active is damaged");
  });

  it("groups items by time of day, in the day's order", () => {
    expect(itemsByTime(plan).map((g) => [g.when, g.items.map((i) => i.id)])).toEqual([
      ["morning", ["a", "e"]],
      ["evening", ["d"]],
      // Old "with meals" items: any time, taken with a meal.
      ["any time", ["b", "c"]],
    ]);
    expect(
      itemsByTime(plan)
        .at(-1)!
        .items.every((i) => i.withFood),
    ).toBe(true);
  });

  it("links supplements to the vitamins and minerals knowledge base by name or form", () => {
    expect(nutrientFor(plan.items[0]!, nutrients)?.id).toBe("vitamin_d");
    expect(nutrientFor(plan.items[1]!, nutrients)?.id).toBe("iron");
    expect(nutrientFor({ label: "Vitamin B12 (methylcobalamin)", category: "supplement" }, nutrients)?.id).toBe("vitamin_b12");
    expect(nutrientFor({ label: "Folic acid", category: "supplement" }, nutrients)?.id).toBe("folate");
    expect(nutrientFor({ label: "Magnesium glycinate", category: "supplement" }, nutrients)?.id).toBe("magnesium");
    // Other supplements link too: "Fish oil" is a name of omega-3.
    expect(nutrientFor(plan.items[4]!, nutrients)?.id).toBe("omega_3");
    expect(nutrientFor({ label: "Iron", category: "lifestyle" }, nutrients)).toBeUndefined();
  });

  it("warns about interactions between items of the same protocol", () => {
    const w = pairWarnings(plan, nutrients);
    expect(w.some((x) => [x.a, x.b].sort().join("+") === "Calcium+Iron")).toBe(true);
    expect(pairWarnings({ ...plan, items: [plan.items[0]!, plan.items[3]!] }, nutrients)).toEqual([]);
  });

  it("keeps a link to one of the person's meals, but not in a shared file", () => {
    const withMeal = {
      ...plan,
      items: [...plan.items, { id: "m", label: "Lentil soup", category: "diet" as const, when: "midday" as const, mealId: "meal-1" }],
    };
    expect(validatePlan(withMeal)).toEqual([]);
    expect(validatePlan({ ...withMeal, items: [{ ...withMeal.items.at(-1)!, mealId: 5 }] })).not.toEqual([]);
    const file = planToFile(withMeal);
    expect(file).toContain("Lentil soup");
    expect(file).not.toContain("meal-1");
    const r = planFromFile(file.replace('"Lentil soup"', '"Lentil soup", "mealId": "someone-else"'), id, "2026-10-30T00:00:00.000Z");
    expect(r.ok && r.plan.items.some((i) => "mealId" in i)).toBe(false);
  });

  it("shares as a file without ids or habits, and loads back with new ids", () => {
    const file = planToFile({ ...plan, active: { since: "2026-10-01", habitIds: ["h1"] } });
    expect(file).not.toMatch(/"id"|habitIds|createdAt/);
    const r = planFromFile(file, id, "2026-10-30T00:00:00.000Z");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.name).toBe("Morning stack");
    expect(r.plan.items.map((i) => i.label)).toEqual(plan.items.map((i) => i.label));
    expect(new Set([r.plan.id, ...r.plan.items.map((i) => i.id)]).size).toBe(6);
    expect(r.plan.active).toBeUndefined();
    expect(planFromFile("{", id, "x")).toMatchObject({ ok: false });
    expect(planFromFile('{"kind":"other"}', id, "x")).toMatchObject({ ok: false });
    expect(planFromFile(JSON.stringify({ kind: "biomarker-tracker-protocol", version: 1, name: "", items: [] }), id, "x")).toMatchObject({ ok: false });
  });

  it("builds a protocol Brain wrote down from the person's text, with fresh ids, never running", () => {
    const r = planFromProposal(
      {
        name: " Standard Routine ",
        items: [
          { label: "Creatine", category: "supplement", when: "morning" },
          { label: "Iron", category: "supplement", when: "evening", note: "Only if deficient", amount: " " },
        ],
        active: { since: "2026-01-01", habitIds: [] },
      },
      id,
      "2026-10-29T00:00:00.000Z",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.name).toBe("Standard Routine");
    expect(r.plan.items[1]).toEqual({ id: expect.any(String), label: "Iron", category: "supplement", when: "evening", note: "Only if deficient" });
    expect(r.plan.active).toBeUndefined();
    expect(planFromProposal({ name: "X", items: [] }, id, "x")).toMatchObject({ ok: false });
    expect(planFromProposal({ name: "X", items: [{ label: "A", category: "supplement", when: "noon" }] }, id, "x")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/time/),
    });
  });

  it("starts the whole routine as one named habit and preserves its complete item snapshot", () => {
    const source: Plan = { ...plan, items: [{ ...plan.items[0]!, withFood: true, days: ["fri", "mon"], note: "My own amount" }, ...plan.items.slice(1)] };
    const habit = habitForPlan(source, "2026-11-01");
    expect(habit).toMatchObject({ label: "Morning stack", category: "lifestyle", start: "2026-11-01", plan: { id: "p1" } });
    expect(habit.plan!.items[1]).toMatchObject({ label: "Iron bisglycinate", when: "any time", withFood: true });
    source.items[0]!.label = "Changed later";
    source.items[0]!.days!.push("sun");
    expect(habit.plan!.items[0]).toMatchObject({ label: "Vitamin D3", amount: "1000 IU", days: ["mon", "fri"], withFood: true, note: "My own amount" });
    expect(habitForPlan({ ...plan, items: [plan.items[1]!] }, "2026-11-01").category).toBe("supplement");
  });

  it("keeps 'with a meal' and days of the week apart from the time of day, and reads old 'with meals' items", () => {
    const old = { id: "x", label: "Iron", category: "supplement" as const, when: "with meals" as const };
    expect(normalizeItem(old)).toEqual({ id: "x", label: "Iron", category: "supplement", when: "any time", withFood: true });
    expect(normalizeItem({ ...old, when: "morning", withFood: true, days: ["fri", "mon", "wed"] })).toMatchObject({
      when: "morning",
      withFood: true,
      days: ["mon", "wed", "fri"],
    });
    expect(normalizeItem({ ...old, when: "morning", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] })).not.toHaveProperty("days");
    expect(daysLabel(["mon", "wed", "fri"])).toBe("Mon, Wed, Fri");
    expect(daysLabel(["mon", "tue", "wed", "thu", "fri"])).toBe("Weekdays");
    expect(daysLabel(["sun", "sat"])).toBe("Weekends");
    expect(daysLabel(undefined)).toBeUndefined();
    expect(itemErrors({ ...old, when: "morning", days: ["mon", "mon"] })).toContain("the days of the week are invalid");
    expect(itemErrors({ ...old, when: "morning", days: ["someday"] })).toContain("the days of the week are invalid");
    expect(itemErrors({ ...old, when: "morning", withFood: "yes" })).not.toEqual([]);
    expect(itemErrors({ ...old, when: "morning", withFood: true, days: ["sat"] })).toEqual([]);
  });
});

describe("every other day", () => {
  it("is read from Brain's proposal and labelled, never together with weekdays", () => {
    let n = 0;
    const r = planFromProposal(
      { name: "Red light", items: [{ label: "Red light panel", category: "lifestyle", when: "evening", everyOtherDay: true, days: ["mon"] }] },
      () => `id-${++n}`,
      "2026-11-28T00:00:00Z",
    );
    expect(r.ok && r.plan.items[0]).toMatchObject({ every: 2 });
    expect(r.ok && r.plan.items[0]!.days).toBeUndefined();
    expect(scheduleLabel({ every: 2 })).toBe("Every other day");
    expect(itemErrors({ id: "x", label: "Sauna", category: "lifestyle", when: "evening", every: 3 })).toContain("'every other day' is invalid");
  });
});
