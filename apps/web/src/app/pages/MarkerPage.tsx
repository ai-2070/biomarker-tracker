import { Fragment, useMemo, useState } from "react";
import { personalRange } from "@bt/shared/core/personalRange";
import { markerTerms } from "@bt/shared/research/papers";
import { computeTrend, flagLatest, isCritical, isOutOfRange, recentAverage, recentTotal, resolveRange } from "@bt/shared/core/trends";
import { formatValue, listUnits } from "@bt/shared/core/units";
import type { BiomarkerDef, Citation, Profile } from "@bt/shared/core/types";
import { SavedResults } from "../components/SavedResults";
import { CriticalBanner } from "../components/CriticalBanner";
import { TrendChart } from "../components/TrendChart";
import { ResearchPanel } from "../components/ResearchPanel";
import { LeversPanel, leversHeading } from "../components/LeversPanel";
import { Fold, FoldGroup } from "../components/disclosure";
import { UnitSelect } from "../components/UnitSelect";
import { Card, FlagBadge, LinkButton, Notice } from "../components/ui";
import { displayUnitFor, formatDate, showChange, showMeasurement, showRange, showValue, valueUnit } from "../format";
import { setDisplayUnit, useDisplayUnits, useMeasurementsFor, useMediaQuery, useProfile, useProtocols } from "../hooks";
import { todayIso } from "@bt/shared/core/dates";
import { BIOMARKER_MAP, FITNESS_MAP, LIFESTYLE, WHOLE_FOODS, fullName, nameInSentence } from "../knowledge";
import { href } from "../router";
import { FitnessPanel } from "../components/dashboard/fitness";
import { WaistToHeightPanel } from "../components/dashboard/waistToHeight";
import { DunedinScores } from "../components/dashboard/agePace";
import { NotFound } from "./NotFound";
import type { SharedTimeView } from "../components/timeControls";
import { BodyFatComparison, BodyFatMass, BodyFatReferenceBadge } from "../components/BodyFatComparison";
import { PaperLink } from "../components/PaperLink";
import { SleepTimingSection } from "../components/SleepTimingPanel";

export function MarkerPage({ id, section }: { id: string; section?: string }) {
  return id === "bp_systolic" || id === "bp_diastolic"
    ? <BloodPressurePage />
    : <SingleMarkerPage id={id} section={section} />;
}

function SingleMarkerPage({ id, section }: { id: string; section?: string }) {
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
  // Active minutes: the advice is per week, so the last 7 days' total is checked.
  const total = def.judgeSumOfDays && measurements ? recentTotal(measurements, def.judgeSumOfDays) : undefined;
  const fmt = (v: number) => `${showValue(def, v, unit)} ${valueUnit(def, unit)}`.trim();

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
          {valueUnit(def, unit) && listUnits(def).length > 1 && (
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
                    {showMeasurement(def, trend.latest, unit)} <span className="text-lg font-normal text-ink-2">{valueUnit(def, unit)}</span>
                  </p>
                  {def.id === "body_fat" && <BodyFatMass measurement={trend.latest} />}
                </div>
                {def.id === "body_fat" && def.comparisonOnly && range?.source !== "lab" && !isCritical(latestFlag) ? (
                  <BodyFatReferenceBadge measurement={trend.latest} profile={profile} />
                ) : usual?.recent && latestFlag === "unknown" ? (
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
              {def.judgeSumOfDays && (
                <p className="text-ink-2">
                  {total
                    ? `Total of the last ${def.judgeSumOfDays} days: ${Math.round(total.value)} ${unit} (${total.days} days with readings). The advice is checked against this, not one day.`
                    : `The advice is checked against the total of the last ${def.judgeSumOfDays} days, which needs readings on at least 4 of them.`}
                </p>
              )}
              {usual && (
                <p className="text-ink-2">
                  Your usual range: {showValue(def, usual.low, unit)}–{showValue(def, usual.high, unit)} {valueUnit(def, unit)}, from your own {usual.baseline.count} readings between{" "}
                  {formatDate(usual.baseline.from)} and {formatDate(usual.baseline.to)}.
                  {usual.recent &&
                    ` Last week's average, ${fmt(usual.recent.value)}, is ${usual.recent.position === "within" ? "within it" : usual.recent.position === "below" ? "lower than usual" : "higher than usual"}.`}{" "}
                  It describes you, not what's healthy.
                </p>
              )}
              <TrendSummary def={def} trend={trend} unit={unit} />
              {isOutOfRange(latestFlag) && !isCritical(latestFlag) && (
                <Notice tone="warn" title="Outside the reference range">
                  {def.judgeSumOfDays
                    ? "Your total for the last week is below the WHO advice. Any extra activity helps. If illness, pain or breathlessness makes moving hard, it's worth talking to your doctor."
                    : def.judgeAverageOfDays
                    ? "Your average over the last week is outside the range. A week like this now and then is common. If it keeps happening, or you feel unwell, it's worth discussing with your doctor."
                    : "One result outside the range is common and often harmless. It is still worth discussing with your doctor, especially if it is new, keeps changing, or you have symptoms."}
                </Notice>
              )}
              </div>
              <TrendChart key={def.id} def={def} measurements={measurements} range={range} unit={unit} profile={profile} protocols={protocols} today={todayIso()} />
            </Card>
            {def.id === "waist" && <WaistToHeightPanel ms={measurements} profile={profile} scrollTo={section === "waist-to-height"} />}
            {def.id === "dunedinpace" && <DunedinScores results={measurements} />}
            {def.id !== "sleep_duration" && <LifestyleLinks markerId={def.id} />}
          </>
        )}
        {measurements !== undefined && def.id === "body_fat" && <BodyFatComparison measurements={measurements} profile={profile} today={todayIso()} />}
        {def.id === "sleep_duration" && <SleepTimingSection />}
        {/* Fitness tests: where you stand for your age, how to do the test (shown before any result too). */}
        {measurements !== undefined && FITNESS_MAP.has(def.id) && <FitnessPanel id={def.id} ms={measurements} profile={profile} scrollTo={section === "for-your-age"} />}

        {/* The explanation and research search start open; levers open by themselves when the result is out of range. */}
        <div className="mt-2 grid items-start gap-x-10 gap-y-0 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {measurements && measurements.length > 0 && (
          <FoldGroup className="max-lg:border-b-0 lg:col-start-2 lg:row-start-1">
            <Fold
              key={wide ? "wide" : "narrow"}
              defaultOpen={wide}
              title="All results"
              summary={`${measurements.length} ${measurements.length === 1 ? "result" : "results"}, newest first. Edit a reading or select several to delete.`}
            >
              <SavedResults key={def.id} measurements={measurements} filterable={false} />
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

const PRESSURE_READINGS = [
  { id: "bp_systolic", label: "Systolic — top number" },
  { id: "bp_diastolic", label: "Diastolic — bottom number" },
] as const;

/** Both existing marker URLs show the pair without merging measurements or ranges. */
function BloodPressurePage() {
  const systolic = useMeasurementsFor("bp_systolic");
  const diastolic = useMeasurementsFor("bp_diastolic");
  const profile = useProfile();
  const units = useDisplayUnits();
  const protocols = useProtocols() ?? [];
  const wide = useMediaQuery("(min-width: 64rem)");
  const [time, setTime] = useState<Pick<SharedTimeView, "view" | "preset">>({ view: null, preset: "All" });
  const readings = useMemo(() => PRESSURE_READINGS.map((reading, index) => {
    const def = BIOMARKER_MAP.get(reading.id)!;
    const measurements = index === 0 ? systolic : diastolic;
    const trend = measurements ? computeTrend(measurements) : undefined;
    const flag = trend && measurements ? flagLatest(def, measurements, profile) : undefined;
    const range = resolveRange(def, trend?.latest ?? {}, profile);
    return { ...reading, def, measurements, trend, flag, range, levers: leversHeading(def, flag, protocols, profile) };
  }), [systolic, diastolic, profile, protocols]);
  const extent = useMemo(() => {
    let first = "";
    let last = "";
    for (const { trend } of readings) {
      if (!trend) continue;
      if (!first || trend.firstDate < first) first = trend.firstDate;
      if (!last || trend.lastDate > last) last = trend.lastDate;
    }
    return first ? { first, last } : undefined;
  }, [readings]);
  const allResults = useMemo(() => [...(systolic ?? []), ...(diastolic ?? [])], [systolic, diastolic]);
  const critical = readings.flatMap(({ def, trend, flag }) => trend && flag && isCritical(flag)
    ? [{ def, measurement: trend.latest, low: flag === "critical-low" }]
    : []);
  const linkedTime: SharedTimeView | undefined = extent
    ? { extent, ...time, onChange: (view, preset) => setTime({ view, preset }) }
    : undefined;

  return (
    <>
      <CriticalBanner items={critical} />
      <a href={href({ name: "body" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Body
      </a>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-3xl flex-col gap-2">
          <h1 className="font-serif text-3xl font-normal tracking-tight text-balance sm:text-4xl">Blood pressure</h1>
          <p className="text-ink-2">Systolic is the top number; diastolic is the bottom. Both charts use the same dates, with a separate reference range for each number.</p>
        </div>
        <LinkButton href={href({ name: "add", kind: "body" })}>Add measurements</LinkButton>
      </div>
      <div className="flex flex-col gap-8">
        {readings.map(({ id, label, def, measurements, trend, flag, range }) => {
          const unit = displayUnitFor(def, units[id]);
          return <section key={id} aria-labelledby={`${id}-heading`} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id={`${id}-heading`} className="font-serif text-2xl font-normal">{label}</h2>
              {listUnits(def).length > 1 && <UnitSelect compact label={`Show ${id === "bp_systolic" ? "systolic" : "diastolic"} in`} units={listUnits(def)} value={unit} onChange={(u) => void setDisplayUnit(id, u)} />}
            </div>
            <Card className="flex min-w-0 flex-col gap-4">
              {measurements === undefined ? <p className="text-ink-2">Loading…</p> : !trend || !flag ? (
                <p className="text-ink-2">No results for {def.name} yet. The other number is shown separately when available.</p>
              ) : <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-ink-2">Latest result, {formatDate(trend.latest.date)}</p>
                    <p className="font-serif text-5xl font-normal tabular-nums">{showMeasurement(def, trend.latest, unit)} <span className="text-lg text-ink-2">{valueUnit(def, unit)}</span></p>
                  </div>
                  {flag !== "unknown" && <FlagBadge flag={flag} className="text-base" />}
                </div>
                <div className="flex max-w-3xl flex-col gap-3">
                  <TrendSummary def={def} trend={trend} unit={unit} />
                  {isOutOfRange(flag) && !isCritical(flag) && <Notice tone="warn" title="Outside the reference range">One reading outside the range is not a diagnosis. Discuss repeated high readings, a new change or symptoms with your doctor.</Notice>}
                </div>
                <TrendChart def={def} measurements={measurements} range={range} unit={unit} profile={profile} protocols={protocols} today={todayIso()} linkedTime={linkedTime} />
              </>}
            </Card>
          </section>;
        })}
        <div className="grid grid-cols-1 items-start gap-x-10 gap-y-0 lg:grid-cols-[minmax(0,1fr)_24rem]">
          {allResults.length > 0 && <FoldGroup className="min-w-0 max-lg:border-b-0 lg:col-start-2 lg:row-start-1">
            <Fold key={wide ? "wide" : "narrow"} defaultOpen={wide} title="All blood pressure results" summary={`${allResults.length} readings, with the top and bottom numbers named separately. Edit a reading or select several to delete.`}>
              <SavedResults measurements={allResults} filterable={false} showMarker />
            </Fold>
          </FoldGroup>}
          <FoldGroup className="min-w-0 lg:col-start-1 lg:row-start-1">
            {readings.map(({ id, def, range, flag, levers }) => <Fragment key={id}>
              <Fold defaultOpen title={`What is ${def.name.toLowerCase()}?`} summary={firstSentence(def.summary)}>
                <About def={def} unit={displayUnitFor(def, units[id])} profile={profile} range={range} />
                <div className="mt-4"><LifestyleLinks markerId={id} /></div>
              </Fold>
              {critical.length === 0 && levers.count > 0 && <Fold title={`${levers.title} — ${id === "bp_systolic" ? "systolic" : "diastolic"}`} summary={`${levers.count} options from research, each graded`} defaultOpen={!!levers.focus}>
                <LeversPanel def={def} flag={flag} protocols={protocols} />
              </Fold>}
            </Fragment>)}
            <Fold defaultOpen title="Search research" summary="Published studies about blood pressure">
              <ResearchPanel bare name="Blood pressure" terms={markerTerms("blood pressure")} question="What does research say about what affects blood pressure?" critical={critical.length > 0} />
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
          {change === "no change" ? "No change" : `${change} ${valueUnit(def, unit)}${pct}`}
        </span>{" "}
        since the previous result on {formatDate(trend.previous.date)}.
      </p>
      {trend.count >= 3 && trend.ratePerYear !== undefined && (
        <p>
          Across all {trend.count} results, the average change is about{" "}
          <span className="font-medium text-ink">
            {showChange(def, trend.ratePerYear, unit) === "no change" ? "zero" : `${showChange(def, trend.ratePerYear, unit)} ${valueUnit(def, unit)}`}
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
        <Meaning title={def.comparisonOnly ? "Higher values" : "If it's high"} meaning={def.high.meaning} causes={def.high.commonCauses} />
        <Meaning title={def.comparisonOnly ? "Very low values" : "If it's low"} meaning={def.low.meaning} causes={def.low.commonCauses} />
      </div>

      <div className="rounded-lg bg-sunken p-3 text-ink-2">
        <p>
          <span className="font-medium text-ink">{def.comparisonOnly && range?.source !== "lab" ? "Population comparison: " : "Reference range: "}</span>
          {range?.source === "lab"
            ? `your latest result uses your lab's range, ${showRange(def, range, unit)}.`
            : def.personalRange
              ? "there is no useful range for everyone. Once you have 2 weeks of readings, your own usual range is shown: the middle two-thirds of your readings over the previous 60 days."
              : defaultRange?.comparisonOnly
                ? `${showRange(def, defaultRange, unit)} is shown for comparison only, not as clinical low/high limits.`
              : defaultRange
                ? def.category === "Body"
                  ? `the usual adult range used here is ${showRange(def, defaultRange, unit)}${def.judgeSumOfDays ? ` over ${def.judgeSumOfDays} days` : ""}.`
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
      <PaperLink href={url} source={{ title: s.title, year: s.year, kind: STUDY_LABEL[s.studyType], n: s.n }} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
        {s.title}
      </PaperLink>{" "}
      ({s.year}, {STUDY_LABEL[s.studyType]})
    </>
  );
}

/** Lifestyle research that mentions this marker (Sleep for sleep, Walking and Sauna for blood pressure…). */
function LifestyleLinks({ markerId }: { markerId: string }) {
  const topics = [
    ...WHOLE_FOODS.filter((f) => f.markers.includes(markerId)).map((f) => ({ id: f.id, name: f.name, to: href({ name: "wholefood", id: f.id }) })),
    ...LIFESTYLE.filter((l) => l.markers.includes(markerId)).map((l) => ({ id: l.id, name: l.name, to: href({ name: "lifestyle-item", id: l.id }) })),
  ];
  if (!topics.length) return null;
  return (
    <p className="text-sm text-ink-2">
      What research says about foods and habits that can change it:{" "}
      {topics.map((t, i) => (
        <span key={t.id}>
          {i > 0 && " · "}
          <a href={t.to} className="font-medium text-accent">
            {t.name}
          </a>
        </span>
      ))}
    </p>
  );
}
