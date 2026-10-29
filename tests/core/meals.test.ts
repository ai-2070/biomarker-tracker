import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAFETY_LIMITS } from "../../src/core/foods";
import { adultReference, foodById, mealSafetyBlock, mealTotals, saltFromSodium, searchFoods, shareOfReference, validateExampleMeals, validateMeal, type ExampleMeal, type FoodDb } from "../../src/core/meals";
import type { NutrientDef } from "../../src/core/nutrients";
import type { FoodTable } from "../../src/core/types";

const K = join(import.meta.dirname, "..", "..", "knowledge");
const db = JSON.parse(readFileSync(join(K, "foods", "cofid-all.json"), "utf8")) as FoodDb;
const curated = JSON.parse(readFileSync(join(K, "foods", "cofid-foods.json"), "utf8")) as FoodTable;
const nutrients = new Map(readdirSync(join(K, "nutrients")).map((f) => [f.replace(".json", ""), JSON.parse(readFileSync(join(K, "nutrients", f), "utf8")) as NutrientDef]));

describe("the full food table", () => {
  it("has every CoFID food, with units for every nutrient and values per food", () => {
    expect(db.foods.length).toBeGreaterThan(2800);
    expect(new Set(db.foods.map((f) => f[0])).size).toBe(db.foods.length);
    for (const k of db.keys) expect(db.nutrients[k]?.unit, k).toBeTruthy();
    for (const f of db.foods) expect(f[2]).toHaveLength(db.keys.length);
  });
  it("agrees with the curated table, which was extracted from the same spreadsheet", () => {
    for (const food of curated.foods) {
      const full = foodById(db, food.id)!;
      for (const [k, v] of Object.entries(food.per100g)) if (k in full.per100g && full.per100g[k] !== null) expect(full.per100g[k], `${food.id} ${k}`).toBeCloseTo(v, 2);
    }
  });
});

describe("meals", () => {
  const oats = searchFoods(db, "porridge oats")[0]!;
  const milk = searchFoods(db, "milk semi skimmed")[0]!;

  it("finds foods by every word, best matches first", () => {
    expect(searchFoods(db, "spinach boiled").map((f) => f.name)[0]).toMatch(/^Spinach/);
    expect(searchFoods(db, "kiwi")[0]!.name).toMatch(/Kiwi/i);
    expect(searchFoods(db, "x")).toEqual([]);
    expect(searchFoods(db, "zzzz nothing")).toEqual([]);
  });

  it("adds up each nutrient by grams and says how many foods had it measured", () => {
    const items = [
      { foodId: oats.id, grams: 50 },
      { foodId: milk.id, grams: 200 },
    ];
    const t = mealTotals(items, db);
    const o = foodById(db, oats.id)!.per100g;
    const m = foodById(db, milk.id)!.per100g;
    expect(t.protein!.amount).toBeCloseTo((o.protein! * 50) / 100 + (m.protein! * 200) / 100, 9);
    expect(t.protein).toMatchObject({ measuredIn: 2, of: 2 });
    expect(t.vitaminK1!.measuredIn).toBeLessThanOrEqual(2);
    expect(saltFromSodium(400)).toBe(1);
  });

  it("compares with the EU reference intake for an adult of that sex and age", () => {
    const iron = nutrients.get("iron")!;
    expect(adultReference(iron, { sex: "m", age: 40 })).toMatchObject({ amount: 11 });
    expect(adultReference(iron, { sex: "f", age: 35 })).toMatchObject({ amount: 16 });
    expect(adultReference(iron, { sex: "f", age: 60 })).toMatchObject({ amount: 11 });
    expect(adultReference(iron, {})).toBeUndefined();
    expect(adultReference(nutrients.get("calcium")!, { age: 22 })).toMatchObject({ amount: 1000 });
    expect(adultReference(nutrients.get("calcium")!, { sex: "f", age: 40 })).toMatchObject({ amount: 950 });
    expect(adultReference(nutrients.get("zinc")!, { sex: "m" })).toMatchObject({ amount: 11.7 });
    expect(adultReference(nutrients.get("zinc")!, { sex: "f", age: 47 })).toMatchObject({ amount: 9.3 });
    expect(adultReference(nutrients.get("vitamin_d")!, {})).toMatchObject({ amount: 15 });
    expect(adultReference(nutrients.get("folate")!, { sex: "f" })).toMatchObject({ amount: 330 });
    expect(shareOfReference({ amount: 5.5, measuredIn: 1, of: 1 }, "mg", { amount: 11, unit: "mg" })).toBe(50);
    expect(shareOfReference({ amount: 5, measuredIn: 0, of: 1 }, "mg", { amount: 11, unit: "mg" })).toBeUndefined();
    expect(shareOfReference({ amount: 5, measuredIn: 1, of: 1 }, "µg", { amount: 11, unit: "mg" })).toBeUndefined();
  });

  it("validates saved meals", () => {
    const meal = { id: "m", name: "Breakfast", items: [{ foodId: oats.id, grams: 50 }], createdAt: "2026-10-29" };
    expect(validateMeal(meal, db)).toEqual([]);
    expect(validateMeal({ ...meal, items: [{ foodId: "nope", grams: 5 }] }, db)).toEqual(["food nope isn't in the food table"]);
    expect(validateMeal({ ...meal, items: [{ foodId: oats.id, grams: 0 }] })).not.toEqual([]);
    expect(validateMeal({ ...meal, name: "" })).toContain("the meal needs a name");
  });
});

describe("example meals", () => {
  const file = JSON.parse(readFileSync(join(K, "meals", "examples.json"), "utf8")) as { meals: ExampleMeal[] };
  const claims = new Set(readdirSync(join(K, "evidence")).map((f) => f.replace(".json", "")));
  const totals = (id: string) => mealTotals(file.meals.find((m) => m.id === id)!.items, db);

  it("use real foods and real evidence claims", () => {
    expect(validateExampleMeals(file, db, claims)).toEqual([]);
    expect(new Set(file.meals.map((m) => m.id)).size).toBe(file.meals.length);
  });
  it("contain what they are an example of, by the table's own numbers", () => {
    expect(totals("lentil-pepper-orange-salad").iron!.amount).toBeGreaterThan(3);
    expect(totals("lentil-pepper-orange-salad").vitaminC!.amount).toBeGreaterThan(100);
    expect(totals("mackerel-potatoes-spinach").vitaminD!.amount).toBeGreaterThan(5);
    expect(totals("eggs-toast-milk").vitaminB12!.amount).toBeGreaterThan(1.5);
    expect(totals("bean-spinach-stew").folate!.amount).toBeGreaterThan(100);
  });
  it("are kept from people they don't suit", () => {
    const blockFor = (id: string) => mealSafetyBlock(file.meals.find((m) => m.id === id)!.items, db, [SAFETY_LIMITS.anticoagulant!]);
    expect(blockFor("mackerel-potatoes-spinach")).toMatch(/vitamin K/);
    expect(blockFor("eggs-toast-milk")).toBeUndefined();
  });
});

describe("coverage of the food table", () => {
  it("counts the foods with each nutrient measured", async () => {
    const { coverage } = await import("../../src/core/meals");
    const c = coverage(db);
    expect(c.protein).toBe(db.foods.length);
    expect(c.vitaminK1).toBeLessThan(db.foods.length / 5);
    expect(c.fibre).toBeLessThan(c.protein!);
  });
});
