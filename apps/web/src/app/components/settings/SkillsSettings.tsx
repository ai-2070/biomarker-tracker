import { useEffect, useState } from "react";
import { Field } from "@base-ui/react/field";
import { Switch } from "@base-ui/react/switch";
import { localServer } from "../../api";
import type { SkillListing } from "@bt/shared/api/types";
import { ConfirmDialog } from "../ConfirmDialog";
import { Button, Card, Notice, helpStyles, inputStyles, labelStyles } from "../ui";

type SkillRow = SkillListing;

const TEMPLATE = `---
name: My skill
description: Use when … (say when the assistant should use it)
---

# Steps
1. …

Always suggest discussing changes with a doctor.
`;

export function OnOff({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="flex h-7 w-12 shrink-0 items-center rounded-full border border-line-strong bg-sunken p-0.5 transition-colors duration-200 data-checked:border-accent data-checked:bg-accent"
    >
      <Switch.Thumb className="size-5 rounded-full bg-surface shadow-sm transition-transform duration-200 ease-[var(--ease-soft)] data-checked:translate-x-5" />
    </Switch.Root>
  );
}

/** Skills: instructions the assistant loads when a task needs them. */
export function SkillsSettings() {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [open, setOpen] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => localServer.skills.list.query().then((r) => setSkills(r.skills));
  useEffect(() => {
    void load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load skills."));
  }, []);

  async function toggle(id: string, enabled: boolean) {
    setSkills((list) => list?.map((s) => (s.id === id ? { ...s, enabled } : s)) ?? null);
    await localServer.skills.setEnabled.mutate({ id, enabled }).finally(load);
  }
  async function view(id: string) {
    if (open[id] !== undefined) {
      const { [id]: _gone, ...rest } = open;
      setOpen(rest);
      return;
    }
    const s = await localServer.skills.get.query({ id });
    setOpen({ ...open, [id]: s.body });
  }
  async function add() {
    setError(null);
    try {
      await localServer.skills.add.mutate({ markdown: draft });
      setDraft("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the skill.");
    }
  }

  if (!skills) return error ? <Notice tone="danger">{error}</Notice> : <p className="text-ink-2">Loading…</p>;
  return (
    <div className="flex flex-col gap-5">
      <Notice>
        Skills are step-by-step instructions in plain words. The assistant sees their names and loads one when a question needs it. The built-in ones
        cover medical and nutrition research; you can switch them off or add your own.
      </Notice>
      <ul className="stagger flex flex-col gap-2">
        {skills.map((s) => (
          <li key={s.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {s.name} <span className="ml-1 rounded-full bg-sunken px-2 py-0.5 font-mono text-[11px] tracking-wide text-ink-2 uppercase">{s.source === "bundled" ? "Built-in" : "Yours"}</span>
                </p>
                <p className="text-sm text-ink-2">{s.description}</p>
              </div>
              <OnOff checked={s.enabled} onChange={(v) => void toggle(s.id, v)} label={`Use the ${s.name} skill`} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button variant="quiet" className="text-sm" onClick={() => void view(s.id)}>
                {open[s.id] !== undefined ? "Hide instructions" : "Read instructions"}
              </Button>
              {s.source === "custom" && (
                <ConfirmDialog
                  trigger="Delete"
                  triggerVariant="quiet"
                  triggerClassName="text-sm"
                  title="Delete this skill?"
                  description={`"${s.name}" will be removed.`}
                  confirmLabel="Delete skill"
                  onConfirm={async () => {
                    await localServer.skills.remove.mutate({ id: s.id });
                    await load();
                  }}
                />
              )}
            </div>
            {open[s.id] !== undefined && <pre className="animate-enter mt-2 max-h-80 overflow-auto rounded-lg bg-sunken p-3 font-mono text-xs whitespace-pre-wrap text-ink-2">{open[s.id]}</pre>}
          </li>
        ))}
      </ul>

      <Card className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">Add your own skill</h2>
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Skill (SKILL.md format)</Field.Label>
          <Field.Control render={<textarea rows={10} />} value={draft} onValueChange={setDraft} placeholder={TEMPLATE} className={`${inputStyles} py-2 font-mono text-sm`} />
          <Field.Description className={helpStyles}>A name and a description between --- lines, then the instructions. Keep the safety rules: explain, don't prescribe.</Field.Description>
        </Field.Root>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-2">
          <Button onClick={() => void add()} disabled={!draft.trim()}>
            Add skill
          </Button>
          {!draft && (
            <Button variant="quiet" onClick={() => setDraft(TEMPLATE)}>
              Start from a template
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
