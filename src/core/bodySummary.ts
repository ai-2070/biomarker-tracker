import { bmi, bmiBand, bmrMifflin, latestBloodPressure, latestBody, recentAverage, waistToHeight } from "./body";
import { AGE_RANGE, framinghamRisk, heartAge, heartAgeData } from "./heartAge";
import { fitnessAge, vo2maxForAge } from "./fitnessAge";
import { ageAt } from "./phenoageDraws";
import { sortByDate } from "./trends";
import type { Measurement, Profile, ProtocolEntry } from "./types";

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The app's own calculations from body measurements, for Brain (and anything else that needs them):
 * so a model reports these numbers instead of working them out itself.
 */
export function bodySummary(profile: Profile, measurements: readonly Measurement[], protocols: readonly ProtocolEntry[], today: string) {
  const latest = latestBody(measurements);
  const series = (id: string) => sortByDate(measurements.filter((m) => m.biomarkerId === id));
  const weekAvg = (id: string) => recentAverage(series(id));
  const w = latest.weight;
  const b = w ? bmi(w.value, profile.heightCm) : undefined;
  const age = w && profile.birthMonth ? ageAt(profile.birthMonth, w.date) : undefined;
  const bmr = w ? bmrMifflin(w.value, profile.heightCm, age, profile.sex) : undefined;
  const bp = latestBloodPressure(measurements);
  const sys30 = series("bp_systolic").filter((m) => bp && m.date >= shift(bp.systolic.date, -29));
  const dia30 = series("bp_diastolic").filter((m) => bp && m.date >= shift(bp.systolic.date, -29));
  const h = heartAgeData(profile, measurements, protocols, today);
  const latestOf = (id: string) => {
    const s = series(id);
    const last = s.at(-1);
    if (!last) return undefined;
    const week = weekAvg(id);
    return { latest: r1(last.value), date: last.date, ...(week ? { lastWeekAverage: r1(week.value), lastWeekReadings: week.count } : {}) };
  };

  return {
    ...(w ? { weightKg: { latest: r1(w.value), date: w.date } } : {}),
    ...(b !== undefined ? { bmi: { value: r1(b), band: bmiBand(b), note: "A rough guide: BMI can't tell muscle from fat. Never a target." } } : {}),
    ...(latest.waist && waistToHeight(latest.waist.value, profile.heightCm) !== undefined
      ? { waistToHeight: { value: Math.round(waistToHeight(latest.waist.value, profile.heightCm)! * 100) / 100, guide: "below 0.5 is the usual guide" } }
      : {}),
    ...(bmr !== undefined
      ? { basalMetabolicRate: { kcalPerDay: Math.round(bmr), method: "Mifflin-St Jeor", note: "An estimate (about ±10%) of energy used at complete rest. Not a target and not an intake recommendation." } }
      : {}),
    ...(bp
      ? {
          bloodPressure: {
            latest: `${Math.round(bp.systolic.value)}/${Math.round(bp.diastolic.value)} mmHg`,
            date: bp.systolic.date,
            last30DaysAverage: `${Math.round(avg(sys30))}/${Math.round(avg(dia30))} mmHg (${sys30.length} readings)`,
          },
        }
      : {}),
    ...opt("restingHeartRateBpm", latestOf("resting_hr")),
    ...opt("restingHrvMs", latestOf("hrv_resting")),
    ...opt("bloodOxygenPercent", latestOf("spo2")),
    ...opt("sleepHours", latestOf("sleep_duration")),
    ...opt("deepSleepHours", latestOf("sleep_deep")),
    ...opt("remSleepHours", latestOf("sleep_rem")),
    ...opt("vo2maxMlKgMin", latestOf("vo2max")),
    ...fitness(profile, measurements, today),
    heartAge:
      h.input && !h.outOfRange
        ? {
            years: r1(heartAge(h.input)),
            actualAge: r1(h.input.age),
            tenYearCardiovascularRiskPercent: r1(framinghamRisk(h.input) * 100),
            inputs: { systolic: Math.round(h.input.systolic), bmi: r1(h.input.bmi), smoker: h.input.smoker, bloodPressureMedicine: h.input.treatedBp, diabetes: h.input.diabetes },
            method: "Framingham office-based model with BMI (D'Agostino 2008). An estimate for ages 30-74 without heart disease; built on clinic blood pressure.",
          }
        : h.outOfRange
          ? { notShown: `Only for ages ${AGE_RANGE.min}-${AGE_RANGE.max}.` }
          : { notShown: `Needs ${h.missing.join(", ")}.` },
  };
}

const avg = (ms: readonly Measurement[]) => (ms.length ? ms.reduce((s, m) => s + m.value, 0) / ms.length : NaN);
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
const opt = <K extends string, V>(key: K, v: V | undefined) => (v === undefined ? {} : ({ [key]: v } as Record<K, V>));

/** Fitness age from the latest VO2max against the HUNT 3 Fitness Study's averages (Loe 2013). */
function fitness(profile: Profile, measurements: readonly Measurement[], today: string) {
  const last = sortByDate(measurements.filter((m) => m.biomarkerId === "vo2max")).at(-1);
  if (!last || !profile.sex || !profile.birthMonth) return {};
  const f = fitnessAge(last.value, profile.sex);
  const age = ageAt(profile.birthMonth, today);
  const g = vo2maxForAge(last.value, age, profile.sex);
  return {
    fitnessAge: {
      years: f.bound === "younger" ? "25 or younger" : f.bound === "older" ? "75 or older" : r1(f.age),
      actualAge: r1(age),
      vo2max: r1(last.value),
      ageGroupAverage: `${g.mean} mL/kg/min for healthy ${profile.sex === "m" ? "men" : "women"} aged ${g.group} (SD ${g.sd})`,
      method: "Age at which healthy Norwegian adults (HUNT 3 Fitness Study, Loe 2013, treadmill-measured) averaged this VO2max. Watch estimates can be several points off.",
    },
  };
}
