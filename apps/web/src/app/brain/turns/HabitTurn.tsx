import { useId, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { todayIso } from "@bt/shared/core/dates";
import type { HabitProposal } from "@bt/shared/core/habitProposal";
import { defaultRetestDays } from "@bt/shared/core/habits";
import { safetyNotes, validateProtocol } from "@bt/shared/core/protocols";
import { createHabit } from "../../../db/db";
import { SafetyNotices } from "../../components/SafetyNotices";
import { Button, CheckIcon, cx, inputStyles } from "../../components/ui";
import { BIOMARKER_MAP, fullName } from "../../knowledge";
import { href } from "../../router";
import { setHabitState, type Turn } from "../store";

const CATEGORY_WORD: Record<HabitProposal["category"], string> = { supplement: "Supplement", diet: "Diet change", lifestyle: "Lifestyle" };

/**
 * A habit Brain suggested. The person can change the name, start date and watched markers, then add
 * it to Habits or leave it. Nothing is saved before that (and medicines or amounts never get here).
 */
export function HabitTurn({ turn }: { turn: Extract<Turn, { role: "habit" }> }) {
  const p = turn.proposal;
  const today = todayIso();
  const [label, setLabel] = useState(p.label);
  const [start, setStart] = useState(p.start);
  const [markers, setMarkers] = useState<string[]>(p.markerIds);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const notes = safetyNotes([label]);
  const labelId = useId();

  if (turn.state === "dismissed") return <p className="text-center text-sm text-ink-2">Habit not added.</p>;
  if (turn.state === "saved") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ok-soft p-3 text-sm">
        <span className="flex items-center gap-2">
          <CheckIcon className="size-4 text-ok" /> Added to Habits: <span className="font-medium">{label}</span>
        </span>
        <a href={href({ name: "habits" })} className="font-medium text-ink underline underline-offset-2">
          Open Habits
        </a>
      </div>
    );
  }

  async function add() {
    const r = validateProtocol({ label, category: p.category, start }, today);
    if (!r.ok) return setError(Object.values(r.errors)[0]);
    setSaving(true);
    try {
      await createHabit(r.entry, markers.length ? { markerIds: markers, retestAfterDays: defaultRetestDays(markers), today } : undefined);
      setHabitState(turn.id, "saved");
    } catch {
      setError("The habit couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
      <div>
        <p className="font-mono text-[11px] font-medium tracking-[0.12em] text-ink-2 uppercase">Suggested habit · {CATEGORY_WORD[p.category]}</p>
        <p className="mt-1 text-sm text-ink-2">{p.reason}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={labelId} className="text-sm font-medium">
          Name
        </label>
        <input id={labelId} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} className={inputStyles} />
        <span className="text-xs text-ink-2">Add the amount yourself if it applies, as agreed with your doctor or pharmacist.</span>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Start</span>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={cx(inputStyles, "sm:w-48")} />
      </label>
      {p.markerIds.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Watch these markers (compares results before and after)</legend>
          {p.markerIds.map((id) => {
            const def = BIOMARKER_MAP.get(id);
            return (
              <label key={id} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                <Checkbox.Root
                  checked={markers.includes(id)}
                  onCheckedChange={(on) => setMarkers((m) => (on ? [...m, id] : m.filter((x) => x !== id)))}
                  className="flex size-4 shrink-0 items-center justify-center rounded border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent"
                >
                  <Checkbox.Indicator className="flex data-unchecked:hidden">
                    <CheckIcon className="size-3" />
                  </Checkbox.Indicator>
                </Checkbox.Root>
                {def ? fullName(def) : id}
              </label>
            );
          })}
        </fieldset>
      )}
      <SafetyNotices notes={notes} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void add()} disabled={saving || !label.trim()}>
          {saving ? "Adding…" : "Add to Habits"}
        </Button>
        <Button variant="secondary" onClick={() => setHabitState(turn.id, "dismissed")}>
          Not now
        </Button>
      </div>
    </div>
  );
}
