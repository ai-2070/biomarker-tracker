import { useState, type FormEvent } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { todayIso } from "../../core/dates";
import {
  analyzeMarker,
  beforeResults,
  BASELINE_WINDOW_DAYS,
  DEFAULT_CVA_RATIO,
  experimentPhase,
  markersAwaitingRetest,
  retestDate,
  validateExperiment,
  type ExperimentField,
  type ExperimentPhase,
  type MarkerResult,
} from "../../core/experiments";
import { groupByBiomarker } from "../../core/trends";
import type { BiomarkerDef, Experiment, Measurement, ProtocolEntry } from "../../core/types";
import { createExperiment, deleteExperiment, endExperiment } from "../../db/db";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button, Card, CheckIcon, LinkButton, Notice, PageTitle, cx, errorStyles, helpStyles, inputStyles, labelStyles } from "../components/ui";
import { CATEGORY_LABEL, formatDate, formatPercent, showMeasurement, showValue } from "../format";
import { useAllMeasurements, useExperiments } from "../hooks";
import { BIOMARKERS, BIOMARKER_MAP, CATEGORY_ORDER, fullName, nameInSentence } from "../knowledge";
import { href, navigate } from "../router";
import { NotFound } from "./NotFound";

const PHASE_LABEL: Record<ExperimentPhase, string> = {
  "needs-baseline": "Needs a 'before' test",
  running: "Running",
  due: "Time to re-test",
  complete: "Results ready",
  ended: "Ended",
};

function analyze(e: Experiment, all: readonly Measurement[]): MarkerResult[] {
  return e.markerIds.flatMap((id) => {
    const def = BIOMARKER_MAP.get(id);
    return def ? [analyzeMarker(e, def, all)] : [];
  });
}

// List

export function ExperimentsPage() {
  const experiments = useExperiments();
  const all = useAllMeasurements();
  const today = todayIso();
  if (!experiments || !all) return <p className="text-ink-2">Loading…</p>;
  const sorted = [...experiments].sort((a, b) => (a.start < b.start ? 1 : -1));

  return (
    <>
      <PageTitle sub="Try one change, test before and after, and see whether the difference is bigger than your normal test-to-test variation.">
        Self-experiments
      </PageTitle>
      <div className="flex flex-col gap-5">
        <div>
          <LinkButton href={href({ name: "experiment-new" })}>Start an experiment</LinkButton>
        </div>
        {sorted.length === 0 ? (
          <Card className="flex flex-col gap-2 text-ink-2">
            <p>No experiments yet. How it works:</p>
            <ol className="list-decimal pl-5">
              <li>Get a blood test before you start (or use a recent one).</li>
              <li>Make one change, such as adding a food, and keep the rest of your routine the same.</li>
              <li>Re-test after a few weeks. The app compares the two results with the marker's normal variation.</li>
            </ol>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((e) => {
              const phase = experimentPhase(analyze(e, all), e, today);
              return (
                <li key={e.id}>
                  <a
                    href={href({ name: "experiment", id: e.id })}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 text-ink no-underline hover:bg-sunken"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{e.change}</span>
                      <span className="text-sm text-ink-2">
                        {e.markerIds.map((id) => BIOMARKER_MAP.get(id)?.name ?? id).join(", ")} · since {formatDate(e.start)}
                      </span>
                    </span>
                    <PhaseBadge phase={phase} />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function PhaseBadge({ phase }: { phase: ExperimentPhase }) {
  return (
    <span
      className={cx(
        "shrink-0 rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap",
        phase === "due" || phase === "needs-baseline" ? "bg-warn-soft text-warn" : phase === "complete" ? "bg-ok-soft text-ok" : "bg-sunken text-ink-2",
      )}
    >
      {PHASE_LABEL[phase]}
    </span>
  );
}

// New experiment

export function NewExperimentPage({ marker, change: initialChange }: { marker?: string; change?: string }) {
  const all = useAllMeasurements();
  const today = todayIso();
  const [change, setChange] = useState(initialChange?.slice(0, 80) ?? "");
  const [category, setCategory] = useState<ProtocolEntry["category"]>("diet");
  const [markerIds, setMarkerIds] = useState<string[]>(marker && BIOMARKER_MAP.has(marker) ? [marker] : []);
  const [start, setStart] = useState(today);
  const [weeks, setWeeks] = useState("8");
  const [showAll, setShowAll] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ExperimentField, string>>>({});
  const [saving, setSaving] = useState(false);

  if (!all) return <p className="text-ink-2">Loading…</p>;
  const tracked = new Set(groupByBiomarker(all).keys());
  const choices = BIOMARKERS.filter((d) => showAll || tracked.has(d.id) || markerIds.includes(d.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = validateExperiment({ change, category, markerIds, start, retestAfterDays: Number(weeks) * 7 }, new Set(BIOMARKER_MAP.keys()), today);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setSaving(true);
    try {
      const id = await createExperiment(r.experiment);
      navigate({ name: "experiment", id });
    } finally {
      setSaving(false);
    }
  }

  const draft: Experiment = { id: "draft", change, category, markerIds, start, retestAfterDays: Number(weeks) * 7 };

  return (
    <>
      <PageTitle sub="One change at a time works best. Keep the rest of your routine, and your lab, the same if you can.">Start an experiment</PageTitle>
      <Card>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <Field.Root invalid={!!errors.change} className="flex flex-col gap-1.5">
            <Field.Label className={labelStyles}>What will you change?</Field.Label>
            <Field.Control value={change} onValueChange={setChange} placeholder="e.g. 2 kiwis a day with breakfast" maxLength={100} autoComplete="off" className={inputStyles} />
            <Field.Description className={helpStyles}>This is also added to your log, so it shows on your charts.</Field.Description>
            <Field.Error match={!!errors.change} className={errorStyles}>
              {errors.change}
            </Field.Error>
          </Field.Root>

          <ChoiceGroup<ProtocolEntry["category"]>
            label="Type"
            value={category}
            onChange={setCategory}
            options={(Object.keys(CATEGORY_LABEL) as ProtocolEntry["category"][]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
          {category === "medication" && (
            <Notice>Don't start, stop or change a medicine for an experiment without talking to your doctor.</Notice>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className={labelStyles}>Markers to watch</legend>
            <p className={helpStyles}>
              {tracked.size > 0 && !showAll ? "Showing markers you have results for. " : ""}A "before" result needs to be from the{" "}
              {Math.round(BASELINE_WINDOW_DAYS / 30)} months before you start.
            </p>
            <ul className="flex flex-col">
              {CATEGORY_ORDER.flatMap((cat) => choices.filter((d) => d.category === cat)).map((d) => (
                <li key={d.id}>
                  <MarkerChoice
                    def={d}
                    checked={markerIds.includes(d.id)}
                    onChange={(on) => setMarkerIds((ids) => (on ? [...ids, d.id] : ids.filter((x) => x !== d.id)))}
                    baseline={markerIds.includes(d.id) ? beforeResults(draft, all.filter((m) => m.biomarkerId === d.id)).at(-1) : undefined}
                  />
                </li>
              ))}
            </ul>
            {!showAll && (
              <button type="button" onClick={() => setShowAll(true)} className="min-h-11 self-start text-sm text-ink-2 underline underline-offset-2">
                Show all markers
              </button>
            )}
            {errors.markerIds && <p className={errorStyles}>{errors.markerIds}</p>}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field.Root invalid={!!errors.start} className="flex flex-col gap-1.5">
              <Field.Label className={labelStyles}>Start date</Field.Label>
              <Field.Control type="date" value={start} onValueChange={setStart} className={inputStyles} />
              <Field.Error match={!!errors.start} className={errorStyles}>
                {errors.start}
              </Field.Error>
            </Field.Root>
          </div>

          <ChoiceGroup<string>
            label="Re-test after"
            help="Markers need time to respond. HbA1c reflects about the last 2–3 months, so give it at least 12 weeks."
            value={weeks}
            onChange={setWeeks}
            options={[
              { value: "4", label: "4 weeks" },
              { value: "8", label: "8 weeks" },
              { value: "12", label: "12 weeks" },
            ]}
          />

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              Start experiment
            </Button>
            <LinkButton variant="quiet" href={href({ name: "experiments" })}>
              Cancel
            </LinkButton>
          </div>
        </form>
      </Card>
    </>
  );
}

function MarkerChoice({ def, checked, onChange, baseline }: { def: BiomarkerDef; checked: boolean; onChange: (v: boolean) => void; baseline?: Measurement }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5">
      <Checkbox.Root
        checked={checked}
        onCheckedChange={onChange}
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent"
      >
        <Checkbox.Indicator className="flex data-unchecked:hidden">
          <CheckIcon />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span className="flex flex-col">
        <span>{fullName(def)}</span>
        {checked && (
          <span className={cx("text-sm", baseline ? "text-ok" : "text-warn")}>
            {baseline
              ? `Before: ${showMeasurement(def, baseline, def.canonicalUnit)} ${def.canonicalUnit} on ${formatDate(baseline.date)}`
              : "No recent result. Get tested before you start."}
            {!def.biologicalVariation && " Normal variation isn't known for this marker, so results can't be judged."}
          </span>
        )}
      </span>
    </label>
  );
}

// Detail

export function ExperimentPage({ id }: { id: string }) {
  const experiments = useExperiments();
  const all = useAllMeasurements();
  const today = todayIso();
  if (!experiments || !all) return <p className="text-ink-2">Loading…</p>;
  const e = experiments.find((x) => x.id === id);
  if (!e) return <NotFound />;

  const results = analyze(e, all);
  const phase = experimentPhase(results, e, today);
  const due = retestDate(e);

  return (
    <>
      <a href={href({ name: "experiments" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> All experiments
      </a>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-wide text-ink-2 uppercase">Self-experiment · {CATEGORY_LABEL[e.category]}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{e.change}</h1>
          <p className="mt-1 text-ink-2">
            Started {formatDate(e.start)} · re-test from {formatDate(due)}
            {e.end && ` · ended ${formatDate(e.end)}`}
          </p>
        </div>
        <PhaseBadge phase={phase} />
      </div>

      <div className="flex flex-col gap-5">
        {phase === "due" && (
          <Notice tone="warn" title="Time for the 'after' test">
            Get {markersAwaitingRetest(results).map((id) => BIOMARKER_MAP.get(id)?.name ?? id).join(", ")} tested, ideally at the same lab and time of day, and in the same state (for example fasting) as before.
            Then add the results; they'll appear here.
          </Notice>
        )}
        {phase === "running" && <Notice title={`Re-test from ${formatDate(due)}`}>Keep the change going until then.</Notice>}

        {results.map((r) => (
          <ResultCard key={r.biomarkerId} result={r} def={BIOMARKER_MAP.get(r.biomarkerId)!} experiment={e} />
        ))}

        <Card className="flex flex-col gap-2 text-ink-2">
          <h2 className="text-lg font-semibold text-ink">How to read this</h2>
          <p>
            Results vary from test to test even when nothing changes. The shaded band shows how big a change can be from that variation
            alone, 19 times out of 20. A result outside the band is probably a real change <em>in you</em>.
          </p>
          <p>
            It doesn't prove that your change caused it. Season, illness, other habits or a different lab can also move results. And what
            happened in you may not happen in someone else.
          </p>
          <p className="text-sm">
            Normal variation is taken from the EFLM Biological Variation Database (within-person variation, CVI). Labs rarely publish their
            own measurement error, so it is assumed to be {DEFAULT_CVA_RATIO * 100}% of that, a common quality target. Bands are calculated
            on a log scale, so rises and falls have different limits.
          </p>
        </Card>

        <div className="flex flex-wrap gap-2">
          {!e.end && (
            <Button variant="secondary" onClick={() => void endExperiment(e.id, today)}>
              End experiment today
            </Button>
          )}
          <ConfirmDialog
            trigger="Delete experiment"
            triggerVariant="quiet"
            title="Delete this experiment?"
            description="The experiment is removed. Your test results and the log entry are kept."
            confirmLabel="Delete experiment"
            onConfirm={async () => {
              await deleteExperiment(e.id);
              navigate({ name: "experiments" });
            }}
          />
        </div>
      </div>
    </>
  );
}

const VERDICT: Record<MarkerResult["verdict"], { title: string; tone: "ok" | "warn" | "info" }> = {
  rise: { title: "Rose more than normal variation", tone: "ok" },
  fall: { title: "Fell more than normal variation", tone: "ok" },
  "within-noise": { title: "Within normal variation", tone: "info" },
  "no-baseline": { title: "No 'before' result", tone: "warn" },
  waiting: { title: "Waiting for the 'after' test", tone: "info" },
  "no-variation-data": { title: "Can't be judged", tone: "warn" },
  "below-limit": { title: "Can't be judged", tone: "warn" },
};

function ResultCard({ result: r, def, experiment: e }: { result: MarkerResult; def: BiomarkerDef; experiment: Experiment }) {
  const unit = def.canonicalUnit;
  const v = VERDICT[r.verdict];
  const explain: Partial<Record<MarkerResult["verdict"], string>> = {
    "within-noise": "The difference is no bigger than what normally happens between two tests, so it can't be told apart from noise.",
    rise: "The difference is bigger than normal test-to-test variation, so it's probably a real change.",
    fall: "The difference is bigger than normal test-to-test variation, so it's probably a real change.",
    "no-baseline": `There's no result in the ${Math.round(BASELINE_WINDOW_DAYS / 30)} months before ${formatDate(e.start)}. Without a "before", the "after" can't be compared.`,
    waiting: `Add a result from ${formatDate(retestDate(e))} or later.`,
    "no-variation-data": "Published data on this marker's normal variation isn't available, so the change can't be judged against it.",
    "below-limit": 'One of the results was reported as "<" or ">" a limit, so the size of the change isn\'t known.',
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">
          <a href={href({ name: "marker", id: def.id })} className="text-ink underline-offset-2 hover:underline">
            {fullName(def)}
          </a>
        </h2>
        <span
          className={cx(
            "rounded-full px-2.5 py-0.5 text-sm font-medium",
            v.tone === "ok" ? "bg-ok-soft text-ok" : v.tone === "warn" ? "bg-warn-soft text-warn" : "bg-sunken text-ink-2",
          )}
        >
          {v.title}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Before" value={r.beforeValue} def={def} unit={unit} count={r.before.length} />
        <Stat label="After" value={r.afterValue} def={def} unit={unit} count={r.after.length} />
        {r.change !== undefined && (
          <div>
            <dt className="text-sm text-ink-2">Change</dt>
            <dd className="text-2xl font-semibold tabular-nums">{formatPercent(r.change)}</dd>
          </div>
        )}
      </dl>

      {r.band && r.change !== undefined && <NoiseGauge change={r.change} band={r.band} />}
      {r.band && (
        <p className="text-sm text-ink-2">
          Normal variation for these tests: {formatPercent(r.band.down)} to {formatPercent(r.band.up)}.
        </p>
      )}
      <p className="text-ink-2">{explain[r.verdict]}</p>
      {r.before.length + r.after.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-2">Results used</summary>
          <ul className="text-sm text-ink-2">
            {[...r.before.map((m) => ["Before", m] as const), ...r.after.map((m) => ["After", m] as const)].map(([when, m]) => (
              <li key={m.id}>
                {when}: {showMeasurement(def, m, unit)} {unit} on {formatDate(m.date)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {r.verdict === "no-baseline" || r.verdict === "waiting" ? (
        <div>
          <LinkButton variant="secondary" href={href({ name: "add", marker: def.id })}>
            Add a {nameInSentence(def)} result
          </LinkButton>
        </div>
      ) : null}
    </Card>
  );
}

function Stat({ label, value, def, unit, count }: { label: string; value?: number; def: BiomarkerDef; unit: string; count: number }) {
  return (
    <div>
      <dt className="text-sm text-ink-2">
        {label}
        {count > 1 ? ` (average of ${count})` : ""}
      </dt>
      <dd className="text-2xl font-semibold tabular-nums">
        {value === undefined ? "–" : showValue(def, value, unit)} <span className="text-sm font-normal text-ink-2">{value === undefined ? "" : unit}</span>
      </dd>
    </div>
  );
}

/** The change as a dot against the band of normal variation. */
function NoiseGauge({ change, band }: { change: number; band: { up: number; down: number } }) {
  const lo = Math.min(band.down, change) * 1.25;
  const hi = Math.max(band.up, change) * 1.25;
  const pos = (x: number) => `${((x - lo) / (hi - lo)) * 100}%`;
  const outside = change > band.up || change < band.down;
  return (
    <div aria-hidden="true" className="relative mt-1 mb-5 h-8">
      <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
      <div className="absolute top-1 bottom-1 rounded bg-chart-band/20" style={{ left: pos(band.down), width: `calc(${pos(band.up)} - ${pos(band.down)})` }} />
      <div className="absolute top-0 bottom-0 w-px bg-ink-2" style={{ left: pos(0) }} />
      <div
        className={cx("absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface", outside ? "bg-ink" : "bg-ink-2")}
        style={{ left: pos(change) }}
      />
      <span className="absolute top-full mt-0.5 -translate-x-1/2 text-xs text-ink-2" style={{ left: pos(0) }}>
        no change
      </span>
    </div>
  );
}
