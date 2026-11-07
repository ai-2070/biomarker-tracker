import { type Backup, parseBackup } from "@bt/shared/core/backup";
import { todayIso } from "@bt/shared/core/dates";
import type { Profile } from "@bt/shared/core/types";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { deleteEverything, exportAll, getProfile, type ImportMode, importBackup, setProfile } from "../../db/db";
import { localServer } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DoctorReportExport } from "../components/DoctorReportExport";
import { ProfileBasics, ProfileDetails } from "../components/ProfileForm";
import { Button, buttonStyles, Card, cx, errorStyles, LinkButton, Notice } from "../components/ui";
import { useAllMeasurements } from "../hooks";
import { fileUrl, type StoredFile, uploadFile, useProfiles } from "../profiles";
import { href } from "../router";

/** "Your data" tab of the settings page. */
export function DataSettings() {
  const { mode, active } = useProfiles();
  const all = useAllMeasurements();
  // undefined while loading, so the form starts from the saved values.
  const saved = useLiveQuery(() => getProfile(), []);
  const [replacement, setReplacement] = useState<{ profile: Profile; revision: number } | null>(null);
  const folders = mode === "folders" && !!active;

  return (
    <div className="flex flex-col gap-5">
      {saved && <PersonCard key={replacement?.revision ?? 0} initial={replacement?.profile ?? saved} nameRequired={folders} />}
      {saved && all && <DoctorReportExport profile={saved} measurements={all} />}
      {folders && <FilesCard profileId={active.id} />}
      {folders && (
        <Card className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-normal">Back up or delete this profile</h2>
          <p className="text-ink-2">
            Everything is kept in a folder on this computer and saved as you go:
            <span className="mt-1 block font-mono text-xs break-all">{active.folder}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/profiles/${active.id}/backup`} className={buttonStyles.primary} download>
              Back up (.zip)
            </a>
            <Button variant="secondary" onClick={() => void localServer.profiles.reveal.mutate({ id: active.id })}>
              Show folder
            </Button>
            <LinkButton variant="quiet" href={href({ name: "profiles" })}>
              All profiles
            </LinkButton>
          </div>
        </Card>
      )}

      <BackupCard count={all?.length ?? 0} />
      <RestoreCard onReplace={(profile) => setReplacement((old) => ({ profile, revision: (old?.revision ?? 0) + 1 }))} />
      {!folders && <StorageCard />}

      {!folders && (
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
      )}
    </div>
  );
}

/** The person's details, saved as they are typed (to the profile folder too). */
function PersonCard({ initial, nameRequired }: { initial: Profile; nameRequired: boolean }) {
  const [draft, setDraft] = useState<Profile>(initial);
  const nameMissing = nameRequired && !draft.name?.trim();

  function change(p: Profile) {
    setDraft(p);
    // A profile folder always needs a name; keep the last one until a new one is typed.
    if (!nameRequired || p.name?.trim()) void setProfile(p);
  }

  return (
    <>
      <Card className="flex flex-col gap-5">
        <h2 className="font-serif text-2xl font-normal">{draft.name?.trim() ? `About ${draft.name.trim()}` : "About you"}</h2>
        <ProfileBasics value={draft} onChange={change} nameRequired={nameRequired} />
        {nameMissing && <p className={errorStyles}>A profile needs a name. Until you add one, the old name is kept.</p>}
      </Card>
      <Card className="flex flex-col gap-5">
        <div>
          <h2 className="font-serif text-2xl font-normal">A bit more (optional)</h2>
          <p className="mt-1 text-ink-2">
            These help the assistant give answers that fit, and let the app warn before suggesting something that may not be safe. Skip anything you like.
          </p>
        </div>
        <ProfileDetails value={draft} onChange={change} showNotes />
      </Card>
    </>
  );
}

const sizeText = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Scanned lab reports and other documents kept in the profile folder. */
function FilesCard({ profileId }: { profileId: string }) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => localServer.profiles.files.query({ id: profileId }).then((r) => setFiles(r.files));
  // biome-ignore lint/correctness/useExhaustiveDependencies: load again only when the profile changes
  useEffect(() => {
    void load().catch(() => setFiles([]));
  }, [profileId]);

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(list)) await uploadFile(profileId, f, "Added by hand");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Files</h2>
      <p className="text-ink-2">
        Lab reports you import are kept here, next to the results read from them. You can add other documents too (PDF, images, text).
      </p>
      {files === null ? (
        <p className="text-ink-2">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-ink-2">No files yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {files
            .slice()
            .reverse()
            .map((f) => (
              <li key={f.name} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={fileUrl(profileId, f.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium break-all text-accent underline-offset-2 hover:underline"
                  >
                    {f.originalName}
                  </a>
                  <p className="text-sm text-ink-2">
                    {new Date(f.addedAt).toLocaleDateString()} · {sizeText(f.size)}
                    {f.note ? ` · ${f.note}` : ""}
                  </p>
                </div>
                <div className="-ml-3 flex gap-1 sm:ml-0">
                  <a href={fileUrl(profileId, f.name, true)} className={cx(buttonStyles.quiet, "text-sm")}>
                    Download
                  </a>
                  <ConfirmDialog
                    trigger="Delete"
                    triggerVariant="quiet"
                    triggerClassName="text-sm"
                    title="Delete this file?"
                    description={`"${f.originalName}" will be removed from the profile folder. Results read from it stay.`}
                    confirmLabel="Delete file"
                    onConfirm={async () => {
                      await localServer.profiles.removeFile.mutate({ id: profileId, name: f.name });
                      await load();
                    }}
                  />
                </div>
              </li>
            ))}
        </ul>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <div>
        <label
          className={cx(buttonStyles.secondary, "cursor-pointer focus-within:outline-2 focus-within:outline-accent", busy && "pointer-events-none opacity-50")}
        >
          {busy ? "Saving…" : "Add a file"}
          <input
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void add(e.target.files)}
          />
        </label>
      </div>
    </Card>
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
      <h2 className="font-serif text-2xl font-normal">Download results as a file</h2>
      <p className="text-ink-2">
        Saves all {count} {count === 1 ? "result" : "results"}, your habits and what they watch as one JSON file, to keep or to move to another copy of the app.
        It contains health data, so treat it like a medical document.
      </p>
      <div>
        <Button onClick={() => void download()}>Download file</Button>
      </div>
    </Card>
  );
}

function RestoreCard({ onReplace }: { onReplace: (profile: Profile) => void }) {
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
    if (mode === "replace") onReplace(pending.profile);
    setDone(`Restored ${pending.measurements.length} results.`);
    setPending(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Add results from a file</h2>
      <label className="flex flex-col gap-1.5">
        <span className="text-ink-2">Choose a JSON file downloaded from this app earlier.</span>
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
          <span aria-hidden="true">✓ </span>Your browser has agreed not to clear this data automatically. Clearing your browsing data by hand will still delete
          it, so keep a backup.
        </p>
      ) : (
        <>
          <p className="text-ink-2">
            Browsers can delete stored data when space runs low. Ask your browser to keep it. Some browsers decide on their own and may not show a prompt.
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
