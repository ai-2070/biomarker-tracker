import { sortByDate } from "./trends";
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
  /** A row with `ageFrom` equal to `ageTo` gives values at that exact age (from the source's fitted curves). */
  ageFrom: number;
  /** Inclusive; missing means "and over". */
  ageTo?: number;
  bands?: NormBand[];
  mean?: number;
  sd?: number;
}

export interface NormSet {
  /** Short name for tabs and lists: "Britain (Dodds 2014)". */
  label: string;
  source: Citation & { note?: string };
  /** Where the numbers were read (the paper's full text, or a secondary source for books). */
  verifiedFrom: string;
  /** Who was measured: country, number of people, years. */
  population: string;
  kind: "bands" | "percentiles" | "mean_sd";
  /** "standard", "knee", "eyes open", "best of either hand": norms for one way of doing the test. */
  variant?: string;
  /** Band labels, lowest to highest result. */
  labels?: string[];
  /** The test's time limit in this study (one-leg stand): longer results count as this before comparing. */
  ceiling?: number;
  rows: NormRow[];
  note?: string;
}

export interface FitnessCutoff {
  label: string;
  sex?: Sex;
  ageFrom?: number;
  ageTo?: number;
  /** The result counts when it is below this (or at or below `atOrBelow`, above `above`). */
  below?: number;
  atOrBelow?: number;
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
  /** The way of doing the test the how-to describes; results are compared only with norms for it. */
  defaultVariant?: string;
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
  | { kind: "percentile"; above?: number; below?: number; median?: number; capped?: boolean }
  | { kind: "mean_sd"; mean: number; sd: number; z: number };

export interface NormResult {
  set: NormSet;
  row: NormRow;
  place: NormPlace;
}

/**
 * The ages a row stands for, as [from, to). An age range covers its whole last year. A row at one exact
 * age stands for the ages nearer to it than to the next tabulated age (half the gap each way, the end
 * rows as wide as their neighbour's half gap).
 */
export function rowSpan(rows: readonly NormRow[], r: NormRow): [number, number] {
  if (r.ageTo === undefined) return [r.ageFrom, r.ageFrom + 10];
  if (r.ageTo !== r.ageFrom) return [r.ageFrom, r.ageTo + 1];
  const points = [...new Set(rows.filter((x) => x.sex === r.sex && x.ageTo === x.ageFrom).map((x) => x.ageFrom))].sort((a, b) => a - b);
  const i = points.indexOf(r.ageFrom);
  const before = i > 0 ? (r.ageFrom - points[i - 1]!) / 2 : undefined;
  const after = i < points.length - 1 ? (points[i + 1]! - r.ageFrom) / 2 : undefined;
  const half = (before ?? after ?? 0.5);
  return [r.ageFrom - (before ?? after ?? half), r.ageFrom + (after ?? before ?? half)];
}

/**
 * The age whose typical result (median, or average) matches yours, in one norm table: "typical of
 * women about 38". Only the side of the curve after its best age is used (results there get worse
 * with age), the table's ages are joined with straight lines (like fitness age), and nothing past the
 * table is guessed: better than the best age's typical result says so; worse than the last closed age
 * group says "that age or older". A comparison with other people, not a body age.
 */
export type AgeMatch =
  | { kind: "age"; age: number }
  /** At or better than the typical result of the best age group (around `age`). */
  | { kind: "best"; age: number }
  /** At or better than the youngest group in the table, which is also its best: nothing younger was measured. */
  | { kind: "youngest"; ageFrom: number; ageTo?: number }
  /** Worse than the typical result of the oldest group: like people `age` and older, or worse. */
  | { kind: "oldest"; age: number };

export function ageMatch(set: NormSet, sex: Sex, value: number, higherIsBetter: boolean): AgeMatch | undefined {
  if (set.kind === "bands") return undefined;
  const result = set.ceiling !== undefined ? Math.min(value, set.ceiling) : value;
  const rows = set.rows
    .filter((r) => r.sex === sex || r.sex === "any")
    .map((r) => ({ r, typical: r.p50 ?? r.mean }))
    .filter((x): x is { r: NormRow; typical: number } => x.typical !== undefined)
    .sort((a, b) => a.r.ageFrom - b.r.ageFrom);
  if (rows.length < 2) return undefined;
  const mid = (r: NormRow) => (r.ageTo === undefined ? r.ageFrom : r.ageTo === r.ageFrom ? r.ageFrom : (r.ageFrom + r.ageTo + 1) / 2);
  const better = (a: number, b: number) => (higherIsBetter ? a >= b : a <= b);
  // The best age group: where the typical result peaks (the first one, if several tie).
  let best = 0;
  rows.forEach((x, i) => {
    if (higherIsBetter ? x.typical > rows[best]!.typical : x.typical < rows[best]!.typical) best = i;
  });
  if (better(result, rows[best]!.typical)) {
    const r = rows[best]!.r;
    return best === 0 ? { kind: "youngest", ageFrom: r.ageFrom, ...(r.ageTo !== undefined && r.ageTo !== r.ageFrom ? { ageTo: r.ageTo } : {}) } : { kind: "best", age: Math.round(mid(r)) };
  }
  for (let i = best; i < rows.length - 1; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    if (!better(result, b.typical)) continue;
    // Between a (better) and b: a straight line between their ages, unless b is an open "and over" group.
    if (b.r.ageTo === undefined) return result === b.typical ? { kind: "oldest", age: b.r.ageFrom } : undefined;
    const span = a.typical - b.typical;
    const f = span === 0 ? 0 : (a.typical - result) / span;
    return { kind: "age", age: Math.round(mid(a.r) + f * (mid(b.r) - mid(a.r))) };
  }
  const last = rows.at(-1)!.r;
  return { kind: "oldest", age: last.ageTo === undefined || last.ageTo === last.ageFrom ? last.ageFrom : last.ageTo };
}

/** Your place among the youngest people in each norm table (Bryan Johnson's "compared with 20-year-olds"), by the same rules as for your own age. */
export function placeAmongYoungest(test: FitnessTestDef, value: number, sex: Sex, variant = test.defaultVariant): NormResult[] {
  const out: NormResult[] = [];
  for (const set of test.norms) {
    if (variant !== undefined && set.variant !== undefined && set.variant !== variant) continue;
    const row = set.rows.filter((r) => r.sex === sex || r.sex === "any").sort((a, b) => a.ageFrom - b.ageFrom)[0];
    if (!row) continue;
    const place = placeInRow(set, row, value);
    if (place) out.push({ set, row, place });
  }
  return out;
}

/** The table row for a sex and age, or undefined when the table doesn't cover them. */
export function normRow(set: NormSet, sex: Sex | undefined, age: number): NormRow | undefined {
  const fits = (r: NormRow) => {
    const [from, to] = rowSpan(set.rows, r);
    return r.ageTo === undefined ? age >= r.ageFrom : age >= from && age < to;
  };
  return set.rows.find((r) => r.sex === sex && fits(r)) ?? set.rows.find((r) => r.sex === "any" && fits(r));
}

/** Where a value falls in one row. */
export function placeInRow(set: NormSet, row: NormRow, result: number): NormPlace | undefined {
  const value = set.ceiling !== undefined ? Math.min(result, set.ceiling) : result;
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
    // At a capped test's limit, ties can span much of the population: no strict ranking is known.
    if (set.ceiling !== undefined && value === set.ceiling && ps.some((p) => p.v === set.ceiling)) {
      return { kind: "percentile", capped: true, ...(row.p50 !== undefined ? { median: row.p50 } : {}) };
    }
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
export function placeResult(test: FitnessTestDef, value: number, person: { sex?: Sex; age?: number }, variant = test.defaultVariant): NormResult[] {
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
    return (c.below !== undefined && value < c.below) || (c.atOrBelow !== undefined && value <= c.atOrBelow) || (c.above !== undefined && value > c.above);
  });
}

/** Who a norm row describes: "women 40–49", "men at age 50", "men and women 70 and over". */
export function rowWho(row: NormRow): string {
  const sex = row.sex === "m" ? "men" : row.sex === "f" ? "women" : "men and women";
  const ages = row.ageTo === undefined ? `${row.ageFrom} and over` : row.ageFrom === row.ageTo ? `at age ${row.ageFrom}` : `${row.ageFrom}–${row.ageTo}`;
  return `${sex} ${ages}`;
}

/**
 * Every fitness test's latest result compared with the norms, for Brain: the same comparisons the
 * page shows, so the model reports them instead of working anything out.
 */
export function fitnessSummary(tests: readonly FitnessTestDef[], measurements: readonly { biomarkerId: string; date: string; value: number }[], person: { sex?: Sex; ageAt?: (date: string) => number }) {
  return tests.flatMap((t) => {
    const last = sortByDate(measurements.filter((m) => m.biomarkerId === t.id)).at(-1);
    if (!last) return [];
    const who = { ...(person.sex ? { sex: person.sex } : {}), ...(person.ageAt ? { age: person.ageAt(last.date) } : {}) };
    const places = placeResult(t, last.value, who);
    const met = cutoffsMet(t, last.value, who);
    return [
      {
        test: t.name,
        latest: last.value,
        unit: t.unit,
        date: last.date,
        lowerIsBetter: !t.higherIsBetter,
        comparedWith: places.map((r) => ({ norms: r.set.label, group: rowWho(r.row), place: describePlace(r.place, t.higherIsBetter) })),
        ...(person.sex
          ? {
              comparedWithYoungest: placeAmongYoungest(t, last.value, person.sex).map((r) => ({ norms: r.set.label, group: rowWho(r.row), place: describePlace(r.place, t.higherIsBetter) })),
              typicalOfAge: t.norms.flatMap((set) => {
                const m = ageMatch(set, person.sex!, last.value, t.higherIsBetter);
                return m ? [{ norms: set.label, ...m }] : [];
              }),
            }
          : {}),
        ...(places.length === 0 ? { note: who.sex && who.age !== undefined ? "No norms cover this age and sex." : "Sex and birth month are needed to compare." } : {}),
        ...(met.length ? { thresholdsMet: met.map((c) => c.label) } : {}),
      },
    ];
  });
}

/**
 * Plain words for a place: "Good", "between the 25th and 50th percentile", "about average". Percentiles
 * are said so that higher is always better: for a timed test (lower is better) the time's 25th to 50th
 * percentile is the 50th to 75th for speed.
 */
export function describePlace(place: NormPlace, higherIsBetter = true): string {
  const nth = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
  switch (place.kind) {
    case "band":
      return place.label;
    case "between-bands":
      return `Between ${place.lower.toLowerCase()} and ${place.upper.toLowerCase()}`;
    case "percentile": {
      if (place.capped) return "Reached the test limit; the table cannot rank results at the limit";
      if (place.above === undefined && place.below === undefined) return "At the table's reported percentile value; ties prevent a finer ranking";
      const lo = higherIsBetter ? place.above : place.below !== undefined ? 100 - place.below : undefined;
      const hi = higherIsBetter ? place.below : place.above !== undefined ? 100 - place.above : undefined;
      if (lo === undefined) return `Below the ${nth(hi!)} percentile`;
      if (hi === undefined) return `Above the ${nth(lo)} percentile`;
      return `Between the ${nth(lo)} and ${nth(hi)} percentile`;
    }
    case "mean_sd": {
      const z = higherIsBetter ? place.z : -place.z;
      if (z <= -2) return "Far below average";
      if (z <= -1) return "Below average";
      if (z < 1) return "About average";
      if (z < 2) return "Above average";
      return "Far above average";
    }
  }
}

// ---- Validation of /knowledge/fitness files ------------------------------------------------------

const GRADES = ["high", "moderate", "low", "very low"];
const STUDY_TYPES = ["meta-analysis", "rct", "observational", "animal", "in vitro", "review", "guideline"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrList = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim() !== "");
function citationErrors(c: unknown, where: string): string[] {
  if (!isObj(c)) return [`${where}: citation missing`];
  const e: string[] = [];
  if (typeof c.title !== "string" || !c.title) e.push(`${where}: citation needs a title`);
  if (typeof c.year !== "number") e.push(`${where}: citation needs a year`);
  if (!STUDY_TYPES.includes(c.studyType as string)) e.push(`${where}: unknown study type`);
  return e;
}

/** Problems with a fitness test file; empty means valid. */
export function validateFitnessTest(v: unknown): string[] {
  if (!isObj(v)) return ["not an object"];
  const e: string[] = [];
  for (const k of ["id", "name", "unit", "summary"]) if (typeof v[k] !== "string" || !v[k]) e.push(`${k} is missing`);
  if (typeof v.higherIsBetter !== "boolean") e.push("higherIsBetter must be true or false");
  for (const k of ["howTo", "safety", "limits"]) if (!isStrList(v[k])) e.push(`${k} needs at least one line`);
  if (!Array.isArray(v.norms) || v.norms.length === 0) e.push("needs at least one norm table");
  else
    v.norms.forEach((n, i) => {
      const w = `norm ${i + 1}`;
      if (!isObj(n)) return void e.push(`${w}: not an object`);
      if (typeof n.label !== "string" || !n.label) e.push(`${w}: needs a label`);
      if (typeof n.verifiedFrom !== "string" || !n.verifiedFrom) e.push(`${w}: say where the numbers were read`);
      if (typeof n.population !== "string" || !n.population) e.push(`${w}: say who was measured`);
      e.push(...citationErrors(n.source, w));
      if (!["bands", "percentiles", "mean_sd"].includes(n.kind as string)) e.push(`${w}: unknown kind`);
      if (!Array.isArray(n.rows) || n.rows.length === 0) return void e.push(`${w}: no rows`);
      for (const r of n.rows as unknown[]) {
        if (!isObj(r)) { e.push(`${w}: a row is not an object`); continue; }
        if (!["m", "f", "any"].includes(r.sex as string)) e.push(`${w}: a row has no sex`);
        if (typeof r.ageFrom !== "number" || (r.ageTo !== undefined && (typeof r.ageTo !== "number" || r.ageTo < r.ageFrom))) e.push(`${w}: a row's ages are wrong`);
        if (n.kind === "percentiles") {
          const ps = PERCENTILES.filter((p) => r[p] !== undefined).map((p) => r[p] as number);
          if (ps.length < 2) e.push(`${w}: a row needs at least two percentiles`);
          if (ps.some((x, j) => j > 0 && x < ps[j - 1]!)) e.push(`${w}: percentiles must not go down (row ${r.sex} ${r.ageFrom})`);
        }
        if (n.kind === "mean_sd" && (typeof r.mean !== "number" || typeof r.sd !== "number" || r.sd <= 0)) e.push(`${w}: a row needs a mean and SD`);
        if (n.kind === "bands") {
          const bands = Array.isArray(r.bands) ? (r.bands as Record<string, unknown>[]) : [];
          if (bands.length < 2) e.push(`${w}: a row needs bands`);
          const labels = Array.isArray(n.labels) ? (n.labels as string[]) : [];
          for (const b of bands) {
            if (labels.length && !labels.includes(b.label as string)) e.push(`${w}: band "${String(b.label)}" isn't in the labels`);
            if (typeof b.min === "number" && typeof b.max === "number" && b.min > b.max) e.push(`${w}: band "${String(b.label)}" runs backwards`);
          }
        }
      }
    });
  if (v.cutoffs !== undefined) {
    if (!Array.isArray(v.cutoffs)) e.push("cutoffs must be a list");
    else
      v.cutoffs.forEach((c, i) => {
        if (!isObj(c) || typeof c.label !== "string") return void e.push(`cut-off ${i + 1}: needs a label`);
        if ([c.below, c.atOrBelow, c.above].filter((x) => typeof x === "number").length !== 1) e.push(`cut-off ${i + 1}: needs exactly one of below, atOrBelow, above`);
        e.push(...citationErrors(c.source, `cut-off ${i + 1}`));
      });
  }
  if (!Array.isArray(v.evidence) || v.evidence.length === 0) e.push("needs at least one evidence entry");
  else
    v.evidence.forEach((x, i) => {
      if (!isObj(x)) return void e.push(`evidence ${i + 1}: not an object`);
      if (typeof x.claim !== "string" || !x.claim) e.push(`evidence ${i + 1}: needs a claim`);
      if (!GRADES.includes(x.grade as string)) e.push(`evidence ${i + 1}: unknown grade`);
      if (!isStrList(x.whyThisGrade)) e.push(`evidence ${i + 1}: explain the grade`);
      if (!Array.isArray(x.studies) || x.studies.length === 0) e.push(`evidence ${i + 1}: needs a study`);
      else x.studies.forEach((s, j) => e.push(...citationErrors(s, `evidence ${i + 1} study ${j + 1}`)));
    });
  return e;
}
