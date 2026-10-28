import { PLAUSIBLE, SLEEP_FIELDS, type BodyField } from "../body";
import { isIsoDate } from "../dates";

/**
 * Reading export files from watches, rings and phone apps (Google Takeout Fit, Samsung Health,
 * Oura, Garmin reports, Apple Health). Everything here is pure: the page reads the file and shows a
 * review screen; nothing is saved without the person confirming.
 *
 * Values become one reading per day and measurement (the average of that day's readings), which is
 * what the charts and habit comparisons work with.
 */

// ---- CSV ------------------------------------------------------------------------------------------

/** Splits CSV text into rows. Handles quotes, a BOM, and comma, semicolon or tab separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const sep = counts.sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/**
 * Finds the header row and the data rows. Samsung Health puts a one-cell description line first,
 * and prefixes every column with the data type ("com.samsung.health.heart_rate.min"): both removed.
 */
export function tableOf(rows: string[][]): { headers: string[]; data: string[][] } | undefined {
  if (rows.length < 2) return undefined;
  let start = 0;
  if (rows[0]!.length < rows[1]!.length) start = 1;
  const raw = rows[start]!;
  const dotted = raw.filter((h) => /^[a-z_]+(\.[a-z_]+){2,}$/i.test(h));
  const headers = (dotted.length >= raw.length / 2 ? raw.map((h) => h.split(".").pop()!) : raw).map(normalizeHeader);
  return pivotLong({ headers, data: rows.slice(start + 1) });
}

/** "restingHeartRate", "resting_heart_rate" and "value.bpm" become "resting Heart Rate", "resting heart rate", "value bpm". */
export function normalizeHeader(h: string): string {
  return h
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The file's name without dates, long numbers and extension, used as context for vague column names
 * ("average_value" in "Daily SpO2 - 2024-01-01.csv") and to join daily files of one kind.
 */
export function fileFamily(path: string): string {
  return path
    .toLowerCase()
    .replace(/\.(csv|json|xml|txt)$/, "")
    .replace(/\d{4}-\d{2}-\d{2}(t[\d:.]+z?)?|\d{3,}/g, " ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Long" tables (one column names what was measured, another holds the value, as in Huawei and some
 * Samsung exports) become one column per measurement. Other tables are returned unchanged.
 */
export function pivotLong(t: { headers: string[]; data: string[][] }): { headers: string[]; data: string[][] } {
  // Also nested: Huawei's "samplePoints key" / "samplePoints value".
  const kindsIn = (col: number) => [...new Set(t.data.map((r) => r[col] ?? "").filter((k) => k && !/^-?[\d.]+$/.test(k)))];
  // The naming column holds words, not numbers (Huawei also has a numeric "type").
  const keyCol = t.headers.findIndex((h, i) => /(^|\s)(key|type|name|metric|data ?type|data ?name|data ?key)$/i.test(h) && kindsIn(i).length > 0);
  const valCol = t.headers.findIndex((h, i) => i !== keyCol && /(^|\s)(value|values|data ?value)$/i.test(h) && !/value value$/i.test(h));
  if (keyCol === -1 || valCol === -1) return t;
  const kinds = kindsIn(keyCol);
  if (kinds.length === 0 || kinds.length > 200) return t;
  const others = t.headers.map((_, i) => i).filter((i) => i !== keyCol && i !== valCol);
  const headers = [...others.map((i) => t.headers[i]!), ...kinds.map(normalizeHeader)];
  const data = t.data.map((r) => [...others.map((i) => r[i] ?? ""), ...kinds.map((k) => (r[keyCol] === k ? (r[valCol] ?? "") : ""))]);
  return { headers, data };
}

// ---- JSON -----------------------------------------------------------------------------------------

type J = Record<string, unknown>;
const isRec = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

function flatten(o: J, prefix: string, out: Record<string, string>): void {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix} ${k}` : k;
    if (isRec(v)) flatten(v, key, out);
    else if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[normalizeHeader(key)] = String(v);
  }
}

/**
 * A JSON export as a table: an array of records (or the first array of records inside an object),
 * nested fields flattened. Records holding a list of records (Huawei "samplePoints", Polar
 * "exercises") give one row per inner record, with the outer fields repeated.
 */
export function jsonTable(json: unknown): { headers: string[]; data: string[][] } | undefined {
  let items: unknown[] | undefined = Array.isArray(json) ? json : undefined;
  if (!items && isRec(json)) {
    // A wrapper ({ "data": [...] }) gives its list; a record with its own fields (a Polar session) is one item.
    const values = Object.values(json);
    const inner = values.find((v) => Array.isArray(v) && v.some(isRec));
    const ownFields = values.some((v) => typeof v === "string" || typeof v === "number");
    items = inner && !ownFields ? (inner as unknown[]) : [json];
  }
  if (!items) return undefined;
  const rows: Record<string, string>[] = [];
  for (const it of items) {
    if (!isRec(it)) continue;
    const listKey = Object.keys(it).find((k) => Array.isArray(it[k]) && (it[k] as unknown[]).some(isRec));
    const outer: Record<string, string> = {};
    flatten(Object.fromEntries(Object.entries(it).filter(([k]) => k !== listKey)), "", outer);
    if (listKey) for (const inner of (it[listKey] as unknown[]).filter(isRec)) {
      const row = { ...outer };
      flatten(inner, listKey, row);
      rows.push(row);
    }
    else rows.push(outer);
  }
  if (rows.length === 0) return undefined;
  const headers = [...new Set(rows.slice(0, 500).flatMap((r) => Object.keys(r)))];
  return pivotLong({ headers, data: rows.map((r) => headers.map((h) => r[h] ?? "")) });
}

// ---- Columns --------------------------------------------------------------------------------------

export interface ColumnGuess {
  index: number;
  header: string;
  /** Null: recognised but not imported (see `reason`). */
  field: BodyField | null;
  /** Unit of the values in the file. */
  unit: string;
  /** Multiply file values by this (e.g. 0.97 → 97 % for blood oxygen). */
  scale?: number;
  reason?: string;
}

const DATE_HEADER = /^(date|day|time|timestamp|start ?time|start ?date|start|datum|dátum|calendar date|summary date|recorded at|start time)$|(^|\s)(date|day)(\s|$)|start ?time/i;

/** Which column holds the date: a header that says so, else the first column whose values look like dates. */
export function findDateColumn(headers: string[], sample: string[][], monthFirst = false): number {
  const byName = headers.findIndex((h) => DATE_HEADER.test(h.trim()));
  if (byName !== -1) return byName;
  return headers.findIndex((_, i) => sample.slice(0, 5).filter((r) => toIsoDate(r[i] ?? "", monthFirst)).length >= Math.min(3, sample.length));
}

/**
 * Recognises a value column from its name, and for vague names ("value", "average_value") from the
 * file's name (`family`, see fileFamily). Max, min, zones, counts and multi-day averages are skipped.
 */
export function guessColumn(header: string, index: number, family = ""): ColumnGuess | undefined {
  const h = normalizeHeader(header).toLowerCase();
  const f = family.toLowerCase();
  const base = { index, header };
  const skip = (reason: string): ColumnGuess => ({ ...base, field: null, unit: "", reason });
  const health = /heart|\bhr\b|hrv|rmssd|pulse|weight|oxygen|spo2|saturation/;
  if (/\bsdnn\b/.test(h)) return skip("HRV as SDNN (Apple's measure), not RMSSD: the two can't be mixed.");
  const sleep = sleepColumn(h, f, base);
  if (sleep !== "not sleep") return sleep;
  // VO₂max ("VO2 Max", Garmin's "vO2MaxValue", Fitbit's "demographic_vo2_max"); not ranks, ages or levels.
  if (/vo2/.test(h.replace(/₂/g, "2").replace(/[\s_.]/g, ""))) {
    if (/percent|rank|age|category|level|status|range|precise|classification|error|confidence/.test(h)) return undefined;
    return { ...base, field: "vo2max", unit: "mL/kg/min" };
  }
  if (/\b(seven|weekly|week|monthly|month|baseline|last \d+ days?)\b/.test(h) && health.test(h)) return skip("An average over several days, not one day's value.");
  if (/\b(max|maximum|min|minimum|peak|lowest|highest|zone|zones|count|calories|kcal|steps|distance|duration|seconds|minutes|confidence|error|lower bound|upper bound)\b/.test(h) && (health.test(h) || health.test(f)))
    return skip("Not a daily average (a minimum, maximum, zone or count).");

  // Vague names: the file says what they are.
  const vague = /^(value|values|avg|average|mean|average value|value value|value bpm|bpm|daily value|data|rmssd|heart rate|heartrate|avg heart rate|average heart rate|average hr|avg hr|hr)$/.test(h);
  if (vague) {
    if (/spo2|oxygen|saturation/.test(f) && !/heart/.test(h)) return { ...base, field: "spo2", unit: "%" };
    if (/variability|\bhrv\b/.test(f) || h === "rmssd") return { ...base, field: /summary|daily|sleep|night/.test(f) ? "hrv_resting" : "hrv", unit: "ms" };
    if (/resting/.test(f)) return { ...base, field: "resting_hr", unit: "bpm" };
    if (/workout|sport|training|exercise|activit/.test(f) && /heart|hr|bpm|avg|average/.test(h)) return { ...base, field: "exercise_hr", unit: "bpm" };
    if (/(^|\s|\/)bp(\s|\/|$)|blood ?pressure/.test(f) && /heart|hr|bpm/.test(h)) return { ...base, field: "resting_hr", unit: "bpm" };
    if (/heart ?rate|heartrate|(^|\s)hr(\s|$)/.test(f) || /heart|bpm|hr/.test(h)) return { ...base, field: "heart_rate", unit: "bpm" };
    if (/weight/.test(f)) return { ...base, field: "weight", unit: "kg" };
    return undefined;
  }
  if (/^fat$/.test(h) && /weight|body/.test(f)) return { ...base, field: "body_fat", unit: "%" };

  if (/hrv|rmssd|heart rate variability/.test(h)) return { ...base, field: /rest|night|sleep|overnight|nightly|morning/.test(h) || /sleep|night|cycle|recovery|readiness/.test(f) ? "hrv_resting" : "hrv", unit: "ms" };
  if (/rest(ing)?\b.*(heart|hr|pulse)|(heart|hr|pulse).*resting|ruhepuls/.test(h)) return { ...base, field: "resting_hr", unit: "bpm" };
  if (/spo2|oxygen|saturation|sauerstoff/.test(h)) return { ...base, field: "spo2", unit: "%" };
  if (/(exercise|exercises|workout|activity|training|sport).*(heart|hr\b)|(heart|hr).*(exercise|workout)/.test(h)) return { ...base, field: "exercise_hr", unit: "bpm" };
  if (/heart ?rate|^hr$|\bbpm\b|^pulse$|^puls$/.test(h)) {
    if (/workout|sport|training|exercise/.test(f)) return { ...base, field: "exercise_hr", unit: "bpm" };
    if (/(^|\s|\/)bp(\s|\/|$)|blood ?pressure/.test(f)) return { ...base, field: "resting_hr", unit: "bpm" };
    return { ...base, field: "heart_rate", unit: "bpm" };
  }
  if (/systolic/.test(h)) return { ...base, field: "bp_systolic", unit: "mmHg" };
  if (/diastolic/.test(h)) return { ...base, field: "bp_diastolic", unit: "mmHg" };
  if (/body ?fat|fat ?percent|fat ?ratio|fat ?rate/.test(h)) return { ...base, field: "body_fat", unit: "%" };
  if (/waist/.test(h)) return { ...base, field: "waist", unit: /\bin(ch|ches)?\b/.test(h) ? "in" : "cm" };
  if (/glucose|blood sugar/.test(h)) return { ...base, field: "glucose_home", unit: /mg/.test(h) ? "mg/dL" : "mmol/L" };
  if (/weight|body ?mass|gewicht|súly/.test(h) && !/lean|muscle|bone|water|skeletal/.test(h)) return { ...base, field: "weight", unit: /\blbs?\b|pound/.test(h) ? "lb" : "kg" };
  return undefined;
}

// ---- Sleep ----------------------------------------------------------------------------------------

/** The unit a sleep column's header names; "auto" when it doesn't (decided from the values, see sleepUnit). */
function sleepUnitOf(h: string): string {
  if (/\(min\)|\bmins?\b|\bminutes\b/.test(h)) return "min";
  if (/\(h\)|\bhrs?\b|\bhours?\b/.test(h)) return "h";
  if (/\(s\)|\bsecs?\b|\bseconds\b/.test(h)) return "s";
  return "auto";
}

/** A night's sleep in hours, minutes or seconds, from the size of the numbers (7.4, 444 or 26640). */
export function sleepUnit(values: readonly number[]): "h" | "min" | "s" {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return median > 1000 ? "s" : median > 24 ? "min" : "h";
}

/**
 * Sleep columns: total time asleep, deep and REM. Light sleep is only used to add up a total when a
 * file has stages but no total (see withSleepTotal). Companies' sleep scores aren't imported.
 * "not sleep" lets other rules look at the column.
 */
function sleepColumn(h: string, f: string, base: { index: number; header: string }): ColumnGuess | undefined | "not sleep" {
  const inSleepFile = /sleep/.test(f);
  if (!/sleep|asleep|\bsws\b|\brem/.test(h) && !(inSleepFile && /\bdeep\b|\blight\b|shallow|\brem|total/.test(h))) return "not sleep";
  // Fitbit's per-stage summary of older logs repeats the total ("levels summary asleep minutes").
  if (/summary (asleep|restless|awake)/.test(h)) return undefined;
  // Heart rate, HRV, breathing or temperature during sleep: handled by the other rules.
  if (/heart|hrv|rmssd|\bhr\b|spo2|oxygen|breath|respirat|temperature|temp\b/.test(h)) return "not sleep";
  if (/score|performance|quality|index/.test(h)) return { ...base, field: null, unit: "", reason: "A company's own sleep score, not a measurement." };
  if (/efficiency|latency|fall asleep|in bed|awake|wake|need|debt|consistency|disturbance|regularity|restless|onset|start|end\b|stop|count|thirty|30 ?day|bedtime|nap|goal|interruption|percent|%/.test(h)) return undefined;
  const unit = sleepUnitOf(h);
  if (/\bdeep\b|slow ?wave|\bsws\b/.test(h)) return { ...base, field: "sleep_deep", unit };
  if (/\brem/.test(h)) return { ...base, field: "sleep_rem", unit };
  if (/\blight\b|shallow|\bcore\b/.test(h)) return { ...base, field: null, unit, reason: "Light sleep: used to add up total sleep when the file has no total." };
  if (/asleep|total sleep|sleep duration|sleep time|^sleep( \(.*\))?$|^total/.test(h)) return { ...base, field: "sleep_duration", unit };
  return undefined;
}

/**
 * Files with sleep stages but no total (Garmin, Zepp) get one: deep + light + REM, added up per row.
 * Returned as an extra column so it goes through the same steps as the others.
 */
export function withSleepTotal(t: { headers: string[]; data: string[][] }, family: string): { headers: string[]; data: string[][] } {
  const guesses = t.headers.map((h, i) => guessColumn(h, i, family));
  if (guesses.some((g) => g?.field === "sleep_duration")) return t;
  const deep = guesses.find((g) => g?.field === "sleep_deep");
  const light = guesses.find((g) => g?.field === null && /light|shallow|core/i.test(g.header) && g.reason?.startsWith("Light sleep"));
  if (!deep || !light) return t;
  const rem = guesses.find((g) => g?.field === "sleep_rem");
  const parts = [deep, light, ...(rem ? [rem] : [])];
  const unit = deep.unit === "auto" ? "" : ` (${deep.unit})`;
  // Named so it reads as a total, not as one of the stages it adds up.
  const header = `Total sleep (added up from stages)${unit}`;
  const data = t.data.map((r) => {
    const nums = parts.map((g) => toNumber(r[g.index] ?? ""));
    return [...r, nums.every((n) => n !== undefined) ? String(nums.reduce((a, b) => a! + b!, 0)) : ""];
  });
  return { headers: [...t.headers, header], data };
}

/** For sleep, the date that names the night: the morning you woke up, when the file says so. */
export function sleepDateColumn(headers: string[], data: string[][] = [], monthFirst = false): number {
  // Only a column that holds dates ("wakeTime" in Zepp files is minutes awake, not a time).
  const holdsDates = (i: number) => data.length === 0 || data.slice(0, 5).some((r) => toIsoDate(r[i] ?? "", monthFirst));
  return headers.findIndex((h, i) => /date of sleep|wake ?(onset|up|time)|sleep ?end|^end ?(time|date)?$/i.test(normalizeHeader(h)) && holdsDates(i));
}

// ---- Dates ----------------------------------------------------------------------------------------

/** The calendar day of a date or timestamp as the file writes it. */
export function toIsoDate(raw: string, monthFirst = false): string | undefined {
  const s = raw.trim().replace(/^"|"$/g, "");
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(m[1]!, m[2]!, m[3]!);
  m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})/.exec(s);
  if (m) return monthFirst && m[2] === "/" ? valid(m[4]!, m[1]!, m[3]!) : valid(m[4]!, m[3]!, m[1]!);
  // Two-digit years with slashes: month first, as Fitbit writes them ("01/15/24 08:00:05").
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})(\s|$)/.exec(s);
  if (m) return valid(`20${m[3]}`, m[1]!, m[2]!);
  if (/^\d{10}(\d{3})?$/.test(s)) {
    const d = new Date(Number(s) * (s.length === 10 ? 1000 : 1));
    return valid(String(d.getFullYear()), String(d.getMonth() + 1), String(d.getDate()));
  }
  return undefined;
}

function valid(y: string, mo: string, d: string): string | undefined {
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : undefined;
}

function toNumber(raw: string): number | undefined {
  const s = raw.trim().replace(/\s/g, "");
  if (!/^-?\d+([.,]\d+)?$/.test(s)) return undefined;
  return Number(s.replace(",", "."));
}

// ---- Daily values ---------------------------------------------------------------------------------

export interface DailySeries {
  field: BodyField;
  unit: string;
  /** Where it came from: a column name or an Apple Health type. */
  from: string;
  /** One value per day: the average of that day's readings, in the file's unit. */
  days: { date: string; value: number; readings: number }[];
  /** Readings outside what a body can show (typos, sensor errors), left out. */
  dropped: number;
}

/**
 * One value per day: the average of that day's readings, or for sleep the sum (a night recorded in
 * pieces, plus naps). Readings, or for sleep whole nights, that can't be real are dropped and counted.
 */
export function dailyAverages(field: BodyField, unit: string, from: string, readings: Iterable<{ date: string; value: number }>, toCanonical: (v: number) => number): DailySeries {
  const tally = new DailyTally();
  for (const r of readings) tally.add(from, field, unit, r.date, r.value, toCanonical);
  return tally.series()[0] ?? { field, unit, from, days: [], dropped: 0 };
}

/** Readings of one column of a CSV table, by day. */
export function columnReadings(data: string[][], dateCol: number, g: ColumnGuess, monthFirst = false): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (const row of data) {
    const date = toIsoDate(row[dateCol] ?? "", monthFirst);
    const v = toNumber(row[g.index] ?? "");
    if (!date || v === undefined) continue;
    // Blood oxygen as a fraction (0.97) becomes a percentage.
    const value = g.field === "spo2" && v > 0 && v <= 1 ? v * 100 : v * (g.scale ?? 1);
    out.push({ date, value });
  }
  return out;
}

export interface TableColumn {
  header: string;
  /** Null: recognised but not imported (see `reason`). */
  field: BodyField | null;
  unit: string;
  reason?: string;
  readings: { date: string; value: number }[];
}

/**
 * Everything one table gives: its columns with their readings by day. Sleep columns are dated by the
 * morning (when the file says when the night ended), get a total from their stages when the file has
 * none, and get their unit from the numbers when the header doesn't say. `dated` is false when no
 * column holds dates.
 */
export function readTable(path: string, table: { headers: string[]; data: string[][] }, monthFirst = false): { columns: TableColumn[]; other: string[]; dated: boolean } {
  const family = fileFamily(path);
  const t = withSleepTotal(table, family);
  const dateCol = findDateColumn(t.headers, t.data, monthFirst);
  if (dateCol === -1) return { columns: [], other: [], dated: false };
  const sleepCol = sleepDateColumn(t.headers, t.data, monthFirst);
  const columns: TableColumn[] = [];
  const other: string[] = [];
  t.headers.forEach((h, i) => {
    if (i === dateCol || i === sleepCol) return;
    const g = guessColumn(h, i, family);
    if (!g) return void other.push(h);
    if (!g.field) return void columns.push({ header: h, field: null, unit: "", ...(g.reason ? { reason: g.reason } : {}), readings: [] });
    const readings = columnReadings(t.data, SLEEP_FIELDS.has(g.field) && sleepCol !== -1 ? sleepCol : dateCol, g, monthFirst);
    columns.push({ header: h, field: g.field, unit: g.unit === "auto" ? sleepUnit(readings.map((r) => r.value)) : g.unit, readings });
  });
  return { columns, other, dated: true };
}

// ---- Apple Health export.xml -----------------------------------------------------------------------

/** Apple Health record types the app reads, and what they become. */
export const APPLE_TYPES: Record<string, { field: BodyField; scale?: number } | { skip: string }> = {
  HKQuantityTypeIdentifierHeartRate: { field: "heart_rate" },
  HKQuantityTypeIdentifierRestingHeartRate: { field: "resting_hr" },
  HKQuantityTypeIdentifierOxygenSaturation: { field: "spo2", scale: 100 },
  HKQuantityTypeIdentifierBodyMass: { field: "weight" },
  HKQuantityTypeIdentifierBodyFatPercentage: { field: "body_fat", scale: 100 },
  HKQuantityTypeIdentifierWaistCircumference: { field: "waist" },
  HKQuantityTypeIdentifierBloodPressureSystolic: { field: "bp_systolic" },
  HKQuantityTypeIdentifierBloodPressureDiastolic: { field: "bp_diastolic" },
  HKQuantityTypeIdentifierBloodGlucose: { field: "glucose_home" },
  HKQuantityTypeIdentifierVO2Max: { field: "vo2max" },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { skip: "Apple measures HRV as SDNN, not RMSSD like this app; the two can't be mixed." },
};

const APPLE_UNITS: Record<string, string> = { "count/min": "bpm", "%": "%", kg: "kg", lb: "lb", cm: "cm", in: "in", mmHg: "mmHg", "mg/dL": "mg/dL", "mmol<180.1558800000541>/L": "mmol/L", "mmol/L": "mmol/L", "mL/min·kg": "mL/kg/min", "ml/(kg*min)": "mL/kg/min" };

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

export interface AppleReading {
  key: string;
  field: BodyField;
  unit: string;
  date: string;
  value: number;
}

/**
 * Reads the records in one piece of export.xml (the page feeds the file in pieces; a record cut at a
 * piece's end is carried over by the caller). Workouts give their average heart rate.
 */
export function appleRecords(xml: string, skipped: Map<string, string>): AppleReading[] {
  const out: AppleReading[] = [];
  for (const m of xml.matchAll(/<Record\s[^>]*?\/?>/g)) {
    const tag = m[0];
    const type = attr(tag, "type");
    if (!type) continue;
    if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
      for (const r of appleSleep(tag)) out.push(r);
      continue;
    }
    const known = APPLE_TYPES[type];
    if (!known) continue;
    if ("skip" in known) {
      skipped.set(type.replace("HKQuantityTypeIdentifier", ""), known.skip);
      continue;
    }
    const date = toIsoDate(attr(tag, "startDate") ?? "");
    const value = Number(attr(tag, "value"));
    const unit = APPLE_UNITS[attr(tag, "unit") ?? ""] ?? attr(tag, "unit") ?? "";
    if (!date || !Number.isFinite(value)) continue;
    out.push({ key: type, field: known.field, unit: known.scale ? "%" : unit, date, value: value * (known.scale ?? 1) });
  }
  for (const m of xml.matchAll(/<WorkoutStatistics\s[^>]*?type="HKQuantityTypeIdentifierHeartRate"[^>]*?\/?>/g)) {
    const date = toIsoDate(attr(m[0], "startDate") ?? "");
    const value = Number(attr(m[0], "average"));
    if (date && Number.isFinite(value)) out.push({ key: "Workout heart rate", field: "exercise_hr", unit: "bpm", date, value });
  }
  return out;
}

/** "2026-03-01 23:10:00 +0100" as a time. */
function appleTime(s: string | undefined): number {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(s ?? "");
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : NaN;
}

/**
 * One piece of a night from Apple Health, in hours, dated by when it ended (the morning). Each phone,
 * watch or app that records sleep is kept apart ("Sleep (Apple Watch)"), so the same night isn't
 * counted twice; the review shows where they overlap.
 */
function appleSleep(tag: string): AppleReading[] {
  const stage = (attr(tag, "value") ?? "").replace("HKCategoryValueSleepAnalysis", "");
  if (!/^Asleep/.test(stage)) return []; // InBed and Awake aren't sleep
  const end = attr(tag, "endDate");
  const hours = (appleTime(end) - appleTime(attr(tag, "startDate"))) / 3_600_000;
  const date = toIsoDate(end ?? "");
  if (!date || !(hours > 0)) return [];
  const source = attr(tag, "sourceName") ?? "Apple Health";
  const out: AppleReading[] = [{ key: `Sleep (${source})`, field: "sleep_duration", unit: "h", date, value: hours }];
  if (stage === "AsleepDeep") out.push({ key: `Deep sleep (${source})`, field: "sleep_deep", unit: "h", date, value: hours });
  if (stage === "AsleepREM") out.push({ key: `REM sleep (${source})`, field: "sleep_rem", unit: "h", date, value: hours });
  return out;
}

/** Where the last complete record ends, so the rest is carried into the next piece. */
export function safeCut(xml: string): number {
  let end = 0;
  for (const close of ["/>", "</Record>", "</Workout>"]) {
    const at = xml.lastIndexOf(close);
    if (at !== -1) end = Math.max(end, at + close.length);
  }
  return end;
}

/**
 * Per-day running averages for big files (Apple's export.xml holds millions of heart rate samples):
 * keeps only a sum and a count per source and day.
 */
export class DailyTally {
  private readonly bySource = new Map<string, { field: BodyField; unit: string; toCanonical: (v: number) => number; days: Map<string, { sum: number; n: number }>; dropped: number }>();

  add(from: string, field: BodyField, unit: string, date: string, value: number, toCanonical: (v: number) => number): void {
    let s = this.bySource.get(from);
    if (!s) {
      s = { field, unit, toCanonical, days: new Map(), dropped: 0 };
      this.bySource.set(from, s);
    }
    const c = toCanonical(value);
    const p = PLAUSIBLE[field];
    // Sleep pieces are checked as a whole night (in series()); other readings one by one.
    const bad = SLEEP_FIELDS.has(field) ? !Number.isFinite(c) || c < 0 || c > p.max : !Number.isFinite(c) || c < p.min || c > p.max;
    if (bad) {
      s.dropped++;
      return;
    }
    const d = s.days.get(date) ?? { sum: 0, n: 0 };
    d.sum += value;
    d.n++;
    s.days.set(date, d);
  }

  series(): DailySeries[] {
    return [...this.bySource.entries()].map(([from, s]) => {
      const sum = SLEEP_FIELDS.has(s.field);
      const p = PLAUSIBLE[s.field];
      let dropped = s.dropped;
      const days: DailySeries["days"] = [];
      for (const [date, { sum: total, n }] of [...s.days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const value = sum ? total : total / n;
        if (sum) {
          const c = s.toCanonical(value);
          if (c < p.min || c > p.max) {
            dropped++;
            continue;
          }
        }
        days.push({ date, value: Math.round(value * 10) / 10, readings: n });
      }
      return { field: s.field, unit: s.unit, from, dropped, days };
    });
  }
}
