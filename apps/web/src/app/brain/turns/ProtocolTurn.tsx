import { useId, useState } from "react";
import { itemsByTime, pairWarnings } from "@bt/shared/core/plans";
import { savePlan } from "../../../db/db";
import { TIME_LABEL, whenExtras } from "../../components/PlanWhen";
import { Button, CheckIcon, inputStyles } from "../../components/ui";
import { NUTRIENTS } from "../../knowledge";
import { href } from "../../router";
import { setHabitState, type Turn } from "../store";

/**
 * A recorded or requested-recommendation protocol draft. The person checks and creates it; nothing
 * is saved or started before that. All items remain editable on the Protocols page.
 */
export function ProtocolTurn({ turn }: { turn: Extract<Turn, { role: "protocol" }> }) {
  const [name, setName] = useState(turn.plan.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const nameId = useId();
  const groups = itemsByTime(turn.plan);
  const pairs = pairWarnings(turn.plan, NUTRIENTS);

  if (turn.state === "dismissed") return <p className="text-center text-sm text-ink-2">Protocol not created.</p>;
  if (turn.state === "saved") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ok-soft p-3 text-sm">
        <span className="flex items-center gap-2">
          <CheckIcon className="size-4 text-ok" /> Protocol created: <span className="font-medium">{name}</span>
        </span>
        <a href={href({ name: "plan", id: turn.plan.id })} className="font-medium text-ink underline underline-offset-2">
          Open it
        </a>
      </div>
    );
  }

  async function create() {
    if (!name.trim()) return setError("Give the protocol a name.");
    setSaving(true);
    try {
      await savePlan({ ...turn.plan, name: name.trim().slice(0, 80) });
      setHabitState(turn.id, "saved");
    } catch {
      setError("The protocol couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
      <div>
        <p className="text-sm font-medium">
          {turn.intent === "recommend" ? "Suggested protocol" : "Protocol from your text"} · {turn.plan.items.length} {turn.plan.items.length === 1 ? "item" : "items"}
        </p>
        <p className="mt-1 text-sm text-ink-2">{turn.intent === "recommend"
          ? "Review this draft. It has no medicines or suggested doses. Creating it does not start it as a habit; you can edit it on the Protocols page."
          : "Check that every item, time and amount matches what you wrote. You can change anything on the Protocols page afterwards."}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-sm font-medium">
          Name
        </label>
        <input id={nameId} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={inputStyles} />
      </div>
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg bg-sunken p-2 text-sm">
        {groups.map((g) => (
          <div key={g.when}>
            <p className="font-mono text-[11px] font-medium tracking-[0.12em] text-ink-2 uppercase">{TIME_LABEL[g.when]}</p>
            <ul className="mt-0.5">
              {g.items.map((i) => (
                <li key={i.id}>
                  {i.label}
                  {i.amount && <span className="text-ink-2"> · {i.amount}</span>}
                  {whenExtras(i) && <span className="text-ink-2"> · {whenExtras(i)}</span>}
                  {i.note && <span className="text-ink-2"> ({i.note})</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {pairs.length > 0 && (
        <p className="rounded-lg bg-warn-soft p-2 text-sm">
          <span className="font-medium">Items that interact: </span>
          {pairs.map((w) => `${w.a} and ${w.b}`).join("; ")}. Details on the protocol's page.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void create()} disabled={saving}>
          {saving ? "Creating…" : "Create protocol"}
        </Button>
        <Button variant="secondary" onClick={() => setHabitState(turn.id, "dismissed")}>
          Not now
        </Button>
      </div>
    </div>
  );
}
