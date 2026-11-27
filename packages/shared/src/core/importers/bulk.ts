// Many lab reports at once: one review per blood test (per sample date), however many files or pages it came in.
// Pure and tested; the Import page reads the files, this merges what was read.
import type { BiomarkerDef, Measurement } from "../types";
import type { ParsedReport, ParsedRow } from "./labText";
import { validateManualEntry } from "./manual";

export interface BulkSource {
  /** The file's name, shown next to rows when a test came from several files. */
  name: string;
  report: ParsedReport;
}

export interface BulkTest {
  /** The sample date; missing when the report had none (each such file is its own test). */
  date?: string;
  dateNote?: string;
  /** Files this test was read from. */
  files: string[];
  report: ParsedReport;
  /** Results already saved in the profile (same marker, date and value): unticked. */
  alreadySaved: number;
  /** Markers with two different values on this date: both unticked for the person to choose. */
  conflicts: number;
}

/** The value in the marker's canonical unit, to compare rows printed in different units. */
function canonical(row: ParsedRow, date: string, defs: ReadonlyMap<string, BiomarkerDef>, today: string) {
  const v = validateManualEntry({ biomarkerId: row.biomarkerId, value: row.value, unit: row.unit ?? "", date }, defs, today);
  return v.ok ? { value: v.measurement.value, qualifier: v.measurement.qualifier } : undefined;
}

/**
 * Groups reports by sample date into one review per test. Exact repeats across files (a second copy, a
 * summary page) are dropped with a note; two different values for one marker on one date are both kept but
 * unticked; results already saved are unticked. Tests come oldest first, undated ones last.
 */
export function mergeReports(
  sources: readonly BulkSource[],
  existing: readonly Measurement[],
  defs: ReadonlyMap<string, BiomarkerDef>,
  today: string,
): BulkTest[] {
  const groups = new Map<string, BulkSource[]>();
  sources.forEach((s, i) => {
    if (s.report.rows.length === 0 && s.report.unmatched.length === 0) return;
    const key = s.report.date ?? `~undated-${i}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  });
  const tests: BulkTest[] = [];
  for (const [key, group] of groups) {
    const date = key.startsWith("~") ? undefined : key;
    const several = group.length > 1;
    type Merged = ParsedRow & { from: string; same: string; saved: boolean };
    const rows: Merged[] = [];
    for (const s of group)
      for (const r of s.report.rows) {
        const c = date ? canonical(r, date, defs, today) : undefined;
        const same = c ? `${c.qualifier ?? ""}${c.value}` : `raw:${r.value}|${r.unit ?? ""}`;
        const twin = rows.find((x) => x.biomarkerId === r.biomarkerId && x.same === same);
        if (twin) {
          if (twin.from !== s.name && !twin.notes.includes(`Also in ${s.name}.`)) twin.notes = [...twin.notes, `Also in ${s.name}.`];
          continue;
        }
        const saved = !!c && existing.some((m) => m.biomarkerId === r.biomarkerId && m.date === date && m.value === c.value && m.qualifier === c.qualifier);
        rows.push({ ...r, problems: [...r.problems], notes: [...r.notes], ...(several ? { line: `${r.line} · ${s.name}` } : {}), from: s.name, same, saved });
      }
    let conflicts = 0;
    let alreadySaved = 0;
    for (const r of rows) {
      if (rows.some((x) => x !== r && x.biomarkerId === r.biomarkerId)) {
        r.problems.push(`More than one ${defs.get(r.biomarkerId)?.name ?? r.biomarkerId} value for this date. Tick the right one.`);
        conflicts++;
      } else if (r.saved) {
        r.problems.push("Already saved.");
        alreadySaved++;
      }
    }
    const dateNotes = [...new Set(group.flatMap((s) => (s.report.dateNote ? [s.report.dateNote] : [])))];
    tests.push({
      ...(date ? { date } : {}),
      ...(dateNotes.length ? { dateNote: dateNotes.join(" ") } : {}),
      files: [...new Set(group.map((s) => s.name))],
      report: {
        rows: rows.map(({ from: _from, same: _same, saved: _saved, ...r }) => r),
        ...(date ? { date } : {}),
        ...(dateNotes.length ? { dateNote: dateNotes.join(" ") } : {}),
        unmatched: [...new Set(group.flatMap((s) => s.report.unmatched))],
      },
      alreadySaved,
      conflicts,
    });
  }
  return tests.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : 0));
}

/** "2014 to 2026", "March 2025": the span of dated tests, for the summary. */
export function testSpan(dates: readonly string[]): { from: string; to: string } | undefined {
  const sorted = dates.filter(Boolean).sort();
  return sorted.length ? { from: sorted[0]!, to: sorted.at(-1)! } : undefined;
}
