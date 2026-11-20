import type { Question } from "@bt/shared/core/evidenceMap";

/** Any of these words or word starts in a title, any case. */
export const w = (...x: string[]) => new RegExp(`\\b(${x.join("|")})`, "i");
/** Any of these in the title or abstract (Europe PMC syntax; phrases quoted). */
export const any = (...x: string[]) => `(${x.map((p) => `TITLE_ABS:${/[\s-]/.test(p) ? `"${p}"` : p}`).join(" OR ")})`;
export const all = (...groups: string[]) => groups.join(" AND ");
export const q = (population: string, intervention: string, comparison: string, outcome: string): Question => ({
  population,
  intervention,
  comparison,
  outcome,
});

export const GENERAL = "Adults in general (not a group defined by one illness, such as people in hospital or with cancer)";
export const DEATH = any("mortality", "death", "deaths");
export const CVD = any("cardiovascular", "coronary", "heart disease", "stroke", "myocardial infarction");
