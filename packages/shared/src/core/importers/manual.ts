import { isIsoDate } from "../dates";
import { resolveRange } from "../trends";
import type { BiomarkerDef, Measurement } from "../types";
import { matchUnit, toCanonical } from "../units";

export interface ParsedNumber {
  value: number;
  qualifier?: "<" | ">";
}

/**
 * Parse a number as people type it or labs print it:
 * "5.4", "5,4" (European decimal comma), "1 234,5", "<0.1", "> 90".
 */
export function parseLabNumber(raw: string): ParsedNumber | undefined {
  let s = raw.trim().replace(/[\s  ]/g, "");
  let qualifier: ParsedNumber["qualifier"];
  const q = /^(<=?|>=?|≤|≥)/.exec(s);
  if (q) {
    qualifier = q[1]!.startsWith("<") || q[1] === "≤" ? "<" : ">";
    s = s.slice(q[1]!.length);
  }
  // "1.234,5" -> thousands dot + decimal comma; "1,234.5" -> the reverse.
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    if ((s.match(/,/g) ?? []).length > 1) return undefined;
    s = s.replace(",", ".");
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return undefined;
  const value = Number(s);
  if (!Number.isFinite(value)) return undefined;
  return qualifier ? { value, qualifier } : { value };
}

export interface ManualEntryInput {
  biomarkerId: string;
  value: string;
  unit: string;
  date: string;
  /** Lab range, typed in the same unit as the value. */
  labLow?: string;
  labHigh?: string;
  lab?: string;
  fasted?: boolean;
  note?: string;
}

export type ManualEntryField = keyof ManualEntryInput;

export type ValidationResult =
  | { ok: true; measurement: Omit<Measurement, "id">; warnings: string[] }
  | { ok: false; errors: Partial<Record<ManualEntryField, string>> };

const EARLIEST_DATE = "1900-01-01";

/**
 * Check a manual entry and convert it to a measurement in the canonical unit.
 * `today` is passed in so the function stays pure and testable.
 * `source` records where the value came from (typed, PDF import, ...).
 */
export function validateManualEntry(
  input: ManualEntryInput,
  defs: ReadonlyMap<string, BiomarkerDef>,
  today: string,
  source: Measurement["source"] = "manual",
): ValidationResult {
  const errors: Partial<Record<ManualEntryField, string>> = {};
  const def = defs.get(input.biomarkerId);
  if (!def) errors.biomarkerId = "Choose which marker this result is for.";

  const parsed = parseLabNumber(input.value);
  if (input.value.trim() === "") errors.value = "Enter the result.";
  else if (!parsed) errors.value = "This doesn't look like a number. Example: 5.4";
  else if (parsed.value < 0) errors.value = "The result can't be negative.";

  const unit = def ? matchUnit(def, input.unit) : undefined;
  if (def && !unit) errors.unit = "Choose a unit from the list.";

  if (!isIsoDate(input.date)) errors.date = "Enter the date the blood sample was taken.";
  else if (input.date > today) errors.date = "The date can't be in the future.";
  else if (input.date < EARLIEST_DATE) errors.date = "Please check the year.";

  const low = optionalNumber(input.labLow);
  const high = optionalNumber(input.labHigh);
  if (low === null) errors.labLow = "Enter a number, or leave it empty.";
  if (high === null) errors.labHigh = "Enter a number, or leave it empty.";
  if (typeof low === "number" && typeof high === "number" && low > high) {
    errors.labHigh = "The upper limit must be higher than the lower limit.";
  }

  if (Object.keys(errors).length > 0 || !def || !parsed || !unit) {
    return { ok: false, errors };
  }

  const value = toCanonical(def, parsed.value, unit);
  const labRange =
    typeof low === "number" || typeof high === "number"
      ? {
          ...(typeof low === "number" ? { low: toCanonical(def, low, unit) } : {}),
          ...(typeof high === "number" ? { high: toCanonical(def, high, unit) } : {}),
        }
      : undefined;

  const measurement: Omit<Measurement, "id"> = {
    biomarkerId: def.id,
    value,
    originalValue: parsed.value,
    originalUnit: unit,
    date: input.date,
    source,
  };
  if (parsed.qualifier) measurement.qualifier = parsed.qualifier;
  if (labRange) measurement.labRange = labRange;
  if (input.lab?.trim()) measurement.lab = input.lab.trim();
  if (input.fasted !== undefined) measurement.fasted = input.fasted;
  if (input.note?.trim()) measurement.note = input.note.trim();

  return { ok: true, measurement, warnings: plausibilityWarnings(def, value, unit) };
}

/** undefined = left empty, null = not a number. */
function optionalNumber(raw: string | undefined): number | undefined | null {
  if (raw === undefined || raw.trim() === "") return undefined;
  const p = parseLabNumber(raw);
  return p ? p.value : null;
}

/**
 * Flag values that are far outside the typical range. The usual cause is a
 * wrong unit (e.g. mg/dL picked for a value reported in mmol/L).
 */
export function plausibilityWarnings(def: BiomarkerDef, canonicalValue: number, unit: string): string[] {
  const range = resolveRange(def, {}, {});
  if (!range) return [];
  const tooHigh = range.high !== undefined && canonicalValue > range.high * 10;
  const tooLow = range.low !== undefined && range.low > 0 && canonicalValue < range.low / 10;
  if (tooHigh || tooLow) {
    return [`This value is very far from the usual range for ${def.name}. Please check that the unit (${unit}) matches your lab report.`];
  }
  return [];
}
