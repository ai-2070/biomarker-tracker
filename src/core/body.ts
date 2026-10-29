import { isIsoDate } from "./dates";
import { validateManualEntry } from "./importers/manual";
import { sortByDate } from "./trends";
import type { BiomarkerDef, Measurement } from "./types";

/**
 * Body measurements: weight, waist, body fat, blood pressure, resting heart rate. They are stored
 * like blood results (same Measurement, canonical units, ranges), with their own entry form and
 * dashboard. BMI and waist-to-height are computed here, never stored.
 */

export type BodyField =
  | "weight"
  | "waist"
  | "body_fat"
  | "bp_systolic"
  | "bp_diastolic"
  | "resting_hr"
  | "heart_rate"
  | "exercise_hr"
  | "hrv"
  | "hrv_resting"
  | "spo2"
  | "glucose_home"
  | "sleep_duration"
  | "sleep_deep"
  | "sleep_rem"
  | "vo2max";
export const BODY_FIELDS: readonly BodyField[] = ["weight", "waist", "body_fat", "bp_systolic", "bp_diastolic", "resting_hr", "heart_rate", "exercise_hr", "hrv", "hrv_resting", "spo2", "glucose_home", "sleep_duration", "sleep_deep", "sleep_rem", "vo2max"];

/** Sleep is counted per night (dated by the morning you woke up): readings on one day add up, naps included. */
export const SLEEP_FIELDS: ReadonlySet<BodyField> = new Set(["sleep_duration", "sleep_deep", "sleep_rem"]);

/** Body measurements in groups, for the Body dashboard and the entry form. */
export const BODY_GROUPS: readonly { id: "size" | "heart" | "sleep" | "sugar"; title: string; fields: readonly BodyField[] }[] = [
  { id: "size", title: "Size and composition", fields: ["weight", "waist", "body_fat"] },
  { id: "heart", title: "Heart and oxygen", fields: ["bp_systolic", "bp_diastolic", "resting_hr", "heart_rate", "exercise_hr", "hrv", "hrv_resting", "spo2", "vo2max"] },
  { id: "sleep", title: "Sleep", fields: ["sleep_duration", "sleep_deep", "sleep_rem"] },
  { id: "sugar", title: "Blood sugar", fields: ["glucose_home"] },
];

/** Values outside these (canonical unit) are almost certainly typos, e.g. 1765 for 176.5. */
export const PLAUSIBLE: Record<BodyField, { min: number; max: number }> = {
  weight: { min: 20, max: 350 },
  waist: { min: 40, max: 250 },
  body_fat: { min: 2, max: 70 },
  bp_systolic: { min: 60, max: 280 },
  bp_diastolic: { min: 30, max: 180 },
  resting_hr: { min: 25, max: 220 },
  heart_rate: { min: 25, max: 220 },
  exercise_hr: { min: 40, max: 230 },
  hrv: { min: 2, max: 300 },
  hrv_resting: { min: 2, max: 300 },
  spo2: { min: 50, max: 100 },
  glucose_home: { min: 1, max: 35 },
  // Stages of 0 usually mean "no stage data" (older devices), so they're left out rather than saved.
  sleep_duration: { min: 0.25, max: 18 },
  sleep_deep: { min: 0.05, max: 8 },
  sleep_rem: { min: 0.05, max: 8 },
  vo2max: { min: 8, max: 95 },
};

/** Body mass index, kg/m². Only for adult heights between 100 and 250 cm. */
export function bmi(weightKg: number, heightCm: number | undefined): number | undefined {
  if (!heightCm || heightCm < 100 || heightCm > 250 || !(weightKg > 0)) return undefined;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/**
 * Basal metabolic rate (kcal a day): the energy the body uses at complete rest, estimated with the
 * Mifflin–St Jeor equation (Mifflin 1990, PMID 2305711), the most accurate of the common equations in
 * a systematic review (Frankenfield 2005, PMID 15883556; within 10 % for most adults). Only for adults
 * with weight, height, age and sex known. An estimate, never a target.
 */
export function bmrMifflin(weightKg: number, heightCm: number | undefined, ageYears: number | undefined, sex: "m" | "f" | undefined): number | undefined {
  if (!(weightKg > 0) || !heightCm || heightCm < 100 || heightCm > 250 || ageYears === undefined || ageYears < 18 || !sex) return undefined;
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (sex === "m" ? 5 : -161);
}

/** Waist ÷ height. Below 0.5 is the usual guide for adults (Ashwell 2012, PMID 22106927). */
export function waistToHeight(waistCm: number, heightCm: number | undefined): number | undefined {
  if (!heightCm || heightCm < 100 || heightCm > 250 || !(waistCm > 0)) return undefined;
  return waistCm / heightCm;
}

/**
 * Waist-to-height ranges used by Ashwell et al. (PLoS One 2014, PMID 25198730, and the boundaries it
 * cites): below 0.4 may mean low body weight, 0.4 to below 0.5 is the usual guide, 0.5 to below 0.6 is
 * increased health risk, 0.6 and above high risk. A guide for adults, not a diagnosis.
 */
export type WaistToHeightBand = "low" | "guide" | "increased" | "high";
export function waistToHeightBand(ratio: number): WaistToHeightBand {
  // Rounded to 2 decimals first, so the shown 0.50 and the band agree.
  const r = Math.round(ratio * 100) / 100;
  return r < 0.4 ? "low" : r < 0.5 ? "guide" : r < 0.6 ? "increased" : "high";
}

/**
 * Years of life lost by waist-to-height ratio: Ashwell et al. 2014 (PLoS One, PMID 25198730), Table 3,
 * copied exactly. British non-smokers (HALS and HSE data); compared with a ratio of 0.5 for men and 0.46
 * for women; the ratio assumed to stay the same for the rest of life. Only these ages and ratios were
 * tabulated, so nothing in between is filled in.
 */
export const WHTR_YEARS_LOST: readonly { sex: "m" | "f"; age: 30 | 50 | 70; years: readonly [number, number, number, number] }[] = [
  { sex: "m", age: 30, years: [0, 1.7, 7.2, 20.2] },
  { sex: "m", age: 50, years: [0, 1.4, 5.8, 14.3] },
  { sex: "m", age: 70, years: [0, 0.5, 2.9, 6.7] },
  { sex: "f", age: 30, years: [0.1, 1.4, 4.6, 10.6] },
  { sex: "f", age: 50, years: [0.1, 1.3, 4.1, 9.2] },
  { sex: "f", age: 70, years: [0, 0.8, 2.7, 5.9] },
];
/** The ratios the years-lost table has columns for (the last is "0.8 or more"). */
export const WHTR_YEARS_LOST_RATIOS = [0.5, 0.6, 0.7, 0.8] as const;

/**
 * The table row nearest the person's age (30 for under 40, 50 for 40–59, 70 from 60), with the
 * columns the ratio sits between: `from` is the last column at or below it, `to` the next one.
 */
export function waistToHeightYearsLost(
  ratio: number,
  person: { sex?: "m" | "f"; age?: number },
): { row: (typeof WHTR_YEARS_LOST)[number]; from?: number; to?: number } | undefined {
  if (!person.sex || person.age === undefined || person.age < 18) return undefined;
  const age = person.age < 40 ? 30 : person.age < 60 ? 50 : 70;
  const row = WHTR_YEARS_LOST.find((r) => r.sex === person.sex && r.age === age)!;
  const r = Math.round(ratio * 100) / 100;
  const i = WHTR_YEARS_LOST_RATIOS.findLastIndex((x) => r >= x);
  return { row, ...(i >= 0 ? { from: i } : {}), ...(i < WHTR_YEARS_LOST_RATIOS.length - 1 ? { to: i + 1 } : {}) };
}

/** Latest measurement of each body field. */
export function latestBody(ms: readonly Measurement[]): Partial<Record<BodyField, Measurement>> {
  const out: Partial<Record<BodyField, Measurement>> = {};
  for (const m of sortByDate(ms)) if ((BODY_FIELDS as readonly string[]).includes(m.biomarkerId)) out[m.biomarkerId as BodyField] = m;
  return out;
}

/** The latest blood pressure reading: top and bottom numbers from the same day. */
export function latestBloodPressure(ms: readonly Measurement[]): { systolic: Measurement; diastolic: Measurement } | undefined {
  const sys = sortByDate(ms.filter((m) => m.biomarkerId === "bp_systolic"));
  const dia = sortByDate(ms.filter((m) => m.biomarkerId === "bp_diastolic"));
  for (let i = sys.length - 1; i >= 0; i--) {
    const d = [...dia].reverse().find((m) => m.date === sys[i]!.date);
    if (d) return { systolic: sys[i]!, diastolic: d };
  }
  return undefined;
}

/** When a glucose reading was taken; it decides which range applies. */
export type GlucoseContext = "fasting" | "after-meal" | "other";

export interface BodyEntryInput {
  date: string;
  values: Partial<Record<BodyField, { value: string; unit: string }>>;
  glucoseContext?: GlucoseContext;
}

export type BodyEntryErrors = Partial<Record<BodyField | "date" | "form" | "glucoseContext", string>>;

/** Checks one day's body measurements. Empty fields are skipped; at least one is needed. */
export function validateBodyEntry(
  input: BodyEntryInput,
  defs: ReadonlyMap<string, BiomarkerDef>,
  today: string,
): { ok: true; measurements: Omit<Measurement, "id">[] } | { ok: false; errors: BodyEntryErrors } {
  const errors: BodyEntryErrors = {};
  const filled = BODY_FIELDS.filter((f) => (input.values[f]?.value ?? "").trim() !== "");
  if (filled.length === 0) return { ok: false, errors: { form: "Enter at least one measurement." } };
  if (!isIsoDate(input.date)) return { ok: false, errors: { date: "Enter the date you measured." } };
  if (input.date > today) return { ok: false, errors: { date: "The date can't be in the future." } };

  const out: Omit<Measurement, "id">[] = [];
  for (const f of filled) {
    const v = input.values[f]!;
    const r = validateManualEntry({ biomarkerId: f, value: v.value, unit: v.unit, date: input.date }, defs, today);
    if (!r.ok) {
      const rest = Object.entries(r.errors).filter(([k]) => k !== "date").map(([, e]) => e);
      if (rest.length) errors[f] = rest.join(" ");
      continue;
    }
    const p = PLAUSIBLE[f];
    if (r.measurement.value < p.min || r.measurement.value > p.max) {
      errors[f] = "That looks unlikely. Check for a typo or the unit.";
      continue;
    }
    if (f === "glucose_home") {
      if (!input.glucoseContext) {
        errors.glucoseContext = "Choose when you measured: it decides which range applies.";
        continue;
      }
      if (input.glucoseContext !== "other") r.measurement.fasted = input.glucoseContext === "fasting";
    }
    out.push(r.measurement);
  }

  const hasSys = filled.includes("bp_systolic");
  const hasDia = filled.includes("bp_diastolic");
  if (hasSys !== hasDia) errors[hasSys ? "bp_diastolic" : "bp_systolic"] = "Enter both numbers of the blood pressure reading.";
  const sys = out.find((m) => m.biomarkerId === "bp_systolic");
  const dia = out.find((m) => m.biomarkerId === "bp_diastolic");
  if (sys && dia && sys.value <= dia.value) errors.bp_systolic = "The top number (systolic) is normally higher than the bottom one. Check the order.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, measurements: out };
}

// Lives with the range checks (sleep is judged on it); kept here too for the body code that uses it.
export { recentAverage } from "./trends";
