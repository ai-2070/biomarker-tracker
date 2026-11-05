import { PRESCRIBING, citationErrors, findingErrors, type NutrientFinding } from "./nutrients";
import type { Citation, SafetyId } from "./types";

/**
 * The lifestyle knowledge base (/knowledge/lifestyle/*.json), shown under Knowledge → Lifestyle:
 * walking, sauna, red light, sleep, cold water and more. Like the supplement entries (graded findings
 * from studies, cited, never a personal dose or instruction), plus visuals drawn from the studies' own
 * numbers: bar charts with confidence intervals, a light spectrum, step-by-step diagrams, ranges by age.
 * Every number in a visual comes from a cited source; the app draws it, it never invents one.
 */

export type LifestyleCategory = "movement" | "heat and cold" | "light" | "sleep" | "breathing and mind";
export const LIFESTYLE_CATEGORIES: readonly LifestyleCategory[] = ["movement", "heat and cold", "light", "sleep", "breathing and mind"];

/** Bars, each with an optional interval: hazard ratios against a reference group, or amounts. */
export interface BarsVisual {
  kind: "bars";
  title: string;
  /** Plain sentences: what the bars show and the main limit. */
  caption: string;
  /** "ratio": hazard/risk ratios drawn on a log scale around `reference` (1 = no difference). */
  scale: "ratio" | "linear";
  unit?: string;
  reference?: { value: number; label: string };
  items: { label: string; value: number; low?: number; high?: number; note?: string }[];
  sources: Citation[];
}

/** Part of the electromagnetic spectrum (nm), with named bands and marked wavelengths. */
export interface SpectrumVisual {
  kind: "spectrum";
  title: string;
  caption: string;
  /** Wavelength range drawn, in nanometres. */
  from: number;
  to: number;
  /** Named ranges: "Visible red", "Near-infrared (invisible)". */
  bands: { label: string; from: number; to: number }[];
  /** Marked wavelengths: device wavelengths, absorption peaks. */
  marks: { nm: number; label: string; group?: string }[];
  sources: Citation[];
}

/** A short chain of steps: what happens, in order (a mechanism, a response over minutes). */
export interface FlowVisual {
  kind: "flow";
  title: string;
  caption: string;
  steps: { label: string; text: string }[];
  sources: Citation[];
}

/** Ranges per group: hours of sleep by age, for example. */
export interface RangesVisual {
  kind: "ranges";
  title: string;
  caption: string;
  unit: string;
  rows: { label: string; low: number; high: number; note?: string }[];
  sources: Citation[];
}

export type LifestyleVisual = BarsVisual | SpectrumVisual | FlowVisual | RangesVisual;

export interface LifestyleDef {
  id: string;
  name: string;
  category: LifestyleCategory;
  otherNames: string[];
  /** Plain language, 1–3 sentences. */
  summary: string;
  /** How it's thought to work, short points; what's known and what isn't. */
  howItWorks: string[];
  /** What the studies actually had people do (describing trials, never advising): "Finnish men, 2–3 sessions a week at about 79 °C". */
  whatStudiesDid: string;
  /** Markers in this app it may move (for links): "steps", "bp_systolic", "sleep_duration"… */
  markers: string[];
  /** false when it isn't something you start or add to a protocol (sleep): the page links to the first marker's chart instead. */
  asHabit?: boolean;
  findings: NutrientFinding[];
  visuals: LifestyleVisual[];
  /** People who should be careful, or check with a doctor first. */
  whoShouldBeCareful: { with: string; note: string; safetyId?: SafetyId }[];
  cautions: string[];
  /** What isn't known yet, said plainly. */
  unknowns: string[];
  sources: Citation[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strList = (v: unknown, min = 0): boolean => Array.isArray(v) && v.length >= min && v.every(isStr);
const SAFETY_IDS = new Set(["anticoagulant", "antiplatelet", "diabetes", "pregnancy", "kidney"]);

export function visualErrors(v: unknown, at: string): string[] {
  if (!isObj(v)) return [`${at} is not an object`];
  const errs: string[] = [];
  if (!isStr(v.title) || !isStr(v.caption)) errs.push(`${at} needs a title and a caption`);
  errs.push(...citationErrors(v.sources, at));
  switch (v.kind) {
    case "bars": {
      if (v.scale !== "ratio" && v.scale !== "linear") errs.push(`${at} scale must be ratio or linear`);
      if (!Array.isArray(v.items) || v.items.length < 2) errs.push(`${at} needs at least 2 bars`);
      else
        for (const it of v.items as unknown[]) {
          if (!isObj(it) || !isStr(it.label) || !isNum(it.value)) errs.push(`${at}: every bar needs a label and a value`);
          else if ((it.low !== undefined && !(isNum(it.low) && it.low <= it.value)) || (it.high !== undefined && !(isNum(it.high) && it.high >= it.value))) errs.push(`${at}: an interval must contain its value`);
          else if (v.scale === "ratio" && !(it.value > 0 && (it.low === undefined || (it.low as number) > 0))) errs.push(`${at}: ratios must be above 0`);
        }
      break;
    }
    case "spectrum": {
      if (!isNum(v.from) || !isNum(v.to) || !(v.from < v.to) || v.from < 100 || v.to > 20000) errs.push(`${at} needs a wavelength range in nm`);
      if (!Array.isArray(v.bands) || !v.bands.every((b) => isObj(b) && isStr(b.label) && isNum(b.from) && isNum(b.to) && b.from < b.to)) errs.push(`${at}: bands need a label and a range`);
      if (!Array.isArray(v.marks) || !v.marks.every((m) => isObj(m) && isNum(m.nm) && isStr(m.label) && m.nm >= (v.from as number) && m.nm <= (v.to as number))) errs.push(`${at}: marks need a wavelength inside the range and a label`);
      break;
    }
    case "flow":
      if (!Array.isArray(v.steps) || v.steps.length < 2 || !v.steps.every((s) => isObj(s) && isStr(s.label) && isStr(s.text))) errs.push(`${at} needs at least 2 steps with a label and text`);
      break;
    case "ranges":
      if (!isStr(v.unit)) errs.push(`${at} needs a unit`);
      if (!Array.isArray(v.rows) || v.rows.length < 1 || !v.rows.every((r) => isObj(r) && isStr(r.label) && isNum(r.low) && isNum(r.high) && r.low <= r.high)) errs.push(`${at}: rows need a label and a range`);
      break;
    default:
      errs.push(`${at} kind must be bars, spectrum, flow or ranges`);
  }
  return errs;
}

/** Problems with a lifestyle file; empty means valid. */
export function validateLifestyleDef(v: unknown): string[] {
  if (!isObj(v)) return ["entry is not an object"];
  const errs: string[] = [];
  if (!isStr(v.id) || !/^[a-z0-9_]+$/.test(v.id)) errs.push("id must be lowercase_with_underscores");
  for (const k of ["name", "summary", "whatStudiesDid"] as const) if (!isStr(v[k])) errs.push(`${k} is required`);
  if (!LIFESTYLE_CATEGORIES.includes(v.category as LifestyleCategory)) errs.push(`category must be one of ${LIFESTYLE_CATEGORIES.join(", ")}`);
  if (!strList(v.otherNames)) errs.push("otherNames must be a list of strings");
  if (!strList(v.howItWorks, 1)) errs.push("howItWorks needs at least one point");
  if (!strList(v.markers)) errs.push("markers must be a list of marker ids");
  if (v.asHabit !== undefined && typeof v.asHabit !== "boolean") errs.push("asHabit must be true or false");
  if (v.asHabit === false && !(Array.isArray(v.markers) && v.markers.length > 0)) errs.push("an entry that isn't a habit needs a marker to link to");
  errs.push(...findingErrors(v.findings, "finding"));
  if (Array.isArray(v.findings) && v.findings.length === 0) errs.push("findings needs at least one finding");
  if (!Array.isArray(v.visuals) || v.visuals.length === 0) errs.push("visuals needs at least one visual");
  else (v.visuals as unknown[]).forEach((x, i) => errs.push(...visualErrors(x, `visual ${i + 1}`)));
  if (!Array.isArray(v.whoShouldBeCareful) || !v.whoShouldBeCareful.every((x) => isObj(x) && isStr(x.with) && isStr(x.note) && (x.safetyId === undefined || SAFETY_IDS.has(String(x.safetyId)))))
    errs.push("whoShouldBeCareful needs with and note (and a known safetyId, if any)");
  if (!strList(v.cautions)) errs.push("cautions must be a list of strings");
  if (!strList(v.unknowns, 1)) errs.push("unknowns needs at least one point: say what isn't known");
  errs.push(...citationErrors(v.sources, "sources"));
  return errs;
}

/** Every piece of text in a lifestyle file, for the wording check (no personal instructions). */
export function lifestyleText(l: LifestyleDef): string[] {
  return [
    l.summary,
    l.whatStudiesDid,
    ...l.howItWorks,
    ...l.findings.flatMap((f) => [f.outcome, f.population, f.summary, f.bottomLine ?? "", f.label ?? "", f.line ?? "", ...f.whyThisGrade]),
    ...l.visuals.flatMap((v) => [v.title, v.caption]),
    ...l.whoShouldBeCareful.flatMap((x) => [x.with, x.note]),
    ...l.cautions,
    ...l.unknowns,
  ];
}

/** Lifestyle entries' wording must not prescribe (the same check as supplements). */
export const prescribes = (l: LifestyleDef): string[] => lifestyleText(l).filter((t) => PRESCRIBING.test(t));

// ---- Drawing helpers for the visuals (positions and colours only; the numbers come from the files) ----

/**
 * The colour of light at a wavelength as people see it, as [r, g, b] 0–255, or undefined outside
 * 380–750 nm (ultraviolet and infrared are invisible). Dan Bruton's piecewise approximation, with
 * the eye's lower sensitivity at both ends.
 */
export function wavelengthRgb(nm: number): [number, number, number] | undefined {
  if (!(nm >= 380 && nm <= 750)) return undefined;
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm < 440) [r, b] = [(440 - nm) / 60, 1];
  else if (nm < 490) [g, b] = [(nm - 440) / 50, 1];
  else if (nm < 510) [g, b] = [1, (510 - nm) / 20];
  else if (nm < 580) [r, g] = [(nm - 510) / 70, 1];
  else if (nm < 645) [r, g] = [1, (645 - nm) / 65];
  else r = 1;
  const edge = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (750 - nm)) / 50 : 1;
  const c = (x: number) => Math.round(255 * Math.pow(x * edge, 0.8));
  return [c(r), c(g), c(b)];
}

/** Where a value sits across a scale, 0–1: logarithmic for ratios (so 0.5 and 2 are equally far from 1). */
export function scalePosition(value: number, min: number, max: number, log: boolean): number {
  const f = log ? (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (value - min) / (max - min);
  return Math.min(1, Math.max(0, f));
}

/** A scale that holds every value, interval and the reference line, with a little room at the ends. */
export function barsDomain(v: Pick<BarsVisual, "items" | "reference" | "scale">): { min: number; max: number } {
  const xs = v.items.flatMap((i) => [i.value, i.low ?? i.value, i.high ?? i.value]);
  if (v.reference) xs.push(v.reference.value);
  if (v.scale === "ratio") {
    const lo = Math.log(Math.min(...xs));
    const hi = Math.log(Math.max(...xs));
    const pad = Math.max((hi - lo) * 0.08, 0.05);
    return { min: Math.exp(lo - pad), max: Math.exp(hi + pad) };
  }
  const max = Math.max(...xs, 0);
  return { min: Math.min(0, ...xs), max: max * 1.08 || 1 };
}

/**
 * Rows for labels along an axis so they don't overlap: each position (0–1) goes in the first row whose
 * last label ends at least `gap` before it. Returns the row of each position, in the order given.
 */
export function labelRows(positions: readonly number[], gap: number): number[] {
  const order = positions.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const ends: number[] = [];
  const rows = new Array<number>(positions.length).fill(0);
  for (const [p, i] of order) {
    let row = ends.findIndex((end) => p - end >= gap);
    if (row === -1) row = ends.push(-Infinity) - 1;
    ends[row] = p;
    rows[i] = row;
  }
  return rows;
}

/** Rows for ranges (0–1 from/to) so none overlap: each goes in the first row whose last range ended before it starts. */
export function intervalRows(ranges: readonly { from: number; to: number }[], gap = 0): number[] {
  const order = ranges.map((r, i) => [r, i] as const).sort((a, b) => a[0].from - b[0].from);
  const ends: number[] = [];
  const rows = new Array<number>(ranges.length).fill(0);
  for (const [r, i] of order) {
    let row = ends.findIndex((end) => r.from >= end + gap);
    if (row === -1) row = ends.push(-Infinity) - 1;
    ends[row] = r.to;
    rows[i] = row;
  }
  return rows;
}

/** How to anchor a label at a position (0–1) so it stays inside the chart: left at the start, right at the end. */
export const labelAnchor = (f: number): "start" | "middle" | "end" => (f < 0.04 ? "start" : f > 0.96 ? "end" : "middle");
