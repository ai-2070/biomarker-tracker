// Daily check-ins: what the person ticked off each day, per habit and per item of a started protocol. Stored as
// `checkins.json` in the profile folder (Dexie table `checkins`). The app only counts ticks: it never says a day
// was "missed" on its own, never keeps streaks, and a habit nobody has ticked yet has no adherence at all.
import { addDays, dayNumber, daysBetween, isIsoDate } from "./dates";
import { normalizeItem, PLAN_TIMES, type PlanItem, type PlanTime, WEEKDAYS, type Weekday } from "./plans";
import type { ProtocolEntry } from "./types";

export interface CheckIn {
  /** `${habitId}|${date}`: one row per habit and day. */
  id: string;
  habitId: string;
  date: string;
  /** Items of the habit's protocol snapshot done that day. Missing for a habit without items: the habit itself was done. */
  items?: string[];
}

export const MAX_CHECKINS = 100_000;
export const checkInId = (habitId: string, date: string) => `${habitId}|${date}`;

/** Monday… Sunday of an ISO date. */
export function weekdayOf(date: string): Weekday {
  // 1970-01-01 (day 0) was a Thursday.
  return WEEKDAYS[(((dayNumber(date) + 3) % 7) + 7) % 7]!;
}

/** Whether the habit runs on that date (started, not ended before it). */
export function activeOn(p: Pick<ProtocolEntry, "start" | "end">, date: string): boolean {
  return p.start <= date && (!p.end || p.end >= date);
}

/**
 * The started protocol's items planned for that date: items on some weekdays are left out on the others, and
 * every-other-day items count from the day the protocol was started.
 */
export function itemsOn(p: Pick<ProtocolEntry, "plan" | "start">, date: string): PlanItem[] {
  const day = weekdayOf(date);
  const sinceStart = daysBetween(p.start, date);
  return (p.plan?.items ?? []).map(normalizeItem).filter((i) => (i.every === 2 ? sinceStart >= 0 && sinceStart % 2 === 0 : !i.days || i.days.includes(day)));
}

export interface DayTask {
  habitId: string;
  /** The habit's name (the protocol's name for a started protocol). */
  habit: string;
  /** Missing for a habit without items. */
  itemId?: string;
  label: string;
  amount?: string;
  category: ProtocolEntry["category"];
  withFood?: boolean;
  note?: string;
  done: boolean;
}

export type DayTime = Exclude<PlanTime, "with meals">;
export interface DayPlan {
  date: string;
  groups: { when: DayTime; tasks: DayTask[] }[];
  done: number;
  total: number;
}

function isDone(row: CheckIn | undefined, itemId?: string): boolean {
  if (!row) return false;
  return itemId === undefined ? row.items === undefined : (row.items ?? []).includes(itemId);
}

/**
 * Everything planned for a day, by time of day: each item of a started protocol on its time, and habits without
 * items under "any time". Habits that haven't started or have ended aren't listed.
 */
export function dayPlan(protocols: readonly ProtocolEntry[], checkIns: readonly CheckIn[], date: string): DayPlan {
  const rows = new Map(checkIns.filter((c) => c.date === date).map((c) => [c.habitId, c]));
  const tasks: (DayTask & { when: DayTime })[] = [];
  for (const p of protocols) {
    if (!activeOn(p, date)) continue;
    const row = rows.get(p.id);
    if (p.plan?.items.length) {
      for (const i of itemsOn(p, date)) {
        const when = i.when === "with meals" ? "any time" : i.when;
        tasks.push({
          habitId: p.id,
          habit: p.label,
          itemId: i.id,
          label: i.label,
          ...(i.amount ? { amount: i.amount } : {}),
          category: i.category,
          ...(i.withFood ? { withFood: true } : {}),
          ...(i.note ? { note: i.note } : {}),
          when,
          done: isDone(row, i.id),
        });
      }
    } else tasks.push({ habitId: p.id, habit: p.label, label: p.label, category: p.category, when: "any time", done: isDone(row) });
  }
  const groups = PLAN_TIMES.map((when) => ({ when, tasks: tasks.filter((t) => t.when === when).map(({ when: _w, ...t }) => t) })).filter(
    (g) => g.tasks.length > 0,
  );
  return { date, groups, done: tasks.filter((t) => t.done).length, total: tasks.length };
}

/** The row after ticking or unticking one task; undefined means the row is removed (nothing done that day). */
export function toggled(current: CheckIn | undefined, habitId: string, date: string, itemId?: string): CheckIn | undefined {
  const id = checkInId(habitId, date);
  if (itemId === undefined) return current && current.items === undefined ? undefined : { id, habitId, date };
  const items = new Set(current?.items ?? []);
  if (items.has(itemId)) items.delete(itemId);
  else items.add(itemId);
  return items.size ? { id, habitId, date, items: [...items].sort() } : undefined;
}

export type DayState = "done" | "part" | "none" | "off";

/** How much of one day's plan was ticked: all, some, none, or nothing was planned ("off"). */
export function dayState(p: Pick<ProtocolEntry, "id" | "plan" | "start" | "end">, row: CheckIn | undefined, date: string): DayState {
  if (!activeOn(p, date)) return "off";
  if (!p.plan?.items.length) return isDone(row) ? "done" : "none";
  const planned = itemsOn(p, date);
  if (planned.length === 0) return "off";
  const done = planned.filter((i) => isDone(row, i.id)).length;
  return done === 0 ? "none" : done === planned.length ? "done" : "part";
}

export interface Adherence {
  /** The first day counted: the first day ticked (or the habit's start, if later). */
  since: string;
  /** Days with something planned, from `since` to yesterday (and today once anything is ticked today). */
  days: number;
  /** Days with everything planned ticked. */
  doneDays: number;
  /** Share of all planned tasks ticked, 0 to 1. */
  share: number;
}

/**
 * How often the person kept to a habit, counted only from the first day they ticked it: a habit started long ago
 * and never ticked has no adherence (unknown, not zero). Today counts once anything is ticked today.
 */
export function adherence(
  p: Pick<ProtocolEntry, "id" | "plan" | "start" | "end">,
  checkIns: readonly CheckIn[],
  today: string,
  to?: string,
): Adherence | undefined {
  const rows = new Map(checkIns.filter((c) => c.habitId === p.id).map((c) => [c.date, c]));
  const first = [...rows.keys()].sort()[0];
  if (!first) return undefined;
  const since = first > p.start ? first : p.start;
  let last = to && to < today ? to : today;
  if (p.end && p.end < last) last = p.end;
  if (last === today && !rows.has(today)) last = addDays(today, -1);
  let days = 0;
  let doneDays = 0;
  let planned = 0;
  let done = 0;
  for (let d = since; d <= last; d = addDays(d, 1)) {
    const row = rows.get(d);
    const items = p.plan?.items.length ? itemsOn(p, d) : undefined;
    const count = items ? items.length : 1;
    if (count === 0 || !activeOn(p, d)) continue;
    const ticked = items ? items.filter((i) => isDone(row, i.id)).length : isDone(row) ? 1 : 0;
    days++;
    planned += count;
    done += ticked;
    if (ticked === count) doneDays++;
  }
  if (days === 0) return undefined;
  return { since, days, doneDays, share: done / planned };
}

/** The last `n` days, oldest first, for a small week strip. */
export function recentDays(p: Pick<ProtocolEntry, "id" | "plan" | "start" | "end">, checkIns: readonly CheckIn[], today: string, n = 7) {
  const rows = new Map(checkIns.filter((c) => c.habitId === p.id).map((c) => [c.date, c]));
  return Array.from({ length: n }, (_, k) => {
    const date = addDays(today, k - n + 1);
    return { date, state: dayState(p, rows.get(date), date) };
  });
}

/** Checks one stored row (profile folder, backups). */
export function isCheckIn(v: unknown): v is CheckIn {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (typeof r.habitId !== "string" || !r.habitId || r.habitId.length > 100) return false;
  if (typeof r.date !== "string" || !isIsoDate(r.date) || r.id !== checkInId(r.habitId, r.date)) return false;
  if (r.items === undefined) return Object.keys(r).every((k) => k === "id" || k === "habitId" || k === "date");
  return (
    Array.isArray(r.items) &&
    r.items.length > 0 &&
    r.items.length <= 60 &&
    r.items.every((i) => typeof i === "string" && i.length > 0 && i.length <= 100) &&
    new Set(r.items).size === r.items.length
  );
}

/** Problems with a whole list; empty means valid. */
export function checkInsError(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length > MAX_CHECKINS) return "The daily check-ins are damaged.";
  const ids = new Set<string>();
  for (const row of v) {
    if (!isCheckIn(row)) return "A daily check-in is damaged.";
    if (ids.has(row.id)) return "The daily check-ins contain duplicate IDs.";
    ids.add(row.id);
  }
  return undefined;
}

/** Combined state of a day's plan: all, some or none of it ticked, or nothing planned. */
export function planState(plan: Pick<DayPlan, "done" | "total">): DayState {
  if (plan.total === 0) return "off";
  return plan.done === plan.total ? "done" : plan.done === 0 ? "none" : "part";
}

/** "2026-11" moved by n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

/** A month ("2026-11") as weeks of seven dates, Monday first; null pads the days outside the month. */
export function monthWeeks(month: string): (string | null)[][] {
  const first = `${month}-01`;
  const lead = WEEKDAYS.indexOf(weekdayOf(first));
  const days: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d);
  while (days.length % 7) days.push(null);
  return Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
}

/** Each habit's first ticked day; habits never ticked are missing. */
export function firstTicks(checkIns: readonly CheckIn[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const c of checkIns) if (!first.has(c.habitId) || c.date < first.get(c.habitId)!) first.set(c.habitId, c.date);
  return first;
}

/** The habits counted on a day: only from the first day each one was ticked (before that it's unknown, not missed). */
export function trackedOn<T extends Pick<ProtocolEntry, "id">>(protocols: readonly T[], first: ReadonlyMap<string, string>, date: string): T[] {
  return protocols.filter((p) => {
    const since = first.get(p.id);
    return since !== undefined && since <= date;
  });
}
