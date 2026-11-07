/**
 * Everything the Dashboard shows, worked out from a profile's data. Pure: the page only draws it.
 * Only real numbers: no composite "health score" is invented here.
 */
import { daysBetween } from "./dates";
import { retestDate } from "./experiments";
import { summarizePhenoAge } from "./phenoageDraws";
import { isActiveOn } from "./protocols";
import {
  computeTrend,
  type Flag,
  flagLatest,
  flagMeasurement,
  groupByBiomarker,
  isCritical,
  isOutOfRange,
  type ResolvedRange,
  resolveRange,
  sortByDate,
} from "./trends";
import type { BiomarkerDef, Experiment, Measurement, Profile, ProtocolEntry } from "./types";

export interface DashboardMarker {
  def: BiomarkerDef;
  /** All results, oldest first. */
  series: Measurement[];
  latest: Measurement;
  flag: Flag;
  range?: ResolvedRange;
  /** Latest minus the result before it, canonical unit. */
  change?: number;
  percentChange?: number;
}

/** One blood test: the results taken on one date. */
export interface DrawSummary {
  date: string;
  results: number;
  /** Marker ids outside their range on that date. */
  outOfRange: string[];
  critical: string[];
}

export interface BioAgePoint {
  date: string;
  age: number;
  phenoAge: number;
  /** PhenoAge minus age. */
  difference: number;
  approximate: boolean;
}

export interface Retest {
  experimentId: string;
  change: string;
  date: string;
  /** Negative when overdue. */
  daysAway: number;
}

export interface Dashboard {
  /** Critical first, then out of range, then the biggest recent changes. */
  markers: DashboardMarker[];
  inRange: number;
  /** Markers whose latest result has a range to compare with. */
  judged: number;
  toWatch: DashboardMarker[];
  critical: DashboardMarker[];
  draws: DrawSummary[];
  lastTest?: string;
  daysSinceLastTest?: number;
  bioAge: BioAgePoint[];
  /** Log entries going on today. */
  activeLog: ProtocolEntry[];
  /** The soonest re-test of an experiment that is still running (may be overdue). */
  nextRetest?: Retest;
  /** First and last date the timeline should show (tests and log entries). */
  span?: { from: string; to: string };
}

const rank = (m: DashboardMarker) => (isCritical(m.flag) ? 0 : isOutOfRange(m.flag) ? 1 : 2);

export function buildDashboard(input: {
  measurements: readonly Measurement[];
  protocols: readonly ProtocolEntry[];
  experiments: readonly Experiment[];
  profile: Profile;
  defs: ReadonlyMap<string, BiomarkerDef>;
  today: string;
}): Dashboard {
  const { measurements, protocols, experiments, profile, defs, today } = input;

  const markers: DashboardMarker[] = [];
  for (const [id, ms] of groupByBiomarker(measurements)) {
    const def = defs.get(id);
    const t = computeTrend(ms);
    if (!def || !t) continue;
    markers.push({
      def,
      series: sortByDate(ms),
      latest: t.latest,
      flag: flagLatest(def, ms, profile),
      ...(resolveRange(def, t.latest, profile) ? { range: resolveRange(def, t.latest, profile)! } : {}),
      ...(t.change !== undefined ? { change: t.change } : {}),
      ...(t.percentChange !== undefined ? { percentChange: t.percentChange } : {}),
    });
  }
  markers.sort((a, b) => rank(a) - rank(b) || Math.abs(b.percentChange ?? 0) - Math.abs(a.percentChange ?? 0) || a.def.name.localeCompare(b.def.name));

  const judgedMarkers = markers.filter((m) => m.flag !== "unknown");
  const toWatch = markers.filter((m) => isOutOfRange(m.flag));

  const byDate = new Map<string, Measurement[]>();
  for (const m of measurements) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
  const draws: DrawSummary[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ms]) => {
      const flags = ms.flatMap((m) => {
        const def = defs.get(m.biomarkerId);
        return def ? [{ id: m.biomarkerId, flag: flagMeasurement(def, m, profile) }] : [];
      });
      return {
        date,
        results: ms.length,
        outOfRange: flags.filter((f) => isOutOfRange(f.flag)).map((f) => f.id),
        critical: flags.filter((f) => isCritical(f.flag)).map((f) => f.id),
      };
    });

  const bioAge: BioAgePoint[] = summarizePhenoAge(measurements, profile.birthMonth).draws.flatMap((d) =>
    d.status === "ok" && d.age !== undefined && d.phenoAge !== undefined && d.difference !== undefined
      ? [{ date: d.date, age: d.age, phenoAge: d.phenoAge, difference: d.difference, approximate: d.approximate.length > 0 }]
      : [],
  );

  const retests = experiments
    .filter((e) => !e.end)
    .map((e) => ({ experimentId: e.id, change: e.change, date: retestDate(e), daysAway: daysBetween(today, retestDate(e)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const lastTest = draws.at(-1)?.date;
  const dates = [...draws.map((d) => d.date), ...protocols.map((p) => p.start), ...protocols.flatMap((p) => (p.end ? [p.end] : []))].sort();

  return {
    markers,
    inRange: judgedMarkers.length - toWatch.length,
    judged: judgedMarkers.length,
    toWatch,
    critical: markers.filter((m) => isCritical(m.flag)),
    draws,
    ...(lastTest ? { lastTest, daysSinceLastTest: daysBetween(lastTest, today) } : {}),
    bioAge,
    activeLog: protocols.filter((p) => isActiveOn(p, today)),
    ...(retests[0] ? { nextRetest: retests[0] } : {}),
    ...(dates.length ? { span: { from: dates[0]!, to: dates.at(-1)! < today ? today : dates.at(-1)! } } : {}),
  };
}
