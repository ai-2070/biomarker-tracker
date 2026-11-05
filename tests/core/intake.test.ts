import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_DAY, energyVsResting, intakeToPlanItems, parseLabelAmount, protocolToIntake, expandItems, foodIdeas, gapAdvice, intakeTotals, macroRows, mealsRichIn, nutrientRows, upperLimitRoom, validateIntakeItems, type IntakeItem, type PortionFood } from "@bt/shared/core/intake";
import type { FoodDb, Meal } from "@bt/shared/core/meals";
import { itemErrors } from "@bt/shared/core/plans";
import type { NutrientDef } from "@bt/shared/core/nutrients";
import type { FoodTable } from "@bt/shared/core/types";

const K = join(import.meta.dirname, "..", "..", "knowledge");
const db = JSON.parse(readFileSync(join(K, "foods", "cofid-all.json"), "utf8")) as FoodDb;
const curated = JSON.parse(readFileSync(join(K, "foods", "cofid-foods.json"), "utf8")) as FoodTable;
const nutrients = readdirSync(join(K, "nutrients")).map((f) => JSON.parse(readFileSync(join(K, "nutrients", f), "utf8")) as NutrientDef);
const portions: PortionFood[] = curated.foods.map((f) => ({ id: f.id, name: f.name, portion: f.portion! }));

// Real CoFID foods: porridge oats (dry), semi-skimmed milk, kiwi.
const oats = "11-788";
const milk = "12-313";
const kiwi = "14-371";
const breakfast: Meal = { id: "m1", name: "Porridge", items: [{ foodId: oats, grams: 40 }, { foodId: milk, grams: 200 }], createdAt: "2026-10-01T00:00:00.000Z" };
const day = (_date: string, items: IntakeItem[]): IntakeItem[] => items;

describe("daily intake", () => {
  it("validates the list", () => {
    expect(validateIntakeItems([{ id: "a", kind: "meal", mealId: "m1", portions: 1 }, { id: "b", kind: "food", foodId: kiwi, grams: 75 }])).toEqual([]);
    expect(validateIntakeItems({})).not.toEqual([]);
    expect(validateIntakeItems([{ id: "a", kind: "meal", mealId: "m1", portions: 0 }])).toContain("portions must be between 0.25 and 10");
    expect(validateIntakeItems([{ id: "a", kind: "food", foodId: kiwi, grams: 0 }]).join()).toMatch(/grams/);
    expect(validateIntakeItems([{ id: "a", kind: "drink" }]).join()).toMatch(/neither/);
  });

  it("turns meals into foods and grams, scaled by portions, and counts deleted meals", () => {
    const d = day("2026-10-29", [{ id: "a", kind: "meal", mealId: "m1", portions: 1.5 }, { id: "b", kind: "meal", mealId: "gone", portions: 1 }, { id: "c", kind: "food", foodId: kiwi, grams: 75 }]);
    expect(expandItems(d, [breakfast])).toEqual({ items: [{ foodId: oats, grams: 60 }, { foodId: milk, grams: 300 }, { foodId: kiwi, grams: 75 }], missingMeals: 1 });
  });

  it("adds up the list", () => {
    const one = intakeTotals([{ id: "a", kind: "food", foodId: kiwi, grams: 150 }], [], db);
    const two = intakeTotals([{ id: "a", kind: "food", foodId: kiwi, grams: 150 }, { id: "b", kind: "food", foodId: kiwi, grams: 150 }], [], db);
    expect(one.totals.vitaminC!.amount).toBeGreaterThan(50);
    expect(two.totals.vitaminC!.amount).toBeCloseTo(one.totals.vitaminC!.amount * 2, 6);
  });

  it("compares energy with resting energy use and EFSA's activity levels, never as a target", () => {
    expect(energyVsResting(1200, 1400)?.band).toBe("below-resting");
    expect(energyVsResting(1600, 1400)?.band).toBe("below-low-active");
    expect(energyVsResting(1960, 1400)?.band).toBe("within"); // exactly 1.4
    expect(energyVsResting(2800, 1400)?.band).toBe("within"); // exactly 2.0
    expect(energyVsResting(3200, 1400)?.band).toBe("above-very-active");
    expect(energyVsResting(2000, 0)).toBeUndefined();
  });

  it("checks macronutrients against EFSA's values: protein by weight, fat and carbohydrate as shares of energy", () => {
    const totals = { energyKcal: { amount: 2000, measuredIn: 3, of: 3 }, protein: { amount: 50, measuredIn: 3, of: 3 }, fat: { amount: 100, measuredIn: 3, of: 3 }, carbohydrate: { amount: 240, measuredIn: 3, of: 3 }, fibre: { amount: 30, measuredIn: 3, of: 3 }, sodium: { amount: 2500, measuredIn: 3, of: 3 }, sugars: { amount: 40, measuredIn: 3, of: 3 } };
    const rows = new Map(macroRows(totals, 70).map((r) => [r.key, r]));
    expect(rows.get("protein")).toMatchObject({ status: "below" }); // 0.83 × 70 = 58.1 g
    expect(rows.get("protein")!.missing).toBeCloseTo(8.1, 6);
    expect(rows.get("fat")!.energyPct).toBeCloseTo(45, 6); // 100 g × 9 / 2000
    expect(rows.get("fat")!.status).toBe("above");
    expect(rows.get("carbohydrate")!.energyPct).toBeCloseTo(45, 6); // 240 × 3.75 / 2000
    expect(rows.get("carbohydrate")!.status).toBe("within");
    expect(rows.get("fibre")!.status).toBe("within");
    expect(rows.get("sodium")!.status).toBe("above");
    expect(rows.get("sugars")!.status).toBe("as-low-as-possible");
    expect(rows.get("epaDha")!.status).toBe("not-measured");
    expect(new Map(macroRows(totals).map((r) => [r.key, r])).get("protein")!.status).toBe("needs-weight");
  });

  it("compares vitamins and minerals with the reference for the person, and upper limits only where they cover food", () => {
    const totals = intakeTotals([{ id: "a", kind: "meal", mealId: "m1", portions: 1 }, { id: "b", kind: "food", foodId: kiwi, grams: 75 }], [breakfast], db).totals;
    const rows = new Map(nutrientRows(totals, db, nutrients, { sex: "f", age: 40 }).map((r) => [r.nutrient.id, r]));
    expect(rows.get("vitamin_c")!.reference).toMatchObject({ amount: 95 });
    expect(rows.get("calcium")!.status).toBe("below");
    // Magnesium's and folate's upper limits are for supplements and folic acid only: food counts as nothing toward them.
    expect(rows.get("magnesium")!.upperLimit).toMatchObject({ from: "supplements", compared: 0 });
    expect(rows.get("folate")!.upperLimit).toMatchObject({ from: "supplements", compared: 0 });
    // Vitamin A's covers preformed vitamin A only: compared with retinol.
    const liver = nutrientRows(intakeTotals([{ id: "a", kind: "food", foodId: "18-494", grams: 100 }], [], db).totals, db, nutrients, { sex: "f", age: 40 });
    const a = liver.find((r) => r.nutrient.id === "vitamin_a")!;
    expect(a.upperLimit?.compared).toBeGreaterThan(3000);
    expect(a.status).toBe("above-upper-limit");
  });

  it("suggests foods that would close a gap, with the share after one portion, and respects safety", () => {
    const totals = intakeTotals([], [], db).totals;
    const rows = nutrientRows(totals, db, nutrients, { sex: "f", age: 40 });
    const d = rows.find((r) => r.nutrient.id === "vitamin_d")!;
    const advice = gapAdvice("vitaminD", d, portions, db, []);
    expect(advice.kind).toBe("foods");
    if (advice.kind !== "foods") return;
    expect(advice.foods[0]!.name).toMatch(/salmon|Herring|Mackerel|Sardines|liver/i);
    expect(advice.foods[0]!.adds).toBeGreaterThan(advice.foods.at(-1)!.adds - 1e-9);
    expect(advice.foods[0]!.shareAfter).toBeGreaterThan(0);
    // Pregnancy: vitamin A itself is one to talk about with a doctor; for B12, liver (high in retinol) is left out with the reason.
    const a = rows.find((r) => r.nutrient.id === "vitamin_a")!;
    expect(gapAdvice("vitaminA", a, portions, db, ["pregnancy"]).kind).toBe("talk-to-doctor");
    const b12 = rows.find((r) => r.nutrient.id === "vitamin_b12")!;
    const pregnant = gapAdvice("vitaminB12", b12, portions, db, ["pregnancy"]);
    expect(pregnant.kind === "foods" && pregnant.hidden.some((h) => /liver/i.test(h.name))).toBe(true);
    expect(pregnant.kind === "foods" && pregnant.foods.some((f) => /liver/i.test(f.name))).toBe(false);
    // Blood thinners: vitamin K gets "talk to your doctor", no foods.
    const k = rows.find((r) => r.nutrient.id === "vitamin_k")!;
    expect(gapAdvice("vitaminK1", k, portions, db, ["anticoagulant"]).kind).toBe("talk-to-doctor");
  });

  it("finds the meals with the most of a nutrient, without unsafe ones", () => {
    const fish: Meal = { id: "m2", name: "Salmon", items: [{ foodId: "16-418", grams: 100 }], createdAt: "2026-10-01T00:00:00.000Z" };
    // The porridge has no measured vitamin D, so it isn't listed.
    expect(mealsRichIn("vitaminD", [breakfast, fish], db, []).map((x) => x.meal.id)).toEqual(["m2"]);
    expect(mealsRichIn("calcium", [breakfast, fish], db, []).map((x) => x.meal.id)).toContain("m1");
    const spinach: Meal = { id: "m3", name: "Spinach", items: [{ foodId: "13-573", grams: 160 }], createdAt: "2026-10-01T00:00:00.000Z" };
    expect(mealsRichIn("vitaminK1", [spinach], db, ["anticoagulant"])).toEqual([]);
  });

  it("suggests foods for protein, fibre and omega-3 too, with the share of the reference after one portion", () => {
    const fibre = foodIdeas("fibre", 10, 25, portions, db, []);
    expect(fibre.foods.length).toBe(3);
    expect(fibre.foods[0]!.shareAfter).toBe(Math.round(((10 + fibre.foods[0]!.adds) / 25) * 100));
    expect(foodIdeas("epaDha", 0, 0.25, portions, db, []).foods[0]!.name).toMatch(/salmon|Herring|Mackerel|Sardines/i);
  });

  it("never suggests a food whose one portion would go above a safe upper limit", () => {
    const totals = intakeTotals([], [], db).totals;
    const rows = nutrientRows(totals, db, nutrients, { sex: "f", age: 40 });
    const room = upperLimitRoom(rows);
    expect(room.retinol!.room).toBe(3000);
    // Liver is the richest food in vitamin A, B12 and folate, but 100 g has far more retinol than 3000 µg.
    for (const [key, id] of [["vitaminA", "vitamin_a"], ["vitaminB12", "vitamin_b12"], ["folate", "folate"]] as const) {
      const a = gapAdvice(key, rows.find((r) => r.nutrient.id === id)!, portions, db, [], room);
      expect(a.kind === "foods" && a.foods.some((f) => /liver/i.test(f.name)), key).toBe(false);
      expect(a.kind === "foods" && a.hidden.some((h) => /liver/i.test(h.name) && /upper limit for vitamin a/i.test(h.reason)), key).toBe(true);
    }
  });

  it("has an ordinary example day of real foods", () => {
    const items: IntakeItem[] = EXAMPLE_DAY.map(([foodId, grams], i) => ({ id: String(i), kind: "food", foodId, grams }));
    expect(validateIntakeItems(items)).toEqual([]);
    for (const [id] of EXAMPLE_DAY) expect(db.foods.some((f) => f[0] === id), id).toBe(true);
    // Within what most adults use for the example person (resting about 1,320 kcal).
    const kcal = intakeTotals(items, [], db).totals.energyKcal!.amount;
    expect(energyVsResting(kcal, 1320)?.band).toBe("within");
  });

  it("adds the person's supplements: folic acid as 1.7 × DFE, vitamin A as retinol, omega-3 from mg", () => {
    const base = intakeTotals([{ id: "a", kind: "food", foodId: kiwi, grams: 75 }], [], db).totals;
    const r = intakeTotals(
      [
        { id: "a", kind: "food", foodId: kiwi, grams: 75 },
        { id: "s1", kind: "supplement", nutrient: "folate", amount: 400 },
        { id: "s2", kind: "supplement", nutrient: "vitaminA", amount: 800 },
        { id: "s3", kind: "supplement", nutrient: "epaDha", amount: 500 },
        { id: "s4", kind: "supplement", nutrient: "vitaminD", amount: 10 },
        { id: "s5", kind: "supplement", nutrient: "vitaminD", amount: 15 },
      ],
      [],
      db,
    );
    expect(r.totals.folate!.amount).toBeCloseTo(base.folate!.amount + 680, 6);
    expect(r.totals.retinol!.amount).toBeCloseTo((base.retinol?.measuredIn ? base.retinol.amount : 0) + 800, 6);
    expect(r.totals.epaDha!.amount).toBeCloseTo((base.epaDha?.measuredIn ? base.epaDha.amount : 0) + 0.5, 6);
    expect(r.supplements).toEqual({ folate: 400, vitaminA: 800, epaDha: 500, vitaminD: 25 });
    expect(r.totals.vitaminD!.measuredIn).toBe((base.vitaminD?.measuredIn ?? 0) + 1);
    expect(validateIntakeItems([{ id: "x", kind: "supplement", nutrient: "creatine", amount: 5 }]).join()).toMatch(/known nutrient/);
    expect(validateIntakeItems([{ id: "x", kind: "supplement", nutrient: "vitaminD", amount: 0 }]).join()).toMatch(/more than 0/);
  });

  it("checks supplement-only upper limits against the supplements: magnesium and folic acid", () => {
    const r = intakeTotals([{ id: "s", kind: "supplement", nutrient: "magnesium", amount: 400 }, { id: "f", kind: "supplement", nutrient: "folate", amount: 400 }], [], db);
    const rows = new Map(nutrientRows(r.totals, db, nutrients, { sex: "f", age: 40 }, r.supplements).map((x) => [x.nutrient.id, x]));
    expect(rows.get("magnesium")!.upperLimit).toMatchObject({ amount: 250, compared: 400, from: "supplements" });
    expect(rows.get("magnesium")!.status).toBe("above-upper-limit");
    // 400 µg of folic acid is under 1000; the DFE total is 680 µg, which is what the reference uses.
    expect(rows.get("folate")!.upperLimit).toMatchObject({ amount: 1000, compared: 400, from: "supplements" });
    expect(rows.get("folate")!.status).toBe("met");
    // Magnesium in food never counts toward that limit, and the limit never hides magnesium-rich foods.
    const food = intakeTotals([{ id: "a", kind: "food", foodId: "14-842", grams: 300 }], [], db);
    const m = nutrientRows(food.totals, db, nutrients, { sex: "f", age: 40 }, food.supplements).find((x) => x.nutrient.id === "magnesium")!;
    expect(m.upperLimit?.compared).toBe(0);
    expect(upperLimitRoom([m])).toEqual({});
  });

  it("turns the list into protocol items, copying amounts as entered", () => {
    let n = 0;
    const items = intakeToPlanItems(
      [
        { id: "a", kind: "meal", mealId: "m1", portions: 1.5 },
        { id: "b", kind: "meal", mealId: "gone", portions: 1 },
        { id: "c", kind: "food", foodId: kiwi, grams: 75 },
        { id: "d", kind: "supplement", nutrient: "vitaminD", amount: 25, name: "Vitamin D3" },
        { id: "e", kind: "supplement", nutrient: "magnesium", amount: 200 },
      ],
      [breakfast],
      db,
      () => `p${++n}`,
    );
    expect(items.map((i) => [i.label, i.amount, i.category, i.when])).toEqual([
      ["Porridge", "1.5 portions", "diet", "any time"],
      ["Kiwi fruit, flesh only, raw", "75 g", "diet", "any time"],
      ["Vitamin D3", "25 µg", "supplement", "any time"],
      ["Magnesium", "200 mg", "supplement", "any time"],
    ]);
    expect(items[0]!.mealId).toBe("m1");
    for (const i of items) expect(itemErrors(i)).toEqual([]);
  });

  it("reads a protocol item's amount only when it's written plainly in the right unit", () => {
    expect(parseLabelAmount("25 µg", "µg")).toBe(25);
    expect(parseLabelAmount("25 mcg", "µg")).toBe(25);
    expect(parseLabelAmount("1,000 µg", "µg")).toBe(1000);
    expect(parseLabelAmount("2,5 mg", "mg")).toBe(2.5);
    expect(parseLabelAmount("400mg", "mg")).toBe(400);
    expect(parseLabelAmount("2000 IU", "µg")).toBeUndefined();
    expect(parseLabelAmount("25 µg", "mg")).toBeUndefined();
    expect(parseLabelAmount("1 capsule", "mg")).toBeUndefined();
    expect(parseLabelAmount(undefined, "mg")).toBeUndefined();
  });

  describe("loading a protocol", () => {
    let n = 0;
    const id = () => `i${++n}`;
    const item = (label: string, category: "supplement" | "diet" | "medication" | "lifestyle", amount?: string, extra = {}) => ({ id: label, label, category, when: "morning" as const, ...(amount ? { amount } : {}), ...extra });

    it("brings in meals, table foods and supplements written in their unit", () => {
      const r = protocolToIntake(
        { id: "p", items: [item("Porridge", "diet", "2 portions", { mealId: "m1" }), item("Kiwi fruit, flesh and seeds", "diet", "75 g"), item("Vitamin D3", "supplement", "25 µg"), item("Magnesium", "supplement", "1,000 mg")] },
        [breakfast],
        { ...db, foods: db.foods.map((f) => (f[0] === kiwi ? ([f[0], "Kiwi fruit, flesh and seeds", ...f.slice(2)] as typeof f) : f)) },
        nutrients,
        id,
      );
      expect(r.items.map((i) => i.kind)).toEqual(["meal", "food", "supplement", "supplement"]);
      expect(r.items[0]).toMatchObject({ mealId: "m1", portions: 2 });
      expect(r.items[1]).toMatchObject({ foodId: kiwi, grams: 75 });
      expect(r.items[2]).toMatchObject({ nutrient: "vitaminD", amount: 25, name: "Vitamin D3" });
      expect(r.items[3]).toMatchObject({ nutrient: "magnesium", amount: 1000 });
      expect(r.needsAmount).toEqual([]);
    });

    it("asks for an amount instead of converting or guessing one", () => {
      const r = protocolToIntake({ id: "p", items: [item("Vitamin D3", "supplement", "2000 IU"), item("Zinc", "supplement"), item("Fish oil", "supplement", "2 capsules")] }, [], db, nutrients, id);
      expect(r.items).toEqual([]);
      expect(r.needsAmount).toEqual([
        { planId: "p", itemId: "Vitamin D3", label: "Vitamin D3", key: "vitaminD", unit: "µg", written: "2000 IU" },
        { planId: "p", itemId: "Zinc", label: "Zinc", key: "zinc", unit: "mg" },
        { planId: "p", itemId: "Fish oil", label: "Fish oil", key: "epaDha", unit: "mg", written: "2 capsules" },
      ]);
    });

    it("leaves out what isn't food or a counted nutrient, with the reason", () => {
      const r = protocolToIntake(
        { id: "p", items: [item("Creatine", "supplement", "5 g"), item("Multivitamin", "supplement"), item("Metformin", "medication"), item("Sauna", "lifestyle"), item("Gone meal", "diet", undefined, { mealId: "x" }), item("Less sugar", "diet")] },
        [breakfast],
        db,
        nutrients,
        id,
      );
      expect(r.items).toEqual([]);
      expect(r.skipped.map((s) => s.label)).toEqual(["Creatine", "Multivitamin", "Metformin", "Sauna", "Gone meal", "Less sugar"]);
      expect(r.skipped[0]!.reason).toMatch(/not one of the vitamins, minerals or omega-3/);
      expect(r.skipped[1]!.reason).toMatch(/add each one from its label/);
    });

    it("reads back what the analyzer writes into a protocol", () => {
      const list: IntakeItem[] = [
        { id: "a", kind: "meal", mealId: "m1", portions: 1.5 },
        { id: "c", kind: "food", foodId: kiwi, grams: 75 },
        { id: "d", kind: "supplement", nutrient: "vitaminD", amount: 25, name: "Vitamin D3" },
      ];
      const plan = { id: "p", items: intakeToPlanItems(list, [breakfast], db, id) };
      const back = protocolToIntake(plan, [breakfast], db, nutrients, id).items.map(({ id: _id, ...rest }) => rest);
      expect(back).toEqual(list.map(({ id: _id, ...rest }) => rest));
    });
  });
});
