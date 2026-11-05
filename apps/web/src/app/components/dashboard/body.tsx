import { useState, type FormEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { BODY_FIELDS, FITNESS_FIELDS, SLEEP_FIELDS, bmiTerms, bmrMifflinTerms, latestBloodPressure, rmrCunningham, latestBody, validateBodyEntry, waistToHeight, type BodyEntryErrors, type BodyField, type GlucoseContext } from "@bt/core/body";
import { ageAt } from "@bt/core/phenoageDraws";
import { ChoiceGroup } from "../ChoiceGroup";
import { todayIso } from "@bt/core/dates";
import type { DashboardMarker } from "@bt/core/dashboard";
import { personalRange } from "@bt/core/personalRange";
import { flagLatest, flagMeasurement, recentAverage, resolveRange, sortByDate } from "@bt/core/trends";
import type { Measurement, Profile } from "@bt/core/types";
import { formatValue, listUnits } from "@bt/core/units";
import { addMeasurements } from "../../../db/db";
import { displayUnitFor, formatDate, showChange, showMeasurement, showRange, showValue, valueUnit } from "../../format";
import { useDisplayUnits } from "../../hooks";
import { BIOMARKER_MAP, shortName } from "../../knowledge";
import { href } from "../../router";
import { UnitSelect } from "../UnitSelect";
import { StudyLink } from "../evidence";
import { Button, FlagBadge, buttonStyles, cx, errorStyles, inputStyles, labelStyles as formLabel } from "../ui";
import { Sparkline } from "./Sparkline";
import { Figure, cardStyles, labelStyles as figureLabel } from "./widgets";
import { InlineBirthMonth } from "../InlineBirthMonth";


const big = "font-serif text-4xl leading-none tabular-nums sm:text-5xl";

function useUnit(id: BodyField): string {
  const units = useDisplayUnits();
  return displayUnitFor(BIOMARKER_MAP.get(id)!, units[id]);
}

/** Change from the reading about 3 months back (or the first one), in the person's unit. */
function sinceEarlier(series: Measurement[], id: BodyField, unit: string): string | undefined {
  const last = series.at(-1);
  if (!last || series.length < 2) return undefined;
  const cutoff = new Date(Date.parse(last.date) - 90 * 86_400_000).toISOString().slice(0, 10);
  const base = [...series].reverse().find((m) => m.date <= cutoff) ?? series[0]!;
  if (base === last) return undefined;
  return `${showChange(BIOMARKER_MAP.get(id)!, last.value - base.value, unit)} since ${formatDate(base.date)}`;
}

export function WeightFigure({ ms, className }: { ms: Measurement[]; className?: string }) {
  const unit = useUnit("weight");
  const series = sortByDate(ms.filter((m) => m.biomarkerId === "weight"));
  const last = series.at(-1);
  const def = BIOMARKER_MAP.get("weight")!;
  return (
    <Figure label="Weight" href={href({ name: "marker", id: "weight" })} className={className} foot={last ? (sinceEarlier(series, "weight", unit) ?? formatDate(last.date)) : "Not measured yet"}>
      {last ? (
        <p className="flex items-baseline gap-1.5">
          <span className={big}>{showMeasurement(def, last, unit)}</span>
          <span className="text-ink-2">{unit}</span>
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

/** A figure with no chart of its own: the card opens a window explaining how it's worked out. */
function ExplainFigure({
  label,
  value,
  foot,
  cta,
  title,
  description,
  className,
  children,
}: {
  label: string;
  value: React.ReactNode;
  foot: string;
  cta?: string;
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        className={cx(
          cardStyles,
          className,
          "group flex min-h-40 cursor-pointer flex-col justify-center gap-2 text-left text-ink transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className={figureLabel}>{label}</span>
        {value}
        <span className="text-sm text-ink-2">{foot}</span>
        {cta && <span className="text-sm font-medium text-accent">{cta}</span>}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[34rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div>
            <Dialog.Title className="font-serif text-2xl font-normal">{title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-ink-2">{description}</Dialog.Description>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const ASHWELL_2012 = {
  pmid: "22106927",
  doi: "10.1111/j.1467-789X.2011.00952.x",
  title: "Waist-to-height ratio is a better screening tool than waist circumference and BMI for adult cardiometabolic risk factors: systematic review and meta-analysis",
  year: 2012,
  studyType: "meta-analysis" as const,
};

/** Body mass index, with the sum worked through. No range or label (it can't tell muscle from fat). */
export function BmiFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const w = latestBody(ms).weight;
  const t = w ? bmiTerms(w.value, profile.heightCm) : undefined;
  return (
    <ExplainFigure
      label="BMI"
      className={className}
      value={<span className={cx(big, !t && "text-ink-2")}>{t ? t.bmi.toFixed(1) : "–"}</span>}
      foot={!t ? (profile.heightCm ? "Add your weight to see it." : "Add your height in Settings → Your data.") : "No range shown: BMI can't tell muscle from fat. Waist and body fat say more."}
      {...(t ? { cta: "How it's worked out" } : {})}
      title="Body mass index (BMI)"
      description="Weight divided by height squared. A quick number used to study groups of people, but it can't tell muscle from fat or say where fat sits."
    >
      {t && w ? (
        <div className="rounded-lg bg-sunken p-3">
          <p className="text-sm text-ink-2">With your numbers</p>
          <table className="mt-2 w-full text-sm tabular-nums">
            <tbody>
              <tr>
                <td className="py-0.5">Weight ({formatDate(w.date)})</td>
                <td className="py-0.5 text-right">{formatValue(w.value)} kg</td>
              </tr>
              <tr>
                <td className="py-0.5">Height {formatValue(profile.heightCm!)} cm, in metres, squared</td>
                <td className="py-0.5 text-right">
                  {formatValue(t.heightM)} × {formatValue(t.heightM)} = {formatValue(Math.round(t.heightSquared * 1000) / 1000)} m²
                </td>
              </tr>
              <tr className="border-t border-line font-medium">
                <td className="pt-1.5">BMI = weight ÷ height²</td>
                <td className="pt-1.5 text-right">{t.bmi.toFixed(1)} kg/m²</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-ink-2">Needs your height (Settings → Your data) and a weight.</p>
      )}
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
        <li>No range or label is shown here: muscle weighs more than fat, so strong people can get a "high" BMI, and people with little muscle a "normal" one.</li>
        <li>Where fat sits matters more. Waist-to-height (your waist divided by your height) predicted heart and metabolic risk better than BMI in a review of studies, and body fat says what share of your weight is fat.</li>
        <li>Not a target. The app never sets a weight goal.</li>
      </ul>
      <div className="text-sm text-ink-2">
        <p className="font-medium text-ink">Source</p>
        <p className="mt-1">
          <StudyLink s={ASHWELL_2012} />
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={href({ name: "marker", id: "waist", section: "waist-to-height" })} className={buttonStyles.secondary}>
          Waist-to-height
        </a>
        <a href={href({ name: "marker", id: "weight" })} className={buttonStyles.secondary}>
          Weight chart
        </a>
        <Dialog.Close className={cx(buttonStyles.quiet, "ml-auto")}>Close</Dialog.Close>
      </div>
    </ExplainFigure>
  );
}

/**
 * Resting metabolic rate, from the latest weight, height, age and sex. Shown as an estimate, never as a
 * target. It has no chart of its own, so it opens an explanation with the sum worked through.
 */
export function BmrFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const w = latestBody(ms).weight;
  const age = w && profile.birthMonth ? ageAt(profile.birthMonth, w.date) : undefined;
  const terms = w ? bmrMifflinTerms(w.value, profile.heightCm, age, profile.sex) : undefined;
  const lean = rmrCunningham(ms);
  const missing = [!w && "weight", !profile.heightCm && "height", !profile.birthMonth && "month of birth", !profile.sex && "sex"].filter(Boolean) as string[];
  const kcal = (v: number) => Math.round(v).toLocaleString("en-GB");
  return (
    <Dialog.Root>
      {!profile.birthMonth ? (
        <Figure label="Resting metabolic rate" className={className} foot={missing.length > 1 ? `Also needs your ${missing.filter((item) => item !== "month of birth").join(", ")}.` : undefined}>
          <p className={cx(big, "text-ink-2")}>–</p>
          <InlineBirthMonth profile={profile} forLabel="resting metabolic rate" />
          <Dialog.Trigger className={cx(buttonStyles.quiet, "mt-2")}>About this estimate</Dialog.Trigger>
        </Figure>
      ) : (
      <Dialog.Trigger
        className={cx(
          cardStyles,
          className,
          "group flex min-h-40 cursor-pointer flex-col justify-center gap-2 text-left text-ink transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className={figureLabel}>Resting metabolic rate</span>
        {terms === undefined ? (
          <span className="font-serif text-4xl text-ink-2">–</span>
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span className={big}>{kcal(terms.total)}</span>
            <span className="text-ink-2">kcal a day</span>
          </span>
        )}
        <span className="text-sm text-ink-2">
          {terms === undefined
            ? missing.length
              ? `Needs your ${missing.join(", ")} (Settings → Your data).`
              : "For adults only."
            : "Energy your body uses at rest, estimated from weight, height, age and sex. Not a target."}
        </span>
        {terms !== undefined && <span className="text-sm font-medium text-accent">How it's worked out</span>}
      </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[34rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div>
            <Dialog.Title className="font-serif text-2xl font-normal">Resting metabolic rate</Dialog.Title>
            <Dialog.Description className="mt-1 text-ink-2">
              The energy your body uses at rest, awake and lying still: breathing, heartbeat, keeping warm. Often called basal metabolic rate.
              Your whole day uses more, with moving and digesting.
            </Dialog.Description>
          </div>
          {terms && w ? (
            <>
              <div className="rounded-lg bg-sunken p-3">
                <p className="text-sm text-ink-2">Mifflin–St Jeor equation, with your numbers</p>
                <table className="mt-2 w-full text-sm tabular-nums">
                  <tbody>
                    <tr>
                      <td className="py-0.5">10 × weight {formatValue(w.value)} kg ({formatDate(w.date)})</td>
                      <td className="py-0.5 text-right">{kcal(terms.weight)}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5">+ 6.25 × height {formatValue(profile.heightCm!)} cm</td>
                      <td className="py-0.5 text-right">+ {kcal(terms.height)}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5">− 5 × age {formatValue(Math.round(age! * 10) / 10)} years</td>
                      <td className="py-0.5 text-right">− {kcal(-terms.age)}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5">{profile.sex === "m" ? "+ 5 (men)" : "− 161 (women)"}</td>
                      <td className="py-0.5 text-right">{terms.sex > 0 ? `+ ${terms.sex}` : `− ${-terms.sex}`}</td>
                    </tr>
                    <tr className="border-t border-line font-medium">
                      <td className="pt-1.5">Resting metabolic rate</td>
                      <td className="pt-1.5 text-right">{kcal(terms.total)} kcal a day</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {lean && (
                <div className="rounded-lg border border-line p-3">
                  <p className="text-sm font-medium">With your body fat (Cunningham equation)</p>
                  <p className="mt-1 text-sm text-ink-2 tabular-nums">
                    Lean mass {formatValue(Math.round(lean.leanKg * 10) / 10)} kg (weight {formatValue(lean.weight.value)} kg, body fat {formatValue(lean.bodyFat.value)} %,{" "}
                    {formatDate(lean.bodyFat.date)}) → 500 + 22 × {formatValue(Math.round(lean.leanKg * 10) / 10)} ={" "}
                    <span className="font-medium text-ink">{kcal(lean.total)} kcal a day</span>
                  </p>
                  <p className="mt-2 text-sm text-ink-2">
                    Shown beside the main estimate, not instead of it. Using body fat isn't more accurate for most people: in Mifflin&apos;s own
                    data, fat-free mass predicted measured values less well than weight, height, age and sex, and in a review of athletes no
                    equation was reliably best. Home body-fat readings can be several points off, and that error carries into this number.
                    Different equations giving different numbers is why both are estimates.
                  </p>
                </div>
              )}
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
                <li>An estimate: within about 10 % of a measured value for most adults, further off for some people, especially with a lot of muscle or a lot of body fat.</li>
                {terms.outsideStudyAges && <li>Your age is outside the ages the equation was made from (19 to 78), so it may be less accurate.</li>}
                <li>Not a target and not how much to eat. The app never sets an intake or a deficit.</li>
              </ul>
            </>
          ) : (
            <p className="text-ink-2">{missing.length ? `Needs your ${missing.join(", ")}. Add them in Settings → Your data, and your weight on the Body page.` : "Only worked out for adults."}</p>
          )}
          <div className="text-sm text-ink-2">
            <p className="font-medium text-ink">Sources</p>
            <ul className="mt-1 flex flex-col gap-1">
              <li>
                <StudyLink s={{ pmid: "2305711", doi: "10.1093/ajcn/51.2.241", title: "A new predictive equation for resting energy expenditure in healthy individuals", year: 1990, studyType: "observational", n: 498 }} />
              </li>
              {lean && (
                <li>
                  <StudyLink s={{ pmid: "7435418", doi: "10.1093/ajcn/33.11.2372", title: "A reanalysis of the factors influencing basal metabolic rate in normal adults", year: 1980, studyType: "observational", n: 223 }} />
                </li>
              )}
              {lean && (
                <li>
                  <StudyLink s={{ pmid: "37632665", doi: "10.1007/s40279-023-01896-z", title: "Accuracy of Resting Metabolic Rate Prediction Equations in Athletes: A Systematic Review with Meta-analysis", year: 2023, studyType: "meta-analysis", n: 1430 }} />
                </li>
              )}
              <li>
                <StudyLink s={{ pmid: "15883556", title: "Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: a systematic review", year: 2005, studyType: "review" }} />
              </li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={href({ name: "marker", id: "weight" })} className={buttonStyles.secondary}>
              Weight chart
            </a>
            <a href={href({ name: "data", tab: "data" })} className={buttonStyles.secondary}>
              Height, birth month, sex
            </a>
            <Dialog.Close className={cx(buttonStyles.quiet, "ml-auto")}>Close</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const GLUCOSE_WHEN = (m: Measurement) => (m.fasted === true ? "fasting" : m.fasted === false ? "after a meal" : "time not given");

export function GlucoseFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const unit = useUnit("glucose_home");
  const def = BIOMARKER_MAP.get("glucose_home")!;
  const last = latestBody(ms).glucose_home;
  const flag = last ? flagMeasurement(def, last, profile) : undefined;
  return (
    <Figure label="Blood glucose (home)" href={href({ name: "marker", id: "glucose_home" })} className={className} foot={last ? `${GLUCOSE_WHEN(last)}, ${formatDate(last.date)}` : "Not measured yet"}>
      {last ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          <span className={cx(big, flag?.startsWith("critical") && "text-danger")}>{showMeasurement(def, last, unit)}</span>
          <span className="text-ink-2">{unit}</span>
          {flag && flag !== "normal" && flag !== "unknown" && <FlagBadge flag={flag} />}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

export function WaistFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const unit = useUnit("waist");
  const last = latestBody(ms).waist;
  const def = BIOMARKER_MAP.get("waist")!;
  const ratio = last ? waistToHeight(last.value, profile.heightCm) : undefined;
  const flag = last ? flagMeasurement(def, last, profile) : undefined;
  return (
    <Figure
      label="Waist"
      href={href({ name: "marker", id: "waist" })}
      className={className}
      foot={!last ? "Not measured yet" : ratio !== undefined ? `${formatDate(last.date)} · ${ratio.toFixed(2)} of your height` : formatDate(last.date)}
    >
      {last ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          <span className={big}>{showMeasurement(def, last, unit)}</span>
          <span className="text-ink-2">{unit}</span>
          {flag && flag !== "normal" && flag !== "unknown" && <FlagBadge flag={flag} />}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

export function BloodPressureFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const bp = latestBloodPressure(ms);
  const sysDef = BIOMARKER_MAP.get("bp_systolic")!;
  const diaDef = BIOMARKER_MAP.get("bp_diastolic")!;
  const flags = bp ? [flagMeasurement(sysDef, bp.systolic, profile), flagMeasurement(diaDef, bp.diastolic, profile)] : [];
  const worst = flags.find((f) => f.startsWith("critical")) ?? flags.find((f) => f !== "normal" && f !== "unknown");
  return (
    <Figure label="Blood pressure" href={href({ name: "marker", id: "bp_systolic" })} className={className} foot={bp ? formatDate(bp.systolic.date) : "Not measured yet"}>
      {bp ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          <span className={cx(big, worst?.startsWith("critical") && "text-danger")}>
            {Math.round(bp.systolic.value)}/{Math.round(bp.diastolic.value)}
          </span>
          <span className="text-ink-2">mmHg</span>
          {worst && <FlagBadge flag={worst} />}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

const DEVICE_FIELDS = new Set<BodyField>(["heart_rate", "exercise_hr", "hrv", "hrv_resting", "spo2", "sleep_duration", "sleep_deep", "sleep_rem", "vo2max", "steps", "active_minutes"]);
const UNIT_WORDS: Record<string, string> = { bpm: "beats a minute" };

/** The latest reading of one body measurement, with its change over about 3 months. */
export function LatestFigure({ ms, id, label, profile, className, chart = false }: { ms: Measurement[]; id: BodyField; label: string; profile: Profile; className?: string; chart?: boolean }) {
  const unit = useUnit(id);
  const def = BIOMARKER_MAP.get(id)!;
  const series = sortByDate(ms.filter((m) => m.biomarkerId === id));
  const last = series.at(-1);
  const flag = last ? flagLatest(def, series, profile) : undefined;
  // Sleep varies night to night: a week's average says more than one night.
  const week = SLEEP_FIELDS.has(id) ? recentAverage(series) : undefined;
  // Judged on the average (sleep): the average is the headline, last night the detail.
  const byAverage = !!def.judgeAverageOfDays && !!week;
  const range = last ? resolveRange(def, last, profile) : undefined;
  const usual = def.personalRange ? personalRange(series) : undefined;
  const ms1 = (v: number) => `${Math.round(v)} ${unit}`;
  const foot = !last
    ? DEVICE_FIELDS.has(id)
      ? "From a watch or ring, or type it in"
      : "Not measured yet"
    : byAverage
      ? `Last night ${showMeasurement(def, last, unit)}.${range?.low !== undefined && range.high !== undefined ? ` The usual advice is ${showRange(def, range, unit)}.` : ""}`
      : def.judgeAverageOfDays
        ? `${formatDate(last.date)}. Judged on a week's average, which needs 3 nights.`
        : week
          ? `Average over the last week: ${showValue(def, week.value, unit)}`
          : def.personalRange
            ? usual
              ? `${usual.recent ? `Last week ${ms1(usual.recent.value)}; ` : ""}your usual ${Math.round(usual.low)}–${ms1(usual.high)}`
              : "Your usual range appears after 2 weeks of readings."
            : (sinceEarlier(series, id, unit) ?? formatDate(last.date));
  return (
    <Figure label={label} href={href({ name: "marker", id })} className={className} foot={foot}>
      {last ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          {byAverage && week ? (
            <>
              <span className={big}>{showValue(def, week.value, unit)}</span>
              <span className="text-ink-2">a night, last week</span>
            </>
          ) : SLEEP_FIELDS.has(id) ? (
            <span className={big}>{showMeasurement(def, last, unit)}</span>
          ) : (
            <>
              <span className={cx(big, flag?.startsWith("critical") && "text-danger")}>{showMeasurement(def, last, unit)}</span>
              <span className="text-ink-2">{UNIT_WORDS[unit] ?? unit}</span>
            </>
          )}
          {flag && flag !== "normal" && flag !== "unknown" && <FlagBadge flag={flag} />}
          {usual?.recent && usual.recent.position !== "within" && (
            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-sm text-ink-2">{usual.recent.position === "below" ? "Lower than usual" : "Higher than usual"}</span>
          )}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
      {/* Wide cards have room for the trend, drawn on the range when there is one. */}
      {chart && series.length > 1 && (
        <Sparkline
          series={series.slice(-24)}
          {...(range && (range.low !== undefined || range.high !== undefined) ? { range } : {})}
          tone={flag?.startsWith("critical") ? "danger" : !flag || flag === "normal" || flag === "unknown" ? "ok" : "warn"}
        />
      )}
    </Figure>
  );
}

/** Body markers in a fixed order: weight, waist, body fat, blood pressure, heart rate. */
export function inBodyOrder(markers: DashboardMarker[]): DashboardMarker[] {
  const order = new Map(BODY_FIELDS.map((f, i) => [f as string, i]));
  return [...markers].sort((a, b) => (order.get(a.def.id) ?? 9) - (order.get(b.def.id) ?? 9));
}

/** The main dashboard shows these; the rest are on the Body page. */
const SUMMARY_IDS = new Set(["weight", "waist", "bp_systolic", "resting_hr", "hrv_resting", "spo2", "sleep_duration", "glucose_home"]);
const SUMMARY_LABEL: Record<string, string> = {
  weight: "Weight",
  waist: "Waist",
  bp_systolic: "Blood pressure",
  resting_hr: "Resting pulse",
  hrv_resting: "Resting HRV",
  spo2: "Blood oxygen",
  sleep_duration: "Sleep",
  glucose_home: "Blood glucose",
};

/** One line per key body measurement with a small trend line: for the main dashboard. Blood pressure is one row. */
/** One row of a dashboard summary list: name (and flag) | chart | value | unit, the same columns in every row. */
export const summaryRow =
  "grid min-h-12 grid-cols-[minmax(0,1fr)_4rem_4rem_3.25rem] items-center gap-2 py-1.5 text-ink no-underline hover:bg-sunken";

/** The latest value for a summary row, with an arrow when it's out of range (the name keeps its room). */
export function SummaryValue({ text, flag }: { text: string; flag: string }) {
  const out = flag !== "normal" && flag !== "unknown";
  const low = flag.endsWith("low");
  return (
    <span className={cx("text-right text-sm whitespace-nowrap tabular-nums", out && (flag.startsWith("critical") ? "font-medium text-danger" : "font-medium text-warn"))}>
      {out && (
        <span aria-hidden="true" className="mr-0.5">
          {low ? "↓" : "↑"}
        </span>
      )}
      {text}
      {out && <span className="sr-only"> ({low ? "low" : "high"})</span>}
    </span>
  );
}

export function BodySummaryList({ markers }: { markers: DashboardMarker[] }) {
  const units = useDisplayUnits();
  const dia = markers.find((m) => m.def.id === "bp_diastolic");
  return (
    <ul className="flex flex-col divide-y divide-line">
      {inBodyOrder(markers.filter((m) => SUMMARY_IDS.has(m.def.id))).map((m) => {
        const bp = m.def.id === "bp_systolic";
        const unit = displayUnitFor(m.def, units[m.def.id]);
        const flag = bp && dia && dia.flag !== "normal" && dia.flag !== "unknown" && (m.flag === "normal" || m.flag === "unknown") ? dia.flag : m.flag;
        const tone = flag.startsWith("critical") ? "danger" : flag === "normal" || flag === "unknown" ? "ok" : "warn";
        return (
          <li key={m.def.id}>
            <a href={href({ name: "marker", id: m.def.id })} className={summaryRow}>
              <span className="truncate text-sm font-medium">{SUMMARY_LABEL[m.def.id] ?? shortName(m.def)}</span>
              <Sparkline series={m.series.slice(-12)} {...(m.range ? { range: m.range } : {})} tone={tone} />
              <SummaryValue text={bp && dia ? `${Math.round(m.latest.value)}/${Math.round(dia.latest.value)}` : showMeasurement(m.def, m.latest, unit)} flag={flag} />
              <span className="truncate text-sm text-ink-2">{valueUnit(m.def, unit)}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

const FIELD_LABEL: Record<BodyField, string> = {
  weight: "Weight",
  waist: "Waist",
  body_fat: "Body fat",
  bp_systolic: "Top number (systolic)",
  bp_diastolic: "Bottom number (diastolic)",
  resting_hr: "Resting pulse",
  heart_rate: "Heart rate, day average",
  exercise_hr: "Heart rate during exercise",
  hrv: "HRV",
  hrv_resting: "Resting HRV (overnight)",
  spo2: "Blood oxygen (SpO₂)",
  glucose_home: "Blood glucose",
  sleep_duration: "Sleep last night",
  sleep_deep: "Deep sleep",
  sleep_rem: "REM sleep",
  vo2max: "VO₂max",
  steps: "Steps that day",
  active_minutes: "Active minutes (moderate or harder)",
  pushups: "Push-ups",
  grip_strength: "Grip strength",
  sit_to_stand_5x: "Five chair rises",
  chair_stand_30s: "Chair stands in 30 s",
  one_leg_stand: "One-leg stand (right leg)",
  gait_speed: "Walking speed",
  sitting_rising: "Sit-and-rise score",
};

/** One day's measurements. Every field is optional; empty ones are skipped. */
export function BodyEntryForm({ onDone, cancel = true }: { onDone: (saved: number) => void; cancel?: boolean }) {
  const displayUnits = useDisplayUnits();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [values, setValues] = useState<Partial<Record<BodyField, string>>>({});
  const [units, setUnits] = useState<Record<BodyField, string>>(
    () => Object.fromEntries(BODY_FIELDS.map((f) => [f, displayUnitFor(BIOMARKER_MAP.get(f)!, displayUnits[f])])) as Record<BodyField, string>,
  );
  const [glucoseContext, setGlucoseContext] = useState<GlucoseContext | "">("");
  const [errors, setErrors] = useState<BodyEntryErrors>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = validateBodyEntry(
      { date, values: Object.fromEntries(BODY_FIELDS.map((f) => [f, { value: values[f] ?? "", unit: units[f] }])), ...(glucoseContext ? { glucoseContext } : {}) },
      BIOMARKER_MAP,
      today,
    );
    if (!r.ok) return setErrors(r.errors);
    setSaving(true);
    try {
      await addMeasurements(r.measurements);
      onDone(r.measurements.length);
    } finally {
      setSaving(false);
    }
  }

  const field = (f: BodyField, opts: { unitPick?: boolean; suffix?: string } = {}) => {
    const def = BIOMARKER_MAP.get(f)!;
    // The unit picker sits beside the field, not inside it, so each has its own label and id.
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-end gap-2">
          <Field.Root invalid={!!errors[f]} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Field.Label className={formLabel}>{FIELD_LABEL[f]}</Field.Label>
            <Field.Control
              value={values[f] ?? ""}
              onValueChange={(v) => {
                setValues((s) => ({ ...s, [f]: v }));
                setErrors((er) => ({ ...er, [f]: undefined, form: undefined }));
              }}
              inputMode="decimal"
              autoComplete="off"
              className={inputStyles}
            />
          </Field.Root>
          {opts.unitPick ? (
            <div className="shrink-0">
              <UnitSelect compact labelClassName="sr-only" label={`${FIELD_LABEL[f]} unit`} units={listUnits(def)} value={units[f]} onChange={(u) => setUnits((s) => ({ ...s, [f]: u }))} />
            </div>
          ) : (
            <span className="min-h-11 shrink-0 content-center text-ink-2">{opts.suffix ?? def.canonicalUnit}</span>
          )}
        </div>
        {errors[f] && (
          <p role="alert" className={errorStyles}>
            {errors[f]}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field.Root invalid={!!errors.date} className="flex max-w-xs flex-col gap-1.5">
        <Field.Label className={formLabel}>Date</Field.Label>
        <Field.Control type="date" value={date} max={today} onValueChange={setDate} className={inputStyles} />
        <Field.Error match={!!errors.date} className={errorStyles}>
          {errors.date}
        </Field.Error>
      </Field.Root>

      <p className="-mb-2 text-sm text-ink-2">Fill in what you measured; the rest can stay empty.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {field("weight", { unitPick: true })}
        {field("waist", { unitPick: true })}
        {field("body_fat", { suffix: "%" })}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className={cx(formLabel, "mb-1")}>Blood pressure</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("bp_systolic", { suffix: "mmHg" })}
          {field("bp_diastolic", { suffix: "mmHg" })}
          {field("resting_hr", { suffix: "bpm" })}
        </div>
        <p className="text-sm text-ink-2">Sit quietly for 5 minutes first. Many monitors also show your pulse: that's your resting heart rate.</p>
      </fieldset>
      <details className="group rounded-xl border border-line p-3 open:pb-4">
        <summary className="min-h-10 cursor-pointer content-center font-medium">Heart rate, HRV, blood oxygen, sleep and activity (usually from a watch or ring)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {field("heart_rate", { suffix: "bpm" })}
          {field("exercise_hr", { suffix: "bpm" })}
          {field("spo2", { suffix: "%" })}
          {field("hrv", { suffix: "ms" })}
          {field("hrv_resting", { suffix: "ms" })}
          {field("vo2max", { suffix: "mL/kg/min" })}
        </div>
        <p className="mt-4 mb-1 font-medium">Sleep</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("sleep_duration", { unitPick: true })}
          {field("sleep_deep", { unitPick: true })}
          {field("sleep_rem", { unitPick: true })}
        </div>
        <p className="mt-4 mb-1 font-medium">Activity</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("steps", { suffix: "steps" })}
          {field("active_minutes", { suffix: "minutes" })}
        </div>
        <p className="mt-3 text-sm text-ink-2">For a whole day that's over. Active minutes are brisk walking or harder; light activity doesn't count.</p>
        <p className="mt-3 text-sm text-ink-2">HRV here is RMSSD, as most rings and Android watches show it. Apple Watch shows SDNN, a different measure.</p>
      </details>
      <details className="group rounded-xl border border-line p-3 open:pb-4">
        <summary className="min-h-10 cursor-pointer content-center font-medium">Strength, balance and walking tests</summary>
        <p className="mt-2 text-sm text-ink-2">
          Do each test the way its page describes, so your result can be compared with people of your age. Stop if anything hurts, and have
          someone nearby for the balance tests.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {field("pushups", { suffix: "push-ups" })}
          {field("grip_strength", { unitPick: true })}
          {field("sit_to_stand_5x", { suffix: "seconds" })}
          {field("chair_stand_30s", { suffix: "stands" })}
          {field("one_leg_stand", { suffix: "seconds" })}
          {field("gait_speed", { suffix: "m/s" })}
          {field("sitting_rising", { suffix: "of 10" })}
        </div>
        <p className="mt-3 text-sm text-ink-2">
          How to do them:{" "}
          {FITNESS_FIELDS.map((f, i) => (
            <span key={f}>
              {i > 0 && " · "}
              <a href={href({ name: "marker", id: f, section: "for-your-age" })}>{FIELD_LABEL[f].replace(" (right leg)", "")}</a>
            </span>
          ))}
          . Walking speed: 4 metres divided by the seconds it took.
        </p>
      </details>
      <fieldset className="flex flex-col gap-3">
        <legend className={cx(formLabel, "mb-1")}>Blood glucose (home meter)</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("glucose_home", { unitPick: true })}
          <div className="sm:col-span-2">
            <ChoiceGroup<GlucoseContext | "">
              label="When"
              value={glucoseContext}
              onChange={(v) => {
                setGlucoseContext(v);
                setErrors((er) => ({ ...er, glucoseContext: undefined }));
              }}
              options={[
                { value: "fasting", label: "Fasting" },
                { value: "after-meal", label: "After a meal" },
                { value: "other", label: "Other" },
              ]}
            />
            {errors.glucoseContext && (
              <p role="alert" className={cx(errorStyles, "mt-1")}>
                {errors.glucoseContext}
              </p>
            )}
          </div>
        </div>
        <p className="text-sm text-ink-2">Fasting means nothing to eat for 8 hours, usually first thing in the morning. "After a meal" is about 2 hours after you started eating.</p>
      </fieldset>

      {errors.form && (
        <p role="alert" className={errorStyles}>
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          Save
        </Button>
        {cancel && (
          <Button variant="quiet" onClick={() => onDone(0)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
