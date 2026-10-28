/**
 * Phenotypic Age (PhenoAge), Levine et al. 2018, Aging 10(4):573–591, PMID 29676998.
 *
 * Verified on 2026-10-28 against:
 *  - the paper's Table 1 (Europe PMC full text, PMC5940111): all 10 weights;
 *  - BioAge R package (dayoonkwon/BioAge, R/phenoage_calc.R, `orig = TRUE`):
 *    same weights at full precision, same Gompertz and age-conversion constants;
 *  - pyaging (docs/development/phenoage-gompertz-correction.md): reference
 *    values for log hazards −12, −9, −6, evaluated independently in R.
 *    Note: biolearn's hematology.py uses an RDW weight of 0.3356 (typo) and
 *    should not be used as a reference.
 *
 * Weights are the published values (Table 1 / supplement Table S1), so results
 * match other calculators built from the paper.
 */

/** Biomarker ids (knowledge base) needed from one blood draw. */
export const PHENOAGE_MARKERS = [
  "albumin",
  "creatinine",
  "glucose",
  "crp_hs",
  "lymphocyte_pct",
  "mcv",
  "rdw",
  "alp",
  "wbc",
] as const;

export type PhenoAgeMarker = (typeof PHENOAGE_MARKERS)[number];

/** Inputs in the app's canonical units. CRP is converted to mg/dL inside. */
export interface PhenoAgeInputs {
  albumin: number; // g/L
  creatinine: number; // µmol/L
  glucose: number; // mmol/L
  crp_hs: number; // mg/L (app canonical); the model uses ln(mg/dL)
  lymphocyte_pct: number; // %
  mcv: number; // fL
  rdw: number; // %
  alp: number; // U/L
  wbc: number; // 10^9/L = 1000 cells/µL
  age: number; // years
}

const INTERCEPT = -19.907;
const WEIGHTS: Record<keyof PhenoAgeInputs, number> = {
  albumin: -0.0336,
  creatinine: 0.0095,
  glucose: 0.1953,
  crp_hs: 0.0954, // applied to ln(CRP in mg/dL)
  lymphocyte_pct: -0.012,
  mcv: 0.0268,
  rdw: 0.3306,
  alp: 0.00188,
  wbc: 0.0554,
  age: 0.0804,
};

const GAMMA = 0.0076927;
const AGE_INTERCEPT = 141.50225;
const AGE_SCALE = 0.00553;
const AGE_RATE = 0.090165;

/** The model was trained on adults; below this age the result is not shown. */
export const PHENOAGE_MIN_AGE = 20;

/** Linear predictor of the Gompertz mortality model. */
export function phenoAgeLogHazard(i: PhenoAgeInputs): number {
  if (!(i.crp_hs > 0)) throw new RangeError("CRP must be above 0 to take its logarithm");
  const crpMgDl = i.crp_hs / 10;
  return (
    INTERCEPT +
    WEIGHTS.albumin * i.albumin +
    WEIGHTS.creatinine * i.creatinine +
    WEIGHTS.glucose * i.glucose +
    WEIGHTS.crp_hs * Math.log(crpMgDl) +
    WEIGHTS.lymphocyte_pct * i.lymphocyte_pct +
    WEIGHTS.mcv * i.mcv +
    WEIGHTS.rdw * i.rdw +
    WEIGHTS.alp * i.alp +
    WEIGHTS.wbc * i.wbc +
    WEIGHTS.age * i.age
  );
}

/** 10-year (120-month) mortality score from the Gompertz model. */
export function mortalityScore(xb: number): number {
  return -Math.expm1((-Math.exp(xb) * Math.expm1(120 * GAMMA)) / GAMMA);
}

/**
 * PhenoAge from the log hazard. Algebraically equal to the paper's
 * `141.50225 + ln(-0.00553 * ln(1 - M)) / 0.090165`, but computed without
 * going through M, which rounds to exactly 1 for very high hazards.
 */
export function phenoAgeFromLogHazard(xb: number): number {
  return AGE_INTERCEPT + (xb + Math.log((AGE_SCALE * Math.expm1(120 * GAMMA)) / GAMMA)) / AGE_RATE;
}

export function phenoAge(i: PhenoAgeInputs): number {
  return phenoAgeFromLogHazard(phenoAgeLogHazard(i));
}
