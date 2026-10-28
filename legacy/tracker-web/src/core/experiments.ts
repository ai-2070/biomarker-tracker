import { dayNumber, isIsoDate } from "./dates";
import { sortByDate } from "./trends";
import type { BiomarkerDef, Experiment, Measurement, ProtocolEntry } from "./types";

/**
 * Self-experiments: compare results before and after a change against the
 * marker's normal test-to-test variation (reference change value, RCV).
 *
 * RCV = Z · √(1/n1 + 1/n2) · σ, with σ from CVA and CVI (Fraser 2011, PMID
 * 21958344). Because many markers vary a lot, the band is computed on the
 * log scale, so a rise and a fall get different limits (log-normal RCV,
 * Fokkema et al. 2006, PMID 16873298). With one result before and one after,
 * √(1/n1 + 1/n2) is the familiar √2.
 */

/** Two-sided 95%: a change outside the band would happen by chance less than 1 in 20 times. */
export const Z_95 = 1.96;

/**
 * Labs rarely publish their own measurement error (CVA). We assume the
 * common "desirable" quality target of half the biological variation.
 */
export const DEFAULT_CVA_RATIO = 0.5;

/** How far back a result still counts as the "before" value. */
export const BASELINE_WINDOW_DAYS = 120;

export interface ChangeBand {
  /** Smallest rise that is beyond normal variation, as a fraction (0.39 = +39%). */
  up: number;
  /** Smallest fall beyond normal variation, as a negative fraction (−0.28 = −28%). */
  down: number;
}

export function rcvBand(cviPercent: number, nBefore = 1, nAfter = 1, cvaPercent = cviPercent * DEFAULT_CVA_RATIO, z = Z_95): ChangeBand {
  const cv = Math.sqrt((cviPercent / 100) ** 2 + (cvaPercent / 100) ** 2);
  const sigma = Math.sqrt(Math.log(1 + cv * cv));
  const k = z * Math.sqrt(1 / nBefore + 1 / nAfter) * sigma;
  return { up: Math.expm1(k), down: Math.expm1(-k) };
}

/** Geometric mean: the right average for values compared on the log scale. */
export function geometricMean(values: readonly number[]): number {
  if (values.length === 1) return values[0]!;
  return Math.exp(values.reduce((s, v) => s + Math.log(v), 0) / values.length);
}

export function retestDate(e: Pick<Experiment, "start" | "retestAfterDays">): string {
  const d = new Date((dayNumber(e.start) + e.retestAfterDays) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export type MarkerVerdict = "rise" | "fall" | "within-noise" | "no-baseline" | "waiting" | "no-variation-data" | "below-limit";

export interface MarkerResult {
  biomarkerId: string;
  before: Measurement[];
  after: Measurement[];
  beforeValue?: number;
  afterValue?: number;
  /** after/before − 1. */
  change?: number;
  band?: ChangeBand;
  verdict: MarkerVerdict;
}

/** Results that count as "before": in the window before the start, up to and including the start day. */
export function beforeResults(e: Experiment, ms: readonly Measurement[]): Measurement[] {
  const s = dayNumber(e.start);
  return sortByDate(ms).filter((m) => {
    const d = dayNumber(m.date);
    return d <= s && d >= s - BASELINE_WINDOW_DAYS;
  });
}

/** Results that count as "after": from the re-test date on (and not long after an ended experiment). */
export function afterResults(e: Experiment, ms: readonly Measurement[]): Measurement[] {
  const from = dayNumber(retestDate(e));
  const until = e.end ? dayNumber(e.end) + 30 : Infinity;
  return sortByDate(ms).filter((m) => {
    const d = dayNumber(m.date);
    return d >= from && d <= until;
  });
}

export function analyzeMarker(e: Experiment, def: BiomarkerDef, ms: readonly Measurement[]): MarkerResult {
  const mine = ms.filter((m) => m.biomarkerId === def.id);
  const before = beforeResults(e, mine);
  const after = afterResults(e, mine);
  const r: MarkerResult = { biomarkerId: def.id, before, after, verdict: "waiting" };
  if (before.length === 0) return { ...r, verdict: "no-baseline" };
  r.beforeValue = geometricMean(before.map((m) => m.value));
  if (after.length === 0) return r;
  r.afterValue = geometricMean(after.map((m) => m.value));
  r.change = r.afterValue / r.beforeValue - 1;
  // "<0.3"-style results can't give a real change.
  if ([...before, ...after].some((m) => m.qualifier)) return { ...r, verdict: "below-limit" };
  const bv = def.biologicalVariation;
  if (!bv) return { ...r, verdict: "no-variation-data" };
  r.band = rcvBand(bv.cvi, before.length, after.length);
  r.verdict = r.change > r.band.up ? "rise" : r.change < r.band.down ? "fall" : "within-noise";
  return r;
}

export type ExperimentPhase = "needs-baseline" | "running" | "due" | "complete" | "ended";

/**
 * Overall state. A marker without a "before" result can't be compared, so
 * once the change has started it no longer holds the experiment open.
 */
export function experimentPhase(results: readonly MarkerResult[], e: Experiment, today: string): ExperimentPhase {
  const started = today >= e.start;
  const waiting = results.filter((r) => r.verdict === "waiting");
  const judged = results.filter((r) => r.verdict !== "waiting" && r.verdict !== "no-baseline");
  if (!started && results.some((r) => r.verdict === "no-baseline")) return "needs-baseline";
  if (waiting.length === 0) return judged.length > 0 ? "complete" : e.end ? "ended" : "needs-baseline";
  if (e.end) return "ended";
  return today >= retestDate(e) ? "due" : "running";
}

/** Markers that still need their "after" test. */
export function markersAwaitingRetest(results: readonly MarkerResult[]): string[] {
  return results.filter((r) => r.verdict === "waiting").map((r) => r.biomarkerId);
}

// Input validation

export interface ExperimentInput {
  change: string;
  category: string;
  markerIds: string[];
  start: string;
  retestAfterDays: number;
}

export type ExperimentField = keyof ExperimentInput;

export function validateExperiment(
  i: ExperimentInput,
  knownMarkers: ReadonlySet<string>,
  today: string,
): { ok: true; experiment: Omit<Experiment, "id" | "protocolId"> } | { ok: false; errors: Partial<Record<ExperimentField, string>> } {
  const errors: Partial<Record<ExperimentField, string>> = {};
  const change = i.change.trim();
  if (!change) errors.change = 'Describe the change, e.g. "2 kiwis a day".';
  else if (change.length > 80) errors.change = "Please keep it under 80 characters.";
  if (!["supplement", "diet", "medication", "lifestyle"].includes(i.category)) errors.category = "Choose a type.";
  const markers = [...new Set(i.markerIds)];
  if (markers.length === 0) errors.markerIds = "Choose at least one marker to watch.";
  else if (markers.some((m) => !knownMarkers.has(m))) errors.markerIds = "Unknown marker.";
  if (!isIsoDate(i.start)) errors.start = "Enter the date you start (or started) the change.";
  else if (dayNumber(i.start) > dayNumber(today) + 365) errors.start = "Please choose a start date within the next year.";
  if (!Number.isInteger(i.retestAfterDays) || i.retestAfterDays < 7 || i.retestAfterDays > 730) errors.retestAfterDays = "Choose when to re-test.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    experiment: { change, category: i.category as ProtocolEntry["category"], markerIds: markers, start: i.start, retestAfterDays: i.retestAfterDays },
  };
}
