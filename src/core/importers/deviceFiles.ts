import { PLAUSIBLE, type BodyField } from "../body";
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
  const headers = dotted.length >= raw.length / 2 ? raw.map((h) => h.split(".").pop()!.replace(/_/g, " ")) : raw;
  return { headers, data: rows.slice(start + 1) };
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

/** Recognises a value column from its name. Max, min, zones and counts are not daily averages: skipped. */
export function guessColumn(header: string, index: number): ColumnGuess | undefined {
  const h = header.toLowerCase();
  const base = { index, header };
  const skip = (reason: string): ColumnGuess => ({ ...base, field: null, unit: "", reason });
  if (/\bsdnn\b/.test(h)) return skip("HRV as SDNN (Apple's measure), not RMSSD: the two can't be mixed.");
  if (/\b(max|maximum|min|minimum|peak|lowest|highest|zone|count|calories|kcal|steps|distance|duration|seconds|minutes)\b/.test(h) && /heart|hr\b|hrv|pulse|weight|oxygen|spo2/.test(h))
    return skip("Not a daily average (a minimum, maximum, zone or count).");
  if (/hrv|rmssd|heart rate variability/.test(h)) return { ...base, field: /rest|night|sleep|overnight|nightly|morning/.test(h) ? "hrv_resting" : "hrv", unit: "ms" };
  if (/resting.*(heart|hr|pulse)|(heart|hr|pulse).*resting|ruhepuls/.test(h)) return { ...base, field: "resting_hr", unit: "bpm" };
  if (/spo2|oxygen|saturation|sauerstoff/.test(h)) return { ...base, field: "spo2", unit: "%" };
  if (/(exercise|workout|activity|training).*(heart|hr\b)|(heart|hr).*(exercise|workout)/.test(h)) return { ...base, field: "exercise_hr", unit: "bpm" };
  if (/heart.?rate|^hr$|\bbpm\b|^pulse$|^puls$/.test(h)) return { ...base, field: "heart_rate", unit: "bpm" };
  if (/systolic/.test(h)) return { ...base, field: "bp_systolic", unit: "mmHg" };
  if (/diastolic/.test(h)) return { ...base, field: "bp_diastolic", unit: "mmHg" };
  if (/body ?fat|fat ?percent|fat ?ratio/.test(h)) return { ...base, field: "body_fat", unit: "%" };
  if (/waist/.test(h)) return { ...base, field: "waist", unit: /\bin(ch|ches)?\b/.test(h) ? "in" : "cm" };
  if (/glucose|blood sugar/.test(h)) return { ...base, field: "glucose_home", unit: /mg/.test(h) ? "mg/dL" : "mmol/L" };
  if (/weight|body ?mass|gewicht|súly/.test(h) && !/lean|muscle|bone|water|skeletal/.test(h)) return { ...base, field: "weight", unit: /\blbs?\b|pound/.test(h) ? "lb" : "kg" };
  return undefined;
}

// ---- Dates ----------------------------------------------------------------------------------------

/** The calendar day of a date or timestamp as the file writes it. */
export function toIsoDate(raw: string, monthFirst = false): string | undefined {
  const s = raw.trim().replace(/^"|"$/g, "");
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(m[1]!, m[2]!, m[3]!);
  m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})/.exec(s);
  if (m) return monthFirst && m[2] === "/" ? valid(m[4]!, m[1]!, m[3]!) : valid(m[4]!, m[3]!, m[1]!);
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

/** Averages readings per day. Readings that can't be real are dropped and counted. */
export function dailyAverages(field: BodyField, unit: string, from: string, readings: Iterable<{ date: string; value: number }>, toCanonical: (v: number) => number): DailySeries {
  const sums = new Map<string, { sum: number; n: number }>();
  let dropped = 0;
  const p = PLAUSIBLE[field];
  for (const r of readings) {
    const c = toCanonical(r.value);
    if (!Number.isFinite(c) || c < p.min || c > p.max) {
      dropped++;
      continue;
    }
    const s = sums.get(r.date) ?? { sum: 0, n: 0 };
    s.sum += r.value;
    s.n++;
    sums.set(r.date, s);
  }
  const days = [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, { sum, n }]) => ({ date, value: Math.round((sum / n) * 10) / 10, readings: n }));
  return { field, unit, from, days, dropped };
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
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { skip: "Apple measures HRV as SDNN, not RMSSD like this app; the two can't be mixed." },
};

const APPLE_UNITS: Record<string, string> = { "count/min": "bpm", "%": "%", kg: "kg", lb: "lb", cm: "cm", in: "in", mmHg: "mmHg", "mg/dL": "mg/dL", "mmol<180.1558800000541>/L": "mmol/L", "mmol/L": "mmol/L" };

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
  private readonly bySource = new Map<string, { field: BodyField; unit: string; days: Map<string, { sum: number; n: number }>; dropped: number }>();

  add(from: string, field: BodyField, unit: string, date: string, value: number, toCanonical: (v: number) => number): void {
    let s = this.bySource.get(from);
    if (!s) {
      s = { field, unit, days: new Map(), dropped: 0 };
      this.bySource.set(from, s);
    }
    const c = toCanonical(value);
    const p = PLAUSIBLE[field];
    if (!Number.isFinite(c) || c < p.min || c > p.max) {
      s.dropped++;
      return;
    }
    const d = s.days.get(date) ?? { sum: 0, n: 0 };
    d.sum += value;
    d.n++;
    s.days.set(date, d);
  }

  series(): DailySeries[] {
    return [...this.bySource.entries()].map(([from, s]) => ({
      field: s.field,
      unit: s.unit,
      from,
      dropped: s.dropped,
      days: [...s.days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, { sum, n }]) => ({ date, value: Math.round((sum / n) * 10) / 10, readings: n })),
    }));
  }
}
