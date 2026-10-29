import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { energyVsResting, expandDay, foodIdeas, gapAdvice, upperLimitRoom, intakeTotals, macroRows, mealsRichIn, nutrientRows, validateIntakeDay, type IntakeDay, type PortionFood } from "../../src/core/intake";
import { demoProfile } from "../../src/core/demo";
import type { FoodDb, Meal } from "../../src/core/meals";
import type { NutrientDef } from "../../src/core/nutrients";
import type { FoodTable } from "../../src/core/types";

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
const day = (date: string, items: IntakeDay["items"]): IntakeDay => ({ id: `d-${date}`, date, items });

describe("daily intake", () => {
  it("validates logged days", () => {
    expect(validateIntakeDay(day("2026-10-29", [{ id: "a", kind: "meal", mealId: "m1", portions: 1 }, { id: "b", kind: "food", foodId: kiwi, grams: 75 }]))).toEqual([]);
    expect(validateIntakeDay({})).not.toEqual([]);
    expect(validateIntakeDay(day("2026-13-01", []))).toContain("the date is not a date");
    expect(validateIntakeDay(day("2026-10-29", [{ id: "a", kind: "meal", mealId: "m1", portions: 0 }]))).toContain("portions must be between 0.25 and 10");
    expect(validateIntakeDay(day("2026-10-29", [{ id: "a", kind: "food", foodId: kiwi, grams: 0 }])).join()).toMatch(/grams/);
  });

  it("turns meals into foods and grams, scaled by portions, and counts deleted meals", () => {
    const d = day("2026-10-29", [{ id: "a", kind: "meal", mealId: "m1", portions: 1.5 }, { id: "b", kind: "meal", mealId: "gone", portions: 1 }, { id: "c", kind: "food", foodId: kiwi, grams: 75 }]);
    expect(expandDay(d, [breakfast])).toEqual({ items: [{ foodId: oats, grams: 60 }, { foodId: milk, grams: 300 }, { foodId: kiwi, grams: 75 }], missingMeals: 1 });
  });

  it("adds up a day, and averages several days", () => {
    const one = intakeTotals([day("2026-10-28", [{ id: "a", kind: "food", foodId: kiwi, grams: 150 }])], [], db);
    const two = intakeTotals([day("2026-10-28", [{ id: "a", kind: "food", foodId: kiwi, grams: 150 }]), day("2026-10-29", [])], [], db);
    expect(one.totals.vitaminC!.amount).toBeGreaterThan(50);
    expect(two.totals.vitaminC!.amount).toBeCloseTo(one.totals.vitaminC!.amount / 2, 6);
    expect(two.days).toBe(2);
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
    const totals = intakeTotals([day("2026-10-29", [{ id: "a", kind: "meal", mealId: "m1", portions: 1 }, { id: "b", kind: "food", foodId: kiwi, grams: 75 }])], [breakfast], db).totals;
    const rows = new Map(nutrientRows(totals, db, nutrients, { sex: "f", age: 40 }).map((r) => [r.nutrient.id, r]));
    expect(rows.get("vitamin_c")!.reference).toMatchObject({ amount: 95 });
    expect(rows.get("calcium")!.status).toBe("below");
    // Magnesium's and folate's upper limits are for supplements and folic acid only: never compared with food.
    expect(rows.get("magnesium")!.upperLimit).toBeUndefined();
    expect(rows.get("folate")!.upperLimit).toBeUndefined();
    // Vitamin A's covers preformed vitamin A only: compared with retinol.
    const liver = nutrientRows(intakeTotals([day("2026-10-29", [{ id: "a", kind: "food", foodId: "18-494", grams: 100 }])], [], db).totals, db, nutrients, { sex: "f", age: 40 });
    const a = liver.find((r) => r.nutrient.id === "vitamin_a")!;
    expect(a.upperLimit?.compared).toBeGreaterThan(3000);
    expect(a.status).toBe("above-upper-limit");
  });

  it("suggests foods that would close a gap, with the share after one portion, and respects safety", () => {
    const totals = intakeTotals([day("2026-10-29", [])], [], db).totals;
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
    const totals = intakeTotals([day("2026-10-29", [])], [], db).totals;
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

  it("gives the example profile three valid logged days of real foods", () => {
    const { intake } = demoProfile("2026-10-29");
    expect(intake.map((d) => d.date)).toEqual(["2026-10-28", "2026-10-27", "2026-10-26"]);
    for (const d of intake) {
      expect(validateIntakeDay(d)).toEqual([]);
      for (const it of d.items) if (it.kind === "food") expect(db.foods.some((f) => f[0] === it.foodId), it.foodId).toBe(true);
    }
    // Ordinary days: within what most adults use (the example person rests at about 1,320 kcal).
    const kcal = intakeTotals(intake, [], db).totals.energyKcal!.amount;
    expect(energyVsResting(kcal, 1320)?.band).toBe("within");
  });
});
