import { useState, type FormEvent } from "react";
import type { Profile } from "../../core/types";
import { saveBirthMonth } from "../../db/db";
import { useProfiles } from "../profiles";
import { BirthMonthField } from "./BirthMonthField";
import { Button, errorStyles } from "./ui";

/** Explicitly save a missing birth month once, for every age estimate in this profile. */
export function InlineBirthMonth({ profile, forLabel }: { profile: Profile; forLabel: string }) {
  const { active } = useProfiles();
  const [draft, setDraft] = useState("");
  const [valid, setValid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await saveBirthMonth(draft, { id: active?.id ?? null, name: profile.name });
      if (!saved) setError("Your profile changed. Refresh this page before trying again.");
    } catch {
      setError("Could not save your birth month. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form aria-label={`Birth details for ${forLabel}`} onSubmit={(event) => void save(event)} className="mt-3 flex max-w-sm flex-col items-start gap-3">
      <div className="w-full">
        <BirthMonthField compact onChange={setDraft} onValidityChange={setValid} help="Only the month and year are kept. Save once for all age estimates in your profile." />
      </div>
      <Button type="submit" disabled={!valid || saving}>{saving ? "Saving…" : "Save"}</Button>
      {error && <p className={errorStyles} role="alert">{error}</p>}
    </form>
  );
}
