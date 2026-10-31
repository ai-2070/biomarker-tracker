import bodyFatDef from "../../knowledge/biomarkers/body_fat.json";
import weightDef from "../../knowledge/biomarkers/weight.json";
import { dayNumber, isIsoDate } from "./dates";
import { ageAt, isBirthMonth } from "./phenoageDraws";
import { computeTrend } from "./trends";
import type { BiomarkerDef, Measurement, Profile } from "./types";
import { fromCanonical } from "./units";

export type BodyFatBand = "below" | "within" | "above" | "high";
export interface BodyFatGuide {
  sex: "m" | "f";
  ageFrom: number;
  ageTo: number;
  /** Last whole age in this group, for display; ageTo remains exclusive. */
  ageThrough: number;
  low: number;
  high: number;
  veryHigh: number;
}

// Gallagher et al. 2000, PMID 10966886, Table 4 (African American/white sample).
// Existing low/high guides remain sourced from the marker definition. The extra
// threshold corresponds to BMI 30, not a prospectively validated risk boundary.
const UPPER: Record<"m" | "f", Readonly<Record<number, number>>> = {
  m: { 20: 25, 40: 28, 60: 30 },
  f: { 20: 39, 40: 40, 60: 42 },
};

export function bodyFatGuide(age: number | undefined, sex: Profile["sex"]): BodyFatGuide | undefined {
  if (age === undefined || !Number.isFinite(age) || (sex !== "m" && sex !== "f")) return undefined;
  const row = bodyFatDef.defaultRanges.find((r) => r.sex === sex && age >= r.ageFrom && age < r.ageTo);
  if (!row) return undefined;
  const veryHigh = UPPER[sex][row.ageFrom];
  return veryHigh === undefined ? undefined : { sex, ageFrom: row.ageFrom, ageTo: row.ageTo, ageThrough: row.ageTo - 1, low: row.low, high: row.high, veryHigh };
}

function isPercentage(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

/** Rounded guide endpoints follow the existing inclusive marker range. */
export function bodyFatBand(value: number, guide: BodyFatGuide): BodyFatBand | undefined {
  if (!isPercentage(value)) return undefined;
  if (value < guide.low) return "below";
  if (value <= guide.high) return "within";
  return value < guide.veryHigh ? "above" : "high";
}

export type FitnessFatBand = "essential" | "athlete" | "fitness" | "average" | "obesity";
export interface FitnessFatRange {
  id: FitnessFatBand;
  label: string;
  low: number;
  high?: number;
}

// Common ACE-attributed adult reference, reproduced by Healthline (2025).
// This is not age-adjusted, an athletic assessment or a diagnostic standard.
// Keep the published whole-number intervals: do not fill their decimal gaps.
export const FITNESS_FAT_RANGES: Readonly<Record<"m" | "f", readonly FitnessFatRange[]>> = {
  m: [
    { id: "essential", label: "Essential fat", low: 2, high: 5 },
    { id: "athlete", label: "Athletes", low: 6, high: 13 },
    { id: "fitness", label: "Fitness", low: 14, high: 17 },
    { id: "average", label: "Average", low: 18, high: 24 },
    { id: "obesity", label: "Obesity", low: 25 },
  ],
  f: [
    { id: "essential", label: "Essential fat", low: 10, high: 13 },
    { id: "athlete", label: "Athletes", low: 14, high: 20 },
    { id: "fitness", label: "Fitness", low: 21, high: 24 },
    { id: "average", label: "Average", low: 25, high: 31 },
    { id: "obesity", label: "Obesity", low: 32 },
  ],
};

export function fitnessFatBand(value: number, sex: Profile["sex"]): FitnessFatRange | undefined {
  if (!isPercentage(value) || (sex !== "m" && sex !== "f")) return undefined;
  return FITNESS_FAT_RANGES[sex].find((r) => value >= r.low && (r.high === undefined || value <= r.high));
}

export interface BodyFatComparison {
  latest?: Measurement;
  /** Exact, finite percentage only; qualified limits are not plotted as points. */
  value?: number;
  age?: number;
  guide?: BodyFatGuide;
  band?: BodyFatBand;
  fitness?: FitnessFatRange;
}

/** Use age on the body-fat reading's date; today only supplies a guide before any reading exists. */
export function bodyFatComparison(ms: readonly Measurement[], profile: Profile, today: string): BodyFatComparison {
  const latest = computeTrend(ms.filter((m) => m.biomarkerId === "body_fat"))?.latest;
  const date = latest?.date ?? today;
  const age = profile.birthMonth && isBirthMonth(profile.birthMonth) && isIsoDate(date) ? ageAt(profile.birthMonth, date) : undefined;
  const guide = bodyFatGuide(age, profile.sex);
  const value = latest && !latest.qualifier && isPercentage(latest.value) ? latest.value : undefined;
  return {
    latest, age, guide, value,
    band: guide && value !== undefined ? bodyFatBand(value, guide) : undefined,
    // Adult reference only; no personal fitness label when age is unknown or under 20.
    fitness: age !== undefined && age >= 20 && value !== undefined ? fitnessFatBand(value, profile.sex) : undefined,
  };
}

export interface FatMassEstimate {
  kg: number;
  lb: number;
  weight: Measurement;
  daysApart: number;
}

/** Nearest exact weight within 30 days; prefer an earlier weight on an equal-distance tie. */
export function fatMassAt(bodyFat: Measurement, ms: readonly Measurement[]): FatMassEstimate | undefined {
  if (bodyFat.biomarkerId !== "body_fat" || bodyFat.qualifier || !isPercentage(bodyFat.value) || !isIsoDate(bodyFat.date)) return undefined;
  const day = dayNumber(bodyFat.date);
  let weight: Measurement | undefined;
  let daysApart = Infinity;
  for (const m of ms) {
    if (m.biomarkerId !== "weight" || m.qualifier || !Number.isFinite(m.value) || m.value <= 0 || !isIsoDate(m.date)) continue;
    const distance = Math.abs(dayNumber(m.date) - day);
    if (distance > 30) continue;
    if (distance < daysApart || (distance === daysApart && (!weight || m.date <= weight.date))) {
      weight = m;
      daysApart = distance;
    }
  }
  if (!weight) return undefined;
  const kg = weight.value * (bodyFat.value / 100);
  return { kg, lb: fromCanonical(weightDef as BiomarkerDef, kg, "lb"), weight, daysApart };
}
