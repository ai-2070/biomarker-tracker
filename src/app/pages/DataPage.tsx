import { useEffect, useRef, useState } from "react";
import { parseBackup, type Backup } from "../../core/backup";
import { todayIso } from "../../core/dates";
import type { Sex } from "../../core/types";
import { deleteEverything, exportAll, importBackup, setProfile, type ImportMode } from "../../db/db";
import { BirthMonthField } from "../components/BirthMonthField";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button, Card, Notice } from "../components/ui";
import { useAllMeasurements, useProfile } from "../hooks";

type SexChoice = Sex | "unset";

/** "Your data" tab of the settings page. */
export function DataSettings() {
  const profile = useProfile();
  const all = useAllMeasurements();

  return (
    <>
      <div className="flex flex-col gap-5">
        <Card className="flex flex-col gap-5">
          <h2 className="font-serif text-2xl font-normal">About you</h2>
          <ChoiceGroup<SexChoice>
            label="Sex for reference ranges"
            help="Some markers, like ferritin and haemoglobin, have different typical ranges for women and men. This is only used to pick the range."
            value={profile.sex ?? "unset"}
            onChange={(v) => {
              const { sex: _old, ...rest } = profile;
              void setProfile(v === "unset" ? rest : { ...rest, sex: v });
            }}
            options={[
              { value: "f", label: "Female" },
              { value: "m", label: "Male" },
              { value: "unset", label: "Prefer not to say" },
            ]}
          />
          {/* Keyed so the fields pick up the saved value once it has loaded. */}
          <BirthMonthField key={profile.birthMonth ?? "none"} profile={profile} />
        </Card>

        <BackupCard count={all?.length ?? 0} />
        <RestoreCard />
        <StorageCard />

        <Card className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-normal">Delete all data</h2>
          <p className="text-ink-2">Removes every result and setting from this browser. Download a backup first if you want to keep them.</p>
          <div>
            <ConfirmDialog
              trigger="Delete all data"
              triggerVariant="danger"
              title="Delete all your data?"
              description="Every result and setting will be removed from this browser. This cannot be undone unless you have a backup file."
              confirmLabel="Delete everything"
              onConfirm={() => deleteEverything()}
            />
          </div>
        </Card>
      </div>
    </>
  );
}

function BackupCard({ count }: { count: number }) {
  async function download() {
    const backup = await exportAll(new Date());
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `biomarker-backup-${todayIso()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Download a backup</h2>
      <p className="text-ink-2">
        Saves all {count} {count === 1 ? "result" : "results"} as a file. Keep it somewhere safe. If your browser data is cleared, you can
        restore from it. The file contains your health data, so treat it like a medical document.
      </p>
      <div>
        <Button onClick={() => void download()} disabled={count === 0}>
          Download backup
        </Button>
      </div>
    </Card>
  );
}

function RestoreCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setError(null);
    setDone(null);
    setPending(null);
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setError("This file can't be read. Choose a backup file that ends in .json.");
      return;
    }
    const result = parseBackup(json);
    if (result.ok) setPending(result.backup);
    else setError(result.error);
  }

  async function restore(mode: ImportMode) {
    if (!pending) return;
    await importBackup(pending, mode);
    setDone(`Restored ${pending.measurements.length} results.`);
    setPending(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Restore from a backup</h2>
      <label className="flex flex-col gap-1.5">
        <span className="text-ink-2">Choose a backup file you downloaded earlier.</span>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="min-h-11 text-base file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-4 file:text-base file:text-ink hover:file:bg-sunken"
        />
      </label>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {done && (
        <Notice role="status" title={done}>
          Your results are back.
        </Notice>
      )}
      {pending && (
        <Notice title="Backup ready to restore">
          <p>
            {pending.measurements.length} results
            {pending.exportedAt ? `, saved on ${new Date(pending.exportedAt).toLocaleDateString()}` : ""}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void restore("merge")}>Add to my current data</Button>
            <ConfirmDialog
              trigger="Replace my data"
              title="Replace all your data?"
              description="Everything currently stored will be deleted and replaced with the contents of the backup file."
              confirmLabel="Replace data"
              onConfirm={() => restore("replace")}
            />
          </div>
        </Notice>
      )}
    </Card>
  );
}

/** Browsers may clear site data under storage pressure unless it is marked persistent. */
function StorageCard() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [asked, setAsked] = useState(false);
  const supported = typeof navigator !== "undefined" && !!navigator.storage?.persist;

  useEffect(() => {
    if (supported) void navigator.storage.persisted().then(setPersisted);
  }, [supported]);

  if (!supported) return null;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Keep data safe in this browser</h2>
      {persisted ? (
        <p className="text-ink-2">
          <span aria-hidden="true">✓ </span>Your browser has agreed not to clear this data automatically. Clearing your browsing data by hand
          will still delete it, so keep a backup.
        </p>
      ) : (
        <>
          <p className="text-ink-2">
            Browsers can delete stored data when space runs low. Ask your browser to keep it. Some browsers decide on their own and may not
            show a prompt.
          </p>
          <div>
            <Button
              variant="secondary"
              onClick={() =>
                void navigator.storage.persist().then((ok) => {
                  setAsked(true);
                  setPersisted(ok);
                })
              }
            >
              Ask browser to keep my data
            </Button>
          </div>
          {asked && !persisted && <p className="text-sm text-ink-2">Not granted yet. Regular backups are the safest option.</p>}
        </>
      )}
    </Card>
  );
}
