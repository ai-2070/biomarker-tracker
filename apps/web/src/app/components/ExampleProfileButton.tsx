import { useState } from "react";
import { createExampleProfile } from "../profiles";
import { Button, Notice } from "./ui";

/** Creates and opens a profile with made-up example data. */
export function ExampleProfileButton({
  mode,
  label = "Open an example profile",
  variant = "secondary",
}: {
  mode: "folders" | "browser";
  label?: string;
  variant?: "primary" | "secondary" | "quiet";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant={variant}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            createExampleProfile(mode).catch((e: unknown) => {
              setError(e instanceof Error ? e.message : "The example profile couldn't be created.");
              setBusy(false);
            });
          }}
        >
          {busy ? "Creating…" : label}
        </Button>
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}
