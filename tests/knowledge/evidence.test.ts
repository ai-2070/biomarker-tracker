import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectLevers, validateEvidenceClaim } from "../../src/core/evidence";
import { amountIn, selectFoods, validateFoodTable } from "../../src/core/foods";
import type { EvidenceClaim, FoodTable } from "../../src/core/types";
import { loadDefs } from "../helpers";

const ROOT = join(import.meta.dirname, "..", "..", "knowledge");
const claimFiles = readdirSync(join(ROOT, "evidence"))
  .filter((f) => f.endsWith(".json"))
  .map((file) => ({ file, json: JSON.parse(readFileSync(join(ROOT, "evidence", file), "utf8")) as unknown }));
const claims = claimFiles.map((c) => c.json as EvidenceClaim);
const foods = JSON.parse(readFileSync(join(ROOT, "foods", "cofid-foods.json"), "utf8")) as FoodTable;
const defs = loadDefs();
const food = (id: string) => foods.foods.find((f) => f.id === id)!;

describe("knowledge base: evidence claims", () => {
  it.each(claimFiles)("$file is valid", ({ file, json }) => {
    expect(validateEvidenceClaim(json)).toEqual([]);
    expect(`${(json as EvidenceClaim).id}.json`).toBe(file);
  });

  it("only refers to markers that exist", () => {
    for (const c of claims) for (const m of c.markers) expect(defs.has(m.biomarkerId), `${c.id} -> ${m.biomarkerId}`).toBe(true);
  });

  it("matches each marker's affectedBy list exactly", () => {
    for (const [id, d] of defs) {
      const fromClaims = claims.filter((c) => c.markers.some((m) => m.biomarkerId === id)).map((c) => c.id).sort();
      expect(d.affectedBy.map((r) => r.evidenceId).sort(), id).toEqual(fromClaims);
    }
  });

  it("only lists foods and nutrients that are in the food table", () => {
    for (const c of claims) {
      if (!c.foods) continue;
      expect(foods.nutrients[c.foods.nutrient], c.id).toBeDefined();
      for (const id of c.foods.foodIds) expect(food(id), `${c.id} -> ${id}`).toBeDefined();
    }
  });

  it("keeps whole foods and supplements as separate claims", () => {
    for (const c of claims.filter((x) => x.kind === "supplement")) expect(c.foods).toBeUndefined();
  });

  it("rejects a supplement claim that lists foods", () => {
    const supplement = claims.find((c) => c.kind === "supplement")!;
    expect(validateEvidenceClaim({ ...supplement, foods: { nutrient: "iron", foodIds: ["x"] } })).toContain("a supplement claim must not list foods");
  });
});

describe("food table (CoFID 2021 extract)", () => {
  it("is valid and records its source and licence", () => {
    expect(validateFoodTable(foods)).toEqual([]);
    expect(foods.source.licence).toMatch(/Open Government Licence/);
  });

  it("matches the published values for spot-checked foods", () => {
    // Checked by hand against CoFID 2021 sheets 1.4 and 1.5.
    expect(food("13-524").per100g.vitaminC).toBe(126); // red pepper
    expect(food("18-494").per100g.retinol).toBe(19700); // lamb's liver
    expect(food("13-573").per100g.vitaminK1).toBe(575); // spinach, boiled
    expect(food("16-394").per100g.epaDha).toBe(3.02); // mackerel: EPA 1.17 + DHA 1.85
  });

  it("computes portion amounts from per-100 g values", () => {
    expect(amountIn(food("13-524"), "vitaminC")).toBeCloseTo(100.8, 6); // 80 g
    expect(amountIn(food("14-842"), "iron")).toBeCloseTo(3, 6); // 30 g pumpkin seeds
    expect(amountIn(food("14-842"), "iron", 100)).toBe(10);
    expect(amountIn(food("13-571"), "fibre")).toBeUndefined(); // not measured
  });
});

describe("selectFoods safety filters", () => {
  const folate = claims.find((c) => c.id === "folate-foods")!.foods!;
  const iron = claims.find((c) => c.id === "haem-iron-foods")!.foods!;

  it("sorts by amount per portion", () => {
    const s = selectFoods(foods, folate.nutrient, folate.foodIds, []);
    const amounts = s.shown.map((r) => r.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    expect(s.hidden).toEqual([]);
  });

  it("hides high-vitamin-K foods for people on blood thinners", () => {
    const s = selectFoods(foods, folate.nutrient, folate.foodIds, ["anticoagulant"]);
    expect(s.hidden.map((h) => h.food.id).sort()).toEqual(["13-503", "13-573", "13-630"]); // broccoli, spinach, sprouts
    expect(s.hidden[0]!.reason).toMatch(/vitamin K/);
  });

  it("hides liver in pregnancy (vitamin A)", () => {
    const s = selectFoods(foods, iron.nutrient, iron.foodIds, ["pregnancy"]);
    expect(s.hidden.map((h) => h.food.id)).toEqual(["18-494"]);
  });

  it("hides high-potassium portions with kidney disease", () => {
    const s = selectFoods(foods, iron.nutrient, iron.foodIds, ["kidney"]);
    for (const r of s.shown) expect(amountIn(r.food, "potassium") ?? 0).toBeLessThan(300);
    expect(s.hidden.length).toBeGreaterThan(0);
  });

  it("reports foods with no measured value instead of guessing", () => {
    const s = selectFoods(foods, "fibre", ["11-788", "13-571"], []);
    expect(s.shown.map((r) => r.food.id)).toEqual(["11-788"]);
    expect(s.unmeasured.map((f) => f.id)).toEqual(["13-571"]);
  });
});

describe("selectLevers", () => {
  it("shows only levers for the direction the result is out of range in", () => {
    const low = selectLevers("ferritin", "low", claims, []);
    expect(low.focus).toBe("low");
    expect(low.claims.length).toBeGreaterThan(0);
    expect(selectLevers("ferritin", "high", claims, []).claims).toEqual([]);
  });

  it("orders by evidence grade, strongest first", () => {
    const grades = selectLevers("ferritin", "low", claims, []).claims.map((c) => c.grade);
    expect(grades[0]).toBe("high");
    expect(grades[grades.length - 1]).toBe("low");
  });

  it("shows everything for general information when in range", () => {
    const s = selectLevers("triglycerides", "normal", claims, []);
    expect(s.focus).toBeUndefined();
    expect(s.claims.length).toBe(3);
  });

  it("hides levers that conflict with the user's log", () => {
    const s = selectLevers("triglycerides", "high", claims, ["anticoagulant"]);
    expect(s.hidden.map((c) => c.id)).toEqual(["omega-3-supplements-tg"]);
    expect(s.claims.some((c) => c.id === "omega-3-supplements-tg")).toBe(false);
  });
});
