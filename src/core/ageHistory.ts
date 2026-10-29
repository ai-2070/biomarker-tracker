import { fitnessAge } from "./fitnessAge";
import { heartAge, heartAgeData } from "./heartAge";
import { ageAt, summarizePhenoAge } from "./phenoageDraws";
import { sortByDate } from "./trends";
import type { Measurement, Profile, ProtocolEntry } from "./types";

/**
 * The three age estimates over time, for one chart: PhenoAge at each complete blood test, heart age on
 * each day with a blood pressure reading (using what was known that day), and fitness age at each
 * VO₂max reading, each next to the calendar age on that day. Nothing is combined: the three estimate
 * different things with different methods, so an average of them would have no meaning.
 */

export interface AgePoint {
  date: string;
  /** The estimate, in years. For a fitness age at the end of the table, the bound (25 or 75). */
  years: number;
  /** Calendar age on that day. */
  age: number;
  /** Fitness age outside the table's ages: "25 or younger" / "75 or older". */
  bound?: "younger" | "older";
  /** PhenoAge with a "<" CRP value: approximate. */
  approximate?: boolean;
}

export interface AgeHistory {
  blood: AgePoint[];
  heart: AgePoint[];
  fitness: AgePoint[];
}

export function ageHistory(profile: Profile, measurements: readonly Measurement[], protocols: readonly ProtocolEntry[]): AgeHistory {
  const empty: AgeHistory = { blood: [], heart: [], fitness: [] };
  if (!profile.birthMonth) return empty;
  const birth = profile.birthMonth;

  const blood = summarizePhenoAge(measurements, birth).draws.flatMap((d) =>
    d.status === "ok" && d.phenoAge !== undefined && d.age !== undefined ? [{ date: d.date, years: d.phenoAge, age: d.age, ...(d.approximate.length ? { approximate: true } : {}) }] : [],
  );

  // Heart age as it was on each day with a blood pressure reading: only readings and weights up to that day.
  const sorted = sortByDate(measurements);
  const bpDays = [...new Set(sorted.filter((m) => m.biomarkerId === "bp_systolic").map((m) => m.date))];
  const heart = bpDays.flatMap((date) => {
    const h = heartAgeData(profile, sorted.filter((m) => m.date <= date), protocols, date);
    return h.input && !h.outOfRange ? [{ date, years: heartAge(h.input), age: h.input.age }] : [];
  });

  const fitness = profile.sex
    ? sorted
        .filter((m) => m.biomarkerId === "vo2max")
        .map((m) => {
          const f = fitnessAge(m.value, profile.sex!);
          return { date: m.date, years: f.age, age: ageAt(birth, m.date), ...(f.bound ? { bound: f.bound } : {}) };
        })
    : [];

  return { blood, heart, fitness };
}
