import type { SafetyNote } from "@bt/shared/core/protocols";

/** Prominent "talk to your doctor" notes for entries that change what is safe. */
export function SafetyNotices({ notes }: { notes: SafetyNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div role="note" className="flex flex-col gap-3 rounded-xl border-2 border-warn/50 bg-warn-soft p-4">
      <p className="flex items-center gap-2 font-semibold">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-warn text-sm font-bold text-surface">
          !
        </span>
        Talk to your doctor before changing diet or supplements
      </p>
      {notes.map((n) => (
        <p key={n.id}>
          <span className="font-medium">{n.title}: </span>
          <span className="text-ink-2">{n.text}</span>
        </p>
      ))}
    </div>
  );
}
