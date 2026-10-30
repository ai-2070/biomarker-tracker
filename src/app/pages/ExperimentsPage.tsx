import { Checkbox } from "@base-ui/react/checkbox";
import { todayIso } from "../../core/dates";
import {
  analyzeMarker,
  BASELINE_WINDOW_DAYS,
  DEFAULT_CVA_RATIO,
  MIN_PERSONAL,
  experimentPhase,
  markersAwaitingRetest,
  retestDate,
  type ExperimentPhase,
  type MarkerResult,
} from "../../core/experiments";
import { pickedAfterResults } from "../../core/habits";
import type { BiomarkerDef, Experiment, Measurement } from "../../core/types";
import { deleteExperiment, endExperiment } from "../../db/db";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button, Card, CheckIcon, LinkButton, Notice, cx } from "../components/ui";
import { CATEGORY_LABEL, formatChange, formatDate, showMeasurement, showWatchValue, valueUnit } from "../format";
import { useAllMeasurements, useExperiments, useWatchMeasurements } from "../hooks";
import { BIOMARKER_MAP, fullName, nameInSentence, watchDef } from "../knowledge";
import { href, navigate } from "../router";
import { NotFound } from "./NotFound";
import { PHENOAGE_GAP_ID } from "../../core/phenoageWatch";

const PHASE_LABEL: Record<ExperimentPhase, string> = {
  "needs-baseline": "Needs a 'before' test",
  running: "Running",
  due: "Time to re-test",
  complete: "Results ready",
  ended: "Ended",
};

export function PhaseBadge({ phase }: { phase: ExperimentPhase }) {
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

function analyze(e: Experiment, all: readonly Measurement[]): MarkerResult[] {
  return e.markerIds.flatMap((id) => {
    const def = watchDef(id);
    return def ? [analyzeMarker(e, def, all)] : [];
  });
}

export function MarkerChoice({ def, checked, onChange, baseline }: { def: BiomarkerDef; checked: boolean; onChange: (v: boolean) => void; baseline?: Measurement }) {
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
              ? `Before: ${showMeasurement(def, baseline, def.canonicalUnit)} ${valueUnit(def, def.canonicalUnit)} on ${formatDate(baseline.date)}`
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
  // Results plus the PhenoAge gap at each complete blood test, so a watched gap can be compared.
  const all = useWatchMeasurements(useAllMeasurements());
  const today = todayIso();
  if (!experiments || !all) return <p className="text-ink-2">Loading…</p>;
  const e = experiments.find((x) => x.id === id);
  if (!e) return <NotFound />;

  const results = analyze(e, all);
  const phase = experimentPhase(results, e, today);
  const due = retestDate(e);

  return (
    <>
      <a href={href({ name: "habits" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Habits
      </a>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-normal tracking-tight text-balance sm:text-4xl">{e.change}</h1>
          <p className="mt-1 text-ink-2">
            {CATEGORY_LABEL[e.category]} · started {formatDate(e.start)} · re-test from {formatDate(due)}
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
        {pickedAfterResults(e) && (
          <Notice title="Picked after the results were in">
            You chose these markers when the "after" results already existed, so treat this as a hint, not a test. It's easy to pick the
            markers that happened to move. For a fair test, choose markers before you start a change.
          </Notice>
        )}

        {results.map((r) => (
          <ResultCard key={r.biomarkerId} result={r} def={watchDef(r.biomarkerId)!} experiment={e} />
        ))}

        <Card className="flex flex-col gap-2 text-ink-2">
          <h2 className="font-serif text-2xl font-normal text-ink">How to read this</h2>
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
          <p className="text-sm">
            Where no published data exists (body measurements and a few blood ratios), normal variation is estimated from your own results
            when there are at least {MIN_PERSONAL} before and {MIN_PERSONAL} after: how much they spread around their average. With so few
            results the limits are made wider to stay cautious.
          </p>
          {e.markerIds.includes(PHENOAGE_GAP_ID) && (
            <p className="text-sm">
              The PhenoAge gap is your PhenoAge minus your age at each blood test with all 9 markers, so the year you age between tests doesn't
              count against you. It is compared in years, and normal variation comes from how much your own gap changed from one blood test to
              the next before the start (at least {MIN_PERSONAL} tests), which a slow real trend barely affects. A lower gap is a good sign, but nobody has shown that lowering it adds years
              of life.
            </p>
          )}
        </Card>

        <div className="flex flex-wrap gap-2">
          {!e.end && e.start <= today && (
            <Button variant="secondary" onClick={() => void endExperiment(e.id, today)}>
              Stopped today
            </Button>
          )}
          <ConfirmDialog
            trigger="Stop watching"
            triggerVariant="quiet"
            title="Stop watching these markers?"
            description="The comparison is removed. The habit stays, and your test results are kept."
            confirmLabel="Stop watching"
            onConfirm={async () => {
              await deleteExperiment(e.id);
              navigate({ name: "habits" });
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
    "no-variation-data": `There's no published data on this marker's normal variation. With at least ${MIN_PERSONAL} results before and ${MIN_PERSONAL} after, it can be estimated from your own.`,
    "below-limit": 'One of the results was reported as "<" or ">" a limit, so the size of the change isn\'t known.',
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-serif text-2xl font-normal">
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
            <dd className="font-serif text-3xl font-normal tabular-nums">{formatChange(r.change, def)}</dd>
          </div>
        )}
      </dl>

      {r.band && r.change !== undefined && <NoiseGauge change={r.change} band={r.band} />}
      {r.band && (
        <p className="text-sm text-ink-2">
          Normal variation for these tests: {formatChange(r.band.down, def)} to {formatChange(r.band.up, def)}
          {def.changeScale === "difference"
            ? ", estimated from how much your own PhenoAge gap changed from one earlier blood test to the next."
            : r.bandFrom === "personal"
              ? `, estimated from your own ${r.before.length + r.after.length} results.`
              : "."}
        </p>
      )}
      <p className="text-ink-2">{explain[r.verdict]}</p>
      {r.before.length + r.after.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-2">Results used</summary>
          <ul className="text-sm text-ink-2">
            {[...r.before.map((m) => ["Before", m] as const), ...r.after.map((m) => ["After", m] as const)].map(([when, m]) => (
              <li key={m.id}>
                {when}: {showMeasurement(def, m, unit)} {valueUnit(def, unit)} on {formatDate(m.date)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {r.verdict === "no-baseline" || r.verdict === "waiting" ? (
        <div>
          {def.id === PHENOAGE_GAP_ID ? (
            // Worked out from blood tests: there's no gap to type in, only a blood test with all 9 markers.
            <LinkButton variant="secondary" href={href({ name: "phenoage" })}>
              What a PhenoAge blood test needs
            </LinkButton>
          ) : (
            <LinkButton variant="secondary" href={href({ name: "add", marker: def.id })}>
              Add a {nameInSentence(def)} result
            </LinkButton>
          )}
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
      <dd className="font-serif text-3xl font-normal tabular-nums">
        {value === undefined ? "–" : showWatchValue(def, value, unit)} <span className="text-sm font-normal text-ink-2">{value === undefined ? "" : valueUnit(def, unit)}</span>
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
