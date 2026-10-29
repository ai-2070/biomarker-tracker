import type { Citation, EvidenceGrade, Sex } from "./types";

/**
 * Functional fitness tests that change with age: push-ups, grip strength, standing up from a chair,
 * standing on one leg, walking speed, sitting down on the floor and getting up. One file per test in
 * /knowledge/fitness; results are stored as body measurements with the same id. Norm tables are
 * copied from their sources (never estimated or read off a graph); this module only finds the row for
 * a person's sex and age and says where a result falls in it. A comparison with other people of the
 * same age, never a target or a diagnosis.
 */

export interface NormBand {
  label: string;
  min?: number;
  max?: number;
}

export type Percentile = "p5" | "p10" | "p20" | "p25" | "p30" | "p40" | "p50" | "p60" | "p70" | "p75" | "p80" | "p90" | "p95";
export const PERCENTILES: readonly Percentile[] = ["p5", "p10", "p20", "p25", "p30", "p40", "p50", "p60", "p70", "p75", "p80", "p90", "p95"];

export interface NormRow extends Partial<Record<Percentile, number>> {
  sex: Sex | "any";
  ageFrom: number;
  /** Inclusive; missing means "and over". */
  ageTo?: number;
  bands?: NormBand[];
  mean?: number;
  sd?: number;
}

export interface NormSet {
  source: Citation & { note?: string };
  /** Where the numbers were read (the paper's full text, or a secondary source for books). */
  verifiedFrom: string;
  /** Who was measured: country, number of people, years. */
  population: string;
  kind: "bands" | "percentiles" | "mean_sd";
  /** "standard", "knee", "eyes open": norms for one way of doing the test. */
  variant?: string;
  /** Band labels, lowest to highest result. */
  labels?: string[];
  rows: NormRow[];
  note?: string;
}

export interface FitnessCutoff {
  label: string;
  sex?: Sex;
  ageFrom?: number;
  ageTo?: number;
  /** The result counts when it is below this (or at or below `atMost`, above `above`). */
  below?: number;
  atMost?: number;
  above?: number;
  source: Citation;
}

export interface FitnessEvidence {
  claim: string;
  grade: EvidenceGrade;
  whyThisGrade: string[];
  studies: Citation[];
}

export interface FitnessTestDef {
  /** The same id as the body measurement it's stored under. */
  id: string;
  name: string;
  unit: string;
  higherIsBetter: boolean;
  summary: string;
  howTo: string[];
  safety: string[];
  norms: NormSet[];
  cutoffs?: FitnessCutoff[];
  evidence: FitnessEvidence[];
  limits: string[];
}

/** Where a result falls among people of the same sex and age in one norm table. */
export type NormPlace =
  | { kind: "band"; label: string; rank: number; of: number }
  /** Between two bands (the table has a gap there). */
  | { kind: "between-bands"; lower: string; upper: string }
  /** `above` / `below` are percentile numbers (25 = 25th); a missing one means past the table's end. */
  | { kind: "percentile"; above?: number; below?: number; median?: number }
  | { kind: "mean_sd"; mean: number; sd: number; z: number };

export interface NormResult {
  set: NormSet;
  row: NormRow;
  place: NormPlace;
}

/** The table row for a sex and age, or undefined when the table doesn't cover them. */
export function normRow(set: NormSet, sex: Sex | undefined, age: number): NormRow | undefined {
  const fits = (r: NormRow) => age >= r.ageFrom && (r.ageTo === undefined || age < r.ageTo + 1);
  return set.rows.find((r) => r.sex === sex && fits(r)) ?? set.rows.find((r) => r.sex === "any" && fits(r));
}

/** Where a value falls in one row. */
export function placeInRow(set: NormSet, row: NormRow, value: number): NormPlace | undefined {
  if (set.kind === "bands" && row.bands?.length) {
    // Bands as the source wrote them; with whole-number tables, 25.5 sits between 25 and 26.
    const bands = row.bands;
    const i = bands.findIndex((b) => (b.min === undefined || value >= b.min) && (b.max === undefined || value <= b.max));
    const labels = set.labels ?? bands.map((b) => b.label);
    const rank = (label: string) => Math.max(0, labels.indexOf(label));
    if (i >= 0) return { kind: "band", label: bands[i]!.label, rank: rank(bands[i]!.label), of: labels.length };
    // In a gap: the band just below and just above.
    const below = bands.filter((b) => b.max !== undefined && b.max < value).sort((a, b) => b.max! - a.max!)[0];
    const above = bands.filter((b) => b.min !== undefined && b.min > value).sort((a, b) => a.min! - b.min!)[0];
    if (below && above) return { kind: "between-bands", lower: below.label, upper: above.label };
    if (below) return { kind: "band", label: below.label, rank: rank(below.label), of: labels.length };
    if (above) return { kind: "band", label: above.label, rank: rank(above.label), of: labels.length };
    return undefined;
  }
  if (set.kind === "percentiles") {
    const ps = PERCENTILES.filter((p) => row[p] !== undefined).map((p) => ({ n: Number(p.slice(1)), v: row[p]! }));
    if (ps.length === 0) return undefined;
    let above: number | undefined;
    let below: number | undefined;
    for (const p of ps) {
      if (value >= p.v) above = p.n;
      else if (below === undefined) below = p.n;
    }
    return { kind: "percentile", ...(above !== undefined ? { above } : {}), ...(below !== undefined ? { below } : {}), ...(row.p50 !== undefined ? { median: row.p50 } : {}) };
  }
  if (set.kind === "mean_sd" && row.mean !== undefined && row.sd !== undefined && row.sd > 0) {
    return { kind: "mean_sd", mean: row.mean, sd: row.sd, z: (value - row.mean) / row.sd };
  }
  return undefined;
}

/** A result against every norm table of a test that covers the person's sex and age (and the variant, if given). */
export function placeResult(test: FitnessTestDef, value: number, person: { sex?: Sex; age?: number }, variant?: string): NormResult[] {
  if (person.age === undefined) return [];
  const out: NormResult[] = [];
  for (const set of test.norms) {
    if (variant !== undefined && set.variant !== undefined && set.variant !== variant) continue;
    const row = normRow(set, person.sex, person.age);
    if (!row) continue;
    const place = placeInRow(set, row, value);
    if (place) out.push({ set, row, place });
  }
  return out;
}

/** The clinical cut-offs a result meets (e.g. low grip strength), for the person's sex and age. */
export function cutoffsMet(test: FitnessTestDef, value: number, person: { sex?: Sex; age?: number }): FitnessCutoff[] {
  return (test.cutoffs ?? []).filter((c) => {
    if (c.sex && c.sex !== person.sex) return false;
    if ((c.ageFrom !== undefined || c.ageTo !== undefined) && person.age === undefined) return false;
    if (c.ageFrom !== undefined && person.age! < c.ageFrom) return false;
    if (c.ageTo !== undefined && person.age! >= c.ageTo + 1) return false;
    return (c.below !== undefined && value < c.below) || (c.atMost !== undefined && value <= c.atMost) || (c.above !== undefined && value > c.above);
  });
}

/** Plain words for a place: "Good", "between the 25th and 50th percentile", "about average". */
export function describePlace(place: NormPlace): string {
  const nth = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
  switch (place.kind) {
    case "band":
      return place.label;
    case "between-bands":
      return `Between ${place.lower.toLowerCase()} and ${place.upper.toLowerCase()}`;
    case "percentile":
      if (place.above === undefined) return `Below the ${nth(place.below!)} percentile`;
      if (place.below === undefined) return `Above the ${nth(place.above)} percentile`;
      return `Between the ${nth(place.above)} and ${nth(place.below)} percentile`;
    case "mean_sd": {
      const z = place.z;
      if (z <= -2) return "Far below average";
      if (z <= -1) return "Below average";
      if (z < 1) return "About average";
      if (z < 2) return "Above average";
      return "Far above average";
    }
  }
}
