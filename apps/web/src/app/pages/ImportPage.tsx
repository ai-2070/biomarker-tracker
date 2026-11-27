import { Field } from "@base-ui/react/field";
import { providerInfo, takesPictures } from "@bt/shared/core/aiProviders";
import { todayIso } from "@bt/shared/core/dates";
import { type ParsedReport, parseLabText, withTestDate } from "@bt/shared/core/importers/labText";
import { flagMeasurement, isCritical } from "@bt/shared/core/trends";
import type { Measurement } from "@bt/shared/core/types";
import { useState } from "react";
import { modelLabel, useBrainSettings } from "../brain/menus";
import type { PreparedPhoto } from "../brain/photo";
import { readWithBrain } from "../brain/store";
import { CriticalBanner } from "../components/CriticalBanner";
import { isImage, isPdf, monthFirst, Review } from "../components/LabReview";
import { Button, Card, FlagBadge, inputStyles, LinkButton, labelStyles, Notice, PageTitle } from "../components/ui";
import { formatDate, showMeasurement } from "../format";
import { useProfile } from "../hooks";
import { BIOMARKER_MAP, BLOOD_MARKERS, fullName } from "../knowledge";
import { uploadFile, useProfiles } from "../profiles";
import { href } from "../router";
import { BulkImport } from "./BulkImport";

type Step =
  | { name: "pick" }
  | { name: "review"; fileName: string; file?: File; report: ParsedReport }
  | { name: "bulk"; files: File[] }
  | { name: "done"; saved: Measurement[]; skipped: number; kept?: string; keepError?: string };

export function ImportPage() {
  const [step, setStep] = useState<Step>({ name: "pick" });
  const { mode, active } = useProfiles();

  /** After saving, the PDF itself goes into the profile folder, next to the results read from it. */
  async function saved(saved: Measurement[], skipped: number, file: File | undefined, date: string | undefined) {
    if (!file || mode !== "folders" || !active) return setStep({ name: "done", saved, skipped });
    try {
      const f = await uploadFile(
        active.id,
        file,
        `Lab report${date ? ` from ${date}` : ""}, ${saved.length} ${saved.length === 1 ? "result" : "results"} saved`,
      );
      setStep({ name: "done", saved, skipped, kept: f.originalName });
    } catch (e) {
      setStep({ name: "done", saved, skipped, keepError: e instanceof Error ? e.message : "unknown error" });
    }
  }

  return (
    <>
      <PageTitle sub="Read results from lab report PDFs or photos, one or many at once. You check every value before anything is saved.">
        Import lab reports
      </PageTitle>
      {step.name === "pick" && (
        <PickFile
          onParsed={(fileName, text, file, date) =>
            setStep({ name: "review", fileName, ...(file ? { file } : {}), report: withTestDate(parseLabText(text, BLOOD_MARKERS, { monthFirst }), date) })
          }
          onMany={(files) => setStep({ name: "bulk", files })}
        />
      )}
      {step.name === "bulk" && <BulkImport files={step.files} onCancel={() => setStep({ name: "pick" })} />}
      {step.name === "review" && (
        <Review
          fileName={step.fileName}
          fromPicture={false}
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

/** A photo or scanned PDF waiting for the person to send it to Brain. */
interface PictureFile {
  file: File;
  /** A scanned PDF's pages, already drawn. */
  pages?: PreparedPhoto[];
}

function PickFile({
  onParsed,
  onMany,
}: {
  onParsed: (fileName: string, text: string, file: File | undefined, date: string | undefined) => void;
  /** Several files chosen at once: one review per blood test (BulkImport). */
  onMany: (files: File[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ fraction: number; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picture, setPicture] = useState<PictureFile | null>(null);
  const [toBrain, setToBrain] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  /** When the blood was taken, if the person knows; empty uses the date printed on the report. */
  const [testDate, setTestDate] = useState("");
  const today = todayIso();
  const entered = testDate && testDate <= today ? testDate : undefined;

  /** Photos and scanned PDFs go to Brain as pictures, once the person confirms; it reads the results and shows them for checking. */
  async function sendToBrain({ file, pages }: PictureFile) {
    setPicture(null);
    setToBrain(file.name);
    await readWithBrain(file, pages, entered);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setToBrain(null);
    setPicture(null);
    if (isImage(file)) return setPicture({ file });
    if (!isPdf(file)) return setError("Choose a PDF or a photo (JPG, PNG or WebP).");
    setBusy(true);
    setProgress(null);
    try {
      const { readPdf } = await import("../pdf");
      const pdf = await readPdf(file, (fraction, stage) => setProgress({ fraction, stage }));
      if (pdf.kind === "pages") setPicture({ file, pages: pdf.pages });
      else onParsed(file.name, pdf.text, file, entered);
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
        <h2 className="font-serif text-2xl font-normal">Choose PDFs or photos</h2>
        <p className="text-ink-2">
          A PDF with text is read on this device: nothing is uploaded. A photo or a scanned PDF can be sent to Brain, the AI model you chose, which reads the
          results and shows them to you to check. You're asked first. Only the values you confirm are saved.
        </p>
        <p className="text-ink-2">
          Have years of reports? Choose them all at once: each blood test gets its own review, oldest first, and repeats are left out.
        </p>
        <p className="text-sm text-ink-2">
          For photos: lay the page flat, use good light, and take it straight from above with the whole table in the picture. On a phone you can take the photo
          right here.
        </p>
        <Field.Root className="flex max-w-xs flex-col gap-1.5">
          <Field.Label className={labelStyles}>Date of the blood test</Field.Label>
          <Field.Control type="date" value={testDate} max={today} onValueChange={setTestDate} className={inputStyles} />
          <Field.Description className="text-sm text-ink-2">
            Leave empty to use the date printed on the report. If none is found, you're asked before anything is saved. With several files, each report's own
            date is used.
          </Field.Description>
        </Field.Root>
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Lab report PDFs or photos</span>
          <input
            type="file"
            multiple
            accept="application/pdf,.pdf,image/*"
            disabled={busy}
            onChange={(e) => {
              const chosen = [...(e.target.files ?? [])];
              if (chosen.length > 1) onMany(chosen);
              else void onFile(chosen[0]);
              e.target.value = "";
            }}
            className="min-h-11 text-base file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-accent file:px-4 file:text-base file:font-medium file:text-accent-ink"
          />
        </label>
        {busy && (
          <div role="status" className="flex animate-fade flex-col gap-2">
            <p className="text-ink-2">{progress ? `${progress.stage}…` : "Reading…"}</p>
            {progress && (
              <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                <div
                  className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out"
                  style={{ transform: `scaleX(${Math.max(0.03, progress.fraction)})` }}
                />
              </div>
            )}
          </div>
        )}
        {picture && <SendPicture picture={picture} onSend={() => void sendToBrain(picture)} onCancel={() => setPicture(null)} />}
        {toBrain && (
          <Notice role="status">
            <span className="font-medium text-ink">{toBrain}</span> is open in Brain. Brain reads the results and shows them in a card for you to check and
            save.
          </Notice>
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
          <Button variant="secondary" disabled={pasted.trim() === ""} onClick={() => onParsed("Pasted text", pasted, undefined, entered)}>
            Read pasted text
          </Button>
        </div>
      </Card>

      <p className="text-sm text-ink-2">
        Works with PDFs from most labs, scanned PDFs and photos of paper reports. Brain can misread a picture, so check those values with extra care.
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
                <a
                  href={href({ name: "marker", id: def.id })}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-ink no-underline hover:bg-sunken"
                >
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

/**
 * Asks before a photo or scanned PDF leaves this computer: which model gets it and what it can see. Without the
 * local server, a model, or a model that takes pictures, it says what to do instead (typing the values in works).
 */
export function SendPicture({ picture, onSend, onCancel }: { picture: PictureFile; onSend: () => void; onCancel: () => void }) {
  const { settings, fresh } = useBrainSettings(true);
  const what = picture.pages ? `${picture.file.name} (${picture.pages.length} scanned ${picture.pages.length === 1 ? "page" : "pages"})` : picture.file.name;
  const typeIn = (
    <LinkButton variant="secondary" href={href({ name: "add" })}>
      Type the values in
    </LinkButton>
  );
  if (!fresh && settings === undefined)
    return (
      <p className="text-ink-2" role="status">
        Checking which AI model is set up…
      </p>
    );
  if (settings === null) {
    return (
      <Notice tone="warn" title="Photos and scans need Brain">
        Brain reads photos and scanned PDFs through the app's small server on this computer, which isn't running. Start the app with{" "}
        <code className="font-mono">bun run start</code> or use the desktop app, or type the values in.
        <span className="mt-3 flex flex-wrap gap-2">{typeIn}</span>
      </Notice>
    );
  }
  const info = settings ? providerInfo(settings.assistant.provider) : undefined;
  if (!settings?.ready.ok) {
    return (
      <Notice tone="warn" title="Set up a model to read photos and scans">
        Photos and scanned PDFs are read by Brain, the AI model you choose. {settings?.ready.reason ?? ""} You can also type the values in.
        <span className="mt-3 flex flex-wrap gap-2">
          <LinkButton href={href({ name: "data", tab: "models" })}>Set up a model</LinkButton>
          {typeIn}
        </span>
      </Notice>
    );
  }
  if (!takesPictures(settings.assistant.provider)) {
    return (
      <Notice tone="warn" title={`${info?.label ?? "This model"} can't read pictures`}>
        Choose Claude Code, Codex, or a model with an API key or on this computer in Settings → AI models, or type the values in.
        <span className="mt-3 flex flex-wrap gap-2">
          <LinkButton href={href({ name: "data", tab: "models" })}>Choose a model</LinkButton>
          {typeIn}
        </span>
      </Notice>
    );
  }
  return (
    <Notice title="Send to Brain to read?">
      <span className="font-medium text-ink">{what}</span> goes to {modelLabel(settings.assistant)} as{" "}
      {picture.pages && picture.pages.length > 1 ? "pictures" : "a picture"}
      {info?.retention === "depends" ? ", which keeps data according to your own login" : ""}. The model sees everything printed on it, including your name,
      birth date and ID numbers; crop or cover them first if you prefer. Location data in photos is removed. Nothing is saved until you check the values.
      <span className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onSend}>Send to Brain</Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </span>
    </Notice>
  );
}
