import { useRef, useState, type FormEvent } from "react";
import { Field } from "@base-ui/react/field";
import { planFromFile, type Plan } from "../../core/plans";
import { newId, savePlan } from "../../db/db";
import { PlusIcon } from "../components/icons";
import { Button, Card, Notice, PageTitle, errorStyles, helpStyles, inputStyles, labelStyles } from "../components/ui";
import { formatDate } from "../format";
import { usePlans } from "../hooks";
import { href } from "../router";

/**
 * Protocols: sets of supplements, foods, exercise and sleep habits a person follows, written by them
 * or loaded from a file someone shared. The app never suggests items or amounts.
 */
export function PlansPage() {
  const plans = usePlans();
  const [creating, setCreating] = useState(false);
  const [importError, setImportError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  async function importFile(file: File) {
    setImportError(undefined);
    if (file.size > 500_000) return setImportError("This file is too large to be a protocol.");
    const r = planFromFile(await file.text(), newId, new Date().toISOString());
    if (!r.ok) return setImportError(r.error);
    await savePlan(r.plan);
    location.hash = href({ name: "plan", id: r.plan.id });
  }

  return (
    <>
      <PageTitle sub="Write down the routine you follow, or one you want to try: supplements, foods, exercise, sleep. See what research says about each supplement and whether items interact, then start it to track what changes.">
        Protocols
      </PageTitle>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button onClick={() => setCreating(true)} disabled={creating}>
          <PlusIcon /> New protocol
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          Load a protocol file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
      </div>
      {importError && (
        <Notice tone="warn" title="That file couldn't be loaded" className="mb-5">
          {importError}
        </Notice>
      )}

      {creating && <NewPlanForm onCancel={() => setCreating(false)} />}

      {plans === undefined ? (
        <p className="text-ink-2">Loading…</p>
      ) : plans.length === 0 ? (
        !creating && (
          <Card className="flex flex-col gap-2">
            <h2 className="font-serif text-2xl font-normal">No protocols yet</h2>
            <p className="text-ink-2">
              A protocol is a set of things you do together, like a morning supplement stack, a way of eating, or a training and sleep
              routine. Add the items with your own amounts and times. Someone else's protocol can be loaded from a file they shared.
            </p>
            <p className="text-sm text-ink-2">
              The app explains what research says about each supplement but never suggests what or how much to take. Talk to your doctor or
              pharmacist before starting supplements, especially with medicines.
            </p>
          </Card>
        )
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <li key={p.id}>
              <PlanCard p={p} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PlanCard({ p }: { p: Plan }) {
  const kinds = [...new Set(p.items.map((i) => i.category))];
  return (
    <a
      href={href({ name: "plan", id: p.id })}
      className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-ink no-underline transition-[border-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-serif text-2xl font-normal">{p.name}</h2>
        {p.active && <span className="shrink-0 rounded-full bg-ok-soft px-2.5 py-0.5 text-sm font-medium text-ok">Running</span>}
      </div>
      {p.description && <p className="line-clamp-2 text-ink-2">{p.description}</p>}
      <p className="mt-auto text-sm text-ink-2">
        {p.items.length} {p.items.length === 1 ? "item" : "items"}
        {kinds.length > 0 && ` · ${kinds.map((k) => ({ supplement: "supplements", diet: "food", medication: "medicines", lifestyle: "lifestyle" })[k]).join(", ")}`}
        {p.active && ` · since ${formatDate(p.active.since)}`}
      </p>
    </a>
  );
}

function NewPlanForm({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the protocol a name.");
    const plan: Plan = { id: newId(), name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), items: [], createdAt: new Date().toISOString() };
    await savePlan(plan);
    location.hash = href({ name: "plan", id: plan.id });
  }

  return (
    <Card className="mb-5">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-normal">New protocol</h2>
        <Field.Root invalid={!!error} className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Name</Field.Label>
          <Field.Control value={name} onValueChange={setName} placeholder="e.g. Morning stack, Marathon training" maxLength={80} autoComplete="off" className={inputStyles} />
          <Field.Error match={!!error} className={errorStyles}>
            {error}
          </Field.Error>
        </Field.Root>
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Description (optional)</Field.Label>
          <Field.Control
            render={<textarea rows={2} />}
            value={description}
            onValueChange={setDescription}
            maxLength={1000}
            className={inputStyles}
          />
          <Field.Description className={helpStyles}>What it's for, or where it comes from.</Field.Description>
        </Field.Root>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Create and add items</Button>
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
