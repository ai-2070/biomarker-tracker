import type { BiomarkerDef, Conversion } from "./types.ts";

export class UnitError extends Error {
  readonly biomarkerId: string;
  readonly unit: string;
  constructor(biomarkerId: string, unit: string) {
    super(`Unknown unit "${unit}" for ${biomarkerId}`);
    this.name = "UnitError";
    this.biomarkerId = biomarkerId;
    this.unit = unit;
  }
}

/**
 * Normalise how a unit is written so "mmol/l", "mmol/L" and " mmol / L "
 * match. Also unifies the two different micro signs (µ U+00B5, μ U+03BC)
 * and the common "u"/"mc" spellings of micro.
 */
export function normalizeUnit(unit: string): string {
  return unit
    .trim()
    .replace(/\s+/g, "")
    .replace(/μ/g, "µ")
    .replace(/(^|\/)mc(?=g\b)/gi, "$1µ")
    .replace(/(^|\/)u(?=(g|mol|l|iu)\b)/gi, "$1µ")
    // Powers of ten as labs print them: "10*9", "10**9", "10E9", "10⁹" -> "10^9"
    .replace(/10(?:\*\*?|e|\^)?([0-9])(?=\/)/gi, "10^$1")
    .replace(/10([⁰¹²³⁴⁵⁶⁷⁸⁹])/g, (_, s: string) => `10^${"⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(s)}`)
    // Leading multiplication sign: "x10^9/L", "×10^9/L"
    .replace(/^[x×]/i, "")
    .replace(/\*/g, "")
    // "1,73 m²" -> "1.73m2"
    .replace(/,/g, ".")
    .replace(/²/g, "2")
    .toLowerCase();
}

function factorAndOffset(c: Conversion): { factor: number; offset: number } {
  return typeof c === "number" ? { factor: c, offset: 0 } : c;
}

function findConversion(def: BiomarkerDef, unit: string): Conversion {
  const wanted = normalizeUnit(unit);
  for (const [u, c] of Object.entries(def.conversions)) {
    if (normalizeUnit(u) === wanted) return c;
  }
  throw new UnitError(def.id, unit);
}

/** The unit as spelled in the knowledge file, or undefined if not supported. */
export function matchUnit(def: BiomarkerDef, unit: string): string | undefined {
  const wanted = normalizeUnit(unit);
  return Object.keys(def.conversions).find((u) => normalizeUnit(u) === wanted);
}

export function isSupportedUnit(def: BiomarkerDef, unit: string): boolean {
  return matchUnit(def, unit) !== undefined;
}

export function toCanonical(def: BiomarkerDef, value: number, unit: string): number {
  const { factor, offset } = factorAndOffset(findConversion(def, unit));
  return value * factor + offset;
}

export function fromCanonical(def: BiomarkerDef, value: number, unit: string): number {
  const { factor, offset } = factorAndOffset(findConversion(def, unit));
  return (value - offset) / factor;
}

/**
 * Convert a difference between two values (not a value) from the canonical
 * unit. Offsets cancel out, so only the factor applies.
 */
export function deltaFromCanonical(def: BiomarkerDef, delta: number, unit: string): number {
  return delta / factorAndOffset(findConversion(def, unit)).factor;
}

/** Supported units with the canonical one first. */
export function listUnits(def: BiomarkerDef): string[] {
  const rest = Object.keys(def.conversions).filter((u) => u !== def.canonicalUnit);
  return [def.canonicalUnit, ...rest];
}

/**
 * Round for display: about 3 significant figures, but never more than
 * 2 decimals and never scientific notation.
 */
export function roundForDisplay(value: number): number {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

export function formatValue(value: number, locale?: string): string {
  return roundForDisplay(value).toLocaleString(locale, { maximumFractionDigits: 2 });
}
