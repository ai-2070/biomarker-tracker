import { citationErrors, findingErrors, type NutrientFinding, PRESCRIBING } from "./nutrients";
import type { Citation } from "./types";

/**
 * What has moved the aging clocks in people (/knowledge/clocks/interventions.json), shown on the
 * Biological age page: trials and studies that measured PhenoAge, DunedinPACE or other clocks, graded
 * like any finding. The clocks are stand-ins: nobody has shown that lowering them lengthens life, and the
 * file's caveat says so.
 */

/** "PhenoAge" is the blood-test formula the app calculates; "DNAm PhenoAge" the DNA methylation clock trained on it. */
export const CLOCKS = ["PhenoAge", "DNAm PhenoAge", "DunedinPACE", "GrimAge", "Horvath", "Hannum", "other"] as const;
export type ClockName = (typeof CLOCKS)[number];

/** A page in the app a finding is about: a supplement, a whole food or a lifestyle topic. */
export interface ClockAbout {
  kind: "nutrient" | "wholefood" | "lifestyle";
  id: string;
}

export interface ClockFinding extends NutrientFinding {
  clocks: ClockName[];
  about?: ClockAbout[];
}

export interface ClockFile {
  intro: string;
  caveat: string;
  findings: ClockFinding[];
  sources: Citation[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Problems with the clocks file; empty means valid. */
export function validateClockFile(v: unknown): string[] {
  if (!isObj(v)) return ["file is not an object"];
  const errs: string[] = [];
  if (!isStr(v.intro) || !isStr(v.caveat)) errs.push("intro and caveat are required");
  if (!Array.isArray(v.findings) || v.findings.length === 0) errs.push("findings needs at least one finding");
  else {
    errs.push(...findingErrors(v.findings, "finding"));
    (v.findings as unknown[]).forEach((f, i) => {
      if (!isObj(f)) return;
      const at = `finding ${i + 1}`;
      if (!Array.isArray(f.clocks) || f.clocks.length === 0 || !f.clocks.every((c) => CLOCKS.includes(c as ClockName)))
        errs.push(`${at} clocks must be from ${CLOCKS.join(", ")}`);
      if (!isStr(f.label) || !isStr(f.line)) errs.push(`${at} needs a label and a line`);
      if (
        f.about !== undefined &&
        !(
          Array.isArray(f.about) && f.about.every((a) => isObj(a) && (a.kind === "nutrient" || a.kind === "wholefood" || a.kind === "lifestyle") && isStr(a.id))
        )
      )
        errs.push(`${at} about must be a list of { kind, id }`);
    });
  }
  errs.push(...citationErrors(v.sources, "sources"));
  return errs;
}

/** Every piece of text, for the wording check (no personal instructions). */
export function clockText(f: ClockFile): string[] {
  return [
    f.intro,
    f.caveat,
    ...f.findings.flatMap((x) => [x.outcome, x.population, x.summary, x.bottomLine ?? "", x.label ?? "", x.line ?? "", ...x.whyThisGrade]),
  ];
}

export const clockPrescribes = (f: ClockFile): string[] => clockText(f).filter((t) => PRESCRIBING.test(t));

/** The clock findings about one page of the app (omega-3, olive oil, walking…). */
export function clockFindingsAbout(f: ClockFile | undefined, kind: ClockAbout["kind"], id: string): ClockFinding[] {
  return f ? f.findings.filter((x) => x.about?.some((a) => a.kind === kind && a.id === id)) : [];
}
