import { PLAUSIBLE, type BodyField } from "../body";
import type { ParsedReport, ParsedRow } from "./labText";

/**
 * Body measurements from the text of a health app screenshot (Samsung Health, Garmin, Oura, Apple
 * Health, Fitbit…), read on this device with text recognition. Phone screens put a label and its
 * value on the same line or the next one or two ("Resting heart rate" / "58 bpm"); sleep is written
 * as "7 h 12 min". Each value is shown for checking before anything is saved (the same review as lab
 * reports), with the date set to today because screenshots rarely show it clearly.
 */

const LABELS: readonly { re: RegExp; field: BodyField | "bp" }[] = [
  { re: /resting heart rate|resting hr|resting pulse|ruhepuls|nyugalmi pulzus/, field: "resting_hr" },
  { re: /\bhrv\b|heart rate variability/, field: "hrv" },
  { re: /spo2|sp02|blood oxygen|oxygen saturation|sauerstoff/, field: "spo2" },
  { re: /vo2|vo₂|cardio fitness/, field: "vo2max" },
  { re: /blood pressure|vérnyomás|blutdruck/, field: "bp" },
  { re: /body fat|fat percentage|körperfett|testzsír/, field: "body_fat" },
  { re: /\bweight\b|body mass|gewicht|testsúly/, field: "weight" },
  { re: /\bwaist\b/, field: "waist" },
  { re: /deep sleep|^deep$/, field: "sleep_deep" },
  { re: /rem sleep|^rem$/, field: "sleep_rem" },
  { re: /time asleep|total sleep|sleep duration|^sleep$|^asleep$|^actual sleep/, field: "sleep_duration" },
  { re: /glucose|blood sugar|vércukor|blutzucker/, field: "glucose_home" },
  { re: /heart rate|^hr$|avg hr|average hr|^pulse$|^puls$/, field: "heart_rate" },
];

/** Words that make a line not a measurement of the field (goals, scores, ranges, sleep score…). */
const NOT_A_VALUE = /goal|target|score|zone|\b(max|min)\b.*(heart|hr|rate|pulse)|(heart|hr|rate|pulse).*\b(max|min)\b|minimum|maximum|lowest|highest|range|average of|trend|baseline|status|readiness|recovery/;

/** A line under a label counts only when it's just the value: "58 bpm", "128/82 mmHg", "7 h 12 min". */
const ONLY_VALUE =
  /^[<>~≈]?\s*\d{1,3}(?:[.,]\d{1,2})?\s*(?:\/\s*\d{2,3})?\s*(?:bpm|\/\s*min|ms|%|kg|lbs?|mmhg|mmol\/l|mg\/dl|cm|in|ml\/kg\/min)?\.?\s*$|^\s*\d{1,2}\s*(?:h|hr|hrs|hours?|ó|óra|std)\.?\s*(?:\d{1,2}\s*(?:m|min|mins|minutes?|p|perc)\.?)?\s*$|^\s*\d{1,3}\s*(?:m|min|mins|minutes?)\s*$|^\s*\d{1,2}:[0-5]\d\s*$/i;

const UNITS: Partial<Record<BodyField, readonly [RegExp, string][]>> = {
  resting_hr: [[/bpm|\/min/, "bpm"]],
  heart_rate: [[/bpm|\/min/, "bpm"]],
  hrv: [[/\bms\b/, "ms"]],
  hrv_resting: [[/\bms\b/, "ms"]],
  spo2: [[/%/, "%"]],
  vo2max: [[/ml\s*\/\s*kg/, "mL/kg/min"]],
  body_fat: [[/%/, "%"]],
  weight: [[/\bkg\b/, "kg"], [/\blbs?\b/, "lb"]],
  waist: [[/\bcm\b/, "cm"], [/\bin\b|"/, "in"]],
  glucose_home: [[/mmol/, "mmol/L"], [/mg\s*\/\s*dl/, "mg/dL"]],
};

const DEFAULT_UNIT: Record<BodyField, string> = {
  weight: "kg", waist: "cm", body_fat: "%", bp_systolic: "mmHg", bp_diastolic: "mmHg", resting_hr: "bpm", heart_rate: "bpm", exercise_hr: "bpm",
  hrv: "ms", hrv_resting: "ms", spo2: "%", glucose_home: "mmol/L", sleep_duration: "h", sleep_deep: "h", sleep_rem: "h", vo2max: "mL/kg/min",
  pushups: "reps", grip_strength: "kg", sit_to_stand_5x: "s", chair_stand_30s: "reps", one_leg_stand: "s", gait_speed: "m/s", sitting_rising: "points",
};

/** "7 h 12 min", "7h 12m", "7 hr", "45 min", "1:35" → hours. */
export function durationHours(s: string): number | undefined {
  let m = /(\d{1,2})\s*(?:h|hr|hrs|hours?|ó|óra|std)\.?\s*(\d{1,2})\s*(?:m|min|mins|minutes?|p|perc)\b/i.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = /(\d{1,2})\s*(?:h|hr|hrs|hours?)\b/i.exec(s);
  if (m) return Number(m[1]);
  m = /(\d{1,3})\s*(?:m|min|mins|minutes?)\b/i.exec(s);
  if (m) return Number(m[1]) / 60;
  m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  return undefined;
}

/** The value of a field in one line of text, if it has one. */
function valueIn(field: BodyField | "bp", s: string): { value: number; unit: string; dia?: number } | undefined {
  const t = s.toLowerCase();
  if (field === "bp") {
    const m = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(t);
    return m ? { value: Number(m[1]), dia: Number(m[2]), unit: "mmHg" } : undefined;
  }
  if (field === "sleep_duration" || field === "sleep_deep" || field === "sleep_rem") {
    const h = durationHours(t);
    return h === undefined ? undefined : { value: Math.round(h * 100) / 100, unit: "h" };
  }
  // A number, not part of a time (07:30) or a date (12/03).
  const m = /(?<![\d:/.,])(\d{1,3}(?:[.,]\d{1,2})?)(?![\d:/])\s*([^\d\s]{0,12}(?:\s?\/\s?\w{2,3})?)/.exec(t);
  if (!m) return undefined;
  const value = Number(m[1]!.replace(",", "."));
  const unit = (UNITS[field] ?? []).find(([re]) => re.test(t))?.[1] ?? DEFAULT_UNIT[field];
  return { value, unit };
}

const toCanonicalRough = (value: number, unit: string) => (unit === "lb" ? value * 0.4536 : unit === "in" ? value * 2.54 : unit === "mg/dL" ? value * 0.0555 : value);

export function parseHealthScreenshot(text: string, today: string): ParsedReport {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const low = line.toLowerCase();
    const label = LABELS.find((l) => l.re.test(low));
    if (!label || NOT_A_VALUE.test(low)) return;
    let field: BodyField | "bp" = label.field;
    if (field === "hrv" && /night|sleep|overnight|resting|morning/.test(low)) field = "hrv_resting";
    // The value: on the label's line after the label, or on one of the next two lines.
    const after = line.slice(low.search(label.re) + (low.match(label.re)?.[0].length ?? 0));
    let found: { value: number; unit: string; dia?: number } | undefined;
    let from = line;
    for (const [candidate, src] of [[after, line], [lines[i + 1] ?? "", lines[i + 1] ?? ""], [lines[i + 2] ?? "", lines[i + 2] ?? ""]] as const) {
      if (candidate !== after && LABELS.some((l) => l.re.test(candidate.toLowerCase()))) break;
      if (candidate !== after && !ONLY_VALUE.test(candidate)) continue;
      found = valueIn(field, candidate);
      if (found) {
        from = src === line ? line : `${line} ${src}`;
        break;
      }
    }
    if (!found) return;
    const add = (f: BodyField, value: number, unit: string) => {
      if (seen.has(f)) return;
      seen.add(f);
      const p = PLAUSIBLE[f];
      const c = toCanonicalRough(value, unit);
      const problems = c < p.min || c > p.max ? ["This doesn't look like a real value: check it against the screenshot."] : [];
      rows.push({ line: from, biomarkerId: f, value: String(value), unit, problems, notes: ["Read from a screenshot: check the value and the date."] });
    };
    if (field === "bp") {
      add("bp_systolic", found.value, "mmHg");
      add("bp_diastolic", found.dia!, "mmHg");
    } else add(field, found.value, found.unit);
  });
  return { rows, date: today, dateNote: "Screenshots rarely show the date clearly: check it, and change it if the values are from another day.", unmatched: [] };
}
