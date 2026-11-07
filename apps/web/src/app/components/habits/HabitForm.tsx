import { useState, type FormEvent, type ReactNode } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";

import { BASELINE_WINDOW_DAYS, beforeResults } from "@bt/shared/core/experiments";
import { chanceNote, defaultRetestDays, suggestMarkers } from "@bt/shared/core/habits";
import { validateProtocol, type ProtocolCategory, type ProtocolField } from "@bt/shared/core/protocols";

import type { Experiment, Measurement, ProtocolEntry } from "@bt/shared/core/types";

import { createHabit, saveHabit, startPlan } from "../../../db/db";
import { ChoiceGroup } from "../ChoiceGroup";

import { SegmentTabs } from "../SegmentTabs";
import { Button, CheckIcon, Notice, errorStyles, helpStyles, inputStyles, labelStyles } from "../ui";
import { CATEGORY_LABEL, formatDate } from "../../format";
import { useMeals, usePlans } from "../../hooks";
import { BIOMARKERS, BIOMARKER_MAP, CATEGORY_ORDER } from "../../knowledge";
import { href } from "../../router";
import { MarkerChoice } from "../../pages/ExperimentsPage";
import { PHENOAGE_GAP_DEF, PHENOAGE_GAP_ID } from "@bt/shared/core/phenoageWatch";

import { SimpleSelect } from "../UnitSelect";

export const RETEST_OPTIONS = [
  { value: "28", label: "4 weeks" },
  { value: "56", label: "8 weeks" },
  { value: "84", label: "12 weeks" },
];

/** Checkboxes for markers: suggested ones first, then those with results, then (on request) all. */
export function MarkerPicker({
  label,
  start,
  all,
  tested,
  markerIds,
  onChange,
}: {
  label: string | Pick<ProtocolEntry, "label" | "plan">;
  start: string;
  all: Measurement[];
  tested: ReadonlySet<string>;
  markerIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const suggested = suggestMarkers(label, (id) => tested.has(id));
  // The PhenoAge gap is offered once there's a complete PhenoAge blood test.
  const markers = tested.has(PHENOAGE_GAP_ID) ? [PHENOAGE_GAP_DEF, ...BIOMARKERS] : BIOMARKERS;
  const pool = markers.filter((d) => showAll || tested.has(d.id) || markerIds.includes(d.id) || suggested.includes(d.id));
  const ordered = [...pool.filter((d) => suggested.includes(d.id)), ...CATEGORY_ORDER.flatMap((c) => pool.filter((d) => d.category === c && !suggested.includes(d.id)))];
  const draft: Experiment = { id: "draft", change: typeof label === "string" ? label : label.label, category: "diet", markerIds, start, retestAfterDays: 56 };
  const allShown = ordered.length > 0 && ordered.every((d) => markerIds.includes(d.id));
  const chance = chanceNote(markerIds.length);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={labelStyles}>Markers to watch</legend>
      <p className={helpStyles}>
        {suggested.length > 0 ? "Suggested ones first, from what's known to affect them. " : ""}A "before" result needs to be from the{" "}
        {Math.round(BASELINE_WINDOW_DAYS / 30)} months before the start.
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3">
        <Button
          variant="link"
          onClick={() => onChange(allShown ? markerIds.filter((id) => !ordered.some((d) => d.id === id)) : [...new Set([...markerIds, ...ordered.map((d) => d.id)])])}
        >
          {allShown ? "Clear all" : `Select all (${ordered.length})`}
        </Button>
        <span className="text-sm text-ink-2" aria-live="polite">
          {markerIds.length} {markerIds.length === 1 ? "marker" : "markers"} chosen
        </span>
      </div>
      {chance && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-ink">{chance}</p>}
      <ul className="mt-1 flex max-h-80 flex-col overflow-y-auto">
        {ordered.map((d) => (
          <li key={d.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <MarkerChoice
                def={d}
                checked={markerIds.includes(d.id)}
                onChange={(on) => onChange(on ? [...markerIds, d.id] : markerIds.filter((x) => x !== d.id))}
                baseline={markerIds.includes(d.id) ? beforeResults(draft, all.filter((m) => m.biomarkerId === d.id)).at(-1) : undefined}
              />
            </div>
            {suggested.includes(d.id) && <span className="mt-2.5 shrink-0 rounded-full bg-accent-soft px-2 text-xs text-accent">suggested</span>}
          </li>
        ))}
      </ul>
      {!showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="min-h-11 self-start text-sm text-ink-2 underline underline-offset-2">
          Show all markers
        </button>
      )}
    </fieldset>
  );
}

// ---- Add or edit ---------------------------------------------------------------------------------

export function HabitForm({
  initial,
  prefillLabel,
  prefillMarker,
  prefillMeal,
  prefillCategory,
  today,
  all,
  tested,
  onDone,
}: {
  initial?: ProtocolEntry;
  prefillLabel?: string;
  prefillMarker?: string;
  prefillMeal?: string;
  prefillCategory?: ProtocolCategory;
  today: string;
  all: Measurement[];
  tested: ReadonlySet<string>;
  onDone: () => void;
}) {
  const meals = useMeals() ?? [];
  const plans = usePlans() ?? [];
  const startMeal = prefillMeal ? meals.find((m) => m.id === prefillMeal) : undefined;
  // A new habit can start from your own words, one of your meals, or a whole protocol.
  const [from, setFrom] = useState<"own" | "meal" | "protocol">(prefillMeal ? "meal" : "own");
  const [mealId, setMealId] = useState(prefillMeal ?? "");
  const [planId, setPlanId] = useState("");
  const [label, setLabel] = useState(initial?.label ?? prefillLabel?.slice(0, 80) ?? "");
  const [category, setCategory] = useState<ProtocolCategory>(initial?.category ?? prefillCategory ?? (prefillMeal ? "diet" : "supplement"));
  // A meal chosen by link fills the name in once the meals have loaded.
  const [filled, setFilled] = useState(false);
  if (startMeal && !filled && !label) {
    setFilled(true);
    setLabel(startMeal.name.slice(0, 80));
  }
  const pickMeal = (id: string) => {
    setMealId(id);
    const m = meals.find((x) => x.id === id);
    if (m) {
      setLabel(m.name.slice(0, 80));
      setCategory("diet");
    }
  };
  const plan = plans.find((p) => p.id === (planId || plans[0]?.id));
  const [start, setStart] = useState(initial?.start ?? today);
  const [end, setEnd] = useState(initial?.end ?? "");
  const [watching, setWatching] = useState(!!prefillMarker);
  const [markerIds, setMarkerIds] = useState<string[]>(prefillMarker && BIOMARKER_MAP.has(prefillMarker) ? [prefillMarker] : []);
  const [retest, setRetest] = useState("56");
  const [errors, setErrors] = useState<Partial<Record<ProtocolField | "markers", string>>>({});
  const [saving, setSaving] = useState(false);
  const planned = start > today;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = validateProtocol({ label, category, start, end: planned ? "" : end }, today);
    if (!r.ok) return setErrors(r.errors);
    if (!initial && watching && markerIds.length === 0) return setErrors({ markers: "Choose at least one marker, or untick watching." });
    setSaving(true);
    try {
      if (initial) {
        await saveHabit({ ...r.entry, id: initial.id, ...(initial.plan ? { plan: initial.plan } : {}) });
      } else {
        await createHabit(r.entry, watching ? { markerIds, retestAfterDays: Number(retest), today } : undefined);
      }
      onDone();
    } catch (error) {
      setErrors({ label: error instanceof Error ? error.message : "The habit couldn't be saved. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  // A new habit starts from the person's own words, a meal or a protocol; editing has no choice.
  const withSource = (content: ReactNode) =>
    initial ? (
      content
    ) : (
      <SegmentTabs
        label="Start from"
        tabs={[
          { value: "own", label: "Write your own" },
          { value: "meal", label: "A meal" },
          { value: "protocol", label: "A protocol" },
        ]}
        value={from}
        onChange={setFrom}
        className="flex flex-col gap-5"
      >
        {content}
      </SegmentTabs>
    );

  if (!initial && from === "protocol") {
    return withSource(
      <div className="flex flex-col gap-5">
        {plans.length === 0 ? (
          <p className="text-ink-2">
            No protocols yet. <a href={href({ name: "plans" })}>Write one in Protocols</a>: a set of supplements, foods or routines you follow.
          </p>
        ) : (
          <>
            <SimpleSelect
              label="Protocol"
              options={plans.map((p) => ({ value: p.id, label: `${p.name} (${p.items.length} ${p.items.length === 1 ? "item" : "items"})` }))}
              value={plan?.id ?? null}
              onChange={setPlanId}
            />
            {plan?.active ? (
              <p className="text-ink-2">
                Running since {formatDate(plan.active.since)}. Already recorded in Habits below; <a href={href({ name: "plan", id: plan.id })}>open the protocol</a> to stop it.
              </p>
            ) : (
              <>
                <Field.Root className="flex flex-col gap-1.5 sm:max-w-xs">
                  <Field.Label className={labelStyles}>Start</Field.Label>
                  <Field.Control type="date" value={start} onValueChange={setStart} className={inputStyles} />
                  <Field.Description className={helpStyles}>Adds one habit named after the protocol, with all items included. Watch markers for the whole routine afterwards.</Field.Description>
                </Field.Root>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!plan || plan.items.length === 0 || saving}
                    onClick={() => {
                      if (!plan) return;
                      setSaving(true);
                      void startPlan(plan, start || today).then(() => {
                        setSaving(false);
                        onDone();
                      });
                    }}
                  >
                    Start protocol
                  </Button>
                  <Button variant="quiet" onClick={onDone}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    );
  }

  return withSource(
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {!initial && from === "meal" &&
        (meals.length === 0 ? (
          <p className="text-ink-2">
            No meals yet. <a href={href({ name: "meals" })}>Build one in Meals</a>, or write your own.
          </p>
        ) : (
          <SimpleSelect
            label="Meal"
            placeholder="Choose a meal"
            options={meals.map((m) => ({ value: m.id, label: m.name }))}
            value={mealId || null}
            onChange={pickMeal}
          />
        ))}
      <Field.Root invalid={!!errors.label} className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>{initial?.plan ? "Protocol habit name" : "What do you take or change?"}</Field.Label>
        <Field.Control value={label} onValueChange={setLabel} placeholder="e.g. Vitamin D 2000 IU daily" autoComplete="off" maxLength={100} className={inputStyles} />
        <Field.Description className={helpStyles}>{initial?.plan ? "Included items stay as recorded when you started." : "Include the amount and how often, if it applies."}</Field.Description>
        <Field.Error match={!!errors.label} className={errorStyles}>
          {errors.label}
        </Field.Error>
      </Field.Root>

      {!initial?.plan && (
        <>
          <ChoiceGroup<ProtocolCategory>
            label="Type"
            value={category}
            onChange={setCategory}
            options={(Object.keys(CATEGORY_LABEL) as ProtocolCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
          {category === "medication" && <Notice>This is only for your own record. Don't start, stop or change a medicine without talking to your doctor.</Notice>}
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field.Root invalid={!!errors.start} className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Start</Field.Label>
          <Field.Control type="date" value={start} onValueChange={setStart} className={inputStyles} />
          <Field.Description className={helpStyles}>A date ahead is fine: plan it, and get a "before" test first.</Field.Description>
          <Field.Error match={!!errors.start} className={errorStyles}>
            {errors.start}
          </Field.Error>
        </Field.Root>
        {!planned && (
          <Field.Root invalid={!!errors.end} className="flex flex-col gap-1.5">
            <Field.Label className={labelStyles}>Stopped (optional)</Field.Label>
            <Field.Control type="date" value={end} min={start} max={today} onValueChange={setEnd} className={inputStyles} />
            <Field.Description className={helpStyles}>Leave empty if you're still doing this.</Field.Description>
            <Field.Error match={!!errors.end} className={errorStyles}>
              {errors.end}
            </Field.Error>
          </Field.Root>
        )}
      </div>

      {!initial && (
        <div className="flex flex-col gap-4 rounded-xl border border-line bg-sunken p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox.Root
              checked={watching}
              onCheckedChange={setWatching}
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent"
            >
              <Checkbox.Indicator className="flex data-unchecked:hidden">
                <CheckIcon />
              </Checkbox.Indicator>
            </Checkbox.Root>
            <span>
              <span className="block font-medium">Watch what changes</span>
              <span className={helpStyles}>Pick markers now, before you see results, and the app compares before and after with normal variation.</span>
            </span>
          </label>
          {watching && (
            <>
              <MarkerPicker
                label={label}
                start={start}
                all={all}
                tested={tested}
                markerIds={markerIds}
                onChange={(ids) => {
                  setMarkerIds(ids);
                  setRetest((r) => String(Math.max(Number(r), defaultRetestDays(ids))));
                }}
              />
              {errors.markers && <p className={errorStyles}>{errors.markers}</p>}
              <ChoiceGroup<string> label="Re-test after" help="Markers need time to respond. HbA1c reflects about the last 3 months." value={retest} onChange={setRetest} options={RETEST_OPTIONS} />
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          Save
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
