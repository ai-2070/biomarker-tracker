import type { FoodItem, FoodTable, SafetyId } from "./types.ts";

/** Measured amount of a nutrient in a portion, or undefined if the table doesn't list it. */
export function amountIn(food: FoodItem, nutrient: string, grams = food.portion.grams): number | undefined {
  const per100 = food.per100g[nutrient];
  return per100 === undefined ? undefined : (per100 * grams) / 100;
}

/**
 * Per-portion limits above which a food is not suggested, for people whose log
 * shows a condition or medicine where that nutrient needs a doctor's input
 * (CLAUDE.md safety rules). A food without a measured value is not hidden,
 * so the UI also says that the table doesn't list every nutrient.
 */
export const SAFETY_LIMITS: Partial<Record<SafetyId, { nutrient: string; perPortion: number; reason: string }>> = {
  anticoagulant: { nutrient: "vitaminK1", perPortion: 60, reason: "high in vitamin K, which affects blood thinners" },
  kidney: { nutrient: "potassium", perPortion: 300, reason: "high in potassium, which needs care with kidney disease" },
  pregnancy: { nutrient: "retinol", perPortion: 300, reason: "high in vitamin A (retinol), which is limited in pregnancy" },
};

export interface FoodRow {
  food: FoodItem;
  amount: number;
}

export interface FoodSelection {
  shown: FoodRow[];
  hidden: { food: FoodItem; reason: string }[];
  /** Foods with no measured value for the nutrient. Left out of the list. */
  unmeasured: FoodItem[];
}

/** Foods for a nutrient, highest amount per portion first, with safety filters applied. */
export function selectFoods(table: FoodTable, nutrient: string, foodIds: readonly string[], safety: readonly SafetyId[]): FoodSelection {
  const out: FoodSelection = { shown: [], hidden: [], unmeasured: [] };
  for (const id of foodIds) {
    const food = table.foods.find((f) => f.id === id);
    if (!food) continue;
    const amount = amountIn(food, nutrient);
    if (amount === undefined) {
      out.unmeasured.push(food);
      continue;
    }
    const block = safety
      .map((s) => SAFETY_LIMITS[s])
      .find((lim) => lim !== undefined && (amountIn(food, lim.nutrient) ?? 0) >= lim.perPortion);
    if (block) out.hidden.push({ food, reason: block.reason });
    else out.shown.push({ food, amount });
  }
  out.shown.sort((a, b) => b.amount - a.amount);
  return out;
}

/** Problems with the food table; empty means valid. */
export function validateFoodTable(t: FoodTable): string[] {
  const errs: string[] = [];
  if (!t.source?.name || !t.source.url || !t.source.licence) errs.push("source needs name, url and licence");
  const ids = new Set<string>();
  for (const f of t.foods) {
    if (ids.has(f.id)) errs.push(`duplicate food ${f.id}`);
    ids.add(f.id);
    if (!f.name || !f.cofidName) errs.push(`${f.id}: needs a name and the source name`);
    if (!(f.portion?.grams > 0) || !f.portion.label) errs.push(`${f.id}: needs a portion`);
    for (const [n, v] of Object.entries(f.per100g)) {
      if (!t.nutrients[n]) errs.push(`${f.id}: unknown nutrient ${n}`);
      if (!Number.isFinite(v) || v < 0) errs.push(`${f.id}: bad value for ${n}`);
    }
  }
  return errs;
}
