import { useState } from "react";
import { undoBrainChanges } from "../../../db/brainChanges";
import { Button, CheckIcon } from "../../components/ui";
import { type Turn, updateChanges } from "../store";

/** What Brain changed because the person asked, as actually written, with one Undo for all of it. */
export function ChangesTurn({ turn }: { turn: Extract<Turn, { role: "changes" }> }) {
  const [busy, setBusy] = useState(false);
  if (turn.state === "failed")
    return (
      <div className="rounded-xl border border-line bg-warn-soft p-3 text-sm" role="status">
        <p className="font-medium">Nothing was changed</p>
        {turn.error && <p className="mt-1 text-ink-2">{turn.error}</p>}
      </div>
    );

  async function undo() {
    setBusy(true);
    try {
      const { kept } = await undoBrainChanges(turn.undo);
      updateChanges(turn.id, {
        state: "undone",
        ...(kept
          ? {
              note: `${kept} ${kept === 1 ? "item was" : "items were"} changed again since, so ${kept === 1 ? "it was" : "they were"} left as ${kept === 1 ? "it is" : "they are"}.`,
            }
          : {}),
      });
    } catch (e) {
      updateChanges(turn.id, { note: `Undo failed: ${e instanceof Error ? e.message : "unknown error"}` });
    } finally {
      setBusy(false);
    }
  }

  const undone = turn.state === "undone";
  return (
    <div className={`rounded-xl border border-line p-3 text-sm ${undone ? "bg-sunken" : "bg-ok-soft"}`} role="status">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 font-medium">
          {!undone && <CheckIcon className="size-4 shrink-0 text-ok" />}
          {undone ? "Undone" : "Done"}
        </p>
        {!undone && turn.undo.length > 0 && (
          <Button variant="secondary" disabled={busy} onClick={() => void undo()}>
            Undo
          </Button>
        )}
      </div>
      <ul className={`mt-1 list-disc space-y-1 pl-5 break-words ${undone ? "text-ink-2 line-through" : ""}`}>
        {turn.done.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {turn.note && <p className="mt-2 text-ink-2">{turn.note}</p>}
    </div>
  );
}
