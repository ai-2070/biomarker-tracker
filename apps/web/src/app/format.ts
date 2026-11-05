import { SLEEP_FIELDS, type BodyField } from "@bt/shared/core/body";
import { deltaFromCanonical, formatValue, fromCanonical, matchUnit } from "@bt/shared/core/units";
import type { Flag } from "@bt/shared/core/trends";
import type { BiomarkerDef, Measurement, ProtocolEntry } from "@bt/shared/core/types";

// Display-only helpers. All numbers come from /core; this file only formats them.

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return dateFmt.format(new Date(y!, m! - 1, d!));
}

/** Pick a supported display unit; sleep is always presented as hours/minutes from canonical hours. */
export function displayUnitFor(def: BiomarkerDef, preferred: string | undefined): string {
  if (SLEEP_FIELDS.has(def.id as BodyField)) return def.canonicalUnit;
  return (preferred && matchUnit(def, preferred)) || def.canonicalUnit;
}

/** A canonical value for reading: hours/minutes for sleep, otherwise the chosen numeric unit. */
export function showValue(def: BiomarkerDef, canonicalValue: number, unit: string): string {
  if (SLEEP_FIELDS.has(def.id as BodyField)) return formatHours(canonicalValue);
  return formatValue(fromCanonical(def, canonicalValue, unit));
}

/** Sleep values include their hours/minutes; other measurements still need a unit suffix. */
export function valueUnit(def: BiomarkerDef, unit: string): string {
  return SLEEP_FIELDS.has(def.id as BodyField) ? "" : unit;
}

/** A measurement shown in the chosen unit, keeping "<" / ">" from the lab. */
export function showMeasurement(def: BiomarkerDef, m: Measurement, unit: string): string {
  return `${m.qualifier ?? ""}${showValue(def, m.value, unit)}`;
}

export function showRange(def: BiomarkerDef, range: { low?: number; high?: number } | undefined, unit: string): string | undefined {
  if (!range) return undefined;
  const { low, high } = range;
  const suffix = valueUnit(def, unit);
  if (low !== undefined && high !== undefined) return `${showValue(def, low, unit)}–${showValue(def, high, unit)} ${suffix}`.trim();
  if (low !== undefined) return `above ${showValue(def, low, unit)} ${suffix}`.trim();
  if (high !== undefined) return `below ${showValue(def, high, unit)} ${suffix}`.trim();
  return undefined;
}

/** A change between two results, e.g. "+4.2" or "−0.3", in the chosen unit. */
export function showChange(def: BiomarkerDef, canonicalDelta: number, unit: string): string {
  if (SLEEP_FIELDS.has(def.id as BodyField)) {
    const text = formatHours(Math.abs(canonicalDelta));
    return text === "0 min" ? "no change" : `${canonicalDelta > 0 ? "+" : "−"}${text}`;
  }
  const text = formatValue(Math.abs(deltaFromCanonical(def, canonicalDelta, unit)));
  if (text === "0") return "no change";
  return canonicalDelta > 0 ? `+${text}` : `−${text}`;
}

const yearsFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Ages and age differences: always one decimal, e.g. "36.4". */
export function formatYears(years: number): string {
  return yearsFmt.format(years);
}

/**
 * Lowercase a label for use mid-sentence, keeping acronyms and letter names:
 * "Vitamin C" -> "vitamin C", "LDL cholesterol" stays, "Omega-3 EPA" -> "omega-3 EPA".
 */
export function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export const CATEGORY_LABEL: Record<ProtocolEntry["category"], string> = {
  supplement: "Supplement",
  diet: "Diet change",
  medication: "Medicine",
  lifestyle: "Lifestyle",
};

/** A fraction as a signed percentage for reading: 0.383 -> "+38%", -0.05 -> "−5%". */
export function formatPercent(fraction: number): string {
  const p = Math.round(fraction * 100);
  if (p === 0) return "0%";
  return p > 0 ? `+${p}%` : `−${Math.abs(p)}%`;
}

/** Sleep as people say it: 7.4 → "7 h 24 min". */
export function formatHours(hours: number): string {
  // Subtraction of hour values can land a few floating-point bits below a half-minute.
  const total = Math.round(hours * 60 + 1e-9);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "12 days", "3 months", "2 years". Rounded for reading, not for calculation. */
export function formatDuration(days: number): string {
  if (days < 1) return "0 days";
  if (days < 45) return `${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months`;
  const years = Math.round(days / 365.25);
  return `${years} years`;
}

export const FLAG_LABEL: Record<Flag, string> = {
  normal: "In range",
  low: "Low",
  high: "High",
  "critical-low": "Very low",
  "critical-high": "Very high",
  unknown: "No range",
};

/** A watch's change: a percentage, or a plain difference in the marker's unit (the PhenoAge gap: "−1.2 years"). */
export function formatChange(change: number, def: { changeScale?: "ratio" | "difference"; canonicalUnit: string } | undefined): string {
  if (def?.changeScale !== "difference") return formatPercent(change);
  const v = Math.round(change * 10) / 10;
  if (v === 0) return `0 ${def.canonicalUnit}`;
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} ${def.canonicalUnit}`;
}

/** A value in a watch: as the marker shows it, or for a difference marker (the PhenoAge gap) one decimal with a real minus sign. */
export function showWatchValue(def: BiomarkerDef, value: number, unit: string): string {
  if (def.changeScale !== "difference") return showValue(def, value, unit);
  const v = Math.round(value * 10) / 10;
  return v < 0 ? `−${Math.abs(v).toFixed(1)}` : v.toFixed(1);
}
