import { summarizePhenoAge } from "../../core/phenoageDraws";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { computeTrend, flagMeasurement, groupByBiomarker, isCritical, isOutOfRange, type Flag } from "../../core/trends";
import type { BiomarkerDef, Measurement, Profile } from "../../core/types";
import { CriticalBanner, type CriticalItem } from "../components/CriticalBanner";
import { Card, FlagBadge, LinkButton, PageTitle, cx } from "../components/ui";
import { displayUnitFor, formatDate, formatYears, showChange, showMeasurement } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { SafetyNotices } from "../components/SafetyNotices";
import { DueExperiments } from "../components/DueExperiments";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { BIOMARKER_MAP, CATEGORY_ORDER, bloodOnly, fullName } from "../knowledge";
import { href, type ResultsFilter } from "../router";

export function Overview({ show }: { show?: ResultsFilter }) {
  const everything = useAllMeasurements();
  // Body measurements have their own page.
  const all = everything && bloodOnly(everything);
  const profile = useProfile();
  const units = useDisplayUnits();
  const protocols = useProtocols() ?? [];

  if (all === undefined) return <p className="text-ink-2">Loading…</p>;
  if (all.length === 0) return <EmptyState />;

  const rows: { def: BiomarkerDef; ms: Measurement[]; flag: Flag }[] = [];
  for (const [id, ms] of groupByBiomarker(all)) {
    const def = BIOMARKER_MAP.get(id);
    if (def) rows.push({ def, ms, flag: flagMeasurement(def, computeTrend(ms)!.latest, profile) });
  }

  const critical: CriticalItem[] = [];
  for (const row of rows) {
    if (isCritical(row.flag)) critical.push({ def: row.def, measurement: computeTrend(row.ms)!.latest, low: row.flag === "critical-low" });
  }

  // Filter on the latest result of each marker. Markers without a range count only under "All".
  const outCount = rows.filter((r) => isOutOfRange(r.flag)).length;
  const inCount = rows.filter((r) => r.flag === "normal").length;
  const shown = rows.filter((r) => (show === "out" ? isOutOfRange(r.flag) : show === "in" ? r.flag === "normal" : true));
  const byCategory = new Map<string, typeof rows>();
  for (const row of shown) {
    const list = byCategory.get(row.def.category) ?? [];
    list.push(row);
    byCategory.set(row.def.category, list);
  }

  const lastDate = all.reduce((d, m) => (m.date > d ? m.date : d), all[0]!.date);

  return (
    <>
      <CriticalBanner items={critical} />
      <div className="mb-5 empty:hidden">
        <SafetyNotices notes={safetyNotes(safetyLabels(protocols, profile))} />
      </div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">Blood tests</h1>
          <p className="mt-1 text-ink-2">
            {rows.length} {rows.length === 1 ? "marker" : "markers"}, {all.length} {all.length === 1 ? "result" : "results"}. Latest
            sample: {formatDate(lastDate)}.
          </p>
        </div>
        <LinkButton href={href({ name: "add" })}>Add result</LinkButton>
      </div>

      <DueExperiments all={all} />
      <BioAgeTeaser all={all} profile={profile} />

      <ResultsFilterBar show={show} counts={{ all: rows.length, out: outCount, in: inCount }} />

      {shown.length === 0 && (
        <p className="animate-fade rounded-xl border border-dashed border-line-strong bg-surface p-5 text-ink-2">
          {show === "out"
            ? "Everything is in range. The latest result of every marker is inside its reference range."
            : "No marker is in range right now. Pick All to see every marker."}
        </p>
      )}

      <div key={show ?? "all"} className="flex flex-col gap-6">
        {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => (
          <section key={category} aria-labelledby={`cat-${category}`}>
            <h2 id={`cat-${category}`} className="mb-2 font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">
              {category}
            </h2>
            <ul className="stagger grid grid-cols-1 gap-2 sm:grid-cols-2">
              {byCategory
                .get(category)!
                .sort((a, b) => a.def.name.localeCompare(b.def.name))
                .map(({ def, ms, flag }) => (
                  <li key={def.id}>
                    <MarkerRow def={def} ms={ms} flag={flag} unit={displayUnitFor(def, units[def.id])} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );

}

const FILTERS: { value: "all" | ResultsFilter; label: string; count: "all" | "out" | "in" }[] = [
  { value: "all", label: "All", count: "all" },
  { value: "out", label: "Out of range", count: "out" },
  { value: "in", label: "In range", count: "in" },
];

/** All / Out of range / In range. The choice lives in the page address, so it can be linked to. */
function ResultsFilterBar({ show, counts }: { show?: ResultsFilter; counts: { all: number; out: number; in: number } }) {
  const value = show ?? "all";
  return (
    <div className="mb-5">
      <ToggleGroup
        aria-label="Show markers"
        value={[value]}
        onValueChange={(v) => {
          const next = v[0] as "all" | ResultsFilter | undefined;
          if (!next || next === value) return; // pressing the chosen one again keeps it
          // Replace, so changing the filter doesn't fill the back button's history.
          location.replace(href(next === "all" ? { name: "overview" } : { name: "overview", show: next }));
        }}
        className="flex w-full gap-1 rounded-xl border border-line bg-sunken p-1 sm:inline-flex sm:w-auto"
      >
        {FILTERS.map((f) => (
          <Toggle
            key={f.value}
            value={f.value}
            className={cx(
              "flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1.5 text-sm sm:flex-none sm:gap-2 sm:px-3 font-medium whitespace-nowrap text-ink-2 transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-soft)]",
              "hover:text-ink data-pressed:bg-surface data-pressed:text-ink data-pressed:shadow-sm",
            )}
          >
            {f.label}
            <span
              className={cx(
                "min-w-5 rounded-full px-1 py-0.5 text-center sm:min-w-6 sm:px-1.5 font-mono text-xs tabular-nums",
                f.count === "out" && counts.out > 0 ? "bg-warn-soft text-warn" : "bg-line/60 text-ink-2",
              )}
            >
              {counts[f.count]}
            </span>
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

function MarkerRow({ def, ms, flag, unit }: { def: BiomarkerDef; ms: Measurement[]; flag: Flag; unit: string }) {
  const trend = computeTrend(ms)!;
  const change = trend.change !== undefined ? showChange(def, trend.change, unit) : undefined;
  return (
    <a
      href={href({ name: "marker", id: def.id })}
      className="flex min-h-20 items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 no-underline transition-[border-color,background-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-sm"
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{fullName(def)}</div>
        <div className="text-sm text-ink-2">
          {formatDate(trend.latest.date)}
          {change && ` · ${change === "no change" ? "no change" : `${change} ${unit}`} since previous`}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="text-lg font-semibold whitespace-nowrap text-ink tabular-nums">
          {showMeasurement(def, trend.latest, unit)} <span className="text-sm font-normal text-ink-2">{unit}</span>
        </div>
        <FlagBadge flag={flag} />
      </div>
    </a>
  );
}

/** Short link to the biological age page, only once at least one PhenoAge marker exists. */
function BioAgeTeaser({ all, profile }: { all: Measurement[]; profile: Profile }) {
  const summary = summarizePhenoAge(all, profile.birthMonth);
  const latest = summary.draws[summary.draws.length - 1];
  let text: string;
  if (latest?.status === "ok") text = `About ${formatYears(latest.phenoAge!)} years, from your test on ${formatDate(latest.date)}. An estimate, not a verdict.`;
  else if (latest?.status === "needs-birth-month") text = "You have all 9 markers. Add your month and year of birth to see the estimate.";
  else if (summary.latestPartial) text = `${9 - summary.latestPartial.missing.length} of 9 markers from your test on ${formatDate(summary.latestPartial.date)}. See what's missing.`;
  else return null;
  return (
    <a
      href={href({ name: "phenoage" })}
      className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-line bg-accent-soft p-4 no-underline hover:border-line-strong"
    >
      <span>
        <span className="block font-medium text-ink">Biological age (PhenoAge)</span>
        <span className="text-sm text-ink-2">{text}</span>
      </span>
      <span aria-hidden="true" className="text-xl text-accent">→</span>
    </a>
  );
}

function EmptyState() {
  return (
    <>
      <PageTitle sub="Keep all your blood test results in one place and see how they change over the years.">
        Welcome to Biomarker Tracker
      </PageTitle>
      <Card className="flex flex-col gap-4">
        <ol className="flex list-none flex-col gap-3 p-0">
          {[
            ["Add a result", "Copy a value from your lab report. Pick the marker, the unit and the date of the blood test."],
            ["See the trend", "Each marker gets a chart with its reference range, so you can see changes over time."],
            ["Keep a backup", "Your data is stored only in this browser. Download a backup file from time to time."],
          ].map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">
                {i + 1}
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-ink-2">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={href({ name: "add" })}>Add your first result</LinkButton>
          <LinkButton variant="secondary" href={href({ name: "import" })}>
            Import a PDF or photo
          </LinkButton>
          <LinkButton variant="secondary" href={href({ name: "data" })}>
            Restore a backup
          </LinkButton>
        </div>
      </Card>
    </>
  );
}
