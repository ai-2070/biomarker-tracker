import { type BodyField, DAILY_TOTAL_FIELDS, PLAUSIBLE, SLEEP_FIELDS } from "../body";
import { isIsoDate } from "../dates";
import { sleepLocalTime, validSleepSessions } from "../sleepSessions";
import type { SleepSession } from "../types";

/**
 * Reading export files from watches, rings and phone apps (Google Takeout Fit, Samsung Health,
 * Oura, Garmin reports, Apple Health). Everything here is pure: the page reads the file and shows a
 * review screen; nothing is saved without the person confirming.
 *
 * Values become one reading per day and measurement (the average of that day's readings, or for
 * sleep, steps and active minutes their total), which is what the charts and habit comparisons work with.
 */

// ---- CSV ------------------------------------------------------------------------------------------

/** Splits CSV text into rows. Handles quotes, a BOM, and comma, semicolon or tab separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((d) => {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < firstLine.length; i++) {
      if (firstLine[i] === '"') {
        if (quoted && firstLine[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted && firstLine[i] === d) count++;
    }
    return [d, count] as const;
  });
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
  // A measurement's name, not the name/type of its app, source or device.
  const keyCol = t.headers.findIndex(
    (h, i) =>
      !/(^|\s)(pkg|package|source|device|app|application|provider|file|profile|user) (name|type)$/i.test(h) &&
      /(^|\s)(key|type|name|metric|data ?type|data ?name|data ?key)$/i.test(h) &&
      kindsIn(i).length > 0,
  );
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
    if (listKey)
      for (const inner of (it[listKey] as unknown[]).filter(isRec)) {
        const row = { ...outer };
        flatten(inner, listKey, row);
        rows.push(row);
      }
    else rows.push(outer);
  }
  if (rows.length === 0) return undefined;
  const names = new Set<string>();
  for (const row of rows) for (const key in row) names.add(key);
  const headers = [...names];
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

const DATE_HEADER =
  /^(date|day|time|timestamp|start ?time|start ?date|start|datum|dátum|calendar date|summary date|recorded at|start time)$|(^|\s)(date|day)(\s|$)|start ?time/i;

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
  const h = normalizeHeader(header)
    .toLowerCase()
    .replace(/\bsp o([2₂])\b/g, "spo2");
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
  const activity = activityColumn(h, f, base);
  if (activity !== "not activity") return activity;
  if (/\b(seven|weekly|week|monthly|month|baseline|last \d+ days?)\b/.test(h) && health.test(h))
    return skip("An average over several days, not one day's value.");
  if (
    /\b(max|maximum|min|minimum|peak|lowest|highest|zone|zones|count|calories|kcal|steps|distance|duration|seconds|minutes|confidence|error|lower bound|upper bound)\b/.test(
      h,
    ) &&
    (health.test(h) || health.test(f))
  )
    return skip("Not a daily average (a minimum, maximum, zone or count).");

  // Vague names: the file says what they are.
  const vague =
    /^(value|values|avg|average|mean|average value|value value|value bpm|bpm|daily value|data|rmssd|heart rate|heartrate|avg heart rate|average heart rate|average hr|avg hr|hr)$/.test(
      h,
    );
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
  // Samsung's body_fat is %, but body_fat_mass is kg. Match mass before the broad body-fat rule.
  if (/\bfat\b/.test(h) && /\b(mass|kg|kilograms?|g|grams?|lbs?|pounds?)\b/.test(h))
    return skip("Fat mass is a weight, not body fat percentage. It isn't imported.");

  if (/^fat$/.test(h) && /weight|body/.test(f)) return { ...base, field: "body_fat", unit: "%" };

  if (/hrv|rmssd|heart rate variability/.test(h))
    return {
      ...base,
      field: /rest|night|sleep|overnight|nightly|morning/.test(h) || /sleep|night|cycle|recovery|readiness/.test(f) ? "hrv_resting" : "hrv",
      unit: "ms",
    };
  if (/rest(ing)?\b.*(heart|hr|pulse)|(heart|hr|pulse).*resting|ruhepuls/.test(h)) return { ...base, field: "resting_hr", unit: "bpm" };
  if (/spo2|oxygen|saturation|sauerstoff/.test(h)) return { ...base, field: "spo2", unit: "%" };
  if (/(exercise|exercises|workout|activity|training|sport).*(heart|hr\b)|(heart|hr).*(exercise|workout)/.test(h))
    return { ...base, field: "exercise_hr", unit: "bpm" };
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
  if (/weight|body ?mass|gewicht|súly/.test(h) && !/lean|muscle|bone|water|skeletal/.test(h))
    return { ...base, field: "weight", unit: /\blbs?\b|pound/.test(h) ? "lb" : "kg" };
  return undefined;
}

// ---- Steps and active minutes --------------------------------------------------------------------

/** The unit an activity column's header names: minutes unless it says hours or seconds ("auto" when unsure). */
function activityUnitOf(h: string): string {
  if (/\(s\)|\bsecs?\b|\bseconds\b/.test(h)) return "s";
  if (/\(h\)|\bhrs?\b|\bhours?\b/.test(h)) return "h";
  if (/\(min\)|\bmins?\b|\bminutes\b/.test(h)) return "min";
  return "auto";
}

/** Minutes or seconds of activity from the size of the numbers (Oura writes seconds). */
export function activityUnit(values: readonly number[]): "min" | "s" {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor(sorted.length / 2)] ?? 0) > 400 ? "s" : "min";
}

/**
 * Parts of active time that a file writes in separate columns, added up by withActiveTotal: Fitbit's
 * fairly and very active minutes, Garmin's moderate and vigorous intensity minutes (vigorous counts
 * twice, as Garmin and the WHO count it), Oura's medium and high activity time.
 */
const ACTIVE_PARTS: readonly { re: RegExp; group: string; weight: number }[] = [
  { re: /fairly active|moderately active/, group: "fitbit", weight: 1 },
  { re: /very active/, group: "fitbit", weight: 1 },
  { re: /moderate( intensity)? minutes|moderate intensity|minutes moderate/, group: "garmin", weight: 1 },
  { re: /vigorous( intensity)? minutes|vigorous intensity|minutes vigorous/, group: "garmin", weight: 2 },
  { re: /medium activity time|medium activity/, group: "oura", weight: 1 },
  { re: /high activity time|high activity/, group: "oura", weight: 1 },
];
const PART_REASON = "Part of active time: added up with the file's other active minutes into one total.";

/**
 * Steps and minutes of moderate-to-vigorous activity. Light activity, sedentary time and Google Fit's
 * move minutes (which include light activity) aren't active time in the WHO's sense, so they're
 * skipped with a reason. "not activity" lets other rules look at the column.
 */
function activityColumn(h: string, f: string, base: { index: number; header: string }): ColumnGuess | undefined | "not activity" {
  const skip = (reason: string): ColumnGuess => ({ ...base, field: null, unit: "", reason });
  if (/\bsteps?\b|step ?count|schritte/.test(h) || (/^(value|count|total|daily value)$/.test(h) && /\bsteps?\b|step/.test(f))) {
    if (/goal|target|cadence|per min|\/ ?min|\bspm\b|floor|distance|calorie|speed|length|stride|rate|max|min\b|average|avg|mean|weekly|week|month/.test(h))
      return undefined;
    return { ...base, field: "steps", unit: "steps" };
  }
  if (
    !/activ|exercise|intensity|vigorous|moderate|sedentary|move minutes|\bazm\b|zone minutes|mvpa/.test(h) &&
    !(/^(value|minutes|total minutes)$/.test(h) && /active|exercise|intensity|zone minutes/.test(f))
  )
    return "not activity";
  if (/heart|\bhr\b|calorie|kcal|energy|score|goal|target|distance|steps|met\b|mets|inactiv|alert|reminder|level|type|name|count of|percent|%/.test(h))
    return "not activity";
  // The total withActiveTotal adds (its name lists the parts it came from).
  if (/^active minutes \(added up from/.test(h)) return { ...base, field: "active_minutes", unit: /\((min|s|h)\)$/.exec(h)?.[1] ?? "auto" };
  if (/move minutes/.test(h)) return skip("Move minutes include light activity, not only moderate or vigorous activity.");
  if (/light(ly)? active|low activity|light activity|sedentary|resting time|non ?wear/.test(h))
    return skip("Light activity and sitting time aren't counted as active time (moderate or harder).");
  const part = ACTIVE_PARTS.find((x) => x.re.test(h));
  if (part) return { ...base, field: null, unit: activityUnitOf(h), reason: PART_REASON };
  if (
    /active (zone )?minutes|active time|activity (minutes|time)|exercise (minutes|time|min)|intensity minutes|\bazm\b|zone minutes|mvpa|moderate to vigorous|aktive minuten|^value$|^minutes$|^total minutes$/.test(
      h,
    )
  ) {
    return { ...base, field: "active_minutes", unit: activityUnitOf(h) };
  }
  return undefined;
}

/**
 * Files with active time in parts but no total (Fitbit, Garmin, Oura) get one, added per row with each
 * part's weight. Returned as an extra column so it goes through the same steps as the others.
 */
export function withActiveTotal(t: { headers: string[]; data: string[][] }, family: string): { headers: string[]; data: string[][] } {
  const guesses = t.headers.map((h, i) => guessColumn(h, i, family));
  if (guesses.some((g) => g?.field === "active_minutes")) return t;
  const parts = t.headers
    .map((h, i) => ({ i, h: normalizeHeader(h).toLowerCase(), g: guesses[i] }))
    .filter((x) => x.g?.reason === PART_REASON)
    .map((x) => ({ ...x, part: ACTIVE_PARTS.find((p) => p.re.test(x.h))! }));
  const group = parts[0]?.part.group;
  const same = parts.filter((x) => x.part.group === group);
  if (same.length < 2) return t;
  const unit = group === "oura" && same[0]!.g!.unit === "auto" ? "s" : same[0]!.g!.unit;
  const header = `Active minutes (added up from ${same.map((x) => x.h).join(" and ")})${unit === "auto" ? "" : ` (${unit})`}`;
  const data = t.data.map((r) => {
    const nums = same.map((x) => toNumber(r[x.i] ?? ""));
    return [...r, nums.every((n) => n !== undefined) ? String(same.reduce((s, x, k) => s + nums[k]! * x.part.weight, 0)) : ""];
  });
  return { headers: [...t.headers, header], data };
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
  if (
    /efficiency|latency|fall asleep|in bed|awake|wake|need|debt|consistency|disturbance|regularity|restless|onset|start|end\b|stop|count|thirty|30 ?day|bedtime|nap|goal|interruption|percent|%/.test(
      h,
    )
  )
    return undefined;
  const unit = sleepUnitOf(h);
  if (/\bdeep\b|slow ?wave|\bsws\b/.test(h)) return { ...base, field: "sleep_deep", unit };
  if (/\brem/.test(h)) return { ...base, field: "sleep_rem", unit };
  if (/\blight\b|shallow|\bcore\b/.test(h))
    return { ...base, field: null, unit, reason: "Light sleep: used to add up total sleep when the file has no total." };
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

interface SleepStamp {
  local: string;
  offset?: number;
}

/** Never let Date.parse interpret an offsetless timestamp in the importing computer's zone. */
function sleepStamp(raw: string, offset?: number, localEpoch = false): SleepStamp | undefined {
  const value = raw.trim();
  if (localEpoch && /^\d{13}$/.test(value)) return { local: new Date(Number(value)).toISOString().slice(0, 23), ...(offset !== undefined ? { offset } : {}) };
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!match) return undefined;
  const local = `${match[1]}T${match[2]}:${match[3] ?? "00"}${match[4] ? `.${match[4].padEnd(3, "0")}` : ""}`;
  if (sleepLocalTime(local) === undefined) return undefined;
  const zone = match[5];
  if (zone === "Z") {
    if (offset === undefined) return undefined; // UTC is not evidence of the person's local clock.
    return { local: new Date(sleepLocalTime(local)! + offset * 60_000).toISOString().slice(0, 23), offset };
  }
  if (zone) {
    const minutes = (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2))) * (zone[0] === "-" ? -1 : 1);
    if (Number(zone.slice(-2)) > 59 || Math.abs(minutes) > 840) return undefined;
    return { local, offset: minutes };
  }
  return { local, ...(offset !== undefined ? { offset } : {}) };
}

function sleepOffset(raw: string): number | undefined {
  if (raw.trim() === "Z" || raw.trim() === "UTC") return 0;
  const match = /^(?:UTC)?([+-])(\d{2}):?(\d{2})$/.exec(raw.trim());
  if (!match) return undefined;
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "-" ? -1 : 1);
  return Number(match[3]) <= 59 && Math.abs(minutes) <= 840 ? minutes : undefined;
}

function recordedSession(start: SleepStamp | undefined, end: SleepStamp | undefined, kind: SleepSession["kind"], source: string): SleepSession | undefined {
  if (!start || !end) return undefined;
  const session: SleepSession = {
    start: start.local,
    end: end.local,
    kind,
    source,
    ...(start.offset !== undefined ? { startOffsetMinutes: start.offset } : {}),
    ...(end.offset !== undefined ? { endOffsetMinutes: end.offset } : {}),
  };
  return validSleepSessions([session], "sleep_duration", end.local.slice(0, 10)) ? session : undefined;
}

/** Only explicit dated session columns qualify; totals alone never manufacture a bedtime. */
function tableSleepSessions(table: { headers: string[]; data: string[][] }, family: string): (SleepSession | undefined)[] {
  const headers = table.headers.map((h) => normalizeHeader(h).toLowerCase());
  const find = (pattern: RegExp) => headers.findIndex((h) => pattern.test(h));
  const localStart = find(/^(sleep start(?: time| date)?|sleep onset|bedtime start|start(?: time| date)?|sleep start timestamp) local$/);
  const localEnd = find(/^(sleep end(?: time| date)?|wake onset|bedtime end|end(?: time| date)?|sleep end timestamp) local$/);
  const plainStart = find(/^(sleep start(?: time| date)?|sleep onset|bedtime start|start(?: time| date)?)$/);
  const plainEnd = find(/^(sleep end(?: time| date)?|wake onset|bedtime end|end(?: time| date)?)$/);
  const startCol = localStart >= 0 ? localStart : plainStart >= 0 ? plainStart : find(/^(sleep start(?: time| timestamp)?|start time) (gmt|utc)$/);
  const endCol = localEnd >= 0 ? localEnd : plainEnd >= 0 ? plainEnd : find(/^(sleep end(?: time| timestamp)?|end time) (gmt|utc)$/);
  if (startCol < 0 || endCol < 0) return [];
  const commonOffset = find(/^(time offset|zone offset|utc offset)$/);
  const startOffset = find(/^start (?:time )?zone offset$/),
    endOffset = find(/^end (?:time )?zone offset$/);
  const kind = /bedtime/.test(headers[startCol]!) ? "in-bed" : "session";
  const source =
    /fitbit/.test(family) || (headers.includes("date of sleep") && headers.includes("minutes asleep"))
      ? "Fitbit"
      : /oura/.test(family) || (headers.includes("bedtime start") && headers.includes("bedtime end"))
        ? "Oura"
        : /whoop/.test(family) || (headers.includes("sleep onset") && headers.includes("wake onset"))
          ? "WHOOP"
          : /garmin|di connect/.test(family) || headers.some((h) => /^sleep start timestamp (local|gmt|utc)$/.test(h))
            ? "Garmin"
            : /health connect/.test(family)
              ? "Health Connect"
              : "Device export";
  const stamp = (row: string[], col: number, offsetCol: number) => {
    const offset = sleepOffset(row[offsetCol >= 0 ? offsetCol : commonOffset] ?? "");
    let raw = row[col] ?? "";
    if (/\b(gmt|utc)$/.test(headers[col]!) || /health connect/.test(family)) {
      if (offset === undefined) return undefined;
      if (/^\d{13}$/.test(raw)) raw = new Date(Number(raw)).toISOString();
      else if (!/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) raw += "Z";
      const utc = sleepStamp(raw, 0);
      if (!utc) return undefined;
      const instant = sleepLocalTime(utc.local)! - (utc.offset ?? 0) * 60_000;
      return { local: new Date(instant + offset * 60_000).toISOString().slice(0, 23), offset };
    }
    return sleepStamp(raw, offset, /local$/.test(headers[col]!));
  };
  return table.data.map((row) => recordedSession(stamp(row, startCol, startOffset), stamp(row, endCol, endOffset), kind, source));
}

function uniqueSleepSessions(sessions: readonly SleepSession[], date: string): SleepSession[] | undefined {
  const unique = [...new Map(sessions.map((session) => [JSON.stringify(session), session])).values()];
  return validSleepSessions(unique, "sleep_duration", date) ? unique : undefined;
}

// ---- Dates ----------------------------------------------------------------------------------------

/** The calendar day of a date or timestamp as the file writes it. */
export function toIsoDate(raw: string, monthFirst = false): string | undefined {
  const s = raw.trim().replace(/^"|"$/g, "");
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(m[1]!, m[2]!, m[3]!);
  m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const firstIsMonth = b > 12 || (a <= 12 && monthFirst && m[2] === "/");
    return firstIsMonth ? valid(m[4]!, m[1]!, m[3]!) : valid(m[4]!, m[3]!, m[1]!);
  }
  // Two-digit years default to Fitbit's month-first order, unless the day makes that impossible.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})(\s|$)/.exec(s);
  if (m) return Number(m[1]) > 12 ? valid(`20${m[3]}`, m[2]!, m[1]!) : valid(`20${m[3]}`, m[1]!, m[2]!);
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

function toNumber(raw: string, integer = false): number | undefined {
  const s = raw.trim().replace(/\s/g, "");
  if (integer && /^-?\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  if (!/^-?\d+([.,]\d+)?$/.test(s)) return undefined;
  const value = Number(s.replace(",", "."));
  return integer && !Number.isInteger(value) ? undefined : value;
}

// ---- Daily values ---------------------------------------------------------------------------------

interface DeviceReading {
  date: string;
  value: number;
  /** Full file path and date-only granularity survive joining overlapping exports. */
  source?: string;
  daily?: boolean;
  sleepSessions?: SleepSession[];
  /** Internal interval identity also reconciles repeated stage columns without storing timings on them. */
  sleepKey?: string;
}

export interface DailySeries {
  field: BodyField;
  unit: string;
  /** Where it came from: a column name or an Apple Health type. */
  from: string;
  /** One value per day: the average of that day's readings, in the file's unit. */
  days: { date: string; value: number; readings: number; sleepSessions?: SleepSession[] }[];
  /** Readings outside what a body can show (typos, sensor errors), left out. */
  dropped: number;
  /** Overlapping exports reconciled before a daily total was calculated. */
  reconciled?: number;
}

/**
 * One value per day: the average of that day's readings, or for sleep, steps and active minutes the sum
 * (a night recorded in pieces, plus naps; steps counted in bursts). Readings, or for those whole days,
 * that can't be real are dropped and counted.
 */
export function dailyAverages(
  field: BodyField,
  unit: string,
  from: string,
  readings: Iterable<DeviceReading>,
  toCanonical: (v: number) => number,
): DailySeries {
  const tally = new DailyTally();
  let reconciled = 0;
  if (DAILY_TOTAL_FIELDS.has(field)) {
    const byDay = new Map<string, DeviceReading[]>();
    for (const r of readings) {
      const rows = byDay.get(r.date) ?? [];
      rows.push(r);
      byDay.set(r.date, rows);
    }
    for (const rows of byDay.values()) {
      const summaries = rows.filter((r) => r.daily && r.source);
      // Prefer a whole-day summary to overlapping samples. Across summary exports, use the
      // lexically latest path (dated export names sort newest last), never add whole days together.
      const source = summaries
        .map((r) => r.source!)
        .sort()
        .at(-1);
      const selected = source ? rows.filter((r) => r.daily && r.source === source) : rows;
      reconciled += rows.length - selected.length;
      const timed = new Set<string>();
      for (const r of selected) {
        // Repeated exports of the same explicit interval are not a second nap.
        const key = r.sleepKey
          ? JSON.stringify([r.date, r.value, r.sleepKey])
          : r.sleepSessions?.length
            ? JSON.stringify([r.date, r.value, r.sleepSessions])
            : undefined;
        if (key && timed.has(key)) {
          reconciled++;
          continue;
        }
        if (key) timed.add(key);
        tally.add(from, field, unit, r.date, r.value, toCanonical, r.sleepSessions);
      }
    }
  } else for (const r of readings) tally.add(from, field, unit, r.date, r.value, toCanonical);
  const series = tally.series()[0] ?? { field, unit, from, days: [], dropped: 0 };
  return reconciled ? { ...series, reconciled } : series;
}

/** Readings of one column of a CSV table, by day. */
export function columnReadings(
  data: string[][],
  dateCol: number,
  g: ColumnGuess,
  monthFirst = false,
  sessions: readonly (SleepSession | undefined)[] = [],
  fallbackDateCol = dateCol,
): DeviceReading[] {
  const out: DeviceReading[] = [];
  for (const [index, row] of data.entries()) {
    const session = sessions[index];
    const date =
      (g.field && SLEEP_FIELDS.has(g.field) ? session?.end.slice(0, 10) : undefined) ??
      toIsoDate(row[dateCol] ?? "", monthFirst) ??
      toIsoDate(row[fallbackDateCol] ?? "", monthFirst);
    const v = toNumber(row[g.index] ?? "", g.field === "steps");
    if (!date || v === undefined) continue;
    // Blood oxygen as a fraction (0.97) becomes a percentage.
    const value = g.field === "spo2" && v > 0 && v <= 1 ? v * 100 : v * (g.scale ?? 1);
    const daily = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\.?$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test((row[dateCol] ?? "").trim());
    out.push({
      date,
      value,
      ...(g.field && DAILY_TOTAL_FIELDS.has(g.field) ? { daily } : {}),
      ...(g.field && SLEEP_FIELDS.has(g.field) && session ? { sleepKey: JSON.stringify(session) } : {}),
      ...(g.field === "sleep_duration" && session ? { sleepSessions: [session] } : {}),
    });
  }
  return out;
}

export interface TableColumn {
  header: string;
  /** Null: recognised but not imported (see `reason`). */
  field: BodyField | null;
  unit: string;
  reason?: string;
  readings: DeviceReading[];
}

const SAMSUNG_STEPS_REASON =
  "Phone and watch step records overlap. Steps are read only from the combined daily totals in com.samsung.shealth.step_daily_trend.csv; choose the full Samsung zip or include that file.";
const SAMSUNG_ACTIVITY_REASON =
  "Samsung active time is read from com.samsung.shealth.activity.day_summary.csv in milliseconds. Pedometer, exercise parts and detail bins can overlap and aren't added again; choose the full Samsung zip or include the daily activity summary.";
const SAMSUNG_RESTING_REASON =
  "Only Samsung's recorded overnight heart rate (shr_value) and HRV (shrv_value) are imported here. Energy Scores, scales, baselines, previous averages and other scoring inputs aren't measurements for these markers.";
const SAMSUNG_SPEED_REASON =
  "Daily step speed is read in m/s from the combined records in com.samsung.shealth.step_daily_trend.csv. Per-device and workout speeds aren't mixed with it. This is a daily average, not a timed gait test.";

const SAMSUNG_DAILY_FIELDS = {
  steps: { column: "count", header: "Steps (Samsung combined daily total)", unit: "steps", reason: SAMSUNG_STEPS_REASON },
  active_minutes: { column: "active time", header: "Active time (Samsung daily total)", unit: "min", reason: SAMSUNG_ACTIVITY_REASON },
  resting_hr: { column: "shr value", header: "Overnight heart rate (Samsung)", unit: "bpm", reason: SAMSUNG_RESTING_REASON },
  hrv_resting: { column: "shrv value", header: "Overnight HRV (Samsung)", unit: "ms", reason: SAMSUNG_RESTING_REASON },
  gait_speed: { column: "speed", header: "Walking speed (Samsung daily step average, not a timed gait test)", unit: "m/s", reason: SAMSUNG_SPEED_REASON },
} as const;

/** Samsung daily summaries replace snapshots; only the explicitly mapped measured fields are read. */
function samsungDailyColumns(table: { headers: string[]; data: string[][] }, field: keyof typeof SAMSUNG_DAILY_FIELDS): TableColumn[] {
  const headers = table.headers.map((h) => normalizeHeader(h).toLowerCase());
  const col = (name: string) => headers.findIndex((h) => h === name || h.endsWith(` ${name}`));
  const steps = field === "steps";
  const combined = steps || field === "gait_speed";
  const config = SAMSUNG_DAILY_FIELDS[field];
  const dayCol = col("day time"),
    sourceCol = col("source type"),
    countCol = col(config.column),
    updateCol = col("update time");
  const skipped: TableColumn = {
    header: steps ? "Samsung per-device step records" : `${config.header}: unavailable readings`,
    field: null,
    unit: "",
    readings: [],
    reason: config.reason,
  };
  if ([dayCol, countCol, ...(combined ? [sourceCol] : [])].includes(-1)) return [skipped];
  const days = new Map<string, { value: number; updated: number }>();
  let excluded = false;
  for (const row of table.data) {
    if (combined && row[sourceCol] !== "-2") {
      excluded = true;
      continue;
    }
    // DAY_TIME is a calendar-day label at UTC midnight, not an instant to shift into this computer's zone.
    const rawDate = row[dayCol] ?? "";
    const date = /^\d{13}$/.test(rawDate) ? new Date(Number(rawDate)).toISOString().slice(0, 10) : toIsoDate(rawDate);
    const rawValue = toNumber(row[countCol] ?? "");
    if (!date || rawValue === undefined || (steps && !Number.isInteger(rawValue)) || rawValue < 0) {
      excluded = true;
      continue;
    }
    const value = field === "active_minutes" ? rawValue / 60_000 : rawValue;
    const time = Date.parse(`${(row[updateCol] ?? "").replace(" ", "T")}Z`);
    const updated = Number.isFinite(time) ? time : 0;
    const previous = days.get(date);
    if (!previous || updated > previous.updated) days.set(date, { value, updated });
  }
  const columns: TableColumn[] = [{ header: config.header, field, unit: config.unit, readings: [...days].map(([date, { value }]) => ({ date, value })) }];
  if (excluded || days.size === 0) columns.push(skipped);
  return columns;
}

/**
 * Samsung exports UTC stage timestamps and a local time offset. Keep a session on its final wake-up
 * day, not each stage's day; light + deep + REM are actual sleep, awake is not.
 * Stage codes: developer.samsung.com/health/android/data/api-reference/com/samsung/android/sdk/healthdata/HealthConstants.SleepStage.html
 */
function samsungSleepColumns(table: { headers: string[]; data: string[][] }): TableColumn[] {
  const headers = table.headers.map((h) => normalizeHeader(h).toLowerCase());
  const col = (name: string) => headers.findIndex((h) => h === name || h.endsWith(` ${name}`));
  const startCol = col("start time"),
    endCol = col("end time"),
    idCol = col("sleep id"),
    stageCol = col("stage"),
    offsetCol = col("time offset");
  const skipped: TableColumn = {
    header: "Samsung sleep stages",
    field: null,
    unit: "",
    readings: [],
    reason: "Some Samsung sleep sessions have missing or invalid stages, times or time-zone offsets and were left out.",
  };
  if ([startCol, endCol, idCol, stageCol, offsetCol].includes(-1)) return [skipped];
  const sessions = new Map<
    string,
    {
      end: number;
      offset: number;
      minutes: [number, number, number];
      valid: boolean;
      startAsleep: number;
      endAsleep: number;
      startOffset: number;
      endOffset: number;
    }
  >();
  const seen = new Set<string>();
  let missingId = false;
  for (const row of table.data) {
    const id = row[idCol];
    if (!id) {
      missingId = true;
      continue;
    }
    const key = JSON.stringify([id, row[startCol], row[endCol], row[stageCol], row[offsetCol]]);
    if (seen.has(key)) continue;
    seen.add(key);
    const session = sessions.get(id) ?? {
      end: -Infinity,
      offset: 0,
      minutes: [0, 0, 0],
      valid: true,
      startAsleep: Infinity,
      endAsleep: -Infinity,
      startOffset: 0,
      endOffset: 0,
    };
    sessions.set(id, session);
    const start = Date.parse(`${(row[startCol] ?? "").replace(" ", "T")}Z`);
    const end = Date.parse(`${(row[endCol] ?? "").replace(" ", "T")}Z`);
    const offset = /^UTC([+-])(\d{2}):?(\d{2})$/.exec(row[offsetCol] ?? "");
    const stage = Number(row[stageCol]);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      !offset ||
      Number(offset[2]) > 23 ||
      Number(offset[3]) > 59 ||
      ![40001, 40002, 40003, 40004].includes(stage)
    ) {
      session.valid = false;
      continue;
    }
    if (end > session.end) {
      session.end = end;
      session.offset = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "-" ? -1 : 1);
    }
    if (stage === 40001) continue;
    const offsetMinutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "-" ? -1 : 1);
    if (start < session.startAsleep) {
      session.startAsleep = start;
      session.startOffset = offsetMinutes;
    }
    if (end > session.endAsleep) {
      session.endAsleep = end;
      session.endOffset = offsetMinutes;
    }
    const minutes = (end - start) / 60_000;
    session.minutes[0] += minutes;
    if (stage === 40003) session.minutes[1] += minutes;
    if (stage === 40004) session.minutes[2] += minutes;
  }
  const columns: TableColumn[] = [
    { header: "Actual sleep (Samsung stages)", field: "sleep_duration", unit: "min", readings: [] },
    { header: "Deep sleep (Samsung stages)", field: "sleep_deep", unit: "min", readings: [] },
    { header: "REM sleep (Samsung stages)", field: "sleep_rem", unit: "min", readings: [] },
  ];
  let invalid = missingId;
  for (const session of sessions.values()) {
    if (!session.valid) {
      invalid = true;
      continue;
    }
    if (session.minutes[0] === 0) continue;
    const date = new Date(session.end + session.offset * 60_000).toISOString().slice(0, 10);
    const timing = recordedSession(
      { local: new Date(session.startAsleep + session.startOffset * 60_000).toISOString().slice(0, 23), offset: session.startOffset },
      { local: new Date(session.endAsleep + session.endOffset * 60_000).toISOString().slice(0, 23), offset: session.endOffset },
      "asleep",
      "Samsung Health",
    );
    session.minutes.forEach((value, i) => {
      if (value > 0)
        columns[i]!.readings.push({
          date,
          value,
          ...(timing ? { sleepKey: JSON.stringify(timing) } : {}),
          ...(i === 0 && timing && timing.end.slice(0, 10) === date ? { sleepSessions: [timing] } : {}),
        });
    });
  }
  if (invalid) columns.push(skipped);
  return columns;
}

/**
 * Everything one table gives: its columns with their readings by day. Sleep columns are dated by the
 * morning (when the file says when the night ended), get a total from their stages when the file has
 * none, and get their unit from the numbers when the header doesn't say. `dated` is false when no
 * column holds dates.
 */
export function readTable(
  path: string,
  table: { headers: string[]; data: string[][] },
  monthFirst = false,
): { columns: TableColumn[]; other: string[]; dated: boolean } {
  const family = fileFamily(path);
  if (/\bcom samsung (health|shealth) step daily trend$/.test(family))
    return { columns: [...samsungDailyColumns(table, "steps"), ...samsungDailyColumns(table, "gait_speed")], other: [], dated: true };
  if (/\bcom samsung (health|shealth) activity day summary$/.test(family))
    return {
      columns: [
        ...samsungDailyColumns(table, "active_minutes"),
        { header: "Samsung step total", field: null, unit: "", readings: [], reason: SAMSUNG_STEPS_REASON },
      ],
      other: [],
      dated: true,
    };
  if (/\bcom samsung (health|shealth) sleep stage$/.test(family)) return { columns: samsungSleepColumns(table), other: [], dated: true };
  if (/\bcom samsung (health|shealth) vitality score$/.test(family))
    return {
      columns: [
        ...samsungDailyColumns(table, "resting_hr"),
        ...samsungDailyColumns(table, "hrv_resting"),
        { header: "Samsung Energy Score and scoring inputs", field: null, unit: "", readings: [], reason: SAMSUNG_RESTING_REASON },
      ],
      other: [],
      dated: true,
    };
  // These repeat sessions or contain time in bed and scoring weights/scales, not actual sleep.
  if (/\bcom samsung (health|shealth) sleep( combined)?$/.test(family))
    return {
      columns: [
        {
          header: "Samsung sleep summary and scores",
          field: null,
          unit: "",
          readings: [],
          reason:
            "Actual sleep and its stages are read from com.samsung.health.sleep_stage.csv. Choose the full Samsung zip or include that file; sleep summaries and energy-score inputs aren't imported again.",
        },
      ],
      other: [],
      dated: true,
    };
  const t = withActiveTotal(withSleepTotal(table, family), family);
  const dateCol = findDateColumn(t.headers, t.data, monthFirst);
  if (dateCol === -1) return { columns: [], other: [], dated: false };
  const sleepCol = sleepDateColumn(t.headers, t.data, monthFirst);
  const sleepFallbackCol = t.headers.findIndex((h) => /^(date of sleep|date|day|calendar date|summary date)$/i.test(normalizeHeader(h)));
  const sessions = tableSleepSessions(t, family);
  const columns: TableColumn[] = [];
  const other: string[] = [];
  t.headers.forEach((h, i) => {
    if (i === dateCol || i === sleepCol) return;
    const g = guessColumn(h, i, family);
    if (!g) return void other.push(h);
    if (!g.field) return void columns.push({ header: h, field: null, unit: "", ...(g.reason ? { reason: g.reason } : {}), readings: [] });
    if (g.field === "steps" && /\bcom samsung (health|shealth)\b/.test(family))
      return void columns.push({ header: h, field: null, unit: "", readings: [], reason: SAMSUNG_STEPS_REASON });
    if (g.field === "active_minutes" && /\bcom samsung (health|shealth)\b/.test(family))
      return void columns.push({ header: h, field: null, unit: "", readings: [], reason: SAMSUNG_ACTIVITY_REASON });
    const readings = columnReadings(
      t.data,
      SLEEP_FIELDS.has(g.field) && sleepCol !== -1 ? sleepCol : dateCol,
      g,
      monthFirst,
      sessions,
      SLEEP_FIELDS.has(g.field) ? sleepFallbackCol : dateCol,
    );
    if (DAILY_TOTAL_FIELDS.has(g.field)) {
      const hasSampleTime = t.headers.some((header, col) => col !== dateCol && /^(time|timestamp|start time|start date)$/i.test(header));
      for (const r of readings) {
        r.source = path;
        if (hasSampleTime) r.daily = false;
      }
    }
    const auto = (values: number[]) => (SLEEP_FIELDS.has(g.field!) ? sleepUnit(values) : activityUnit(values));
    columns.push({ header: h, field: g.field, unit: g.unit === "auto" ? auto(readings.map((r) => r.value)) : g.unit, readings });
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
  // Counted by the iPhone and the Watch alike: kept apart per device (see appleRecords).
  HKQuantityTypeIdentifierStepCount: { field: "steps" },
  HKQuantityTypeIdentifierAppleExerciseTime: { field: "active_minutes" },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { skip: "Apple measures HRV as SDNN, not RMSSD like this app; the two can't be mixed." },
};

const APPLE_UNITS: Record<string, string> = {
  count: "steps",
  min: "min",
  "count/min": "bpm",
  "%": "%",
  kg: "kg",
  lb: "lb",
  cm: "cm",
  in: "in",
  mmHg: "mmHg",
  "mg/dL": "mg/dL",
  "mmol<180.1558800000541>/L": "mmol/L",
  "mmol/L": "mmol/L",
  "mL/min·kg": "mL/kg/min",
  "ml/(kg*min)": "mL/kg/min",
};

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]?.replace(/&(#x[\da-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (entity, code: string) => {
    if (code.startsWith("#")) {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
    }
    return ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" } as Record<string, string>)[code.toLowerCase()] ?? entity;
  });

export interface AppleReading {
  key: string;
  field: BodyField;
  unit: string;
  date: string;
  value: number;
  /** Sleep interval, retained across XML chunks until its whole session is known. */
  sleep?: {
    start: number;
    end: number;
    source: string;
    startStamp: SleepStamp;
    endStamp: SleepStamp;
    stage: "asleep" | "awake" | "in-bed";
    provenance: string;
  };
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
    // Day totals (steps, exercise minutes) are recorded by the phone and the watch at once: each device
    // is its own series, so the same steps aren't counted twice (the review shows where they overlap).
    const key = DAILY_TOTAL_FIELDS.has(known.field)
      ? `${known.field === "steps" ? "Steps" : "Exercise minutes"} (${attr(tag, "sourceName") ?? "Apple Health"})`
      : type;
    out.push({ key, field: known.field, unit: known.scale ? "%" : unit, date, value: value * (known.scale ?? 1) });
  }
  for (const m of xml.matchAll(/<WorkoutStatistics\s[^>]*?type="HKQuantityTypeIdentifierHeartRate"[^>]*?\/?>/g)) {
    const date = toIsoDate(attr(m[0], "startDate") ?? "");
    const value = Number(attr(m[0], "average"));
    if (date && Number.isFinite(value)) out.push({ key: "Workout heart rate", field: "exercise_hr", unit: "bpm", date, value });
  }
  return out;
}

/**
 * One piece of a night from Apple Health, in hours, dated by when it ended (the morning). Each phone,
 * watch or app that records sleep is kept apart ("Sleep (Apple Watch)"), so the same night isn't
 * counted twice; the review shows where they overlap.
 */
function appleSleep(tag: string): AppleReading[] {
  const stage = (attr(tag, "value") ?? "").replace("HKCategoryValueSleepAnalysis", "");
  if (!/^Asleep/.test(stage) && stage !== "Awake" && stage !== "InBed") return [];
  const startStamp = sleepStamp(attr(tag, "startDate") ?? ""),
    endStamp = sleepStamp(attr(tag, "endDate") ?? "");
  if (!startStamp || !endStamp) return [];
  const start = sleepLocalTime(startStamp.local)! - (startStamp.offset ?? 0) * 60_000;
  const end = sleepLocalTime(endStamp.local)! - (endStamp.offset ?? 0) * 60_000;
  const hours = (end - start) / 3_600_000;
  const date = endStamp.local.slice(0, 10);
  if (!(hours > 0) || hours > 36) return [];
  const source = attr(tag, "sourceName") ?? "Apple Health";
  const sourceKey = `${source}|${attr(tag, "device") ?? ""}`;
  // A stable pseudonymous source id distinguishes devices without retaining their owner's name.
  let hash = 2166136261;
  for (const char of sourceKey) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const device = /watch/i.test(source) ? "Watch" : /iphone/i.test(source) ? "iPhone" : "source";
  const sleep: NonNullable<AppleReading["sleep"]> = {
    start,
    end,
    source: sourceKey,
    startStamp,
    endStamp,
    stage: stage === "InBed" ? "in-bed" : stage === "Awake" ? "awake" : "asleep",
    provenance: `Apple Health (${device} ${(hash >>> 0).toString(16)})`,
  };
  const out: AppleReading[] = [{ key: `Sleep (${source})`, field: "sleep_duration", unit: "h", date, value: sleep.stage === "asleep" ? hours : 0, sleep }];
  if (stage === "AsleepDeep") out.push({ key: `Deep sleep (${source})`, field: "sleep_deep", unit: "h", date, value: hours, sleep });
  if (stage === "AsleepREM") out.push({ key: `REM sleep (${source})`, field: "sleep_rem", unit: "h", date, value: hours, sleep });
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
  private readonly bySource = new Map<
    string,
    {
      field: BodyField;
      unit: string;
      toCanonical: (v: number) => number;
      offset: number;
      factor: number;
      days: Map<string, { sum: number; n: number; sleepSessions?: SleepSession[] }>;
      dropped: number;
    }
  >();
  private readonly sleep = new Map<string, AppleReading[]>();

  /** Keeps sleep sessions apart by device, including sessions crossing an XML chunk or midnight. */
  addApple(reading: AppleReading, toCanonical: (v: number) => number): void {
    if (!reading.sleep) {
      this.add(reading.key.replace("HKQuantityTypeIdentifier", ""), reading.field, reading.unit, reading.date, reading.value, toCanonical);
      return;
    }
    const rows = this.sleep.get(reading.sleep.source) ?? [];
    rows.push(reading);
    this.sleep.set(reading.sleep.source, rows);
  }

  add(
    from: string,
    field: BodyField,
    unit: string,
    date: string,
    value: number,
    toCanonical: (v: number) => number,
    sleepSessions?: readonly SleepSession[],
  ): void {
    let s = this.bySource.get(from);
    if (!s) {
      const offset = toCanonical(0);
      s = { field, unit, toCanonical, offset, factor: toCanonical(1) - offset, days: new Map(), dropped: 0 };
      this.bySource.set(from, s);
    }
    const c = toCanonical(value);
    const p = PLAUSIBLE[field];
    // Day totals (sleep pieces, steps, minutes) are checked as a whole day (in series()); other readings one by one.
    const bad = DAILY_TOTAL_FIELDS.has(field) ? !Number.isFinite(c) || c < 0 || c > p.max : !Number.isFinite(c) || c < p.min || c > p.max;
    if (bad) {
      s.dropped++;
      return;
    }
    const d: { sum: number; n: number; sleepSessions?: SleepSession[] } = s.days.get(date) ?? { sum: 0, n: 0 };
    // Convert each sample into the first sample's unit before combining mixed-unit exports.
    d.sum += (c - s.offset) / s.factor;
    d.n++;
    if (field === "sleep_duration" && sleepSessions && validSleepSessions(sleepSessions, field, date)) {
      d.sleepSessions ??= [];
      d.sleepSessions.push(...sleepSessions);
    }
    s.days.set(date, d);
  }

  series(): DailySeries[] {
    const sleepTally = new DailyTally();
    for (const rows of this.sleep.values()) {
      const unique = new Map(rows.map((r) => [JSON.stringify([r.field, r.sleep!.start, r.sleep!.end, r.sleep!.stage]), r]));
      const ordered = [...unique.values()].sort((a, b) => a.sleep!.start - b.sleep!.start);
      let session: AppleReading[] = [];
      let end = -Infinity;
      const flush = () => {
        const asleep = session.filter((r) => r.sleep!.stage === "asleep");
        if (!asleep.length) return;
        const first = asleep.reduce((a, b) => (a.sleep!.start <= b.sleep!.start ? a : b)).sleep!;
        const last = asleep.reduce((a, b) => (a.sleep!.end >= b.sleep!.end ? a : b)).sleep!;
        const date = last.endStamp.local.slice(0, 10);
        const timing = recordedSession(first.startStamp, last.endStamp, "asleep", first.provenance);
        for (const r of asleep)
          sleepTally.add(
            r.key,
            r.field,
            r.unit,
            date,
            r.value,
            (v) => v,
            r.field === "sleep_duration" && timing && timing.end.slice(0, 10) === date ? [timing] : undefined,
          );
      };
      for (const r of ordered) {
        if (session.length && r.sleep!.start > end) {
          flush();
          session = [];
        }
        session.push(r);
        end = Math.max(session.length === 1 ? -Infinity : end, r.sleep!.end);
      }
      flush();
    }
    return [...this.bySource.entries()]
      .map(([from, s]) => {
        const sum = DAILY_TOTAL_FIELDS.has(s.field);
        const p = PLAUSIBLE[s.field];
        const precision = s.field === "gait_speed" ? 100 : 10;
        let dropped = s.dropped;
        const days: DailySeries["days"] = [];
        for (const [date, { sum: total, n, sleepSessions }] of [...s.days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          const value = sum ? total : total / n;
          if (sum) {
            const c = s.toCanonical(value);
            if (c < p.min || c > p.max) {
              dropped++;
              continue;
            }
          }
          const timing = s.field === "sleep_duration" && sleepSessions ? uniqueSleepSessions(sleepSessions, date) : undefined;
          days.push({ date, value: Math.round(value * precision) / precision, readings: n, ...(timing ? { sleepSessions: timing } : {}) });
        }
        return { field: s.field, unit: s.unit, from, dropped, days };
      })
      .concat(sleepTally.bySource.size ? sleepTally.series() : []);
  }
}
