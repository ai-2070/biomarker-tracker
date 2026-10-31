import { useMemo, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Select } from "@base-ui/react/select";
import { BODY_FIELDS, DAILY_TOTAL_FIELDS, SLEEP_FIELDS, type BodyField } from "../../core/body";
import {
  DailyTally,
  appleRecords,
  dailyAverages,
  fileFamily,
  jsonTable,
  readTable,
  parseCsv,
  safeCut,
  tableOf,
  type DailySeries,
} from "../../core/importers/deviceFiles";
import { zipEntries } from "../../core/importers/zipRead";
import type { Measurement } from "../../core/types";
import { listUnits, matchUnit, toCanonical } from "../../core/units";
import { saveDeviceMeasurements } from "../../db/db";
import { monthFirst } from "../components/LabReview";
import { UnitSelect } from "../components/UnitSelect";
import { Button, Card, CheckIcon, ChevronDownIcon, LinkButton, Notice, PageTitle, cx } from "../components/ui";
import { formatDate, showValue } from "../format";
import { useAllMeasurements } from "../hooks";
import { BIOMARKER_MAP, shortName } from "../knowledge";
import { href } from "../router";

/** One importable series: a column (joined across daily files of one kind) or an Apple Health type. */
interface Row {
  key: string;
  file: string;
  include: boolean;
  /** Re-averages the raw readings for another measurement or unit, if the person changes them. */
  remap?: (field: BodyField, unit?: string) => DailySeries;
  series: DailySeries;
}

interface Read {
  rows: Row[];
  skipped: { file: string; what: string; reason: string; family?: string }[];
  ignored: { file: string; columns: string[]; family?: string }[];
  problems: string[];
  /** Files read that held nothing to import (settings, goals…). */
  empty: string[];
}

/** A file to read: chosen directly, inside a chosen folder, or inside a zip. */
interface Source {
  path: string;
  size: number;
  text(): Promise<string>;
  stream(): ReadableStream<Uint8Array>;
}

const canonicalOf = (field: BodyField, unit: string) => {
  const def = BIOMARKER_MAP.get(field)!;
  const u = matchUnit(def, unit);
  return (v: number) => (u ? toCanonical(def, v, u) : NaN);
};

const fromFile = (f: File): Source => ({ path: f.webkitRelativePath || f.name, size: f.size, text: () => f.text(), stream: () => f.stream() });

/** Readable files, including those inside zip files. Apple's export_cda.xml (clinical documents) is left out. */
async function expand(files: File[], problems: string[]): Promise<Source[]> {
  const out: Source[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      try {
        for (const e of await zipEntries(f)) out.push({ path: `${f.name}/${e.name}`, size: e.size, text: e.text, stream: e.stream });
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof Error ? e.message : "couldn't be opened"}`);
      }
    } else out.push(fromFile(f));
  }
  return out.filter((s) => /\.(csv|txt|json)$/i.test(s.path) || /(^|\/)export\.xml$/i.test(s.path));
}

/** One column of one kind of file, joined across all files of that kind (e.g. a Fitbit file per day). */
interface Candidate {
  family: string;
  header: string;
  field: BodyField;
  unit: string;
  file: string;
  files: number;
  readings: { date: string; value: number }[];
}

/** Adds a table's columns to the candidates. False when nothing in it is a body measurement. */
function tableCandidates(path: string, table: { headers: string[]; data: string[][] }, into: Map<string, Candidate>, skipped: Read["skipped"], ignored: Read["ignored"]): boolean {
  const family = fileFamily(path);
  const file = path.split("/").pop()!;
  const t = readTable(path, table, monthFirst);
  if (!t.dated) return false;
  for (const c of t.columns) {
    if (!c.field) {
      if (!skipped.some((x) => x.what === c.header && x.family === family)) skipped.push({ file, what: c.header, reason: c.reason ?? "Not used.", family });
      continue;
    }
    const key = `${family}|${c.header}`;
    const cand = into.get(key) ?? { family, header: c.header, field: c.field, unit: c.unit, file, files: 0, readings: [] };
    cand.files++;
    for (const r of c.readings) cand.readings.push(r);
    into.set(key, cand);
  }
  if (t.other.length && !ignored.some((x) => x.family === family)) ignored.push({ file, columns: t.other, family });
  return t.columns.length > 0;
}

/** Apple Health's export.xml, read in pieces so a file of a gigabyte or more works. */
async function readAppleXml(src: Source, progress: (f: number) => void): Promise<{ rows: Row[]; skipped: Read["skipped"] }> {
  const tally = new DailyTally();
  const skippedTypes = new Map<string, string>();
  const reader = src.stream().getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      read += value.byteLength;
      progress(src.size ? read / src.size : 0);
    }
    const text = carry + (value ? decoder.decode(value, { stream: !done }) : decoder.decode());
    const cut = done ? text.length : safeCut(text);
    for (const r of appleRecords(text.slice(0, cut), skippedTypes)) tally.addApple(r, canonicalOf(r.field, r.unit));
    carry = text.slice(cut);
    if (done) break;
  }
  const file = src.path.split("/").pop()!;
  return {
    rows: tally
      .series()
      .filter((s) => s.days.length > 0)
      .map((series) => ({ key: `${src.path}|${series.from}`, file, include: true, series })),
    skipped: [...skippedTypes].map(([what, reason]) => ({ file, what, reason })),
  };
}

/** Text files bigger than this are skipped (Apple's export.xml is streamed instead). */
const MAX_TEXT = 300_000_000;

const pickStyles =
  "inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-accent px-4 font-medium text-accent-ink transition-[filter] hover:brightness-110 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent";

/** Where each app hides its export. */
const SOURCES: [string, string][] = [
  ["Apple Health", "Health app → your picture → Export All Health Data. Choose the zip (or export.xml): heart rate, blood oxygen, sleep stages, workouts, weight and more. Apple's HRV is a different measure (SDNN) and isn't imported."],
  ["Fitbit", "Google Takeout (takeout.google.com) → Fitbit. Choose the zip or the Fitbit folder: heart rate, resting heart rate, HRV, SpO2, sleep and weight are read."],
  ["Google Fit", "Google Takeout → Fit. Choose the zip or \"Daily activity metrics.csv\"."],
  ["Samsung Health", "Settings → Download personal data. Choose the zip or full folder: heart rate, overnight heart rate and HRV, oxygen saturation, weight, blood pressure, sleep stages, daily steps and active time are read. Keep the sleep-stage, daily step-trend, daily activity-summary and Energy Score files. Only recorded overnight measurements are taken from Energy Score; the scores and overlapping detail records aren't imported."],
  ["Garmin", "Garmin account → Data management → Export your data (arrives by email). Choose the zip or folder; daily summaries give resting heart rate and SpO2, sleep files the night's stages. Or export a Connect report as CSV."],
  ["Oura", "membership.ouraring.com → Export data → CSV (sleep, resting heart rate, HRV)."],
  ["Whoop", "Whoop app → Settings → Data export. Choose the zip, or physiological_cycles.csv, sleeps.csv and workouts.csv."],
  ["Withings", "Withings app → profile → Download my data. Choose the zip or weight.csv and bp.csv."],
  ["Polar", "account.polar.com → Download your data. Choose the zip or folder; training sessions give exercise heart rate."],
  ["Zepp / Amazfit", "Zepp app → profile → Settings → Export data. Choose the zip or folder (heart rate, sleep, body, sport)."],
  ["Huawei Health", "Huawei ID → Privacy centre → Request your data → Health. Choose the zip or folder."],
];

export function DeviceImportPage() {
  const existing = useAllMeasurements();
  const [read, setRead] = useState<Read | null>(null);
  const [busy, setBusy] = useState<{ file: string; fraction: number; of?: string } | null>(null);
  const [saved, setSaved] = useState<{ readings: number; kinds: number; updated: number } | null>(null);

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    setSaved(null);
    const out: Read = { rows: [], skipped: [], ignored: [], problems: [], empty: [] };
    setBusy({ file: "the files", fraction: 0 });
    const sources = await expand(files, out.problems);
    const candidates = new Map<string, Candidate>();
    for (const [i, src] of sources.entries()) {
      const name = src.path.split("/").pop()!;
      setBusy({ file: name, fraction: i / Math.max(sources.length, 1), ...(sources.length > 1 ? { of: `${i + 1} of ${sources.length}` } : {}) });
      try {
        if (/\.xml$/i.test(src.path)) {
          const r = await readAppleXml(src, (fraction) => setBusy({ file: name, fraction }));
          out.rows.push(...r.rows);
          out.skipped.push(...r.skipped);
          if (r.rows.length === 0) out.empty.push(name);
          continue;
        }
        if (src.size > MAX_TEXT) {
          out.problems.push(`${name}: too big to read here (over 300 MB).`);
          continue;
        }
        const text = await src.text();
        const table = /\.json$/i.test(src.path) ? jsonTable(JSON.parse(text)) : tableOf(parseCsv(text));
        if (!table || !tableCandidates(src.path, table, candidates, out.skipped, out.ignored)) out.empty.push(name);
      } catch (e) {
        out.problems.push(`${name}: ${e instanceof Error ? e.message : "couldn't be read"}.`);
      }
    }
    for (const c of candidates.values()) {
      const make = (field: BodyField, unit?: string) => {
        const u = unit ?? (field === c.field ? c.unit : BIOMARKER_MAP.get(field)!.canonicalUnit);
        return dailyAverages(field, u, c.header, c.readings, canonicalOf(field, u));
      };
      const series = make(c.field);
      if (series.days.length > 0) out.rows.push({ key: `${c.family}|${c.header}`, file: c.files > 1 ? `${c.files} files like ${c.file}` : c.file, include: true, remap: make, series });
    }
    if (sources.length === 0 && out.problems.length === 0) out.problems.push("None of the chosen files can be read here. Choose CSV, JSON or zip files, Apple's export.xml, or a folder.");
    setBusy(null);
    setRead(out);
  }

  const have = useMemo(() => new Set((existing ?? []).map((m) => `${m.biomarkerId}|${m.date}`)), [existing]);

  async function save() {
    if (!read) return;
    const toSave: Omit<Measurement, "id" | "source">[] = [];
    const kinds = new Set<string>();
    for (const r of read.rows.filter((x) => x.include)) {
      const def = BIOMARKER_MAP.get(r.series.field)!;
      const unit = matchUnit(def, r.series.unit);
      if (!unit) continue;
      for (const d of r.series.days) {
        kinds.add(def.id);
        toSave.push({
          biomarkerId: def.id,
          value: toCanonical(def, d.value, unit),
          originalValue: d.value,
          originalUnit: unit,
          date: d.date,
          note: `${r.file}: ${r.series.from}${d.readings > 1 ? `, ${DAILY_TOTAL_FIELDS.has(r.series.field) ? "total" : "average"} of ${d.readings} readings` : ""}`,
        });
      }
    }
    const result = await saveDeviceMeasurements(toSave);
    setSaved({ readings: result.added + result.updated, kinds: kinds.size, updated: result.updated });
    setRead(null);
  }

  const update = (key: string, patch: (r: Row) => Row) => setRead((s) => (s ? { ...s, rows: s.rows.map((r) => (r.key === key ? patch(r) : r)) } : s));
  const importActions = read && (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void save()} disabled={!read.rows.some((r) => r.include && r.series.days.length > 0)}>
        Save
      </Button>
      <Button variant="quiet" onClick={() => setRead(null)}>
        Choose other files
      </Button>
      <LinkButton variant="quiet" href={href({ name: "body" })}>
        Cancel
      </LinkButton>
    </div>
  );

  return (
    <>
      <a href={href({ name: "body" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Body
      </a>
      <PageTitle sub="Heart rate, resting heart rate, HRV, blood oxygen, sleep, workouts, weight and blood pressure from the files your watch, ring or phone app exports. Read on this computer; you check everything before it's saved.">
        Import from a device
      </PageTitle>

      {saved && (
        <Notice role="status" title={`Saved ${saved.readings} daily ${saved.readings === 1 ? "value" : "values"} for ${saved.kinds} ${saved.kinds === 1 ? "measurement" : "measurements"}`} className="mb-5">
          {saved.updated > 0 && `${saved.updated} existing daily ${saved.updated === 1 ? "value was" : "values were"} updated. `}
          <a href={href({ name: "body" })} className="font-medium text-accent">
            See them on Body
          </a>
        </Notice>
      )}

      {!read && (
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-3">
            <h2 className="font-serif text-2xl font-normal">Choose export files</h2>
            <p className="text-ink-2">
              Choose the export's zip file as it is, or the files in it, or the unzipped folder. Several at once is fine. Nothing leaves this computer.
            </p>
            <div className="flex flex-wrap gap-3">
              <label className={cx(pickStyles, busy && "pointer-events-none opacity-50")}>
                Choose files or a zip
                <input type="file" multiple accept=".zip,.csv,.txt,.json,.xml,application/zip,text/csv,application/json,text/xml" disabled={!!busy} onChange={(e) => void onFiles([...(e.target.files ?? [])])} className="sr-only" />
              </label>
              <label className={cx(pickStyles, "bg-surface text-ink border border-line-strong hover:bg-sunken", busy && "pointer-events-none opacity-50")}>
                Choose a folder
                <input type="file" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} disabled={!!busy} onChange={(e) => void onFiles([...(e.target.files ?? [])])} className="sr-only" />
              </label>
            </div>
            {busy && (
              <div role="status" className="flex flex-col gap-2">
                <p className="text-ink-2">
                  Reading {busy.file}
                  {busy.of ? ` (file ${busy.of})` : ""}…
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                  <div className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out" style={{ transform: `scaleX(${Math.max(0.03, busy.fraction)})` }} />
                </div>
              </div>
            )}
          </Card>
          <Card className="flex flex-col gap-2 text-ink-2">
            <h2 className="font-serif text-xl font-normal text-ink">Where to find the files</h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
              {SOURCES.map(([brand, how]) => (
                <li key={brand}>
                  <span className="text-ink">{brand}:</span> {how}
                </li>
              ))}
            </ul>
            <p className="text-sm">
              Other CSV and JSON files work too when their columns are named like "Heart rate", "Resting heart rate", "HRV", "SpO2" or "Weight (kg)", next to a date. Each app
              writes its files a little differently and they change over time; if something isn't recognised, change it in the review, or tell us the column names.
            </p>
          </Card>
        </div>
      )}

      {read && (
        <div className="flex flex-col gap-5">
          {importActions}
          {read.problems.map((p) => (
            <Notice key={p} tone="warn">
              {p}
            </Notice>
          ))}
          {read.rows.length > 0 && (
            <Card className="flex flex-col gap-3">
              <h2 className="font-serif text-2xl font-normal">Found {read.rows.length === 1 ? "one series" : `${read.rows.length} series`}</h2>
              <p className="text-ink-2">One value per day: the average of readings, or the total for sleep and activity. Overlapping daily summaries use one file per day, not their sum. Check what each became, change it if needed, and untick what you don't want.</p>
              <p className="text-sm text-ink-2">Saving replaces existing readings for the same measurement and date, including manually entered readings. Other dates are kept.</p>
              <ul className="flex flex-col divide-y divide-line">
                {read.rows.map((r, i) => (
                  <SeriesRow key={r.key} row={r} earlier={read.rows.slice(0, i)} have={have} onChange={(patch) => update(r.key, patch)} />
                ))}
              </ul>
            </Card>
          )}
          {read.skipped.length > 0 && (
            <Card className="flex flex-col gap-2">
              <h2 className="font-serif text-xl font-normal">Not imported</h2>
              <ul className="flex flex-col gap-1 text-sm text-ink-2">
                {read.skipped.map((s) => (
                  <li key={`${s.file}|${s.what}`}>
                    <span className="text-ink">{s.what}</span> ({s.file}): {s.reason}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {read.empty.length > 0 && (
            <details className="text-sm text-ink-2">
              <summary className="min-h-11 cursor-pointer py-2">
                {read.empty.length} {read.empty.length === 1 ? "file had" : "files had"} nothing to import (settings, goals and the like)
              </summary>
              <p className="break-words">{[...new Set(read.empty)].slice(0, 60).join(", ")}{read.empty.length > 60 ? "…" : ""}</p>
            </details>
          )}
          {read.ignored.some((i) => i.columns.length) && (
            <details className="text-sm text-ink-2">
              <summary className="min-h-11 cursor-pointer py-2">Other columns in the files (not body measurements)</summary>
              {read.ignored.map((i) => (
                <p key={i.file} className="break-words">
                  {i.file}: {i.columns.join(", ")}
                </p>
              ))}
            </details>
          )}
          {importActions}
        </div>
      )}
    </>
  );
}

function SeriesRow({ row: r, earlier, have, onChange }: { row: Row; earlier: Row[]; have: ReadonlySet<string>; onChange: (patch: (r: Row) => Row) => void }) {
  const def = BIOMARKER_MAP.get(r.series.field)!;
  const s = r.series;
  const first = s.days[0];
  const last = s.days.at(-1);
  const already = s.days.filter((d) => have.has(`${s.field}|${d.date}`)).length;
  const matchedUnit = matchUnit(def, s.unit);
  const unitOk = !!matchedUnit;
  // Only a real choice (kg or lb), not names for the same thing (bpm or /min).
  const unitsDiffer = new Set(listUnits(def).map((u) => toCanonical(def, 1, u))).size > 1;
  const median = [...s.days].sort((a, b) => a.value - b.value)[Math.floor(s.days.length / 2)]?.value ?? 0;
  const looksLikePounds = s.field === "weight" && matchUnit(def, s.unit) === "kg" && median > 130;
  // Another ticked series above gives the same measurement on some of the same days.
  const dates = new Set(s.days.map((d) => d.date));
  const overlap = r.include
    ? earlier
        .filter((o) => o.include && o.series.field === s.field)
        .map((o) => ({ o, n: o.series.days.filter((d) => dates.has(d.date)).length }))
        .find((x) => x.n > 0)
    : undefined;
  return (
    <li className={cx("flex flex-wrap items-start gap-x-4 gap-y-2 py-3", !r.include && "opacity-70")}>
      <Checkbox.Root
        checked={r.include && unitOk && s.days.length > 0}
        disabled={!unitOk || s.days.length === 0}
        onCheckedChange={(include) => onChange((x) => ({ ...x, include }))}
        aria-label={`Import ${s.from} as ${def.name}`}
        className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent"
      >
        <Checkbox.Indicator className="flex data-unchecked:hidden">
          <CheckIcon />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm text-ink-2">
          <span className="font-mono text-xs">{s.from}</span> · {r.file}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-2">as</span>
          {r.remap ? <FieldSelect value={s.field} onChange={(f) => onChange((x) => ({ ...x, series: x.remap!(f) }))} /> : <span className="font-medium">{def.name}</span>}
          {r.remap && unitsDiffer && (
            <>
              <span className="text-ink-2">in</span>
              <UnitSelect compact labelClassName="sr-only" label="Unit in the file" units={listUnits(def)} value={matchUnit(def, s.unit) ?? s.unit} onChange={(u) => onChange((x) => ({ ...x, series: x.remap!(s.field, u) }))} />
            </>
          )}
        </div>
        <p className="text-sm text-ink-2">
          {first && last ? <>{s.days.length} {s.days.length === 1 ? "day" : "days"}, {formatDate(first.date)} – {formatDate(last.date)} · latest{" "}
          {SLEEP_FIELDS.has(s.field) && matchedUnit ? showValue(def, toCanonical(def, last.value, matchedUnit), def.canonicalUnit) : `${last.value} ${s.unit}`}</> : "No usable readings for this measurement and unit. Change the mapping or unit to try again."}
          {already > 0 && ` · ${already} already saved, will be updated`}
          {s.dropped > 0 && ` · ${s.dropped} impossible ${s.dropped === 1 ? "reading" : "readings"} left out`}
          {!!s.reconciled && ` · ${s.reconciled} overlapping summary or sample ${s.reconciled === 1 ? "row" : "rows"} left out; one summary file is used per day`}
        </p>
        {overlap && (
          <p className="text-sm text-warn">
            Overlaps with "{overlap.o.series.from}" above on {overlap.n} {overlap.n === 1 ? "day" : "days"}; on those days the one above is used. If they measure
            different things (for example heart rate taken only at night), untick one.
          </p>
        )}
        {looksLikePounds && <p className="text-sm text-warn">These numbers look like pounds. If they are, choose lb as the unit.</p>}
        {!unitOk && <p className="text-sm text-warn">The unit "{s.unit}" doesn't fit {shortName(def)}, so this can't be imported as it.</p>}
      </div>
    </li>
  );
}

function FieldSelect({ value, onChange }: { value: BodyField; onChange: (f: BodyField) => void }) {
  const items = BODY_FIELDS.map((f) => ({ value: f, label: BIOMARKER_MAP.get(f)!.name }));
  return (
    <Select.Root items={items} value={value} onValueChange={(v) => v && onChange(v as BodyField)}>
      <Select.Trigger aria-label="Import as" className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 text-ink select-none hover:bg-sunken">
        <Select.Value className="truncate" />
        <Select.Icon className="text-ink-2">
          <ChevronDownIcon />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="z-50 outline-none select-none" sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className="min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-lg border border-line bg-surface py-1 text-ink shadow-lg transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Select.List className="max-h-[min(22rem,var(--available-height))] overflow-y-auto">
              {items.map((it) => (
                <Select.Item key={it.value} value={it.value} className="flex min-h-10 cursor-default items-center gap-2 px-3 outline-none data-highlighted:bg-sunken">
                  <Select.ItemIndicator className="w-4 text-accent">
                    <CheckIcon />
                  </Select.ItemIndicator>
                  <Select.ItemText>{it.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
