import { bmi, bmrMifflin, latestBloodPressure, latestBody, recentAverage, waistToHeight, waistToHeightBand } from "./body";
import { fitnessAge, vo2maxForAge } from "./fitnessAge";
import { type FitnessTestDef, fitnessSummary } from "./fitnessTests";
import { AGE_RANGE, framinghamRisk, heartAge, heartAgeData } from "./heartAge";
import { personalRange } from "./personalRange";
import { ageAt } from "./phenoageDraws";
import { buildSleepTiming, pairSleepCardiac, type SleepCardiacMetric, sleepClock } from "./sleepTiming";
import { flagLatest, recentTotal, resolveRange, sortByDate } from "./trends";
import type { BiomarkerDef, Measurement, Profile, ProtocolEntry } from "./types";

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The app's own calculations from body measurements, for Brain (and anything else that needs them):
 * so a model reports these numbers instead of working them out itself. With the marker definitions,
 * each measurement also gets its range and flag (sleep judged on the week's average) or, for HRV, the
 * person's own usual range.
 */
export function bodySummary(
  profile: Profile,
  measurements: readonly Measurement[],
  protocols: readonly ProtocolEntry[],
  today: string,
  defs?: ReadonlyMap<string, BiomarkerDef>,
  tests?: readonly FitnessTestDef[],
) {
  const latest = latestBody(measurements);
  const series = (id: string) => sortByDate(measurements.filter((m) => m.biomarkerId === id));
  const weekAvg = (id: string) => recentAverage(series(id));
  const w = latest.weight;
  const b = w ? bmi(w.value, profile.heightCm) : undefined;
  const age = w && profile.birthMonth ? ageAt(profile.birthMonth, w.date) : undefined;
  const bmr = w ? bmrMifflin(w.value, profile.heightCm, age, profile.sex) : undefined;
  const bp = latestBloodPressure(measurements);
  const sys30 = series("bp_systolic").filter((m) => bp && m.date >= shift(bp.systolic.date, -29) && m.date <= bp.systolic.date);
  const dia30 = series("bp_diastolic").filter((m) => bp && m.date >= shift(bp.systolic.date, -29) && m.date <= bp.systolic.date);
  const h = heartAgeData(profile, measurements, protocols, today);
  const sleepFrom = shift(today, -29);
  const sleep = buildSleepTiming(measurements, { from: sleepFrom, to: today, today });
  const lastSleep = sleep.nights.at(-1);
  const cardiacPairs = (metric: SleepCardiacMetric) => {
    const paired = pairSleepCardiac(sleep.nights, measurements, metric, "midpoint");
    return {
      sameWakeDatePairs: paired.points.length,
      consecutiveNightShiftPairs: paired.points.reduce((count, p) => count + (p.sleep.midpointShiftMinutes === undefined ? 0 : 1), 0),
      excludedNights: paired.excluded,
    };
  };
  const latestOf = (id: string) => {
    const s = series(id);
    const last = s.at(-1);
    if (!last) return undefined;
    const week = weekAvg(id);
    const def = defs?.get(id);
    const range = def ? resolveRange(def, last, profile) : undefined;
    const flag = def ? flagLatest(def, s, profile) : undefined;
    const usual = def?.personalRange ? personalRange(s) : undefined;
    return {
      latest: r1(last.value),
      date: last.date,
      ...(week ? { lastWeekAverage: r1(week.value), lastWeekReadings: week.count } : {}),
      ...(range
        ? {
            range: { low: range.low, high: range.high, ...(range.comparisonOnly ? { comparisonOnly: true } : {}) },
            ...(range.comparisonOnly ? { rangeUse: "Population comparison only, not clinical low/high limits or minimum/maximum healthy body fat." } : {}),
            ...(def?.judgeAverageOfDays ? { rangeCheckedAgainst: "the last week's average, not one night" } : {}),
          }
        : {}),
      ...(flag && flag !== "unknown" ? { flag } : {}),
      ...(usual
        ? {
            usualRange: {
              low: r1(usual.low),
              high: r1(usual.high),
              ...(usual.recent ? { lastWeek: r1(usual.recent.value), lastWeekIs: `${usual.recent.position} the usual range` } : {}),
              note: `This person's own usual range from ${usual.baseline.count} readings (${usual.baseline.from} to ${usual.baseline.to}), not a medical range. Nothing is out of range because of it.`,
            },
          }
        : def?.personalRange
          ? { usualRange: "Not enough readings yet (needs 2 weeks)." }
          : {}),
    };
  };

  return {
    ...(w ? { weightKg: { latest: r1(w.value), date: w.date } } : {}),
    ...(b !== undefined ? { bmi: { value: r1(b), note: "No range is used: BMI can't tell muscle from fat. Never a target." } } : {}),
    ...(latest.waist && waistToHeight(latest.waist.value, profile.heightCm) !== undefined
      ? {
          waistToHeight: {
            value: Math.round(waistToHeight(latest.waist.value, profile.heightCm)! * 100) / 100,
            guide: "below 0.5 is the usual guide",
            range: waistToHeightBand(waistToHeight(latest.waist.value, profile.heightCm)!),
          },
        }
      : {}),
    ...(bmr !== undefined
      ? {
          basalMetabolicRate: {
            kcalPerDay: Math.round(bmr),
            method: "Mifflin-St Jeor",
            note: "Resting metabolic rate (often called basal metabolic rate): an estimate (about ±10%) of energy used at rest. Not a target and not an intake recommendation.",
          },
        }
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
    ...opt("bodyFatPercent", latestOf("body_fat")),
    ...opt("restingHeartRateBpm", latestOf("resting_hr")),
    ...opt("restingHrvMs", latestOf("hrv_resting")),
    ...opt("hrvMs", latestOf("hrv")),
    ...opt("bloodOxygenPercent", latestOf("spo2")),
    ...opt("sleepHours", latestOf("sleep_duration")),
    ...opt("deepSleepHours", latestOf("sleep_deep")),
    ...opt("remSleepHours", latestOf("sleep_rem")),
    sleepTiming: {
      from: sleepFrom,
      to: today,
      nightsWithTiming: sleep.nights.length,
      durationOnlyNights: sleep.durationOnlyNights,
      invalidNights: sleep.invalidNights,
      regularity: sleep.regularity,
      ...(lastSleep
        ? {
            latest: {
              date: lastSleep.date,
              kind: lastSleep.main.kind,
              ...(lastSleep.main.source ? { source: lastSleep.main.source } : {}),
              startClock: sleepClock(lastSleep.start),
              endClock: sleepClock(lastSleep.end),
              midpointClock: sleepClock(lastSleep.midpoint),
              startHours: lastSleep.start,
              endHours: lastSleep.end,
              midpointHours: lastSleep.midpoint,
              sessionCount: lastSleep.windows.length,
            },
          }
        : {}),
      cardiacPairs: {
        restingHeartRate: cardiacPairs("resting_hr"),
        restingHrv: cardiacPairs("hrv_resting"),
      },
      notes: [
        "Source-local recorded windows, not bedtimes inferred from hours slept. The longest session is principal; naps are not averaged into it. In-bed and generic session bounds are not the exact moment of falling asleep.",
        "Regularity is the average absolute shortest clock shift in minutes between consecutive waking dates with the same window kind and a known unchanged source. Individual shifts are signed: later positive, earlier negative. No score, threshold or ideal bedtime.",
        "Clock midpoints are halfway between local-clock bounds, not elapsed-time midpoints across offset changes. Recorded offsets affect longest-session selection only when both are known.",
        "Cardiac counts match only the exact waking date and only resting heart rate or resting RMSSD HRV; missing dates are not carried. Same-date readings need not cover the same sleep window. No correlation or causal effect is calculated; alcohol, illness, training, medicines and device differences can affect both.",
        ...(sleep.regularity.pairs
          ? []
          : [
              "No eligible adjacent-night pairs: at least two consecutive waking dates with valid timing, the same kind and a known unchanged source are needed. Missing shift values are unavailable, not zero.",
            ]),
        "Duration-only saved nights need device-file re-import to obtain recorded timing; old real profiles are never filled with guessed times.",
      ],
    },
    ...opt("vo2maxMlKgMin", latestOf("vo2max")),
    ...opt(
      "dailySteps",
      (() => {
        const s = latestOf("steps");
        return (
          s && {
            ...s,
            note: "No official target, so no range. In studies, the risk of dying fell with more steps up to about 6,000-8,000 a day at 60 and over and 8,000-10,000 under 60 (associations in groups, not a goal).",
          }
        );
      })(),
    ),
    ...opt(
      "activeMinutes",
      (() => {
        const s = latestOf("active_minutes");
        const total = recentTotal(series("active_minutes"));
        return (
          s && {
            ...s,
            ...(total ? { last7DaysTotal: Math.round(total.value), last7DaysWithReadings: total.days } : {}),
            note: "Minutes of moderate or harder activity per day. The WHO advises adults 150-300 minutes of moderate (or 75-150 of vigorous) activity a week; the range is checked against the last 7 days' total, never one day.",
          }
        );
      })(),
    ),
    ...fitness(profile, measurements, today),
    ...(tests?.length
      ? (() => {
          const done = fitnessSummary(tests, measurements, {
            ...(profile.sex ? { sex: profile.sex } : {}),
            ...(profile.birthMonth ? { ageAt: (d: string) => ageAt(profile.birthMonth!, d) } : {}),
          });
          return done.length
            ? {
                fitnessTests: {
                  results: done,
                  note: "Timed tests are compared with published norms for age and sex, not targets or diagnoses. Device walking averages are not timed tests and have no test-norm comparison. Timed-test thresholds are ones doctors use, worth mentioning to a doctor.",
                },
              }
            : {};
        })()
      : {}),
    heartAge:
      h.input && !h.outOfRange
        ? {
            years: r1(heartAge(h.input)),
            actualAge: r1(h.input.age),
            tenYearCardiovascularRiskPercent: r1(framinghamRisk(h.input) * 100),
            inputs: {
              systolic: Math.round(h.input.systolic),
              bmi: r1(h.input.bmi),
              smoker: h.input.smoker,
              bloodPressureMedicine: h.input.treatedBp,
              diabetes: h.input.diabetes,
            },
            method:
              "Framingham office-based model with BMI (D'Agostino 2008). An estimate for ages 30-74 without heart disease; built on clinic blood pressure.",
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
      method:
        "Age at which healthy Norwegian adults (HUNT 3 Fitness Study, Loe 2013, treadmill-measured) averaged this VO2max. Watch estimates can be several points off.",
    },
  };
}
