// "Try one change": a guided start for a habit that watches one marker. Pure planning helpers: what the person
// could pick, how many results the comparison needs before and after, and when to re-test. The comparison
// itself is the experiments code (analyzeMarker); nothing here judges a result.
import { addDays, dayNumber } from "./dates";
import { BASELINE_WINDOW_DAYS, MIN_PERSONAL } from "./experiments";
import { defaultRetestDays } from "./habits";
import type { BiomarkerDef, Measurement } from "./types";

export interface TrialReadiness {
  /** Results in the "before" window (the 120 days up to the start). */
  before: number;
  /** How many the comparison needs on each side: 1 with published variation, otherwise MIN_PERSONAL. */
  need: number;
  /** Enough "before" results to start now. */
  ready: boolean;
  /** Results of this marker in the last 30 days, a sign of daily (device) data. */
  recent: number;
}

/** Whether there are enough "before" results for a change starting on `start`, and what's needed. */
export function trialReadiness(def: BiomarkerDef, ms: readonly Measurement[], start: string, today: string): TrialReadiness {
  const mine = ms.filter((m) => m.biomarkerId === def.id && !m.qualifier);
  const s = dayNumber(start);
  const before = mine.filter((m) => dayNumber(m.date) <= s && dayNumber(m.date) >= s - BASELINE_WINDOW_DAYS && m.date <= today).length;
  const need = def.biologicalVariation ? 1 : MIN_PERSONAL;
  const t = dayNumber(today);
  const recent = mine.filter((m) => dayNumber(m.date) > t - 30 && dayNumber(m.date) <= t).length;
  return { before, need, ready: before >= need, recent };
}

/**
 * Days until the "after" test: 4 weeks for a marker measured most days (a device gives the results), else the
 * habit default (8 weeks, 12 for HbA1c, which reflects about 3 months).
 */
export function trialRetestDays(def: BiomarkerDef, readiness: Pick<TrialReadiness, "recent">): number {
  return readiness.recent >= 20 ? 28 : defaultRetestDays([def.id]);
}

/** When the "after" results count from, for a change starting on `start`. */
export function trialAfterFrom(start: string, retestDays: number): string {
  return addDays(start, retestDays);
}
