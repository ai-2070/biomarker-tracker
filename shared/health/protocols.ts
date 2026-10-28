import { dayNumber, isIsoDate } from "./dates.ts";
import type { ProtocolEntry, SafetyId } from "./types.ts";

export type ProtocolCategory = ProtocolEntry["category"];
export const PROTOCOL_CATEGORIES: readonly ProtocolCategory[] = ["supplement", "diet", "medication", "lifestyle"];

export interface ProtocolInput {
  label: string;
  category: string;
  start: string;
  /** Empty = still ongoing. */
  end?: string;
}

export type ProtocolField = keyof ProtocolInput;

export type ProtocolValidation =
  | { ok: true; entry: Omit<ProtocolEntry, "id"> }
  | { ok: false; errors: Partial<Record<ProtocolField, string>> };

export const MAX_LABEL = 80;

export function validateProtocol(input: ProtocolInput, today: string): ProtocolValidation {
  const errors: Partial<Record<ProtocolField, string>> = {};
  const label = input.label.trim();
  if (!label) errors.label = "Describe what you took or changed, e.g. \"Vitamin D 1000 IU daily\".";
  else if (label.length > MAX_LABEL) errors.label = `Please keep it under ${MAX_LABEL} characters.`;

  if (!(PROTOCOL_CATEGORIES as readonly string[]).includes(input.category)) errors.category = "Choose a type.";

  if (!isIsoDate(input.start)) errors.start = "Enter the date you started.";
  else if (input.start > today) errors.start = "The start date can't be in the future.";

  const end = input.end?.trim() || undefined;
  if (end !== undefined) {
    if (!isIsoDate(end)) errors.end = "Enter a valid date, or leave it empty if you're still doing this.";
    else if (isIsoDate(input.start) && end < input.start) errors.end = "The end date can't be before the start date.";
    else if (end > today) errors.end = "The end date can't be in the future. Leave it empty if this is ongoing.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const entry: Omit<ProtocolEntry, "id"> = { label, category: input.category as ProtocolCategory, start: input.start };
  if (end) entry.end = end;
  return { ok: true, entry };
}

/** Was this entry going on at the given date (inclusive)? */
export function isActiveOn(p: Pick<ProtocolEntry, "start" | "end">, date: string): boolean {
  return p.start <= date && (p.end === undefined || p.end >= date);
}

export function activeOn<T extends Pick<ProtocolEntry, "start" | "end">>(ps: readonly T[], date: string): T[] {
  return ps.filter((p) => isActiveOn(p, date));
}

/** Ongoing first (newest start first), then past entries (most recently ended first). */
export function sortProtocols<T extends Pick<ProtocolEntry, "start" | "end">>(ps: readonly T[]): T[] {
  return [...ps].sort((a, b) => {
    if (!a.end !== !b.end) return a.end ? 1 : -1;
    if (a.end && b.end && a.end !== b.end) return a.end < b.end ? 1 : -1;
    return a.start < b.start ? 1 : a.start > b.start ? -1 : 0;
  });
}

/** Whole days from start to end (or to `today` if ongoing), counting both ends. */
export function durationDays(p: Pick<ProtocolEntry, "start" | "end">, today: string): number {
  return dayNumber(p.end ?? today) - dayNumber(p.start) + 1;
}

export interface Lane {
  /** Position within the chart's date range, 0–100. */
  leftPct: number;
  widthPct: number;
  /** The entry started before the chart's first date. */
  cutStart: boolean;
  /** The entry continues past the chart's last date. */
  cutEnd: boolean;
}

/**
 * Where to draw an entry as a bar under a chart covering [from, to].
 * Ongoing entries run to `today`. Returns undefined if there is no overlap.
 * A chart with a single date gets a centred bar for entries active that day.
 */
export function laneFor(p: Pick<ProtocolEntry, "start" | "end">, from: string, to: string, today: string): Lane | undefined {
  const a = dayNumber(p.start);
  const b = dayNumber(p.end ?? (today > to ? today : to));
  const lo = dayNumber(from);
  const hi = dayNumber(to);
  if (b < lo || a > hi) return undefined;
  if (hi === lo) return { leftPct: 0, widthPct: 100, cutStart: a < lo, cutEnd: b > hi };
  const s = Math.max(a, lo);
  const e = Math.min(b, hi);
  const span = hi - lo;
  // At least 1 % wide so a short entry stays visible.
  return {
    leftPct: ((s - lo) / span) * 100,
    widthPct: Math.max(1, ((e - s) / span) * 100),
    cutStart: a < lo,
    cutEnd: b > hi,
  };
}

// Safety notes (CLAUDE.md "Safety rules")

export interface SafetyNote {
  id: SafetyId;
  title: string;
  text: string;
}

const SAFETY: { note: SafetyNote; pattern: RegExp }[] = [
  {
    note: {
      id: "anticoagulant",
      title: "Blood thinner",
      text: "Vitamin K (in leafy greens and some supplements) and several supplements, such as fish oil, ginkgo or high-dose vitamin E, can change how blood thinners work. Talk to your doctor before changing your diet or supplements.",
    },
    pattern:
      /warfarin|coumadin|marcumar|phenprocoumon|acenocoumarol|sintrom|apixaban|eliquis|rivaroxaban|xarelto|dabigatran|pradaxa|edoxaban|lixiana|savaysa|heparin|enoxaparin|clexane|lovenox|blood thinner|anticoagul/i,
  },
  {
    note: {
      id: "diabetes",
      title: "Diabetes medicine",
      text: "Changes in diet, fasting, exercise or some supplements can change blood sugar while you take this medicine, sometimes to dangerously low levels. Talk to your doctor before making changes.",
    },
    pattern:
      /insulin|metformin|glucophage|gliclazide|glimepiride|glipizide|glibenclamide|glyburide|sulfonylurea|sitagliptin|januvia|empagliflozin|jardiance|dapagliflozin|forxiga|farxiga|canagliflozin|semaglutide|ozempic|rybelsus|wegovy|liraglutide|victoza|saxenda|dulaglutide|trulicity|tirzepatide|mounjaro|zepbound|pioglitazone/i,
  },
  {
    note: {
      id: "pregnancy",
      title: "Pregnancy",
      text: "Many supplements and herbal products haven't been tested in pregnancy, and some nutrients (such as vitamin A) can be harmful in high doses. Talk to your doctor or midwife before changing supplements.",
    },
    pattern: /pregnan|prenatal|breastfeed|breast-feed|schwanger|stillzeit|terhes/i,
  },
  {
    note: {
      id: "kidney",
      title: "Kidney disease",
      text: "With reduced kidney function, potassium, phosphate, magnesium and some supplements can build up in the blood. Don't increase these without talking to your doctor.",
    },
    pattern: /dialysis|kidney disease|chronic kidney|\bckd\b|renal failure|kidney failure|niereninsuffizienz|dialyse|vesebetegség/i,
  },
];

/** Notes to show prominently for entries that change what is safe to suggest. */
export function safetyNotes(labels: readonly string[]): SafetyNote[] {
  return SAFETY.filter(({ pattern }) => labels.some((l) => pattern.test(l))).map(({ note }) => note);
}
