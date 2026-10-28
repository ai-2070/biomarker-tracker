import { useId, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { todayIso } from "../../core/dates";
import { parseLabText, type ParsedReport } from "../../core/importers/labText";
import { validateManualEntry } from "../../core/importers/manual";
import { flagMeasurement, isAlreadySaved, isCritical } from "../../core/trends";
import { listUnits } from "../../core/units";
import type { Measurement } from "../../core/types";
import { addMeasurements } from "../../db/db";
import { uploadFile, useProfiles } from "../profiles";
import { BiomarkerPicker } from "../components/BiomarkerPicker";
import { CriticalBanner } from "../components/CriticalBanner";
import { UnitSelect } from "../components/UnitSelect";
import { Button, Card, CheckIcon, FlagBadge, LinkButton, Notice, PageTitle, cx, errorStyles, inputStyles, labelStyles } from "../components/ui";
import { formatDate, showMeasurement } from "../format";
import { useAllMeasurements, useProfile } from "../hooks";
import { BIOMARKERS, BIOMARKER_MAP, fullName } from "../knowledge";
import { href } from "../router";

interface Row {
  key: string;
  include: boolean;
  biomarkerId: string | null;
  value: string;
  unit: string;
  labLow: string;
  labHigh: string;
  line: string;
  problems: string[];
  notes: string[];
  error?: string;
}

type Step =
  | { name: "pick" }
  | { name: "review"; fileName: string; file?: File; ocr: boolean; report: ParsedReport }
  | { name: "done"; saved: Measurement[]; skipped: number; kept?: string; keepError?: string };

// US-style dates (month first) only for US English.
const monthFirst = typeof navigator !== "undefined" && navigator.language === "en-US";

export function ImportPage() {
  const [step, setStep] = useState<Step>({ name: "pick" });
  const { mode, active } = useProfiles();

  /** After saving, the PDF itself goes into the profile folder, next to the results read from it. */
  async function saved(saved: Measurement[], skipped: number, file: File | undefined, date: string | undefined) {
    if (!file || mode !== "folders" || !active) return setStep({ name: "done", saved, skipped });
    try {
      const f = await uploadFile(active.id, file, `Lab report${date ? ` from ${date}` : ""}, ${saved.length} ${saved.length === 1 ? "result" : "results"} saved`);
      setStep({ name: "done", saved, skipped, kept: f.originalName });
    } catch (e) {
      setStep({ name: "done", saved, skipped, keepError: e instanceof Error ? e.message : "unknown error" });
    }
  }

  return (
    <>
      <PageTitle sub="Read results from a lab report PDF or a photo of one. You check every value before anything is saved.">Import a lab report</PageTitle>
      {step.name === "pick" && (
        <PickFile
          onParsed={(fileName, text, file, ocr) => setStep({ name: "review", fileName, ocr, ...(file ? { file } : {}), report: parseLabText(text, BIOMARKERS, { monthFirst }) })}
        />
      )}
      {step.name === "review" && (
        <Review
          fileName={step.fileName}
          ocr={step.ocr}
          report={step.report}
          onCancel={() => setStep({ name: "pick" })}
          onSaved={(list, skipped, date) => void saved(list, skipped, step.file, date)}
        />
      )}
      {step.name === "done" && (
        <>
          {step.kept && (
            <Notice role="status" className="mb-4">
              The report <span className="font-medium text-ink">{step.kept}</span> is kept in this profile's folder (Settings → Your data → Files).
            </Notice>
          )}
          {step.keepError && (
            <Notice tone="warn" className="mb-4">
              The results were saved, but the report couldn't be kept in the profile folder: {step.keepError}
            </Notice>
          )}
          <Done saved={step.saved} skipped={step.skipped} onAnother={() => setStep({ name: "pick" })} />
        </>
      )}
    </>
  );
}

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

function PickFile({ onParsed }: { onParsed: (fileName: string, text: string, file: File | undefined, ocr: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ fraction: number; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    setProgress(null);
    const report = (fraction: number, stage: string) => setProgress({ fraction, stage });
    try {
      if (isPdf(file)) {
        const { readPdfText } = await import("../pdf");
        const r = await readPdfText(file, report);
        onParsed(file.name, r.text, file, r.ocr);
      } else if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
        const { readImageText } = await import("../ocr");
        onParsed(file.name, await readImageText(file, report), file, true);
      } else {
        throw new Error("Choose a PDF or a photo (JPG, PNG or WebP).");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "This file couldn't be read.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">Choose a PDF or a photo</h2>
        <p className="text-ink-2">
          Read on this device: nothing is uploaded anywhere, also not to an AI model. Names, birth dates and ID numbers in the report are ignored;
          only the values you confirm are saved.
        </p>
        <p className="text-sm text-ink-2">
          For photos: lay the page flat, use good light, and take it straight from above with the whole table in the picture. On a phone you can take
          the photo right here.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Lab report PDF or photo</span>
          <input
            type="file"
            accept="application/pdf,.pdf,image/*"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="min-h-11 text-base file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent file:px-4 file:text-base file:font-medium file:text-accent-ink"
          />
        </label>
        {busy && (
          <div role="status" className="flex animate-fade flex-col gap-2">
            <p className="text-ink-2">{progress ? `${progress.stage}…` : "Reading…"}</p>
            {progress && (
              <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                <div className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out" style={{ transform: `scaleX(${Math.max(0.03, progress.fraction)})` }} />
              </div>
            )}
            {progress && <p className="text-sm text-ink-2">The first time, the text recognition files are loaded (about 10 MB, from this app). Later it's faster.</p>}
          </div>
        )}
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">Or paste the text</h2>
        <p className="text-ink-2">If your lab shows results on a website, copy the table and paste it here.</p>
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className="sr-only">Report text</Field.Label>
          <Field.Control
            render={<textarea rows={6} />}
            value={pasted}
            onValueChange={setPasted}
            placeholder={"Ferritin   45   µg/L   15 - 150\nHaemoglobin   138   g/L   120 - 155"}
            className={`${inputStyles} py-2 font-mono text-sm`}
          />
        </Field.Root>
        <div>
          <Button variant="secondary" disabled={pasted.trim() === ""} onClick={() => onParsed("Pasted text", pasted, undefined, false)}>
            Read pasted text
          </Button>
        </div>
      </Card>

      <p className="text-sm text-ink-2">
        Works with PDFs that contain text, from most labs. Scanned paper reports (photos) can't be read yet.
      </p>
    </div>
  );
}

function Review({
  fileName,
  ocr,
  report,
  onCancel,
  onSaved,
}: {
  fileName: string;
  ocr: boolean;
  report: ParsedReport;
  onCancel: () => void;
  onSaved: (saved: Measurement[], skipped: number, date: string) => void;
}) {
  const existing = useAllMeasurements();
  const today = todayIso();
  const [date, setDate] = useState(report.date ?? "");
  const [dateError, setDateError] = useState<string | undefined>();
  const [lab, setLab] = useState("");
  const [rows, setRows] = useState<Row[]>(() =>
    report.rows.map((r, i) => ({
      key: String(i),
      include: r.problems.length === 0,
      biomarkerId: r.biomarkerId,
      value: r.value,
      unit: r.unit ?? "",
      labLow: r.labLow ?? "",
      labHigh: r.labHigh ?? "",
      line: r.line,
      problems: r.problems,
      notes: r.notes,
    })),
  );
  const [saving, setSaving] = useState(false);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, error: undefined } : r)));
  const included = rows.filter((r) => r.include);

  async function save() {
    const checked = included.map((r) => ({
      r,
      v: validateManualEntry(
        { biomarkerId: r.biomarkerId ?? "", value: r.value, unit: r.unit, date, labLow: r.labLow, labHigh: r.labHigh, lab },
        BIOMARKER_MAP,
        today,
        ocr ? "photo" : "pdf",
      ),
    }));
    const dateProblem = checked.find(({ v }) => !v.ok && v.errors.date);
    setDateError(dateProblem && !dateProblem.v.ok ? dateProblem.v.errors.date : date ? undefined : "Enter the date of the blood test.");
    const bad = checked.filter(({ v }) => !v.ok);
    if (bad.length > 0 || !date) {
      setRows((rs) =>
        rs.map((r) => {
          const hit = bad.find((b) => b.r.key === r.key);
          if (!hit || hit.v.ok) return r;
          const { date: _d, ...rest } = hit.v.errors;
          return { ...r, error: Object.values(rest).filter(Boolean).join(" ") || undefined };
        }),
      );
      return;
    }
    const toSave: Omit<Measurement, "id">[] = [];
    let skipped = 0;
    for (const { v } of checked) {
      if (!v.ok) continue;
      if (isAlreadySaved(existing ?? [], v.measurement)) skipped++;
      else toSave.push(v.measurement);
    }
    setSaving(true);
    try {
      onSaved(await addMeasurements(toSave), skipped, date);
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0) {
    return (
      <Card className="flex flex-col gap-3">
        <p>No results were recognised in {fileName}.</p>
        {report.unmatched.length > 0 && <Unmatched lines={report.unmatched} />}
        <p className="text-ink-2">The layout may be unusual for this reader. You can still add the values by hand.</p>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={href({ name: "add" })}>Add by hand</LinkButton>
          <Button variant="secondary" onClick={onCancel}>
            Try another file
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4">
        {ocr && (
          <Notice tone="warn" title="Read from a picture: check every value">
            Text recognition can misread letters and numbers, for example 0 and O, 1 and 7, or a missing decimal point. Compare each value and unit with
            the report before saving.
          </Notice>
        )}
        <p className="text-ink-2">
          Found <span className="font-medium text-ink">{rows.length}</span> results in {fileName}. Compare each one with your report, fix
          anything that's wrong, and untick rows you don't want.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field.Root invalid={!!dateError} className="flex flex-col gap-1.5">
            <Field.Label className={labelStyles}>Date of the blood test</Field.Label>
            <Field.Control
              type="date"
              value={date}
              max={today}
              onValueChange={(v) => {
                setDate(v);
                setDateError(undefined);
              }}
              className={inputStyles}
            />
            <Field.Error match={!!dateError} className={errorStyles}>
              {dateError}
            </Field.Error>
          </Field.Root>
          <Field.Root className="flex flex-col gap-1.5">
            <Field.Label className={labelStyles}>Lab name (optional)</Field.Label>
            <Field.Control value={lab} onValueChange={setLab} autoComplete="off" className={inputStyles} />
          </Field.Root>
        </div>
        {!report.date && <Notice tone="warn">No sample date was found in the report. Please enter it.</Notice>}
        {report.dateNote && <Notice tone="warn">{report.dateNote}</Notice>}
      </Card>

      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.key}>
            <RowEditor row={r} onChange={(patch) => update(r.key, patch)} />
          </li>
        ))}
      </ul>

      {report.unmatched.length > 0 && (
        <Card>
          <Unmatched lines={report.unmatched} />
        </Card>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-page/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <Button onClick={() => void save()} disabled={saving || included.length === 0}>
          Save {included.length} {included.length === 1 ? "result" : "results"}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function RowEditor({ row, onChange }: { row: Row; onChange: (patch: Partial<Row>) => void }) {
  const [changing, setChanging] = useState(false);
  const def = row.biomarkerId ? BIOMARKER_MAP.get(row.biomarkerId) : undefined;
  const checkId = useId();
  const blocked = row.problems.length > 0 && !row.include;

  return (
    <div className={cx("rounded-xl border bg-surface p-4", row.include ? "border-line-strong" : "border-line opacity-80", row.error && "border-danger")}>
      <div className="flex items-start gap-3">
        <Checkbox.Root
          id={checkId}
          checked={row.include}
          onCheckedChange={(include) => onChange({ include })}
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent"
        >
          <Checkbox.Indicator className="flex data-unchecked:hidden">
            <CheckIcon />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={checkId} className="font-medium">
              {def ? fullName(def) : "Unknown marker"}
              <span className="sr-only">, include this result</span>
            </label>
            <button type="button" onClick={() => setChanging((c) => !c)} className="min-h-11 px-2 text-sm text-ink-2 underline underline-offset-2">
              {changing ? "Done" : "Wrong marker?"}
            </button>
          </div>
          {changing && (
            <BiomarkerPicker
              value={row.biomarkerId}
              onChange={(id) => onChange({ biomarkerId: id, unit: id ? BIOMARKER_MAP.get(id)!.canonicalUnit : "", problems: [] })}
            />
          )}

          <p className="rounded-md bg-sunken px-2 py-1 font-mono text-xs break-words text-ink-2">
            <span className="sr-only">From the report: </span>
            {row.line}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field.Root className="flex flex-col gap-1">
              <Field.Label className="text-sm text-ink-2">Result</Field.Label>
              <Field.Control value={row.value} onValueChange={(value) => onChange({ value })} inputMode="decimal" className={inputStyles} />
            </Field.Root>
            <UnitSelect labelClassName="text-sm text-ink-2" label="Unit" units={def ? listUnits(def) : []} value={row.unit} onChange={(unit) => onChange({ unit, problems: [] })} disabled={!def} />
            <Field.Root className="flex flex-col gap-1">
              <Field.Label className="text-sm text-ink-2">Range from</Field.Label>
              <Field.Control value={row.labLow} onValueChange={(labLow) => onChange({ labLow })} inputMode="decimal" className={inputStyles} />
            </Field.Root>
            <Field.Root className="flex flex-col gap-1">
              <Field.Label className="text-sm text-ink-2">Range to</Field.Label>
              <Field.Control value={row.labHigh} onValueChange={(labHigh) => onChange({ labHigh })} inputMode="decimal" className={inputStyles} />
            </Field.Root>
          </div>

          {row.problems.map((p) => (
            <p key={p} className={blocked ? "text-sm font-medium text-warn" : "text-sm text-ink-2"}>
              {p}
              {blocked && " Not ticked, so it won't be saved."}
            </p>
          ))}
          {row.notes.map((n) => (
            <p key={n} className="text-sm text-ink-2">
              {n}
            </p>
          ))}
          {row.error && (
            <p role="alert" className={errorStyles}>
              {row.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Unmatched({ lines }: { lines: string[] }) {
  return (
    <details>
      <summary className="min-h-11 cursor-pointer py-2 text-ink-2">
        {lines.length} {lines.length === 1 ? "line looks" : "lines look"} like results for markers this app doesn't track yet
      </summary>
      <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-ink-2">
        {lines.map((l, i) => (
          <li key={i} className="break-words">
            {l}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Done({ saved, skipped, onAnother }: { saved: Measurement[]; skipped: number; onAnother: () => void }) {
  const profile = useProfile();
  const flagged = saved.map((m) => ({ m, def: BIOMARKER_MAP.get(m.biomarkerId)!, flag: flagMeasurement(BIOMARKER_MAP.get(m.biomarkerId)!, m, profile) }));
  const critical = flagged.filter((f) => isCritical(f.flag)).map((f) => ({ def: f.def, measurement: f.m, low: f.flag === "critical-low" }));

  return (
    <div className="flex flex-col gap-5">
      <CriticalBanner items={critical} />
      <Notice role="status" title={`Saved ${saved.length} ${saved.length === 1 ? "result" : "results"}`}>
        {saved[0] && `From the blood test on ${formatDate(saved[0].date)}.`}
        {skipped > 0 && ` ${skipped} ${skipped === 1 ? "was" : "were"} already saved and skipped.`}
      </Notice>
      {flagged.length > 0 && (
        <Card>
          <ul className="flex flex-col divide-y divide-line">
            {flagged.map(({ m, def, flag }) => (
              <li key={m.id}>
                <a href={href({ name: "marker", id: def.id })} className="flex min-h-11 items-center justify-between gap-3 py-2 text-ink no-underline hover:bg-sunken">
                  <span className="min-w-0 truncate">{fullName(def)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">
                      {showMeasurement(def, m, def.canonicalUnit)} {def.canonicalUnit}
                    </span>
                    <FlagBadge flag={flag} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        <LinkButton href={href({ name: "overview" })}>See all results</LinkButton>
        <Button variant="secondary" onClick={onAnother}>
          Import another report
        </Button>
      </div>
    </div>
  );
}
