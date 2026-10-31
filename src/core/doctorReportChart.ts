import { dayNumber } from "./dates";
import { niceTicks } from "./scale";
import { timeTicks } from "./timeWindow";
import { paddedDomain, sortByDate } from "./trends";
import type { BiomarkerDef, Measurement } from "./types";
import { fromCanonical, toCanonical } from "./units";

export interface ReportChartBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ReportChartPoint {
  measurement: Measurement;
  x: number;
  y: number;
  /** Position in a group with the same date, value and qualifier. No readings are removed. */
  overlapIndex: number;
  overlapCount: number;
}

/**
 * Print geometry only: every reading stays at its reported date and value/limit.
 * Bounds and days with several readings interrupt lines; save order is not a sampling time.
 * All charts use the selected report window, even when their readings cover less of it.
 */
export function reportChartGeometry(
  def: BiomarkerDef,
  measurements: readonly Measurement[],
  unit: string,
  from: string,
  to: string,
  box: ReportChartBox,
): {
  points: ReportChartPoint[];
  segments: ReportChartPoint[][];
  yTicks: { canonicalValue: number; y: number }[];
  dateTicks: { date: string; x: number }[];
  hasSameDayReadings: boolean;
} {
  const sorted = sortByDate(measurements);
  const values = sorted.map((m) => fromCanonical(def, m.value, unit));
  // paddedDomain normally stops at zero. Offset units can legitimately display negative
  // numbers: translate before padding, then translate back rather than clipping a reading.
  let offset = 0;
  for (const value of values) offset = Math.min(offset, value);
  const [low, high] = paddedDomain(values.map((value) => value - offset));
  const ticks = niceTicks(low + offset, high + offset);
  const min = ticks[0]!;
  const max = ticks[ticks.length - 1]!;
  const y = (value: number) => box.top + ((max - value) / (max - min)) * box.height;
  const firstDay = dayNumber(from);
  const lastDay = dayNumber(to);
  const x = (day: number) => box.left + (lastDay === firstDay ? 0.5 : (day - firstDay) / (lastDay - firstDay)) * box.width;
  const dateCounts = new Map<string, number>();
  const overlapCounts = new Map<string, number>();
  const overlapSeen = new Map<string, number>();
  const overlapKey = (m: Measurement) => `${m.date}:${m.value}:${m.qualifier ?? "="}`;
  for (const m of sorted) {
    dateCounts.set(m.date, (dateCounts.get(m.date) ?? 0) + 1);
    const key = overlapKey(m);
    overlapCounts.set(key, (overlapCounts.get(key) ?? 0) + 1);
  }
  const points = sorted.map((measurement, index): ReportChartPoint => {
    const key = overlapKey(measurement);
    const overlapIndex = overlapSeen.get(key) ?? 0;
    overlapSeen.set(key, overlapIndex + 1);
    return {
      measurement,
      x: x(dayNumber(measurement.date)),
      y: y(values[index]!),
      overlapIndex,
      overlapCount: overlapCounts.get(key)!,
    };
  });
  const segments: ReportChartPoint[][] = [];
  let segment: ReportChartPoint[] = [];
  for (const point of points) {
    if (point.measurement.qualifier || dateCounts.get(point.measurement.date)! > 1) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
    } else {
      segment.push(point);
    }
  }
  if (segment.length > 1) segments.push(segment);

  // Edge labels align inward, so reserve room for a full date plus its centered neighbour.
  // Thin calendar ticks, never the readings themselves.
  const dateLabelGap = 140;
  const dateTicks = [{ date: from, x: x(firstDay) }];
  if (firstDay !== lastDay) {
    for (const tick of timeTicks({ from: firstDay, to: lastDay })) {
      const position = x(tick.day);
      if (position - dateTicks.at(-1)!.x >= dateLabelGap && x(lastDay) - position >= dateLabelGap) {
        dateTicks.push({ date: tick.date, x: position });
      }
    }
    dateTicks.push({ date: to, x: x(lastDay) });
  }
  return {
    points,
    segments,
    yTicks: ticks.map((value) => ({ canonicalValue: toCanonical(def, value, unit), y: y(value) })),
    dateTicks,
    hasSameDayReadings: [...dateCounts.values()].some((count) => count > 1),
  };
}
