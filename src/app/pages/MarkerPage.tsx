import { useState } from "react";
import { personalRange } from "../../core/personalRange";
import { markerTerms } from "../../research/papers";
import { computeTrend, flagLatest, flagMeasurement, isCritical, isOutOfRange, recentAverage, resolveRange, sortByDate } from "../../core/trends";
import { formatValue, listUnits } from "../../core/units";
import type { BiomarkerDef, Citation, Measurement, Profile } from "../../core/types";
import { deleteMeasurement } from "../../db/db";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CriticalBanner } from "../components/CriticalBanner";
import { TrendChart } from "../components/TrendChart";
import { ResearchPanel } from "../components/ResearchPanel";
import { LeversPanel, leversHeading } from "../components/LeversPanel";
import { Fold, FoldGroup, Row, Rows } from "../components/disclosure";
import { UnitSelect } from "../components/UnitSelect";
import { Button, Card, FlagBadge, LinkButton, Notice } from "../components/ui";
import { displayUnitFor, formatDate, formatHours, showChange, showMeasurement, showRange, showValue } from "../format";
import { setDisplayUnit, useDisplayUnits, useMeasurementsFor, useMediaQuery, useProfile, useProtocols } from "../hooks";
import { activeOn } from "../../core/protocols";
import { todayIso } from "../../core/dates";
import type { ProtocolEntry } from "../../core/types";
import { BIOMARKER_MAP, fullName, nameInSentence } from "../knowledge";
import { href } from "../router";
import { WaistToHeightPanel } from "../components/dashboard/waistToHeight";
import { NotFound } from "./NotFound";

export function MarkerPage({ id }: { id: string }) {
  const def = BIOMARKER_MAP.get(id);
  const measurements = useMeasurementsFor(id);
  const profile = useProfile();
  const units = useDisplayUnits();
  const protocols = useProtocols() ?? [];
  // On wide screens the results list sits open beside the explanation.
  const wide = useMediaQuery("(min-width: 64rem)");

  if (!def) return <NotFound />;
  const unit = displayUnitFor(def, units[def.id]);
  const trend = measurements ? computeTrend(measurements) : undefined;
  const latestFlag = trend && measurements ? flagLatest(def, measurements, profile) : undefined;
  const levers = leversHeading(def, latestFlag, protocols, profile);
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
          <h1 className="font-serif text-3xl font-normal tracking-tight text-balance sm:text-4xl">{fullName(def)}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {listUnits(def).length > 1 && (
            <UnitSelect compact label="Show in" units={listUnits(def)} value={unit} onChange={(u) => void setDisplayUnit(def.id, u)} />
          )}
          <LinkButton href={href(def.category === "Body" ? { name: "add", kind: "body" } : { name: "add", marker: def.id })}>{def.category === "Body" ? "Add measurements" : "Add result"}</LinkButton>
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
              <div className="flex max-w-3xl flex-col gap-4 empty:hidden">
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
              </div>
              <TrendChart key={def.id} def={def} measurements={measurements} range={range} unit={unit} profile={profile} protocols={protocols} today={todayIso()} />
            </Card>
            {def.id === "waist" && <WaistToHeightPanel ms={measurements} profile={profile} />}
          </>
        )}

        {/* The explanation and research search start open; levers open by themselves when the result is out of range. */}
        <div className="mt-2 grid items-start gap-x-10 gap-y-0 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {measurements && measurements.length > 0 && (
          <FoldGroup className="max-lg:border-b-0 lg:col-start-2 lg:row-start-1">
            <Fold
              key={wide ? "wide" : "narrow"}
              defaultOpen={wide}
              title="All results"
              summary={`${measurements.length} ${measurements.length === 1 ? "result" : "results"}, newest first. Open one for its range, lab and what you were doing then.`}
            >
              <MeasurementList def={def} measurements={measurements} unit={unit} profile={profile} protocols={protocols} />
            </Fold>
          </FoldGroup>
        )}
        <FoldGroup className="lg:col-start-1 lg:row-start-1">
          <Fold defaultOpen title={`What is ${def.abbreviation ?? def.name}?`} summary={firstSentence(def.summary)}>
            <About def={def} unit={unit} profile={profile} range={range} />
          </Fold>
          {/* No suggestions next to a critical value: the urgent banner comes first. */}
          {!(latestFlag && isCritical(latestFlag)) && levers.count > 0 && (
            <Fold
              title={levers.title}
              summary={`${levers.count} ${levers.count === 1 ? "option" : "options"} from research, each graded${levers.focus ? `, for a ${levers.focus} result` : ""}`}
              defaultOpen={!!levers.focus}
            >
              <LeversPanel def={def} flag={latestFlag} protocols={protocols} />
            </Fold>
          )}
          <Fold defaultOpen title="Search research" summary={`Published studies about ${nameInSentence(def)}`}>
            <ResearchPanel
              bare
              name={def.name}
              terms={markerTerms(def.name, def.abbreviation)}
              question={`What does research say about what affects my ${nameInSentence(def)}?`}
              critical={!!latestFlag && isCritical(latestFlag)}
            />
          </Fold>
        </FoldGroup>
        </div>
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
    <div>
      <Rows>
        {rows.map((m) => {
          const flag = flagMeasurement(def, m, profile);
          const r = resolveRange(def, m, profile);
          const entered = m.originalUnit !== unit ? `${m.qualifier ?? ""}${formatValue(m.originalValue)} ${m.originalUnit}` : undefined;
          const during = activeOn(protocols, m.date);
          return (
            <Row
              key={m.id}
              title={
                <span>
                  <span className="tabular-nums">{showMeasurement(def, m, unit)}</span> {unit}
                  <span className="font-normal text-ink-2"> · {formatDate(m.date)}</span>
                </span>
              }
              aside={flag !== "unknown" ? <FlagBadge flag={flag} /> : undefined}
            >
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
              {during.length > 0 && (
                <p className="text-sm text-ink-2">
                  <span className="font-medium text-ink">At the time: </span>
                  {during.map((p) => p.label).join(", ")}
                </p>
              )}
              <div>
                <ConfirmDialog
                  trigger={<span>Delete this result</span>}
                  triggerVariant="quiet"
                  triggerClassName="text-sm -ml-3"
                  title="Delete this result?"
                  description={`${def.name} ${showMeasurement(def, m, unit)} ${unit} from ${formatDate(m.date)} will be removed from this device. This cannot be undone.`}
                  confirmLabel="Delete result"
                  onConfirm={() => deleteMeasurement(m.id)}
                />
              </div>
            </Row>
          );
        })}
      </Rows>
      {all.length > RESULTS_SHOWN && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${all.length} results`}
          </Button>
          {!showAll && <span className="text-sm text-ink-2">Showing the newest {RESULTS_SHOWN}.</span>}
        </div>
      )}
    </div>
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
    <div className="flex flex-col gap-4">
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
    </div>
  );
}

/** The first sentence of a text, for a fold's summary line. */
function firstSentence(text: string): string {
  const m = /^.*?[.!?](\s|$)/.exec(text);
  return (m ? m[0] : text).trim();
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
