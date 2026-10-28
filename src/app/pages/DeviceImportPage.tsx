import { useMemo, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Select } from "@base-ui/react/select";
import { BODY_FIELDS, type BodyField } from "../../core/body";
import {
  DailyTally,
  appleRecords,
  columnReadings,
  dailyAverages,
  findDateColumn,
  guessColumn,
  parseCsv,
  safeCut,
  tableOf,
  type DailySeries,
} from "../../core/importers/deviceFiles";
import type { Measurement } from "../../core/types";
import { matchUnit, toCanonical } from "../../core/units";
import { addMeasurements } from "../../db/db";
import { monthFirst } from "../components/LabReview";
import { Button, Card, CheckIcon, ChevronDownIcon, LinkButton, Notice, PageTitle, cx } from "../components/ui";
import { formatDate } from "../format";
import { useAllMeasurements } from "../hooks";
import { BIOMARKER_MAP, shortName } from "../knowledge";
import { href } from "../router";

/** One importable series: a column or an Apple Health type, one value per day. */
interface Row {
  key: string;
  file: string;
  include: boolean;
  /** Re-averages the raw readings for another measurement, if the person changes it. */
  remap?: (field: BodyField) => DailySeries;
  series: DailySeries;
}

interface Read {
  rows: Row[];
  skipped: { file: string; what: string; reason: string }[];
  ignored: { file: string; columns: string[] }[];
  problems: string[];
}

const canonicalOf = (field: BodyField, unit: string) => {
  const def = BIOMARKER_MAP.get(field)!;
  const u = matchUnit(def, unit);
  return (v: number) => (u ? toCanonical(def, v, u) : NaN);
};

async function readCsv(file: File): Promise<Omit<Read, "problems">> {
  const table = tableOf(parseCsv(await file.text()));
  if (!table) return { rows: [], skipped: [], ignored: [{ file: file.name, columns: [] }] };
  const dateCol = findDateColumn(table.headers, table.data, monthFirst);
  if (dateCol === -1) return { rows: [], skipped: [{ file: file.name, what: "the whole file", reason: "No column with dates was found." }], ignored: [] };
  const rows: Row[] = [];
  const skipped: Read["skipped"] = [];
  const ignored: string[] = [];
  table.headers.forEach((h, i) => {
    if (i === dateCol) return;
    const g = guessColumn(h, i);
    if (!g) return void ignored.push(h);
    if (!g.field) return void skipped.push({ file: file.name, what: h, reason: g.reason ?? "Not used." });
    const readings = columnReadings(table.data, dateCol, g, monthFirst);
    const make = (field: BodyField) => {
      const unit = field === g.field ? g.unit : BIOMARKER_MAP.get(field)!.canonicalUnit;
      return dailyAverages(field, unit, h, readings, canonicalOf(field, unit));
    };
    const series = make(g.field);
    if (series.days.length > 0) rows.push({ key: `${file.name}|${i}`, file: file.name, include: true, remap: make, series });
  });
  return { rows, skipped, ignored: ignored.length ? [{ file: file.name, columns: ignored }] : [] };
}

/** Apple Health's export.xml, read in pieces so a file of a gigabyte or more works. */
async function readAppleXml(file: File, progress: (f: number) => void): Promise<Omit<Read, "problems">> {
  const tally = new DailyTally();
  const skippedTypes = new Map<string, string>();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      read += value.byteLength;
      progress(read / file.size);
    }
    const text = carry + (value ? decoder.decode(value, { stream: !done }) : decoder.decode());
    const cut = done ? text.length : safeCut(text);
    for (const r of appleRecords(text.slice(0, cut), skippedTypes)) tally.add(r.key.replace("HKQuantityTypeIdentifier", ""), r.field, r.unit, r.date, r.value, canonicalOf(r.field, r.unit));
    carry = text.slice(cut);
    if (done) break;
  }
  const rows: Row[] = tally.series().filter((s) => s.days.length > 0).map((series) => ({ key: `${file.name}|${series.from}`, file: file.name, include: true, series }));
  return { rows, skipped: [...skippedTypes].map(([what, reason]) => ({ file: file.name, what, reason })), ignored: [] };
}

export function DeviceImportPage() {
  const existing = useAllMeasurements();
  const [read, setRead] = useState<Read | null>(null);
  const [busy, setBusy] = useState<{ file: string; fraction: number } | null>(null);
  const [saved, setSaved] = useState<{ readings: number; kinds: number; already: number } | null>(null);

  async function onFiles(files: File[]) {
    setSaved(null);
    const out: Read = { rows: [], skipped: [], ignored: [], problems: [] };
    for (const f of files) {
      setBusy({ file: f.name, fraction: 0 });
      try {
        const r = /\.xml$/i.test(f.name) ? await readAppleXml(f, (fraction) => setBusy({ file: f.name, fraction })) : await readCsv(f);
        out.rows.push(...r.rows);
        out.skipped.push(...r.skipped);
        out.ignored.push(...r.ignored);
        if (r.rows.length === 0 && r.skipped.length === 0) out.problems.push(`${f.name}: no heart rate, HRV, blood oxygen, weight or blood pressure columns were recognised.`);
      } catch (e) {
        out.problems.push(`${f.name}: ${e instanceof Error ? e.message : "couldn't be read"}.`);
      }
    }
    setBusy(null);
    setRead(out);
  }

  const have = useMemo(() => new Set((existing ?? []).map((m) => `${m.biomarkerId}|${m.date}`)), [existing]);

  async function save() {
    if (!read) return;
    const taken = new Set(have);
    const toSave: Omit<Measurement, "id">[] = [];
    let already = 0;
    const kinds = new Set<string>();
    for (const r of read.rows.filter((x) => x.include)) {
      const def = BIOMARKER_MAP.get(r.series.field)!;
      const unit = matchUnit(def, r.series.unit);
      if (!unit) continue;
      for (const d of r.series.days) {
        const k = `${def.id}|${d.date}`;
        if (taken.has(k)) {
          already++;
          continue;
        }
        taken.add(k);
        kinds.add(def.id);
        toSave.push({
          biomarkerId: def.id,
          value: toCanonical(def, d.value, unit),
          originalValue: d.value,
          originalUnit: unit,
          date: d.date,
          source: "device",
          note: `${r.file}: ${r.series.from}${d.readings > 1 ? `, average of ${d.readings} readings` : ""}`,
        });
      }
    }
    await addMeasurements(toSave);
    setSaved({ readings: toSave.length, kinds: kinds.size, already });
    setRead(null);
  }

  const update = (key: string, patch: (r: Row) => Row) => setRead((s) => (s ? { ...s, rows: s.rows.map((r) => (r.key === key ? patch(r) : r)) } : s));

  return (
    <>
      <a href={href({ name: "body" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Body
      </a>
      <PageTitle sub="Heart rate, resting heart rate, HRV, blood oxygen, workouts, weight and blood pressure from the files your watch, ring or phone app exports. Read on this computer; you check everything before it's saved.">
        Import from a device
      </PageTitle>

      {saved && (
        <Notice role="status" title={`Saved ${saved.readings} daily ${saved.readings === 1 ? "value" : "values"} for ${saved.kinds} ${saved.kinds === 1 ? "measurement" : "measurements"}`} className="mb-5">
          {saved.already > 0 && `${saved.already} ${saved.already === 1 ? "day was" : "days were"} already saved and skipped. `}
          <a href={href({ name: "body" })} className="font-medium text-accent">
            See them on Body
          </a>
        </Notice>
      )}

      {!read && (
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-3">
            <h2 className="font-serif text-2xl font-normal">Choose export files</h2>
            <p className="text-ink-2">You can choose several at once. Nothing leaves this computer.</p>
            <label className="flex flex-col gap-1.5">
              <span className="sr-only">Export files</span>
              <input
                type="file"
                multiple
                accept=".csv,.txt,.xml,text/csv,text/xml,application/xml"
                disabled={!!busy}
                onChange={(e) => void onFiles([...(e.target.files ?? [])])}
                className="min-h-11 text-base file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent file:px-4 file:text-base file:font-medium file:text-accent-ink"
              />
            </label>
            {busy && (
              <div role="status" className="flex flex-col gap-2">
                <p className="text-ink-2">Reading {busy.file}…</p>
                <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                  <div className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out" style={{ transform: `scaleX(${Math.max(0.03, busy.fraction)})` }} />
                </div>
              </div>
            )}
          </Card>
          <Card className="flex flex-col gap-2 text-ink-2">
            <h2 className="font-serif text-xl font-normal text-ink">Where to find the files</h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
              <li>
                <span className="text-ink">Google Fit:</span> takeout.google.com → Fit → unzip, then choose "Daily activity metrics.csv".
              </li>
              <li>
                <span className="text-ink">Samsung Health:</span> Settings → Download personal data → unzip, then choose the heart_rate, oxygen_saturation or weight CSV files.
              </li>
              <li>
                <span className="text-ink">Oura:</span> membership.ouraring.com → Export data → CSV.
              </li>
              <li>
                <span className="text-ink">Garmin:</span> Garmin Connect → Reports → export a report as CSV (resting heart rate, HRV status, weight).
              </li>
              <li>
                <span className="text-ink">Apple Health:</span> Health app → your picture → Export All Health Data → unzip, then choose export.xml. Apple's HRV is a different measure (SDNN) and isn't imported.
              </li>
            </ul>
            <p className="text-sm">Other CSV files work too when their columns are named like "Heart rate", "Resting heart rate", "HRV", "SpO2" or "Weight (kg)", next to a date column.</p>
          </Card>
        </div>
      )}

      {read && (
        <div className="flex flex-col gap-5">
          {read.problems.map((p) => (
            <Notice key={p} tone="warn">
              {p}
            </Notice>
          ))}
          {read.rows.length > 0 && (
            <Card className="flex flex-col gap-3">
              <h2 className="font-serif text-2xl font-normal">Found {read.rows.length === 1 ? "one series" : `${read.rows.length} series`}</h2>
              <p className="text-ink-2">One value per day: the average of that day's readings. Check what each became, change it if needed, and untick what you don't want.</p>
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={!read.rows.some((r) => r.include)}>
              Save
            </Button>
            <Button variant="quiet" onClick={() => setRead(null)}>
              Choose other files
            </Button>
            <LinkButton variant="quiet" href={href({ name: "body" })}>
              Cancel
            </LinkButton>
          </div>
        </div>
      )}
    </>
  );
}

function SeriesRow({ row: r, earlier, have, onChange }: { row: Row; earlier: Row[]; have: ReadonlySet<string>; onChange: (patch: (r: Row) => Row) => void }) {
  const def = BIOMARKER_MAP.get(r.series.field)!;
  const s = r.series;
  const first = s.days[0]!;
  const last = s.days.at(-1)!;
  const already = s.days.filter((d) => have.has(`${s.field}|${d.date}`)).length;
  const unitOk = !!matchUnit(def, s.unit);
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
        checked={r.include && unitOk}
        disabled={!unitOk}
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
        </div>
        <p className="text-sm text-ink-2">
          {s.days.length} {s.days.length === 1 ? "day" : "days"}, {formatDate(first.date)} – {formatDate(last.date)} · latest {last.value} {s.unit}
          {already > 0 && ` · ${already} already saved, skipped`}
          {s.dropped > 0 && ` · ${s.dropped} impossible ${s.dropped === 1 ? "reading" : "readings"} left out`}
        </p>
        {overlap && (
          <p className="text-sm text-warn">
            Overlaps with "{overlap.o.series.from}" above on {overlap.n} {overlap.n === 1 ? "day" : "days"}; on those days the one above is used. If they measure
            different things (for example heart rate taken only at night), untick one.
          </p>
        )}
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
