import type { ChartPoint } from "@bt/core/chartSeries";
import { flagMeasurement, flagValue, isCritical, resolveRange, type Flag } from "@bt/core/trends";
import type { BiomarkerDef, Measurement, Profile } from "@bt/core/types";

/** Classify a bucket only with compatible ranges and context from its own readings. */
export function aggregateFlag(def: BiomarkerDef, point: ChartPoint, readings: readonly Measurement[], profile: Profile, total: boolean): Flag {
  const members = readings.filter((m) => m.date >= point.from && m.date <= point.to);
  if (!members.length || def.personalRange) return "unknown";
  if (total && new Set(members.map((m) => m.date)).size < 7) return "unknown";
  const first = members[0]!;
  const qualifiers = new Set(members.flatMap((m) => m.qualifier ? [m.qualifier] : []));
  if (qualifiers.size > 1) return "unknown";
  const qualifier = qualifiers.values().next().value;
  const aggregate = { ...first, date: point.date, value: point.value, qualifier };
  const critical = flagMeasurement(def, aggregate, profile);
  if (isCritical(critical)) return critical;
  const range = resolveRange(def, first, profile);
  const compatible = members.every((m) => {
    const other = resolveRange(def, m, profile);
    return m.fasted === first.fasted && other?.low === range?.low && other?.high === range?.high && other?.source === range?.source;
  });
  if (!compatible) return "unknown";
  // A limit is not an exact mean. The interval-aware measurement classifier preserves certainty.
  if (qualifier) return flagMeasurement({ ...def, judgeAverageOfDays: undefined, judgeSumOfDays: undefined }, aggregate, profile);
  return flagValue(point.value, range);
}
