import { ageAt } from "./phenoageDraws";
import { bmi, latestBody } from "./body";
import { sortByDate } from "./trends";
import { isActiveOn } from "./protocols";
import type { Measurement, Profile, ProtocolEntry } from "./types";

/**
 * Heart age from the Framingham general cardiovascular risk profile, office-based model with BMI
 * instead of cholesterol (D'Agostino et al., Circulation 2008, PMID 18212285). Coefficients as
 * published by the Framingham Heart Study (framinghamheartstudy.org, "cardiovascular disease
 * 10-year risk", BMI version; checked 2026-10-29, the same values as in its gencardio_bmi.xls).
 *
 * 10-year risk = 1 − S0^exp(Σβx − mean). Heart age is the age at which someone with normal risk
 * factors (systolic 125 untreated, BMI 22.5, non-smoker, no diabetes, the reference values in that
 * calculator) has the same risk. Developed for ages 30–74 without heart disease.
 */
export const FRAMINGHAM_BMI = {
  f: { lnAge: 2.72107, lnBmi: 0.51125, lnSbpUntreated: 2.81291, lnSbpTreated: 2.88267, smoker: 0.61868, diabetes: 0.77763, s0: 0.94833, mean: 26.0145 },
  m: { lnAge: 3.11296, lnBmi: 0.79277, lnSbpUntreated: 1.85508, lnSbpTreated: 1.92672, smoker: 0.70953, diabetes: 0.5316, s0: 0.88431, mean: 23.9388 },
} as const;

/** The calculator's "normal" risk factors, which define heart age. */
export const NORMAL = { systolic: 125, bmi: 22.5 } as const;
export const AGE_RANGE = { min: 30, max: 74 } as const;

export interface HeartAgeInput {
  sex: "m" | "f";
  age: number;
  systolic: number;
  treatedBp: boolean;
  smoker: boolean;
  diabetes: boolean;
  bmi: number;
}

function sum(i: HeartAgeInput): number {
  const c = FRAMINGHAM_BMI[i.sex];
  return (
    c.lnAge * Math.log(i.age) +
    (i.treatedBp ? c.lnSbpTreated : c.lnSbpUntreated) * Math.log(i.systolic) +
    c.lnBmi * Math.log(i.bmi) +
    (i.smoker ? c.smoker : 0) +
    (i.diabetes ? c.diabetes : 0)
  );
}

/** Predicted 10-year risk of a heart attack, stroke or other cardiovascular event (0–1). */
export function framinghamRisk(i: HeartAgeInput): number {
  const c = FRAMINGHAM_BMI[i.sex];
  return 1 - Math.pow(c.s0, Math.exp(sum(i) - c.mean));
}

/** The age at which a person with normal risk factors has the same predicted risk. */
export function heartAge(i: HeartAgeInput): number {
  const c = FRAMINGHAM_BMI[i.sex];
  const rest = c.lnSbpUntreated * Math.log(NORMAL.systolic) + c.lnBmi * Math.log(NORMAL.bmi);
  return Math.exp((sum(i) - rest) / c.lnAge);
}

/** Blood pressure medicines by name (generic and common brands), for "treated for high blood pressure". */
const BP_MEDICINES =
  /amlodipine|nifedipine|felodipine|lercanidipine|lisinopril|ramipril|enalapril|perindopril|captopril|quinapril|losartan|valsartan|candesartan|irbesartan|telmisartan|olmesartan|bisoprolol|metoprolol|atenolol|nebivolol|carvedilol|propranolol|hydrochlorothiazide|chlorthalidone|indapamide|spironolactone|doxazosin|blood pressure|antihypertensive|norvasc|zestril|cozaar|diovan|concor/i;
const DIABETES_MEDICINES = /metformin|insulin|gliclazide|glimepiride|glipizide|sitagliptin|linagliptin|empagliflozin|dapagliflozin|canagliflozin|pioglitazone|jardiance|forxiga|januvia/i;

/** Only affirmative history may change a numerical risk input; uncertain mentions need confirmation. */
function affirmativeHistory(text: string, pattern: RegExp): boolean | undefined {
  let uncertain = false;
  for (const clause of text.split(/[.;,\n]|\bbut\b/i)) {
    const match = pattern.exec(clause);
    if (!match) continue;
    const before = clause.slice(0, match.index);
    const through = clause.slice(0, match.index + match[0].length);
    const after = clause.slice(match.index + match[0].length);
    if (/\b(no|not|without|denies|denied|negative for|untreated)\b/i.test(through) || /^\s*:?\s*(?:(?:is|was)\s+)?(?:no\b|absent\b|ruled out\b|negative\b|denied\b|not (?:present|diagnosed|treated)\b)/i.test(after)) continue;
    if (/\?|\b(possible|suspected|uncertain|maybe|family history|rule out)\b/i.test(before + after)) uncertain = true;
    else return true;
  }
  return uncertain ? undefined : false;
}

export interface HeartAgeData {
  input?: HeartAgeInput;
  /** What's needed and missing ("your sex", "a blood pressure reading"…). */
  missing: string[];
  /** How the inputs were found, to show next to the result. */
  from: { systolicReadings: number; systolicDate?: string; bmiDate?: string; treatedBp: "habits" | "profile" | "no"; diabetes: "habits" | "profile" | "no" };
  /** Outside the ages the model was built for. */
  outOfRange?: "young" | "old";
}

/**
 * Collects the inputs from what the app knows. Systolic pressure is the average of the readings in
 * the 30 days up to the latest. Treatment and diabetes come from the profile's conditions or from
 * medicines in the habits; they are shown so the person can correct them.
 */
export function heartAgeData(profile: Profile, measurements: readonly Measurement[], protocols: readonly ProtocolEntry[], today: string): HeartAgeData {
  const missing: string[] = [];
  const sys = sortByDate(measurements.filter((m) => m.biomarkerId === "bp_systolic"));
  const last = sys.at(-1);
  const from30 = last ? new Date(Date.parse(last.date) - 29 * 86_400_000).toISOString().slice(0, 10) : "";
  const recent = sys.filter((m) => m.date >= from30);
  const weight = latestBody(measurements).weight;
  const b = weight ? bmi(weight.value, profile.heightCm) : undefined;

  const activeMeds = protocols.filter((p) => isActiveOn(p, today)).flatMap((p) =>
    p.plan ? p.plan.items.filter((i) => i.category === "medication").map((i) => i.label) : p.category === "medication" ? [p.label] : [],
  );
  const conditions = profile.conditions ?? "";
  const bpHistory = affirmativeHistory(conditions, /(blood pressure|hypertension).{0,30}(medicine|medication|tablet|pill|treat)\w*|antihypertensive/i);
  const diabetesHistory = affirmativeHistory(conditions, /\bdiabet(?:es|ic)\b/i);
  const bpMedicine = activeMeds.some((label) => affirmativeHistory(label, BP_MEDICINES) === true);
  const diabetesMedicine = activeMeds.some((label) => affirmativeHistory(label, DIABETES_MEDICINES) === true);
  const treatedBp = bpMedicine ? "habits" : bpHistory === true ? "profile" : "no";
  const diabetes = diabetesMedicine ? "habits" : diabetesHistory === true ? "profile" : "no";
  if (!bpMedicine && bpHistory === undefined) missing.push("confirmation of blood pressure treatment");
  if (!diabetesMedicine && diabetesHistory === undefined) missing.push("confirmation of diabetes");

  if (!profile.sex) missing.push("your sex");
  if (!profile.birthMonth) missing.push("your month and year of birth");
  if (!profile.heightCm) missing.push("your height");
  if (!weight) missing.push("a weight");
  if (!last) missing.push("a blood pressure reading");
  if (!profile.smoking) missing.push("whether you smoke");

  const from = { systolicReadings: recent.length, ...(last ? { systolicDate: last.date } : {}), ...(weight ? { bmiDate: weight.date } : {}), treatedBp, diabetes } as HeartAgeData["from"];
  if (missing.length || !last || !b || !profile.sex || !profile.birthMonth) return { missing, from };
  const age = ageAt(profile.birthMonth, today);
  const input: HeartAgeInput = {
    sex: profile.sex,
    age,
    systolic: recent.reduce((s, m) => s + m.value, 0) / recent.length,
    treatedBp: treatedBp !== "no",
    smoker: profile.smoking === "current",
    diabetes: diabetes !== "no",
    bmi: b,
  };
  const outOfRange = age < AGE_RANGE.min ? "young" : age >= AGE_RANGE.max + 1 ? "old" : undefined;
  return { input, missing, from, ...(outOfRange ? { outOfRange } : {}) };
}
