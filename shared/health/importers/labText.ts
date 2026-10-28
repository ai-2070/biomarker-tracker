import { isIsoDate } from "../dates.ts";
import { normalizeUnit } from "../units.ts";
import type { BiomarkerDef } from "../types.ts";
import { parseLabNumber } from "./manual.ts";

/**
 * Generic lab-report parser. Works on plain text (from a PDF or pasted), one
 * result per line, in the common "name  value  unit  range" layout.
 * It only proposes rows; the user confirms every one on the review screen.
 */

export interface ParsedRow {
  /** The report line this came from, shown so the user can check it. */
  line: string;
  biomarkerId: string;
  /** As printed, e.g. "5,4" or "<0.3". */
  value: string;
  /** Unit as spelled in the knowledge file, when recognised. */
  unit?: string;
  /** Unit text as printed, when found. */
  unitText?: string;
  /** Lab range as printed, in the same unit as the value. */
  labLow?: string;
  labHigh?: string;
  /** Things the user must fix before this row can be saved. */
  problems: string[];
  /** Things worth knowing that don't block saving. */
  notes: string[];
}

export interface ParsedReport {
  rows: ParsedRow[];
  /** Sample date, ISO, if one was found. */
  date?: string;
  /** Why the date may be wrong, e.g. day/month order unclear. */
  dateNote?: string;
  /** Lines that looked like results but matched no marker. */
  unmatched: string[];
}

interface AliasEntry {
  alias: string;
  id: string;
}

function buildAliases(defs: readonly BiomarkerDef[]): AliasEntry[] {
  const out: AliasEntry[] = [];
  for (const d of defs) {
    for (const a of new Set([d.name, ...d.aliases])) out.push({ alias: a.toLowerCase(), id: d.id });
  }
  // Longest first, so "LDL-Cholesterin" wins over "LDL".
  return out.sort((a, b) => b.alias.length - a.alias.length);
}

const LETTER = /\p{L}/u;
const RATIO_WORDS = /\b(ratio|quotient|index|arány|rapport|cociente|rapporto|verhältnis)\b/iu;
const FLAG_TOKEN = /^([HLN+\-*!↑↓]|\(?[HL]\)?|high|low|hoch|niedrig|magas|alacsony)$/i;

/** Strip list bullets, test codes and leading symbols from a line. */
function lineBody(line: string): string {
  return line.replace(/^[\s*•·\-–>]+/, "").replace(/^\d{2,6}\s+(?=\p{L})/u, "");
}

function matchAlias(body: string, aliases: readonly AliasEntry[]): { id: string; rest: string } | undefined {
  const lower = body.toLowerCase();
  for (const { alias, id } of aliases) {
    if (!lower.startsWith(alias)) continue;
    const next = body.charAt(alias.length);
    // "K" must not match "Kreatinin"; "Hb" must not match "HbA1c".
    if (next && LETTER.test(next)) continue;
    return { id, rest: body.slice(alias.length) };
  }
  return undefined;
}

/** Split a numeric token from a unit or flag glued to it: "5.4mmol/L", "142H". */
function splitGlued(token: string): string[] {
  // Powers of ten are units, not a number glued to a unit: "10^9/L", "10*9/L", "10⁹/L".
  if (/^10(\^|\*|e|[⁰-⁹])/i.test(token)) return [token];
  const m = /^([<>≤≥]?\d+(?:[.,]\d+)*)([^\d.,].*)$/.exec(token);
  if (!m) return [token];
  const tail = m[2]!;
  if (/^[HL*!↑↓]+$/i.test(tail)) return [m[1]!];
  // Only split off something that starts like a unit. "25-Hydroxy" stays one word.
  if (!/^[\p{L}µμ%/]/u.test(tail)) return [token];
  return [m[1]!, tail];
}

function tokenize(text: string): string[] {
  return text
    .replace(/([<>≤≥])\s+(?=\d)/g, "$1")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(splitGlued);
}

/** Units of `def` that a printed unit could mean. "mg/dL" matches both urea units. */
export function candidateUnits(def: BiomarkerDef, printed: string): string[] {
  const want = normalizeUnit(printed.replace(/^[([]|[)\]]$/g, ""));
  if (!want) return [];
  const exact = Object.keys(def.conversions).filter((u) => normalizeUnit(u) === want);
  if (exact.length > 0) return exact;
  return Object.keys(def.conversions).filter((u) => normalizeUnit(u.replace(/\s*\(.*\)$/, "")) === want);
}

/** Pick between same-looking units when the test name says which one is meant. */
function unitHint(id: string, line: string, units: string[]): string | undefined {
  if (id === "urea") {
    const bun = /\bBUN\b|nitrogen|harnstoff-n\b/i.test(line);
    return units.find((u) => (bun ? /BUN/.test(u) : /urea/.test(u)));
  }
  return undefined;
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const RANGE_BOTH = new RegExp(String.raw`(${NUM})\s*(?:-|–|—|\.\.\.?|bis|to|a)\s*(${NUM})`, "i");
const RANGE_HIGH = new RegExp(String.raw`(?:<|≤|<=|bis|up to|unter|alatt)\s*(${NUM})`, "i");
const RANGE_LOW = new RegExp(String.raw`(?:>|≥|>=|über|above|felett)\s*(${NUM})`, "i");

function parseRange(text: string): { low?: string; high?: string } {
  const both = RANGE_BOTH.exec(text);
  if (both) return { low: both[1], high: both[2] };
  const high = RANGE_HIGH.exec(text);
  if (high) return { high: high[1] };
  const low = RANGE_LOW.exec(text);
  if (low) return { low: low[1] };
  return {};
}

function parseResultLine(line: string, id: string, rest: string, def: BiomarkerDef): ParsedRow | undefined {
  if (RATIO_WORDS.test(line)) return undefined;
  const tokens = tokenize(rest);

  const valueIdx = tokens.findIndex((t) => parseLabNumber(t) !== undefined);
  if (valueIdx < 0) return undefined;
  // Too much text between name and value means it's probably not a result line.
  const between = tokens.slice(0, valueIdx).join(" ");
  if (between.replace(/[():,*\s]/g, "").length > 25) return undefined;

  const row: ParsedRow = { line, biomarkerId: id, value: tokens[valueIdx]!, problems: [], notes: [] };
  const after = tokens.slice(valueIdx + 1);

  // Unit: first token after the value (or before it) that looks like a unit.
  const unitish = (t: string) => !FLAG_TOKEN.test(t) && parseLabNumber(t) === undefined && /[\p{L}%µμ/^]/u.test(t);
  const unitIdx = after.findIndex(unitish);
  let unitText = unitIdx >= 0 ? after[unitIdx] : tokens.slice(0, valueIdx).find((t) => candidateUnits(def, t).length > 0);
  // Units printed with a space inside, e.g. "mL/min/1.73 m²". The longer reading wins.
  if (unitText && unitIdx >= 0 && after[unitIdx + 1]) {
    const joined = unitText + after[unitIdx + 1];
    if (candidateUnits(def, joined).length > 0) unitText = joined;
  }

  if (unitText) {
    row.unitText = unitText;
    const units = candidateUnits(def, unitText);
    const hinted = units.length > 1 ? unitHint(id, line, units) : undefined;
    if (units.length === 1) row.unit = units[0];
    else if (hinted) {
      row.unit = hinted;
      row.notes.push(`Read as ${hinted} based on the test name.`);
    } else if (units.length > 1) row.problems.push(`"${unitText}" could mean ${units.join(" or ")}. Choose the right one.`);
    else row.problems.push(`The unit "${unitText}" isn't one this app knows for ${def.name}. It may be a different test.`);
  } else if (Object.keys(def.conversions).length === 1) {
    row.unit = def.canonicalUnit;
    row.notes.push(`No unit printed; assumed ${def.canonicalUnit}.`);
  } else {
    row.problems.push("No unit found. Choose the unit from your report.");
  }

  const rangeText = after.slice(unitIdx >= 0 ? unitIdx + 1 : 0).join(" ");
  const range = parseRange(rangeText);
  if (range.low) row.labLow = range.low;
  if (range.high) row.labHigh = range.high;
  return row;
}

// Dates

const BIRTH_WORDS = /birth|\bdob\b|geb\.|geburt|születés|szul\.|naissance|nacimiento|nascita/i;
const SAMPLE_WORDS =
  /collect|sample|specimen|drawn|entnahme|abnahme|probenahme|mintavétel|mintavetel|vérvétel|prélèvement|prelevement|toma de muestra|extracción|prelievo/i;

interface FoundDate {
  date: string;
  note?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(y: number, m: number, d: number): string | undefined {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isIsoDate(iso) ? iso : undefined;
}

/**
 * Find the first date in a line, in the formats labs commonly print.
 * Slash dates like 05/12/2024 are ambiguous; `monthFirst` decides (US style).
 */
export function findDate(line: string, monthFirst = false): FoundDate | undefined {
  let m = /\b(\d{4})[-.](\d{1,2})[-.](\d{1,2})\.?/.exec(line); // 2024-05-12, 2024.05.12.
  if (m) {
    const iso = toIso(+m[1]!, +m[2]!, +m[3]!);
    if (iso) return { date: iso };
  }
  m = /\b(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/.exec(line); // 12.05.2024 (day first)
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    const iso = toIso(y, +m[2]!, +m[1]!);
    if (iso) return { date: iso };
  }
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(line); // 05/12/2024: order unclear
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = +m[3]!;
    if (a > 12) return toIso(y, b, a) ? { date: toIso(y, b, a)! } : undefined;
    if (b > 12) return toIso(y, a, b) ? { date: toIso(y, a, b)! } : undefined;
    const iso = monthFirst ? toIso(y, a, b) : toIso(y, b, a);
    const order = monthFirst ? "month/day" : "day/month";
    if (iso) return { date: iso, note: `The report says ${m[0]}, which was read as ${order}. Check that this is right.` };
  }
  return undefined;
}

/** The sample date: prefer lines that mention collection; never use birth dates. */
function findSampleDate(lines: readonly string[], monthFirst: boolean): FoundDate | undefined {
  let fallback: FoundDate | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (BIRTH_WORDS.test(line)) continue;
    const here = findDate(line, monthFirst);
    if (SAMPLE_WORDS.test(line)) {
      // The date can also be on the next line, under the label.
      const next = lines[i + 1];
      const d = here ?? (next && !BIRTH_WORDS.test(next) ? findDate(next, monthFirst) : undefined);
      if (d) return d;
    }
    if (!fallback && here) fallback = { date: here.date, note: here.note ?? "No collection date was labelled; this is the first date in the report." };
  }
  return fallback;
}

export interface ParseOptions {
  /** Read 05/12/2024 as May 12 (US style). Default: day first. */
  monthFirst?: boolean;
}

export function parseLabText(text: string, defs: readonly BiomarkerDef[], options: ParseOptions = {}): ParsedReport {
  const aliases = buildAliases(defs);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const rows: ParsedRow[] = [];
  const unmatched: string[] = [];
  for (const line of lines) {
    if (BIRTH_WORDS.test(line)) continue;
    const body = lineBody(line);
    const hit = matchAlias(body, aliases);
    if (!hit) {
      // Remember lines that look like "Name 12.3 unit" so the user knows what was skipped.
      if (/^\p{L}[\p{L}\s().,-]{1,40}\s+[<>]?\d+(?:[.,]\d+)?\s+\S/u.test(body) && !findDate(body)) unmatched.push(line);
      continue;
    }
    const row = parseResultLine(line, hit.id, hit.rest, byId.get(hit.id)!);
    if (row) rows.push(row);
  }

  const date = findSampleDate(lines, options.monthFirst ?? false);
  const report: ParsedReport = { rows, unmatched };
  if (date) {
    report.date = date.date;
    if (date.note) report.dateNote = date.note;
  }
  return report;
}
