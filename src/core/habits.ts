import { analyzeMarker, experimentPhase, retestDate, type ExperimentPhase, type MarkerResult } from "./experiments";
import { sortProtocols } from "./protocols";
import type { BiomarkerDef, Experiment, Measurement, ProtocolEntry } from "./types";

/**
 * Habits: log entries (supplements, food, medicines, routines), each of which can watch markers.
 * Watching is a self-experiment linked to the entry (`Experiment.protocolId`), so its before/after
 * comparison against normal variation is the same tested code (experiments.ts).
 */

/**
 * Markers a habit is known to affect, found from words in its name. Mirrors the evidence levers in
 * /knowledge/evidence plus common medicines with a well-known lab effect. Only a suggestion: the
 * person picks what to watch.
 */
export const HABIT_HINTS: readonly { words: RegExp; markers: readonly string[] }[] = [
  { words: /vitamin\s*d|\bd3\b|cholecalciferol/i, markers: ["vitamin_d"] },
  { words: /\biron\b|ferrous|ferric|bisglycinate/i, markers: ["ferritin", "hemoglobin", "iron", "transferrin_saturation"] },
  { words: /omega.?3|fish oil|\bepa\b|\bdha\b|krill/i, markers: ["triglycerides"] },
  { words: /oily fish|salmon|sardine|mackerel|herring/i, markers: ["triglycerides", "hdl"] },
  { words: /\bb12\b|cobalamin/i, markers: ["b12"] },
  { words: /folate|folic/i, markers: ["folate"] },
  { words: /\boats?\b|oatmeal|porridge|barley|beta.?glucan|psyllium|fib(re|er)/i, markers: ["ldl", "total_cholesterol"] },
  { words: /saturated|olive oil|plant.?based|vegan|vegetarian/i, markers: ["ldl", "total_cholesterol"] },
  { words: /alcohol|\bbeer\b|\bwine\b|sober/i, markers: ["triglycerides", "ggt"] },
  { words: /statin|ezetimibe/i, markers: ["ldl", "total_cholesterol"] },
  { words: /metformin|\bsugar\b|low.?carb|keto/i, markers: ["hba1c", "glucose", "triglycerides"] },
  { words: /\btea\b|\bcoffee\b/i, markers: ["ferritin"] },
];

/** Suggested markers for a habit, the ones with results first. */
export function suggestMarkers(label: string, hasResults: (id: string) => boolean = () => true): string[] {
  const ids = [...new Set(HABIT_HINTS.filter((h) => h.words.test(label)).flatMap((h) => h.markers))];
  return [...ids.filter(hasResults), ...ids.filter((id) => !hasResults(id))];
}

/**
 * Markers picked when the "after" results already existed. Then the comparison is a hint, not a
 * test: it's easy to pick the markers that happened to move.
 */
export function pickedAfterResults(e: Pick<Experiment, "start" | "retestAfterDays" | "chosenOn">): boolean {
  return !!e.chosenOn && e.chosenOn >= retestDate(e);
}

/** The watch (experiment) for an existing log entry. Dates and name follow the entry. */
export function watchFor(p: ProtocolEntry, markerIds: readonly string[], retestAfterDays: number, today: string): Omit<Experiment, "id"> {
  return {
    change: p.label,
    category: p.category,
    markerIds: [...new Set(markerIds)],
    start: p.start,
    retestAfterDays,
    ...(p.end ? { end: p.end } : {}),
    protocolId: p.id,
    chosenOn: today,
  };
}

/** A log entry edited by the person: the watch keeps the same name and dates. */
export function syncWatch(e: Experiment, p: ProtocolEntry): Experiment {
  const { end: _end, ...rest } = e;
  return { ...rest, change: p.label, category: p.category, start: p.start, ...(p.end ? { end: p.end } : {}) };
}

export interface Habit {
  /** The log entry's id, or the experiment's when its entry was deleted. */
  id: string;
  label: string;
  category: ProtocolEntry["category"];
  start: string;
  end?: string;
  entry?: ProtocolEntry;
  watch?: Experiment;
}

/** Log entries with their watches. Experiments whose entry is gone still show, as habits of their own. */
export function habitsOf(protocols: readonly ProtocolEntry[], experiments: readonly Experiment[]): Habit[] {
  const byEntry = new Map<string, Experiment>();
  for (const e of experiments) if (e.protocolId) byEntry.set(e.protocolId, e);
  const entries = new Set(protocols.map((p) => p.id));
  const habits: Habit[] = protocols.map((p) => {
    const watch = byEntry.get(p.id);
    return { id: p.id, label: p.label, category: p.category, start: p.start, ...(p.end ? { end: p.end } : {}), entry: p, ...(watch ? { watch } : {}) };
  });
  for (const e of experiments) {
    if (e.protocolId && entries.has(e.protocolId)) continue;
    habits.push({ id: e.id, label: e.change, category: e.category, start: e.start, ...(e.end ? { end: e.end } : {}), watch: e });
  }
  return sortProtocols(habits);
}

/**
 * Each marker's band is set so a change outside it happens by chance 1 time in 20. Watching many
 * markers at once, some will cross it by chance alone; this says so (from 5 markers on).
 */
export function chanceNote(markerCount: number): string | undefined {
  if (markerCount < 5) return undefined;
  const expected = Math.round(markerCount / 20);
  const some = expected <= 1 ? "one of them" : `about ${expected} of them`;
  return `With ${markerCount} markers, ${some} may show a change beyond normal variation by chance alone. A change you expected in a marker you picked for a reason says more.`;
}

/** Re-test interval to suggest: 8 weeks, or 12 when HbA1c is watched (it reflects about 3 months). */
export function defaultRetestDays(markerIds: readonly string[]): number {
  return markerIds.includes("hba1c") ? 84 : 56;
}

/** Before/after for each watched marker (skipping markers the app no longer knows). */
export function watchResults(e: Experiment, defs: ReadonlyMap<string, BiomarkerDef>, ms: readonly Measurement[]): MarkerResult[] {
  return e.markerIds.flatMap((id) => {
    const def = defs.get(id);
    return def ? [analyzeMarker(e, def, ms)] : [];
  });
}

export interface WatchSummary {
  phase: ExperimentPhase;
  results: MarkerResult[];
  /** The result to mention first: a change beyond normal variation, else one within it. */
  headline?: MarkerResult;
}

export function summarizeWatch(e: Experiment, defs: ReadonlyMap<string, BiomarkerDef>, ms: readonly Measurement[], today: string): WatchSummary {
  const results = watchResults(e, defs, ms);
  const headline = results.find((r) => r.verdict === "rise" || r.verdict === "fall") ?? results.find((r) => r.verdict === "within-noise");
  return { phase: experimentPhase(results, e, today), results, ...(headline ? { headline } : {}) };
}
