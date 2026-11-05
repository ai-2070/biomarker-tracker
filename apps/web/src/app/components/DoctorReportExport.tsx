import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { addDays, todayIso } from "@bt/core/dates";
import { buildDoctorReport, type DoctorReport } from "@bt/core/doctorReport";
import { buildTestSummary } from "@bt/core/testSummary";
import type { Measurement, Profile } from "@bt/core/types";
import { useDisplayUnits, useProtocols } from "../hooks";
import { BIOMARKER_MAP, CATEGORY_ORDER, NUTRIENTS, fullName } from "../knowledge";
import { formatDate } from "../format";
import { DoctorReportDocument, DOCTOR_REPORT_PRINT_CSS } from "./DoctorReportDocument";
import { Button, Card, CheckIcon, Notice, inputStyles, labelStyles } from "./ui";

/** A reviewable, local handout. PDF creation uses the browser's own print destination. */
export function DoctorReportExport({ measurements, profile }: { measurements: Measurement[]; profile: Profile }) {
  const today = todayIso();
  const protocols = useProtocols();
  const createButtonId = useId();
  const units = useDisplayUnits();
  const [from, setFrom] = useState(() => addDays(today, -365));
  const [to, setTo] = useState(today);
  const [includeProfile, setIncludeProfile] = useState(true);
  const [includeLog, setIncludeLog] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeQuestions, setIncludeQuestions] = useState(true);
  const [selection, setSelection] = useState<Set<string> | undefined>();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [error, setError] = useState("");
  const preview = useRef<HTMLHeadingElement>(null);
  const choices = useMemo(() => {
    const ids = new Set(measurements.map((m) => m.biomarkerId));
    return [...BIOMARKER_MAP.values()].filter((def) => ids.has(def.id)).sort((a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  }, [measurements]);
  const chosen = choices.filter((def) => selection === undefined || selection.has(def.id));

  // A changed underlying profile/result must not leave an older, shareable preview on screen.
  useEffect(() => { setReport(null); }, [measurements, profile, protocols]);
  useEffect(() => {
    if (!report || !preview.current) return;
    preview.current.focus({ preventScroll: true });
    preview.current.scrollIntoView({ block: "start" });
  }, [report]);

  function change(update: () => void) {
    update();
    setReport(null);
    setError("");
  }

  function generate() {
    if (!protocols) return;
    setError("");
    try {
      const built = buildDoctorReport({ measurements, protocols, profile, defs: BIOMARKER_MAP, generatedOn: todayIso(), options: {
        from, to, markerIds: chosen.map((def) => def.id), includeProfile, includeLog, includeNotes,
      } });
      // Questions from the latest blood test in the period, the same ones as on the Test summary page.
      const lastTest = measurements.filter((m) => m.date >= from && m.date <= to && BIOMARKER_MAP.get(m.biomarkerId)?.category !== "Body").map((m) => m.date).sort().at(-1);
      const summary = includeQuestions && lastTest
        ? buildTestSummary({ measurements: measurements.filter((m) => m.date <= lastTest), defs: BIOMARKER_MAP, profile, protocols, nutrients: NUTRIENTS, date: lastTest, categoryOrder: CATEGORY_ORDER, formatDate })
        : undefined;
      setReport(summary ? { ...built, questions: { testDate: summary.date, items: summary.questions } } : built);
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : "Couldn't create this report. Check the dates and try again.");
    }
  }

  function print() {
    if (!report) return;
    setError("");
    if (typeof window.print !== "function") {
      setError("This browser cannot print. Open the app in a browser with Print / Save as PDF support.");
      return;
    }
    const originalTitle = document.title;
    try {
      document.title = `Doctor report ${report.generatedOn}`;
      window.print();
    } catch {
      setError("The print window could not open. Try your browser's Print command and choose Save as PDF.");
    } finally {
      document.title = originalTitle;
    }
  }

  return (
    <>
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="font-serif text-2xl font-normal">Doctor-ready report</h2>
          <p className="mt-2 max-w-3xl text-ink-2">Prepare a readable summary for an appointment. Choose what to include, review it, then print or save it as a PDF. No AI or external service is used.</p>
        </div>
        <div className="grid max-w-lg gap-3 sm:grid-cols-2">
          <Field.Root className="flex min-w-0 flex-col gap-1.5">
            <Field.Label className={labelStyles}>Report from</Field.Label>
            <Field.Control type="date" min="1900-01-01" max={to || today} value={from} onValueChange={(value) => change(() => setFrom(value))} className={inputStyles} />
          </Field.Root>
          <Field.Root className="flex min-w-0 flex-col gap-1.5">
            <Field.Label className={labelStyles}>Report to</Field.Label>
            <Field.Control type="date" min={from || "1900-01-01"} max={today} value={to} onValueChange={(value) => change(() => setTo(value))} className={inputStyles} />
          </Field.Root>
        </div>
        <div className="flex flex-col gap-1">
          <ReportCheck checked={includeProfile} onChange={(value) => change(() => setIncludeProfile(value))}>Include profile details, latest weight, BMI, resting metabolic rate, conditions and allergies</ReportCheck>
          <ReportCheck checked={includeLog} onChange={(value) => change(() => setIncludeLog(value))}>Include logged medicines, supplements and habits</ReportCheck>
          <ReportCheck checked={includeNotes} onChange={(value) => change(() => setIncludeNotes(value))}>Include notes from the profile, results and protocol items</ReportCheck>
          <ReportCheck checked={includeQuestions} onChange={(value) => change(() => setIncludeQuestions(value))}>Include questions to discuss, from the latest blood test in this period</ReportCheck>
          <p className="ml-9 max-w-3xl text-sm text-ink-2">The summary shows the latest result. Black-and-white charts include every selected blood and body reading within these dates, without a list of all values. Choose fewer markers or a shorter period to keep the report focused.</p>
        </div>
        <details className="border-y border-line py-1">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Choose measurements ({chosen.length} of {choices.length} selected)</summary>
          <div className="flex flex-col gap-3 pb-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => change(() => setSelection(undefined))}>Select all measurements</Button>
              <Button variant="quiet" onClick={() => change(() => setSelection(new Set()))}>Clear measurement selection</Button>
            </div>
            {choices.length === 0 && <p className="text-sm text-ink-2">No saved measurements yet. The report can still include profile details and logged habits.</p>}
            {CATEGORY_ORDER.filter((category) => choices.some((def) => def.category === category)).map((category) => (
              <fieldset key={category}>
                <legend className="mb-1 text-sm font-medium text-ink-2">{category}</legend>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  {choices.filter((def) => def.category === category).map((def) => (
                    <ReportCheck key={def.id} checked={selection === undefined || selection.has(def.id)} onChange={(checked) => change(() => setSelection((current) => {
                      const next = new Set(current ?? choices.map((choice) => choice.id));
                      if (checked) next.add(def.id); else next.delete(def.id);
                      return next;
                    }))}>{fullName(def)}</ReportCheck>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </details>
        <p className="max-w-3xl text-sm text-ink-2">This contains health information. Review the preview before sharing. Notes are left out unless you select them.</p>
        {error && <Notice tone="danger" title="Report not ready" role="alert">{error}</Notice>}
        <div><Button id={createButtonId} onClick={generate} disabled={protocols === undefined}>Create doctor report</Button></div>
      </Card>
      {report && (
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="doctor-report-preview-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 ref={preview} id="doctor-report-preview-heading" tabIndex={-1} className="scroll-mt-24 font-serif text-2xl outline-none lg:scroll-mt-6">Report preview</h2>
            <div className="flex flex-wrap gap-2">
              <Button onClick={print}>Print / save as PDF</Button>
              <Button variant="secondary" onClick={() => { setReport(null); document.getElementById(createButtonId)?.focus(); }}>Close preview</Button>
            </div>
          </div>
          <p className="text-sm text-ink-2">In the print window, choose <strong>Save as PDF</strong> as the destination. Only the report is printed, not Settings or the app navigation.</p>
          <div className="min-w-0 overflow-x-auto rounded-xl border border-line bg-surface p-4 sm:p-6">
            <DoctorReportDocument report={report} units={units} />
          </div>
        </section>
      )}
      {report && typeof document !== "undefined" && createPortal(
        <div className="doctor-report-print">
          <style>{DOCTOR_REPORT_PRINT_CSS}</style>
          <DoctorReportDocument report={report} units={units} />
        </div>, document.body,
      )}
    </>
  );
}

function ReportCheck({ children, checked, onChange }: { children: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 py-1 text-ink">
      <Checkbox.Root id={id} checked={checked} onCheckedChange={onChange} className="flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent">
        <Checkbox.Indicator className="flex data-unchecked:hidden"><CheckIcon /></Checkbox.Indicator>
      </Checkbox.Root>
      <span>{children}</span>
    </label>
  );
}
