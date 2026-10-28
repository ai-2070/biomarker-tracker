import { useState, type ReactNode } from "react";
import { cleanProfile } from "../../core/backup";
import type { Profile } from "../../core/types";
import { setOnboarded, setProfile } from "../../db/db";
import { ProfileBasics, ProfileDetails } from "../components/ProfileForm";
import { Button, Card, Notice, cx, helpStyles } from "../components/ui";
import { createProfile, restoreProfile } from "../profiles";
import { href } from "../router";

type Step = "welcome" | "person" | "details" | "start";

/**
 * Setup in steps: the first time the app opens, and for every new profile.
 * mode "folders": the profile becomes a folder on this computer (local server running).
 * mode "browser": a static copy of the app; the profile is kept in this browser.
 */
export function SetupPage({ mode, first, existingResults, folderRoot }: { mode: "folders" | "browser"; first: boolean; existingResults: number; folderRoot?: string }) {
  const steps: Step[] = first ? ["welcome", "person", "details", "start"] : ["person", "details", "start"];
  const [step, setStep] = useState<Step>(steps[0]!);
  const [person, setPerson] = useState<Profile>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = steps.indexOf(step);
  const go = (d: number) => setStep(steps[index + d]!);
  const nameOk = !!person.name?.trim();

  /** Creates the profile, then opens the app at `to`. */
  async function finish(to: string) {
    setBusy(true);
    setError(null);
    try {
      const p = cleanProfile(person);
      if (mode === "folders") await createProfile(p, { fromBrowser: first && existingResults > 0 });
      else {
        await setProfile(p);
        await setOnboarded();
        void navigator.storage?.persist?.();
      }
      location.hash = to;
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The profile couldn't be created.");
      setBusy(false);
    }
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await restoreProfile(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The backup couldn't be restored.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Progress steps={steps} index={index} />

      {step === "welcome" && (
        <StepCard title="Welcome to Biomarker Tracker">
          <ul className="flex flex-col gap-4">
            <Point title="Track blood tests over the years">See every result on a chart, what it means in plain words, and your biological age.</Point>
            <Point title="One profile per person">
              {mode === "folders" ? (
                <>
                  Each profile is a folder on this computer with that person's details, results, log and scanned lab reports. You can add profiles for
                  family members, switch between them, and back each one up.
                  {folderRoot && <span className="mt-1 block font-mono text-xs break-all">{folderRoot}</span>}
                </>
              ) : (
                "Results are saved in this browser. Download a backup now and then from Settings."
              )}
            </Point>
            <Point title="Not medical advice. Not a medical device.">
              The app explains what markers mean in general and what research says. It can't diagnose anything or tell you what to do. Talk to your doctor
              about your results.
            </Point>
          </ul>
          {existingResults > 0 && (
            <Notice>
              {existingResults} {existingResults === 1 ? "result is" : "results are"} already saved in this browser. They will go into the profile you create
              now.
            </Notice>
          )}
          <Nav onNext={() => go(1)} nextLabel="Start" />
        </StepCard>
      )}

      {step === "person" && (
        <StepCard title={first ? "Who is this profile for?" : "New profile"} sub="You can change all of this later in Settings.">
          <ProfileBasics value={person} onChange={setPerson} nameRequired />
          <Nav onBack={index > 0 ? () => go(-1) : undefined} onNext={() => go(1)} nextDisabled={!nameOk} hint={nameOk ? undefined : "Add a name to continue."} />
        </StepCard>
      )}

      {step === "details" && (
        <StepCard
          title="A bit more (optional)"
          sub="These help the assistant give answers that fit, and let the app warn before suggesting something that may not be safe. Skip anything you like."
        >
          <ProfileDetails value={person} onChange={setPerson} />
          <Nav onBack={() => go(-1)} onNext={() => go(1)} nextLabel="Next" />
        </StepCard>
      )}

      {step === "start" && (
        <StepCard title={`Add ${person.name?.trim() ? `${person.name.trim()}'s` : "your"} first results`} sub="Pick one to start. You can do the others any time.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice title="Import a lab report" text="Read the results from a PDF. You check every value before it is saved, and the PDF is kept in the profile." disabled={busy} onClick={() => void finish(href({ name: "import" }))} />
            <Choice title="Type in a result" text="Copy one value at a time from a paper or emailed report." disabled={busy} onClick={() => void finish(href({ name: "add" }))} />
            {mode === "folders" && (
              <label className={cx(choiceStyles, busy && "pointer-events-none opacity-50")}>
                <span className="font-medium">Restore a profile backup</span>
                <span className="text-sm text-ink-2">A .zip file made with "Back up" on the Profiles page. It becomes its own profile.</span>
                <input type="file" accept=".zip,application/zip" className="sr-only" disabled={busy} onChange={(e) => void restore(e.target.files?.[0])} />
              </label>
            )}
            <Choice
              title={existingResults > 0 && first ? "Go to my results" : "Not now"}
              text={existingResults > 0 && first ? "Open the profile with the results already in this browser." : "Open the empty profile."}
              disabled={busy}
              onClick={() => void finish(href({ name: "overview" }))}
            />
          </div>
          <p className={helpStyles}>The assistant is optional. Set it up later in Settings → AI models.</p>
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
          <Nav onBack={() => go(-1)} />
        </StepCard>
      )}
    </div>
  );
}

const choiceStyles =
  "flex min-h-24 cursor-pointer flex-col gap-1 rounded-xl border border-line-strong bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft focus-within:outline-2 focus-within:outline-accent";

function Choice({ title, text, onClick, disabled }: { title: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cx(choiceStyles, "disabled:pointer-events-none disabled:opacity-50")}>
      <span className="font-medium">{title}</span>
      <span className="text-sm text-ink-2">{text}</span>
    </button>
  );
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-accent" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="text-ink-2">{children}</span>
      </span>
    </li>
  );
}

function StepCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-6 p-5 sm:p-8">
      <div>
        <h1 className="font-serif text-3xl font-normal tracking-tight text-balance sm:text-4xl">{title}</h1>
        {sub && <p className="mt-2 text-ink-2">{sub}</p>}
      </div>
      {children}
    </Card>
  );
}

function Progress({ steps, index }: { steps: Step[]; index: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">
        Step {index + 1} of {steps.length}
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s} className={cx("h-1.5 flex-1 rounded-full", i <= index ? "bg-accent" : "bg-line")} />
        ))}
      </div>
    </div>
  );
}

function Nav({ onBack, onNext, nextLabel = "Next", nextDisabled, hint }: { onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
      {onBack ? (
        <Button variant="quiet" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      {onNext && (
        <div className="flex items-center gap-3">
          {hint && <span className="text-sm text-ink-2">{hint}</span>}
          <Button onClick={onNext} disabled={nextDisabled}>
            {nextLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
