import { useEffect, useRef, useState } from "react";
import { loadProfileFolder, restoreProfile } from "../profiles";
import { buttonStyles, cx, Notice } from "./ui";

/** Load a profile: from a backup .zip, or from a profile folder (e.g. copied from another computer). */
export function LoadProfile({ primary }: { primary?: boolean }) {
  const folderRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Folder picking isn't a standard attribute in React's types.
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    folderRef.current?.setAttribute("directory", "");
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The profile couldn't be loaded.");
      setBusy(false);
    }
  }

  const btn = cx(
    primary ? buttonStyles.primary : buttonStyles.secondary,
    "cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
    busy && "pointer-events-none opacity-50",
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <label className={btn}>
          {busy ? "Loading…" : "Load a backup (.zip)"}
          <input
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && void run(() => restoreProfile(e.target.files![0]!))}
          />
        </label>
        <label
          className={cx(
            buttonStyles.secondary,
            "cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
            busy && "pointer-events-none opacity-50",
          )}
        >
          Load a profile folder
          <input
            ref={folderRef}
            type="file"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => e.target.files?.length && void run(() => loadProfileFolder(e.target.files!))}
          />
        </label>
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}
