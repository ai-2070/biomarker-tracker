import { useState } from "react";
import { personalRange } from "../../core/personalRange";
import { computeTrend, flagLatest, flagMeasurement, isCritical, isOutOfRange, recentAverage, resolveRange, sortByDate } from "../../core/trends";
import { formatValue, listUnits } from "../../core/units";
import type { BiomarkerDef, Citation, Measurement, Profile } from "../../core/types";
import { deleteMeasurement } from "../../db/db";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CriticalBanner } from "../components/CriticalBanner";
import { TrendChart } from "../components/TrendChart";
import { ResearchPanel } from "../components/ResearchPanel";
import { LeversPanel } from "../components/LeversPanel";
import { UnitSelect } from "../components/UnitSelect";
import { Button, Card, FlagBadge, LinkButton, Notice } from "../components/ui";
import { displayUnitFor, formatDate, formatHours, showChange, showMeasurement, showRange, showValue } from "../format";
import { setDisplayUnit, useDisplayUnits, useMeasurementsFor, useProfile, useProtocols } from "../hooks";
import { activeOn } from "../../core/protocols";
import { todayIso } from "../../core/dates";
import type { ProtocolEntry } from "../../core/types";
import { BIOMARKER_MAP, fullName } from "../knowledge";
import { href } from "../router";
import { NotFound } from "./NotFound";

export function MarkerPage({ id }: { id: string }) {
  const def = BIOMARKER_MAP.get(id);
  const measurements = useMeasurementsFor(id);
  const profile = useProfile();
  const units = useDisplayUnits();
  const protocols = useProtocols() ?? [];

  if (!def) return <NotFound />;
  const unit = displayUnitFor(def, units[def.id]);
  const trend = measurements ? computeTrend(measurements) : undefined;
  const latestFlag = trend && measurements ? flagLatest(def, measurements, profile) : undefined;
  const usual = def.personalRange && measurements ? personalRange(measurements) : undefined;
  const range = usual
    ? { low: usual.low, high: usual.high, source: "personal" as const, from: usual.baseline.from }
    : trend
      ? resolveRange(def, trend.latest, profile)
      : resolveRange(def, {}, profile);
  // Sleep: the range is checked against the last week's average, not one night.
  const week = def.judgeAverageOfDays && measurements ? recentAverage(measurements, def.judgeAverageOfDays) : undefined;
  const fmt = (v: number) => (unit === "h" ? formatHours(v) : `${showValue(def, v, unit)} ${unit}`);

  return (
    <>
      {trend && latestFlag && isCritical(latestFlag) && (
        <CriticalBanner items={[{ def, measurement: trend.latest, low: latestFlag === "critical-low" }]} />
      )}

      <a href={href(def.category === "Body" ? { name: "body" } : { name: "overview" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> {def.category === "Body" ? "Body" : "All results"}
      </a>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">{def.category}</p>
          <h1 className="font-serif text-3xl font-normal tracking-tight text-balance sm:text-4xl">{fullName(def)}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {listUnits(def).length > 1 && (
            <UnitSelect compact label="Show in" units={listUnits(def)} value={unit} onChange={(u) => void setDisplayUnit(def.id, u)} />
          )}
          <LinkButton href={href(def.category === "Body" ? { name: "body", add: true } : { name: "add", marker: def.id })}>{def.category === "Body" ? "Add measurements" : "Add result"}</LinkButton>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {measurements === undefined ? (
          <p className="text-ink-2">Loading…</p>
        ) : !trend || !latestFlag ? (
          <Card>
            <p className="text-ink-2">No results for {def.name} yet.</p>
          </Card>
        ) : (
          <>
            <Card className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-ink-2">Latest result, {formatDate(trend.latest.date)}</p>
                  <p className="font-serif text-5xl font-normal tabular-nums">
                    {showMeasurement(def, trend.latest, unit)} <span className="text-lg font-normal text-ink-2">{unit}</span>
                  </p>
                </div>
                {usual?.recent && latestFlag === "unknown" ? (
                  <span className="rounded-full bg-sunken px-3 py-1 text-ink-2">
                    {usual.recent.position === "within" ? "Within your usual range" : usual.recent.position === "below" ? "Lower than usual" : "Higher than usual"}
                  </span>
                ) : (
                  latestFlag !== "unknown" && <FlagBadge flag={latestFlag} className="text-base" />
                )}
              </div>
              {def.judgeAverageOfDays && (
                <p className="text-ink-2">
                  {week
                    ? `Average of the last ${def.judgeAverageOfDays} days: ${fmt(week.value)} (${week.count} readings). The range is checked against this, not one night.`
                    : `The range is checked against the average of the last ${def.judgeAverageOfDays} days, which needs at least 3 readings.`}
                </p>
              )}
              {usual && (
                <p className="text-ink-2">
                  Your usual range: {showValue(def, usual.low, unit)}–{showValue(def, usual.high, unit)} {unit}, from your own {usual.baseline.count} readings between{" "}
                  {formatDate(usual.baseline.from)} and {formatDate(usual.baseline.to)}.
                  {usual.recent &&
                    ` Last week's average, ${fmt(usual.recent.value)}, is ${usual.recent.position === "within" ? "within it" : usual.recent.position === "below" ? "lower than usual" : "higher than usual"}.`}{" "}
                  It describes you, not what's healthy.
                </p>
              )}
              <TrendSummary def={def} trend={trend} unit={unit} />
              {isOutOfRange(latestFlag) && !isCritical(latestFlag) && (
                <Notice tone="warn" title="Outside the reference range">
                  {def.judgeAverageOfDays
                    ? "Your average over the last week is outside the range. A week like this now and then is common. If it keeps happening, or you feel unwell, it's worth discussing with your doctor."
                    : "One result outside the range is common and often harmless. It is still worth discussing with your doctor, especially if it is new, keeps changing, or you have symptoms."}
                </Notice>
              )}
              <TrendChart key={def.id} def={def} measurements={measurements} range={range} unit={unit} profile={profile} protocols={protocols} today={todayIso()} />
            </Card>

            <MeasurementList def={def} measurements={measurements} unit={unit} profile={profile} protocols={protocols} />
          </>
        )}

        <About def={def} unit={unit} profile={profile} range={range} />

        {/* No suggestions next to a critical value: the urgent banner comes first. */}
        {!(latestFlag && isCritical(latestFlag)) && <LeversPanel def={def} flag={latestFlag} protocols={protocols} />}

        <ResearchPanel def={def} critical={!!latestFlag && isCritical(latestFlag)} />
      </div>
    </>
  );
}

function TrendSummary({ def, trend, unit }: { def: BiomarkerDef; trend: NonNullable<ReturnType<typeof computeTrend>>; unit: string }) {
  if (trend.count < 2 || trend.change === undefined || !trend.previous) {
    return <p className="text-ink-2">Add more results over time to see how this marker changes.</p>;
  }
  const change = showChange(def, trend.change, unit);
  const pct = trend.percentChange !== undefined && change !== "no change" ? ` (${trend.percentChange > 0 ? "+" : "−"}${formatValue(Math.abs(trend.percentChange))} %)` : "";
  return (
    <div className="flex flex-col gap-1 text-ink-2">
      <p>
        <span className="font-medium text-ink">
          {change === "no change" ? "No change" : `${change} ${unit}${pct}`}
        </span>{" "}
        since the previous result on {formatDate(trend.previous.date)}.
      </p>
      {trend.count >= 3 && trend.ratePerYear !== undefined && (
        <p>
          Across all {trend.count} results, the average change is about{" "}
          <span className="font-medium text-ink">
            {showChange(def, trend.ratePerYear, unit) === "no change" ? "zero" : `${showChange(def, trend.ratePerYear, unit)} ${unit}`}
          </span>{" "}
          per year.
        </p>
      )}
      <p className="text-sm">
        {def.category === "Body"
          ? "Small differences between measurements are often normal day-to-day variation, not a real change."
          : "Small differences between tests are often normal day-to-day and lab-to-lab variation, not a real change."}
      </p>
    </div>
  );
}

function MeasurementList({
  def,
  measurements,
  unit,
  profile,
  protocols,
}: {
  def: BiomarkerDef;
  measurements: Measurement[];
  unit: string;
  profile: Profile;
  protocols: ProtocolEntry[];
}) {
  const all = sortByDate(measurements).reverse();
  const [showAll, setShowAll] = useState(false);
  // Newest first; long lists (daily values from a watch) start short.
  const rows = showAll ? all : all.slice(0, RESULTS_SHOWN);
  return (
    <Card>
      <h2 className="mb-3 flex items-baseline gap-2 font-serif text-2xl font-normal">
        All results <span className="font-sans text-base text-ink-2 tabular-nums">{all.length}</span>
      </h2>
      <ul id={`results-${def.id}`} className="flex flex-col divide-y divide-line">
        {rows.map((m) => {
          const flag = flagMeasurement(def, m, profile);
          const r = resolveRange(def, m, profile);
          const entered = m.originalUnit !== unit ? `${m.qualifier ?? ""}${formatValue(m.originalValue)} ${m.originalUnit}` : undefined;
          return (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="tabular-nums">{showMeasurement(def, m, unit)}</span> {unit}{" "}
                  <span className="font-normal text-ink-2">· {formatDate(m.date)}</span>
                </p>
                <p className="text-sm text-ink-2">
                  {[
                    entered && `Entered as ${entered}`,
                    r && `Range ${showRange(def, r, unit)}${r.source === "lab" ? " (lab)" : ""}`,
                    m.fasted === true ? "Fasting" : m.fasted === false ? "Not fasting" : undefined,
                    m.lab,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {m.note && <p className="text-sm text-ink-2 italic">{m.note}</p>}
                {activeOn(protocols, m.date).length > 0 && (
                  <p className="text-sm text-ink-2">
                    <span className="font-medium text-ink">At the time: </span>
                    {activeOn(protocols, m.date)
                      .map((p) => p.label)
                      .join(", ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* "No range" on every row says nothing: the About section explains it once. */}
                {flag !== "unknown" && <FlagBadge flag={flag} />}
                <ConfirmDialog
                  trigger={<span>Delete</span>}
                  triggerVariant="quiet"
                  triggerClassName="text-sm"
                  title="Delete this result?"
                  description={`${def.name} ${showMeasurement(def, m, unit)} ${unit} from ${formatDate(m.date)} will be removed from this device. This cannot be undone.`}
                  confirmLabel="Delete result"
                  onConfirm={() => deleteMeasurement(m.id)}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {all.length > RESULTS_SHOWN && (
        <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Button variant="secondary" aria-expanded={showAll} aria-controls={`results-${def.id}`} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${all.length} results`}
          </Button>
          {!showAll && <span className="text-sm text-ink-2">Showing the newest {RESULTS_SHOWN}.</span>}
        </div>
      )}
    </Card>
  );
}

/** How many results the list shows before "Show all". */
const RESULTS_SHOWN = 10;

function About({ def, unit, profile, range }: { def: BiomarkerDef; unit: string; profile: Profile; range: ReturnType<typeof resolveRange> }) {
  const defaultRange = resolveRange(def, {}, profile);
  const sexNote =
    def.defaultRanges?.some((r) => r.sex) && !profile.sex
      ? " This marker has different ranges for women and men. Set your sex on the Data page to use the matching one."
      : "";
  const ageNote =
    def.defaultRanges?.some((r) => r.ageFrom !== undefined || r.ageTo !== undefined) && !profile.birthMonth
      ? " The range changes with age. Add your month of birth on the Data page to use the matching one."
      : "";
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-serif text-2xl font-normal">What is {def.abbreviation ?? def.name}?</h2>
      <p>{def.summary}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Meaning title="If it's high" meaning={def.high.meaning} causes={def.high.commonCauses} />
        <Meaning title="If it's low" meaning={def.low.meaning} causes={def.low.commonCauses} />
      </div>

      <div className="rounded-lg bg-sunken p-3 text-ink-2">
        <p>
          <span className="font-medium text-ink">Reference range: </span>
          {range?.source === "lab"
            ? `your latest result uses your lab's range, ${showRange(def, range, unit)}.`
            : def.personalRange
              ? "there is no useful range for everyone. Once you have 2 weeks of readings, your own usual range is shown: the middle two-thirds of your readings over the previous 60 days."
              : defaultRange
                ? def.category === "Body"
                  ? `the usual adult range used here is ${showRange(def, defaultRange, unit)}.`
                  : `a typical adult range of ${showRange(def, defaultRange, unit)} is used when your lab's range isn't entered.`
                : "no typical range is available for this marker."}
          {sexNote}
          {ageNote}
        </p>
        {def.rangeNote && <p className="mt-2">{def.rangeNote}</p>}
        {def.category !== "Body" && <p className="mt-2 text-sm">Ranges differ between labs, countries, ages and during pregnancy. Your lab's range is the better guide.</p>}
      </div>

      <div>
        <h3 className="mb-1 font-semibold">Sources</h3>
        <ul className="flex flex-col gap-1 text-sm text-ink-2">
          {def.sources.map((s) => (
            <li key={s.pmid ?? s.doi}>
              <SourceLink source={s} />
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-ink-2">
        This explains what the marker means in general. It is not a diagnosis. Talk to your doctor about your own results.
      </p>
    </Card>
  );
}

function Meaning({ title, meaning, causes }: { title: string; meaning: string; causes: string[] }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-ink-2">{meaning}</p>
      {causes.length > 0 && (
        <>
          <p className="mt-2 text-sm font-medium">Common causes</p>
          <ul className="mt-1 list-disc pl-5 text-ink-2">
            {causes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const STUDY_LABEL: Record<Citation["studyType"], string> = {
  "meta-analysis": "Meta-analysis",
  rct: "Randomised trial",
  observational: "Observational study",
  animal: "Animal study",
  "in vitro": "Lab study",
  review: "Review",
  guideline: "Guideline",
};

function SourceLink({ source: s }: { source: Citation }) {
  const url = s.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` : `https://doi.org/${s.doi}`;
  return (
    <>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
        {s.title}
      </a>{" "}
      ({s.year}, {STUDY_LABEL[s.studyType]})
    </>
  );
}
