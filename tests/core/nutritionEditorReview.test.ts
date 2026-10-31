import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { intakeTotals, macroRows, mealsRichIn, nutrientRows, protocolToIntake, supplementKeyFor, upperLimitRoom, validateIntakeItems, type IntakeItem } from "../../src/core/intake";
import { adultReference, dailyReference, mealSafetyBlock, mealTotals, validateMeal, type FoodDb, type Meal } from "../../src/core/meals";
import { interactionsFor, validateNutrientDef, type NutrientDef } from "../../src/core/nutrients";
import { validatePlan, type Plan } from "../../src/core/plans";
import { safetyNotes } from "../../src/core/protocols";
import { SAFETY_LIMITS } from "../../src/core/foods";

const knowledge = join(import.meta.dirname, "../../knowledge");
const foodDb = JSON.parse(readFileSync(join(knowledge, "foods/cofid-all.json"), "utf8")) as FoodDb;
const nutrients = readdirSync(join(knowledge, "nutrients")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(knowledge, "nutrients", f), "utf8")) as NutrientDef);
const nutrient = (id: string) => nutrients.find((n) => n.id === id)!;
const baseMeal: Meal = { id: "meal", name: "Synthetic meal", createdAt: "2026-10-30", items: [] };
const basePlan: Plan = { id: "plan", name: "Synthetic protocol", createdAt: "2026-10-30", items: [] };

describe("nutrition review boundaries", () => {
  it("accepts exactly 60 intake and protocol items and 40 meal foods, rejecting the next without changing the valid input", () => {
    const list: IntakeItem[] = Array.from({ length: 60 }, (_, i) => ({ id: `i${i}`, kind: "food", foodId: "14-371", grams: 100 }));
    expect(validateIntakeItems(list)).toEqual([]);
    expect(validateIntakeItems([...list, { ...list[0]!, id: "overflow" }])).toContain("at most 60 items");
    const plan = { ...basePlan, items: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, label: "Own routine", category: "lifestyle" as const, when: "any time" as const })) };
    expect(validatePlan(plan)).toEqual([]);
    expect(validatePlan({ ...plan, items: [...plan.items, { ...plan.items[0]!, id: "overflow" }] })).toContain("a protocol can have at most 60 items");
    const meal = { ...baseMeal, items: Array.from({ length: 40 }, () => ({ foodId: "14-371", grams: 100 })) };
    expect(validateMeal(meal, foodDb)).toEqual([]);
    expect(validateMeal({ ...meal, items: [...meal.items, meal.items[0]!] }, foodDb).join(" ")).toMatch(/40/);
    expect([list.length, plan.items.length, meal.items.length]).toEqual([60, 60, 40]);
  });

  it("makes split portions of one food safety-equivalent while retaining a below-limit positive control", () => {
    const limits = [SAFETY_LIMITS.anticoagulant!];
    const block = (grams: number[]) => mealSafetyBlock(grams.map((g) => ({ foodId: "13-573", grams: g })), foodDb, limits);
    expect(block([10])).toBeUndefined();
    expect(block([10, 10])).toBe(block([20]));
    expect(block([20])).toMatch(/vitamin K/);
  });

  it("filters meal ideas against remaining room for every upper-limit nutrient, not only the ranked nutrient", () => {
    const liver = { ...baseMeal, id: "liver", name: "Liver", items: [{ foodId: "18-494", grams: 100 }] };
    const small = { ...liver, id: "small", name: "Small measured portion", items: [{ foodId: "18-494", grams: 1 }] };
    const { totals } = intakeTotals([{ id: "kiwi", kind: "food", foodId: "14-371", grams: 100 }], [], foodDb);
    const room = upperLimitRoom(nutrientRows(totals, foodDb, nutrients, { sex: "f", age: 40 }));
    expect(mealsRichIn("vitaminB12", [liver], foodDb, []).map((x) => x.meal.id)).toEqual(["liver"]);
    expect(mealTotals(liver.items, foodDb).retinol!.amount).toBe(19700);
    expect(mealsRichIn("vitaminB12", [liver, small], foodDb, [], 2, room).map((x) => x.meal.id)).toEqual(["small"]);
  });

  it("preserves missing assays as unknown rather than a precise vitamin or macro deficit", () => {
    const totals = mealTotals([{ foodId: "13-573", grams: 10 }, { foodId: "14-870", grams: 100 }], foodDb);
    const row = nutrientRows(totals, foodDb, nutrients, { sex: "f", age: 40 }).find((r) => r.key === "vitaminK1")!;
    expect(row).toMatchObject({ amount: 57.5, measuredIn: 1, of: 2, status: "partial" });
    const protein = macroRows({ protein: { amount: 10, measuredIn: 1, of: 2 } }, 70).find((r) => r.key === "protein")!;
    expect(protein.status).toBe("partial");
    expect(protein.missing).toBeUndefined();
  });

  it("never assigns adult-only PRI or UL to children and does not guess missing calcium age bands", () => {
    const calcium = nutrient("calcium");
    for (const age of [0, 10, 17.99]) {
      expect(adultReference(calcium, { sex: "f", age })).toBeUndefined();
      expect(dailyReference(calcium, { sex: "f", age })).toEqual({});
      const totals = { calcium: { amount: 1000, measuredIn: 1, of: 1 } };
      expect(nutrientRows(totals, foodDb, nutrients, { sex: "f", age })[0]).toMatchObject({ amount: 1000, status: "no-reference" });
      expect(nutrientRows(totals, foodDb, nutrients, { sex: "f", age })[0]!.upperLimit).toBeUndefined();
      expect(macroRows({ fibre: { amount: 5, measuredIn: 1, of: 1 } }, 30, age).every((r) => r.status === "no-reference")).toBe(true);
    }
    expect(adultReference(calcium, { sex: "f" })).toBeUndefined();
    expect(adultReference(calcium, { sex: "f", age: 18 })?.amount).toBe(1000);
    expect(adultReference(calcium, { sex: "f", age: 25 })?.amount).toBe(950);
  });

  it("does not turn carotene into retinol or K2 into K1, but imports supported retinol, K1 and omega-3", () => {
    expect(supplementKeyFor({ label: "Beta-carotene" }, "vitamin_a")).toBeUndefined();
    for (const label of ["Vitamin K2", "MK-7", "Menaquinone"]) expect(supplementKeyFor({ label }, "vitamin_k")).toBeUndefined();
    expect(supplementKeyFor({ label: "Retinyl palmitate" }, "vitamin_a")).toBe("vitaminA");
    expect(supplementKeyFor({ label: "Vitamin K1" }, "vitamin_k")).toBe("vitaminK1");
    const converted = protocolToIntake({ id: "p", items: [
      { id: "carotene", label: "Beta-carotene", amount: "5000 µg", category: "supplement", when: "any time" },
      { id: "k2", label: "Vitamin K2", amount: "100 µg", category: "supplement", when: "any time" },
      { id: "fish", label: "Fish oil", amount: "500 mg", category: "supplement", when: "any time" },
    ] }, [], foodDb, nutrients, () => "converted");
    expect(converted.items).toEqual([{ id: "converted", kind: "supplement", nutrient: "epaDha", amount: 500, name: "Fish oil" }]);
    expect(converted.skipped.map((s) => s.label)).toEqual(["Beta-carotene", "Vitamin K2"]);
  });

  it("activates vitamin E antiplatelet precautions without applying warfarin food restrictions", () => {
    const vitaminE = nutrient("vitamin_e");
    expect(validateNutrientDef(vitaminE)).toEqual([]);
    for (const label of ["Aspirin 75 mg daily", "Clopidogrel 75 mg daily", "Antiplatelet medicine"]) {
      const safety = safetyNotes([label]).map((s) => s.id);
      expect(safety).toEqual(["antiplatelet"]);
      expect(interactionsFor(vitaminE, safety).map((x) => x.safetyId)).toEqual(["antiplatelet"]);
      expect(safety.flatMap((id) => SAFETY_LIMITS[id] ? [SAFETY_LIMITS[id]!] : [])).toEqual([]);
    }
    expect(interactionsFor(vitaminE, safetyNotes(["Warfarin"]).map((s) => s.id)).map((x) => x.safetyId)).toEqual(["anticoagulant"]);
  });
});
