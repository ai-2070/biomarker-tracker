import { useState } from "react";
import { Field } from "@base-ui/react/field";
import { parseLabText, type ParsedReport } from "../../core/importers/labText";
import { flagMeasurement, isCritical } from "../../core/trends";
import type { Measurement } from "../../core/types";
import { uploadFile, useProfiles } from "../profiles";
import { CriticalBanner } from "../components/CriticalBanner";
import { Button, Card, FlagBadge, LinkButton, Notice, PageTitle, inputStyles } from "../components/ui";
import { formatDate, showMeasurement } from "../format";
import { useProfile } from "../hooks";
import { BIOMARKER_MAP, BLOOD_MARKERS, fullName } from "../knowledge";
import { href } from "../router";
import { Review, monthFirst, readReportFile } from "../components/LabReview";

type Step =
  | { name: "pick" }
  | { name: "review"; fileName: string; file?: File; ocr: boolean; report: ParsedReport }
  | { name: "done"; saved: Measurement[]; skipped: number; kept?: string; keepError?: string };

export function ImportPage() {
  const [step, setStep] = useState<Step>({ name: "pick" });
  const { mode, active } = useProfiles();

  /** After saving, the PDF or photo itself goes into the profile folder, next to the results read from it. */
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
          onParsed={(fileName, text, file, ocr) => setStep({ name: "review", fileName, ocr, ...(file ? { file } : {}), report: parseLabText(text, BLOOD_MARKERS, { monthFirst }) })}
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
      const r = await readReportFile(file, report);
      onParsed(file.name, r.text, file, r.ocr);
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
        Works with PDFs from most labs, scanned PDFs and photos of paper reports. Photos and scans are read with text recognition, so check those
        values with extra care.
      </p>
    </div>
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
