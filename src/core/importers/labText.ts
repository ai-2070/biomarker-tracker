import { isIsoDate } from "../dates";
import { normalizeUnit } from "../units";
import type { BiomarkerDef } from "../types";
import { parseLabNumber } from "./manual";

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

/**
 * A test name as the parser compares it: lower case, accents and OCR's dotless "ı" removed, runs of spaces
 * squeezed, and no space before "(" or "%" or after "(". So "Thrombocyta szam" matches "Thrombocyta szám",
 * and "Neutrophil (pero) %" matches "Neutrophil(pero)%". `at[i]` is the index in `name` of folded character i.
 */
export function foldLabName(name: string): { text: string; at: number[] } {
  const src = name.normalize("NFC");
  let text = "";
  const at: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      if (text !== "" && !text.endsWith(" ") && !text.endsWith("(")) {
        text += " ";
        at.push(i);
      }
      continue;
    }
    if ((c === "(" || c === "%") && text.endsWith(" ")) {
      text = text.slice(0, -1);
      at.pop();
    }
    const bare = c === "ı" ? "i" : c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    text += bare.length === 1 ? bare : c.toLowerCase().length === 1 ? c.toLowerCase() : c;
    at.push(i);
  }
  return { text, at };
}

function buildAliases(defs: readonly BiomarkerDef[]): AliasEntry[] {
  const out: AliasEntry[] = [];
  for (const d of defs) {
    for (const a of new Set([d.name, ...d.aliases].map((n) => foldLabName(n).text))) out.push({ alias: a, id: d.id });
  }
  // Longest first, so "LDL-Cholesterin" wins over "LDL".
  return out.sort((a, b) => b.alias.length - a.alias.length);
}

const LETTER = /\p{L}/u;
const RATIO_WORDS = /\b(ratio|quotient|index|arány|rapport|cociente|rapporto|verhältnis)\b/iu;
const FLAG_TOKEN = /^([HLN+\-*!↑↓]|\(?[HL]\)?|high|low|hoch|niedrig|magas|alacsony)$/i;

/** Strip list bullets, test codes and leading symbols (also OCR specks read as punctuation) from a line. */
function lineBody(line: string): string {
  return line.replace(/^[\s*•·\-–>,;:!'"‘’“”©]+/, "").replace(/^\d{2,6}\s+(?=\p{L})/u, "");
}

/**
 * Where the sample came from, printed before the test name: "Serum Kalium", "S-Kalium", "P-Glukose".
 * Blood specimens only. Urine ("Vizelet", "U-") is never stripped, so urine tests don't match blood markers.
 */
const BLOOD_SPECIMEN = /^(?:serum|szérum|szerum|plasma|plazma|vollblut|whole blood|blood|vér)(?=[\s.:-])[\s.:-]*|^(?:s|se|p|pl|fs|fp|b|fb)\s*-\s*(?=\p{L})/iu;

function matchAlias(body: string, aliases: readonly AliasEntry[]): { id: string; rest: string } | undefined {
  const folded = foldLabName(body);
  for (const { alias, id } of aliases) {
    if (!folded.text.startsWith(alias)) continue;
    const next = folded.text.charAt(alias.length);
    // "K" must not match "Kreatinin"; "Hb" must not match "HbA1c".
    if (next && LETTER.test(next)) continue;
    return { id, rest: body.normalize("NFC").slice(folded.at[alias.length] ?? body.length) };
  }
  const specimen = BLOOD_SPECIMEN.exec(body);
  return specimen && specimen[0].length < body.length ? matchAlias(body.slice(specimen[0].length), aliases) : undefined;
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
    .replace(/([<>]=?|[≤≥])\s+(?=\d)/g, "$1")
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

/**
 * A unit cut off by a narrow report column, "ml/min/1" for "mL/min/1.73m²": the units of `def` it is the start of,
 * when they all convert the same way. Only for printed units with a "/" and at least 6 characters, so short
 * fragments like "mg/" never guess between mg/L and mg/dL.
 */
export function truncatedUnit(def: BiomarkerDef, printed: string): string | undefined {
  const want = normalizeUnit(printed.replace(/^[([]|[)\].,]$/g, ""));
  if (want.length < 6 || !want.includes("/")) return undefined;
  const units = Object.keys(def.conversions).filter((u) => normalizeUnit(u).startsWith(want));
  if (units.length === 0) return undefined;
  const same = new Set(units.map((u) => JSON.stringify(def.conversions[u])));
  return same.size === 1 ? (units.includes(def.canonicalUnit) ? def.canonicalUnit : units[0]) : undefined;
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
  // Only a declared ratio marker may consume ratio-labelled results. Checked after the matched name, so a
  // marker whose own name says ratio ("Albumin/creatinine ratio") is allowed, but "Albumin/Globulin ratio" isn't albumin.
  if (RATIO_WORDS.test(rest) && def.canonicalUnit !== "ratio") return undefined;
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
    else {
      const cut = truncatedUnit(def, unitText);
      if (cut) {
        row.unit = cut;
        row.notes.push(`The unit "${unitText}" looks cut off; read as ${cut}.`);
      } else row.problems.push(`The unit "${unitText}" isn't one this app knows for ${def.name}. It may be a different test.`);
    }
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
  // "5 4 mmol/L" (a lost decimal point) or "8 140.0 mmol/L" (a speck read as a digit): which number is the
  // result can't be known, so the person checks it. Only one extra number, so "low high" range columns are left alone.
  const beforeUnit = unitIdx >= 0 ? after.slice(0, unitIdx).filter((t) => parseLabNumber(t) !== undefined) : [];
  if (beforeUnit.length === 1) {
    row.problems.push(`Two numbers were read before the unit ("${row.value} ${beforeUnit[0]}"). A decimal point may be missing, or a mark on the page was read as a digit. Check the value against the report.`);
  }
  const problem = decimalProblem(row);
  if (problem) row.problems.push(problem);
  return row;
}

/** How far outside the lab's own range a value can be before a lost decimal point is the likelier story. */
export const DECIMAL_SUSPICION = 8;

/**
 * A value 8 times above or below the lab's own range on the same line usually means a decimal point or
 * comma was lost (common in photos and scans: "5,4" read as "54"), or the range was misread. Real results
 * that far out are rare, and a wrong one saved silently could look critical. The person checks it.
 */
export function decimalProblem(row: Pick<ParsedRow, "value" | "labLow" | "labHigh">): string | undefined {
  const v = parseLabNumber(row.value.replace(/^[<>≤≥]/, ""))?.value;
  const lo = row.labLow ? parseLabNumber(row.labLow)?.value : undefined;
  const hi = row.labHigh ? parseLabNumber(row.labHigh)?.value : undefined;
  if (v === undefined || v <= 0) return undefined;
  const far = (hi !== undefined && hi > 0 && v > hi * DECIMAL_SUSPICION) || (lo !== undefined && lo > 0 && v < lo / DECIMAL_SUSPICION);
  return far ? "This value is far outside the lab's own range on the same line. A decimal point may have been missed, in the value or in the range. Check both against the report." : undefined;
}

// Dates

const BIRTH_WORDS = /birth|\bdob\b|geb\.|geburt|születés|szul\.|naissance|nacimiento|nascita/i;
const SAMPLE_WORDS =
  /collect|drawn|sampled|sample\s+(date|taken)|entnahme|abnahme|probenahme|mintavétel|mintavetel|vérvétel|prélèvement|prelevement|toma de muestra|extracción|prelievo/i;
const RECEIPT_WORDS = /receiv|receipt|report|release|eingang|beérkez/i;

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
  const collected: FoundDate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (BIRTH_WORDS.test(line)) continue;
    const here = findDate(line, monthFirst);
    const label = SAMPLE_WORDS.exec(line);
    if (label) {
      // Reports can put collection and receipt on the same line. Only the date after
      // the collection label, before the next event label, belongs to the blood draw.
      const after = line.slice(label.index + label[0].length);
      const receipt = RECEIPT_WORDS.exec(after);
      const collection = receipt ? after.slice(0, receipt.index) : after;
      const next = lines[i + 1];
      const d = findDate(collection, monthFirst)
        ?? (!receipt && next && !BIRTH_WORDS.test(next) && !RECEIPT_WORDS.test(next) ? findDate(next, monthFirst) : undefined);
      if (d) collected.push(d);
    }
    if (!fallback && here) fallback = { date: here.date, note: here.note ?? "No collection date was labelled; this is the first date in the report." };
  }
  if (collected.length) {
    const chosen = collected[0]!;
    return new Set(collected.map((d) => d.date)).size > 1
      ? { date: chosen.date, note: "Several collection dates were found. Check which blood draw these results belong to." }
      : chosen;
  }
  return fallback;
}

/** Blood tests named like a urine test: under a urine heading, "Kreatinin" is urine creatinine. */
const URINE_TWIN: Readonly<Record<string, string>> = { creatinine: "urine_creatinine", albumin: "urine_albumin" };

/** Percentages and absolute counts share bare names ("Lymphozyten"); the unit tells them apart. */
const UNIT_TWIN: Readonly<Record<string, string>> = Object.fromEntries(
  ["neutrophil", "lymphocyte", "monocyte", "eosinophil", "basophil"].flatMap((c) => [[`${c}_pct`, `${c}_abs`], [`${c}_abs`, `${c}_pct`]]),
);

/** One result line for the marker its name matched, moved to the twin marker that its heading or unit points to. */
function readRow(line: string, hit: { id: string; rest: string }, urine: boolean, byId: ReadonlyMap<string, BiomarkerDef>): ParsedRow | undefined {
  let id = hit.id;
  let movedToUrine = false;
  const twin = URINE_TWIN[id];
  if (urine && twin && byId.has(twin)) {
    id = twin;
    movedToUrine = true;
  }
  let row = parseResultLine(line, id, hit.rest, byId.get(id)!);
  const unitTwin = row && !row.unit && row.unitText ? byId.get(UNIT_TWIN[id] ?? "") : undefined;
  if (row && unitTwin && candidateUnits(unitTwin, row.unitText!).length > 0) {
    const other = parseResultLine(line, unitTwin.id, hit.rest, unitTwin);
    if (other?.unit) {
      other.notes.push(`Read as ${unitTwin.name} because of its unit, ${other.unitText}.`);
      row = other;
    }
  }
  if (!row) return undefined;
  if (movedToUrine) row.notes.unshift("Read as a urine test because it's listed under a urine heading.");
  else if (urine && byId.get(row.biomarkerId)!.category !== "Urine") {
    row.problems.push("This row is under a urine heading in the report, so it is probably a urine test, not a blood test. Tick it only if you're sure it's from blood.");
  }
  return row;
}

// Matched against folded headings (lower case, no accents).
const URINE_SECTION = /^(?:vizelet|urine|urinalysis|urin|harn|spontanurin|sammelurin)(?!\p{L})/u;
const BLOOD_SECTION = /^(?:verkep|verkemia|klinikai kemia|kemia|serum|szerum|plasma|blood|haematology|hematology|hematologia|blutbild|klinische chemie|chemistry|biochemistry)(?!\p{L})/u;

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
  let urine = false;
  for (const line of lines) {
    if (BIRTH_WORDS.test(line)) continue;
    const body = lineBody(line);
    // Section headings: rows under a urine heading are urine tests even when named like blood tests.
    if (!/\d/.test(body)) {
      const heading = foldLabName(body).text;
      if (URINE_SECTION.test(heading)) urine = true;
      else if (BLOOD_SECTION.test(heading)) urine = false;
    }
    const hit = matchAlias(body, aliases);
    if (!hit) {
      // Remember lines that look like "Name 12.3 unit" so the user knows what was skipped.
      if (/^\p{L}[\p{L}\s().,%-]{1,40}\s+[<>]?\d+(?:[.,]\d+)?\s+\S/u.test(body) && !findDate(body)) unmatched.push(line);
      continue;
    }
    const row = readRow(line, hit, urine, byId);
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
