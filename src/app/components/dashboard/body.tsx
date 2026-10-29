import { useState, type FormEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { BODY_FIELDS, SLEEP_FIELDS, bmi, bmrMifflinTerms, latestBloodPressure, latestBody, validateBodyEntry, waistToHeight, type BodyEntryErrors, type BodyField, type GlucoseContext } from "../../../core/body";
import { ageAt } from "../../../core/phenoageDraws";
import { ChoiceGroup } from "../ChoiceGroup";
import { todayIso } from "../../../core/dates";
import type { DashboardMarker } from "../../../core/dashboard";
import { personalRange } from "../../../core/personalRange";
import { flagLatest, flagMeasurement, recentAverage, resolveRange, sortByDate } from "../../../core/trends";
import type { Measurement, Profile } from "../../../core/types";
import { formatValue, listUnits } from "../../../core/units";
import { addMeasurements } from "../../../db/db";
import { displayUnitFor, formatDate, formatHours, showChange, showMeasurement } from "../../format";
import { useDisplayUnits } from "../../hooks";
import { BIOMARKER_MAP, shortName } from "../../knowledge";
import { href } from "../../router";
import { UnitSelect } from "../UnitSelect";
import { StudyLink } from "../evidence";
import { Button, FlagBadge, buttonStyles, cx, errorStyles, inputStyles, labelStyles as formLabel } from "../ui";
import { Sparkline } from "./Sparkline";
import { Figure, cardStyles, labelStyles as figureLabel } from "./widgets";


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

export function BmiFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const w = latestBody(ms).weight;
  const b = w ? bmi(w.value, profile.heightCm) : undefined;
  return (
    <Figure
      label="BMI"
      href={href({ name: "marker", id: "weight" })}
      className={className}
      foot={b === undefined ? (profile.heightCm ? "Add your weight to see it." : "Add your height in Settings → Your data.") : "No range shown: BMI can't tell muscle from fat. Waist and body fat say more."}
    >
      <p className={cx(big, b === undefined && "text-ink-2")}>{b === undefined ? "–" : b.toFixed(1)}</p>
    </Figure>
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
  const missing = [!w && "weight", !profile.heightCm && "height", !profile.birthMonth && "month of birth", !profile.sex && "sex"].filter(Boolean) as string[];
  const kcal = (v: number) => Math.round(v).toLocaleString("en-GB");
  return (
    <Dialog.Root>
      <Dialog.Trigger
        className={cx(
          cardStyles,
          className,
          "group flex min-h-40 cursor-pointer flex-col gap-2 text-left text-ink transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
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
        {terms !== undefined && <span className="mt-auto text-sm font-medium text-accent">How it's worked out</span>}
      </Dialog.Trigger>
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

const DEVICE_FIELDS = new Set<BodyField>(["heart_rate", "exercise_hr", "hrv", "hrv_resting", "spo2", "sleep_duration", "sleep_deep", "sleep_rem", "vo2max"]);
const UNIT_WORDS: Record<string, string> = { bpm: "beats a minute" };

/** The latest reading of one body measurement, with its change over about 3 months. */
export function LatestFigure({ ms, id, label, profile, className }: { ms: Measurement[]; id: BodyField; label: string; profile: Profile; className?: string }) {
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
      ? `Last night ${formatHours(last.value)}.${range?.low !== undefined && range.high !== undefined ? ` The usual advice is ${range.low}–${range.high} hours.` : ""}`
      : def.judgeAverageOfDays
        ? `${formatDate(last.date)}. Judged on a week's average, which needs 3 nights.`
        : week
          ? `Average over the last week: ${formatHours(week.value)}`
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
              <span className={big}>{formatHours(week.value)}</span>
              <span className="text-ink-2">a night, last week</span>
            </>
          ) : unit === "h" ? (
            <span className={big}>{formatHours(last.value)}</span>
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
  resting_hr: "Resting heart rate",
  hrv_resting: "Resting HRV",
  spo2: "Blood oxygen",
  sleep_duration: "Sleep",
  glucose_home: "Blood glucose",
};

/** One line per key body measurement with a small trend line: for the main dashboard. Blood pressure is one row. */
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
            <a href={href({ name: "marker", id: m.def.id })} className="grid min-h-12 grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-3 py-1.5 text-ink no-underline hover:bg-sunken">
              <span className="truncate text-sm font-medium">{SUMMARY_LABEL[m.def.id] ?? shortName(m.def)}</span>
              <Sparkline series={m.series.slice(-12)} {...(m.range ? { range: m.range } : {})} tone={tone} />
              <span className="flex items-center justify-end gap-2 text-sm whitespace-nowrap tabular-nums">
                {bp && dia ? `${Math.round(m.latest.value)}/${Math.round(dia.latest.value)}` : showMeasurement(m.def, m.latest, unit)} <span className="text-ink-2">{unit}</span>
                {flag !== "normal" && flag !== "unknown" && <FlagBadge flag={flag} />}
              </span>
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
  resting_hr: "Resting heart rate",
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
        <summary className="min-h-10 cursor-pointer content-center font-medium">Heart rate, HRV, blood oxygen and sleep (usually from a watch or ring)</summary>
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
        <p className="mt-3 text-sm text-ink-2">HRV here is RMSSD, as most rings and Android watches show it. Apple Watch shows SDNN, a different measure.</p>
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
