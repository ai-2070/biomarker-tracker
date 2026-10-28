import { useState } from "react";
import { todayIso } from "../../core/dates";
import { initials, profileSummary } from "../../core/profile";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button, Card, LinkButton, Notice, PageTitle, buttonStyles, cx } from "../components/ui";
import { formatDate } from "../format";
import { restoreProfile, switchProfile, useProfiles, type ProfileSummary } from "../profiles";
import { href } from "../router";

export function Avatar({ name, size = "md" }: { name?: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent",
        size === "sm" ? "size-8 text-xs" : "size-11 text-sm",
      )}
    >
      {initials(name)}
    </span>
  );
}

function countLine(p: ProfileSummary): string {
  const bits = [`${p.results} ${p.results === 1 ? "result" : "results"}`];
  if (p.lastResult) bits.push(`latest ${formatDate(p.lastResult)}`);
  bits.push(`${p.files} ${p.files === 1 ? "file" : "files"}`);
  return bits.join(" · ");
}

/** The profiles list: open, back up, show the folder, delete. Also the "who is using the app?" screen. */
export function ProfilesPage({ choosing, onNew }: { choosing?: { profiles: ProfileSummary[] }; onNew?: () => void }) {
  const ctx = useProfiles();
  const profiles = choosing?.profiles ?? ctx.profiles;
  const activeId = choosing ? null : ctx.active?.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!choosing && ctx.mode === "browser") {
    return (
      <>
        <PageTitle>Profiles</PageTitle>
        <Notice title="Profiles need the app's local server">
          Start the app with <span className="font-mono text-sm">bun run start</span> to keep each person in their own folder. Right now the data is kept in
          this browser.
        </Notice>
      </>
    );
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: ProfileSummary) {
    const r = await api<{ active: string | null }>("DELETE", `/api/profiles/${p.id}`);
    const left = profiles.filter((x) => x.id !== p.id);
    if (p.id === activeId) {
      // The open profile is gone: open another one, or start setup.
      if (left[0]) await switchProfile(left[0].id);
      else {
        location.hash = href({ name: "overview" });
        location.reload();
      }
    } else if (r) await ctx.refresh();
  }

  return (
    <>
      <PageTitle sub={choosing ? "Choose a profile to open." : "Each profile is a folder on this computer with one person's details, results and files."}>
        {choosing ? "Who is using the app?" : "Profiles"}
      </PageTitle>
      {error && (
        <Notice tone="danger" role="alert" className="mb-4">
          {error}
        </Notice>
      )}
      <ul className="flex flex-col gap-3">
        {profiles.map((p) => {
          const active = p.id === activeId;
          const summary = profileSummary(p.person, todayIso());
          return (
            <li key={p.id}>
              <Card className={cx("flex flex-col gap-3", active && "border-accent")}>
                <div className="flex items-start gap-3">
                  <Avatar name={p.person.name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-lg font-medium">
                      {p.person.name || "Unnamed"}
                      {active && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] tracking-wide text-accent uppercase">Open now</span>}
                    </p>
                    {summary && <p className="text-ink-2">{summary}</p>}
                    <p className="text-sm text-ink-2">{countLine(p)}</p>
                    {!choosing && <p className="mt-1 font-mono text-xs break-all text-ink-2">{p.folder}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!active && (
                    <Button disabled={busy} onClick={() => void act(() => switchProfile(p.id))}>
                      Open
                    </Button>
                  )}
                  {!choosing && (
                    <>
                      <a href={`/api/profiles/${p.id}/backup`} className={buttonStyles.secondary} download>
                        Back up (.zip)
                      </a>
                      <Button variant="secondary" disabled={busy} onClick={() => void act(() => api("POST", `/api/profiles/${p.id}/reveal`))}>
                        Show folder
                      </Button>
                      <ConfirmDialog
                        trigger="Delete"
                        triggerVariant="quiet"
                        title={`Delete ${p.person.name || "this profile"}?`}
                        description={`This deletes the folder with ${countLine(p)}. It can't be undone. Download a backup first if you might need it again.`}
                        confirmLabel="Delete profile"
                        onConfirm={() => act(() => remove(p))}
                      />
                    </>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {onNew ? (
          <Button onClick={onNew}>New profile</Button>
        ) : (
          <LinkButton href={href({ name: "setup" })}>New profile</LinkButton>
        )}
        <label className={cx(buttonStyles.secondary, "cursor-pointer focus-within:outline-2 focus-within:outline-accent", busy && "pointer-events-none opacity-50")}>
          Restore a backup (.zip)
          <input type="file" accept=".zip,application/zip" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && void act(() => restoreProfile(e.target.files![0]!))} />
        </label>
      </div>
    </>
  );
}
