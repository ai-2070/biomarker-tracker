import type { Sex, Smoking } from "./types";

/** Fitted coefficients, never hand-assigned health weights. Lifetime transport is a separate assumption. */
export const MORTALITY_FEATURES = ["age10", "male", "age10_male", "body_fat10", "body_fat10_sq", "body_fat10_male", "waist_height10", "waist_height10_sq", "smoking_former", "smoking_current", "activity_log", "pheno_gap10"] as const;
export type MortalityFeature = (typeof MORTALITY_FEATURES)[number];
export type MortalityInputKey = "age" | "sex" | "smoking" | "bodyFat" | "waistToHeight" | "activityWeekly" | "phenoAgeGap";
export interface MortalityInputs {
  age?: number;
  sex?: Sex;
  smoking?: Smoking;
  bodyFat?: number;
  waistToHeight?: number;
  /** Actual minutes/week of moderate-or-harder leisure exercise in sessions of at least ten minutes; vigorous counted once. */
  activityWeekly?: number;
  phenoAgeGap?: number;
}
export interface CoxFit {
  /** Cumulative baseline hazard at ten years, at this fit's centering values. */
  baselineHazard10: number;
  terms: { feature: MortalityFeature; mean: number; coefficient: number }[];
}
export interface MortalityEvaluation {
  trainingPeople: number;
  trainingDeaths: number;
  testPeople: number;
  testDeaths: number;
  testDescription: string;
  auc: number;
  brier: number;
  baselineAuc: number;
  baselineBrier: number;
  weightedObservedRisk10: number;
  weightedMeanPredictedRisk10: number;
  baselineWeightedMeanPredictedRisk10: number;
  /** Prespecified holdout gate; not a claim of external or lifetime validation. */
  accepted: boolean;
}
export interface FittedMortalityModel {
  id: string;
  label: string;
  /** Selection priority among independently fitted models with all required inputs present. */
  priority: number;
  required: MortalityInputKey[];
  ageFrom: number;
  ageTo: number;
  ranges: Partial<Record<Exclude<MortalityInputKey, "sex" | "smoking">, [number, number]>>;
  /** One fit per DXA imputation, or a single fit when DXA is not a predictor. Risks are pooled. */
  fits: CoxFit[];
  /** Age/sex-only model on the same development participants, for risk-equivalent age. */
  comparison: CoxFit;
  evaluation: MortalityEvaluation;
}
export interface MortalityModelFile {
  version: string;
  fittedOn: string;
  horizonYears: 10;
  method: string;
  sources: { url: string; sha256: string; bytes: number }[];
  limitations: string[];
  unavailableInputs: string[];
  models: FittedMortalityModel[];
}
export interface MortalityPrediction {
  status: "ok" | "unavailable";
  model?: FittedMortalityModel;
  risk10?: number;
  /** Bounded ages are not extrapolated into an exact lifespan date. */
  riskAge?: number;
  riskAgeBound?: "below" | "above";
  reasons: string[];
}

/** Transform definitions are shared by app inference and the local cohort-training bridge. */
export function mortalityDesign(input: MortalityInputs): Partial<Record<MortalityFeature, number>> {
  const out: Partial<Record<MortalityFeature, number>> = {};
  if (input.age !== undefined && Number.isFinite(input.age)) out.age10 = (input.age - 50) / 10;
  if (input.sex === "m" || input.sex === "f") out.male = input.sex === "m" ? 1 : 0;
  if (out.age10 !== undefined && out.male !== undefined) out.age10_male = out.age10 * out.male;
  if (input.bodyFat !== undefined && Number.isFinite(input.bodyFat)) {
    out.body_fat10 = (input.bodyFat - 30) / 10;
    out.body_fat10_sq = out.body_fat10 ** 2;
    if (out.male !== undefined) out.body_fat10_male = out.body_fat10 * out.male;
  }
  if (input.waistToHeight !== undefined && Number.isFinite(input.waistToHeight)) {
    out.waist_height10 = (input.waistToHeight - 0.5) / 0.1;
    out.waist_height10_sq = out.waist_height10 ** 2;
  }
  if (input.smoking === "never" || input.smoking === "former" || input.smoking === "current") {
    out.smoking_former = input.smoking === "former" ? 1 : 0;
    out.smoking_current = input.smoking === "current" ? 1 : 0;
  }
  if (input.activityWeekly !== undefined && Number.isFinite(input.activityWeekly) && input.activityWeekly >= 0) out.activity_log = Math.log1p(input.activityWeekly / 150);
  if (input.phenoAgeGap !== undefined && Number.isFinite(input.phenoAgeGap)) out.pheno_gap10 = input.phenoAgeGap / 10;
  return out;
}

function logCumulativeHazard(fit: CoxFit, design: Partial<Record<MortalityFeature, number>>): number {
  let value = Math.log(fit.baselineHazard10);
  for (const term of fit.terms) {
    const x = design[term.feature];
    if (x === undefined || !Number.isFinite(x)) throw new RangeError(`Missing fitted-model feature: ${term.feature}`);
    value += term.coefficient * (x - term.mean);
  }
  return value;
}

/** Same centered Cox equation as the fitter, pooled on probability rather than on coefficients. */
export function coxRisk10(fits: readonly CoxFit[], input: MortalityInputs): number {
  if (fits.length === 0) throw new RangeError("A mortality model needs a fitted coefficient set");
  const design = mortalityDesign(input);
  let sum = 0;
  for (const fit of fits) sum += -Math.expm1(-Math.exp(logCumulativeHazard(fit, design)));
  return sum / fits.length;
}

/** Invert only the fitted age/sex comparison, not a mixture of incompatible 'biological ages'. */
export function mortalityRiskAge(comparison: CoxFit, risk10: number, sex: Sex): number {
  if (!(risk10 > 0 && risk10 < 1)) return risk10 === 0 ? -Infinity : Infinity;
  const male = sex === "m" ? 1 : 0;
  let slope = 0;
  let offset = 0;
  for (const term of comparison.terms) {
    if (term.feature === "age10") {
      slope += term.coefficient;
      offset -= term.coefficient * term.mean;
    } else if (term.feature === "male") {
      offset += term.coefficient * (male - term.mean);
    } else if (term.feature === "age10_male") {
      slope += term.coefficient * male;
      offset -= term.coefficient * term.mean;
    } else throw new RangeError("The risk-age reference must use age and sex only");
  }
  if (!(slope > 0)) throw new RangeError("The risk-age reference must increase with age");
  const target = Math.log(-Math.log1p(-risk10)) - Math.log(comparison.baselineHazard10);
  return 50 + 10 * (target - offset) / slope;
}

const INPUT_LABELS: Record<MortalityInputKey, string> = {
  age: "Age", sex: "Sex", smoking: "Smoking status", bodyFat: "Body-fat percentage", waistToHeight: "Waist-to-height ratio",
  activityWeekly: "Matching leisure-exercise minutes", phenoAgeGap: "A complete recent PhenoAge blood test",
};

/** Missing data is not a normal value. Choose only a model actually fitted with the available inputs. */
export function predictMortality(file: MortalityModelFile, input: MortalityInputs): MortalityPrediction {
  const models = [...file.models].sort((a, b) => b.priority - a.priority);
  let firstReasons: string[] = [];
  for (const model of models) {
    if (!model.evaluation.accepted) continue;
    const reasons: string[] = [];
    for (const key of model.required) {
      const value = input[key];
      if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) reasons.push(`${INPUT_LABELS[key]} is missing.`);
      else if (key === "sex" && value !== "m" && value !== "f") reasons.push("Sex is not supported by this fitted model.");
      else if (key === "smoking" && value !== "never" && value !== "former" && value !== "current") reasons.push("Smoking status is not supported by this fitted model.");
      else if (typeof value === "number") {
        const bounds = model.ranges[key as Exclude<MortalityInputKey, "sex" | "smoking">];
        if (key !== "age" && !bounds) reasons.push(`${INPUT_LABELS[key]} has no development support range; this fitted model cannot be used.`);
        else if (bounds && (value < bounds[0] || value > bounds[1])) reasons.push(`${INPUT_LABELS[key]} is outside this model's development range.`);
      }
    }
    if (input.age !== undefined && (input.age < model.ageFrom || input.age >= model.ageTo)) reasons.push(`This model covers ages ${model.ageFrom}–${model.ageTo - 1}.`);
    if (reasons.length && (firstReasons.length === 0 || reasons.length < firstReasons.length)) firstReasons = reasons;
    if (reasons.length) continue;
    const risk10 = coxRisk10(model.fits, input);
    const riskAge = mortalityRiskAge(model.comparison, risk10, input.sex!);
    const riskAgeBound = riskAge < model.ageFrom ? "below" : riskAge >= model.ageTo ? "above" : undefined;
    return { status: "ok", model, risk10, ...(Number.isFinite(riskAge) ? { riskAge } : {}), ...(riskAgeBound ? { riskAgeBound } : {}), reasons: riskAgeBound ? ["The fitted risk is beyond the age range of its comparison; no exact lifespan date is extrapolated."] : [] };
  }
  return { status: "unavailable", reasons: firstReasons.length ? firstReasons : ["No fitted model has passed the held-out evaluation gate."] };
}

/** Validate a bundled/developer-generated artifact before using its numerical parameters. */
export function validateMortalityModels(value: unknown): string[] {
  const file = value as Partial<MortalityModelFile> | null;
  if (!file || typeof file !== "object" || Array.isArray(file)) return ["No mortality model file"];
  const errors: string[] = [];
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const keys: readonly string[] = ["age", "sex", "smoking", "bodyFat", "waistToHeight", "activityWeekly", "phenoAgeGap"];
  if (typeof file.version !== "string" || !file.version.trim() || file.horizonYears !== 10 || typeof file.fittedOn !== "string") errors.push("Invalid model version or horizon");
  if (typeof file.method !== "string" || !file.method.trim()) errors.push("Missing fitting method");
  if (!Array.isArray(file.limitations) || !file.limitations.length || file.limitations.some((v) => typeof v !== "string")) errors.push("Missing model limitations");
  if (!Array.isArray(file.unavailableInputs) || file.unavailableInputs.some((v) => typeof v !== "string")) errors.push("Invalid unsupported-input list");
  if (!Array.isArray(file.sources) || !file.sources.length || file.sources.some((s) => !s || typeof s.url !== "string" || !s.url.startsWith("https://") || typeof s.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(s.sha256) || !Number.isSafeInteger(s.bytes) || s.bytes <= 0)) errors.push("Invalid cohort provenance");
  const checkFit = (fit: CoxFit | undefined, reference: boolean) => {
    if (!fit || !finite(fit.baselineHazard10) || !(fit.baselineHazard10 > 0) || !Array.isArray(fit.terms) || !fit.terms.length) {
      errors.push("Invalid fitted hazard");
      return;
    }
    const terms = new Set<MortalityFeature>();
    for (const term of fit.terms) {
      if (!term || !MORTALITY_FEATURES.includes(term.feature) || !finite(term.mean) || !finite(term.coefficient) || terms.has(term.feature)) errors.push("Invalid or duplicate fitted term");
      else terms.add(term.feature);
      if (reference && term && !["age10", "male", "age10_male"].includes(term.feature)) errors.push("Comparison model must use age and sex only");
    }
    if (reference) {
      if (!terms.has("age10") || !terms.has("male") || !terms.has("age10_male")) errors.push("Incomplete age/sex comparison");
      const age = fit.terms.find((t) => t?.feature === "age10")?.coefficient ?? NaN;
      const interaction = fit.terms.find((t) => t?.feature === "age10_male")?.coefficient ?? NaN;
      if (!(age > 0 && age + interaction > 0)) errors.push("Reference mortality must increase with age for both sexes");
    }
  };
  if (!Array.isArray(file.models) || !file.models.length) return [...errors, "No fitted models"];
  const ids = new Set<string>();
  for (const model of file.models) {
    if (!model || typeof model !== "object") { errors.push("Invalid model"); continue; }
    if (typeof model.id !== "string" || !model.id || ids.has(model.id) || typeof model.label !== "string" || !finite(model.priority)) errors.push("Invalid or duplicate model identity");
    ids.add(model.id);
    if (!finite(model.ageFrom) || !finite(model.ageTo) || model.ageFrom < 20 || model.ageTo <= model.ageFrom) errors.push("Invalid model age domain");
    if (!Array.isArray(model.required) || !["age", "sex", "smoking"].every((key) => model.required.includes(key as MortalityInputKey)) || model.required.some((key) => !keys.includes(key)) || new Set(model.required).size !== model.required.length) errors.push("Invalid model input contract");
    if (!model.ranges || typeof model.ranges !== "object" || Array.isArray(model.ranges)) errors.push("Missing predictor support ranges");
    else for (const [key, bounds] of Object.entries(model.ranges)) {
      if (!keys.includes(key) || key === "sex" || key === "smoking" || !Array.isArray(bounds) || bounds.length !== 2 || !bounds.every(finite) || bounds[0] > bounds[1]) errors.push("Invalid predictor support range");
    }
    if (Array.isArray(model.required) && model.required.some((key) => key !== "age" && key !== "sex" && key !== "smoking" && !model.ranges?.[key])) errors.push("Missing development predictor range");
    if (!Array.isArray(model.fits) || ![1, 5].includes(model.fits.length)) errors.push("Expected one fit or five separate imputation fits");
    else for (const fit of model.fits) checkFit(fit, false);
    if (Array.isArray(model.required) && Array.isArray(model.fits)) {
      const sample: MortalityInputs = { age: 50, sex: "f", smoking: "never", bodyFat: 30, waistToHeight: 0.5, activityWeekly: 0, phenoAgeGap: 0 };
      const available = Object.keys(mortalityDesign(Object.fromEntries(model.required.map((key) => [key, sample[key]])) as MortalityInputs));
      for (const fit of model.fits) if (Array.isArray(fit?.terms) && (fit.terms.length !== available.length || available.some((key) => !fit.terms.some((term) => term?.feature === key)))) errors.push("Fitted terms do not match declared inputs");
    }
    checkFit(model.comparison, true);
    const e = model.evaluation;
    if (!e || ![e.auc, e.brier, e.baselineAuc, e.baselineBrier, e.weightedObservedRisk10, e.weightedMeanPredictedRisk10, e.baselineWeightedMeanPredictedRisk10].every((v) => finite(v) && v >= 0 && v <= 1) || ![e.trainingPeople, e.trainingDeaths, e.testPeople, e.testDeaths].every((v) => Number.isSafeInteger(v) && v > 0) || e.trainingDeaths > e.trainingPeople || e.testDeaths >= e.testPeople || typeof e.testDescription !== "string" || e.accepted !== (e.brier < e.baselineBrier && e.auc >= e.baselineAuc)) errors.push("Invalid held-out evaluation or acceptance gate");
  }
  return errors;
}
