import type { BiomarkerDef, Measurement, Profile, ProtocolEntry } from "./types";
import type { Flag, ResolvedRange } from "./trends";
import { isIsoDate } from "./dates";
import { ageAt, isBirthMonth } from "./phenoageDraws";
import { flagMeasurement, resolveRange, sortByDate } from "./trends";
import { BODY_GROUPS, bmi, bmrMifflinTerms } from "./body";

export interface DoctorReportOptions {
  from: string;
  to: string;
  markerIds: readonly string[];
  includeProfile: boolean;
  includeLog: boolean;
  includeNotes: boolean;
}

export interface DoctorReportReading {
  measurement: Measurement;
  flag: Flag;
  range?: ResolvedRange;
}

export interface DoctorReportSeries {
  def: BiomarkerDef;
  count: number;
  latest: Measurement;
  latestFlag: Flag;
  latestRange?: ResolvedRange;
  /** Every selected reading in the report period, including body/device readings. */
  history: DoctorReportReading[];
}

/** Share the Body page's group and field order; never lose an unfamiliar body marker. */
export function groupDoctorReportSeries(series: readonly DoctorReportSeries[]): {
  blood: DoctorReportSeries[];
  body: { id: string; title: string; series: DoctorReportSeries[] }[];
} {
  const blood: DoctorReportSeries[] = [];
  const remaining = new Map<string, DoctorReportSeries>();
  for (const item of series) {
    if (item.def.category === "Body") remaining.set(item.def.id, item);
    else blood.push(item);
  }
  const body: { id: string; title: string; series: DoctorReportSeries[] }[] = [];
  for (const group of BODY_GROUPS) {
    const readings: DoctorReportSeries[] = [];
    for (const field of group.fields) {
      const item = remaining.get(field);
      if (item) {
        readings.push(item);
        remaining.delete(field);
      }
    }
    if (readings.length) body.push({ id: group.id, title: group.title, series: readings });
  }
  if (remaining.size) body.push({ id: "other", title: "Other body measurements", series: [...remaining.values()] });
  return { blood, body };
}

export interface DoctorReport {
  generatedOn: string;
  from: string;
  to: string;
  example: boolean;
  profile?: Profile;
  /** Most recent recorded weight on/before the report end, only with profile details. */
  profileWeight?: { def: BiomarkerDef; measurement: Measurement };
  profileBmi?: number;
  profileRmr?: { age: number; terms: NonNullable<ReturnType<typeof bmrMifflinTerms>> };
  /** Completed years on generatedOn, when birth month is known. */
  age?: number;
  series: DoctorReportSeries[];
  /** Only logged habits overlapping the selected period, not unstarted protocols. */
  logs: ProtocolEntry[];
  includeLog: boolean;
  includeNotes: boolean;
}

export interface DoctorReportInput {
  measurements: readonly Measurement[];
  protocols: readonly ProtocolEntry[];
  profile: Profile;
  defs: ReadonlyMap<string, BiomarkerDef>;
  options: DoctorReportOptions;
  generatedOn: string;
}

/** Build a local, canonical-unit snapshot; formatting and printing belong to the page. */
export function buildDoctorReport(input: DoctorReportInput): DoctorReport {
  const { options, generatedOn, profile } = input;
  const { from, to, includeProfile, includeNotes, includeLog } = options;
  if (!isIsoDate(from) || !isIsoDate(to) || !isIsoDate(generatedOn) || from > to || to > generatedOn) {
    throw new Error("Choose a valid date range ending no later than the report date.");
  }

  const copyMeasurement = (m: Measurement): Measurement => {
    const { note, labRange, ...fields } = m;
    return {
      ...fields,
      ...(labRange ? { labRange: { ...labRange } } : {}),
      ...(includeNotes && note !== undefined ? { note } : {}),
    };
  };
  const grouped = new Map<string, Measurement[]>();
  const selected = new Set(options.markerIds);
  for (const m of input.measurements) {
    if (!selected.has(m.biomarkerId) || !input.defs.has(m.biomarkerId) || !isIsoDate(m.date) || m.date < from || m.date > to) continue;
    const rows = grouped.get(m.biomarkerId);
    if (rows) rows.push(m);
    else grouped.set(m.biomarkerId, [m]);
  }
  const series: DoctorReportSeries[] = [];
  for (const id of selected) {
    const def = input.defs.get(id);
    const rows = grouped.get(id);
    if (!def || !rows?.length) continue;
    const sorted = sortByDate(rows);
    const reading = (m: Measurement): DoctorReportReading => {
      const measurement = copyMeasurement(m);
      return {
        measurement,
        flag: flagMeasurement(def, measurement, profile),
        // A weekly activity threshold is not a reference range for one day's reading.
        range: def.judgeSumOfDays ? undefined : resolveRange(def, measurement, profile),
      };
    };
    const history = sorted.map(reading);
    const latest = history[history.length - 1]!;
    series.push({
      def,
      count: history.length,
      latest: latest.measurement,
      latestFlag: latest.flag,
      latestRange: latest.range,
      history,
    });
  }

  const logs: ProtocolEntry[] = includeLog ? input.protocols
    .filter((entry) => isIsoDate(entry.start) && entry.start <= to
      && (entry.end === undefined || (isIsoDate(entry.end) && entry.end >= from)))
    .map((entry) => ({
      id: entry.id, label: entry.label, category: entry.category, start: entry.start,
      ...(entry.end !== undefined ? { end: entry.end } : {}),
      ...(entry.plan ? {
        plan: {
          id: entry.plan.id,
          items: entry.plan.items.map(({ note, days, ...item }) => ({
            ...item,
            ...(days ? { days: [...days] } : {}),
            ...(includeNotes && note !== undefined ? { note } : {}),
          })),
        },
      } : {}),
    })) : [];
  const report: DoctorReport = {
    generatedOn, from, to, example: profile.example === true, series, logs,
    includeLog, includeNotes,
  };
  if (includeProfile) {
    const { name, sex, birthMonth, heightCm, country, diet, smoking, conditions, allergies, notes } = profile;
    report.profile = { name, sex, birthMonth, heightCm, country, diet, smoking, conditions, allergies,
      ...(includeNotes && notes !== undefined ? { notes } : {}) };
    if (birthMonth && isBirthMonth(birthMonth)) report.age = Math.floor(ageAt(birthMonth, generatedOn));
    const weightDef = input.defs.get("weight");
    if (weightDef) {
      const weight = sortByDate(input.measurements.filter((measurement) =>
        measurement.biomarkerId === "weight" && isIsoDate(measurement.date) && measurement.date <= to)).at(-1);
      if (weight) report.profileWeight = { def: weightDef, measurement: copyMeasurement(weight) };
      if (weight && !weight.qualifier) {
        const bmiValue = bmi(weight.value, heightCm);
        if (bmiValue !== undefined) report.profileBmi = bmiValue;
        if (birthMonth && isBirthMonth(birthMonth)) {
          const weightAge = ageAt(birthMonth, weight.date);
          const terms = bmrMifflinTerms(weight.value, heightCm, weightAge, sex);
          if (terms) report.profileRmr = { age: weightAge, terms };
        }
      }
    }
  }
  return report;
}
