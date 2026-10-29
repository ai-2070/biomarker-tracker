import { isIsoDate } from "./dates";
import { SAFETY_LIMITS } from "./foods";
import { MAX_GRAMS, NUTRIENT_OF_KEY, adultReference, mealSafetyBlock, mealTotals, shareOfReference, type FoodDb, type Meal, type MealItem, type Total } from "./meals";
import { interactionsFor, type NutrientDef } from "./nutrients";
import type { SafetyId, Sex } from "./types";

/**
 * Daily intake: the meals and foods a person ate on a day, added up from the food table, and compared
 * with EU (EFSA) reference values for a whole day and with their resting energy use. A description of
 * what was eaten, never a target: no calorie goal, no deficit and no "eat less" (CLAUDE.md safety
 * rules). Reference intakes are averages over time for groups of healthy people, so one day below one
 * says little; several logged days average out the day-to-day swings.
 */

export type IntakeItem =
  | { id: string; kind: "meal"; mealId: string; portions: number }
  | { id: string; kind: "food"; foodId: string; grams: number };

export interface IntakeDay {
  id: string;
  /** The day eaten, YYYY-MM-DD. */
  date: string;
  items: IntakeItem[];
  note?: string;
}

export const MAX_DAY_ITEMS = 60;

/** Problems with a logged day; empty means valid. */
export function validateIntakeDay(v: unknown): string[] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return ["the day is not an object"];
  const d = v as Record<string, unknown>;
  const errs: string[] = [];
  if (typeof d.id !== "string" || !d.id) errs.push("id is missing");
  if (typeof d.date !== "string" || !isIsoDate(d.date)) errs.push("the date is not a date");
  if (d.note !== undefined && (typeof d.note !== "string" || d.note.length > 500)) errs.push("the note must be under 500 characters");
  if (!Array.isArray(d.items)) return [...errs, "items must be a list"];
  if (d.items.length > MAX_DAY_ITEMS) errs.push(`a day can have at most ${MAX_DAY_ITEMS} items`);
  for (const it of d.items as unknown[]) {
    const i = (typeof it === "object" && it !== null ? it : {}) as Record<string, unknown>;
    if (typeof i.id !== "string" || !i.id) errs.push("an item has no id");
    if (i.kind === "meal") {
      if (typeof i.mealId !== "string" || !i.mealId) errs.push("a meal item has no meal");
      if (typeof i.portions !== "number" || !(i.portions >= 0.25 && i.portions <= 10)) errs.push("portions must be between 0.25 and 10");
    } else if (i.kind === "food") {
      if (typeof i.foodId !== "string" || !i.foodId) errs.push("a food item has no food");
      if (typeof i.grams !== "number" || !(i.grams >= 1 && i.grams <= MAX_GRAMS)) errs.push(`grams must be between 1 and ${MAX_GRAMS}`);
    } else errs.push("an item is neither a meal nor a food");
  }
  return [...new Set(errs)];
}

/** A day's meals and foods as foods and grams; meals that were deleted since are counted, not guessed. */
export function expandDay(day: IntakeDay, meals: readonly Meal[]): { items: MealItem[]; missingMeals: number } {
  const items: MealItem[] = [];
  let missingMeals = 0;
  for (const it of day.items) {
    if (it.kind === "food") items.push({ foodId: it.foodId, grams: it.grams });
    else {
      const meal = meals.find((m) => m.id === it.mealId);
      if (!meal) missingMeals++;
      else for (const f of meal.items) items.push({ foodId: f.foodId, grams: f.grams * it.portions });
    }
  }
  return { items, missingMeals };
}

/** Totals for one day, or the average day across several (each nutrient summed, then divided by the days). */
export function intakeTotals(days: readonly IntakeDay[], meals: readonly Meal[], db: FoodDb): { totals: Record<string, Total>; days: number; missingMeals: number } {
  const all: MealItem[] = [];
  let missingMeals = 0;
  for (const d of days) {
    const e = expandDay(d, meals);
    all.push(...e.items);
    missingMeals += e.missingMeals;
  }
  const sum = mealTotals(all, db);
  const n = Math.max(1, days.length);
  const totals = Object.fromEntries(Object.entries(sum).map(([k, t]) => [k, { ...t, amount: t.amount / n }])) as Record<string, Total>;
  return { totals, days: days.length, missingMeals };
}

// ---- Energy compared with resting energy use -----------------------------------------------------

/**
 * EFSA's energy reference values (EFSA 2013, DOI 10.2903/j.efsa.2013.3005) multiply resting energy
 * expenditure by physical activity levels of 1.4 (low active, sedentary) to 2.0 (very active).
 */
export const ACTIVITY_LEVELS = { lowActive: 1.4, veryActive: 2.0 } as const;

export type EnergyBand = "below-resting" | "below-low-active" | "within" | "above-very-active";

/** A day's energy as a multiple of resting energy use, and where it falls among EFSA's activity levels. */
export function energyVsResting(kcal: number, restingKcal: number): { ratio: number; band: EnergyBand } | undefined {
  if (!(restingKcal > 0) || !(kcal >= 0)) return undefined;
  const ratio = kcal / restingKcal;
  const r = Math.round(ratio * 100) / 100;
  const band: EnergyBand = r < 1 ? "below-resting" : r < ACTIVITY_LEVELS.lowActive ? "below-low-active" : r <= ACTIVITY_LEVELS.veryActive ? "within" : "above-very-active";
  return { ratio, band };
}

// ---- Energy, macronutrients and fibre ------------------------------------------------------------

/**
 * EFSA reference values for adults (EFSA 2017 summary report, DOI 10.2903/sp.efsa.2017.e15121, checked
 * against its text): protein PRI 0.83 g/kg body weight a day; fibre AI 25 g; total fat 20–35 % of energy
 * and carbohydrate 45–60 % (reference intake ranges); saturated fat and sugars as low as possible (no
 * upper level could be set; sugars: EFSA 2022, DOI 10.2903/j.efsa.2022.7074); EPA + DHA AI 250 mg;
 * sodium 2.0 g a day as a safe and adequate intake (EFSA 2019, DOI 10.2903/j.efsa.2019.5778).
 * Energy shares use the food table's factors: 9 kcal per g of fat, 3.75 per g of carbohydrate (as
 * monosaccharides), 4 per g of protein.
 */
export type MacroKey = "protein" | "carbohydrate" | "sugars" | "fibre" | "fat" | "saturatedFat" | "epaDha" | "sodium";
export const MACRO_KEYS: readonly MacroKey[] = ["protein", "carbohydrate", "sugars", "fibre", "fat", "saturatedFat", "epaDha", "sodium"];
const KCAL_PER_G: Partial<Record<MacroKey, number>> = { protein: 4, fat: 9, saturatedFat: 9, carbohydrate: 3.75, sugars: 3.75 };

export type MacroStatus = "below" | "within" | "above" | "as-low-as-possible" | "needs-weight" | "not-measured";

export interface MacroRow {
  key: MacroKey;
  amount: number;
  measuredIn: number;
  of: number;
  /** Share of the day's energy, for fat, carbohydrate, protein, saturated fat and sugars. */
  energyPct?: number;
  /** What EFSA's value is, in words: "25 g a day (adequate intake)". */
  reference: string;
  status: MacroStatus;
  /** For "below": how much more would reach the reference, in the row's unit. */
  missing?: number;
}

export function macroRows(totals: Record<string, Total>, weightKg?: number): MacroRow[] {
  const kcal = totals.energyKcal?.amount ?? 0;
  return MACRO_KEYS.map((key) => {
    const t = totals[key] ?? { amount: 0, measuredIn: 0, of: 0 };
    const base = { key, amount: t.amount, measuredIn: t.measuredIn, of: t.of };
    const pct = KCAL_PER_G[key] !== undefined && kcal > 0 ? (t.amount * KCAL_PER_G[key]!) / kcal * 100 : undefined;
    const withPct = pct !== undefined ? { ...base, energyPct: pct } : base;
    if (t.measuredIn === 0) return { ...withPct, reference: REFERENCE_TEXT[key](weightKg), status: "not-measured" as const };
    switch (key) {
      case "protein": {
        if (!(weightKg && weightKg > 0)) return { ...withPct, reference: REFERENCE_TEXT.protein(), status: "needs-weight" as const };
        const ref = 0.83 * weightKg;
        return { ...withPct, reference: REFERENCE_TEXT.protein(weightKg), status: t.amount < ref ? ("below" as const) : ("within" as const), ...(t.amount < ref ? { missing: ref - t.amount } : {}) };
      }
      case "fibre":
      case "epaDha": {
        const ref = key === "fibre" ? 25 : 0.25;
        return { ...withPct, reference: REFERENCE_TEXT[key](), status: t.amount < ref ? ("below" as const) : ("within" as const), ...(t.amount < ref ? { missing: ref - t.amount } : {}) };
      }
      case "fat":
      case "carbohydrate": {
        const [lo, hi] = key === "fat" ? [20, 35] : [45, 60];
        const status = pct === undefined ? ("not-measured" as const) : pct < lo ? ("below" as const) : pct > hi ? ("above" as const) : ("within" as const);
        return { ...withPct, reference: REFERENCE_TEXT[key](), status };
      }
      case "sodium":
        return { ...withPct, reference: REFERENCE_TEXT.sodium(), status: t.amount > 2000 ? ("above" as const) : ("within" as const) };
      default:
        return { ...withPct, reference: REFERENCE_TEXT[key](), status: "as-low-as-possible" as const };
    }
  });
}

const REFERENCE_TEXT: Record<MacroKey, (weightKg?: number) => string> = {
  protein: (w) => (w ? `${Math.round(0.83 * w)} g a day (0.83 g per kg of your ${Math.round(w)} kg; population reference intake)` : "0.83 g per kg of body weight a day (population reference intake)"),
  carbohydrate: () => "45–60 % of energy (reference intake range)",
  sugars: () => "As low as possible within a nutritionally adequate diet (no safe level could be set)",
  fibre: () => "25 g a day (adequate intake)",
  fat: () => "20–35 % of energy (reference intake range)",
  saturatedFat: () => "As low as possible within a nutritionally adequate diet",
  epaDha: () => "250 mg a day (adequate intake)",
  sodium: () => "2.0 g a day (about 5 g of salt; EFSA's safe and adequate intake)",
};

// ---- Vitamins and minerals -----------------------------------------------------------------------

/**
 * Upper limits that apply to all sources, so a day of food can be compared with them, and which food
 * table value to compare. Magnesium's applies to supplements only and folate's to folic acid only, so
 * they're never compared with food; vitamin A's applies to preformed vitamin A (retinol) only.
 */
export const UL_FROM_FOOD: Readonly<Record<string, string>> = {
  calcium: "calcium",
  iodine: "iodine",
  selenium: "selenium",
  vitamin_b6: "vitaminB6",
  vitamin_d: "vitaminD",
  vitamin_e: "vitaminE",
  zinc: "zinc",
  vitamin_a: "retinol",
};

export interface NutrientRow {
  key: string;
  nutrient: NutrientDef;
  amount: number;
  unit: string;
  measuredIn: number;
  of: number;
  reference?: { amount: number; unit: string; type: "PRI" | "AI"; group: string };
  /** Percent of the day's reference intake. */
  share?: number;
  upperLimit?: { amount: number; unit: string; compared: number };
  status: "below" | "met" | "above-upper-limit" | "no-reference" | "not-measured";
}

export function nutrientRows(totals: Record<string, Total>, db: FoodDb, nutrients: readonly NutrientDef[], person: { sex?: Sex; age?: number }): NutrientRow[] {
  const rows: NutrientRow[] = [];
  for (const [key, id] of Object.entries(NUTRIENT_OF_KEY)) {
    const n = nutrients.find((x) => x.id === id);
    const t = totals[key];
    const unit = db.nutrients[key]?.unit;
    if (!n || !t || !unit) continue;
    const ref = adultReference(n, person);
    const share = shareOfReference(t, unit, ref);
    const ul = n.reference.upperLimit;
    const ulKey = UL_FROM_FOOD[n.id];
    const compared = ulKey ? totals[ulKey] : undefined;
    // Unmeasured counts as nothing known: the room left under the limit is never made smaller by a guess.
    const upperLimit = ul && ulKey && db.nutrients[ulKey]?.unit === ul.unit ? { amount: ul.amount, unit: ul.unit, compared: compared?.measuredIn ? compared.amount : 0 } : undefined;
    const status: NutrientRow["status"] =
      t.measuredIn === 0 ? "not-measured" : upperLimit && upperLimit.compared > upperLimit.amount ? "above-upper-limit" : share === undefined ? "no-reference" : share < 100 ? "below" : "met";
    rows.push({ key, nutrient: n, amount: t.amount, unit, measuredIn: t.measuredIn, of: t.of, ...(ref ? { reference: ref } : {}), ...(share !== undefined ? { share } : {}), ...(upperLimit ? { upperLimit } : {}), status });
  }
  return rows;
}

// ---- What would close a gap ----------------------------------------------------------------------

export interface PortionFood {
  /** CoFID code, the same as in the full food table. */
  id: string;
  name: string;
  portion: { grams: number; label: string };
}

export interface GapIdea {
  name: string;
  grams: number;
  label: string;
  /** How much one portion adds, in the nutrient's unit. */
  adds: number;
  /** The day's share of the reference with this portion added. */
  shareAfter?: number;
}

export type GapAdvice =
  | { kind: "foods"; foods: GapIdea[]; hidden: { name: string; reason: string }[] }
  /** The person's medicines or conditions make this nutrient one to talk about with a doctor first. */
  | { kind: "talk-to-doctor"; because: { with: string; note: string }[] };

/**
 * Foods with the most of a nutrient per example portion, and what each would do to the day's share.
 * Foods over a safety limit for the person (vitamin K with blood thinners, potassium with kidney
 * disease, retinol in pregnancy) are left out with the reason; nutrients the person's medicines or
 * conditions interact with get no food ideas, only "talk to your doctor".
 */
export function gapAdvice(key: string, row: Pick<NutrientRow, "nutrient" | "amount" | "reference">, candidates: readonly PortionFood[], db: FoodDb, safety: readonly SafetyId[], room: UpperLimitRoom = {}, limit = 3): GapAdvice {
  const because = interactionsFor(row.nutrient, safety);
  if (because.length) return { kind: "talk-to-doctor", because: because.map((b) => ({ with: b.with, note: b.note })) };
  return { kind: "foods", ...foodIdeas(key, row.amount, row.reference?.amount, candidates, db, safety, room, limit) };
}

/** How much more of each food-table value fits under an upper limit today: food key → room left and the nutrient's name. */
export type UpperLimitRoom = Readonly<Record<string, { room: number; name: string }>>;

/** Room left under every upper limit that covers food, from the day's vitamin and mineral rows. */
export function upperLimitRoom(rows: readonly NutrientRow[]): UpperLimitRoom {
  const out: Record<string, { room: number; name: string }> = {};
  for (const r of rows) {
    const key = UL_FROM_FOOD[r.nutrient.id];
    if (key && r.upperLimit) out[key] = { room: r.upperLimit.amount - r.upperLimit.compared, name: r.nutrient.name.toLowerCase() };
  }
  return out;
}

/**
 * Foods with the most of any food-table nutrient per example portion (protein, fibre, omega-3 as well
 * as vitamins and minerals), what each adds, and the share of `reference` after one portion; foods over
 * the person's safety limits are left out with the reason.
 */
export function foodIdeas(
  key: string,
  current: number,
  reference: number | undefined,
  candidates: readonly PortionFood[],
  db: FoodDb,
  safety: readonly SafetyId[],
  room: UpperLimitRoom = {},
  limit = 3,
): { foods: GapIdea[]; hidden: { name: string; reason: string }[] } {
  const i = db.keys.indexOf(key);
  const limits = safety.flatMap((s) => (SAFETY_LIMITS[s] ? [SAFETY_LIMITS[s]!] : []));
  const ideas: GapIdea[] = [];
  const hidden: { name: string; reason: string }[] = [];
  for (const c of candidates) {
    const food = db.foods.find((f) => f[0] === c.id);
    const per100 = food?.[2][i];
    if (per100 === null || per100 === undefined || per100 <= 0) continue;
    const block = mealSafetyBlock([{ foodId: c.id, grams: c.portion.grams }], db, limits);
    if (block) {
      hidden.push({ name: c.name, reason: block });
      continue;
    }
    // Never a food whose one portion would take the day above a safe upper limit (liver and vitamin A).
    const over = Object.entries(room).find(([k, r]) => {
      const v = food![2][db.keys.indexOf(k)];
      return v !== null && v !== undefined && (v * c.portion.grams) / 100 > r.room;
    });
    if (over) {
      hidden.push({ name: c.name, reason: `one portion would go above the safe upper limit for ${over[1].name}` });
      continue;
    }
    const adds = (per100 * c.portion.grams) / 100;
    const shareAfter = reference && reference > 0 ? Math.round(((current + adds) / reference) * 100) : undefined;
    ideas.push({ name: c.name, grams: c.portion.grams, label: c.portion.label, adds, ...(shareAfter !== undefined ? { shareAfter } : {}) });
  }
  ideas.sort((a, b) => b.adds - a.adds);
  return { foods: ideas.slice(0, limit), hidden };
}

/** Meals (the person's own or examples) with the most of a nutrient per portion, without safety blocks. */
export function mealsRichIn<M extends { id: string; name: string; items: readonly MealItem[] }>(key: string, meals: readonly M[], db: FoodDb, safety: readonly SafetyId[], limit = 2): { meal: M; amount: number }[] {
  const limits = safety.flatMap((s) => (SAFETY_LIMITS[s] ? [SAFETY_LIMITS[s]!] : []));
  return meals
    .filter((m) => !mealSafetyBlock(m.items, db, limits))
    .map((meal) => ({ meal, amount: mealTotals(meal.items, db)[key]?.amount ?? 0 }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}
