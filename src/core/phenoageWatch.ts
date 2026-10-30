import { summarizePhenoAge } from "./phenoageDraws";
import type { BiomarkerDef, Measurement } from "./types";

/**
 * "PhenoAge gap" for habit watches: PhenoAge minus calendar age at each blood test with all 9 markers.
 * PhenoAge itself rises a year every year, so the gap is what a habit could change. Never stored: it is
 * worked out from the person's results whenever a watch is compared, and compared as a plain difference
 * in years against the spread of their own earlier gaps (`changeScale: "difference"`).
 */
export const PHENOAGE_GAP_ID = "phenoage_gap";

export const PHENOAGE_GAP_DEF: BiomarkerDef = {
  id: PHENOAGE_GAP_ID,
  name: "PhenoAge gap",
  category: "Aging",
  aliases: [],
  canonicalUnit: "years",
  conversions: { years: 1 },
  changeScale: "difference",
  summary: "Your PhenoAge minus your calendar age at each complete blood test. Below zero means your blood markers looked like those of a typical younger person in the study the formula came from.",
  high: { meaning: "Higher than your age.", commonCauses: [] },
  low: { meaning: "Lower than your age.", commonCauses: [] },
  affectedBy: [],
  sources: [{ pmid: "29676998", title: "An epigenetic biomarker of aging for lifespan and healthspan", year: 2018, studyType: "observational" }],
};

/** One gap value per complete blood test (dated by the test), for comparing before and after a habit. */
export function phenoAgeGaps(measurements: readonly Measurement[], birthMonth: string | undefined): Measurement[] {
  return summarizePhenoAge(measurements, birthMonth).draws.flatMap((d) =>
    d.status === "ok" && d.difference !== undefined
      ? [{ id: `phenoage-gap-${d.date}`, biomarkerId: PHENOAGE_GAP_ID, value: d.difference, originalValue: d.difference, originalUnit: "years", date: d.date, source: "manual" as const, note: "Worked out from this blood test" }]
      : [],
  );
}

/** The person's results plus their PhenoAge gaps, and the marker list with the gap in it, for habit watches. */
export function withPhenoAgeGap(measurements: readonly Measurement[], birthMonth: string | undefined, defs: ReadonlyMap<string, BiomarkerDef>) {
  const gaps = phenoAgeGaps(measurements, birthMonth);
  return { measurements: gaps.length ? [...measurements, ...gaps] : measurements, defs: new Map([...defs, [PHENOAGE_GAP_ID, PHENOAGE_GAP_DEF]]) as ReadonlyMap<string, BiomarkerDef>, hasGap: gaps.length > 0 };
}
