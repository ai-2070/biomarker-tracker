import { dayNumber, isIsoDate } from "./dates";
import { waistToHeight } from "./body";
import { bestBeforeMoments, bestBeforeWithShift, type LifeTable } from "./lifeTable";
import { predictMortality, type MortalityInputKey, type MortalityInputs, type MortalityModelFile, type MortalityPrediction } from "./mortalityModel";
import { isBirthMonth, summarizePhenoAge } from "./phenoageDraws";
import { sortByDate } from "./trends";
import type { Measurement, Profile } from "./types";

export interface ProjectionInput {
  key: string;
  label: string;
  value?: number | string;
  unit?: string;
  date?: string;
  detail?: string;
}
export interface MortalityProjection {
  plain?: ReturnType<typeof bestBeforeMoments>;
  adjusted?: ReturnType<typeof bestBeforeWithShift>;
  prediction: MortalityPrediction;
  included: ProjectionInput[];
  notUsed: ProjectionInput[];
  cautions: string[];
}

/** Availability windows, not validated clinical cut-offs: carried-forward observations are a limitation. */
const MAX_READING_DAYS = 365;
const BODY_PAIR_DAYS = 30;
const LAB_BODY_DAYS = 90;
const FUNCTION_TESTS = new Set(["pushups", "grip_strength", "sit_to_stand_5x", "chair_stand_30s", "one_leg_stand", "gait_speed", "sitting_rising"]);
const labels: Record<MortalityInputKey, string> = {
  age: "Age", sex: "Sex", smoking: "Smoking", bodyFat: "Body fat", waistToHeight: "Waist-to-height ratio", activityWeekly: "Leisure exercise", phenoAgeGap: "PhenoAge gap",
};

/** Same selector and projection for the page and Brain. No learned coefficient is invented for absent data. */
export function mortalityProjection(
  table: LifeTable,
  profile: Profile,
  measurements: readonly Measurement[],
  today: string,
  file: MortalityModelFile,
  activityMatchesLeisure = false,
): MortalityProjection {
  const result: MortalityProjection = { prediction: { status: "unavailable", reasons: [] }, included: [], notUsed: [], cautions: [] };
  if (!isIsoDate(today) || !profile.birthMonth || !isBirthMonth(profile.birthMonth)) {
    result.prediction.reasons = ["Add a valid month and year of birth."];
    return result;
  }
  const plain = bestBeforeMoments(table, profile.birthMonth, today);
  if (!(plain.age >= 0)) {
    result.prediction.reasons = ["Month of birth cannot be in the future."];
    return result;
  }
  result.plain = plain;
  const now = dayNumber(today);
  const valid = sortByDate(measurements.filter((m) => isIsoDate(m.date) && m.date <= today));
  const latest = (id: string) => {
    let found: Measurement | undefined;
    for (const m of valid) if (m.biomarkerId === id && (!found || m.date >= found.date)) found = m;
    return found;
  };
  const recentPoint = (id: string) => {
    const m = latest(id);
    return m && Number.isFinite(m.value) && !m.qualifier && now - dayNumber(m.date) <= MAX_READING_DAYS ? m : undefined;
  };
  const input: MortalityInputs = { age: plain.age, sex: profile.sex, smoking: profile.smoking };
  const descriptions = new Map<MortalityInputKey, ProjectionInput>([
    ["age", { key: "age", label: "Age", value: plain.age, unit: "years", detail: "Approximate, from birth month and year." }],
    ["sex", { key: "sex", label: "Sex", value: profile.sex === "m" ? "Male" : profile.sex === "f" ? "Female" : "Not recorded" }],
    ["smoking", { key: "smoking", label: "Smoking", value: profile.smoking ?? "Not recorded", detail: "Cigarette-smoking category; duration and amount are not available." }],
  ]);
  const fat = recentPoint("body_fat");
  const waist = recentPoint("waist");
  if (fat && fat.value > 0 && fat.value < 100) {
    input.bodyFat = fat.value;
    descriptions.set("bodyFat", { key: "bodyFat", label: labels.bodyFat, value: fat.value, unit: "%", date: fat.date, detail: "Cohort fat was measured by DXA; home scales and other methods are not calibrated to it." });
  }
  const ratio = waist ? waistToHeight(waist.value, profile.heightCm) : undefined;
  if (waist && ratio !== undefined) {
    input.waistToHeight = ratio;
    descriptions.set("waistToHeight", { key: "waistToHeight", label: labels.waistToHeight, value: ratio, date: waist.date });
  }
  const bodyPairAligned = !fat || !waist || Math.abs(dayNumber(fat.date) - dayNumber(waist.date)) <= BODY_PAIR_DAYS;
  const draws = summarizePhenoAge(valid, profile.birthMonth).draws;
  const draw = draws.filter((d) => d.status === "ok" && d.difference !== undefined && Number.isFinite(d.difference) && now - dayNumber(d.date) <= MAX_READING_DAYS && d.approximate.every((q) => q.biomarkerId === "crp_hs" && q.qualifier === "<")).at(-1);
  if (draw) {
    input.phenoAgeGap = draw.difference;
    descriptions.set("phenoAgeGap", { key: "phenoAgeGap", label: labels.phenoAgeGap, value: draw.difference, unit: "years", date: draw.date, detail: draw.approximate.length ? "Approximate: CRP detection limit used. All nine blood markers are from one draw." : "All nine blood markers from one draw; no mixing test dates." });
  }
  // Daily values are totals. A later persisted same-day entry replaces, rather than adds to, that total.
  const daily = new Map<string, Measurement>();
  for (const m of valid) if (m.biomarkerId === "active_minutes" && now - dayNumber(m.date) < 30) daily.set(m.date, m);
  // Resolve the winning save first: an unusable newer total must not resurrect an older exact one.
  for (const [date, m] of daily) if (m.qualifier || !Number.isFinite(m.value) || m.value < 0 || m.value > 1440) daily.delete(date);
  if (activityMatchesLeisure && daily.size >= 21) {
    let total = 0;
    for (const m of daily.values()) total += m.value;
    input.activityWeekly = (total / daily.size) * 7;
    descriptions.set("activityWeekly", { key: "activityWeekly", label: labels.activityWeekly, value: input.activityWeekly, unit: "min/week", date: today, detail: `Estimated from ${daily.size} recorded days in the last 30; missing days are not zero. Only confirmed actual leisure-exercise minutes in sessions of at least 10 minutes; vigorous minutes counted once.` });
  }
  const compatible = {
    ...file,
    models: file.models.filter((m) => {
      const needsBodyPair = m.required.includes("bodyFat") && m.required.includes("waistToHeight");
      if (needsBodyPair && !bodyPairAligned) return false;
      if (needsBodyPair && m.required.includes("phenoAgeGap") && draw && fat && waist) {
        return Math.abs(dayNumber(draw.date) - dayNumber(fat.date)) <= LAB_BODY_DAYS && Math.abs(dayNumber(draw.date) - dayNumber(waist.date)) <= LAB_BODY_DAYS;
      }
      return true;
    }),
  };
  const prediction = predictMortality(compatible, input);
  result.prediction = prediction;
  const used = new Set(prediction.model?.required ?? []);
  for (const [key, value] of descriptions) {
    if (used.has(key)) result.included.push(value);
    else if (key !== "age" && key !== "sex" && key !== "smoking") result.notUsed.push({ ...value, detail: "Not used by the selected fitted model, or no compatible model could be selected." });
  }
  if (!used.has("activityWeekly")) result.notUsed.push({ key: "active_minutes", label: "Active time", detail: !activityMatchesLeisure ? "Not assumed to match the cohort: it recorded leisure exercise in sessions of at least 10 minutes, not all device active time." : daily.size < 21 ? "Needs at least 21 daily totals in the last 30 days; missing days are not assumed to be inactive." : "Not used by the selected fitted model." });
  const hrvDays = new Map<string, Measurement>();
  for (const m of valid) if (m.biomarkerId === "hrv_resting" && now - dayNumber(m.date) < 30) hrvDays.set(m.date, m);
  let hrvSum = 0;
  let hrvCount = 0;
  for (const m of hrvDays.values()) if (!m.qualifier && Number.isFinite(m.value) && m.value > 0) { hrvSum += Math.log(m.value); hrvCount++; }
  result.notUsed.push({ key: "hrv_resting", label: "Resting HRV", ...(hrvCount ? { value: Math.exp(hrvSum / hrvCount), unit: "ms", detail: `Last 30 days' geometric mean, ${hrvCount} days. No compatible overnight RMSSD and mortality training data; no fitted weight.` } : { detail: "No compatible overnight RMSSD and mortality training data; no fitted weight." }) });
  const pace = latest("dunedinpace");
  result.notUsed.push({ key: "dunedinpace", label: "DunedinPACE", ...(pace && Number.isFinite(pace.value) && !pace.qualifier ? { value: pace.value, date: pace.date } : {}), detail: "Not in the linked training data. DunedinPoAm in a public release is a different test and is not substituted." });
  const fitnessCount = new Set(valid.filter((m) => FUNCTION_TESTS.has(m.biomarkerId)).map((m) => m.biomarkerId)).size;
  result.notUsed.push({ key: "fitness", label: "Strength, balance and walking", detail: `${fitnessCount ? `${fitnessCount} recorded test types. ` : ""}Not included: the cohort's available tests and age coverage do not match this combined model. Device walking averages are not timed tests.` });
  if (!bodyPairAligned) result.cautions.push("Body fat and waist are more than 30 days apart; they were not combined.");
  if (draw && fat && waist && (Math.abs(dayNumber(draw.date) - dayNumber(fat.date)) > LAB_BODY_DAYS || Math.abs(dayNumber(draw.date) - dayNumber(waist.date)) > LAB_BODY_DAYS)) result.cautions.push("Blood and body readings are more than 90 days apart; no model combines those readings.");
  if (prediction.status === "ok") {
    result.cautions.push("Jointly fitted associations, not evidence that changing one input adds years. Readings up to a year old are carried forward; training measurements were from one examination.");
    if (used.has("bodyFat")) result.cautions.push("Transferring DXA-trained coefficients to a home body-fat estimate has not been validated.");
    if (used.has("activityWeekly")) result.cautions.push("Transferring recalled leisure-exercise associations to recorded daily minutes has not been validated.");
    if (!prediction.riskAgeBound && prediction.riskAge !== undefined) {
      result.adjusted = bestBeforeWithShift(table, profile.birthMonth, today, prediction.riskAge - plain.age);
      result.cautions.push("The lifetime date assumes this risk-equivalent age gap persists. This country/lifetime projection has not been validated; a ten-year cohort score does not validate a date of death.");
    }
  }
  return result;
}
