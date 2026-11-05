import { bodyFatComparison, fatMassAt, FITNESS_FAT_RANGES, type BodyFatBand, type BodyFatGuide, type FitnessFatRange } from "@bt/shared/core/bodyFat";
import type { Citation, Measurement, Profile } from "@bt/shared/core/types";
import { formatValue } from "@bt/shared/core/units";
import { displayUnitFor, formatDate, showValue } from "../format";
import { useAllMeasurements, useDisplayUnits } from "../hooks";
import { BIOMARKER_MAP } from "../knowledge";
import { href } from "../router";
import { Fold, FoldGroup } from "./disclosure";
import { StudyLink } from "./evidence";
import { InlineBirthMonth } from "./InlineBirthMonth";
import { Card, cx } from "./ui";
import { PaperLink } from "./PaperLink";

const BODY_FAT = BIOMARKER_MAP.get("body_fat")!;
const WEIGHT = BIOMARKER_MAP.get("weight")!;
const REFERENCE_LABEL: Record<BodyFatBand, string> = {
  below: "Below reference",
  within: "Within reference",
  above: "Above reference",
  high: "Above reference (upper band)",
};
const BIA_SOURCE: Citation = {
  pmid: "15380917", doi: "10.1016/j.clnu.2004.06.004", year: 2004, studyType: "review",
  title: "Bioelectrical impedance analysis--part I: review of principles and methods.",
};
const FITNESS_SOURCE = "https://www.healthline.com/health/exercise-fitness/ideal-body-fat-percentage";

/** Beside the latest percentage; the dates of both inputs remain visible. */
export function BodyFatMass({ measurement }: { measurement: Measurement }) {
  const all = useAllMeasurements();
  const units = useDisplayUnits();
  if (all === undefined) return null;
  const estimate = fatMassAt(measurement, all);
  if (!estimate) return <p className="text-sm text-ink-2">Fat mass needs an exact body-fat percentage and a weight reading within 30 days.</p>;
  const poundsFirst = displayUnitFor(WEIGHT, units.weight) === "lb";
  const kg = `${formatValue(estimate.kg)} kg`;
  const lb = `${formatValue(estimate.lb)} lb`;
  const weightUnit = poundsFirst ? "lb" : "kg";
  return <div className="mt-2 flex max-w-3xl flex-col gap-1">
    <p className="font-medium text-ink">Estimated fat mass: {poundsFirst ? `${lb} (${kg})` : `${kg} (${lb})`}</p>
    <p className="text-sm text-ink-2">
      Weight used: {showValue(WEIGHT, estimate.weight.value, weightUnit)} {weightUnit}, {formatDate(estimate.weight.date)}
      {estimate.daysApart === 0 ? " (same day)." : ` (${estimate.daysApart} ${estimate.daysApart === 1 ? "day" : "days"} apart).`}
      {" "}Calculated from weight × body-fat percentage; not a separate measurement.
    </p>
  </div>;
}

/** A neutral position label, not a clinical low/high/normal verdict. */
export function BodyFatReferenceBadge({ measurement, profile }: { measurement: Measurement; profile: Profile }) {
  const result = bodyFatComparison([measurement], profile, measurement.date);
  if (!result.band) return null;
  return <span className="rounded-full border border-line bg-sunken px-3 py-1 text-sm font-medium text-ink" aria-label={`Body fat reference position: ${REFERENCE_LABEL[result.band]}`}>
    {REFERENCE_LABEL[result.band]}
  </span>;
}

/** A separate comparison, leaving the existing body-fat history chart untouched. */
export function BodyFatComparison({ measurements, profile, today }: { measurements: readonly Measurement[]; profile: Profile; today: string }) {
  const result = bodyFatComparison(measurements, profile, today);
  const sex = profile.sex === "m" || profile.sex === "f" ? profile.sex : undefined;
  const adult = result.age !== undefined && result.age >= 20;
  return <Card aria-label="Body fat group comparison" className="flex min-w-0 flex-col gap-5">
    <div className="max-w-3xl">
      <h2 className="font-serif text-2xl font-normal">Compared with this reference</h2>
      <p className="mt-1 text-ink-2">Your position in a published comparison—not a healthy/unhealthy verdict or a target.</p>
    </div>

    {result.guide ? <>
      <div>
        <h3 className="text-lg font-medium">Age- and sex-specific reference</h3>
        <p className="mt-1 text-ink-2">
          For {result.guide.sex === "m" ? "men" : "women"} aged {result.guide.ageFrom}–{result.guide.ageThrough}
          {result.latest ? `, using your age on ${formatDate(result.latest.date)}.` : ", using your age today."}
        </p>
        {result.band && <p className="mt-3 text-lg font-medium">Your position: {REFERENCE_LABEL[result.band]} · {formatValue(result.value!)}%</p>}
        {!result.latest && <p className="mt-3 text-ink-2">No body-fat reading saved yet. The reference is shown without a personal marker.</p>}
        {result.latest && result.value === undefined && <p className="mt-3 text-ink-2">This reading is a limit or cannot be placed as an exact percentage. No personal marker is drawn.</p>}
      </div>
      <AgeGuideChart guide={result.guide} value={result.value} band={result.band} />
    </> : <div className="max-w-3xl">
      <h3 className="text-lg font-medium">Age- and sex-specific reference</h3>
      {!profile.birthMonth ? <>
        <p className="mt-1 text-ink-2">Add your month and year of birth to choose the reference for your age.</p>
        <InlineBirthMonth profile={profile} forLabel="body fat" />
      </> : <p className="mt-1 text-ink-2">{!sex
        ? "Choose the sex used by the reference in Settings to see a personal comparison."
        : "This age-specific reference covers ages 20–79. Your percentage and history remain available, but no age band is extrapolated."}</p>}
      {!sex && <p className="mt-2"><a href={href({ name: "data", tab: "data" })}>Add sex in Settings</a></p>}
    </div>}

    <p className="max-w-3xl text-sm text-ink-2">These are provisional, BMI-derived reference values—not minimum and maximum healthy body-fat levels. Being outside them alone does not establish a health problem.</p>

    <FoldGroup>
      <Fold title="Five-category fitness reference" summary={`${result.fitness ? `Your reference group: ${result.fitness.label}. ` : "Essential fat, athletes, fitness, average and obesity. "}Sex-specific; not age-adjusted.`}>
        <div className="flex min-w-0 flex-col gap-4">
          <p className="max-w-3xl text-ink-2">These common adult reference labels use a different system. An “Athletes” percentage does not establish athletic fitness, and the “Obesity” band is not a diagnosis. “Essential fat” is not a target. The two references can give different labels.</p>
          {sex ? <>
            <p className="font-medium">Reference for {sex === "m" ? "men" : "women"}</p>
            {result.fitness && <p>Your percentage falls in the <strong>{result.fitness.label}</strong> reference band.</p>}
            {result.value !== undefined && adult && !result.fitness && <p className="text-ink-2">Your reading is outside the published bands or between their rounded whole-number ranges; no group is assigned.</p>}
            {!adult && <p className="text-ink-2">The adult reference is shown for information only. No personal group is assigned without an adult age.</p>}
            <FitnessReferenceChart ranges={FITNESS_FAT_RANGES[sex]} value={adult ? result.value : undefined} selected={result.fitness?.id} />
          </> : <p className="text-ink-2">Add sex in Settings to see the appropriate reference. No male or female range is assumed.</p>}
          <p className="max-w-3xl text-sm text-ink-2">Published whole-number ranges have small gaps. A decimal value between them is left unclassified rather than inventing a cut-off. This is a common ACE-attributed reference, not a validated age-specific clinical standard. <PaperLink href={FITNESS_SOURCE} source={{ title: "Reference table and limitations", authors: "Healthline", year: 2025 }} target="_blank" rel="noreferrer">Reference table and limitations (Healthline, 2025)</PaperLink>.</p>
        </div>
      </Fold>
      <Fold title="Sources and measurement limits" summary="How the references were made, and why a reading is only an estimate.">
        <div className="flex max-w-3xl flex-col gap-3 text-sm text-ink-2">
          <p>The age-specific bands were derived from BMI categories in an African American and white study sample—not directly from future health outcomes. Values are rounded references, not sharp biological boundaries. They do not establish whether someone is fit or an athlete. The extra upper band corresponds to BMI 30; the source does not supply a matching second lower boundary.</p>
          <StudyLink s={BODY_FAT.sources[0]!} />
          <p>Body-fat measurements are estimates. Hydration can affect impedance scales, and different measurement methods can disagree; those uncertainties carry into your group and calculated fat mass. Compare readings taken the same way.</p>
          <StudyLink s={BIA_SOURCE} />
        </div>
      </Fold>
    </FoldGroup>

  </Card>;
}

function AgeGuideChart({ guide, value, band }: { guide: BodyFatGuide; value?: number; band?: BodyFatBand }) {
  // Coordinates only; reference bands come from core.
  const maximum = Math.max(50, value === undefined ? 0 : Math.ceil(value / 10) * 10);
  const segments: { id: BodyFatBand; from: number; to: number; range: string }[] = [
    { id: "below", from: 0, to: guide.low, range: `Below ${guide.low}%` },
    { id: "within", from: guide.low, to: guide.high, range: `${guide.low}–${guide.high}%` },
    { id: "above", from: guide.high, to: guide.veryHigh, range: `Above ${guide.high}% to below ${guide.veryHigh}%` },
    { id: "high", from: guide.veryHigh, to: maximum, range: `${guide.veryHigh}% or more` },
  ];
  return <div className="min-w-0">
    <div role="img" aria-label={value === undefined ? "Age- and sex-specific body-fat comparison, no personal reading." : `Body fat ${formatValue(value)} percent: ${band ? REFERENCE_LABEL[band] : "unclassified"}.`} className="px-2 pt-3">
      <div className="relative">
        <div aria-hidden="true" className="flex h-10 overflow-hidden rounded-lg border border-line-strong">
          {segments.map((segment) => <div key={segment.id} className={cx("shrink-0 border-r border-line-strong last:border-r-0", band === segment.id ? "bg-line-strong" : "bg-sunken")} style={{ width: `${(segment.to - segment.from) / maximum * 100}%` }} />)}
        </div>
        {value !== undefined && <div aria-hidden="true" className="pointer-events-none absolute -top-2 -bottom-1 w-0.5 -translate-x-1/2 bg-ink outline-2 outline-surface" style={{ left: `${value / maximum * 100}%` }}>
          <svg width="12" height="8" viewBox="0 0 12 8" className="absolute -top-1 left-1/2 -translate-x-1/2 fill-current text-ink"><path d="M0 0h12L6 8z" /></svg>
        </div>}
      </div>
      <div aria-hidden="true" className="mt-2 flex justify-between text-xs text-ink-2 tabular-nums"><span>0%</span><span>{maximum}%</span></div>
    </div>
    <ul className="mt-4 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4" aria-label="Age-specific body fat groups">
      {segments.map((segment) => <li key={segment.id} aria-current={band === segment.id ? "true" : undefined} className={cx("flex gap-2 rounded-lg p-2", band === segment.id && "bg-sunken outline-1 outline-line-strong")}>
        <span aria-hidden="true" className={cx("mt-1 h-4 w-4 shrink-0 rounded-sm border border-line-strong", band === segment.id ? "bg-line-strong" : "bg-sunken")} />
        <span><span className="block font-medium">{REFERENCE_LABEL[segment.id]}</span><span className="text-sm text-ink-2">{segment.range}</span>{band === segment.id && <span className="block text-sm font-medium text-accent">Your position</span>}</span>
      </li>)}
    </ul>
  </div>;
}

function FitnessReferenceChart({ ranges, value, selected }: { ranges: readonly FitnessFatRange[]; value?: number; selected?: string }) {
  const maximum = Math.max(50, value === undefined ? 0 : Math.ceil(value / 10) * 10);
  return <div className="min-w-0" role="group" aria-label="Five-category body fat reference">
    <ul className="divide-y divide-line">
      {ranges.map((range) => <li key={range.id} aria-current={selected === range.id ? "true" : undefined} className={cx("grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]", selected === range.id && "bg-sunken outline-1 outline-line-strong")}>
        <span><span className="block font-medium">{range.label}</span><span className="text-sm text-ink-2">{range.high === undefined ? `${range.low}% or more` : `${range.low}–${range.high}%`}</span>{selected === range.id && <span className="block text-sm font-medium text-accent">Your reference group</span>}</span>
        <span aria-hidden="true" className="relative block h-4 rounded-sm bg-sunken">
          <span className={cx("absolute inset-y-0 rounded-sm", selected === range.id ? "bg-ink" : "bg-line-strong")} style={{ left: `${range.low / maximum * 100}%`, width: `${((range.high ?? maximum) - range.low) / maximum * 100}%` }} />
          {value !== undefined && <span className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 bg-ink outline-1 outline-surface" style={{ left: `${value / maximum * 100}%` }} />}
        </span>
      </li>)}
    </ul>
    <p className="mt-2 text-sm text-ink-2">Bars use a 0–{maximum}% scale. {value !== undefined ? `The line marks your ${formatValue(value)}% reading.` : "No personal reading is marked."}</p>
  </div>;
}
