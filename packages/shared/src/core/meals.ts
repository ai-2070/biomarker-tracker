import type { NutrientDef } from "./nutrients";
import type { Sex } from "./types";

/**
 * Meals: foods and grams, added up from the UK food composition table (CoFID 2021,
 * knowledge/foods/cofid-all.json). Code does all the maths; values are only what the table measured.
 * Totals say how complete they are (a nutrient measured in 3 of 5 foods), and the page explains what
 * no food table can cover (nutritional dark matter). No targets: energy and macros are shown as what a
 * meal contains, never against a goal; vitamins and minerals are compared with EU reference intakes
 * for a whole day, as context.
 */

export interface FoodDb {
  keys: string[];
  nutrients: Record<string, { label: string; unit: string }>;
  /** [CoFID code, name, values per 100 g in `keys` order, null = not measured]. */
  foods: [string, string, (number | null)[]][];
}

export interface MealItem {
  foodId: string;
  grams: number;
}

export interface Meal {
  id: string;
  name: string;
  items: MealItem[];
  note?: string;
  createdAt: string;
}

export const MAX_GRAMS = 2000;
export const MAX_MEAL_ITEMS = 40;

/** Energy and macros, in display order; the rest are vitamins and minerals. */
export const MACROS = ["energyKcal", "protein", "fat", "saturatedFat", "carbohydrate", "sugars", "fibre", "sodium"] as const;

/** Food table key → vitamins and minerals knowledge base id (for reference intakes and links). */
export const NUTRIENT_OF_KEY: Record<string, string> = {
  calcium: "calcium",
  magnesium: "magnesium",
  potassium: "potassium",
  iron: "iron",
  zinc: "zinc",
  selenium: "selenium",
  iodine: "iodine",
  vitaminA: "vitamin_a",
  vitaminD: "vitamin_d",
  vitaminE: "vitamin_e",
  vitaminK1: "vitamin_k",
  vitaminB6: "vitamin_b6",
  vitaminB12: "vitamin_b12",
  folate: "folate",
  vitaminC: "vitamin_c",
};

export interface Food {
  id: string;
  name: string;
  per100g: Record<string, number | null>;
}

export function foodById(db: FoodDb, id: string): Food | undefined {
  const row = db.foods.find((f) => f[0] === id);
  return row ? { id: row[0], name: row[1], per100g: Object.fromEntries(db.keys.map((k, i) => [k, row[2][i] ?? null])) } : undefined;
}

/** Salt from sodium (salt = sodium × 2.5), in grams. */
export const saltFromSodium = (sodiumMg: number) => (sodiumMg * 2.5) / 1000;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Other names for foods, as people type them, and the words the UK food table uses: "dark chocolate" is
 * "Chocolate, plain" there, "zucchini" is "Courgette". Each is tried alongside the words typed.
 */
export const FOOD_NAMES: readonly [typed: string, table: string][] = [
  ["dark chocolate", "chocolate plain"],
  ["chickpeas", "chick peas"],
  ["chickpea", "chick peas"],
  ["garbanzo", "chick peas"],
  ["zucchini", "courgette"],
  ["eggplant", "aubergine"],
  ["cilantro", "coriander"],
  ["arugula", "rocket"],
  ["scallions", "spring onions"],
  ["scallion", "spring onions"],
  ["green onion", "spring onions"],
  ["bell pepper", "pepper capsicum"],
  ["ground beef", "beef mince"],
  ["oatmeal", "porridge"],
  ["rolled oats", "porridge oats"],
  ["french fries", "chips"],
  ["fries", "chips"],
  ["potato chips", "crisps"],
  ["yoghurt", "yogurt"],
  ["skim milk", "milk skimmed"],
  ["whole milk", "milk whole"],
  ["snow peas", "mange tout"],
  ["rutabaga", "swede"],
  ["candy", "sweets"],
  ["granola", "crunchy muesli"],
  ["beet", "beetroot"],
];

/**
 * Where another name leads to a food that isn't quite what people mean by it, a note shown beside it.
 * The table's "plain chocolate" (the old British name for dark chocolate) is the sweet kind, not a 70–85%
 * cocoa bar.
 */
export const FOOD_NAME_NOTES: readonly { typed: string; food: string; note: string }[] = [
  {
    typed: "dark chocolate",
    food: "Chocolate, plain",
    note: "The UK name for dark chocolate, but the sweet kind: 62.6 g sugar per 100 g in the table. Bars with 70% cocoa or more have far less sugar and more iron, magnesium and fibre, so for those the label is a better guide.",
  },
];

/** The note for a food found by another name, if there is one. */
export function foodNameNote(query: string, foodName: string): string | undefined {
  const padded = ` ${norm(query)} `;
  return FOOD_NAME_NOTES.find((x) => x.food === foodName && padded.includes(` ${x.typed} `))?.note;
}

const tableWords = (q: string): string[] => {
  const out = [q];
  const padded = ` ${q} `;
  for (const [typed, table] of FOOD_NAMES) if (padded.includes(` ${typed} `)) out.push(padded.replace(` ${typed} `, ` ${table} `).trim());
  return [...new Set(out)];
};

/**
 * Foods whose name contains every word of the query (any order), or of the query with another name for
 * the food swapped in (FOOD_NAMES), best first: names starting with the query, then whole-word matches,
 * then shorter names ("Apples, eating, raw" before "Apple crumble").
 */
export function searchFoods(db: FoodDb, query: string, limit = 20): { id: string; name: string }[] {
  const q0 = norm(query);
  if (q0.length < 2) return [];
  const best = new Map<string, { id: string; name: string; score: number }>();
  for (const q of tableWords(q0)) {
    const words = q.split(" ");
    for (const [id, name] of db.foods) {
      const n = norm(name);
      if (!words.every((w) => n.includes(w))) continue;
      const padded = ` ${n} `;
      let score = n.length;
      if (n.startsWith(q)) score -= 1000;
      if (n.startsWith(words[0]!)) score -= 500;
      score -= words.filter((w) => padded.includes(` ${w} `)).length * 100;
      if (/\braw\b/.test(n)) score -= 10;
      const seen = best.get(id);
      if (!seen || score < seen.score) best.set(id, { id, name, score });
    }
  }
  return [...best.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ id, name }) => ({ id, name }));
}

/** Words too common to tell foods apart. */
const FILLER = new Set(["and", "with", "of", "in", "the", "a", "or", "raw", "fresh", "food", "foods"]);

/**
 * When no food has every word: the foods sharing the most telling words with the query, for "not in the
 * table; closest". A word counts more the fewer foods have it ("beet" in 4 foods says more than "juice"
 * in 42), so "blood orange juice" gives orange juice and "beet juice" gives beetroot. Never a match:
 * the page says the food itself isn't in the table.
 */
export function closestFoods(db: FoodDb, query: string, limit = 6): { id: string; name: string }[] {
  const words = tableWords(norm(query))
    .flatMap((q) => q.split(" "))
    .filter((w) => w.length >= 3 && !FILLER.has(w));
  const unique = [...new Set(words)];
  if (!unique.length) return [];
  const names = db.foods.map(([id, name]) => ({ id, name, n: norm(name) }));
  const weight = new Map(unique.map((w) => [w, Math.log(names.length / (1 + names.filter((x) => x.n.includes(w)).length))]));
  return names
    .map((x) => ({ ...x, score: unique.reduce((sum, w) => sum + (x.n.includes(w) ? weight.get(w)! : 0), 0) - x.n.length / 1000 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ id, name }) => ({ id, name }));
}

export interface Total {
  amount: number;
  /** How many of the meal's foods had a measured value. */
  measuredIn: number;
  of: number;
}

/** Each nutrient added up over the meal's foods (amount = per 100 g × grams / 100), with coverage. */
export function mealTotals(items: readonly MealItem[], db: FoodDb): Record<string, Total> {
  const rows = items.map((it) => ({ it, row: db.foods.find((f) => f[0] === it.foodId) })).filter((x) => x.row);
  const out: Record<string, Total> = {};
  db.keys.forEach((k, i) => {
    let amount = 0;
    let measuredIn = 0;
    for (const { it, row } of rows) {
      const v = row![2][i];
      if (v === null || v === undefined) continue;
      amount += (v * it.grams) / 100;
      measuredIn++;
    }
    out[k] = { amount, measuredIn, of: rows.length };
  });
  return out;
}

export function mealWeight(items: readonly MealItem[]): number {
  return items.reduce((s, i) => s + i.grams, 0);
}

/**
 * The EU (EFSA) reference intake for a day for a healthy adult of this sex and age, from the
 * vitamins and minerals knowledge base: not pregnancy or breastfeeding; calcium by age; iron for
 * women before or after menopause (taken as 50); zinc at an average phytate intake (600 mg). With
 * sex unknown, only a value for all adults is used.
 */
export function adultReference(
  n: NutrientDef,
  person: { sex?: Sex; age?: number },
): { amount: number; unit: string; type: "PRI" | "AI"; group: string } | undefined {
  if (person.age !== undefined && (!Number.isFinite(person.age) || person.age < 18)) return undefined;
  let groups = n.reference.intake.filter((g) => !/^(pregnan|breastfeed)/i.test(g.group));
  if (groups.some((g) => /\d+ to \d+ years|years and over/.test(g.group))) {
    // Unknown age cannot select either adult age band.
    if (person.age === undefined) return undefined;
    groups = groups.filter((g) => (person.age! < 25 ? /18 to 24/.test(g.group) : /25 years and over/.test(g.group)));
  }
  const word = person.sex === "m" ? /^men\b/i : person.sex === "f" ? /^women\b/i : null;
  let pick = word ? groups.filter((g) => word.test(g.group)) : [];
  // Narrow only when the groups make that distinction (iron: menopause; zinc: phytate).
  const narrow = (re: RegExp) => {
    const n = pick.filter((g) => re.test(g.group));
    if (n.length) pick = n;
  };
  if (pick.length > 1 && person.sex === "f") {
    if (person.age === undefined && pick.some((g) => /menopause/i.test(g.group))) return undefined;
    narrow((person.age ?? 0) >= 50 ? /after menopause/i : /before menopause/i);
  }
  if (pick.length > 1) narrow(/600 mg phytate/);
  if (pick.length === 0) pick = groups.filter((g) => /^adults/i.test(g.group));
  const g = pick[0];
  return g ? { amount: g.amount, unit: g.unit, type: g.type, group: g.group } : undefined;
}

/** A meal's share of the day's reference intake, as a percentage (rounded), when units match. */
export function shareOfReference(total: Total, unit: string, ref: { amount: number; unit: string } | undefined): number | undefined {
  if (!ref || ref.unit !== unit || ref.amount <= 0 || total.measuredIn === 0) return undefined;
  return Math.round((total.amount / ref.amount) * 100);
}

// ---- Example meals (knowledge/meals/examples.json) ----------------------------------------------

export interface ExampleMeal {
  id: string;
  name: string;
  description: string;
  /** Evidence claims the meal illustrates; their markers decide where it is shown. */
  claimIds: string[];
  items: MealItem[];
}

/** Problems with the example meals file; empty means valid. */
export function validateExampleMeals(v: unknown, db: FoodDb, claimIds: ReadonlySet<string>): string[] {
  const meals = (v as { meals?: unknown } | null)?.meals;
  if (!Array.isArray(meals)) return ["meals must be a list"];
  return (meals as ExampleMeal[]).flatMap((m, i) => {
    const at = `example ${i + 1}`;
    const errs = validateMeal({ ...m, createdAt: "-" }, db).map((e) => `${at}: ${e}`);
    if (typeof m.description !== "string" || !m.description) errs.push(`${at}: needs a description`);
    if (!Array.isArray(m.claimIds) || m.claimIds.length === 0) errs.push(`${at}: needs at least one claim`);
    else for (const c of m.claimIds) if (!claimIds.has(c)) errs.push(`${at}: unknown claim ${c}`);
    return errs;
  });
}

/**
 * Why a meal can't be suggested to this person: a food in it, at the meal's grams, reaches a safety
 * limit (vitamin K with blood thinners, potassium with kidney disease, retinol in pregnancy). Same
 * per-portion rule as the food lists on marker pages.
 */
export function mealSafetyBlock(
  items: readonly MealItem[],
  db: FoodDb,
  limits: readonly { nutrient: string; perPortion: number; reason: string }[],
): string | undefined {
  const portions = new Map<string, number>();
  for (const item of items) portions.set(item.foodId, (portions.get(item.foodId) ?? 0) + item.grams);
  for (const lim of limits) {
    const i = db.keys.indexOf(lim.nutrient);
    if (i < 0) continue;
    for (const [foodId, grams] of portions) {
      const row = db.foods.find((f) => f[0] === foodId);
      const v = row?.[2][i];
      if (v !== null && v !== undefined && (v * grams) / 100 >= lim.perPortion) return `${row![1]} is ${lim.reason}`;
    }
  }
  return undefined;
}

/** Problems with a saved meal; empty means valid. */
export function validateMeal(v: unknown, db?: FoodDb): string[] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return ["the meal is not an object"];
  const m = v as Record<string, unknown>;
  const errs: string[] = [];
  if (typeof m.id !== "string" || !m.id) errs.push("id is missing");
  if (typeof m.name !== "string" || !m.name.trim()) errs.push("the meal needs a name");
  else if (m.name.length > 80) errs.push("the name must be under 80 characters");
  if (m.note !== undefined && !(typeof m.note === "string" && m.note.length <= 1000)) errs.push("the note must be under 1000 characters");
  if (typeof m.createdAt !== "string") errs.push("createdAt is missing");
  if (!Array.isArray(m.items)) errs.push("items must be a list");
  else {
    if (m.items.length > MAX_MEAL_ITEMS) errs.push(`a meal can have at most ${MAX_MEAL_ITEMS} foods`);
    for (const it of m.items) {
      const i = it as Record<string, unknown>;
      if (typeof i !== "object" || i === null || typeof i.foodId !== "string" || typeof i.grams !== "number" || !(i.grams > 0) || i.grams > MAX_GRAMS) {
        errs.push(`each food needs a food and grams (more than 0, up to ${MAX_GRAMS})`);
        break;
      }
      if (db && !db.foods.some((f) => f[0] === i.foodId)) {
        errs.push(`food ${String(i.foodId)} isn't in the food table`);
        break;
      }
    }
  }
  return errs;
}

/** How many foods in the table have each nutrient measured: what the table can and can't say. */
export function coverage(db: FoodDb): Record<string, number> {
  return Object.fromEntries(db.keys.map((k, i) => [k, db.foods.filter((f) => f[2][i] !== null && f[2][i] !== undefined).length]));
}

/**
 * The day's EU reference values for a nutrient, for showing next to a supplement (Protocols): the
 * intake for this person (or, when it depends on sex and sex is unknown, the men's and women's
 * values), and the tolerable upper limit. Population values, never a dose.
 */
export function dailyReference(
  n: NutrientDef,
  person: { sex?: Sex; age?: number },
): {
  intake?: { amount: number; unit: string; type: "PRI" | "AI"; group: string };
  bySex?: { men: { amount: number; unit: string }; women: { amount: number; unit: string } };
  upperLimit?: { amount: number; unit: string; note: string };
} {
  if (person.age !== undefined && (!Number.isFinite(person.age) || person.age < 18)) return {};
  const intake = adultReference(n, person);
  let bySex: { men: { amount: number; unit: string }; women: { amount: number; unit: string } } | undefined;
  if (!intake) {
    const men = adultReference(n, { ...person, sex: "m" });
    const women = adultReference(n, { ...person, sex: "f" });
    if (men && women) bySex = { men: { amount: men.amount, unit: men.unit }, women: { amount: women.amount, unit: women.unit } };
  }
  const ul = n.reference.upperLimit;
  return { ...(intake ? { intake } : {}), ...(bySex ? { bySex } : {}), ...(ul ? { upperLimit: { amount: ul.amount, unit: ul.unit, note: ul.note } } : {}) };
}

/** The note a meal gets as a protocol item: how many foods and grams, e.g. "Meal: 4 foods, 350 g". */
export function mealNote(meal: Pick<Meal, "items">): string {
  const g = mealWeight(meal.items);
  return `Meal: ${meal.items.length} ${meal.items.length === 1 ? "food" : "foods"}, ${Math.round(g)} g`;
}
