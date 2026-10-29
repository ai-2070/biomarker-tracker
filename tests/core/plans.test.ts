import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NutrientDef } from "../../src/core/nutrients";
import { habitsForPlan, itemsByTime, nutrientFor, pairWarnings, planFromFile, planToFile, validatePlan, type Plan } from "../../src/core/plans";

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
      ["with meals", ["b", "c"]],
      ["evening", ["d"]],
    ]);
  });

  it("links supplements to the vitamins and minerals knowledge base by name or form", () => {
    expect(nutrientFor(plan.items[0]!, nutrients)?.id).toBe("vitamin_d");
    expect(nutrientFor(plan.items[1]!, nutrients)?.id).toBe("iron");
    expect(nutrientFor({ label: "Vitamin B12 (methylcobalamin)", category: "supplement" }, nutrients)?.id).toBe("vitamin_b12");
    expect(nutrientFor({ label: "Folic acid", category: "supplement" }, nutrients)?.id).toBe("folate");
    expect(nutrientFor({ label: "Magnesium glycinate", category: "supplement" }, nutrients)?.id).toBe("magnesium");
    expect(nutrientFor(plan.items[4]!, nutrients)).toBeUndefined();
    expect(nutrientFor({ label: "Iron", category: "lifestyle" }, nutrients)).toBeUndefined();
  });

  it("warns about interactions between items of the same protocol", () => {
    const w = pairWarnings(plan, nutrients);
    expect(w.some((x) => [x.a, x.b].sort().join("+") === "Calcium+Iron")).toBe(true);
    expect(pairWarnings({ ...plan, items: [plan.items[0]!, plan.items[3]!] }, nutrients)).toEqual([]);
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

  it("turns each item into a habit with the person's own amount", () => {
    expect(habitsForPlan(plan, "2026-11-01").slice(0, 2)).toEqual([
      { label: "Vitamin D3 1000 IU", category: "supplement", start: "2026-11-01" },
      { label: "Iron bisglycinate", category: "supplement", start: "2026-11-01" },
    ]);
  });
});
