import { useState, type FormEvent } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { todayIso } from "../../core/dates";
import { BASELINE_WINDOW_DAYS, beforeResults, retestDate, type MarkerResult } from "../../core/experiments";
import { chanceNote, defaultRetestDays, habitsOf, pickedAfterResults, suggestMarkers, summarizeWatch, type Habit } from "../../core/habits";
import { durationDays, safetyLabels, safetyNotes, validateProtocol, type ProtocolCategory, type ProtocolField } from "../../core/protocols";
import { groupByBiomarker } from "../../core/trends";
import type { Experiment, Measurement, ProtocolEntry } from "../../core/types";
import { addProtocol, deleteExperiment, deleteHabit, saveHabit, startPlan, watchHabit } from "../../db/db";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PlusIcon } from "../components/icons";
import { SafetyNotices } from "../components/SafetyNotices";
import { Button, Card, CheckIcon, Notice, PageTitle, cx, errorStyles, helpStyles, inputStyles, labelStyles } from "../components/ui";
import { CATEGORY_LABEL, formatDate, formatChange, formatDuration, showWatchValue, valueUnit } from "../format";
import { useAllMeasurements, useExperiments, useWatchMeasurements, useMeals, usePlans, useProfile, useProtocols } from "../hooks";
import { BIOMARKERS, BIOMARKER_MAP, CATEGORY_ORDER, WATCH_DEFS, shortName, watchDef } from "../knowledge";
import { href } from "../router";
import { MarkerChoice, PhaseBadge } from "./ExperimentsPage";
import { PHENOAGE_GAP_DEF, PHENOAGE_GAP_ID } from "../../core/phenoageWatch";

const RETEST_OPTIONS = [
  { value: "28", label: "4 weeks" },
  { value: "56", label: "8 weeks" },
  { value: "84", label: "12 weeks" },
];

/**
 * Habits: supplements, food, medicines and routines with their dates. Any habit can watch markers;
 * then it shows what changed, compared with normal test-to-test variation (the old self-experiments).
 */
export function HabitsPage({ add, marker, meal, type }: { add?: string; marker?: string; meal?: string; type?: ProtocolCategory }) {
  const protocols = useProtocols();
  const experiments = useExperiments();
  // Results plus the PhenoAge gap at each complete blood test, so the gap can be watched like a marker.
  const all = useWatchMeasurements(useAllMeasurements());
  const profile = useProfile();
  const [adding, setAdding] = useState(add !== undefined || meal !== undefined);
  const today = todayIso();

  if (!protocols || !experiments || !all) return <p className="text-ink-2">Loading…</p>;
  const habits = habitsOf(protocols, experiments);
  const tested = new Set(groupByBiomarker(all).keys());
  const groups = [
    { title: "Planned", list: habits.filter((h) => h.start > today) },
    { title: "Ongoing", list: habits.filter((h) => h.start <= today && !h.end) },
    { title: "Past", list: habits.filter((h) => h.end) },
  ].filter((g) => g.list.length > 0);

  return (
    <>
      <PageTitle sub="Supplements, food, medicines and routines, with their dates. Pick markers to watch and see what changed in you, compared with normal test-to-test variation.">
        Habits
      </PageTitle>

      <div className="flex flex-col gap-5">
        <SafetyNotices notes={safetyNotes(safetyLabels(habits.flatMap((h) => (h.entry && !h.end ? [h.entry] : [])), profile))} />

        {adding ? (
          <Card>
            <h2 className="mb-4 font-serif text-2xl font-normal">New habit</h2>
            <HabitForm today={today} all={all} tested={tested} prefillLabel={add} prefillMarker={marker} prefillMeal={meal} prefillCategory={type} onDone={() => setAdding(false)} />
          </Card>
        ) : (
          <div>
            <Button onClick={() => setAdding(true)}>
              <PlusIcon />
              Add a habit
            </Button>
          </div>
        )}

        {habits.length === 0 && !adding && (
          <Card className="flex flex-col gap-3 text-ink-2">
            <p>Nothing here yet. Examples of what people add:</p>
            <ul className="list-disc pl-5">
              <li>Vitamin D 2000 IU daily</li>
              <li>Oats for breakfast every day</li>
              <li>Statin (as prescribed)</li>
              <li>Running 3 times a week</li>
            </ul>
            <p>
              Habits show on your charts and timeline. Pick markers to watch, and the app compares results from before and after you started
              with that marker's normal variation.
            </p>
          </Card>
        )}

        {groups.map((g) => (
          <section key={g.title} aria-labelledby={`habits-${g.title}`}>
            <h2 id={`habits-${g.title}`} className="mb-2 font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">
              {g.title}
            </h2>
            <ul className="stagger flex flex-col gap-3">
              {g.list.map((h) => (
                <li key={h.id}>
                  <HabitCard habit={h} all={all} tested={tested} today={today} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="text-sm text-ink-2">
          A marker changing after you started something doesn't prove that it caused the change. Other things change at the same time, and
          results vary from test to test. What happened in you may not happen in someone else.
        </p>
      </div>
    </>
  );
}

// ---- A habit ------------------------------------------------------------------------------------

function HabitCard({ habit: h, all, tested, today }: { habit: Habit; all: Measurement[]; tested: ReadonlySet<string>; today: string }) {
  const [mode, setMode] = useState<"view" | "edit" | "watch">("view");
  const days = durationDays(h, today);
  const planned = h.start > today;

  if (mode === "edit" && h.entry) {
    return (
      <Card>
        <HabitForm today={today} all={all} tested={tested} initial={h.entry} onDone={() => setMode("view")} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {h.watch ? (
            <a href={href({ name: "experiment", id: h.watch.id })} className="font-medium break-words text-ink underline-offset-2 hover:text-accent hover:underline">
              {h.label}
            </a>
          ) : (
            <p className="font-medium break-words">{h.label}</p>
          )}
          <p className="text-sm text-ink-2">
            {CATEGORY_LABEL[h.category]} ·{" "}
            {planned ? `starts ${formatDate(h.start)}` : h.end ? `${formatDate(h.start)} – ${formatDate(h.end)}` : `since ${formatDate(h.start)}`}
            {!planned && ` · ${formatDuration(days)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {!h.end && !planned && h.entry && (
            <Button variant="secondary" className="min-h-10 text-sm" onClick={() => void saveHabit({ ...h.entry!, end: today })}>
              Stopped today
            </Button>
          )}
          {h.entry && (
            <Button variant="quiet" className="min-h-10 text-sm" onClick={() => setMode("edit")}>
              Edit
            </Button>
          )}
          <ConfirmDialog
            trigger="Delete"
            triggerVariant="quiet"
            triggerClassName="min-h-10 text-sm"
            title="Delete this habit?"
            description={`"${h.label}" is removed${h.watch ? ", with the markers it watched" : ""}. Your test results are not affected.`}
            confirmLabel="Delete habit"
            onConfirm={() => deleteHabit(h)}
          />
        </div>
      </div>

      {mode === "watch" ? (
        <WatchPicker habit={h} all={all} tested={tested} today={today} onDone={() => setMode("view")} />
      ) : h.watch ? (
        <WhatChanged watch={h.watch} all={all} today={today} onChange={h.entry ? () => setMode("watch") : undefined} />
      ) : (
        <WatchSuggestions habit={h} tested={tested} today={today} onPick={() => setMode("watch")} />
      )}
    </div>
  );
}

const SHORT_VERDICT: Record<MarkerResult["verdict"], string> = {
  rise: "Rose beyond normal variation",
  fall: "Fell beyond normal variation",
  "within-noise": "Within normal variation",
  "no-baseline": "No 'before' result",
  waiting: "Waiting for the re-test",
  "no-variation-data": "Needs more results",
  "below-limit": "Can't be judged",
};

/** The watched markers: before → after, the change, and whether it's beyond normal variation. */
function WhatChanged({ watch, all, today, onChange }: { watch: Experiment; all: Measurement[]; today: string; onChange?: () => void }) {
  const s = summarizeWatch(watch, WATCH_DEFS, all, today);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-2 uppercase">What changed</p>
        <div className="flex items-center gap-2">
          {s.phase !== "complete" && <PhaseBadge phase={s.phase} />}
          <a href={href({ name: "experiment", id: watch.id })} className="min-h-9 content-center text-sm font-medium text-accent no-underline hover:underline">
            Details
          </a>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {s.results.map((r) => (
          <ChangeRow key={r.biomarkerId} r={r} />
        ))}
      </ul>
      {s.phase === "running" && <p className="text-sm text-ink-2">Re-test from {formatDate(retestDate(watch))}. Keep the habit going until then.</p>}
      {s.phase === "due" && <p className="text-sm text-warn">Time for the "after" test. Add the results and they'll show here.</p>}
      {pickedAfterResults(watch) && <p className="text-sm text-ink-2">Markers picked after the results were in: treat this as a hint, not a test.</p>}
      {chanceNote(s.results.length) && <p className="text-sm text-ink-2">{chanceNote(s.results.length)}</p>}
      {onChange && (
        <div className="flex flex-wrap gap-1">
          <Button variant="quiet" className="min-h-9 px-2 text-sm" onClick={onChange}>
            Change markers
          </Button>
          <ConfirmDialog
            trigger="Stop watching"
            triggerVariant="quiet"
            triggerClassName="min-h-9 px-2 text-sm"
            title="Stop watching these markers?"
            description="The comparison is removed. The habit and your test results are kept."
            confirmLabel="Stop watching"
            onConfirm={() => deleteExperiment(watch.id)}
          />
        </div>
      )}
    </div>
  );
}

function ChangeRow({ r }: { r: MarkerResult }) {
  const def = watchDef(r.biomarkerId)!;
  const unit = def.canonicalUnit;
  const beyond = r.verdict === "rise" || r.verdict === "fall";
  const value = (v?: number) => (v === undefined ? "–" : showWatchValue(def, v, unit));
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 sm:grid sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
      <a href={def.id === PHENOAGE_GAP_ID ? href({ name: "phenoage" }) : href({ name: "marker", id: def.id })} className="min-w-0 font-medium text-ink no-underline hover:underline sm:truncate">
        {shortName(def)}
      </a>
      {/* Phones: name and verdict on one line, the numbers below. */}
      <span className="order-last basis-full text-sm text-ink-2 tabular-nums sm:order-none sm:basis-auto">
        {value(r.beforeValue)} → {value(r.afterValue)} {valueUnit(def, unit)}
        {r.change !== undefined && <span className={cx("ml-2 font-medium", beyond ? "text-ink" : "text-ink-2")}>{formatChange(r.change, def)}</span>}
      </span>
      <span
        className={cx(
          "ml-auto justify-self-end rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap sm:ml-0",
          beyond ? "bg-ok-soft text-ok" : r.verdict === "no-baseline" || r.verdict === "no-variation-data" || r.verdict === "below-limit" ? "bg-warn-soft text-warn" : "bg-sunken text-ink-2",
        )}
      >
        {SHORT_VERDICT[r.verdict]}
      </span>
    </li>
  );
}

/** A habit that watches nothing yet: one tap on a suggested marker, or pick your own. */
function WatchSuggestions({ habit: h, tested, today, onPick }: { habit: Habit; tested: ReadonlySet<string>; today: string; onPick: () => void }) {
  const suggested = suggestMarkers(h.label, (id) => tested.has(id)).filter((id) => tested.has(id)).slice(0, 3);
  if (!h.entry) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
      <span className="text-ink-2">Watch what changes:</span>
      {suggested.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => void watchHabit(h.entry!, [id], defaultRetestDays([id]), today)}
          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong px-3 text-ink transition-colors hover:border-accent hover:bg-accent-soft"
        >
          <PlusIcon className="size-4 text-accent" />
          {shortName(BIOMARKER_MAP.get(id)!)}
        </button>
      ))}
      <button type="button" onClick={onPick} className="min-h-9 px-1 text-ink-2 underline underline-offset-2 hover:text-ink">
        {suggested.length ? "Other markers…" : "Pick markers…"}
      </button>
    </div>
  );
}

/** Choose (or change) the markers a habit watches. */
function WatchPicker({ habit: h, all, tested, today, onDone }: { habit: Habit; all: Measurement[]; tested: ReadonlySet<string>; today: string; onDone: () => void }) {
  const [markerIds, setMarkerIds] = useState<string[]>(h.watch?.markerIds ?? []);
  const [retest, setRetest] = useState(String(h.watch?.retestAfterDays ?? defaultRetestDays(markerIds)));
  const [error, setError] = useState<string | null>(null);
  if (!h.entry) return null;

  async function save() {
    if (markerIds.length === 0) return setError("Choose at least one marker.");
    await watchHabit(h.entry!, markerIds, Number(retest), today);
    onDone();
  }

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-3">
      <MarkerPicker label={h.label} start={h.start} all={all} tested={tested} markerIds={markerIds} onChange={(ids) => (setMarkerIds(ids), setError(null), setRetest((r) => String(Math.max(Number(r), defaultRetestDays(ids)))))} />
      {error && <p className={errorStyles}>{error}</p>}
      <ChoiceGroup<string> label="Re-test after" help="Markers need time to respond. HbA1c reflects about the last 3 months." value={retest} onChange={setRetest} options={RETEST_OPTIONS} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()}>Watch {markerIds.length > 0 ? markerIds.length : ""} {markerIds.length === 1 ? "marker" : "markers"}</Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Checkboxes for markers: suggested ones first, then those with results, then (on request) all. */
function MarkerPicker({
  label,
  start,
  all,
  tested,
  markerIds,
  onChange,
}: {
  label: string;
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
  const draft: Experiment = { id: "draft", change: label, category: "diet", markerIds, start, retestAfterDays: 56 };
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
        <button
          type="button"
          onClick={() => onChange(allShown ? markerIds.filter((id) => !ordered.some((d) => d.id === id)) : [...new Set([...markerIds, ...ordered.map((d) => d.id)])])}
          className="min-h-11 text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          {allShown ? "Clear all" : `Select all (${ordered.length})`}
        </button>
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

function HabitForm({
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
        await saveHabit({ ...r.entry, id: initial.id });
      } else {
        const id = await addProtocol(r.entry);
        if (watching) await watchHabit({ ...r.entry, id }, markerIds, Number(retest), today);
      }
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const sourcePicker = !initial && (
    <div role="tablist" aria-label="Start from" className="flex flex-wrap gap-1 self-start rounded-xl border border-line bg-sunken p-1">
      {(
        [
          ["own", "Write your own"],
          ["meal", "A meal"],
          ["protocol", "A protocol"],
        ] as const
      ).map(([v, text]) => (
        <button
          key={v}
          role="tab"
          type="button"
          aria-selected={from === v}
          onClick={() => setFrom(v)}
          className={cx("min-h-9 rounded-lg px-3 text-sm transition-colors duration-150", from === v ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
        >
          {text}
        </button>
      ))}
    </div>
  );

  if (!initial && from === "protocol") {
    return (
      <div className="flex flex-col gap-5">
        {sourcePicker}
        {plans.length === 0 ? (
          <p className="text-ink-2">
            No protocols yet. <a href={href({ name: "plans" })}>Write one in Protocols</a>: a set of supplements, foods or routines you follow.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className={labelStyles}>Protocol</span>
              <select value={plan?.id ?? ""} onChange={(e) => setPlanId(e.target.value)} className={inputStyles}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.items.length} {p.items.length === 1 ? "item" : "items"})
                  </option>
                ))}
              </select>
            </label>
            {plan?.active ? (
              <p className="text-ink-2">
                Running since {formatDate(plan.active.since)}. Its items are already habits below; <a href={href({ name: "plan", id: plan.id })}>open the protocol</a> to stop it.
              </p>
            ) : (
              <>
                <Field.Root className="flex flex-col gap-1.5 sm:max-w-xs">
                  <Field.Label className={labelStyles}>Start</Field.Label>
                  <Field.Control type="date" value={start} onValueChange={setStart} className={inputStyles} />
                  <Field.Description className={helpStyles}>Each item becomes a habit from this day. Watch markers on them afterwards.</Field.Description>
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

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {sourcePicker}
      {!initial && from === "meal" &&
        (meals.length === 0 ? (
          <p className="text-ink-2">
            No meals yet. <a href={href({ name: "meals" })}>Build one in Meals</a>, or write your own.
          </p>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className={labelStyles}>Meal</span>
            <select value={mealId} onChange={(e) => pickMeal(e.target.value)} className={inputStyles}>
              <option value="" disabled>
                Choose a meal
              </option>
              {meals.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      <Field.Root invalid={!!errors.label} className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>What do you take or change?</Field.Label>
        <Field.Control value={label} onValueChange={setLabel} placeholder="e.g. Vitamin D 2000 IU daily" autoComplete="off" maxLength={100} className={inputStyles} />
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
      {category === "medication" && <Notice>This is only for your own record. Don't start, stop or change a medicine without talking to your doctor.</Notice>}

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
