import { isIsoDate } from "../dates";
import type { BiomarkerDef } from "../types";
import { listUnits, matchUnit, toCanonical } from "../units";
import { candidateUnits, decimalProblem, type ParsedReport, type ParsedRow } from "./labText";
import { parseLabNumber, plausibilityWarnings } from "./manual";

/**
 * Results Brain read from photos or scanned pages and proposes for saving (`propose_results`). The model only
 * copies what is printed; this code matches units, turns durations into numbers and flags anything doubtful.
 * The result is the same report the lab text reader produces, so the person checks it in the same review
 * card before anything is saved. Checked on the server and again in the page.
 */

export interface ProposedResult {
  /** The app's marker id. */
  marker: string;
  /** The result's line as printed, shown on the review card. */
  printed?: string;
  /** As printed: "5,4", "<0.3", "8,120", "7 h 12 min". */
  value: string;
  unit?: string;
  rangeLow?: string;
  rangeHigh?: string;
}

export interface ResultProposal {
  /** Sample or measurement date printed on the picture, YYYY-MM-DD. */
  date?: string;
  results: ProposedResult[];
}

export const MAX_PROPOSED_RESULTS = 80;
const MAX_TEXT = 300;

/** "7 h 12 min", "7h 12m", "7 hr", "45 min", "1:35" → hours. */
export function durationHours(s: string): number | undefined {
  let m = /(?<![\d.,])(\d{1,2}(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|ó|óra|std)\.?\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:m|min|mins|minutes?|p|perc)\b/i.exec(s);
  if (m) return Number(m[1]!.replace(",", ".")) + Number(m[2]!.replace(",", ".")) / 60;
  m = /(?<![\d.,])(\d{1,2}(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|ó|óra|std)\b/i.exec(s);
  if (m) return Number(m[1]!.replace(",", "."));
  m = /(?<![\d.,])(\d{1,3}(?:[.,]\d+)?)\s*(?:m|min|mins|minutes?)\b/i.exec(s);
  if (m) return Number(m[1]!.replace(",", ".")) / 60;
  m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  return undefined;
}

/** How phone apps write units that the knowledge files spell shorter. */
const SPELLINGS: Record<string, string> = { lbs: "lb", hrs: "h", hours: "h", hour: "h", mins: "min", minutes: "min", "beats/min": "bpm" };

const text = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** A duration written with words ("7 h 12 min") as a number in the marker's canonical unit, hours or minutes. */
function durationValue(def: BiomarkerDef, value: string): { value: string; unit: string } | undefined {
  if (!/[a-zóä:]/i.test(value) || (def.canonicalUnit !== "h" && def.canonicalUnit !== "min")) return undefined;
  const hours = durationHours(value);
  if (hours === undefined) return undefined;
  return def.canonicalUnit === "h" ? { value: String(round(hours, 2)), unit: "h" } : { value: String(Math.round(hours * 60)), unit: "min" };
}

function row(def: BiomarkerDef, r: ProposedResult): ParsedRow {
  const problems: string[] = [];
  const notes: string[] = [];
  let value = r.value;
  let unit: string | undefined;
  const duration = durationValue(def, value);
  if (duration) {
    ({ value, unit } = duration);
  } else {
    // Whole counts with a thousands separator ("8,120 steps"): never a decimal comma.
    if (def.canonicalUnit === "steps" && /^\d{1,3}(?:[,.\s]\d{3})+$/.test(value)) value = value.replace(/[,.\s]/g, "");
    if (r.unit) {
      const spelled = SPELLINGS[r.unit.trim().toLowerCase()] ?? r.unit;
      unit = matchUnit(def, spelled) ?? candidateUnits(def, spelled)[0];
      if (!unit) problems.push(`The unit "${r.unit}" isn't one this app can convert for ${def.name}. Choose the unit printed on the report.`);
    } else if (listUnits(def).length === 1) {
      unit = def.canonicalUnit;
      notes.push(`No unit was read; ${unit} is the only unit for this marker.`);
    } else {
      problems.push("No unit was read. Choose the unit printed on the report.");
    }
  }
  const number = parseLabNumber(value);
  if (!number) problems.push("This isn't a number the app can read. Check the value.");
  for (const [name, bound] of [["start", r.rangeLow], ["end", r.rangeHigh]] as const) {
    if (bound !== undefined && !parseLabNumber(bound)) problems.push(`The range ${name} "${bound}" isn't a number. Check the range.`);
  }
  const parsed: ParsedRow = {
    line: r.printed ?? [r.marker, r.value, r.unit, r.rangeLow !== undefined || r.rangeHigh !== undefined ? `${r.rangeLow ?? ""}-${r.rangeHigh ?? ""}` : undefined].filter(Boolean).join(" "),
    biomarkerId: def.id,
    value,
    ...(unit ? { unit } : {}),
    ...(r.unit ? { unitText: r.unit } : {}),
    ...(r.rangeLow !== undefined ? { labLow: r.rangeLow } : {}),
    ...(r.rangeHigh !== undefined ? { labHigh: r.rangeHigh } : {}),
    problems,
    notes,
  };
  const decimal = decimalProblem(parsed);
  if (decimal) problems.push(decimal);
  if (number && unit && problems.length === 0) problems.push(...plausibilityWarnings(def, toCanonical(def, number.value, unit), unit));
  return parsed;
}

/** Checks a proposal (the model's tool input, or the server's checked copy in the page) and builds the review report. */
export function parseResultProposal(
  input: unknown,
  defs: ReadonlyMap<string, BiomarkerDef>,
  today: string,
): { ok: true; proposal: ResultProposal; report: ParsedReport; unknownMarkers: string[] } | { ok: false; error: string } {
  const o = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  if (!Array.isArray(o.results) || o.results.length === 0) return { ok: false, error: "Give at least one result read from the picture." };
  if (o.results.length > MAX_PROPOSED_RESULTS) return { ok: false, error: `At most ${MAX_PROPOSED_RESULTS} results in one card.` };
  const results: ProposedResult[] = [];
  for (const item of o.results) {
    const r = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const marker = text(r.marker, 60);
    const value = text(r.value, 40);
    if (!marker || !value) return { ok: false, error: "Every result needs a marker and a value." };
    const printed = text(r.printed);
    const unit = text(r.unit, 40);
    const rangeLow = text(r.rangeLow, 40);
    const rangeHigh = text(r.rangeHigh, 40);
    results.push({ marker, value, ...(printed ? { printed } : {}), ...(unit ? { unit } : {}), ...(rangeLow ? { rangeLow } : {}), ...(rangeHigh ? { rangeHigh } : {}) });
  }
  const date = text(o.date, 10);
  const proposal: ResultProposal = { ...(date ? { date } : {}), results };

  const rows: ParsedRow[] = [];
  const unmatched: string[] = [];
  const unknownMarkers: string[] = [];
  for (const r of results) {
    const def = defs.get(r.marker);
    if (!def) {
      unknownMarkers.push(r.marker);
      unmatched.push(r.printed ?? `${r.marker} ${r.value} ${r.unit ?? ""}`.trim());
      continue;
    }
    rows.push(row(def, r));
  }
  if (rows.length === 0) return { ok: false, error: `None of these are markers the app tracks (${unknownMarkers.join(", ")}). Use the app's marker ids.` };

  const report: ParsedReport = { rows, unmatched };
  const body = proposalKind(report, defs) === "body";
  if (date && isIsoDate(date) && date <= today) report.date = date;
  else if (date) report.dateNote = `The date read from the picture (${date}) isn't a valid past date. Enter the date${body ? " measured" : " of the test"}.`;
  else if (body) {
    // Phone screens rarely print the date; today is the likely one, and the card asks to check it.
    report.date = today;
    report.dateNote = "No date was read from the picture, so today's date is filled in. Check it.";
  }
  return { ok: true, proposal, report, unknownMarkers };
}

/** "body" when every result is a body measurement (review wording, no lab range fields). */
export function proposalKind(report: ParsedReport, defs: ReadonlyMap<string, BiomarkerDef>): "lab" | "body" {
  return report.rows.every((r) => defs.get(r.biomarkerId)?.category === "Body") ? "body" : "lab";
}
