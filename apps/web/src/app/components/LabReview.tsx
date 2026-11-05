import { useId, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { todayIso } from "@bt/shared/core/dates";
import type { ParsedReport } from "@bt/shared/core/importers/labText";
import { validateManualEntry } from "@bt/shared/core/importers/manual";
import { isAlreadySaved } from "@bt/shared/core/trends";
import { listUnits } from "@bt/shared/core/units";
import type { Measurement } from "@bt/shared/core/types";
import { addMeasurements } from "../../db/db";
import { BiomarkerPicker } from "./BiomarkerPicker";
import { ChoiceGroup } from "./ChoiceGroup";
import { UnitSelect } from "./UnitSelect";
import { Button, Card, CheckIcon, LinkButton, Notice, cx, errorStyles, inputStyles, labelStyles } from "./ui";
import { useAllMeasurements } from "../hooks";
import { BIOMARKER_MAP, fullName } from "../knowledge";
import { href } from "../router";

// The review step of a lab report import: used by the Import page and by Brain (PDF text, pasted text, and
// results Brain read from photos or scanned pages).

// US-style dates (month first) only for US English.
export const monthFirst = typeof navigator !== "undefined" && navigator.language === "en-US";

export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
export const isImage = (f: File) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);

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

export function Review({
  fileName,
  fromPicture,
  report,
  onCancel,
  onSaved,
  inChat = false,
  kind = "lab",
}: {
  fileName: string;
  /** Read by Brain from photos or scanned pages, not from a PDF's text. */
  fromPicture: boolean;
  report: ParsedReport;
  onCancel: () => void;
  onSaved: (saved: Measurement[], skipped: number, date: string) => void;
  /** Inside Brain: no sticky footer, a "Not now" button. */
  inChat?: boolean;
  /** "body": values from a health app screenshot (no lab, wording about measurements). */
  kind?: "lab" | "body";
}) {
  const existing = useAllMeasurements();
  const today = todayIso();
  const [date, setDate] = useState(report.date ?? "");
  const [dateError, setDateError] = useState<string | undefined>();
  const [lab, setLab] = useState("");
  const [fasted, setFasted] = useState<"yes" | "no" | "unknown">("unknown");
  const [note, setNote] = useState("");
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
        {
          biomarkerId: r.biomarkerId ?? "", value: r.value, unit: r.unit, date, labLow: r.labLow, labHigh: r.labHigh, lab,
          fasted: kind === "lab" && fasted !== "unknown" ? fasted === "yes" : undefined,
          note: kind === "lab" ? note : undefined,
        },
        BIOMARKER_MAP,
        today,
        fromPicture ? "photo" : "pdf",
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
      if (isAlreadySaved(existing ?? [], v.measurement) || isAlreadySaved(toSave, v.measurement)) skipped++;
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
    <div className={cx("flex flex-col", inChat ? "gap-3" : "gap-5")}>
      <Card className="flex flex-col gap-4">
        {fromPicture && (
          <Notice tone="warn" title="Read by Brain from a picture: check every value">
            AI models can misread a number, a unit or a decimal point, or put a value on the wrong row. Compare each value and unit with the{" "}
            {kind === "body" ? "picture" : "report"} before saving.
          </Notice>
        )}
        <p className="text-ink-2">
          Found <span className="font-medium text-ink">{rows.length}</span> {kind === "body" ? "body measurements" : "results"} in {fileName}. Compare each one with your{" "}
          {kind === "body" ? "picture" : "report"}, fix anything that's wrong, and untick rows you don't want.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field.Root invalid={!!dateError} className="flex flex-col gap-1.5">
            <Field.Label className={labelStyles}>{kind === "body" ? "Date measured" : "Date of the blood test"}</Field.Label>
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
          {kind === "lab" && (
            <Field.Root className="flex flex-col gap-1.5">
              <Field.Label className={labelStyles}>Lab name (optional)</Field.Label>
              <Field.Control value={lab} onValueChange={setLab} autoComplete="off" className={inputStyles} />
            </Field.Root>
          )}
        </div>
        {kind === "lab" && (
          <>
            <ChoiceGroup<"yes" | "no" | "unknown">
              label="Were you fasting?"
              help="No food for at least 8 hours before the test. This applies to all results saved from this report."
              value={fasted}
              onChange={setFasted}
              options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unknown", label: "Not sure" }]}
            />
            <Field.Root className="flex flex-col gap-1.5">
              <Field.Label className={labelStyles}>Note (optional)</Field.Label>
              <Field.Control render={<textarea rows={2} />} value={note} onValueChange={setNote} placeholder="e.g. had a cold that week" className={`${inputStyles} py-2`} />
              <p className="text-sm text-ink-2">Added to every result saved from this report.</p>
            </Field.Root>
          </>
        )}
        {!report.date && <Notice tone="warn">No sample date was found in the report. Please enter it.</Notice>}
        {report.dateNote && <Notice tone="warn">{report.dateNote}</Notice>}
      </Card>

      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.key}>
            <RowEditor row={r} kind={kind} onChange={(patch) => update(r.key, patch)} />
          </li>
        ))}
      </ul>

      {report.unmatched.length > 0 && (
        <Card>
          <Unmatched lines={report.unmatched} />
        </Card>
      )}

      <div className={cx("flex flex-wrap items-center gap-3", !inChat && "sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] -mx-4 border-t border-line bg-page/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border lg:bottom-0")}>
        <Button onClick={() => void save()} disabled={saving || included.length === 0}>
          Save {included.length} {included.length === 1 ? "result" : "results"}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {inChat ? "Don't save" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

function RowEditor({ row, kind, onChange }: { row: Row; kind: "lab" | "body"; onChange: (patch: Partial<Row>) => void }) {
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
            <span className="sr-only">As read from the file: </span>
            {row.line}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field.Root className="flex flex-col gap-1">
              <Field.Label className="text-sm text-ink-2">Result</Field.Label>
              <Field.Control value={row.value} onValueChange={(value) => onChange({ value })} inputMode="decimal" className={inputStyles} />
            </Field.Root>
            <UnitSelect labelClassName="text-sm text-ink-2" label="Unit" units={def ? listUnits(def) : []} value={row.unit} onChange={(unit) => onChange({ unit, problems: [] })} disabled={!def} />
            {kind === "lab" && (
              <>
                <Field.Root className="flex flex-col gap-1">
                  <Field.Label className="text-sm text-ink-2">Range from</Field.Label>
                  <Field.Control value={row.labLow} onValueChange={(labLow) => onChange({ labLow })} inputMode="decimal" className={inputStyles} />
                </Field.Root>
                <Field.Root className="flex flex-col gap-1">
                  <Field.Label className="text-sm text-ink-2">Range to</Field.Label>
                  <Field.Control value={row.labHigh} onValueChange={(labHigh) => onChange({ labHigh })} inputMode="decimal" className={inputStyles} />
                </Field.Root>
              </>
            )}
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

