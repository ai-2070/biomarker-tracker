import { SAFETY_LIMITS } from "./foods";
import {
  adultReference,
  dailyReference,
  type FoodDb,
  MAX_GRAMS,
  type Meal,
  type MealItem,
  mealSafetyBlock,
  mealTotals,
  NUTRIENT_OF_KEY,
  shareOfReference,
  type Total,
} from "./meals";
import { interactionsFor, type NutrientDef } from "./nutrients";
import { nutrientFor, type PlanItem } from "./plans";
import { MAX_LABEL } from "./protocols";
import type { SafetyId, Sex } from "./types";

/**
 * Daily intake analyzer: a day's worth of meals and foods the person puts in (one list, not a diary),
 * added up from the food table and compared with EU (EFSA) reference values for a whole day and with
 * their resting energy use. A description, never a target: no calorie goal, no deficit and no "eat
 * less" (CLAUDE.md safety rules). Reference intakes are averages over time for groups of healthy
 * people, so one day below one says little.
 */

export type IntakeItem =
  | { id: string; kind: "meal"; mealId: string; portions: number }
  | { id: string; kind: "food"; foodId: string; grams: number }
  /** A supplement the person takes, with their own amount from its label (never suggested by the app). */
  | { id: string; kind: "supplement"; nutrient: string; amount: number; name?: string };

/**
 * Nutrients a supplement can add, by food-table key, in the unit labels use in the EU. Folate is folic
 * acid (µg), counted as 1.7 × in dietary folate equivalents (EFSA: µg DFE = µg food folate + 1.7 × µg
 * folic acid); vitamin A is preformed (retinol), so it also counts toward retinol's upper limit; omega-3
 * is EPA + DHA in mg (the food table keeps grams).
 */
export const SUPPLEMENT_NUTRIENTS: readonly { key: string; label: string; unit: "mg" | "µg" }[] = [
  { key: "vitaminA", label: "Vitamin A (retinol)", unit: "µg" },
  { key: "vitaminD", label: "Vitamin D", unit: "µg" },
  { key: "vitaminE", label: "Vitamin E", unit: "mg" },
  { key: "vitaminK1", label: "Vitamin K1", unit: "µg" },
  { key: "vitaminB6", label: "Vitamin B6", unit: "mg" },
  { key: "vitaminB12", label: "Vitamin B12", unit: "µg" },
  { key: "folate", label: "Folic acid", unit: "µg" },
  { key: "vitaminC", label: "Vitamin C", unit: "mg" },
  { key: "calcium", label: "Calcium", unit: "mg" },
  { key: "magnesium", label: "Magnesium", unit: "mg" },
  { key: "potassium", label: "Potassium", unit: "mg" },
  { key: "iron", label: "Iron", unit: "mg" },
  { key: "zinc", label: "Zinc", unit: "mg" },
  { key: "selenium", label: "Selenium", unit: "µg" },
  { key: "iodine", label: "Iodine", unit: "µg" },
  { key: "epaDha", label: "Omega-3 (EPA + DHA)", unit: "mg" },
];
const SUPPLEMENT_KEYS = new Set(SUPPLEMENT_NUTRIENTS.map((n) => n.key));
export const MAX_SUPPLEMENT_AMOUNT = 100_000;

export const MAX_INTAKE_ITEMS = 60;

/** Problems with the list; empty means valid. */
export function validateIntakeItems(v: unknown): string[] {
  if (!Array.isArray(v)) return ["the list is not a list"];
  const errs: string[] = [];
  if (v.length > MAX_INTAKE_ITEMS) errs.push(`at most ${MAX_INTAKE_ITEMS} items`);
  for (const it of v as unknown[]) {
    const i = (typeof it === "object" && it !== null ? it : {}) as Record<string, unknown>;
    if (typeof i.id !== "string" || !i.id) errs.push("an item has no id");
    if (i.kind === "meal") {
      if (typeof i.mealId !== "string" || !i.mealId) errs.push("a meal item has no meal");
      if (typeof i.portions !== "number" || !(i.portions >= 0.25 && i.portions <= 10)) errs.push("portions must be between 0.25 and 10");
    } else if (i.kind === "food") {
      if (typeof i.foodId !== "string" || !i.foodId) errs.push("a food item has no food");
      if (typeof i.grams !== "number" || !(i.grams >= 1 && i.grams <= MAX_GRAMS)) errs.push(`grams must be between 1 and ${MAX_GRAMS}`);
    } else if (i.kind === "supplement") {
      if (typeof i.nutrient !== "string" || !SUPPLEMENT_KEYS.has(i.nutrient)) errs.push("a supplement has no known nutrient");
      if (typeof i.amount !== "number" || !(i.amount > 0 && i.amount <= MAX_SUPPLEMENT_AMOUNT)) errs.push("a supplement amount must be more than 0");
      if (i.name !== undefined && (typeof i.name !== "string" || i.name.length > 80)) errs.push("a supplement name must be under 80 characters");
    } else errs.push("an item is neither a meal, a food nor a supplement");
  }
  return [...new Set(errs)];
}

/** The list's meals and foods as foods and grams; meals deleted since are counted, not guessed. */
export function expandItems(list: readonly IntakeItem[], meals: readonly Meal[]): { items: MealItem[]; missingMeals: number } {
  const items: MealItem[] = [];
  let missingMeals = 0;
  for (const it of list) {
    if (it.kind === "supplement") continue;
    if (it.kind === "food") items.push({ foodId: it.foodId, grams: it.grams });
    else {
      const meal = meals.find((m) => m.id === it.mealId);
      if (!meal) missingMeals++;
      else for (const f of meal.items) items.push({ foodId: f.foodId, grams: f.grams * it.portions });
    }
  }
  return { items, missingMeals };
}

/**
 * The list added up: foods from the table (unmeasured values never count as zero), plus supplements,
 * each counted as one more source. `supplements` keeps the supplements' own amounts per key, in the
 * label unit (folic acid in µg, not DFE), for the upper limits that cover supplements only.
 */
export function intakeTotals(
  list: readonly IntakeItem[],
  meals: readonly Meal[],
  db: FoodDb,
): { totals: Record<string, Total>; supplements: Record<string, number>; missingMeals: number } {
  const e = expandItems(list, meals);
  const totals = mealTotals(e.items, db);
  const supplements: Record<string, number> = {};
  for (const it of list) if (it.kind === "supplement") supplements[it.nutrient] = (supplements[it.nutrient] ?? 0) + it.amount;
  const add = (key: string, amount: number) => {
    const t = totals[key] ?? { amount: 0, measuredIn: 0, of: 0 };
    totals[key] = { amount: t.amount + amount, measuredIn: t.measuredIn + 1, of: t.of + 1 };
  };
  for (const [key, amount] of Object.entries(supplements)) {
    if (key === "folate") add("folate", amount * 1.7);
    else if (key === "epaDha") add("epaDha", amount / 1000);
    else if (key === "vitaminA") {
      add("vitaminA", amount);
      add("retinol", amount);
    } else add(key, amount);
  }
  return { totals, supplements, missingMeals: e.missingMeals };
}

/**
 * An ordinary example day to try the analyzer with, by CoFID code and grams (about 2,000 kcal): oats
 * with milk and banana, egg sandwich and tomatoes, pasta with chicken and broccoli, fruit, yoghurt and
 * almonds.
 */
export const EXAMPLE_DAY: readonly [foodId: string, grams: number][] = [
  ["11-788", 50], // porridge oats (dry)
  ["12-313", 250], // semi-skimmed milk
  ["14-318", 120], // banana
  ["11-981", 80], // wholemeal bread
  ["12-940", 100], // boiled eggs
  ["13-517", 80], // tomatoes
  ["11-1129", 220], // pasta, boiled
  ["18-323", 130], // chicken breast, grilled
  ["13-503", 80], // broccoli, boiled
  ["17-038", 15], // olive oil
  ["14-319", 150], // apple
  ["12-555", 150], // Greek yoghurt
  ["14-896", 30], // almonds
  ["17-685", 10], // butter
];

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
  const band: EnergyBand =
    r < 1 ? "below-resting" : r < ACTIVITY_LEVELS.lowActive ? "below-low-active" : r <= ACTIVITY_LEVELS.veryActive ? "within" : "above-very-active";
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

export type MacroStatus = "below" | "within" | "above" | "as-low-as-possible" | "needs-weight" | "not-measured" | "no-reference" | "partial";

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

export function macroRows(totals: Record<string, Total>, weightKg?: number, age?: number): MacroRow[] {
  const kcal = totals.energyKcal?.amount ?? 0;
  return MACRO_KEYS.map((key) => {
    const t = totals[key] ?? { amount: 0, measuredIn: 0, of: 0 };
    const base = { key, amount: t.amount, measuredIn: t.measuredIn, of: t.of };
    const pct = KCAL_PER_G[key] !== undefined && kcal > 0 ? ((t.amount * KCAL_PER_G[key]!) / kcal) * 100 : undefined;
    const withPct = pct !== undefined ? { ...base, energyPct: pct } : base;
    if (age !== undefined && (!Number.isFinite(age) || age < 18))
      return { ...base, reference: "Adult reference not applicable", status: "no-reference" as const };
    if (t.measuredIn > 0 && (t.measuredIn < t.of || (pct !== undefined && totals.energyKcal && totals.energyKcal.measuredIn < totals.energyKcal.of)))
      return { ...base, reference: REFERENCE_TEXT[key](weightKg), status: "partial" as const };
    if (t.measuredIn === 0) return { ...withPct, reference: REFERENCE_TEXT[key](weightKg), status: "not-measured" as const };
    switch (key) {
      case "protein": {
        if (!(weightKg && weightKg > 0)) return { ...withPct, reference: REFERENCE_TEXT.protein(), status: "needs-weight" as const };
        const ref = 0.83 * weightKg;
        return {
          ...withPct,
          reference: REFERENCE_TEXT.protein(weightKg),
          status: t.amount < ref ? ("below" as const) : ("within" as const),
          ...(t.amount < ref ? { missing: ref - t.amount } : {}),
        };
      }
      case "fibre":
      case "epaDha": {
        const ref = key === "fibre" ? 25 : 0.25;
        return {
          ...withPct,
          reference: REFERENCE_TEXT[key](),
          status: t.amount < ref ? ("below" as const) : ("within" as const),
          ...(t.amount < ref ? { missing: ref - t.amount } : {}),
        };
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
  protein: (w) =>
    w
      ? `${Math.round(0.83 * w)} g a day (0.83 g per kg of your ${Math.round(w)} kg; population reference intake)`
      : "0.83 g per kg of body weight a day (population reference intake)",
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

/** Upper limits that cover supplements only, compared with the supplements' own amounts (folic acid in µg). */
export const UL_FROM_SUPPLEMENTS: Readonly<Record<string, string>> = { magnesium: "magnesium", folate: "folate" };

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
  /** `from`: what the limit covers, and so what was compared: all sources, or supplements only. */
  upperLimit?: { amount: number; unit: string; compared: number; from: "all" | "supplements" };
  status: "below" | "met" | "above-upper-limit" | "no-reference" | "not-measured" | "partial";
}

export function nutrientRows(
  totals: Record<string, Total>,
  db: FoodDb,
  nutrients: readonly NutrientDef[],
  person: { sex?: Sex; age?: number },
  supplements: Readonly<Record<string, number>> = {},
): NutrientRow[] {
  const rows: NutrientRow[] = [];
  for (const [key, id] of Object.entries(NUTRIENT_OF_KEY)) {
    const n = nutrients.find((x) => x.id === id);
    const t = totals[key];
    const unit = db.nutrients[key]?.unit;
    if (!n || !t || !unit) continue;
    const ref = adultReference(n, person);
    const share = shareOfReference(t, unit, ref);
    const ul = dailyReference(n, person).upperLimit;
    const ulKey = UL_FROM_FOOD[n.id];
    const compared = ulKey ? totals[ulKey] : undefined;
    // Unmeasured counts as nothing known: the room left under the limit is never made smaller by a guess.
    const suppKey = UL_FROM_SUPPLEMENTS[n.id];
    const upperLimit =
      ul && ulKey && db.nutrients[ulKey]?.unit === ul.unit
        ? { amount: ul.amount, unit: ul.unit, compared: compared?.measuredIn ? compared.amount : 0, from: "all" as const }
        : ul && suppKey
          ? { amount: ul.amount, unit: ul.unit, compared: supplements[suppKey] ?? 0, from: "supplements" as const }
          : undefined;
    const status: NutrientRow["status"] =
      t.measuredIn === 0
        ? "not-measured"
        : upperLimit && upperLimit.compared > upperLimit.amount
          ? "above-upper-limit"
          : t.measuredIn < t.of
            ? "partial"
            : share === undefined
              ? "no-reference"
              : share < 100
                ? "below"
                : "met";
    rows.push({
      key,
      nutrient: n,
      amount: t.amount,
      unit,
      measuredIn: t.measuredIn,
      of: t.of,
      ...(ref ? { reference: ref } : {}),
      ...(share !== undefined ? { share } : {}),
      ...(upperLimit ? { upperLimit } : {}),
      status,
    });
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
export function gapAdvice(
  key: string,
  row: Pick<NutrientRow, "nutrient" | "amount" | "reference">,
  candidates: readonly PortionFood[],
  db: FoodDb,
  safety: readonly SafetyId[],
  room: UpperLimitRoom = {},
  limit = 3,
): GapAdvice {
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
    if (key && r.upperLimit?.from === "all") out[key] = { room: r.upperLimit.amount - r.upperLimit.compared, name: r.nutrient.name.toLowerCase() };
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
export function mealsRichIn<M extends { id: string; name: string; items: readonly MealItem[] }>(
  key: string,
  meals: readonly M[],
  db: FoodDb,
  safety: readonly SafetyId[],
  limit = 2,
  room: UpperLimitRoom = {},
): { meal: M; amount: number }[] {
  const limits = safety.flatMap((s) => (SAFETY_LIMITS[s] ? [SAFETY_LIMITS[s]!] : []));
  return meals
    .filter((m) => !mealSafetyBlock(m.items, db, limits))
    .map((meal) => ({ meal, totals: mealTotals(meal.items, db) }))
    .filter(({ totals }) => Object.entries(room).every(([k, r]) => !totals[k]?.measuredIn || totals[k]!.amount <= r.room))
    .map(({ meal, totals }) => ({ meal, amount: totals[key]?.amount ?? 0 }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// ---- From the analyzer to a protocol, and back -----------------------------------------------------

const clip = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
const amountText = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The list as protocol items: meals and foods as diet items (meals linked to the meal), supplements as
 * supplement items with the person's own amount as they entered it. Nothing is added or changed.
 */
export function intakeToPlanItems(list: readonly IntakeItem[], meals: readonly Meal[], db: FoodDb, newId: () => string): PlanItem[] {
  return list.flatMap((it): PlanItem[] => {
    if (it.kind === "meal") {
      const meal = meals.find((m) => m.id === it.mealId);
      if (!meal) return [];
      return [
        {
          id: newId(),
          label: clip(meal.name, MAX_LABEL),
          amount: `${amountText(it.portions)} ${it.portions === 1 ? "portion" : "portions"}`,
          category: "diet",
          when: "any time",
          mealId: meal.id,
        },
      ];
    }
    if (it.kind === "food") {
      const name = db.foods.find((f) => f[0] === it.foodId)?.[1] ?? it.foodId;
      return [{ id: newId(), label: clip(name, MAX_LABEL), amount: `${amountText(it.grams)} g`, category: "diet", when: "any time" }];
    }
    const n = SUPPLEMENT_NUTRIENTS.find((x) => x.key === it.nutrient);
    return [
      {
        id: newId(),
        label: clip(it.name?.trim() || (n?.label ?? it.nutrient), MAX_LABEL),
        amount: `${amountText(it.amount)} ${n?.unit ?? ""}`.trim(),
        category: "supplement",
        when: "any time",
      },
    ];
  });
}

/**
 * The amount a protocol item gives for a supplement, when it's written plainly in the nutrient's own unit
 * ("25 µg", "400 mg", "1,000 mcg"); otherwise nothing, and the person types it. Never converted or guessed.
 */
export function parseLabelAmount(text: string | undefined, unit: "mg" | "µg"): number | undefined {
  if (!text) return undefined;
  const m = /^\s*(\d{1,6}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(mg|µg|μg|mcg|ug)\s*$/i.exec(text);
  if (!m) return undefined;
  const u = m[2]!.toLowerCase() === "mg" ? "mg" : "µg";
  if (u !== unit) return undefined;
  const raw = m[1]!;
  // "1,000" or "1.000" with three digits after the mark is a thousands mark; otherwise a decimal one.
  const value = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, "")) : Number(raw.replace(",", "."));
  return value > 0 && value <= MAX_SUPPLEMENT_AMOUNT ? value : undefined;
}

/** The analyzer's supplement key for a nutrient entry (vitamin_d → vitaminD; omega_3 → epaDha). */
export const SUPPLEMENT_KEY_OF_NUTRIENT: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(NUTRIENT_OF_KEY)
      .filter(([k]) => SUPPLEMENT_KEYS.has(k))
      .map(([k, id]) => [id, k]),
  ),
  omega_3: "epaDha",
};

/** Keep forms with different reference and safety semantics out of automatic imports. */
export function supplementKeyFor(item: Pick<PlanItem, "label">, nutrientId: string): string | undefined {
  if (nutrientId === "vitamin_a" && /caroten/i.test(item.label)) return undefined;
  if (nutrientId === "vitamin_k" && /(?:\bk\s*[- ]?2\b|menaquinone|\bmk\s*[- ]?[47]\b)/i.test(item.label)) return undefined;
  return SUPPLEMENT_KEY_OF_NUTRIENT[nutrientId];
}

/** A supplement in a protocol the analyzer can count, but whose amount isn't written in the nutrient's unit. */
export interface NeedsAmount {
  planId: string;
  itemId: string;
  label: string;
  key: string;
  unit: "mg" | "µg";
  /** What the protocol says now ("2000 IU", "1 capsule"), if anything. */
  written?: string;
}

/**
 * A protocol as analyzer items: saved meals (portions when written as "2 portions", otherwise 1), foods
 * from the table (when the item is a table food in grams, as the analyzer itself writes them), and
 * supplements of a nutrient the analyzer adds up, when the amount is written plainly in its unit. Other
 * supplements of such a nutrient come back as needing an amount (never converted or guessed); everything
 * else is left out with the reason.
 */
export function protocolToIntake(
  plan: { id: string; items: readonly PlanItem[] },
  meals: readonly Pick<Meal, "id" | "name">[],
  db: FoodDb,
  nutrients: readonly NutrientDef[],
  newId: () => string,
): { items: IntakeItem[]; needsAmount: NeedsAmount[]; skipped: { label: string; reason: string }[] } {
  const items: IntakeItem[] = [];
  const needsAmount: NeedsAmount[] = [];
  const skipped: { label: string; reason: string }[] = [];
  const byName = new Map(db.foods.map((f) => [f[1].toLowerCase(), f[0]]));
  for (const it of plan.items) {
    if (it.category === "medication" || it.category === "lifestyle") {
      skipped.push({ label: it.label, reason: it.category === "medication" ? "a medicine, not food" : "not food or a supplement" });
      continue;
    }
    if (it.mealId) {
      if (!meals.some((m) => m.id === it.mealId)) {
        skipped.push({ label: it.label, reason: "its meal was deleted" });
        continue;
      }
      const n = /^\s*(\d+(?:[.,]\d+)?)\s*portions?\s*$/i.exec(it.amount ?? "");
      const portions = n ? Number(n[1]!.replace(",", ".")) : 1;
      items.push({ id: newId(), kind: "meal", mealId: it.mealId, portions: portions >= 0.25 && portions <= 10 ? portions : 1 });
      continue;
    }
    const food = byName.get(it.label.trim().toLowerCase());
    const g = /^\s*(\d+(?:[.,]\d+)?)\s*g\s*$/i.exec(it.amount ?? "");
    if (food && g) {
      const grams = Number(g[1]!.replace(",", "."));
      if (grams >= 1 && grams <= MAX_GRAMS) {
        items.push({ id: newId(), kind: "food", foodId: food, grams });
        continue;
      }
    }
    const nutrient = it.category === "supplement" ? nutrientFor(it, nutrients) : undefined;
    const key = nutrient ? supplementKeyFor(it, nutrient.id) : undefined;
    const def = key ? SUPPLEMENT_NUTRIENTS.find((x) => x.key === key) : undefined;
    if (nutrient && !key && (nutrient.id === "vitamin_a" || nutrient.id === "vitamin_k")) {
      skipped.push({ label: it.label, reason: "this form is not represented: the analyzer counts retinol and vitamin K1, not beta-carotene or vitamin K2" });
      continue;
    }
    if (def) {
      const amount = parseLabelAmount(it.amount, def.unit);
      if (amount !== undefined) items.push({ id: newId(), kind: "supplement", nutrient: def.key, amount, name: clip(it.label, 80) });
      else
        needsAmount.push({
          planId: plan.id,
          itemId: it.id,
          label: it.label,
          key: def.key,
          unit: def.unit,
          ...(it.amount?.trim() ? { written: it.amount.trim() } : {}),
        });
      continue;
    }
    skipped.push({
      label: it.label,
      reason:
        it.category !== "supplement"
          ? "not a saved meal or a food from the table"
          : /\bmulti/i.test(it.label)
            ? "a mix of nutrients: add each one from its label in the Supplements tab"
            : "not one of the vitamins, minerals or omega-3 the analyzer adds up",
    });
  }
  return { items, needsAmount, skipped };
}
