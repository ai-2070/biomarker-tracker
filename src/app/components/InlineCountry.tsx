import { useState, type FormEvent } from "react";
import { LIFE_TABLE_COUNTRIES } from "../../core/lifeTable";
import type { Profile } from "../../core/types";
import { saveCountry } from "../../db/db";
import { useProfiles } from "../profiles";
import { SimpleSelect } from "./UnitSelect";
import { Button, errorStyles } from "./ui";

const options = Object.entries(LIFE_TABLE_COUNTRIES)
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([value, name]) => ({ value, label: value === "EU27_2020" ? "Somewhere else in the EU (EU average)" : name }));

/** A draft selection never changes the profile until Save is pressed. */
export function InlineCountry({ profile }: { profile: Profile }) {
  const { active } = useProfiles();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await saveCountry(draft, { id: active?.id ?? null, name: profile.name });
      if (!saved) setError("Your profile changed. Refresh this page before trying again.");
    } catch {
      setError("Could not save your country. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form aria-label="Country for population reference" onSubmit={(event) => void save(event)} className="flex w-full max-w-sm flex-col items-start gap-3">
      <SimpleSelect label="Country you live in" options={options} value={draft} onChange={setDraft} disabled={saving} className="w-full min-w-0" />
      <p className="text-sm text-ink-2">Saved in your profile on this computer. You can change it later in Settings → Your data.</p>
      <Button type="submit" disabled={!draft || saving}>{saving ? "Saving…" : "Save"}</Button>
      {error && <p className={errorStyles} role="alert">{error}</p>}
    </form>
  );
}
