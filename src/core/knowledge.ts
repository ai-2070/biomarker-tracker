import { normalizeUnit } from "./units";
import type { BiomarkerDef, Conversion } from "./types";

const STUDY_TYPES = new Set([
  "meta-analysis",
  "rct",
  "observational",
  "animal",
  "in vitro",
  "review",
  "guideline",
]);

const CATEGORIES = new Set([
  "Blood count",
  "Metabolic",
  "Lipids",
  "Kidney",
  "Liver",
  "Thyroid",
  "Iron & vitamins",
  "Electrolytes",
  "Inflammation",
  "Body",
]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isConversion(v: unknown): v is Conversion {
  if (isNum(v)) return v > 0;
  return isObj(v) && isNum(v.factor) && v.factor > 0 && isNum(v.offset);
}

/** Returns a list of problems; an empty list means the entry is valid. */
export function validateBiomarkerDef(v: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(v)) return ["entry is not an object"];

  if (!isNonEmptyStr(v.id) || !/^[a-z0-9_]+$/.test(v.id)) errs.push("id must be lowercase snake_case");
  if (!isNonEmptyStr(v.name)) errs.push("name is required");
  if (!isNonEmptyStr(v.category) || !CATEGORIES.has(v.category)) errs.push("category is invalid");
  if (!Array.isArray(v.aliases) || v.aliases.length === 0 || !v.aliases.every(isNonEmptyStr)) {
    errs.push("aliases must be a non-empty list of strings");
  }
  if (!isNonEmptyStr(v.summary)) errs.push("summary is required");

  for (const side of ["high", "low"] as const) {
    const s = v[side];
    if (!isObj(s) || !isNonEmptyStr(s.meaning) || !Array.isArray(s.commonCauses) || !s.commonCauses.every(isNonEmptyStr)) {
      errs.push(`${side} must have a meaning and a list of common causes`);
    }
  }

  // Units
  if (!isNonEmptyStr(v.canonicalUnit)) errs.push("canonicalUnit is required");
  if (!isObj(v.conversions)) {
    errs.push("conversions must be an object");
  } else {
    const entries = Object.entries(v.conversions);
    if (!entries.every(([, c]) => isConversion(c))) errs.push("every conversion must be a positive factor or {factor, offset}");
    if (isNonEmptyStr(v.canonicalUnit) && v.conversions[v.canonicalUnit] !== 1) {
      errs.push("the canonical unit must have conversion factor 1");
    }
    const normalized = entries.map(([u]) => normalizeUnit(u));
    if (new Set(normalized).size !== normalized.length) errs.push("two units normalise to the same spelling");
  }

  // Ranges
  if (v.defaultRanges !== undefined) {
    if (!Array.isArray(v.defaultRanges)) errs.push("defaultRanges must be a list");
    else {
      for (const r of v.defaultRanges) {
        if (!isObj(r) || (r.low === undefined && r.high === undefined)) errs.push("each range needs low or high");
        else if (isNum(r.low) && isNum(r.high) && r.low >= r.high) errs.push("range low must be below high");
        else if (isObj(r) && r.sex !== undefined && r.sex !== "m" && r.sex !== "f") errs.push("range sex must be m or f");
      }
    }
  }
  if (v.criticalRange !== undefined && !isObj(v.criticalRange)) errs.push("criticalRange must be an object");

  // Biological variation (optional)
  if (v.biologicalVariation !== undefined) {
    const bv = v.biologicalVariation;
    if (!isObj(bv) || !isNum(bv.cvi) || bv.cvi <= 0 || bv.cvi > 200) errs.push("biologicalVariation.cvi must be a percentage above 0");
    else if (!isNum(bv.ciLow) || !isNum(bv.ciHigh) || bv.ciLow > bv.cvi || bv.ciHigh < bv.cvi) errs.push("biologicalVariation CI must contain the CVI");
    else if (!isNum(bv.studies) || bv.studies < 1 || !isNonEmptyStr(bv.source) || !isNonEmptyStr(bv.url)) errs.push("biologicalVariation needs studies, source and url");
  }

  // Evidence and sources
  if (!Array.isArray(v.affectedBy)) errs.push("affectedBy must be a list (can be empty)");
  if (!Array.isArray(v.sources) || v.sources.length === 0) {
    errs.push("at least one source is required");
  } else {
    v.sources.forEach((s, i) => {
      if (!isObj(s)) return errs.push(`source ${i + 1} is not an object`);
      if (!isNonEmptyStr(s.title)) errs.push(`source ${i + 1} needs a title`);
      if (!isNum(s.year)) errs.push(`source ${i + 1} needs a year`);
      if (!isNonEmptyStr(s.studyType) || !STUDY_TYPES.has(s.studyType)) errs.push(`source ${i + 1} has an invalid studyType`);
      if (!isNonEmptyStr(s.pmid) && !isNonEmptyStr(s.doi)) errs.push(`source ${i + 1} needs a pmid or doi`);
      if (s.pmid !== undefined && !/^\d+$/.test(String(s.pmid))) errs.push(`source ${i + 1} pmid must be digits`);
    });
  }
  return errs;
}

export function isBiomarkerDef(v: unknown): v is BiomarkerDef {
  return validateBiomarkerDef(v).length === 0;
}
