import { isIsoDate } from "./dates";
import type { NutrientDef } from "./nutrients";
import { MAX_LABEL } from "./protocols";
import type { ProtocolEntry } from "./types";

/**
 * Protocols: a named set of things a person does together (a supplement stack, a diet, exercise,
 * sleep), each with their own amount and time of day, like a published routine they follow. Written
 * by the person (or loaded from a file someone shared); the app never suggests items or amounts. A
 * protocol can be started as one habit, so the whole routine can be compared before and after.
 * Stored as `protocols.json` in the profile folder (in code: "plans", because "protocols" already
 * names the Habits log).
 */

export type PlanCategory = ProtocolEntry["category"];
/**
 * Time of day. "with meals" is only read from older protocols: taking something with a meal is now the
 * item's `withFood` checkbox, next to its time (e.g. morning, with a meal), and `normalizeItem` turns an
 * old "with meals" item into "any time" with the checkbox ticked.
 */
export type PlanTime = "morning" | "midday" | "evening" | "bedtime" | "any time" | "with meals";
/** The times people choose from, in the day's order. */
export const PLAN_TIMES: readonly Exclude<PlanTime, "with meals">[] = ["morning", "midday", "evening", "bedtime", "any time"];
const READ_TIMES: readonly PlanTime[] = [...PLAN_TIMES, "with meals"];

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_SHORT: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const CATEGORIES: readonly PlanCategory[] = ["supplement", "diet", "medication", "lifestyle"];

export interface PlanItem {
  id: string;
  /** "Vitamin D3", "Zone 2 cardio", "No food 3 hours before bed". */
  label: string;
  /** The person's own amount, as they wrote it: "2000 IU", "45 min", "1 tbsp". Never set by the app. */
  amount?: string;
  category: PlanCategory;
  when: PlanTime;
  /** Taken with a meal (whatever the time of day). */
  withFood?: boolean;
  /** Only on these days of the week; missing means every day. */
  days?: Weekday[];
  /** Every other day, counted from the day the protocol was started (never together with `days`). */
  every?: 2;
  note?: string;
  /** One of the person's saved meals, when the item is that meal. Local only: dropped when shared. */
  mealId?: string;
}

export interface Plan {
  id: string;
  name: string;
  description?: string;
  /** Where it comes from, as the person wrote it (a book, a website, their doctor). */
  source?: string;
  items: PlanItem[];
  createdAt: string;
  /** The active habit's id; older starts can retain several ids so their history stops safely. */
  active?: { since: string; habitIds: string[] };
}

export const MAX_ITEMS = 60;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const optStr = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);

/** Problems with one item; empty means valid. */
export function itemErrors(v: unknown): string[] {
  if (!isObj(v)) return ["an item is not an object"];
  const errs: string[] = [];
  if (typeof v.id !== "string" || !v.id) errs.push("item id is missing");
  if (typeof v.label !== "string" || !v.label.trim()) errs.push("each item needs a name");
  else if (v.label.length > MAX_LABEL) errs.push(`item names must be under ${MAX_LABEL} characters`);
  if (!optStr(v.amount, 40)) errs.push("amounts must be under 40 characters");
  if (!CATEGORIES.includes(v.category as PlanCategory)) errs.push("item type is invalid");
  if (!READ_TIMES.includes(v.when as PlanTime)) errs.push("item time is invalid");
  if (v.withFood !== undefined && typeof v.withFood !== "boolean") errs.push("'with a meal' must be yes or no");
  if (
    v.days !== undefined &&
    !(
      Array.isArray(v.days) &&
      v.days.length >= 1 &&
      v.days.length <= 7 &&
      new Set(v.days).size === v.days.length &&
      v.days.every((d) => WEEKDAYS.includes(d as Weekday))
    )
  )
    errs.push("the days of the week are invalid");
  if (v.every !== undefined && v.every !== 2) errs.push("'every other day' is invalid");
  if (v.every !== undefined && v.days !== undefined) errs.push("an item is either every other day or on days of the week");
  if (!optStr(v.note, 300)) errs.push("notes must be under 300 characters");
  if (!optStr(v.mealId, 64)) errs.push("the meal link is damaged");
  return errs;
}

/** Problems with a protocol; empty means valid. */
export function validatePlan(v: unknown): string[] {
  if (!isObj(v)) return ["the protocol is not an object"];
  const errs: string[] = [];
  if (typeof v.id !== "string" || !v.id) errs.push("id is missing");
  if (typeof v.name !== "string" || !v.name.trim()) errs.push("the protocol needs a name");
  else if (v.name.length > 80) errs.push("the name must be under 80 characters");
  if (!optStr(v.description, 1000)) errs.push("the description must be under 1000 characters");
  if (!optStr(v.source, 300)) errs.push("the source must be under 300 characters");
  if (typeof v.createdAt !== "string") errs.push("createdAt is missing");
  if (!Array.isArray(v.items)) errs.push("items must be a list");
  else {
    if (v.items.length > MAX_ITEMS) errs.push(`a protocol can have at most ${MAX_ITEMS} items`);
    for (const e of new Set(v.items.flatMap(itemErrors))) errs.push(e);
  }
  if (
    v.active !== undefined &&
    !(
      isObj(v.active) &&
      typeof v.active.since === "string" &&
      isIsoDate(v.active.since) &&
      Array.isArray(v.active.habitIds) &&
      v.active.habitIds.every((x) => typeof x === "string")
    )
  )
    errs.push("active is damaged");
  return errs;
}

// ---- Sharing: a protocol as a file -------------------------------------------------------------

const FILE_KIND = "biomarker-tracker-protocol";

/** A protocol to share: its content only (no ids, dates or the person's habits). */
export function planToFile(p: Plan): string {
  return JSON.stringify(
    {
      kind: FILE_KIND,
      version: 1,
      name: p.name,
      ...(p.description ? { description: p.description } : {}),
      ...(p.source ? { source: p.source } : {}),
      // Meal links point at this person's own meals, so they stay here.
      items: p.items.map(({ id: _id, mealId: _meal, ...rest }) => rest),
    },
    null,
    2,
  );
}

/** A shared protocol file as a new protocol, with fresh ids; or why it can't be read. */
export function planFromFile(text: string, newId: () => string, now: string): { ok: true; plan: Plan } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "This isn't a protocol file (it isn't valid JSON)." };
  }
  if (!isObj(json) || json.kind !== FILE_KIND) return { ok: false, error: "This isn't a protocol file from this app." };
  if (typeof json.version !== "number" || json.version > 1) return { ok: false, error: "This protocol file was made by a newer version of the app." };
  const items = Array.isArray(json.items)
    ? json.items.map((i) => {
        if (!isObj(i)) return i;
        const { mealId: _meal, ...rest } = i;
        const item = { ...rest, id: newId() };
        return itemErrors(item).length ? item : normalizeItem(item as unknown as PlanItem);
      })
    : json.items;
  const plan = {
    id: newId(),
    name: typeof json.name === "string" ? json.name.trim() : json.name,
    ...(json.description !== undefined ? { description: json.description } : {}),
    ...(json.source !== undefined ? { source: json.source } : {}),
    items,
    createdAt: now,
  };
  const errs = validatePlan(plan);
  return errs.length ? { ok: false, error: `The protocol file is damaged: ${errs[0]}.` } : { ok: true, plan: plan as Plan };
}

// ---- Reading a protocol ------------------------------------------------------------------------

/**
 * An item in today's form: an old "with meals" time becomes "any time" with `withFood`, days in the
 * week's order, and all seven days the same as none (every day).
 */
export function normalizeItem(i: PlanItem): PlanItem {
  const { days, ...rest } = i;
  const sorted = days && !i.every ? WEEKDAYS.filter((d) => days.includes(d)) : undefined;
  return {
    ...rest,
    ...(i.when === "with meals" ? { when: "any time" as const, withFood: true } : {}),
    ...(sorted && sorted.length > 0 && sorted.length < 7 ? { days: sorted } : {}),
  };
}

/** An item's days in words: "Every other day", "Mon, Wed, Fri", "Weekdays"; nothing for every day. */
export function scheduleLabel(item: Pick<PlanItem, "days" | "every">): string | undefined {
  return item.every === 2 ? "Every other day" : daysLabel(item.days);
}

/** Days of the week in words: "Mon, Wed, Fri", "Weekdays", "Weekends"; nothing for every day. */
export function daysLabel(days: readonly Weekday[] | undefined): string | undefined {
  if (!days || days.length === 0 || days.length === 7) return undefined;
  const set = new Set(days);
  if (set.size === 5 && ["mon", "tue", "wed", "thu", "fri"].every((d) => set.has(d as Weekday))) return "Weekdays";
  if (set.size === 2 && set.has("sat") && set.has("sun")) return "Weekends";
  return WEEKDAYS.filter((d) => set.has(d))
    .map((d) => DAY_SHORT[d])
    .join(", ");
}

/** Items grouped by time of day, in the day's order; empty times are left out. */
export function itemsByTime(p: Plan): { when: PlanTime; items: PlanItem[] }[] {
  const items = p.items.map(normalizeItem);
  return PLAN_TIMES.map((when) => ({ when, items: items.filter((i) => i.when === when) })).filter((g) => g.items.length > 0);
}

/** Lower case, letters and digits only, single spaces. */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The vitamin or mineral an item is about, by its name or other names: "Vitamin D3" (a form number
 * after the name is allowed), "Magnesium glycinate", "Folic acid". Longest names are tried first.
 */
export function nutrientFor(item: Pick<PlanItem, "label" | "category">, nutrients: readonly NutrientDef[]): NutrientDef | undefined {
  if (item.category !== "supplement" && item.category !== "diet") return undefined;
  const label = words(item.label);
  const names = nutrients
    .flatMap((n) => [n.name, ...n.otherNames].map((name) => ({ n, name: words(name) })))
    .filter((x) => x.name.length >= 3)
    .sort((a, b) => b.name.length - a.name.length);
  return names.find(({ name }) => new RegExp(`(^| )${escapeRegExp(name)}\\d*( |$)`).test(label))?.n;
}

export interface PairWarning {
  a: string;
  b: string;
  note: string;
}

/**
 * Interactions between items of one protocol, from the vitamins and minerals knowledge base: when a
 * nutrient's interaction names another nutrient in the same protocol (iron and calcium, zinc and copper).
 */
export function pairWarnings(p: Plan, nutrients: readonly NutrientDef[]): PairWarning[] {
  const linked = [
    ...new Map(p.items.flatMap((i) => (nutrientFor(i, nutrients) ? [[nutrientFor(i, nutrients)!.id, nutrientFor(i, nutrients)!] as const] : []))).values(),
  ];
  const out: PairWarning[] = [];
  for (const n of linked) {
    for (const x of n.interactions) {
      const other = linked.find((m) => m.id !== n.id && x.with.toLowerCase().includes(m.name.toLowerCase()));
      if (other && !out.some((w) => (w.a === other.name && w.b === n.name) || (w.a === n.name && w.b === other.name)))
        out.push({ a: n.name, b: other.name, note: x.note });
    }
  }
  return out;
}

/** One named habit for the whole protocol, with its items preserved as an independent snapshot. */
export function habitForPlan(p: Plan, start: string): Omit<ProtocolEntry, "id"> {
  const category = p.items[0]?.category ?? "lifestyle";
  return {
    label: p.name.trim(),
    category: p.items.every((i) => i.category === category) ? category : "lifestyle",
    start,
    plan: { id: p.id, items: p.items.map(normalizeItem) },
  };
}

// ---- From Brain: a protocol the person described in text --------------------------------------

/**
 * A protocol Brain wrote down from the person's own text (a pasted routine, a list): shown as a card
 * they check and create. Same rules as a file: validated, fresh ids, never running.
 */
export function planFromProposal(input: unknown, newId: () => string, now: string): { ok: true; plan: Plan } | { ok: false; error: string } {
  if (!isObj(input)) return { ok: false, error: "No protocol was given." };
  if (!Array.isArray(input.items) || input.items.length === 0) return { ok: false, error: "List the items from the person's text." };
  const items = input.items.map((i) => {
    if (!isObj(i)) return i;
    const { label, amount, category, when, note, withFood, days } = i;
    const item = {
      id: newId(),
      label: typeof label === "string" ? label.trim() : label,
      ...(typeof amount === "string" && amount.trim() ? { amount: amount.trim() } : {}),
      category,
      when,
      ...(withFood === true ? { withFood: true } : {}),
      ...(Array.isArray(days) && days.length ? { days } : {}),
      ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}),
    };
    return itemErrors(item).length ? item : normalizeItem(item as PlanItem);
  });
  const plan = {
    id: newId(),
    name: typeof input.name === "string" ? input.name.trim() : input.name,
    ...(typeof input.description === "string" && input.description.trim() ? { description: input.description.trim() } : {}),
    ...(typeof input.source === "string" && input.source.trim() ? { source: input.source.trim() } : {}),
    items,
    createdAt: now,
  };
  const errs = validatePlan(plan);
  return errs.length ? { ok: false, error: `The protocol isn't valid: ${errs[0]}.` } : { ok: true, plan: plan as Plan };
}
