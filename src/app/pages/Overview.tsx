import { summarizePhenoAge } from "../../core/phenoageDraws";
import { computeTrend, flagMeasurement, groupByBiomarker, isCritical } from "../../core/trends";
import type { BiomarkerDef, Measurement, Profile } from "../../core/types";
import { CriticalBanner, type CriticalItem } from "../components/CriticalBanner";
import { Card, FlagBadge, LinkButton, PageTitle } from "../components/ui";
import { displayUnitFor, formatDate, formatYears, showChange, showMeasurement } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { SafetyNotices } from "../components/SafetyNotices";
import { DueExperiments } from "../components/DueExperiments";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { BIOMARKER_MAP, CATEGORY_ORDER, fullName } from "../knowledge";
import { href } from "../router";

export function Overview() {
  const all = useAllMeasurements();
  const profile = useProfile();
  const units = useDisplayUnits();
  const protocols = useProtocols() ?? [];

  if (all === undefined) return <p className="text-ink-2">Loading…</p>;
  if (all.length === 0) return <EmptyState />;

  const rows: { def: BiomarkerDef; ms: Measurement[] }[] = [];
  for (const [id, ms] of groupByBiomarker(all)) {
    const def = BIOMARKER_MAP.get(id);
    if (def) rows.push({ def, ms });
  }

  const critical: CriticalItem[] = [];
  const byCategory = new Map<string, typeof rows>();
  for (const row of rows) {
    const trend = computeTrend(row.ms)!;
    const flag = flagMeasurement(row.def, trend.latest, profile);
    if (isCritical(flag)) critical.push({ def: row.def, measurement: trend.latest, low: flag === "critical-low" });
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

      <div className="flex flex-col gap-6">
        {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => (
          <section key={category} aria-labelledby={`cat-${category}`}>
            <h2 id={`cat-${category}`} className="mb-2 font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">
              {category}
            </h2>
            <ul className="stagger grid grid-cols-1 gap-2 sm:grid-cols-2">
              {byCategory
                .get(category)!
                .sort((a, b) => a.def.name.localeCompare(b.def.name))
                .map(({ def, ms }) => (
                  <li key={def.id}>
                    <MarkerRow def={def} ms={ms} unit={displayUnitFor(def, units[def.id])} profile={profile} />
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );

}

function MarkerRow({ def, ms, unit, profile }: { def: BiomarkerDef; ms: Measurement[]; unit: string; profile: Profile }) {
  const trend = computeTrend(ms)!;
  const flag = flagMeasurement(def, trend.latest, profile);
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
