import { todayIso } from "@bt/shared/core/dates";
import { type MarkerResult, retestDate } from "@bt/shared/core/experiments";
import { chanceNote, defaultRetestDays, type Habit, habitsOf, pickedAfterResults, suggestMarkers, summarizeWatch } from "@bt/shared/core/habits";
import { PHENOAGE_GAP_ID } from "@bt/shared/core/phenoageWatch";
import type { Plan } from "@bt/shared/core/plans";
import { durationDays, type ProtocolCategory, safetyLabels, safetyNotes } from "@bt/shared/core/protocols";
import { groupByBiomarker } from "@bt/shared/core/trends";
import type { Experiment, Measurement } from "@bt/shared/core/types";
import { useState } from "react";
import { deleteExperiment, deleteHabit, saveHabit, watchHabit } from "../../db/db";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { More } from "../components/disclosure";
import { HabitForm, MarkerPicker, RETEST_OPTIONS } from "../components/habits/HabitForm";
import { PlusIcon } from "../components/icons";
import { TIME_LABEL, whenExtras, whenOf } from "../components/PlanWhen";
import { SafetyNotices } from "../components/SafetyNotices";
import { Button, Card, cardStyles, cx, errorStyles, eyebrowSmallStyles, eyebrowStyles, PageTitle } from "../components/ui";
import { CATEGORY_LABEL, formatChange, formatDate, formatDuration, showWatchValue, valueUnit } from "../format";
import { useAllMeasurements, useExperiments, usePlans, useProfile, useProtocols, useWatchMeasurements } from "../hooks";
import { BIOMARKER_MAP, shortName, WATCH_DEFS, watchDef } from "../knowledge";
import { href } from "../router";
import { PhaseBadge } from "./ExperimentsPage";

/**
 * Habits: supplements, food, medicines and routines with their dates. Any habit can watch markers;
 * then it shows what changed, compared with normal test-to-test variation (the old self-experiments).
 */
export function HabitsPage({ add, marker, meal, type }: { add?: string; marker?: string; meal?: string; type?: ProtocolCategory }) {
  const protocols = useProtocols();
  const experiments = useExperiments();
  const plans = usePlans();
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
        <SafetyNotices
          notes={safetyNotes(
            safetyLabels(
              habits.flatMap((h) => (h.entry && !h.end ? [h.entry] : [])),
              profile,
            ),
          )}
        />

        {adding ? (
          <Card>
            <h2 className="mb-4 font-serif text-2xl font-normal">New habit</h2>
            <HabitForm
              today={today}
              all={all}
              tested={tested}
              prefillLabel={add}
              prefillMarker={marker}
              prefillMeal={meal}
              prefillCategory={type}
              onDone={() => setAdding(false)}
            />
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
              Habits show on your charts and timeline. Pick markers to watch, and the app compares results from before and after you started with that marker's
              normal variation.
            </p>
          </Card>
        )}

        {groups.map((g) => (
          <section key={g.title} aria-labelledby={`habits-${g.title}`}>
            <h2 id={`habits-${g.title}`} className={cx("mb-2", eyebrowStyles)}>
              {g.title}
            </h2>
            <ul className="stagger flex flex-col gap-3">
              {g.list.map((h) => (
                <li key={h.id}>
                  <HabitCard habit={h} plans={plans} all={all} tested={tested} today={today} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="text-sm text-ink-2">
          A marker changing after you started something doesn't prove that it caused the change. Other things change at the same time, and results vary from
          test to test. What happened in you may not happen in someone else.
        </p>
      </div>
    </>
  );
}

// ---- A habit ------------------------------------------------------------------------------------

function HabitCard({
  habit: h,
  plans,
  all,
  tested,
  today,
}: {
  habit: Habit;
  plans: readonly Plan[] | undefined;
  all: Measurement[];
  tested: ReadonlySet<string>;
  today: string;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "watch">("view");
  const sourcePlan = h.entry?.plan ? plans?.find((p) => p.id === h.entry!.plan!.id) : undefined;
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
    <div className={cx("flex flex-col gap-3 p-4", cardStyles)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {h.watch ? (
            <a
              href={href({ name: "experiment", id: h.watch.id })}
              className="font-medium break-words text-ink underline-offset-2 hover:text-accent hover:underline"
            >
              {h.label}
            </a>
          ) : (
            <p className="font-medium break-words">{h.label}</p>
          )}
          <p className="text-sm text-ink-2">
            {h.entry?.plan ? "Protocol" : CATEGORY_LABEL[h.category]} ·{" "}
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

      {h.entry?.plan && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <More summary={<>Included items ({h.entry.plan.items.length})</>} tone="small">
            <p className="mb-2 text-sm text-ink-2">As recorded when this protocol started; later protocol edits don't change these items.</p>
            <ul className="flex flex-col divide-y divide-line">
              {h.entry.plan.items.map((item) => (
                <li key={item.id} className="min-w-0 py-2 break-words">
                  <p className="font-medium">
                    {item.label}
                    {item.amount && <span className="font-normal text-ink-2"> · {item.amount}</span>}
                  </p>
                  <p className="text-sm text-ink-2">
                    {[CATEGORY_LABEL[item.category], TIME_LABEL[whenOf(item).when], whenExtras(item), item.note].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </More>
          {sourcePlan && (
            <a href={href({ name: "plan", id: sourcePlan.id })} className="min-h-11 self-start content-center text-sm text-ink underline underline-offset-2">
              Open source protocol
            </a>
          )}
          <p className="text-sm text-ink-2">Watched markers compare the whole routine, not which item caused a change.</p>
        </div>
      )}
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
        <p className={eyebrowSmallStyles}>What changed</p>
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
      <a
        href={def.id === PHENOAGE_GAP_ID ? href({ name: "phenoage" }) : href({ name: "marker", id: def.id })}
        className="min-w-0 font-medium text-ink no-underline hover:underline sm:truncate"
      >
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
          beyond
            ? "bg-ok-soft text-ok"
            : r.verdict === "no-baseline" || r.verdict === "no-variation-data" || r.verdict === "below-limit"
              ? "bg-warn-soft text-warn"
              : "bg-sunken text-ink-2",
        )}
      >
        {SHORT_VERDICT[r.verdict]}
      </span>
    </li>
  );
}

/** A habit that watches nothing yet: one tap on a suggested marker, or pick your own. */
function WatchSuggestions({ habit: h, tested, today, onPick }: { habit: Habit; tested: ReadonlySet<string>; today: string; onPick: () => void }) {
  const suggested = suggestMarkers(h.entry ?? h.label, (id) => tested.has(id))
    .filter((id) => tested.has(id))
    .slice(0, 3);
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
function WatchPicker({
  habit: h,
  all,
  tested,
  today,
  onDone,
}: {
  habit: Habit;
  all: Measurement[];
  tested: ReadonlySet<string>;
  today: string;
  onDone: () => void;
}) {
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
      <MarkerPicker
        label={h.entry ?? h.label}
        start={h.start}
        all={all}
        tested={tested}
        markerIds={markerIds}
        onChange={(ids) => (setMarkerIds(ids), setError(null), setRetest((r) => String(Math.max(Number(r), defaultRetestDays(ids)))))}
      />
      {error && <p className={errorStyles}>{error}</p>}
      <ChoiceGroup<string>
        label="Re-test after"
        help="Markers need time to respond. HbA1c reflects about the last 3 months."
        value={retest}
        onChange={setRetest}
        options={RETEST_OPTIONS}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()}>
          Watch {markerIds.length > 0 ? markerIds.length : ""} {markerIds.length === 1 ? "marker" : "markers"}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
