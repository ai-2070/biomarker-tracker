import { useState, type FormEvent } from "react";
import { Field } from "@base-ui/react/field";
import { todayIso } from "../../core/dates";
import {
  durationDays,
  safetyNotes,
  sortProtocols,
  validateProtocol,
  type ProtocolCategory,
  type ProtocolField,
} from "../../core/protocols";
import type { ProtocolEntry } from "../../core/types";
import { addProtocol, deleteProtocol, saveProtocol } from "../../db/db";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SafetyNotices } from "../components/SafetyNotices";
import { Button, Card, Notice, PageTitle, errorStyles, helpStyles, inputStyles, labelStyles } from "../components/ui";
import { CATEGORY_LABEL, formatDate, formatDuration } from "../format";
import { useProtocols } from "../hooks";
import { href } from "../router";

export function LogPage({ prefill }: { prefill?: string }) {
  const entries = useProtocols();
  const [adding, setAdding] = useState(prefill !== undefined);
  const [editing, setEditing] = useState<string | null>(null);
  const today = todayIso();

  if (entries === undefined) return <p className="text-ink-2">Loading…</p>;
  const sorted = sortProtocols(entries);
  const ongoing = sorted.filter((p) => !p.end);
  const past = sorted.filter((p) => p.end);

  return (
    <>
      <PageTitle sub="Note supplements, diet changes, medicines and habits with their dates. They appear on your charts, so you can see what was going on around each test.">
        Your log
      </PageTitle>

      <div className="flex flex-col gap-5">
        <SafetyNotices notes={safetyNotes(ongoing.map((p) => p.label))} />

        <a
          href={href({ name: "experiments" })}
          className="flex items-center justify-between gap-3 rounded-xl border border-line bg-accent-soft p-4 text-ink no-underline hover:border-line-strong"
        >
          <span>
            <span className="block font-medium">Self-experiments</span>
            <span className="text-sm text-ink-2">Test one change on yourself: results before and after, compared with normal variation.</span>
          </span>
          <span aria-hidden="true" className="text-xl text-accent">→</span>
        </a>

        {adding ? (
          <Card>
            <h2 className="mb-4 font-serif text-2xl font-normal">New entry</h2>
            <ProtocolForm
              today={today}
              prefillLabel={prefill}
              onCancel={() => setAdding(false)}
              onSave={async (entry) => {
                await addProtocol(entry);
                setAdding(false);
              }}
            />
          </Card>
        ) : (
          <div>
            <Button onClick={() => setAdding(true)}>Add entry</Button>
          </div>
        )}

        {entries.length === 0 && !adding && (
          <Card className="flex flex-col gap-2 text-ink-2">
            <p>Nothing logged yet. Examples of what people track:</p>
            <ul className="list-disc pl-5">
              <li>Vitamin D 2000 IU daily</li>
              <li>Started eating more fish</li>
              <li>Statin (as prescribed)</li>
              <li>Running 3 times a week</li>
            </ul>
          </Card>
        )}

        {[
          { title: "Ongoing", list: ongoing },
          { title: "Past", list: past },
        ]
          .filter((g) => g.list.length > 0)
          .map((g) => (
            <section key={g.title} aria-labelledby={`log-${g.title}`}>
              <h2 id={`log-${g.title}`} className="mb-2 font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">
                {g.title}
              </h2>
              <ul className="flex flex-col gap-2">
                {g.list.map((p) => (
                  <li key={p.id}>
                    {editing === p.id ? (
                      <Card>
                        <ProtocolForm
                          today={today}
                          initial={p}
                          onCancel={() => setEditing(null)}
                          onSave={async (entry) => {
                            await saveProtocol({ ...entry, id: p.id });
                            setEditing(null);
                          }}
                        />
                      </Card>
                    ) : (
                      <EntryCard entry={p} today={today} onEdit={() => setEditing(p.id)} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

        <p className="text-sm text-ink-2">
          Seeing a marker change after you started something doesn't prove that it caused the change. Other things change at the same
          time, and results vary from test to test.
        </p>
      </div>
    </>
  );
}

function EntryCard({ entry: p, today, onEdit }: { entry: ProtocolEntry; today: string; onEdit: () => void }) {
  const days = durationDays(p, today);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line bg-surface p-4">
      <div className="min-w-0">
        <p className="font-medium break-words">{p.label}</p>
        <p className="text-sm text-ink-2">
          {CATEGORY_LABEL[p.category]} ·{" "}
          {p.end ? `${formatDate(p.start)} – ${formatDate(p.end)}` : `since ${formatDate(p.start)}`} · {formatDuration(days)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {!p.end && (
          <Button variant="secondary" className="text-sm" onClick={() => void saveProtocol({ ...p, end: today })}>
            Stopped today
          </Button>
        )}
        <Button variant="quiet" className="text-sm" onClick={onEdit}>
          Edit
        </Button>
        <ConfirmDialog
          trigger="Delete"
          triggerVariant="quiet"
          triggerClassName="text-sm"
          title="Delete this entry?"
          description={`"${p.label}" will be removed from your log. Your test results are not affected.`}
          confirmLabel="Delete entry"
          onConfirm={() => deleteProtocol(p.id)}
        />
      </div>
    </div>
  );
}

function ProtocolForm({
  initial,
  prefillLabel,
  today,
  onSave,
  onCancel,
}: {
  initial?: ProtocolEntry;
  /** Suggested label, e.g. from "Add to my log" on a marker page. */
  prefillLabel?: string;
  today: string;
  onSave: (entry: Omit<ProtocolEntry, "id">) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? prefillLabel?.slice(0, 80) ?? "");
  const [category, setCategory] = useState<ProtocolCategory>(initial?.category ?? "supplement");
  const [start, setStart] = useState(initial?.start ?? today);
  const [end, setEnd] = useState(initial?.end ?? "");
  const [errors, setErrors] = useState<Partial<Record<ProtocolField, string>>>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = validateProtocol({ label, category, start, end }, today);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setSaving(true);
    try {
      await onSave(r.entry);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field.Root invalid={!!errors.label} className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>What did you take or change?</Field.Label>
        <Field.Control
          value={label}
          onValueChange={setLabel}
          placeholder="e.g. Vitamin D 2000 IU daily"
          autoComplete="off"
          maxLength={100}
          className={inputStyles}
        />
        <Field.Description className={helpStyles}>Include the amount and how often, if it applies.</Field.Description>
        <Field.Error match={!!errors.label} className={errorStyles}>
          {errors.label}
        </Field.Error>
      </Field.Root>

      <ChoiceGroup<ProtocolCategory>
        label="Type"
        value={category}
        onChange={setCategory}
        options={(Object.keys(CATEGORY_LABEL) as ProtocolCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
      />
      {category === "medication" && (
        <Notice>
          This log is only for your own record. Don't start, stop or change a medicine without talking to your doctor.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field.Root invalid={!!errors.start} className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Started</Field.Label>
          <Field.Control type="date" value={start} max={today} onValueChange={setStart} className={inputStyles} />
          <Field.Error match={!!errors.start} className={errorStyles}>
            {errors.start}
          </Field.Error>
        </Field.Root>
        <Field.Root invalid={!!errors.end} className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Stopped (optional)</Field.Label>
          <Field.Control type="date" value={end} min={start} max={today} onValueChange={setEnd} className={inputStyles} />
          <Field.Description className={helpStyles}>Leave empty if you're still doing this.</Field.Description>
          <Field.Error match={!!errors.end} className={errorStyles}>
            {errors.end}
          </Field.Error>
        </Field.Root>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          Save
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
