import { dayNumber, isIsoDate } from "./dates.ts";
import { PHENOAGE_MARKERS, PHENOAGE_MIN_AGE, phenoAge, type PhenoAgeInputs, type PhenoAgeMarker } from "./phenoage.ts";
import type { Measurement } from "./types.ts";

const BIRTH_MONTH = /^(\d{4})-(\d{2})$/;

export function isBirthMonth(s: string): boolean {
  const m = BIRTH_MONTH.exec(s);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1900;
}

/**
 * Age in years on a given date, from birth year and month only.
 * Assumes the 15th of the month, so the error is at most about half a month.
 */
export function ageAt(birthMonth: string, date: string): number {
  if (!isBirthMonth(birthMonth)) throw new Error(`Not a birth month: ${birthMonth}`);
  return (dayNumber(date) - dayNumber(`${birthMonth}-15`)) / 365.25;
}

export type DrawStatus = "ok" | "needs-birth-month" | "too-young" | "crp-zero";

export interface PhenoAgeDraw {
  date: string;
  /** The measurement used for each marker. */
  used: Record<PhenoAgeMarker, Measurement>;
  status: DrawStatus;
  age?: number;
  phenoAge?: number;
  /** PhenoAge minus age. Negative = "younger" than calendar age. */
  difference?: number;
  /** Inputs the lab reported as "<x" or ">x"; the limit value was used. */
  approximate: { biomarkerId: PhenoAgeMarker; qualifier: "<" | ">" }[];
}

export interface PhenoAgeSummary {
  /** Blood draws that have all 9 markers, oldest first. */
  draws: PhenoAgeDraw[];
  /**
   * The most recent draw date that has some, but not all, of the markers,
   * if it is newer than the latest complete draw.
   */
  latestPartial?: { date: string; missing: PhenoAgeMarker[] };
}

const isPhenoMarker = (id: string): id is PhenoAgeMarker => (PHENOAGE_MARKERS as readonly string[]).includes(id);

/**
 * Find blood draws with all 9 PhenoAge markers on the same date and compute
 * PhenoAge for each. Values from different dates are never mixed.
 */
export function summarizePhenoAge(measurements: readonly Measurement[], birthMonth?: string): PhenoAgeSummary {
  const byDate = new Map<string, Partial<Record<PhenoAgeMarker, Measurement>>>();
  for (const m of measurements) {
    if (!isPhenoMarker(m.biomarkerId) || !isIsoDate(m.date)) continue;
    const day = byDate.get(m.date) ?? {};
    // Two results for the same marker on one day: the later entry wins.
    day[m.biomarkerId] = m;
    byDate.set(m.date, day);
  }

  const dates = [...byDate.keys()].sort();
  const draws: PhenoAgeDraw[] = [];
  for (const date of dates) {
    const day = byDate.get(date)!;
    if (PHENOAGE_MARKERS.every((k) => day[k])) {
      draws.push(computeDraw(date, day as Record<PhenoAgeMarker, Measurement>, birthMonth));
    }
  }

  const summary: PhenoAgeSummary = { draws };
  const lastDate = dates[dates.length - 1];
  const lastComplete = draws[draws.length - 1]?.date;
  if (lastDate && lastDate !== lastComplete) {
    const day = byDate.get(lastDate)!;
    summary.latestPartial = { date: lastDate, missing: PHENOAGE_MARKERS.filter((k) => !day[k]) };
  }
  return summary;
}

function computeDraw(date: string, used: Record<PhenoAgeMarker, Measurement>, birthMonth?: string): PhenoAgeDraw {
  const approximate = PHENOAGE_MARKERS.flatMap((k) => {
    const q = used[k].qualifier;
    return q ? [{ biomarkerId: k, qualifier: q }] : [];
  });
  const draw: PhenoAgeDraw = { date, used, status: "ok", approximate };

  if (!birthMonth || !isBirthMonth(birthMonth)) return { ...draw, status: "needs-birth-month" };
  const age = ageAt(birthMonth, date);
  draw.age = age;
  if (age < PHENOAGE_MIN_AGE) return { ...draw, status: "too-young" };
  // ln(0) is undefined. A lab "<0.1" is stored as 0.1, so this only happens if 0 was typed.
  if (!(used.crp_hs.value > 0)) return { ...draw, status: "crp-zero" };

  const inputs: PhenoAgeInputs = {
    albumin: used.albumin.value,
    creatinine: used.creatinine.value,
    glucose: used.glucose.value,
    crp_hs: used.crp_hs.value,
    lymphocyte_pct: used.lymphocyte_pct.value,
    mcv: used.mcv.value,
    rdw: used.rdw.value,
    alp: used.alp.value,
    wbc: used.wbc.value,
    age,
  };
  const value = phenoAge(inputs);
  return { ...draw, phenoAge: value, difference: value - age };
}
